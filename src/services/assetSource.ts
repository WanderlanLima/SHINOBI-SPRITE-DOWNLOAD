import { useEffect, useState } from 'react';
import type { RemoteZipReader } from './remoteZipReader';

export const ZIP_BACKUP_PREFIX = 'zip-backup://';

export interface ActiveBackupInfo {
  mode: 'cdn' | 'gdrive_zip' | 'local_zip';
  label: string;
  driveFileId?: string;
  driveUrl?: string;
  fileSize?: number;
  entryCount?: number;
}

let activeZipReader: RemoteZipReader | null = null;
let activeBackupInfo: ActiveBackupInfo = {
  mode: 'cdn',
  label: 'Servidor Oficial (cdn.jotagame.com)',
};

// Bounded LRU cache for generated blob: URLs so memory stays low even during heavy browsing
const MAX_BLOB_CACHE = 420;
const blobUrlCache = new Map<string, string>();
const pendingUrlLoads = new Map<string, Promise<string>>();

export function isZipBackupUrl(url: string | null | undefined): boolean {
  return Boolean(url && url.startsWith(ZIP_BACKUP_PREFIX));
}

export function stripZipBackupPrefix(url: string): string {
  return url.slice(ZIP_BACKUP_PREFIX.length).replace(/^\/+/, '');
}

export function getActiveZipReader(): RemoteZipReader | null {
  return activeZipReader;
}

export function getActiveBackupInfo(): ActiveBackupInfo {
  return activeBackupInfo;
}

export function clearBlobUrlCache(): void {
  for (const blobUrl of blobUrlCache.values()) {
    URL.revokeObjectURL(blobUrl);
  }
  blobUrlCache.clear();
  pendingUrlLoads.clear();
}

export function setActiveZipBackup(reader: RemoteZipReader, info: ActiveBackupInfo): void {
  clearBlobUrlCache();
  activeZipReader = reader;
  activeBackupInfo = info;
}

export function clearActiveZipBackup(): void {
  clearBlobUrlCache();
  activeZipReader = null;
  activeBackupInfo = {
    mode: 'cdn',
    label: 'Servidor Oficial (cdn.jotagame.com)',
  };
}

export function guessMimeType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.ttf')) return 'font/ttf';
  if (lower.endsWith('.woff2')) return 'font/woff2';
  if (lower.endsWith('.atlas') || lower.endsWith('.fnt') || lower.endsWith('.txt')) {
    return 'text/plain;charset=utf-8';
  }
  return 'application/octet-stream';
}

function findEntryWithExtFallback(reader: RemoteZipReader, relPath: string) {
  const exact = reader.findEntry(relPath);
  if (exact) return exact;
  if (/\.png$/i.test(relPath)) {
    return reader.findEntry(relPath.replace(/\.png$/i, '.webp'));
  }
  if (/\.webp$/i.test(relPath)) {
    return reader.findEntry(relPath.replace(/\.webp$/i, '.png'));
  }
  return null;
}

export interface FetchAssetOptions {
  timeoutMs?: number;
  noStore?: boolean;
}

