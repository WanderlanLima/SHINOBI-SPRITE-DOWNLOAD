import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Flame,
  Package,
  Play,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { triggerAssetDownload, useResolvedAssetUrl } from '../services/assetSource';
import type { FullCatalog } from '../services/catalogEngine';
import type { SpineBundle, VisualItemRecord } from '../types';
import { formatBytes, formatNumber, resolveCdnUrl } from '../utils/format';
import { lockBodyScroll } from '../utils/scrollLock';
import { AssetImage } from './AssetImage';

interface ItemsStatusViewProps {
  catalog: FullCatalog;
  queuedSpineIds: Set<string>;
  onToggleSpineQueue: (bundle: SpineBundle) => void;
  onInspectSpine: (bundle: SpineBundle, title: string) => void;
}

type ActiveTab = 'status' | 'items';
type ItemGroupFilter = 'all' | 'described' | 'item' | 'ferramenta' | 'runa' | 'outro';

const PAGE_SIZE = 60;

export function ItemsStatusView({
  catalog,
  queuedSpineIds,
  onToggleSpineQueue,
  onInspectSpine,
}: ItemsStatusViewProps) {
  const [tab, setTab] = useState<ActiveTab>('status');
  const [search, setSearch] = useState('');
  const [statusCategory, setStatusCategory] = useState('all');
  const [itemGroup, setItemGroup] = useState<ItemGroupFilter>('all');
  const [page, setPage] = useState(1);
  const [selectedItem, setSelectedItem] = useState<VisualItemRecord | null>(null);

  const cdnBase = catalog.summary.cdnBase;
  const selectedItemRawUrl = selectedItem ? resolveCdnUrl(cdnBase, selectedItem.url) : '';
  const selectedItemResolvedUrl = useResolvedAssetUrl(selectedItemRawUrl);

  useEffect(() => {
    if (!selectedItem) return;
    const unlock = lockBodyScroll();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedItem(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      unlock();
    };
  }, [selectedItem]);

  const statusCategories = useMemo(() => {
    const set = new Set<string>();
    for (const s of catalog.statusEffects) set.add(s.category);
    return [...set].sort();
  }, [catalog.statusEffects]);

  const filteredStatus = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog.statusEffects.filter((s) => {
      if (statusCategory !== 'all' && s.category !== statusCategory) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.rawCode.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
      );
    });
  }, [catalog.statusEffects, statusCategory, search]);

  const itemCounts = useMemo(() => {
    let described = 0;
    let item = 0;
    let ferramenta = 0;
    let runa = 0;
    let outro = 0;
    for (const it of catalog.visualItems) {
      if (it.desc) described++;
      if (it.group === 'item') item++;
      else if (it.group === 'ferramenta') ferramenta++;
      else if (it.group === 'runa') runa++;
      else outro++;
    }
    return { total: catalog.visualItems.length, described, item, ferramenta, runa, outro };
  }, [catalog.visualItems]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog.visualItems.filter((it) => {
      if (itemGroup === 'described' && !it.desc) return false;
      if (itemGroup !== 'all' && itemGroup !== 'described' && it.group !== itemGroup) return false;
      if (!q) return true;
      return (
        it.name.toLowerCase().includes(q) ||
        it.id.toLowerCase().includes(q) ||
        (it.desc && it.desc.toLowerCase().includes(q))
      );
    });
  }, [catalog.visualItems, itemGroup, search]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = useMemo(
    () => filteredItems.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredItems, safePage]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-white">
            Itens, Ferramentas e Estados de Combate
          </h1>
          <p className="text-xs sm:text-sm text-[#8E97AB] mt-1">
            Reproduza ao vivo os {catalog.statusEffects.length} efeitos de estado de batalha (Spine 3.8)
            e explore todos os {formatNumber(catalog.visualItems.length)} ícones de itens, ferramentas ninja e runas.
          </p>
        </div>
      </div>

      {/* Main Mode Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => {
            setTab('status');
            setSearch('');
          }}
          className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium rounded-lg border transition-colors ${
            tab === 'status'
              ? 'bg-[#EA580C] border-[#EA580C] text-white'
              : 'bg-[#13161F] border-[#222736] text-[#A8B1C6] hover:text-white'
          }`}
        >
          <Flame className="w-4 h-4" />
          <span>Estados de Combate Animados (Spine)</span>
          <span className="font-mono tabular-nums text-[11px] opacity-90">
            {catalog.statusEffects.length}
          </span>
        </button>

        <button
          onClick={() => {
            setTab('items');
            setSearch('');
            setPage(1);
          }}
          className={`inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium rounded-lg border transition-colors ${
            tab === 'items'
              ? 'bg-[#EA580C] border-[#EA580C] text-white'
              : 'bg-[#13161F] border-[#222736] text-[#A8B1C6] hover:text-white'
          }`}
        >
          <Package className="w-4 h-4" />
          <span>Itens, Ferramentas e Runas</span>
          <span className="font-mono tabular-nums text-[11px] opacity-90">
            {formatNumber(catalog.visualItems.length)}
          </span>
        </button>
      </div>

      {/* Search & Sub-filter */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#7C859B] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={
              tab === 'status'
                ? 'Buscar estado (ex: Amaterasu, Queimadura, Veneno, Selamento)...'
                : 'Buscar item por nome, ID ou descrição em PT-BR...'
            }
            className="w-full pl-9 pr-3 py-2 text-sm bg-[#13161F] border border-[#222736] focus:border-[#EA580C] rounded-lg text-white placeholder-[#6E778C] outline-none"
          />
        </div>

        {tab === 'status' ? (
          <select
            value={statusCategory}
            onChange={(e) => setStatusCategory(e.target.value)}
            aria-label="Filtrar categoria de estado"
            className="px-3 py-2 text-xs bg-[#13161F] border border-[#222736] focus:border-[#EA580C] rounded-lg text-[#D7DCE8] outline-none"
          >
            <option value="all">Todas as categorias ({catalog.statusEffects.length})</option>
            {statusCategories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        ) : (
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {(
              [
                ['all', `Todos (${formatNumber(itemCounts.total)})`],
                ['described', `Com Descrição PT-BR (${formatNumber(itemCounts.described)})`],
                ['item', `Itens (${formatNumber(itemCounts.item)})`],
                ['ferramenta', `Ferramentas (${formatNumber(itemCounts.ferramenta)})`],
                ['runa', `Runas (${formatNumber(itemCounts.runa)})`],
                ['outro', `Especiais (${formatNumber(itemCounts.outro)})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => {
                  setItemGroup(key);
                  setPage(1);
                }}
                className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  itemGroup === key
                    ? 'bg-[#1F2536] border-[#EA580C] text-white'
                    : 'bg-[#13161F] border-[#222736] text-[#9CA5B9] hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tab 1: Animated Status Effects (Spine 3.8) */}
      {tab === 'status' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredStatus.map((st) => {
            const queued = queuedSpineIds.has(st.spine.id);
            const previewUrl = st.previewUrl ? resolveCdnUrl(cdnBase, st.previewUrl) : null;
            return (
              <div
                key={st.id}
                className="bg-[#13161F] border border-[#222736] hover:border-[#343D56] rounded-xl overflow-hidden flex flex-col transition-colors"
              >
                <button
                  onClick={() => onInspectSpine(st.spine, `${st.name} (${st.rawCode})`)}
                  className="h-40 checkerboard-bg p-3 flex items-center justify-center relative group w-full"
                >
                  {previewUrl ? (
                    <AssetImage
                      src={previewUrl}
                      alt={st.name}
                      className="max-h-full max-w-full object-contain transition-transform duration-200 group-hover:scale-105"
                    />
                  ) : (
                    <Flame className="w-10 h-10 text-[#F97316]" />
                  )}
                  <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 px-2 py-1 rounded bg-[#0B0D12]/85 border border-[#252B3B] text-[11px] font-medium text-white group-hover:bg-[#EA580C] group-hover:border-[#EA580C] transition-colors">
                    <Play className="w-3 h-3" />
                    Reproduzir
                  </span>
                </button>

                <div className="p-3.5 flex-1 flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold text-white">{st.name}</h3>
                      <span className="text-[10px] font-mono uppercase text-[#F97316] shrink-0">
                        {st.category}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-[#8E97AB] mt-1">
                      {st.rawCode} · {st.fileCount} arquivos · {formatBytes(st.totalBytes)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-[#1E2331]">
                    <button
                      onClick={() => onInspectSpine(st.spine, `${st.name} (${st.rawCode})`)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#1F2536] hover:bg-[#EA580C] rounded-lg transition-colors"
                    >
                      <Play className="w-3.5 h-3.5" />
                      Abrir Player
                    </button>
                    <button
                      onClick={() => onToggleSpineQueue(st.spine)}
                      title={queued ? 'Remover da fila ZIP' : 'Adicionar à fila ZIP'}
                      className={`p-1.5 rounded-lg border transition-colors ${
                        queued
                          ? 'bg-[#16A34A]/15 border-[#16A34A]/40 text-[#86EFAC]'
                          : 'bg-[#181C28] border-[#262D3F] text-[#C9D1E1] hover:text-white'
                      }`}
                    >
                      {queued ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {filteredStatus.length === 0 && (
            <div className="col-span-full py-16 text-center text-sm text-[#8E97AB]">
              Nenhum estado de combate encontrado.
            </div>
          )}
        </div>
      ) : (
        /* Tab 2: Items, Ninja Tools & Runes */
        <>
          <div className="flex items-center justify-between text-xs text-[#8E97AB] font-mono tabular-nums">
            <span>
              Mostrando {formatNumber(pageItems.length)} de {formatNumber(filteredItems.length)} itens
            </span>
            <span>
              Página {safePage} de {totalPages}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {pageItems.map((it) => {
              const fullUrl = resolveCdnUrl(cdnBase, it.url);
              return (
                <button
                  key={it.id}
                  onClick={() => setSelectedItem(it)}
                  className="text-left bg-[#13161F] border border-[#222736] hover:border-[#EA580C] rounded-xl overflow-hidden flex flex-col transition-colors group"
                >
                  <div className="aspect-square checkerboard-bg p-3 flex items-center justify-center relative">
                    <AssetImage
                      src={fullUrl}
                      alt={it.name}
                      className="max-w-full max-h-full object-contain transition-transform duration-200 group-hover:scale-105"
                    />
                    {it.desc && (
                      <span
                        title="Possui descrição em PT-BR"
                        className="absolute top-1.5 left-1.5 w-2 h-2 rounded-full bg-[#EA580C]"
                      />
                    )}
                  </div>
                  <div className="px-2.5 py-2 border-t border-[#1E2331] space-y-0.5">
                    <div className="text-[11px] font-mono text-white truncate" title={it.name}>
                      {it.name}
                    </div>
                    <div className="text-[10px] text-[#8E97AB] truncate">
                      {it.desc ? it.desc : `${it.groupLabel} · ${formatBytes(it.bytes)}`}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {filteredItems.length === 0 && (
            <div className="py-16 text-center text-sm text-[#8E97AB]">
              Nenhum item corresponde à busca.
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-[#13161F] border border-[#222736] hover:border-[#3A435C] disabled:opacity-40 text-white rounded-lg"
              >
                <ChevronLeft className="w-4 h-4" />
                Anterior
              </button>
              <span className="text-xs font-mono tabular-nums text-[#9CA5B9] px-3">
                {safePage} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-[#13161F] border border-[#222736] hover:border-[#3A435C] disabled:opacity-40 text-white rounded-lg"
              >
                Próxima
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      )}

      {/* Item Detail Modal */}
      {selectedItem && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 overscroll-contain"
          onClick={() => setSelectedItem(null)}
        >
          <div
            className="w-full max-w-md bg-[#13161F] border border-[#252B3B] rounded-xl overflow-hidden overscroll-contain"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-[#222736] flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-mono font-semibold text-white truncate">
                  {selectedItem.name}
                </h3>
                <div className="text-xs text-[#8E97AB] mt-0.5">
                  {selectedItem.groupLabel} · {formatBytes(selectedItem.bytes)}
                </div>
              </div>
              <button
                onClick={() => setSelectedItem(null)}
                aria-label="Fechar item"
                className="p-1.5 text-[#8E97AB] hover:text-white rounded-lg hover:bg-[#1D2230]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="h-52 checkerboard-bg border border-[#222736] rounded-lg p-4 flex items-center justify-center">
                {selectedItemResolvedUrl ? (
                  <img
                    src={selectedItemResolvedUrl}
                    alt={selectedItem.name}
                    referrerPolicy="no-referrer"
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <div className="text-xs text-[#8E97AB]">Carregando...</div>
                )}
              </div>

              {selectedItem.desc ? (
                <div className="p-3.5 bg-[#0F1219] border border-[#222736] rounded-lg">
                  <div className="text-[11px] text-[#8E97AB] mb-1">Descrição PT-BR</div>
                  <p className="text-xs text-[#E6E9F0] leading-relaxed whitespace-pre-line">
                    {selectedItem.desc}
                  </p>
                </div>
              ) : (
                <div className="text-xs font-mono text-[#7C859B] break-all">
                  {selectedItem.url}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => triggerAssetDownload(selectedItemRawUrl, selectedItem.name)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-[#EA580C] hover:bg-[#C2410C] rounded-lg transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Baixar Imagem Original
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
