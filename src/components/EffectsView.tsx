import { Check, ChevronLeft, ChevronRight, Download, Play, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type FullCatalog, paginateList } from '../services/catalogEngine';
import type { Anim2DBundle, AssetFileRef, SpineBundle, VideoRecord } from '../types';
import { formatBytes, formatNumber, resolveCdnUrl } from '../utils/format';
import { AssetImage } from './AssetImage';

type EffectTab = 'spine_effects' | 'anim2d' | 'videos' | 'icons';

interface EffectsViewProps {
  catalog: FullCatalog;
  queuedSpineIds: Set<string>;
  queuedAnim2dIds: Set<string>;
  queuedVideoIds: Set<string>;
  onToggleSpineQueue: (bundle: SpineBundle) => void;
  onToggleAnim2dQueue: (bundle: Anim2DBundle) => void;
  onToggleVideoQueue: (video: VideoRecord) => void;
  onInspectSpine: (bundle: SpineBundle, title: string) => void;
  onInspectAnim2d: (bundle: Anim2DBundle, title: string) => void;
}

export function EffectsView({
  catalog,
  queuedSpineIds,
  queuedAnim2dIds,
  queuedVideoIds,
  onToggleSpineQueue,
  onToggleAnim2dQueue,
  onToggleVideoQueue,
  onInspectSpine,
  onInspectAnim2d,
}: EffectsViewProps) {
  const [tab, setTab] = useState<EffectTab>('spine_effects');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const cdnBase = catalog.summary.cdnBase;

  const data = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (tab === 'anim2d') {
      const list = query
        ? catalog.anim2d.filter((a) => a.name.toLowerCase().includes(query))
        : catalog.anim2d;
      return paginateList(list, page, 24);
    }
    if (tab === 'videos') {
      const list = query
        ? catalog.videos.filter((v) => v.filename.toLowerCase().includes(query))
        : catalog.videos;
      return paginateList(list, page, 12);
    }
    if (tab === 'icons') {
      const list = query
        ? catalog.skillIcons.filter((i) => i.name.toLowerCase().includes(query))
        : catalog.skillIcons;
      return paginateList(list, page, 60);
    }
    const spineEffects = catalog.spineModels.filter((s) => s.kind === 'efeito');
    const list = query
      ? spineEffects.filter((s) => s.name.toLowerCase().includes(query))
      : spineEffects;
    return paginateList(list, page, 24);
  }, [catalog, tab, q, page]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 pb-4 border-b border-[#1E2331]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-[#13161F] border border-[#222736] rounded-lg w-fit">
            {(
              [
                ['spine_effects', 'Efeitos Spine'],
                ['anim2d', 'Spritesheets 2D'],
                ['videos', 'Vídeos Esotéricas (MP4)'],
                ['icons', 'Ícones de Habilidades'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => {
                  setTab(key);
                  setPage(1);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  tab === key ? 'bg-[#EA580C] text-white' : 'text-[#9CA5B9] hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="relative w-full md:w-72">
            <Search className="w-4 h-4 text-[#7C859B] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={q}
              onChange={(e) => {
                setPage(1);
                setQ(e.target.value);
              }}
              placeholder="Filtrar por nome..."
              className="w-full pl-9 pr-3 py-2.5 text-sm bg-[#13161F] border border-[#242A3B] focus:border-[#EA580C] rounded-lg text-white placeholder:text-[#6F788E] outline-none"
            />
          </div>
        </div>

        <div className="text-xs font-mono tabular-nums text-[#8E97AB]">
          {formatNumber(data.total)} recursos encontrados · Pasta ZIP: 04_habilidades_efeitos/
        </div>
      </div>

      {tab === 'spine_effects' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {(data.items as SpineBundle[]).map((sp) => {
            const queued = queuedSpineIds.has(sp.id);
            return (
              <div
                key={sp.id}
                className="bg-[#13161F] border border-[#222736] hover:border-[#343C52] rounded-xl overflow-hidden flex flex-col"
              >
                <button
                  onClick={() => onInspectSpine(sp, sp.name)}
                  className="aspect-[4/3] checkerboard-bg p-3 flex items-center justify-center"
                >
                  <AssetImage
                    src={resolveCdnUrl(cdnBase, sp.imageUrls[0])}
                    alt={sp.name}
                    fallbackLabel={sp.name}
                    className="w-full h-full object-contain"
                  />
                </button>
                <div className="p-3.5 flex-1">
                  <div className="text-sm font-mono text-white truncate">{sp.name}</div>
                  <div className="text-[11px] font-mono tabular-nums text-[#8E97AB] mt-1">
                    {sp.allFiles.length} arquivos · {formatBytes(sp.totalBytes)}
                  </div>
                </div>
                <div className="px-3.5 py-2.5 bg-[#0F1219] border-t border-[#1E2331] flex items-center justify-between">
                  <button
                    onClick={() => onInspectSpine(sp, sp.name)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-[#E6E9F0] hover:text-[#F97316]"
                  >
                    <Play className="w-3.5 h-3.5 text-[#F97316]" />
                    Reproduzir
                  </button>
                  <button
                    onClick={() => onToggleSpineQueue(sp)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md ${
                      queued
                        ? 'bg-[#16A34A]/20 text-[#86EFAC]'
                        : 'bg-[#1B202E] text-[#D7DCE8] hover:bg-[#262D40]'
                    }`}
                  >
                    {queued ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                    {queued ? 'Na Fila' : 'Fila ZIP'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : tab === 'anim2d' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {(data.items as Anim2DBundle[]).map((a) => {
            const queued = queuedAnim2dIds.has(a.id);
            return (
              <div
                key={a.id}
                className="bg-[#13161F] border border-[#222736] hover:border-[#343C52] rounded-xl overflow-hidden flex flex-col"
              >
                <button
                  onClick={() => onInspectAnim2d(a, a.name)}
                  className="aspect-[4/3] checkerboard-bg p-3 flex items-center justify-center"
                >
                  <AssetImage
                    src={resolveCdnUrl(cdnBase, a.imageUrl)}
                    alt={a.name}
                    fallbackLabel={a.name}
                    className="w-full h-full object-contain"
                  />
                </button>
                <div className="p-3.5 flex-1">
                  <div className="text-sm font-mono text-white truncate">{a.name}</div>
                  <div className="text-[11px] font-mono tabular-nums text-[#8E97AB] mt-1">
                    Atlas 2D · {a.allFiles.length} arquivos · {formatBytes(a.totalBytes)}
                  </div>
                </div>
                <div className="px-3.5 py-2.5 bg-[#0F1219] border-t border-[#1E2331] flex items-center justify-between">
                  <button
                    onClick={() => onInspectAnim2d(a, a.name)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-[#E6E9F0] hover:text-[#F97316]"
                  >
                    <Play className="w-3.5 h-3.5 text-[#F97316]" />
                    Animar 2D
                  </button>
                  <button
                    onClick={() => onToggleAnim2dQueue(a)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md ${
                      queued
                        ? 'bg-[#16A34A]/20 text-[#86EFAC]'
                        : 'bg-[#1B202E] text-[#D7DCE8] hover:bg-[#262D40]'
                    }`}
                  >
                    {queued ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                    {queued ? 'Na Fila' : 'Fila ZIP'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : tab === 'videos' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(data.items as VideoRecord[]).map((vid) => {
            const queued = queuedVideoIds.has(vid.id);
            const fullUrl = resolveCdnUrl(cdnBase, vid.url);
            return (
              <div
                key={vid.id}
                className="bg-[#13161F] border border-[#222736] rounded-xl overflow-hidden flex flex-col"
              >
                <div className="aspect-video bg-black">
                  <video
                    controls
                    playsInline
                    preload="metadata"
                    src={fullUrl}
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="p-3.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-mono text-white truncate">{vid.filename}</div>
                    <div className="text-[11px] font-mono tabular-nums text-[#8E97AB] mt-0.5">
                      {vid.kind === 'esoterica' ? 'Esotérica' : 'Close-up'} ·{' '}
                      {formatBytes(vid.bytes)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <a
                      href={fullUrl}
                      download={vid.filename}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1.5 text-[#9CA5B9] hover:text-white bg-[#1B202E] rounded-md"
                      title="Baixar MP4"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>
                    <button
                      onClick={() => onToggleVideoQueue(vid)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md ${
                        queued
                          ? 'bg-[#16A34A]/20 text-[#86EFAC]'
                          : 'bg-[#1B202E] text-[#D7DCE8] hover:bg-[#262D40]'
                      }`}
                    >
                      {queued ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                      {queued ? 'Na Fila' : 'ZIP'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-3">
          {(data.items as AssetFileRef[]).map((icon) => {
            const fullUrl = resolveCdnUrl(cdnBase, icon.url);
            return (
              <a
                key={icon.url}
                href={fullUrl}
                target="_blank"
                rel="noreferrer"
                download={icon.name}
                title={`${icon.name} (${formatBytes(icon.bytes)})`}
                className="bg-[#13161F] border border-[#222736] hover:border-[#EA580C] rounded-lg p-2 flex flex-col items-center gap-1.5 transition-colors"
              >
                <div className="w-12 h-12 flex items-center justify-center">
                  <AssetImage src={fullUrl} alt={icon.name} className="w-full h-full object-contain" />
                </div>
                <span className="text-[10px] font-mono text-[#8E97AB] truncate w-full text-center">
                  {icon.name.replace(/\.webp$/i, '')}
                </span>
              </a>
            );
          })}
        </div>
      )}

      {data.totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs font-mono tabular-nums text-[#8E97AB]">
            Página {data.page} de {data.totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={data.page <= 1}
              className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-[#D7DCE8] bg-[#13161F] border border-[#242A3B] hover:bg-[#1C2130] disabled:opacity-40 rounded-lg"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Anterior
            </button>
            <button
              onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
              disabled={data.page >= data.totalPages}
              className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-[#D7DCE8] bg-[#13161F] border border-[#242A3B] hover:bg-[#1C2130] disabled:opacity-40 rounded-lg"
            >
              Próxima
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
