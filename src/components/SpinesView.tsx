import { Check, ChevronLeft, ChevronRight, Play, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type FullCatalog, querySpines } from '../services/catalogEngine';
import type { SpineBundle } from '../types';
import { formatBytes, formatNumber, resolveCdnUrl } from '../utils/format';
import { AssetImage } from './AssetImage';

interface SpinesViewProps {
  catalog: FullCatalog;
  queuedIds: Set<string>;
  onToggleQueue: (bundle: SpineBundle) => void;
  onInspectSpine: (bundle: SpineBundle, title: string) => void;
}

const KIND_LABELS: Record<string, string> = {
  all: 'Todos',
  hd: 'Spine HD',
  personagem: 'Combate',
  retrato: 'Retrato Animado',
  esoterica: 'Esotérica',
  efeito: 'Efeitos',
  cenario: 'Cenário',
  pintura: 'Pintura',
};

export function SpinesView({
  catalog,
  queuedIds,
  onToggleQueue,
  onInspectSpine,
}: SpinesViewProps) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const [page, setPage] = useState(1);

  const cdnBase = catalog.summary.cdnBase;
  const data = useMemo(
    () => querySpines(catalog, { q, kind, page, limit: 24 }),
    [catalog, q, kind, page]
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 pb-4 border-b border-[#1E2331]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-[#7C859B] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={q}
              onChange={(e) => {
                setPage(1);
                setQ(e.target.value);
              }}
              placeholder="Buscar modelo Spine (ex: vdfno_100306, afei, kakaxi, banzang)..."
              className="w-full pl-9 pr-3 py-2.5 text-sm bg-[#13161F] border border-[#242A3B] focus:border-[#EA580C] rounded-lg text-white placeholder:text-[#6F788E] outline-none"
            />
          </div>
          <div className="text-xs font-mono tabular-nums text-[#8E97AB]">
            {formatNumber(data.total)} skeletons Spine 3.8
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 bg-[#13161F] border border-[#222736] rounded-lg w-fit">
          {Object.entries(KIND_LABELS).map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                setPage(1);
                setKind(key);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                kind === key ? 'bg-[#EA580C] text-white' : 'text-[#9CA5B9] hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {data.items.map((sp) => {
          const queued = queuedIds.has(sp.id);
          return (
            <div
              key={sp.id}
              className="bg-[#13161F] border border-[#222736] hover:border-[#343C52] rounded-xl overflow-hidden flex flex-col transition-colors"
            >
              <button
                onClick={() => onInspectSpine(sp, sp.name)}
                className="aspect-[4/3] checkerboard-bg p-3 flex items-center justify-center overflow-hidden group"
              >
                <AssetImage
                  src={resolveCdnUrl(cdnBase, sp.imageUrls[0])}
                  alt={sp.name}
                  fallbackLabel={sp.name}
                  className="w-full h-full object-contain group-hover:scale-[1.03] transition-transform duration-150"
                />
              </button>
              <div className="p-3.5 flex-1">
                <div className="text-sm font-mono font-medium text-white truncate" title={sp.name}>
                  {sp.name}
                </div>
                <div className="text-[11px] font-mono tabular-nums text-[#8E97AB] mt-1">
                  {KIND_LABELS[sp.kind] || sp.kind} · {sp.allFiles.length} arquivos ·{' '}
                  {formatBytes(sp.totalBytes)}
                </div>
              </div>
              <div className="px-3.5 py-2.5 bg-[#0F1219] border-t border-[#1E2331] flex items-center justify-between gap-2">
                <button
                  onClick={() => onInspectSpine(sp, sp.name)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#E6E9F0] hover:text-[#F97316] transition-colors"
                >
                  <Play className="w-3.5 h-3.5 text-[#F97316]" />
                  Abrir Player
                </button>
                <button
                  onClick={() => onToggleQueue(sp)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
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
