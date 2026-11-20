import type { Zip64EntrySnapshot } from './zip64Stream';

export type MirrorStorageMode = 'opfs' | 'direct_disk';

export interface MirrorBackupCheckpoint {
  id: string;
  scope: 'full_all' | 'full_webp' | 'core_playable' | 'quick_test';
  storageMode: MirrorStorageMode;
  filename: string;
  /** Nome do arquivo dentro do Origin Private File System (OPFS) quando storageMode === 'opfs' */
  opfsFileName?: string;
  /** FileSystemFileHandle (usado quando storageMode === 'direct_disk') */
  handle?: any;
  /** true quando o ZIP64 já foi 100% finalizado no OPFS e aguarda apenas ser salvo na pasta escolhida */
  readyToExport?: boolean;
  offset: number;
  entries: Zip64EntrySnapshot[];
  failedUrls: string[];
  bytesDownloaded: number;
  totalFiles: number;
  totalBytes: number;
  updatedAt: number;
}

const DB_NAME = 'shinobi_vault_backup_checkpoints_v1';
const STORE_NAME = 'checkpoints';
const CHECKPOINT_KEY = 'active_mirror_zip64';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponível neste navegador.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Erro ao abrir IndexedDB.'));
  });
}

export async function saveMirrorCheckpoint(
  checkpoint: Omit<MirrorBackupCheckpoint, 'id' | 'updatedAt'>
): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({
        ...checkpoint,
        id: CHECKPOINT_KEY,
        updatedAt: Date.now(),
      } as MirrorBackupCheckpoint);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore storage quota or private browsing errors gracefully
  }
}

export async function loadMirrorCheckpoint(): Promise<MirrorBackupCheckpoint | null> {
  try {
    const db = await openDb();
    const record = await new Promise<MirrorBackupCheckpoint | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(CHECKPOINT_KEY);
      req.onsuccess = () => resolve((req.result as MirrorBackupCheckpoint) || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!record) return null;
    // Normalize older checkpoints created before storageMode was introduced
    return {
      ...record,
      storageMode: record.storageMode || 'direct_disk',
    };
  } catch {
    return null;
  }
}

export async function clearMirrorCheckpoint(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(CHECKPOINT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
}
