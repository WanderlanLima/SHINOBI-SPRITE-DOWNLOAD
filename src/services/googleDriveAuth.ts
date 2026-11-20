import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const GOOGLE_DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
for (const scope of GOOGLE_DRIVE_SCOPES) {
  provider.addScope(scope);
}

let isSigningIn = false;
// Strictly in-memory token cache (never persisted to localStorage/sessionStorage)
let cachedAccessToken: string | null = null;

export interface DriveFileInfo {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  modifiedTime?: string;
}

export function initDriveAuth(
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) {
  return onAuthStateChanged(auth, (user) => {
    if (user) {
      if (cachedAccessToken) {
        onAuthSuccess?.(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        onAuthFailure?.();
      }
    } else {
      cachedAccessToken = null;
      onAuthFailure?.();
    }
  });
}

export async function signInGoogleDrive(): Promise<{ user: User; accessToken: string }> {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Não foi possível obter acesso de leitura ao Google Drive.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
}

export function getDriveAccessToken(): string | null {
  return cachedAccessToken;
}

export async function signOutGoogleDrive(): Promise<void> {
  cachedAccessToken = null;
  await auth.signOut();
}

/**
 * Extrai o ID de arquivo de qualquer link do Google Drive ou aceita o ID direto.
 */
export function extractGoogleDriveFileId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // https://drive.google.com/file/d/<ID>/view?...
  const dMatch = trimmed.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (dMatch) return dMatch[1];

  // https://drive.google.com/open?id=<ID> or uc?id=<ID>
  const idMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (idMatch) return idMatch[1];

  // Raw Drive file ID
  if (/^[a-zA-Z0-9_-]{15,}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export async function fetchDriveFileMetadata(
  fileId: string,
  accessToken: string
): Promise<DriveFileInfo> {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
    fileId
  )}?fields=id,name,size,mimeType,modifiedTime&supportsAllDrives=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) {
    cachedAccessToken = null;
    throw new Error('Sessão do Google Drive expirada. Conecte sua conta Google novamente.');
  }
  if (res.status === 404) {
    throw new Error(
      'Arquivo não encontrado no Google Drive. Verifique se o link está correto e acessível pela conta conectada.'
    );
  }
  if (!res.ok) {
    throw new Error(`Erro ao consultar o Google Drive (HTTP ${res.status}).`);
  }
  const data = (await res.json()) as {
    id: string;
    name?: string;
    size?: string | number;
    mimeType?: string;
    modifiedTime?: string;
  };
  return {
    id: data.id,
    name: data.name || `${fileId}.zip`,
    size: Number(data.size || 0),
    mimeType: data.mimeType || 'application/zip',
    modifiedTime: data.modifiedTime,
  };
}

export async function listDriveZipFiles(accessToken: string): Promise<DriveFileInfo[]> {
  const q = encodeURIComponent(
    "trashed = false and (mimeType = 'application/zip' or mimeType = 'application/x-zip-compressed' or name contains '.zip')"
  );
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime%20desc&pageSize=20&fields=files(id,name,size,mimeType,modifiedTime)&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) {
    cachedAccessToken = null;
    throw new Error('Sessão do Google Drive expirada. Conecte novamente.');
  }
  if (!res.ok) {
    throw new Error(`Não foi possível listar arquivos ZIP no Google Drive (HTTP ${res.status}).`);
  }
  const data = (await res.json()) as {
    files?: Array<{
      id: string;
      name?: string;
      size?: string | number;
      mimeType?: string;
      modifiedTime?: string;
    }>;
  };
  return (data.files || []).map((f) => ({
    id: f.id,
    name: f.name || f.id,
    size: Number(f.size || 0),
    mimeType: f.mimeType || 'application/zip',
    modifiedTime: f.modifiedTime,
  }));
}
