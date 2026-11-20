import {
  CheckCircle2,
  Download,
  FileArchive,
  FolderTree,
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
  downloadMirrorScriptFile,
  generateAndDownloadClientZip,
  type MobileCatalogPart,
  planCustomZip,
  type ZipProgress,
} from '../services/clientZipper';
import type { ZipExportItem, ZipExportRequest } from '../types';
import { formatBytes, formatNumber } from '../utils/format';

interface ZipExporterViewProps {
  catalog: FullCatalog;
  queue: ZipExportItem[];
  onRemoveItem: (type: ZipExportItem['type'], id: string) => void;
  onClearQueue: () => void;
}

const COMPLETED_STORAGE_KEY = 'shinobi_vault_completed_parts_v1';

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
  onRemoveItem,
  onClearQueue,
}: ZipExporterViewProps) {
  const { summary } = catalog;

  const [mode, setMode] = useState<'mobile_full' | 'custom'>('mobile_full');
  const [imageFormat, setImageFormat] = useState<ZipExportRequest['imageFormat']>('webp');
  const [maxPartMB, setMaxPartMB] = useState<number>(90);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // Mobile multi-part download state
  const [completedParts, setCompletedParts] = useState<Record<string, boolean>>(() =>
    loadCompletedParts()
  );
  const [activePartId, setActivePartId] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [partProgress, setPartProgress] = useState<ZipProgress | null>(null);
  const [partError, setPartError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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
        : mobileParts.filter((p) => p.categoryKey === categoryFilter),
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
  const doneCount = useMemo(
    () => mobileParts.filter((p) => completedParts[p.id]).length,
    [mobileParts, completedParts]
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
      // Short breathing pause so mobile Safari/Chrome flushes the download blob cleanly
      await new Promise((r) => window.setTimeout(r, 1200));
    }
    setBatchRunning(false);
  };

  const handleStopDownload = () => {
    abortRef.current?.abort();
    setBatchRunning(false);
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

  return (
    <div className="space-y-6">
      {/* Header & Mode Tabs */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-[#1E2331]">
        <div>
          <h1 className="text-xl font-semibold text-white">
            Exportador Organizado em ZIP (GitHub Pages e Celular)
          </h1>
          <p className="text-sm text-[#98A1B5] mt-1">
            Todos os ZIPs são montados direto no navegador sem precisar de servidor, com pastas padronizadas.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#13161F] border border-[#222736] rounded-lg w-fit shrink-0">
          <button
            onClick={() => setMode('mobile_full')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              mode === 'mobile_full'
                ? 'bg-[#EA580C] text-white'
                : 'text-[#9CA5B9] hover:text-white'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            Download Completo no Celular
          </button>
          <button
            onClick={() => setMode('custom')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              mode === 'custom' ? 'bg-[#EA580C] text-white' : 'text-[#9CA5B9] hover:text-white'
            }`}
          >
            <FileArchive className="w-3.5 h-3.5" />
            Fila Personalizada ({queue.length})
          </button>
        </div>
      </div>

      {/* MODE 1: FULL MOBILE DOWNLOAD IN SAFE RESUMABLE ORGANIZED PARTS */}
      {mode === 'mobile_full' && (
        <div className="space-y-5">
          {/* Explanation + Controls */}
          <div className="bg-[#13161F] border border-[#222736] rounded-xl p-5 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Download Completo Dividido em Partes Seguras para Celular
                </h2>
                <p className="text-xs text-[#98A1B5] mt-1 leading-relaxed max-w-2xl">
                  Para baixar todos os <span className="font-mono text-white">{formatNumber(totalFullFiles)}</span> arquivos ({formatBytes(totalFullBytes)}) no Android ou iPhone sem travar a memória RAM, o acervo foi dividido em <span className="font-mono text-white">{mobileParts.length}</span> arquivos ZIP organizados. Todos usam a mesma pasta raiz <span className="font-mono text-[#F97316]">naruto_jotagame_acervo/</span>: ao descompactar no mesmo diretório, todas as pastas se unem automaticamente.
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
                    Baixar Pendentes em Sequência ({visibleParts.filter((p) => !completedParts[p.id]).length})
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
                  Tamanho máximo por parte ZIP (RAM do celular)
                </label>
                <select
                  value={maxPartMB}
                  onChange={(e) => setMaxPartMB(Number(e.target.value))}
                  disabled={Boolean(activePartId || batchRunning)}
                  className="w-full px-3 py-2 text-xs bg-[#0F1219] border border-[#242A3B] rounded-lg text-white outline-none"
                >
                  <option value={60}>60 MB por ZIP (Celulares com pouca RAM)</option>
                  <option value={90}>90 MB por ZIP (Recomendado Android/iOS)</option>
                  <option value={150}>150 MB por ZIP (Celulares potentes / Tablet)</option>
                  <option value={250}>250 MB por ZIP (Computador)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-[#8E97AB] mb-1">
                  Formato das imagens
                </label>
                <select
                  value={imageFormat}
                  onChange={(e) => setImageFormat(e.target.value as ZipExportRequest['imageFormat'])}
                  disabled={Boolean(activePartId || batchRunning)}
                  className="w-full px-3 py-2 text-xs bg-[#0F1219] border border-[#242A3B] rounded-lg text-white outline-none"
                >
                  <option value="webp">WebP (Original leve, ideal para celular)</option>
                  <option value="png">PNG (Maior compatibilidade)</option>
                  <option value="both">Ambos (WebP + PNG)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-[#8E97AB] mb-1">
                  Filtrar categoria
                </label>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[#0F1219] border border-[#242A3B] rounded-lg text-white outline-none"
                >
                  <option value="all">Todas as categorias ({mobileParts.length} partes)</option>
                  <option value="database">00. Banco de Dados</option>
                  <option value="ninjas">01. Todos os Ninjas (894)</option>
                  <option value="summons">02. Invocações (50)</option>
                  <option value="spines">03. Animações Spine 3.8</option>
                  <option value="effects">04. Habilidades, Efeitos, Vídeos e Ícones</option>
                  <option value="audio">05. Sons e Dublagens (MP3)</option>
                </select>
              </div>
            </div>

            {/* Active Progress Bar */}
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

          {/* Progress Summary Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-[#8E97AB]">
            <span>
              Progresso salvo neste aparelho: {doneCount} de {mobileParts.length} partes concluídas
            </span>
            <span>Exibindo {visibleParts.length} partes</span>
          </div>

          {/* Parts List */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {visibleParts.map((part) => {
              const isDone = Boolean(completedParts[part.id]);
              const isActive = activePartId === part.id;
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
                      <div className="text-[11px] font-mono text-[#F97316] mt-0.5 truncate">
                        {part.folderHint}
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-[#8E97AB] mt-1">
                        {formatNumber(part.fileCount)} arquivos · {formatBytes(part.totalBytes)}
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

      {/* MODE 2: CUSTOM QUEUE & PRESETS BUILDER */}
      {mode === 'custom' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Configuration Column */}
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
                    Sua fila personalizada está vazia. Marque itens nas abas do catálogo ou use o modo Download Completo no Celular acima.
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

            {/* Optional PC CLI Script */}
            <div className="bg-[#13161F] border border-[#222736] rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Terminal className="w-4 h-4 text-[#F97316]" />
                  <span>Script Node.js para PC ({formatNumber(summary.totalFiles)} arquivos)</span>
                </div>
                <p className="text-xs text-[#98A1B5] mt-1 leading-relaxed">
                  Alternativa para computador caso prefira espelhar todos os {formatBytes(summary.totalBytes)} em uma única pasta via terminal.
                </p>
              </div>
              <button
                onClick={() => downloadMirrorScriptFile(catalog)}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-[#E6E9F0] bg-[#1D2230] hover:bg-[#272E42] rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                Baixar Script .mjs
              </button>
            </div>
          </div>

          {/* Right Live Folder Tree & Action Column */}
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

            {customPlan.samplePaths.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs text-[#8E97AB]">Amostra de caminhos internos:</div>
                <pre className="p-3 text-[11px] font-mono text-[#A8B1C6] bg-[#0B0D12] border border-[#222736] rounded-lg max-h-56 overflow-auto leading-relaxed">
                  {customPlan.samplePaths.join('\n')}
                  {customPlan.fileCount > customPlan.samplePaths.length
                    ? `\n... +${formatNumber(customPlan.fileCount - customPlan.samplePaths.length)} arquivos organizados`
                    : ''}
                </pre>
              </div>
            )}

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
