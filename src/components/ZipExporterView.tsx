import {
  CheckCircle2,
  Cloud,
  Download,
  FileArchive,
  FolderTree,
  HardDrive,
  Play,
  RotateCcw,
  Smartphone,
  Square,
  Terminal,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FullCatalog } from '../services/catalogEngine';
import {
  buildFullCatalogMobileParts,
  downloadCustomRequestZip,
  downloadMirrorZip64ScriptFile,
  generateAndDownloadClientZip,
  generateSingleGameMirrorZip64,
  type MobileCatalogPart,
  type MobilePartCategoryKey,
  planCustomZip,
  planSingleGameMirrorZip,
  type SingleMirrorScope,
  type ZipProgress,
} from '../services/clientZipper';
import type { ZipExportItem, ZipExportRequest } from '../types';
import { formatBytes, formatNumber } from '../utils/format';
import { supportsFileSystemSavePicker } from '../utils/zip64Stream';

interface ZipExporterViewProps {
  catalog: FullCatalog;
  queue: ZipExportItem[];
  initialMode?: 'mobile_full' | 'single_mirror' | 'custom';
  onRemoveItem: (type: ZipExportItem['type'], id: string) => void;
  onClearQueue: () => void;
  onGoToBackupSource?: () => void;
}

const COMPLETED_STORAGE_KEY = 'shinobi_vault_completed_parts_v2';

