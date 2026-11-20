/**
 * Streaming ZIP64 writer (STORE / method 0) — supports archives larger than 4 GB (e.g. 12.8 GB+)
 * with constant RAM usage, 8 MB buffered disk I/O (100x fewer IPC writes in Chrome File System API),
 * fast slice-by-4 CRC32, and byte-exact Pause/Resume checkpointing!
 */

const CRC_TABLES: Uint32Array[] = (() => {
  const t0 = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t0[i] = c >>> 0;
  }
  const t1 = new Uint32Array(256);
  const t2 = new Uint32Array(256);
  const t3 = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    t1[i] = (t0[t0[i] & 0xff] ^ (t0[i] >>> 8)) >>> 0;
    t2[i] = (t0[t1[i] & 0xff] ^ (t1[i] >>> 8)) >>> 0;
    t3[i] = (t0[t2[i] & 0xff] ^ (t2[i] >>> 8)) >>> 0;
  }
  return [t0, t1, t2, t3];
})();

/** Slice-by-4 IEEE 802.3 CRC-32 (~3x faster for 12+ GB archives) */
export function crc32(data: Uint8Array): number {
  const [t0, t1, t2, t3] = CRC_TABLES;
  let crc = 0xffffffff;
  let i = 0;
  const len = data.length;
  const end4 = len - 3;

  while (i < end4) {
    const b0 = (crc ^ data[i]) & 0xff;
    const b1 = ((crc >>> 8) ^ data[i + 1]) & 0xff;
    const b2 = ((crc >>> 16) ^ data[i + 2]) & 0xff;
    const b3 = ((crc >>> 24) ^ data[i + 3]) & 0xff;
    crc = t3[b0] ^ t2[b1] ^ t1[b2] ^ t0[b3];
    i += 4;
  }
  while (i < len) {
    crc = t0[(crc ^ data[i++]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const textEncoder = new TextEncoder();

interface Zip64CentralEntry {
  path: string;
  nameBytes: Uint8Array;
  crc: number;
  size: number;
  offset: number;
}

export interface Zip64EntrySnapshot {
  path: string;
  crc: number;
  size: number;
  offset: number;
}

function writeUint64LE(view: DataView, pos: number, value: number): void {
  const low = value >>> 0;
  const high = Math.floor(value / 4294967296) >>> 0;
  view.setUint32(pos, low, true);
  view.setUint32(pos + 4, high, true);
}

export interface StreamingZip64Sink {
  write(chunk: Uint8Array): Promise<void>;
  flush?(): Promise<void>;
  close(): Promise<void>;
}

export class MemoryBufferSink implements StreamingZip64Sink {
  private chunks: BlobPart[] = [];

  async write(chunk: Uint8Array): Promise<void> {
    const copy = new Uint8Array(chunk.byteLength);
    copy.set(chunk);
    this.chunks.push(copy);
  }

  async flush(): Promise<void> {
    // nothing to flush
  }

  async close(): Promise<void> {
    // nothing to flush
  }

  toBlob(): Blob {
    return new Blob(this.chunks, { type: 'application/zip' });
  }
}

/**
 * Buffered File System Access API sink.
 * Aggregates thousands of tiny headers/assets into 8 MB sequential disk writes,
 * reducing Chrome IPC write calls from ~160,000 down to ~1,600 for 12.8 GB!
 */
export class FileSystemWritableSink implements StreamingZip64Sink {
  private writable: {
    write(data: Uint8Array<ArrayBuffer>): Promise<void>;
    close(): Promise<void>;
  };
  private buffer: Uint8Array<ArrayBuffer>;
  private used = 0;

  constructor(
    writable: { write(data: Uint8Array<ArrayBuffer>): Promise<void>; close(): Promise<void> },
    bufferSizeBytes = 8 * 1024 * 1024
  ) {
    this.writable = writable;
    this.buffer = new Uint8Array(bufferSizeBytes);
  }

  async write(chunk: Uint8Array): Promise<void> {
    const len = chunk.byteLength;
    if (len === 0) return;

    // If chunk itself is larger than buffer, flush existing buffer and write chunk directly
    if (len >= this.buffer.byteLength) {
      await this.flush();
      const safeChunk: Uint8Array<ArrayBuffer> =
        chunk.buffer instanceof ArrayBuffer
          ? (chunk as Uint8Array<ArrayBuffer>)
          : new Uint8Array(chunk);
      await this.writable.write(safeChunk);
      return;
    }

    if (this.used + len > this.buffer.byteLength) {
      await this.flush();
    }

    this.buffer.set(chunk, this.used);
    this.used += len;
  }

  async flush(): Promise<void> {
    if (this.used === 0) return;
    // Slice to exact used length so writable.write receives a clean standalone buffer
    const out = this.buffer.slice(0, this.used);
    this.used = 0;
    await this.writable.write(out);
  }

  async close(): Promise<void> {
    await this.flush();
    await this.writable.close();
  }
}

export interface StreamingZip64ResumeInit {
  initialOffset: number;
  initialEntries: Zip64EntrySnapshot[];
}

export class StreamingZip64Writer {
  private sink: StreamingZip64Sink;
  private entries: Zip64CentralEntry[] = [];
  private offset = 0;

  constructor(sink: StreamingZip64Sink, resumeInit?: StreamingZip64ResumeInit) {
    this.sink = sink;
    if (resumeInit) {
      this.offset = resumeInit.initialOffset;
      this.entries = resumeInit.initialEntries.map((e) => ({
        path: e.path,
        nameBytes: textEncoder.encode(e.path),
        crc: e.crc,
        size: e.size,
        offset: e.offset,
      }));
    }
  }

  getCurrentOffset(): number {
    return this.offset;
  }

  getEntryCount(): number {
    return this.entries.length;
  }

  getCheckpointSnapshot(): { offset: number; entries: Zip64EntrySnapshot[] } {
    return {
      offset: this.offset,
      entries: this.entries.map((e) => ({
        path: e.path,
        crc: e.crc,
        size: e.size,
        offset: e.offset,
      })),
    };
  }

  async addFile(zipPath: string, data: Uint8Array): Promise<void> {
    const cleanPath = zipPath.replace(/^\/+/, '').replace(/\\/g, '/');
    const nameBytes = textEncoder.encode(cleanPath);
    const size = data.byteLength;
    const checksum = crc32(data);
    const entryOffset = this.offset;

    const needsZip64Size = size >= 0xffffffff;
    const extraLen = needsZip64Size ? 20 : 0;

    // Local File Header (30 + nameLen + extraLen)
    const header = new Uint8Array(30 + nameBytes.length + extraLen);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); // Local file header signature
    view.setUint16(4, needsZip64Size ? 45 : 20, true); // Version needed (4.5 for ZIP64)
    view.setUint16(6, 0x0800, true); // UTF-8 filename flag
    view.setUint16(8, 0, true); // Compression method: 0 (STORE — instant HTTP Range playback!)
    view.setUint16(10, 0, true); // Mod time
    view.setUint16(12, 0x5421, true); // Mod date
    view.setUint32(14, checksum, true);
    view.setUint32(18, needsZip64Size ? 0xffffffff : size, true);
    view.setUint32(22, needsZip64Size ? 0xffffffff : size, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, extraLen, true);
    header.set(nameBytes, 30);

    if (needsZip64Size) {
      const ePos = 30 + nameBytes.length;
      view.setUint16(ePos, 0x0001, true);
      view.setUint16(ePos + 2, 16, true);
      writeUint64LE(view, ePos + 4, size);
      writeUint64LE(view, ePos + 12, size);
    }

    await this.sink.write(header);
    if (size > 0) {
      await this.sink.write(data);
    }

    this.offset += header.byteLength + size;
    this.entries.push({
      path: cleanPath,
      nameBytes,
      crc: checksum,
      size,
      offset: entryOffset,
    });
  }

  /**
   * Flushes buffered bytes and closes the underlying file stream WITHOUT writing the
   * Central Directory yet, so a future session can seek to `offset` and append remaining files!
   */
  async flushAndSuspend(): Promise<{ offset: number; entries: Zip64EntrySnapshot[] }> {
    await this.sink.close();
    return this.getCheckpointSnapshot();
  }

  async finalize(): Promise<void> {
    const cdStartOffset = this.offset;
    let cdSize = 0;

    for (const e of this.entries) {
      const needSize64 = e.size >= 0xffffffff;
      const needOffset64 = e.offset >= 0xffffffff;
      const extraPayloadLen = (needSize64 ? 16 : 0) + (needOffset64 ? 8 : 0);
      const extraLen = extraPayloadLen > 0 ? 4 + extraPayloadLen : 0;

      const rec = new Uint8Array(46 + e.nameBytes.length + extraLen);
      const view = new DataView(rec.buffer);
      view.setUint32(0, 0x02014b50, true); // Central file header signature
      view.setUint16(4, 45, true); // Version made by
      view.setUint16(6, needSize64 || needOffset64 ? 45 : 20, true); // Version needed
      view.setUint16(8, 0x0800, true); // UTF-8 flag
      view.setUint16(10, 0, true); // Method: STORE
      view.setUint16(12, 0, true);
      view.setUint16(14, 0x5421, true);
      view.setUint32(16, e.crc, true);
      view.setUint32(20, needSize64 ? 0xffffffff : e.size, true);
      view.setUint32(24, needSize64 ? 0xffffffff : e.size, true);
      view.setUint16(28, e.nameBytes.length, true);
      view.setUint16(30, extraLen, true);
      view.setUint16(32, 0, true); // Comment length
      view.setUint16(34, 0, true); // Disk number start
      view.setUint16(36, 0, true); // Internal attrs
      view.setUint32(38, 0, true); // External attrs
      view.setUint32(42, needOffset64 ? 0xffffffff : e.offset, true);
      rec.set(e.nameBytes, 46);

      if (extraLen > 0) {
        let ePos = 46 + e.nameBytes.length;
        view.setUint16(ePos, 0x0001, true);
        view.setUint16(ePos + 2, extraPayloadLen, true);
        ePos += 4;
        if (needSize64) {
          writeUint64LE(view, ePos, e.size);
          writeUint64LE(view, ePos + 8, e.size);
          ePos += 16;
        }
        if (needOffset64) {
          writeUint64LE(view, ePos, e.offset);
        }
      }

      await this.sink.write(rec);
      cdSize += rec.byteLength;
    }

    const count = this.entries.length;
    const useZip64 = count >= 0xffff || cdSize >= 0xffffffff || cdStartOffset >= 0xffffffff;
    const zip64EocdOffset = cdStartOffset + cdSize;

    if (useZip64) {
      // ZIP64 End of Central Directory Record (56 bytes) + Locator (20 bytes)
      const z64 = new Uint8Array(56 + 20);
      const zv = new DataView(z64.buffer);
      zv.setUint32(0, 0x06064b50, true); // ZIP64 EOCD signature
      writeUint64LE(zv, 4, 44); // Size of remaining record
      zv.setUint16(12, 45, true); // Version made by
      zv.setUint16(14, 45, true); // Version needed
      zv.setUint32(16, 0, true); // Disk number
      zv.setUint32(20, 0, true); // Disk with CD
      writeUint64LE(zv, 24, count);
      writeUint64LE(zv, 32, count);
      writeUint64LE(zv, 40, cdSize);
      writeUint64LE(zv, 48, cdStartOffset);

      // ZIP64 EOCD Locator (20 bytes)
      zv.setUint32(56, 0x07064b50, true);
      zv.setUint32(60, 0, true);
      writeUint64LE(zv, 64, zip64EocdOffset);
      zv.setUint32(72, 1, true); // Total disks

      await this.sink.write(z64);
    }

    // Standard EOCD (22 bytes)
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, count >= 0xffff ? 0xffff : count, true);
    ev.setUint16(10, count >= 0xffff ? 0xffff : count, true);
    ev.setUint32(12, cdSize >= 0xffffffff ? 0xffffffff : cdSize, true);
    ev.setUint32(16, cdStartOffset >= 0xffffffff ? 0xffffffff : cdStartOffset, true);
    ev.setUint16(20, 0, true);
    await this.sink.write(eocd);

    await this.sink.close();
  }
}

export function supportsFileSystemSavePicker(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as Record<string, unknown>).showSaveFilePicker === 'function'
  );
}