export async function fetchAssetBytes(
  cdnBase: string,
  relUrl: string,
  signal?: AbortSignal,
  options?: FetchAssetOptions
): Promise<Uint8Array> {
  const cleanRel = relUrl.replace(/^\/+/, '');
  if (cdnBase.startsWith(ZIP_BACKUP_PREFIX) || relUrl.startsWith(ZIP_BACKUP_PREFIX)) {
    const reader = activeZipReader;
    if (!reader) throw new Error('Nenhum arquivo ZIP de backup está montado.');
    const path = relUrl.startsWith(ZIP_BACKUP_PREFIX) ? stripZipBackupPrefix(relUrl) : cleanRel;
    const entry = findEntryWithExtFallback(reader, path);
    if (!entry) throw new Error(`Arquivo ausente no backup ZIP: ${path}`);
    return reader.readEntryBytes(entry, signal);
  }

  const fullUrl = /^https?:\/\//i.test(relUrl)
    ? relUrl
    : `${cdnBase.replace(/\/?$/, '/')}${cleanRel}`;

  const timeoutMs = options?.timeoutMs;
  if (!timeoutMs) {
    const res = await fetch(fullUrl, {
      signal,
      cache: options?.noStore ? 'no-store' : undefined,
    });
    if (!res.ok) {
      throw new Error(`Falha ao carregar ${cleanRel} (HTTP ${res.status}).`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  const timeoutCtrl = new AbortController();
  let timedOut = false;
  const onOuterAbort = () => timeoutCtrl.abort();
  if (signal) {
    if (signal.aborted) {
      throw new DOMException('Requisição cancelada.', 'AbortError');
    }
    signal.addEventListener('abort', onOuterAbort, { once: true });
  }
  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    timeoutCtrl.abort();
  }, timeoutMs);

  try {
    const res = await fetch(fullUrl, {
      signal: timeoutCtrl.signal,
      cache: options?.noStore ? 'no-store' : undefined,
    });
    if (!res.ok) {
      const err = new Error(`Falha ao carregar ${cleanRel} (HTTP ${res.status}).`) as Error & {
        status?: number;
      };
      err.status = res.status;
      throw err;
    }
    // Also guard arrayBuffer() reading inside the same timeout window!
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch (err) {
    if (timedOut) {
      throw new Error(`Timeout (${Math.round(timeoutMs / 1000)}s) ao baixar ${cleanRel}`);
    }
    throw err;
  } finally {
    globalThis.clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onOuterAbort);
  }
}

/**
 * Baixa um asset com timeout por tentativa, bypass de cache HTTP (`no-store` evita travar o cache
 * do navegador em backups de 12 GB+) e retentativas automáticas com backoff exponencial.
 */
export async function fetchAssetBytesWithRetry(
  cdnBase: string,
  relUrl: string,
  opts: {
    signal?: AbortSignal;
    timeoutMs?: number;
    maxRetries?: number;
    noStore?: boolean;
  } = {}
): Promise<Uint8Array> {
  const { signal, timeoutMs = 18000, maxRetries = 3, noStore = true } = opts;
  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) {
      throw new DOMException('Download cancelado.', 'AbortError');
    }
    try {
      return await fetchAssetBytes(cdnBase, relUrl, signal, {
        // Increase timeout slightly on retries for larger video/atlas files
        timeoutMs: timeoutMs + attempt * 8000,
        noStore,
      });
    } catch (err) {
      if (signal?.aborted || (err as Error)?.name === 'AbortError') {
        throw err;
      }
      lastErr = err;
      const status = (err as { status?: number })?.status;
      // Don't retry permanent 404/403 client errors
      if (status === 404 || status === 403) break;
      if (attempt < maxRetries) {
        const delay = Math.min(4000, 350 * Math.pow(2, attempt) + Math.random() * 250);
        await new Promise<void>((resolve) => {
          const t = globalThis.setTimeout(resolve, delay);
          if (signal) {
            signal.addEventListener(
              'abort',
              () => {
                globalThis.clearTimeout(t);
                resolve();
              },
              { once: true }
            );
          }
        });
      }
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(`Falha ao baixar ${relUrl}`);
}

export async function fetchAssetText(
  cdnBase: string,
  relUrl: string,
  signal?: AbortSignal
): Promise<string> {
  const bytes = await fetchAssetBytes(cdnBase, relUrl, signal);
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Resolve uma URL (`https://...` ou `zip-backup://...`) em uma URL utilizável por `<img>`, `<audio>`, `<video>`, `<a>`.
 */
export async function resolvePlayableUrl(url: string): Promise<string> {
  if (!url || !isZipBackupUrl(url)) return url;
  const relPath = stripZipBackupPrefix(url);

  const cached = blobUrlCache.get(relPath);
  if (cached) {
    // Refresh LRU order
    blobUrlCache.delete(relPath);
    blobUrlCache.set(relPath, cached);
    return cached;
  }

  const inflight = pendingUrlLoads.get(relPath);
  if (inflight) return inflight;

  const reader = activeZipReader;
  if (!reader) return '';

  const promise = (async () => {
    try {
      const entry = findEntryWithExtFallback(reader, relPath);
      if (!entry) return '';
      const bytes = await reader.readEntryBytes(entry);
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const blob = new Blob([copy], { type: guessMimeType(entry.normalizedPath) });
      const objUrl = URL.createObjectURL(blob);

      if (blobUrlCache.size >= MAX_BLOB_CACHE) {
        const oldestKey = blobUrlCache.keys().next().value;
        if (oldestKey) {
          const oldestVal = blobUrlCache.get(oldestKey);
          if (oldestVal) URL.revokeObjectURL(oldestVal);
          blobUrlCache.delete(oldestKey);
        }
      }
      blobUrlCache.set(relPath, objUrl);
      return objUrl;
    } catch {
      return '';
    } finally {
      pendingUrlLoads.delete(relPath);
    }
  })();

  pendingUrlLoads.set(relPath, promise);
  return promise;
}

/**
 * Carrega HTMLImageElement tanto do CDN ao vivo (com fallback .png <-> .webp) quanto do backup ZIP!
 */
export async function loadImageWithFallback(url: string): Promise<HTMLImageElement | null> {
  if (!url) return null;

  if (isZipBackupUrl(url)) {
    const resolved = await resolvePlayableUrl(url);
    if (!resolved) return null;
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = resolved;
    });
  }

  return new Promise((resolve) => {
    const attempt = (src: string, triedFallback: boolean) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.referrerPolicy = 'no-referrer';
      img.onload = () => resolve(img);
      img.onerror = () => {
        if (!triedFallback) {
          if (/\.png(\?|$)/i.test(src)) {
            attempt(src.replace(/\.png(\?|$)/i, '.webp$1'), true);
            return;
          }
          if (/\.webp(\?|$)/i.test(src)) {
            attempt(src.replace(/\.webp(\?|$)/i, '.png$1'), true);
            return;
          }
        }
        resolve(null);
      };
      img.src = src;
    };
    attempt(url, false);
  });
}

/**
 * Hook React para resolver URLs `zip-backup://` em `blob:` automaticamente (e retornar URL normal no modo CDN).
 */
export function useResolvedAssetUrl(url: string | null | undefined): string {
  const [resolved, setResolved] = useState<string>(() =>
    url && !isZipBackupUrl(url) ? url : ''
  );

  useEffect(() => {
    if (!url) {
      setResolved('');
      return;
    }
    if (!isZipBackupUrl(url)) {
      setResolved(url);
      return;
    }
    let cancelled = false;
    resolvePlayableUrl(url).then((next) => {
      if (!cancelled) setResolved(next);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return resolved;
}

/**
 * Dispara o download de um arquivo tanto do CDN quanto de um ZIP de backup montado (`zip-backup://`).
 */
export async function triggerAssetDownload(url: string, filename: string): Promise<void> {
  if (!url) return;
  const resolved = isZipBackupUrl(url) ? await resolvePlayableUrl(url) : url;
  if (!resolved) return;

  const a = document.createElement('a');
  a.href = resolved;
  a.download = filename;
  if (!isZipBackupUrl(url)) {
    a.target = '_blank';
    a.rel = 'noreferrer';
  }
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