function loadCompletedParts(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COMPLETED_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function ZipExporterView({
  catalog,
  queue,
  initialMode = 'mobile_full',
  onRemoveItem,
  onClearQueue,
  onGoToBackupSource,
}: ZipExporterViewProps) {
  const { summary } = catalog;

  const [mode, setMode] = useState<'mobile_full' | 'single_mirror' | 'custom'>(initialMode);
  const [imageFormat, setImageFormat] = useState<ZipExportRequest['imageFormat']>('both');
  const [maxPartMB, setMaxPartMB] = useState<number>(400);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  // Mobile multi-part download state
  const [completedParts, setCompletedParts] = useState<Record<string, boolean>>(() =>
    loadCompletedParts()
  );
  const [activePartId, setActivePartId] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [partProgress, setPartProgress] = useState<ZipProgress | null>(null);
  const [partError, setPartError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Single Game-Mirror ZIP64 state
  const [mirrorScope, setMirrorScope] = useState<SingleMirrorScope>('full_all');
  const [mirrorDownloading, setMirrorDownloading] = useState(false);
  const [mirrorProgress, setMirrorProgress] = useState<ZipProgress | null>(null);
  const [mirrorError, setMirrorError] = useState<string | null>(null);
  const [mirrorSuccess, setMirrorSuccess] = useState<string | null>(null);

  // Custom ZIP builder state
  const [archiveName, setArchiveName] = useState('naruto_jotagame_acervo');
  const [preset, setPreset] = useState<ZipExportRequest['preset']>('queue');
  const [includeDatabase, setIncludeDatabase] = useState(true);
  const [includeNinjaPortraits, setIncludeNinjaPortraits] = useState(true);
  const [includeNinjaSpine, setIncludeNinjaSpine] = useState(true);
  const [includeNinjaAudio, setIncludeNinjaAudio] = useState(true);
  const [customDownloading, setCustomDownloading] = useState(false);
  const [customProgress, setCustomProgress] = useState<ZipProgress | null>(null);
  const [customError, setCustomError] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(COMPLETED_STORAGE_KEY, JSON.stringify(completedParts));
    } catch {
      // ignore storage quota errors
    }
  }, [completedParts]);

  const mobileParts = useMemo(
    () => buildFullCatalogMobileParts(catalog, imageFormat, maxPartMB),
    [catalog, imageFormat, maxPartMB]
  );

  const visibleParts = useMemo(
    () =>
      categoryFilter === 'all'
        ? mobileParts
        : mobileParts.filter((p) =>
            p.includedCategories.includes(categoryFilter as MobilePartCategoryKey)
          ),
    [mobileParts, categoryFilter]
  );

  const totalFullBytes = useMemo(
    () => mobileParts.reduce((s, p) => s + p.totalBytes, 0),
    [mobileParts]
  );
  const totalFullFiles = useMemo(
    () => mobileParts.reduce((s, p) => s + p.fileCount, 0),
    [mobileParts]
  );
  const avgPartBytes = useMemo(
    () => (mobileParts.length > 0 ? totalFullBytes / mobileParts.length : 0),
    [mobileParts.length, totalFullBytes]
  );
  const doneCount = useMemo(
    () => mobileParts.filter((p) => completedParts[p.id]).length,
    [mobileParts, completedParts]
  );

  const mirrorPlan = useMemo(
    () => planSingleGameMirrorZip(catalog, mirrorScope),
    [catalog, mirrorScope]
  );

  const downloadSinglePart = async (part: MobileCatalogPart): Promise<boolean> => {
    const controller = new AbortController();
    abortRef.current = controller;
    setActivePartId(part.id);
    setPartProgress(null);
    setPartError(null);
    try {
      await generateAndDownloadClientZip({
        cdnBase: catalog.summary.cdnBase,
        filename: part.filename,
        entries: part.entries,
        virtualFiles: part.virtualFiles,
        onProgress: (p) => setPartProgress(p),
        signal: controller.signal,
      });
      setCompletedParts((prev) => ({ ...prev, [part.id]: true }));
      return true;
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        setPartError('Download pausado/cancelado. Você pode retomar a qualquer momento.');
      } else {
        setPartError(e instanceof Error ? e.message : 'Erro ao gerar esta parte.');
      }
      return false;
    } finally {
      setActivePartId(null);
      setPartProgress(null);
      abortRef.current = null;
    }
  };

  const handleDownloadPendingSequential = async () => {
    const pending = visibleParts.filter((p) => !completedParts[p.id]);
    if (pending.length === 0) return;
    setBatchRunning(true);
    setPartError(null);

    for (const part of pending) {
      const ok = await downloadSinglePart(part);
      if (!ok) break;
      await new Promise((r) => window.setTimeout(r, 1200));
    }
    setBatchRunning(false);
  };

  const handleStopDownload = () => {
    abortRef.current?.abort();
    setBatchRunning(false);
    setMirrorDownloading(false);
  };

  const handleStartSingleMirrorExport = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setMirrorDownloading(true);
    setMirrorProgress(null);
    setMirrorError(null);
    setMirrorSuccess(null);
    try {
      const res = await generateSingleGameMirrorZip64({
        catalog,
        scope: mirrorScope,
        onProgress: (p) => setMirrorProgress(p),
        signal: controller.signal,
      });
      setMirrorSuccess(
        `Backup único ZIP64 concluído! ${formatNumber(res.downloaded)} arquivos gravados com a estrutura exata de naruto.jotagame.com${
          res.failed > 0 ? ` (${res.failed} falharam no CDN)` : ''
        }. Agora você já pode enviar esse arquivo para o Google Drive e vinculá-lo na aba "Backup / Google Drive".`
      );
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        setMirrorError('Geração do backup único cancelada.');
      } else {
        setMirrorError(e instanceof Error ? e.message : 'Erro ao gerar backup único ZIP64.');
      }
    } finally {
      setMirrorDownloading(false);
      setMirrorProgress(null);
      abortRef.current = null;
    }
  };

  const requestPayload: ZipExportRequest = useMemo(() => {
    const base: ZipExportRequest = {
      archiveName: archiveName.trim() || 'naruto_jotagame_acervo',
      imageFormat,
      includeDatabase,
      preset,
      includeNinjaPortraits,
      includeNinjaSpine,
      includeNinjaAudio,
    };
    if (preset === 'queue') {
      base.ninjaIds = queue.filter((q) => q.type === 'ninja').map((q) => q.id);
      base.summonIds = queue.filter((q) => q.type === 'summon').map((q) => q.id);
      base.spineIds = queue.filter((q) => q.type === 'spine').map((q) => q.id);
      base.anim2dIds = queue.filter((q) => q.type === 'anim2d').map((q) => q.id);
      base.audioIds = queue.filter((q) => q.type === 'audio').map((q) => q.id);
      base.videoIds = queue.filter((q) => q.type === 'video').map((q) => q.id);
    }
    return base;
  }, [
    archiveName,
    imageFormat,
    includeDatabase,
    preset,
    includeNinjaPortraits,
    includeNinjaSpine,
    includeNinjaAudio,
    queue,
  ]);

  const customPlan = useMemo(
    () => planCustomZip(catalog, requestPayload),
    [catalog, requestPayload]
  );

  const handleCustomDownload = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setCustomDownloading(true);
    setCustomProgress(null);
    setCustomError(null);
    try {
      await downloadCustomRequestZip(
        catalog,
        requestPayload,
        (p) => setCustomProgress(p),
        controller.signal
      );
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') {
        setCustomError(e instanceof Error ? e.message : 'Erro ao gerar ZIP.');
      }
    } finally {
      setCustomDownloading(false);
      setCustomProgress(null);
      abortRef.current = null;
    }
  };

  const partPct =
    partProgress && partProgress.total > 0
      ? Math.round((partProgress.completed / partProgress.total) * 100)
      : 0;

  const mirrorPct =
    mirrorProgress && mirrorProgress.total > 0
      ? Math.round((mirrorProgress.completed / mirrorProgress.total) * 100)
      : 0;

  const hasDirectDisk = supportsFileSystemSavePicker();

  return (
    <div className="space-y-6">
      {/* Header & Mode Tabs */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-4 border-b border-[#1E2331]">
        <div>
          <h1 className="text-xl font-semibold text-white">
            Exportador ZIP (Partes Otimizadas e Backup Único)
          </h1>
          <p className="text-sm text-[#98A1B5] mt-1">
            Exporte em partes otimizadas para celular ou gere um único arquivo ZIP64 com a estrutura
            idêntica ao servidor do jogo para hospedar no Google Drive.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 bg-[#13161F] border border-[#222736] rounded-lg w-fit shrink-0">
          <button
            onClick={() => setMode('mobile_full')}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              mode === 'mobile_full'
                ? 'bg-[#EA580C] text-white'
                : 'text-[#9CA5B9] hover:text-white'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            Partes Otimizadas
          </button>
          <button
            onClick={() => setMode('single_mirror')}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              mode === 'single_mirror'
                ? 'bg-[#EA580C] text-white'
                : 'text-[#9CA5B9] hover:text-white'
            }`}
          >
            <Cloud className="w-3.5 h-3.5" />
            ZIP Único (Backup Drive)
          </button>
          <button
            onClick={() => setMode('custom')}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              mode === 'custom' ? 'bg-[#EA580C] text-white' : 'text-[#9CA5B9] hover:text-white'
            }`}
          >
            <FileArchive className="w-3.5 h-3.5" />
            Fila ({queue.length})
          </button>
        </div>
      </div>

      {/* MODE 1: OPTIMIZED MULTI-PART PACKING */}
      {mode === 'mobile_full' && (
        <div className="space-y-5">
          <div className="bg-[#13161F] border border-[#222736] rounded-xl p-5 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Empacotamento Otimizado (Sem Partes Pequenas e Sem Quebrar Pastas)
                </h2>
                <p className="text-xs text-[#98A1B5] mt-1 leading-relaxed max-w-2xl">
                  Todos os <span className="font-mono text-white">{formatNumber(totalFullFiles)}</span>{' '}
                  arquivos ({formatBytes(totalFullBytes)}) foram distribuídos em{' '}
                  <span className="font-mono text-white">{mobileParts.length}</span> partes ZIP com
                  média de <span className="font-mono text-[#FB923C]">{formatBytes(avgPartBytes)}</span>{' '}
                  cada (teto de {maxPartMB} MB). Cada pasta de ninja, invocação e Spine permanece
                  100% íntegra e todas compartilham a raiz{' '}
                  <span className="font-mono text-[#F97316]">naruto_jotagame_acervo/</span>.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {activePartId || batchRunning ? (
                  <button
                    onClick={handleStopDownload}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-[#DC2626] hover:bg-[#B91C1C] rounded-lg transition-colors whitespace-nowrap"
                  >
                    <Square className="w-3.5 h-3.5" />
                    Pausar / Cancelar
                  </button>
                ) : (
                  <button
                    onClick={handleDownloadPendingSequential}
                    disabled={visibleParts.every((p) => completedParts[p.id])}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-[#EA580C] hover:bg-[#C2410C] disabled:opacity-45 rounded-lg transition-colors whitespace-nowrap"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Baixar Pendentes ({visibleParts.filter((p) => !completedParts[p.id]).length})
                  </button>
                )}

                {doneCount > 0 && (
                  <button
                    onClick={() => setCompletedParts({})}
                    className="inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium text-[#A8B1C6] bg-[#191E2B] hover:bg-[#23293A] rounded-lg whitespace-nowrap"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Zerar Progresso
                  </button>
                )}
              </div>
            </div>

            {/* Settings Row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4 border-t border-[#1E2331]">
              <div>
                <label className="block text-[11px] text-[#8E97AB] mb-1">
                  Tamanho alvo por parte ZIP
                </label>
                <select
                  value={maxPartMB}
                  onChange={(e) => setMaxPartMB(Number(e.target.value))}
                  disabled={Boolean(activePartId || batchRunning)}
                  className="w-full px-3 py-2 text-xs bg-[#0F1219] border border-[#242A3B] rounded-lg text-white outline-none"
                >
                  <option value={90}>90 MB por ZIP (Celulares com pouca RAM)</option>
                  <option value={150}>150 MB por ZIP (Celulares intermediários)</option>
                  <option value={250}>250 MB por ZIP (Celulares potentes)</option>
                  <option value={400}>400 MB por ZIP (Recomendado · ~33 partes)</option>
                  <option value={600}>600 MB por ZIP (PC / Tablet · ~22 partes)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-[#8E97AB] mb-1">
                  Formato / Cobertura do Acervo
                </label>
                <select
                  value={imageFormat}
                  onChange={(e) => setImageFormat(e.target.value as ZipExportRequest['imageFormat'])}
                  disabled={Boolean(activePartId || batchRunning)}
                  className="w-full px-3 py-2 text-xs bg-[#0F1219] border border-[#242A3B] rounded-lg text-white outline-none"
                >
                  <option value="both">100% Completo — WebP + PNG (Todos os ~12,8 GB)</option>
                  <option value="webp">Somente WebP — Sem duplicatas PNG (~9,1 GB)</option>
                  <option value="png">Priorizar PNG — Maior compatibilidade</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-[#8E97AB] mb-1">
                  Filtrar partes que contêm a categoria
                </label>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[#0F1219] border border-[#242A3B] rounded-lg text-white outline-none"
                >
                  <option value="all">
                    Todas as partes ({mobileParts.length} partes · {formatBytes(totalFullBytes)})
                  </option>
                  <option value="database">00. Banco de Dados</option>
                  <option value="ninjas">01. Todos os Ninjas</option>
                  <option value="summons">02. Invocações (50)</option>
                  <option value="spines">03. Animações Spine 3.8</option>
                  <option value="spine_textures">03B. Texturas Spine Complementares</option>
                  <option value="effects">04. Habilidades, Efeitos, Vídeos e Ícones</option>
                  <option value="audio">05. Sons e Dublagens (MP3)</option>
                  <option value="ui_maps">06. Interface, Mapas Vivos, Cenários e PT-BR</option>
                  <option value="items_misc">07. Itens, Equipamentos e Dados Restantes</option>
                </select>
              </div>
            </div>

            {activePartId && partProgress && (
              <div className="p-4 bg-[#0F1219] border border-[#EA580C]/40 rounded-lg space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-white truncate">
                    Baixando: {partProgress.currentFile}
                  </span>
                  <span className="font-mono tabular-nums text-[#F97316] shrink-0">
                    {partPct}% ({partProgress.completed}/{partProgress.total}) ·{' '}
                    {formatBytes(partProgress.bytesDownloaded)}
                  </span>
                </div>
                <div className="w-full h-2 bg-[#1D2230] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#EA580C] transition-all duration-150"
                    style={{ width: `${partPct}%` }}
                  />
                </div>
              </div>
            )}

            {partError && (
              <div className="p-3 text-xs text-[#FCA5A5] bg-[#1F1215] border border-[#4C1D24] rounded-lg">
                {partError}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-[#8E97AB]">
            <span>
              Progresso salvo neste aparelho: {doneCount} de {mobileParts.length} partes concluídas
            </span>
            <span>Exibindo {visibleParts.length} partes otimizadas</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {visibleParts.map((part) => {
              const isDone = Boolean(completedParts[part.id]);
              const isActive = activePartId === part.id;
              const fillPct = Math.min(100, Math.round((part.totalBytes / (maxPartMB * 1024 * 1024)) * 100));
              return (
                <div
                  key={part.id}
                  className={`p-4 rounded-xl border flex flex-col justify-between gap-3 transition-colors ${
                    isActive
                      ? 'bg-[#171C28] border-[#EA580C]'
                      : isDone
                      ? 'bg-[#111816] border-[#1E3A2A]'
                      : 'bg-[#13161F] border-[#222736]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{part.title}</div>
                      <div className="text-[11px] font-mono text-[#F97316] mt-0.5 truncate" title={part.folderHint}>
                        {part.folderHint}
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-[#8E97AB] mt-1">
                        {formatNumber(part.fileCount)} arquivos · {formatBytes(part.totalBytes)} ({fillPct}% de {maxPartMB} MB)
                      </div>
                    </div>

                    {isDone && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-[#86EFAC] shrink-0">
                        <CheckCircle2 className="w-4 h-4" />
                        Baixado
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-[#1E2331]">
                    <span className="text-[11px] font-mono text-[#7C859B] truncate">
                      {part.filename}
                    </span>
                    <button
                      onClick={() => downloadSinglePart(part)}
                      disabled={Boolean(activePartId || batchRunning)}
                      className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                        isDone
                          ? 'bg-[#1D2621] text-[#A7F3D0] hover:bg-[#23332A]'
                          : 'bg-[#1F2536] text-white hover:bg-[#EA580C]'
                      } disabled:opacity-45`}
                    >
                      <Download className="w-3.5 h-3.5" />
                      {isActive ? 'Baixando...' : isDone ? 'Baixar Novamente' : 'Baixar Parte ZIP'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MODE 2: SINGLE GAME-MIRROR ZIP64 (EXACT naruto.jotagame.com STRUCTURE FOR GOOGLE DRIVE) */}
      {mode === 'single_mirror' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 space-y-5">
            <div className="bg-[#13161F] border border-[#222736] rounded-xl p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-white">
                    Backup em Único Arquivo ZIP64 (Estrutura Exata de naruto.jotagame.com)
                  </h2>
                  <p className="text-xs text-[#98A1B5] mt-1 leading-relaxed">
                    Preserva 100% da árvore original do servidor (<span className="font-mono text-[#FB923C]">manifesto.json</span>,{' '}
                    <span className="font-mono text-[#FB923C]">studio-snapshot.json</span>,{' '}
                    <span className="font-mono text-white">acervo/</span>,{' '}
                    <span className="font-mono text-white">dados/</span> e{' '}
                    <span className="font-mono text-white">d/</span>) em um único arquivo ZIP64 sem
                    compressão de mídia (STORE) para leitura instantânea via Google Drive caso o jogo
                    feche.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
                {(
                  [
                    [
                      'full_all',
                      '100% Completo do Servidor (~12,8 GB)',
                      'Todos os 80.165 arquivos idênticos ao jogo (WebP + PNG + Áudio + Vídeos + d/*).',
                    ],
                    [
                      'full_webp',
                      'Completo Otimizado WebP (~9,1 GB)',
                      '100% visualmente completo sem duplicatas PNG. Ideal para economizar espaço no Drive.',
                    ],
                    [
                      'core_playable',
                      'Núcleo Ninjas + Invocações (~3,5 GB)',
                      'Todos os 908 ninjas, sprites Spine HD/batalha, invocações, estados e dublagens.',
                    ],
                    [
                      'quick_test',
                      'Backup Teste Rápido (~260 MB)',
                      '15 Ninjas nomeados + 50 Invocações + 18 Estados. Ótimo para testar agora no Drive!',
                    ],
                  ] as const
                ).map(([key, label, desc]) => (
                  <button
                    key={key}
                    onClick={() => setMirrorScope(key)}
                    disabled={mirrorDownloading}
                    className={`text-left p-3.5 rounded-xl border transition-colors ${
                      mirrorScope === key
                        ? 'bg-[#EA580C]/15 border-[#EA580C]'
                        : 'bg-[#0F1219] border-[#222736] hover:border-[#343C52]'
                    }`}
                  >
                    <div className="text-xs font-semibold text-white">{label}</div>
                    <div className="text-[11px] text-[#8E97AB] mt-1 leading-relaxed">{desc}</div>
                  </button>
                ))}
              </div>

              {mirrorDownloading && mirrorProgress && (
                <div className="p-4 bg-[#0F1219] border border-[#EA580C]/40 rounded-lg space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-white truncate">
                      Gravando no ZIP64: {mirrorProgress.currentFile}
                    </span>
                    <span className="font-mono tabular-nums text-[#F97316] shrink-0">
                      {mirrorPct}% ({formatNumber(mirrorProgress.completed)}/
                      {formatNumber(mirrorProgress.total)}) ·{' '}
                      {formatBytes(mirrorProgress.bytesDownloaded)}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-[#1D2230] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#EA580C] transition-all duration-150"
                      style={{ width: `${mirrorPct}%` }}
                    />
                  </div>
                </div>
              )}

              {mirrorError && (
                <div className="p-3.5 text-xs text-[#FCA5A5] bg-[#1F1215] border border-[#4C1D24] rounded-lg leading-relaxed">
                  {mirrorError}
                </div>
              )}

              {mirrorSuccess && (
                <div className="p-3.5 text-xs text-[#86EFAC] bg-[#111C16] border border-[#1E4432] rounded-lg space-y-2">
                  <div>{mirrorSuccess}</div>
                  {onGoToBackupSource && (
                    <button
                      onClick={onGoToBackupSource}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#16A34A] hover:bg-[#15803D] rounded-md"
                    >
                      <Cloud className="w-3.5 h-3.5" />
                      Abrir Painel Backup / Google Drive
                    </button>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2.5 pt-2">
                {mirrorDownloading ? (
                  <button
                    onClick={handleStopDownload}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-[#DC2626] hover:bg-[#B91C1C] rounded-lg transition-colors"
                  >
                    <Square className="w-3.5 h-3.5" />
                    Cancelar Gravação
                  </button>
                ) : (
                  <button
                    onClick={handleStartSingleMirrorExport}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-[#EA580C] hover:bg-[#C2410C] rounded-lg transition-colors"
                  >
                    <HardDrive className="w-4 h-4" />
                    Gerar e Salvar ZIP Único ({formatBytes(mirrorPlan.totalBytes)})
                  </button>
                )}

                {onGoToBackupSource && (
                  <button
                    onClick={onGoToBackupSource}
                    className="inline-flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium text-[#D7DCE8] bg-[#1A202E] hover:bg-[#242C40] rounded-lg transition-colors"
                  >
                    <Cloud className="w-3.5 h-3.5 text-[#F97316]" />
                    Já tenho o ZIP no Google Drive
                  </button>
                )}
              </div>

              <div className="text-[11px] text-[#7C859B] leading-relaxed">
                {hasDirectDisk
                  ? 'Seu navegador suporta gravação direta em disco (streaming ZIP64 com uso mínimo de RAM — ideal para gerar o backup completo de 12,8 GB pelo GitHub Pages).'
                  : 'Neste navegador/ambiente, o download direto em memória suporta até ~600 MB (ex.: Backup Teste Rápido). Para gerar o arquivo único completo de 12,8 GB, use o GitHub Pages no Chrome/Edge ou o script Node.js ZIP64 abaixo.'}
              </div>
            </div>

            {/* Standalone Zero-Dependency Node.js ZIP64 Mirror Generator */}
            <div className="bg-[#13161F] border border-[#222736] rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Terminal className="w-4 h-4 text-[#F97316]" />
                  <span>Script Gerador de ZIP64 Único (.mjs — PC ou Android Termux)</span>
                </div>
                <p className="text-xs text-[#98A1B5] mt-1 leading-relaxed">
                  Gera o arquivo único <span className="font-mono text-white">naruto_jotagame_backup_completo_100.zip</span>{' '}
                  ({formatNumber(summary.totalFiles)} arquivos, {formatBytes(summary.totalBytes)}) com
                  zero dependências externas, usando &lt;20 MB de RAM e pronto para subir no Google
                  Drive.
                </p>
              </div>
              <button
                onClick={() => downloadMirrorZip64ScriptFile(catalog)}
                className="inline-flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium text-white bg-[#1F2536] hover:bg-[#EA580C] rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                Baixar Script ZIP64 (.mjs)
              </button>
            </div>
          </div>

          {/* Right Preview Column */}
          <div className="lg:col-span-5 bg-[#13161F] border border-[#222736] rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <FolderTree className="w-4 h-4 text-[#F97316]" />
              <span>Estrutura Exata do Backup Único</span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-center py-3 bg-[#0F1219] border border-[#222736] rounded-lg">
              <div>
                <div className="text-[11px] text-[#7C859B]">Total de Arquivos</div>
                <div className="text-base font-mono tabular-nums font-semibold text-white mt-0.5">
                  {formatNumber(mirrorPlan.files.length + 2)}
                </div>
              </div>
              <div className="border-l border-[#222736]">
                <div className="text-[11px] text-[#7C859B]">Tamanho do ZIP64</div>
                <div className="text-base font-mono tabular-nums font-semibold text-[#FB923C] mt-0.5">
                  {formatBytes(mirrorPlan.totalBytes)}
                </div>
              </div>
            </div>

            <div className="divide-y divide-[#1C2130] border border-[#222736] rounded-lg bg-[#0F1219] text-xs font-mono">
              <div className="px-3.5 py-2 flex justify-between">
                <span className="text-[#86EFAC]">manifesto.json</span>
                <span className="text-[#9CA5B9]">Índice oficial</span>
              </div>
              <div className="px-3.5 py-2 flex justify-between">
                <span className="text-[#86EFAC]">studio-snapshot.json</span>
                <span className="text-[#9CA5B9]">Dados PT-BR</span>
              </div>
              {Object.entries(mirrorPlan.folderCounts).map(([folder, count]) => (
                <div key={folder} className="px-3.5 py-2 flex justify-between">
                  <span className="text-[#F97316]">{folder}/</span>
                  <span className="tabular-nums text-[#C9D1E1]">
                    {formatNumber(count)} arquivos
                  </span>
                </div>
              ))}
            </div>

            <div className="p-3.5 bg-[#0F1219] border border-[#222736] rounded-lg text-[11px] text-[#98A1B5] leading-relaxed space-y-1.5">
              <div className="text-white font-medium">Como funciona no Google Drive:</div>
              <div>1. Gere o arquivo único <span className="font-mono text-white">{mirrorPlan.filename}</span>.</div>
              <div>2. Faça upload desse arquivo único para o seu Google Drive.</div>
              <div>
                3. Na aba <strong className="text-white">Backup / Google Drive</strong>, conecte sua
                conta e cole o link do arquivo — toda a aplicação passará a funcionar alimentada por
                esse ZIP mesmo offline do jogo original!
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODE 3: CUSTOM QUEUE & PRESETS BUILDER */}
      {mode === 'custom' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 space-y-5">
            <div className="bg-[#13161F] border border-[#222736] rounded-xl p-5 space-y-4">
              <h2 className="text-sm font-semibold text-white">1. Conteúdo do Pacote ZIP</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {(
                  [
                    ['queue', `Minha Fila Selecionada (${queue.length} itens)`],
                    ['featured_ninjas', '15 Ninjas Nomeados (Completo)'],
                    ['summons_pack', 'Todas as 50 Invocações + Fragmentos'],
                    ['dubs_pack', 'Todas as Dublagens e Falas (MP3)'],
                    ['effects_pack', 'Efeitos Spine + Spritesheets 2D'],
                    ['database_only', 'Somente Banco de Dados (JSON + CSV)'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setPreset(key)}
                    className={`text-left px-3.5 py-2.5 text-xs font-medium rounded-lg border transition-colors ${
                      preset === key
                        ? 'bg-[#EA580C]/15 border-[#EA580C] text-white'
                        : 'bg-[#0F1219] border-[#222736] text-[#A8B1C6] hover:border-[#343C52]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[#1E2331]">
                <div>
                  <label className="block text-xs text-[#8E97AB] mb-1.5">
                    Nome da pasta raiz e arquivo .zip
                  </label>
                  <input
                    type="text"
                    value={archiveName}
                    onChange={(e) => setArchiveName(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-[#0F1219] border border-[#242A3B] focus:border-[#EA580C] rounded-lg text-white outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs text-[#8E97AB] mb-1.5">
                    Formato das imagens de sprites
                  </label>
                  <select
                    value={imageFormat}
                    onChange={(e) =>
                      setImageFormat(e.target.value as ZipExportRequest['imageFormat'])
                    }
                    className="w-full px-3 py-2 text-xs bg-[#0F1219] border border-[#242A3B] rounded-lg text-white outline-none"
                  >
                    <option value="webp">WebP (Original leve, recomendado)</option>
                    <option value="png">PNG (Máxima compatibilidade)</option>
                    <option value="both">Ambos (WebP + PNG)</option>
                  </select>
                </div>
              </div>

              <div className="pt-2 border-t border-[#1E2331] grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs text-[#C9D1E1]">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeDatabase}
                    onChange={(e) => setIncludeDatabase(e.target.checked)}
                    className="accent-[#EA580C]"
                  />
                  <span>Incluir 00_banco_de_dados/ (JSON + CSV)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeNinjaPortraits}
                    onChange={(e) => setIncludeNinjaPortraits(e.target.checked)}
                    className="accent-[#EA580C]"
                  />
                  <span>Incluir retratos e banners PT dos ninjas</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeNinjaSpine}
                    onChange={(e) => setIncludeNinjaSpine(e.target.checked)}
                    className="accent-[#EA580C]"
                  />
                  <span>Incluir skeletons Spine HD e batalha</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeNinjaAudio}
                    onChange={(e) => setIncludeNinjaAudio(e.target.checked)}
                    className="accent-[#EA580C]"
                  />
                  <span>Incluir áudios vinculados aos ninjas</span>
                </label>
              </div>
            </div>

            {preset === 'queue' && (
              <div className="bg-[#13161F] border border-[#222736] rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[#222736] flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-white">
                    2. Itens na Fila de Exportação ({queue.length})
                  </h2>
                  {queue.length > 0 && (
                    <button
                      onClick={onClearQueue}
                      className="text-xs text-[#9CA5B9] hover:text-[#FCA5A5] transition-colors"
                    >
                      Limpar Fila
                    </button>
                  )}
                </div>

                {queue.length === 0 ? (
                  <div className="p-6 text-xs text-[#8E97AB]">
                    Sua fila personalizada está vazia. Marque itens nas abas do catálogo ou use os
                    modos Partes Otimizadas / ZIP Único acima.
                  </div>
                ) : (
                  <div className="divide-y divide-[#1C2130] max-h-72 overflow-y-auto">
                    {queue.map((item) => (
                      <div
                        key={`${item.type}:${item.id}`}
                        className="px-5 py-2.5 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="text-white font-medium truncate">{item.label}</div>
                          <div className="font-mono tabular-nums text-[11px] text-[#7C859B]">
                            {item.type} · {item.fileCount} arquivos ·{' '}
                            {formatBytes(item.estimatedBytes)}
                          </div>
                        </div>
                        <button
                          onClick={() => onRemoveItem(item.type, item.id)}
                          aria-label="Remover da fila"
                          className="p-1.5 text-[#8E97AB] hover:text-[#FCA5A5] rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="lg:col-span-5 bg-[#13161F] border border-[#222736] rounded-xl p-5 space-y-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <FolderTree className="w-4 h-4 text-[#F97316]" />
              <span>Prévia da Estrutura Interna do ZIP</span>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center py-3 bg-[#0F1219] border border-[#222736] rounded-lg">
              <div>
                <div className="text-[11px] text-[#7C859B]">Arquivos</div>
                <div className="text-base font-mono tabular-nums font-semibold text-white mt-0.5">
                  {formatNumber(customPlan.fileCount)}
                </div>
              </div>
              <div className="border-x border-[#222736]">
                <div className="text-[11px] text-[#7C859B]">Pastas Raiz</div>
                <div className="text-base font-mono tabular-nums font-semibold text-white mt-0.5">
                  {Object.keys(customPlan.folderTree).length}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[#7C859B]">Tamanho Est.</div>
                <div className="text-base font-mono tabular-nums font-semibold text-white mt-0.5">
                  {formatBytes(customPlan.totalBytes)}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-xs text-[#8E97AB]">Diretórios gerados no arquivo:</div>
              <div className="divide-y divide-[#1C2130] border border-[#222736] rounded-lg bg-[#0F1219]">
                {Object.entries(customPlan.folderTree).map(([folder, count]) => (
                  <div
                    key={folder}
                    className="px-3.5 py-2 flex items-center justify-between text-xs font-mono"
                  >
                    <span className="text-[#F97316]">{folder}/</span>
                    <span className="tabular-nums text-[#C9D1E1]">{formatNumber(count)} arq.</span>
                  </div>
                ))}
                {Object.keys(customPlan.folderTree).length === 0 && (
                  <div className="px-3.5 py-3 text-xs text-[#7C859B]">
                    Nenhum arquivo selecionado.
                  </div>
                )}
              </div>
            </div>

            {customDownloading && customProgress && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-mono tabular-nums text-[#F97316]">
                  <span>
                    {customProgress.completed}/{customProgress.total} arquivos
                  </span>
                  <span>{formatBytes(customProgress.bytesDownloaded)}</span>
                </div>
                <div className="w-full h-2 bg-[#1D2230] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#EA580C] transition-all duration-150"
                    style={{
                      width: `${Math.round(
                        (customProgress.completed / Math.max(1, customProgress.total)) * 100
                      )}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {customError && (
              <div className="p-3 text-xs text-[#FCA5A5] bg-[#1F1215] border border-[#4C1D24] rounded-lg">
                {customError}
              </div>
            )}

            <button
              onClick={handleCustomDownload}
              disabled={customDownloading || customPlan.fileCount === 0}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold text-white bg-[#EA580C] hover:bg-[#C2410C] disabled:opacity-45 rounded-lg transition-colors"
            >
              <FileArchive className="w-4 h-4" />
              {customDownloading
                ? 'Compactando no navegador...'
                : `Gerar e Baixar ZIP Organizado (${formatNumber(customPlan.fileCount)} arquivos)`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
