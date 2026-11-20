import { inflateSync } from 'fflate';

export interface ByteRangeSource {
  readonly label: string;
  readonly size: number;
  readRange(start: number, endInclusive: number, signal?: AbortSignal): Promise<Uint8Array>;
}

export interface ZipCentralEntry {
  rawPath: string;
  normalizedPath: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_CENTRAL_DIR = 0x02014b50;
const SIG_LOCAL_FILE = 0x04034b50;

const utf8Decoder = new TextDecoder('utf-8');

function readUint64AsNumber(view: DataView, offset: number): number {
  const low = view.getUint32(offset, true);
  const high = view.getUint32(offset + 4, true);
  return high * 4294967296 + low;
}

export class LocalFileRangeSource implements ByteRangeSource {
  readonly label: string;
  readonly size: number;
  private file: File;

  constructor(file: File) {
    this.file = file;
    this.label = file.name;
    this.size = file.size;
  }

  async readRange(start: number, endInclusive: number): Promise<Uint8Array> {
    const slice = this.file.slice(start, endInclusive + 1);
    const buf = await slice.arrayBuffer();
    return new Uint8Array(buf);
  }
}

export class GoogleDriveRangeSource implements ByteRangeSource {
  readonly label: string;
  readonly size: number;
  private fileId: string;
  private getToken: () => string | null;

  constructor(fileId: string, name: string, size: number, getToken: () => string | null) {
    this.fileId = fileId;
    this.label = name;
    this.size = size;
    this.getToken = getToken;
  }

