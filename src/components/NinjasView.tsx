import {
  Check,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  List,
  Play,
  Plus,
  Search,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { type FullCatalog, queryNinjas } from '../services/catalogEngine';
import type { NinjaRecord, SpineBundle } from '../types';
import { formatBytes, formatNumber, resolveCdnUrl } from '../utils/format';
import { AssetImage } from './AssetImage';

interface NinjasViewProps {
  catalog: FullCatalog;
  queuedIds: Set<string>;
  onToggleQueue: (ninja: NinjaRecord) => void;
  onSelectNinja: (ninja: NinjaRecord) => void;
  onInspectSpine: (bundle: SpineBundle, title: string) => void;
}

export function NinjasView({
  catalog,
  queuedIds,
  onToggleQueue,
  onSelectNinja,
  onInspectSpine,
}: NinjasViewProps) {
  const [q, setQ] = useState('');
  const [role, setRole] = useState('all');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('featured');
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  const cdnBase = catalog.summary.cdnBase;

  const data = useMemo(
    () =>
      queryNinjas(catalog, {
        q,
        role,
        filter,
        sort,
        page,
        limit: viewMode === 'table' ? 40 : 24,
      }),
    [catalog, q, role, filter, sort, page, viewMode]
  );

  const resetToFirstPage = (fn: () => void) => {
    setPage(1);
    fn();
  };

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 pb-4 border-b border-[#1E2331]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-[#7C859B] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={q}
              onChange={(e) => resetToFirstPage(() => setQ(e.target.value))}
              placeholder="Buscar por nome, ID (ex: 100306) ou técnica..."
              className="w-full pl-9 pr-3 py-2.5 text-sm bg-[#13161F] border border-[#242A3B] focus:border-[#EA580C] rounded-lg text-white placeholder:text-[#6F788E] outline-none transition-colors"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={role}
              onChange={(e) => resetToFirstPage(() => setRole(e.target.value))}
              className="px-3 py-2 text-xs bg-[#13161F] border border-[#242A3B] rounded-lg text-[#D7DCE8] outline-none"
            >
              <option value="all">Todas funções</option>
              <option value="dps">Função: DPS</option>
              <option value="gank">Função: Gank</option>
              <option value="tank">Função: Tank</option>
            </select>

            <select
              value={sort}
              onChange={(e) => resetToFirstPage(() => setSort(e.target.value))}
              className="px-3 py-2 text-xs bg-[#13161F] border border-[#242A3B] rounded-lg text-[#D7DCE8] outline-none"
            >
              <option value="featured">Ordenar: Mais completos</option>
              <option value="id_asc">ID crescente</option>
              <option value="id_desc">ID decrescente</option>
              <option value="grow_desc">Maior crescimento</option>
              <option value="files_desc">Mais arquivos</option>
            </select>

            <div className="flex items-center p-0.5 bg-[#13161F] border border-[#242A3B] rounded-lg">
              <button
                onClick={() => setViewMode('grid')}
                aria-label="Visualização em grade"
                className={`p-1.5 rounded-md transition-colors ${
                  viewMode === 'grid' ? 'bg-[#EA580C] text-white' : 'text-[#8E97AB] hover:text-white'
                }`}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('table')}
                aria-label="Visualização em tabela"
                className={`p-1.5 rounded-md transition-colors ${
                  viewMode === 'table' ? 'bg-[#EA580C] text-white' : 'text-[#8E97AB] hover:text-white'
                }`}
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Filter Segmented Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-[#13161F] border border-[#222736] rounded-lg">
            {(
              [
                ['all', 'Todos'],
                ['named', 'Nome Oficial'],
                ['skills', 'Com Técnicas'],
                ['hd', 'Spine HD'],
                ['audio', 'Com Áudio'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => resetToFirstPage(() => setFilter(key))}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  filter === key ? 'bg-[#EA580C] text-white' : 'text-[#9CA5B9] hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="text-xs font-mono tabular-nums text-[#8E97AB]">
            {formatNumber(data.total)} ninjas encontrados
          </div>
        </div>
      </div>

      {/* Empty State */}
      {data.items.length === 0 && (
        <div className="py-16 text-center bg-[#13161F] border border-[#222736] rounded-xl">
          <p className="text-sm text-[#C9D1E1]">Nenhum ninja corresponde aos filtros atuais.</p>
          <button
            onClick={() => {
              setQ('');
              setRole('all');
              setFilter('all');
              setPage(1);
            }}
            className="mt-3 px-4 py-2 text-xs font-medium text-white bg-[#EA580C] hover:bg-[#C2410C] rounded-lg transition-colors"
          >
            Limpar Filtros
          </button>
        </div>
      )}

      {/* Grid Mode */}
      {data.items.length > 0 && viewMode === 'grid' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {data.items.map((ninja) => {
            const queued = queuedIds.has(ninja.id);
            const hdOrBattle =
              ninja.spineBundles.find((s) => s.kind === 'hd') || ninja.spineBundles[0];
            return (
              <div
                key={ninja.id}
                className="bg-[#13161F] border border-[#222736] hover:border-[#343C52] rounded-xl overflow-hidden flex flex-col transition-colors"
              >
                <button
                  onClick={() => onSelectNinja(ninja)}
                  className="text-left group flex-1 flex flex-col"
                >
                  <div className="aspect-[4/3] w-full checkerboard-bg p-3 flex items-center justify-center overflow-hidden">
                    <AssetImage
                      src={resolveCdnUrl(cdnBase, ninja.portraitUrl || ninja.avatarUrl)}
                      alt={ninja.name}
                      fallbackLabel={`ID ${ninja.id}`}
                      className="w-full h-full object-contain group-hover:scale-[1.03] transition-transform duration-150"
                    />
                  </div>
                  <div className="p-4 flex-1 flex flex-col justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-white truncate group-hover:text-[#F97316] transition-colors">
                        {ninja.name}
                      </h3>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono tabular-nums text-[#8E97AB] mt-1">
                        <span>ID {ninja.id}</span>
                        {ninja.role && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="uppercase text-[#F97316]">{ninja.role}</span>
                          </>
                        )}
                        {ninja.growvalue !== null && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>Cresc. {ninja.growvalue}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="text-[11px] font-mono tabular-nums text-[#7C859B] pt-2 border-t border-[#1D2230]">
                      {ninja.portraits.length} retratos · {ninja.spineBundles.length} Spine ·{' '}
                      {ninja.skills.length} técnicas · {ninja.audioFiles.length} áudios
                    </div>
                  </div>
                </button>

                <div className="px-3 py-2.5 bg-[#0F1219] border-t border-[#1E2331] flex items-center justify-between gap-2">
                  {hdOrBattle ? (
                    <button
                      onClick={() =>
                        onInspectSpine(hdOrBattle, `${ninja.name} (${hdOrBattle.name})`)
                      }
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#C9D1E1] hover:text-white transition-colors whitespace-nowrap"
                    >
                      <Play className="w-3.5 h-3.5 text-[#F97316]" />
                      Animar Spine
                    </button>
                  ) : (
                    <span className="text-[11px] font-mono tabular-nums text-[#6E778C]">
                      {formatBytes(ninja.totalBytes)}
                    </span>
                  )}

                  <button
                    onClick={() => onToggleQueue(ninja)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
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
      )}

      {/* Table Mode */}
      {data.items.length > 0 && viewMode === 'table' && (
        <div className="bg-[#13161F] border border-[#222736] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#222736] bg-[#0F1219] text-xs text-[#8E97AB]">
                  <th className="py-3 px-4 font-medium">Ninja</th>
                  <th className="py-3 px-3 font-medium">ID</th>
                  <th className="py-3 px-3 font-medium">Função</th>
                  <th className="py-3 px-3 font-medium text-right">Cresc.</th>
                  <th className="py-3 px-3 font-medium text-right">Técnicas</th>
                  <th className="py-3 px-3 font-medium text-right">Spine</th>
                  <th className="py-3 px-3 font-medium text-right">Áudios</th>
                  <th className="py-3 px-3 font-medium text-right">Tamanho</th>
                  <th className="py-3 px-4 font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1C2130] text-sm">
                {data.items.map((ninja) => {
                  const queued = queuedIds.has(ninja.id);
                  return (
                    <tr key={ninja.id} className="hover:bg-[#171B26] transition-colors">
                      <td className="py-2.5 px-4">
                        <button
                          onClick={() => onSelectNinja(ninja)}
                          className="flex items-center gap-3 text-left group"
                        >
                          <div className="w-9 h-9 rounded-md overflow-hidden bg-[#0F1219] border border-[#222736] shrink-0">
                            <AssetImage
                              src={resolveCdnUrl(cdnBase, ninja.avatarUrl || ninja.portraitUrl)}
                              alt={ninja.name}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <span className="font-medium text-white group-hover:text-[#F97316] transition-colors">
                            {ninja.name}
                          </span>
                        </button>
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-xs text-[#9CA5B9]">
                        {ninja.id}
                      </td>
                      <td className="py-2.5 px-3 text-xs uppercase text-[#C9D1E1]">
                        {ninja.role || '—'}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-right text-xs text-white">
                        {ninja.growvalue ?? '—'}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-right text-xs text-[#C9D1E1]">
                        {ninja.skills.length}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-right text-xs text-[#C9D1E1]">
                        {ninja.spineBundles.length}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-right text-xs text-[#C9D1E1]">
                        {ninja.audioFiles.length}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-right text-xs text-[#8E97AB]">
                        {formatBytes(ninja.totalBytes)}
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        <button
                          onClick={() => onToggleQueue(ninja)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                            queued
                              ? 'bg-[#16A34A]/20 text-[#86EFAC]'
                              : 'bg-[#1B202E] text-[#D7DCE8] hover:bg-[#262D40]'
                          }`}
                        >
                          {queued ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                          {queued ? 'Na Fila' : 'ZIP'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
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
