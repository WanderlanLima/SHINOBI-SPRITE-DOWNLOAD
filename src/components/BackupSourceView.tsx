import type { User } from 'firebase/auth';
import {
  CheckCircle2,
  Cloud,
  Database,
  FileArchive,
  FolderOpen,
  HardDrive,
  Link2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Wifi,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  type ActiveBackupInfo,
  setActiveZipBackup,
} from '../services/assetSource';
import {
  type FullCatalog,
  loadCatalogFromZipArchive,
} from '../services/catalogEngine';
import {
  type DriveFileInfo,
  extractGoogleDriveFileId,
  fetchDriveFileMetadata,
  getDriveAccessToken,
  initDriveAuth,
  listDriveZipFiles,
  signInGoogleDrive,
  signOutGoogleDrive,
} from '../services/googleDriveAuth';
import {
  GoogleDriveRangeSource,
  LocalFileRangeSource,
  RemoteZipReader,
} from '../services/remoteZipReader';
import { formatBytes, formatNumber } from '../utils/format';

interface BackupSourceViewProps {
  activeSource: ActiveBackupInfo;
  onCatalogLoaded: (catalog: FullCatalog, sourceInfo: ActiveBackupInfo) => void;
  onRestoreLiveCdn: () => void;
  onGoToSingleExport: () => void;
}

const SAVED_DRIVE_LINK_KEY = 'shinobi_vault_last_gdrive_link_v1';

