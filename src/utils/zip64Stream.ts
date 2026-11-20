/**
 * Streaming ZIP64 writer (STORE / method 0) — supports archives larger than 4 GB (e.g. 12.8 GB+)
 * with constant RAM usage when paired with File System Access API (showSaveFilePicker),
 * and produces 100% random-access Range-friendly ZIP files ideal for Google Drive backup!
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const textEncoder = new TextEncoder();

interface Zip64CentralEntry {
  nameBytes: Uint8Array;
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
  close(): Promise<void>;
}

export class MemoryBufferSink implements StreamingZip64Sink {
  private chunks: BlobPart[] = [];

  async write(chunk: Uint8Array): Promise<void> {
    const copy = new Uint8Array(chunk.byteLength);
    copy.set(chunk);
    this.chunks.push(copy);
  }

  async close(): Promise<void> {
    // nothing to flush
  }

  toBlob(): Blob {
    return new Blob(this.chunks, { type: 'application/zip' });
  }
}

export class FileSystemWritableSink implements StreamingZip64Sink {
  private writable: {
    write(data: Uint8Array): Promise<void>;
    close(): Promise<void>;
  };

  constructor(writable: { write(data: Uint8Array): Promise<void>; close(): Promise<void> }) {
    this.writable = writable;
  }

  async write(chunk: Uint8Array): Promise<void> {
    await this.writable.write(chunk);
  }

  async close(): Promise<void> {
    await this.writable.close();
  }
}

export class StreamingZip64Writer {
  private sink: StreamingZip64Sink;
  private entries: Zip64CentralEntry[] = [];
  private offset = 0;

  constructor(sink: StreamingZip64Sink) {
    this.sink = sink;
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
      nameBytes,
      crc: checksum,
      size,
      offset: entryOffset,
    });
  }

  async finalize(): Promise<void> {
    const cdStartOffset = this.offset;
    let cdSize = 0;

    // Write Central Directory records in batches to keep writes fast and RAM tiny
    const batchChunks: Uint8Array[] = [];
    let batchBytes = 0;

    const flushBatch = async () => {
      if (batchChunks.length === 0) return;
      const merged = new Uint8Array(batchBytes);
      let p = 0;
      for (const c of batchChunks) {
        merged.set(c, p);
        p += c.byteLength;
      }
      await this.sink.write(merged);
      batchChunks.length = 0;
      batchBytes = 0;
    };

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

      batchChunks.push(rec);
      batchBytes += rec.byteLength;
      cdSize += rec.byteLength;

      if (batchBytes >= 512 * 1024) {
        await flushBatch();
      }
    }
    await flushBatch();

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
  return typeof window !== 'undefined' && typeof (window as unknown as Record<string, unknown>).showSaveFilePicker === 'function';
}
