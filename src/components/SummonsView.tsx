import { Check, FileArchive, Play, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type FullCatalog, querySummons } from '../services/catalogEngine';
import { downloadCustomRequestZip, type ZipProgress } from '../services/clientZipper';
import type { SpineBundle, SummonRecord } from '../types';
import { formatBytes, resolveCdnUrl } from '../utils/format';
import { AssetImage } from './AssetImage';

interface SummonsViewProps {
  catalog: FullCatalog;
  queuedIds: Set<string>;
  onToggleQueue: (summon: SummonRecord) => void;
  onInspectSpine: (bundle: SpineBundle, title: string) => void;
}

export function SummonsView({
  catalog,
  queuedIds,
  onToggleQueue,
  onInspectSpine,
}: SummonsViewProps) {
  const [q, setQ] = useState('');
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [progress, setProgress] = useState<ZipProgress | null>(null);

  const cdnBase = catalog.summary.cdnBase;
  const items = useMemo(() => querySummons(catalog, q), [catalog, q]);

  const handleDownloadAllSummons = async () => {
    setDownloadingAll(true);
    setProgress(null);
    try {
      await downloadCustomRequestZip(
        catalog,
        {
          archiveName: 'naruto_jotagame_todas_invocacoes',
          imageFormat: 'webp',
          includeDatabase: true,
          preset: 'summons_pack',
        },
        (p) => setProgress(p)
      );
    } finally {
      setDownloadingAll(false);
      setProgress(null);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-[#1E2331]">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-[#7C859B] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar invocação (ex: Katsuyu, Rashōmon, Kurama, Manda)..."
            className="w-full pl-9 pr-3 py-2.5 text-sm bg-[#13161F] border border-[#242A3B] focus:border-[#EA580C] rounded-lg text-white placeholder:text-[#6F788E] outline-none"
          />
        </div>

        <button
          onClick={handleDownloadAllSummons}
          disabled={downloadingAll}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium text-white bg-[#EA580C] hover:bg-[#C2410C] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
        >
          <FileArchive className="w-4 h-4" />
          {downloadingAll && progress
            ? `Compactando ${progress.completed}/${progress.total}...`
            : downloadingAll
            ? 'Compactando 50 Invocações...'
            : 'Exportar Todas as Invocações (ZIP)'}
        </button>
      </div>

      {/* Summons Spine Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((summon) => {
          const queued = queuedIds.has(summon.id);
          return (
            <div
              key={summon.id}
              className="bg-[#13161F] border border-[#222736] hover:border-[#343C52] rounded-xl overflow-hidden flex flex-col transition-colors"
            >
              <div className="aspect-[16/10] checkerboard-bg p-3 flex items-center justify-center overflow-hidden">
                <AssetImage
                  src={resolveCdnUrl(cdnBase, summon.previewUrl)}
                  alt={summon.name}
                  fallbackLabel={summon.rawCode}
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="p-4 flex-1 flex flex-col justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-white truncate">{summon.name}</h3>
                  <div className="text-[11px] font-mono text-[#8E97AB] mt-1 truncate">
                    {summon.id}
                  </div>
                </div>
                <div className="text-[11px] font-mono tabular-nums text-[#7C859B] pt-2 border-t border-[#1D2230]">
                  {summon.fileCount} arquivos Spine · {formatBytes(summon.totalBytes)}
                </div>
              </div>
              <div className="px-3.5 py-2.5 bg-[#0F1219] border-t border-[#1E2331] flex items-center justify-between gap-2">
                <button
                  onClick={() => onInspectSpine(summon.spine, summon.name)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#E6E9F0] hover:text-[#F97316] transition-colors"
                >
                  <Play className="w-3.5 h-3.5 text-[#F97316]" />
                  Reproduzir Animação
                </button>
                <button
                  onClick={() => onToggleQueue(summon)}
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

      {/* Summon Fragments Section */}
      {catalog.summonFragments.length > 0 && (
        <section className="space-y-3 pt-4 border-t border-[#1E2331]">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-white">
              Ícones e Fragmentos de Invocação ({catalog.summonFragments.length})
            </h2>
            <span className="text-xs font-mono text-[#7C859B]">
              Pasta ZIP: 02_invocacoes/fragmentos/
            </span>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2.5">
            {catalog.summonFragments.slice(0, 60).map((frag) => (
              <a
                key={frag.url}
                href={resolveCdnUrl(cdnBase, frag.url)}
                target="_blank"
                rel="noreferrer"
                title={frag.name}
                className="aspect-square bg-[#13161F] border border-[#222736] hover:border-[#EA580C] rounded-lg p-1.5 flex items-center justify-center transition-colors"
              >
                <AssetImage
                  src={resolveCdnUrl(cdnBase, frag.url)}
                  alt={frag.name}
                  className="w-full h-full object-contain"
                />
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