  async readRange(start: number, endInclusive: number, signal?: AbortSignal): Promise<Uint8Array> {
    const token = this.getToken();
    if (!token) {
      throw new Error('Sessão do Google Drive expirada. Conecte sua conta Google novamente.');
    }
    const clampedEnd = Math.min(this.size - 1, Math.max(start, endInclusive));
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      this.fileId
    )}?alt=media&supportsAllDrives=true`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Range: `bytes=${start}-${clampedEnd}`,
      },
      signal,
    });
    if (res.status === 401) {
      throw new Error('Sessão do Google Drive expirada. Reconecte para continuar carregando.');
    }
    if (!res.ok && res.status !== 206) {
      throw new Error(`Falha ao ler trecho do ZIP no Google Drive (HTTP ${res.status}).`);
    }
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }
}

/**
 * Leitor ZIP / ZIP64 com acesso aleatório via HTTP Range (suporta arquivos de 12,8 GB+ no Google Drive
 * ou disco local lendo apenas o Central Directory no final do arquivo e buscando cada asset sob demanda).
 */
export class RemoteZipReader {
  readonly source: ByteRangeSource;
  readonly entries: ZipCentralEntry[] = [];
  readonly entryMap = new Map<string, ZipCentralEntry>();
  readonly lowerMap = new Map<string, ZipCentralEntry>();
  detectedRootPrefix = '';

  constructor(source: ByteRangeSource) {
    this.source = source;
  }

  async open(onStage?: (stage: string) => void): Promise<void> {
    const fileSize = this.source.size;
    if (fileSize < 22) {
      throw new Error('Arquivo ZIP inválido ou vazio.');
    }

    onStage?.('Lendo cabeçalho final (EOCD / ZIP64) do backup...');
    const tailSize = Math.min(fileSize, 65557);
    const tailStart = fileSize - tailSize;
    const tail = await this.source.readRange(tailStart, fileSize - 1);
    const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);

    // Locate EOCD signature from the end
    let eocdOffsetInTail = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--) {
      if (tailView.getUint32(i, true) === SIG_EOCD) {
        eocdOffsetInTail = i;
        break;
      }
    }
    if (eocdOffsetInTail < 0) {
      throw new Error(
        'Assinatura ZIP não encontrada no arquivo. Verifique se o link aponta para um arquivo .zip válido.'
      );
    }

    let entryCount = tailView.getUint16(eocdOffsetInTail + 10, true);
    let cdSize = tailView.getUint32(eocdOffsetInTail + 12, true);
    let cdOffset = tailView.getUint32(eocdOffsetInTail + 16, true);

    // Check for ZIP64 End of Central Directory Locator right before EOCD
    if (
      entryCount === 0xffff ||
      cdSize === 0xffffffff ||
      cdOffset === 0xffffffff
    ) {
      const locOffsetInTail = eocdOffsetInTail - 20;
      if (
        locOffsetInTail >= 0 &&
        tailView.getUint32(locOffsetInTail, true) === SIG_ZIP64_LOCATOR
      ) {
        const zip64EocdOffset = readUint64AsNumber(tailView, locOffsetInTail + 8);
        const z64Bytes = await this.source.readRange(zip64EocdOffset, zip64EocdOffset + 55);
        const z64View = new DataView(z64Bytes.buffer, z64Bytes.byteOffset, z64Bytes.byteLength);
        if (z64View.getUint32(0, true) !== SIG_ZIP64_EOCD) {
          throw new Error('Cabeçalho ZIP64 inválido.');
        }
        entryCount = readUint64AsNumber(z64View, 32);
        cdSize = readUint64AsNumber(z64View, 40);
        cdOffset = readUint64AsNumber(z64View, 48);
      }
    }

    if (cdSize <= 0 || cdOffset < 0 || cdOffset + cdSize > fileSize) {
      throw new Error('Índice Central Directory do ZIP fora dos limites do arquivo.');
    }

    onStage?.(
      `Baixando índice do ZIP (${entryCount.toLocaleString('pt-BR')} entradas · ${(
        cdSize /
        (1024 * 1024)
      ).toFixed(1)} MB)...`
    );

    const cdBytes = await this.source.readRange(cdOffset, cdOffset + cdSize - 1);
    const cdView = new DataView(cdBytes.buffer, cdBytes.byteOffset, cdBytes.byteLength);

    let pos = 0;
    const rawEntries: Array<{
      rawPath: string;
      method: number;
      compressedSize: number;
      uncompressedSize: number;
      localHeaderOffset: number;
    }> = [];

    while (pos + 46 <= cdBytes.byteLength) {
      const sig = cdView.getUint32(pos, true);
      if (sig !== SIG_CENTRAL_DIR) break;

      const method = cdView.getUint16(pos + 10, true);
      let compressedSize = cdView.getUint32(pos + 20, true);
      let uncompressedSize = cdView.getUint32(pos + 24, true);
      const nameLen = cdView.getUint16(pos + 28, true);
      const extraLen = cdView.getUint16(pos + 30, true);
      const commentLen = cdView.getUint16(pos + 32, true);
      let localHeaderOffset = cdView.getUint32(pos + 42, true);

      const nameBytes = cdBytes.subarray(pos + 46, pos + 46 + nameLen);
      const rawPath = utf8Decoder.decode(nameBytes).replace(/\\/g, '/').replace(/^\/+/, '');

      // Parse ZIP64 Extended Information Extra Field (header ID 0x0001)
      if (
        extraLen > 0 &&
        (compressedSize === 0xffffffff ||
          uncompressedSize === 0xffffffff ||
          localHeaderOffset === 0xffffffff)
      ) {
        let ePos = pos + 46 + nameLen;
        const eEnd = ePos + extraLen;
        while (ePos + 4 <= eEnd) {
          const headerId = cdView.getUint16(ePos, true);
          const dataSize = cdView.getUint16(ePos + 2, true);
          if (headerId === 0x0001) {
            let fieldPos = ePos + 4;
            if (uncompressedSize === 0xffffffff && fieldPos + 8 <= ePos + 4 + dataSize) {
              uncompressedSize = readUint64AsNumber(cdView, fieldPos);
              fieldPos += 8;
            }
            if (compressedSize === 0xffffffff && fieldPos + 8 <= ePos + 4 + dataSize) {
              compressedSize = readUint64AsNumber(cdView, fieldPos);
              fieldPos += 8;
            }
            if (localHeaderOffset === 0xffffffff && fieldPos + 8 <= ePos + 4 + dataSize) {
              localHeaderOffset = readUint64AsNumber(cdView, fieldPos);
            }
            break;
          }
          ePos += 4 + dataSize;
        }
      }

      pos += 46 + nameLen + extraLen + commentLen;

      if (!rawPath || rawPath.endsWith('/')) continue;
      rawEntries.push({
        rawPath,
        method,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });
    }

    // Detect if all entries share a single wrapper folder (e.g. "naruto_jotagame_backup/acervo/...")
    let commonPrefix = '';
    const firstSlashes = new Set<string>();
    for (const e of rawEntries) {
      const idx = e.rawPath.indexOf('/');
      if (idx > 0) {
        firstSlashes.add(e.rawPath.slice(0, idx + 1));
      } else {
        firstSlashes.add('');
      }
      if (firstSlashes.size > 1) break;
    }
    if (firstSlashes.size === 1) {
      const only = [...firstSlashes][0];
      if (
        only &&
        only !== 'acervo/' &&
        only !== 'dados/' &&
        only !== 'd/'
      ) {
        commonPrefix = only;
      }
    }
    this.detectedRootPrefix = commonPrefix;

    this.entries.length = 0;
    this.entryMap.clear();
    this.lowerMap.clear();

    for (const r of rawEntries) {
      const normalizedPath = commonPrefix && r.rawPath.startsWith(commonPrefix)
        ? r.rawPath.slice(commonPrefix.length)
        : r.rawPath;
      const entry: ZipCentralEntry = {
        ...r,
        normalizedPath,
      };
      this.entries.push(entry);
      this.entryMap.set(normalizedPath, entry);
      this.lowerMap.set(normalizedPath.toLowerCase(), entry);
    }

    onStage?.(`Índice pronto (${this.entries.length.toLocaleString('pt-BR')} arquivos prontos para streaming).`);
  }

  findEntry(relPath: string): ZipCentralEntry | null {
    const clean = relPath.replace(/^\/+/, '').replace(/\\/g, '/');
    return this.entryMap.get(clean) || this.lowerMap.get(clean.toLowerCase()) || null;
  }

  hasEntry(relPath: string): boolean {
    return this.findEntry(relPath) !== null;
  }

  async readEntryBytes(entry: ZipCentralEntry, signal?: AbortSignal): Promise<Uint8Array> {
    // Prefetch local header + compressed payload in a single HTTP Range call!
    const headerSlack = 512;
    const reqEnd = Math.min(
      this.source.size - 1,
      entry.localHeaderOffset + 30 + entry.rawPath.length + headerSlack + entry.compressedSize
    );
    const chunk = await this.source.readRange(entry.localHeaderOffset, reqEnd, signal);
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);

    if (chunk.byteLength < 30 || view.getUint32(0, true) !== SIG_LOCAL_FILE) {
      throw new Error(`Cabeçalho local corrompido para ${entry.normalizedPath}`);
    }
    const localNameLen = view.getUint16(26, true);
    const localExtraLen = view.getUint16(28, true);
    const dataOffsetInChunk = 30 + localNameLen + localExtraLen;
    const dataEndInChunk = dataOffsetInChunk + entry.compressedSize;

    let compressed: Uint8Array;
    if (dataEndInChunk <= chunk.byteLength) {
      compressed = chunk.subarray(dataOffsetInChunk, dataEndInChunk);
    } else {
      const absStart = entry.localHeaderOffset + dataOffsetInChunk;
      compressed = await this.source.readRange(
        absStart,
        absStart + entry.compressedSize - 1,
        signal
      );
    }

    if (entry.method === 0) {
      return compressed;
    }
    if (entry.method === 8) {
      return inflateSync(compressed);
    }
    throw new Error(`Método de compressão ZIP não suportado (${entry.method}) em ${entry.normalizedPath}`);
  }

  async readFileBytes(relPath: string, signal?: AbortSignal): Promise<Uint8Array> {
    const entry = this.findEntry(relPath);
    if (!entry) {
      throw new Error(`Arquivo não encontrado no backup ZIP: ${relPath}`);
    }
    return this.readEntryBytes(entry, signal);
  }

  async readFileText(relPath: string, signal?: AbortSignal): Promise<string> {
    const bytes = await this.readFileBytes(relPath, signal);
    return utf8Decoder.decode(bytes);
  }
}