export function BackupSourceView({
  activeSource,
  onCatalogLoaded,
  onRestoreLiveCdn,
  onGoToSingleExport,
}: BackupSourceViewProps) {
  const [driveUser, setDriveUser] = useState<User | null>(null);
  const [hasToken, setHasToken] = useState<boolean>(() => Boolean(getDriveAccessToken()));
  const [signingIn, setSigningIn] = useState(false);

  const [driveInput, setDriveInput] = useState<string>(() => {
    try {
      return localStorage.getItem(SAVED_DRIVE_LINK_KEY) || '';
    } catch {
      return '';
    }
  });
  const [driveFiles, setDriveFiles] = useState<DriveFileInfo[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  const [mounting, setMounting] = useState(false);
  const [mountStage, setMountStage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return initDriveAuth(
      (user) => {
        setDriveUser(user);
        setHasToken(true);
      },
      () => {
        setDriveUser(null);
        setHasToken(false);
      }
    );
  }, []);

  const refreshDriveFiles = async (tokenOverride?: string) => {
    const token = tokenOverride || getDriveAccessToken();
    if (!token) return;
    setLoadingList(true);
    setError(null);
    try {
      const list = await listDriveZipFiles(token);
      setDriveFiles(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao listar arquivos no Google Drive.');
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    if (hasToken) {
      refreshDriveFiles();
    }
  }, [hasToken]);

  const handleGoogleLogin = async () => {
    setSigningIn(true);
    setError(null);
    try {
      const res = await signInGoogleDrive();
      setDriveUser(res.user);
      setHasToken(true);
      await refreshDriveFiles(res.accessToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao conectar com o Google Drive.');
    } finally {
      setSigningIn(false);
    }
  };

  const handleGoogleLogout = async () => {
    await signOutGoogleDrive();
    setDriveUser(null);
    setHasToken(false);
    setDriveFiles([]);
  };

  const mountDriveFileById = async (fileId: string, originalLink?: string) => {
    let token = getDriveAccessToken();
    if (!token) {
      setError('Conecte sua conta Google primeiro para ler o arquivo ZIP no Google Drive.');
      return;
    }

    setMounting(true);
    setError(null);
    setSuccessMsg(null);
    setMountStage('Consultando metadados do arquivo no Google Drive...');

    try {
      const meta = await fetchDriveFileMetadata(fileId, token);
      if (!meta.size || meta.size < 22) {
        throw new Error('Este arquivo no Google Drive parece vazio ou não é um arquivo ZIP.');
      }

      const rangeSource = new GoogleDriveRangeSource(
        meta.id,
        meta.name,
        meta.size,
        () => getDriveAccessToken()
      );
      const reader = new RemoteZipReader(rangeSource);
      await reader.open((stage) => setMountStage(stage));

      const info: ActiveBackupInfo = {
        mode: 'gdrive_zip',
        label: meta.name,
        driveFileId: meta.id,
        driveUrl: originalLink || `https://drive.google.com/file/d/${meta.id}/view`,
        fileSize: meta.size,
        entryCount: reader.entries.length,
      };

      setActiveZipBackup(reader, info);
      const nextCatalog = await loadCatalogFromZipArchive(reader, (stage) => setMountStage(stage));

      try {
        localStorage.setItem(SAVED_DRIVE_LINK_KEY, info.driveUrl || meta.id);
      } catch {
        // ignore storage quota errors
      }

      onCatalogLoaded(nextCatalog, info);
      setSuccessMsg(
        `Backup "${meta.name}" (${formatBytes(meta.size)}) montado com sucesso via Google Drive! ${formatNumber(
          reader.entries.length
        )} arquivos indexados em streaming sob demanda.`
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Erro ao montar o arquivo ZIP do Google Drive.'
      );
    } finally {
      setMounting(false);
      setMountStage('');
    }
  };

  const handleMountFromLink = async () => {
    const fileId = extractGoogleDriveFileId(driveInput);
    if (!fileId) {
      setError(
        'Link ou ID do Google Drive inválido. Cole um endereço como https://drive.google.com/file/d/SEU_ID/view'
      );
      return;
    }
    await mountDriveFileById(fileId, driveInput.trim());
  };

  const handleMountLocalZip = async (file: File | null) => {
    if (!file) return;
    setMounting(true);
    setError(null);
    setSuccessMsg(null);
    setMountStage(`Lendo índice do arquivo local ${file.name}...`);

    try {
      const rangeSource = new LocalFileRangeSource(file);
      const reader = new RemoteZipReader(rangeSource);
      await reader.open((stage) => setMountStage(stage));

      const info: ActiveBackupInfo = {
        mode: 'local_zip',
        label: file.name,
        fileSize: file.size,
        entryCount: reader.entries.length,
      };

      setActiveZipBackup(reader, info);
      const nextCatalog = await loadCatalogFromZipArchive(reader, (stage) => setMountStage(stage));
      onCatalogLoaded(nextCatalog, info);
      setSuccessMsg(
        `Backup local "${file.name}" (${formatBytes(file.size)}) ativado com ${formatNumber(
          reader.entries.length
        )} arquivos!`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao abrir arquivo ZIP local.');
    } finally {
      setMounting(false);
      setMountStage('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-[#1E2331]">
        <div>
          <h1 className="text-xl font-semibold text-white">
            Fonte de Dados e Backup no Google Drive
          </h1>
          <p className="text-sm text-[#98A1B5] mt-1 max-w-3xl">
            Caso <span className="font-mono text-white">naruto.jotagame.com</span> fique fora do ar
            ou bloqueie o acesso, direcione o link do seu arquivo ZIP único no Google Drive (ou um
            ZIP local) para alimentar todo o aplicativo em tempo real, sem precisar baixar os 12,8 GB
            de volta.
          </p>
        </div>

        <button
          onClick={onGoToSingleExport}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-[#1F2536] hover:bg-[#EA580C] rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <FileArchive className="w-4 h-4" />
          Criar ZIP Único de Backup
        </button>
      </div>

      {/* Active Data Source Banner */}
      <div
        className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
          activeSource.mode === 'cdn'
            ? 'bg-[#13161F] border-[#222736]'
            : 'bg-[#111A16] border-[#1E4432]'
        }`}
      >
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
              activeSource.mode === 'cdn'
                ? 'bg-[#1C2233] text-[#F97316]'
                : 'bg-[#16A34A]/20 text-[#86EFAC]'
            }`}
          >
            {activeSource.mode === 'cdn' ? (
              <Wifi className="w-5 h-5" />
            ) : activeSource.mode === 'gdrive_zip' ? (
              <Cloud className="w-5 h-5" />
            ) : (
              <HardDrive className="w-5 h-5" />
            )}
          </div>
          <div className="min-w-0">
            <div className="text-xs text-[#8E97AB]">Fonte de Dados Ativa Agora</div>
            <div className="text-sm font-semibold text-white truncate mt-0.5">
              {activeSource.label}
            </div>
            <div className="text-xs font-mono tabular-nums text-[#9CA5B9] mt-0.5">
              {activeSource.mode === 'cdn'
                ? 'Modo Online · Lendo arquivos diretamente do servidor oficial do jogo'
                : `Modo Backup ZIP · ${formatNumber(activeSource.entryCount || 0)} arquivos · ${formatBytes(
                    activeSource.fileSize || 0
                  )} (leitura sob demanda)`}
            </div>
          </div>
        </div>

        {activeSource.mode !== 'cdn' && (
          <button
            onClick={onRestoreLiveCdn}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-white bg-[#1F2536] hover:bg-[#2A334B] rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Wifi className="w-3.5 h-3.5" />
            Voltar para Servidor Oficial
          </button>
        )}
      </div>

      {/* Status Messages */}
      {mounting && (
        <div className="p-4 bg-[#151924] border border-[#EA580C]/50 rounded-xl flex items-center gap-3 text-xs text-white">
          <RefreshCw className="w-4 h-4 text-[#F97316] animate-spin shrink-0" />
          <span>{mountStage || 'Montando arquivo ZIP de backup...'}</span>
        </div>
      )}

      {error && (
        <div className="p-4 bg-[#1F1215] border border-[#4C1D24] rounded-xl text-xs text-[#FCA5A5]">
          {error}
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-[#111C16] border border-[#1E4432] rounded-xl flex items-start gap-2.5 text-xs text-[#86EFAC]">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Main Grid: Google Drive (left) + Local ZIP & Info (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Google Drive Backup Card */}
        <div className="lg:col-span-7 bg-[#13161F] border border-[#222736] rounded-xl p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#1E2331]">
            <div className="flex items-center gap-2.5">
              <Cloud className="w-5 h-5 text-[#F97316]" />
              <div>
                <h2 className="text-sm font-semibold text-white">
                  1. Conectar Backup ZIP no Google Drive
                </h2>
                <p className="text-xs text-[#8E97AB]">
                  Leitura direta por trechos (HTTP Range) — suporta backups ZIP64 de até 12,8 GB+
                </p>
              </div>
            </div>

            {hasToken && driveUser ? (
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-[#86EFAC] truncate max-w-[180px]">
                  {driveUser.email || driveUser.displayName || 'Conectado'}
                </span>
                <button
                  onClick={handleGoogleLogout}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-[#A8B1C6] hover:text-white bg-[#1A1F2C] rounded-lg"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sair
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={signingIn}
                className="inline-flex items-center gap-2.5 px-4 py-2 bg-white hover:bg-[#F3F4F6] text-[#1F1F1F] text-xs font-medium rounded-lg border border-[#DADCE0] transition-colors disabled:opacity-60 whitespace-nowrap"
              >
                <svg
                  className="w-4 h-4 shrink-0"
                  viewBox="0 0 48 48"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                >
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  />
                </svg>
                <span>{signingIn ? 'Conectando...' : 'Sign in with Google'}</span>
              </button>
            )}
          </div>

          {/* Paste Google Drive Link */}
          <div className="space-y-2.5">
            <label className="block text-xs font-medium text-[#D7DCE8]">
              Endereço (link) ou ID do arquivo ZIP no Google Drive
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Link2 className="w-4 h-4 text-[#7C859B] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={driveInput}
                  onChange={(e) => setDriveInput(e.target.value)}
                  placeholder="https://drive.google.com/file/d/SEU_ID_AQUI/view?usp=sharing"
                  className="w-full pl-9 pr-3 py-2.5 text-xs font-mono bg-[#0F1219] border border-[#252B3B] focus:border-[#EA580C] rounded-lg text-white placeholder-[#6E778C] outline-none"
                />
              </div>
              <button
                onClick={handleMountFromLink}
                disabled={mounting || !hasToken || !driveInput.trim()}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-[#EA580C] hover:bg-[#C2410C] disabled:opacity-45 rounded-lg transition-colors whitespace-nowrap"
              >
                <Database className="w-3.5 h-3.5" />
                Carregar Backup
              </button>
            </div>
            {!hasToken && (
              <p className="text-[11px] text-[#8E97AB]">
                Clique em <strong className="text-white">Sign in with Google</strong> acima para
                autorizar a leitura somente-leitura do arquivo ZIP no seu Google Drive.
              </p>
            )}
          </div>

          {/* Recent ZIP files in Google Drive */}
          {hasToken && (
            <div className="space-y-2.5 pt-3 border-t border-[#1E2331]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#D7DCE8]">
                  Arquivos .zip encontrados no seu Google Drive
                </span>
                <button
                  onClick={() => refreshDriveFiles()}
                  disabled={loadingList}
                  className="inline-flex items-center gap-1 text-[11px] text-[#9CA5B9] hover:text-white"
                >
                  <RefreshCw className={`w-3 h-3 ${loadingList ? 'animate-spin' : ''}`} />
                  Atualizar lista
                </button>
              </div>

              {loadingList ? (
                <div className="py-6 text-center text-xs text-[#8E97AB]">
                  Buscando arquivos .zip no Google Drive...
                </div>
              ) : driveFiles.length === 0 ? (
                <div className="p-4 bg-[#0F1219] border border-[#222736] rounded-lg text-xs text-[#8E97AB]">
                  Nenhum arquivo <span className="font-mono text-white">.zip</span> encontrado na
                  sua conta. Você ainda pode colar diretamente o link de um ZIP compartilhado acima.
                </div>
              ) : (
                <div className="divide-y divide-[#1C2130] border border-[#222736] rounded-lg bg-[#0F1219] max-h-64 overflow-y-auto">
                  {driveFiles.map((f) => {
                    const isCurrent = activeSource.driveFileId === f.id;
                    return (
                      <div
                        key={f.id}
                        className="px-3.5 py-2.5 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-mono text-white truncate" title={f.name}>
                            {f.name}
                          </div>
                          <div className="text-[11px] font-mono tabular-nums text-[#7C859B] mt-0.5">
                            {formatBytes(f.size)} · ID {f.id.slice(0, 12)}...
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            const link = `https://drive.google.com/file/d/${f.id}/view`;
                            setDriveInput(link);
                            mountDriveFileById(f.id, link);
                          }}
                          disabled={mounting}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                            isCurrent
                              ? 'bg-[#16A34A]/20 text-[#86EFAC]'
                              : 'bg-[#1F2536] hover:bg-[#EA580C] text-white'
                          }`}
                        >
                          {isCurrent ? 'Ativo' : 'Usar este ZIP'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Local ZIP Mount + How It Works */}
        <div className="lg:col-span-5 space-y-5">
          {/* Local ZIP Backup */}
          <div className="bg-[#13161F] border border-[#222736] rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <HardDrive className="w-5 h-5 text-[#F97316]" />
              <div>
                <h2 className="text-sm font-semibold text-white">
                  2. Abrir Backup ZIP Local (100% Offline)
                </h2>
                <p className="text-xs text-[#8E97AB]">
                  Teste ou use um backup salvo no seu PC ou celular sem gastar internet
                </p>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(e) => handleMountLocalZip(e.target.files?.[0] || null)}
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={mounting}
              className="w-full py-3 px-4 border border-dashed border-[#343D56] hover:border-[#EA580C] bg-[#0F1219] hover:bg-[#151A26] rounded-xl flex items-center justify-center gap-2 text-xs font-medium text-white transition-colors"
            >
              <FolderOpen className="w-4 h-4 text-[#F97316]" />
              Selecionar Arquivo .zip do Dispositivo
            </button>
          </div>

          {/* Architecture / Compatibility Explanation */}
          <div className="bg-[#13161F] border border-[#222736] rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <ShieldCheck className="w-4 h-4 text-[#F97316]" />
              <span>Estrutura Compatível com Preservação Permanente</span>
            </div>
            <p className="text-xs text-[#98A1B5] leading-relaxed">
              Quando você exporta usando o modo{' '}
              <strong className="text-white">Backup Único (Estrutura Original do Jogo)</strong>, o
              arquivo <span className="font-mono text-[#FB923C]">.zip</span> guarda exatamente os
              mesmos diretórios de <span className="font-mono text-white">naruto.jotagame.com</span>{' '}
              em formato ZIP64 sem compressão de mídia (STORE):
            </p>
            <pre className="p-3 text-[11px] font-mono text-[#C9D1E1] bg-[#0B0D12] border border-[#222736] rounded-lg leading-relaxed overflow-x-auto">
{`naruto_jotagame_backup_completo_100.zip
├── manifesto.json          (índice oficial completo)
├── studio-snapshot.json    (nomes, skills e atributos PT-BR)
├── acervo/                 (sprites, Spine, áudios, vídeos, UI)
├── dados/                  (atlases 2D e metadados)
└── d/                      (3.215 tabelas preservadas)`}
            </pre>
            <p className="text-[11px] text-[#8E97AB] leading-relaxed">
              Ao colar o link desse arquivo no Google Drive, o aplicativo lê apenas o índice final do
              ZIP e carrega cada retrato, animação Spine 3.8, som MP3 ou vídeo MP4 sob demanda em
              milissegundos.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
