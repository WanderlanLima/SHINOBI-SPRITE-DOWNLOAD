import {
  ChevronLeft,
  ChevronRight,
  Download,
  Image as ImageIcon,
  Maximize2,
  Search,
  Type,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { triggerAssetDownload, useResolvedAssetUrl } from '../services/assetSource';
import type { FullCatalog } from '../services/catalogEngine';
import type { FontAssetRecord, VisualAssetCategory, VisualAssetRecord } from '../types';
import { formatBytes, formatNumber, resolveCdnUrl } from '../utils/format';
import { lockBodyScroll } from '../utils/scrollLock';
import { AssetImage } from './AssetImage';

interface VisualGalleryViewProps {
  catalog: FullCatalog;
}

type GalleryTab = VisualAssetCategory | 'fontes';
type BgMode = 'checker' | 'dark' | 'light';

const TAB_CONFIG: Array<{
  key: GalleryTab;
  label: string;
  description: string;
}> = [
  {
    key: 'arenas_fundos',
    label: 'Arenas e Fundos',
    description: 'Cenários de batalha, telas de carregamento, mapas principais e fundos de interface.',
  },
  {
    key: 'mapas_vivos',
    label: 'Mapas Vivos',
    description: 'Camadas parallax, vilas animadas, céu, água e estruturas de cenários interativos.',
  },
  {
    key: 'historia_dialogos',
    label: 'História e Diálogos',
    description: 'Ilustrações de capítulos, eventos paralelos e expressões de diálogos.',
  },
  {
    key: 'titulos_molduras',
    label: 'Títulos e Molduras',
    description: 'Títulos de ranking, molduras de avatar, emblemas, selos e ícones de interface.',
  },
  {
    key: 'artes_ptbr',
    label: 'Artes PT-BR',
    description: 'Banners localizados em Português, letreiros de eventos, botões e títulos de habilidades.',
  },
  {
    key: 'modos_extras',
    label: 'Modos Extras',
    description: 'Monte Myouboku, Fazenda, Templo, Minijogos, Transformações e sistemas especiais.',
  },
  {
    key: 'fontes',
    label: 'Fontes e Dano',
    description: 'Arquivos TrueType (.ttf) e fontes bitmap de números de dano, crítico e combo.',
  },
];

const PAGE_SIZE = 48;

export function VisualGalleryView({ catalog }: VisualGalleryViewProps) {
  const [tab, setTab] = useState<GalleryTab>('arenas_fundos');
  const [search, setSearch] = useState('');
  const [subfolder, setSubfolder] = useState('all');
  const [page, setPage] = useState(1);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [bgMode, setBgMode] = useState<BgMode>('checker');
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [selectedFont, setSelectedFont] = useState<FontAssetRecord | null>(null);

  const cdnBase = catalog.summary.cdnBase;

  const countsByTab = useMemo(() => {
    const map: Record<GalleryTab, number> = {
      arenas_fundos: 0,
      mapas_vivos: 0,
      historia_dialogos: 0,
      titulos_molduras: 0,
      artes_ptbr: 0,
      modos_extras: 0,
      fontes: catalog.fontAssets.length,
    };
    for (const a of catalog.visualAssets) {
      map[a.category] = (map[a.category] || 0) + 1;
    }
    return map;
  }, [catalog.visualAssets, catalog.fontAssets.length]);

  const tabAssets = useMemo<VisualAssetRecord[]>(() => {
    if (tab === 'fontes') return [];
    return catalog.visualAssets.filter((a) => a.category === tab);
  }, [catalog.visualAssets, tab]);

  const subfolders = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of tabAssets) {
      counts.set(a.subfolder, (counts.get(a.subfolder) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40);
  }, [tabAssets]);

  const filteredAssets = useMemo(() => {
    if (tab === 'fontes') return [];
    const q = search.trim().toLowerCase();
    return tabAssets.filter((a) => {
      if (subfolder !== 'all' && a.subfolder !== subfolder) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        a.subfolder.toLowerCase().includes(q) ||
        a.url.toLowerCase().includes(q)
      );
    });
  }, [tab, tabAssets, subfolder, search]);

  const filteredFonts = useMemo(() => {
    if (tab !== 'fontes') return [];
    const q = search.trim().toLowerCase();
    if (!q) return catalog.fontAssets;
    return catalog.fontAssets.filter(
      (f) => f.name.toLowerCase().includes(q) || f.kind.toLowerCase().includes(q)
    );
  }, [tab, catalog.fontAssets, search]);

  const totalPages = Math.max(1, Math.ceil(filteredAssets.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageAssets = useMemo(
    () => filteredAssets.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredAssets, safePage]
  );

  const lightboxAsset =
    lightboxIndex !== null && lightboxIndex >= 0 && lightboxIndex < pageAssets.length
      ? pageAssets[lightboxIndex]
      : null;

  const lightboxRawUrl = lightboxAsset ? resolveCdnUrl(cdnBase, lightboxAsset.url) : '';
  const lightboxResolvedUrl = useResolvedAssetUrl(lightboxRawUrl);
  const selectedFontPreviewRawUrl = selectedFont?.previewUrl
    ? resolveCdnUrl(cdnBase, selectedFont.previewUrl)
    : '';
  const selectedFontPreviewResolvedUrl = useResolvedAssetUrl(selectedFontPreviewRawUrl);

  useEffect(() => {
    if (!lightboxAsset && !selectedFont) return;
    return lockBodyScroll();
  }, [lightboxAsset, selectedFont]);

  useEffect(() => {
    if (!lightboxAsset) return;
    setNaturalSize(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxIndex(null);
      if (e.key === 'ArrowLeft') {
        setLightboxIndex((idx) =>
          idx === null ? null : (idx - 1 + pageAssets.length) % pageAssets.length
        );
      }
      if (e.key === 'ArrowRight') {
        setLightboxIndex((idx) =>
          idx === null ? null : (idx + 1) % pageAssets.length
        );
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightboxAsset, pageAssets.length]);

  useEffect(() => {
    if (!selectedFont) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedFont(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedFont]);

  const activeMeta = TAB_CONFIG.find((t) => t.key === tab) || TAB_CONFIG[0];

  const handleSelectTab = (next: GalleryTab) => {
    setTab(next);
    setSubfolder('all');
    setSearch('');
    setPage(1);
    setLightboxIndex(null);
  };

  const stageBgClass =
    bgMode === 'checker'
      ? 'checkerboard-bg'
      : bgMode === 'light'
      ? 'bg-[#EAECEF]'
      : 'bg-[#090B10]';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-white">
            Cenários, UI, Artes PT-BR e Fontes
          </h1>
          <p className="text-xs sm:text-sm text-[#8E97AB] mt-1">
            {activeMeta.description}
          </p>
        </div>
        <div className="text-xs font-mono tabular-nums text-[#7C859B] shrink-0">
          {formatNumber(catalog.visualAssets.length)} imagens · {formatNumber(catalog.fontAssets.length)} fontes
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {TAB_CONFIG.map((item) => {
          const active = tab === item.key;
          return (
            <button
              key={item.key}
              onClick={() => handleSelectTab(item.key)}
              className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? 'bg-[#EA580C] border-[#EA580C] text-white'
                  : 'bg-[#13161F] border-[#222736] text-[#A8B1C6] hover:text-white hover:border-[#323A52]'
              }`}
            >
              <span>{item.label}</span>
              <span
                className={`font-mono tabular-nums text-[11px] ${
                  active ? 'text-white/90' : 'text-[#7C859B]'
                }`}
              >
                {formatNumber(countsByTab[item.key])}
              </span>
            </button>
          );
        })}
      </div>

      {/* Filter Toolbar */}
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
              tab === 'fontes'
                ? 'Buscar fonte (.ttf, dano, combo, crit)...'
                : 'Buscar por nome de arquivo ou pasta...'
            }
            className="w-full pl-9 pr-3 py-2 text-sm bg-[#13161F] border border-[#222736] focus:border-[#EA580C] rounded-lg text-white placeholder-[#6E778C] outline-none"
          />
        </div>

        {tab !== 'fontes' && subfolders.length > 1 && (
          <select
            value={subfolder}
            onChange={(e) => {
              setSubfolder(e.target.value);
              setPage(1);
            }}
            aria-label="Filtrar subpasta"
            className="px-3 py-2 text-xs font-mono bg-[#13161F] border border-[#222736] focus:border-[#EA580C] rounded-lg text-[#D7DCE8] outline-none"
          >
            <option value="all">Todas as subpastas ({tabAssets.length})</option>
            {subfolders.map(([folder, count]) => (
              <option key={folder} value={folder}>
                {folder} ({count})
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Content */}
      {tab === 'fontes' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredFonts.map((font) => {
            const fullUrl = resolveCdnUrl(cdnBase, font.fileUrl);
            const previewSrc = font.previewUrl ? resolveCdnUrl(cdnBase, font.previewUrl) : null;
            return (
              <div
                key={font.id}
                className="bg-[#13161F] border border-[#222736] hover:border-[#343D56] rounded-xl overflow-hidden flex flex-col transition-colors"
              >
                <div
                  onClick={() => setSelectedFont(font)}
                  className="h-36 checkerboard-bg border-b border-[#222736] p-3 flex items-center justify-center cursor-pointer relative group"
                >
                  {previewSrc ? (
                    <AssetImage
                      src={previewSrc}
                      alt={font.name}
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <div className="text-center space-y-1">
                      <Type className="w-8 h-8 text-[#F97316] mx-auto" />
                      <div className="text-xs font-mono text-[#D7DCE8]">
                        {font.fileUrl.endsWith('.woff2')
                          ? 'WebFont (.woff2)'
                          : font.fileUrl.endsWith('.json')
                          ? 'Índice de Fontes (.json)'
                          : 'TrueType Font (.ttf)'}
                      </div>
                      <div className="text-[11px] text-[#7C859B]">Aa Bb Cc · 0123456789</div>
                    </div>
                  )}
                  <span className="absolute top-2 right-2 p-1.5 rounded bg-[#0B0D12]/80 text-[#C9D1E1] opacity-0 group-hover:opacity-100 transition-opacity">
                    <Maximize2 className="w-3.5 h-3.5" />
                  </span>
                </div>

                <div className="p-3.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-mono text-white truncate" title={font.name}>
                      {font.name}
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-[#8E97AB] mt-0.5">
                      {font.kind === 'bitmap'
                        ? 'Bitmap (.fnt + textura)'
                        : font.fileUrl.endsWith('.woff2')
                        ? 'WebFont (.woff2)'
                        : font.fileUrl.endsWith('.json')
                        ? 'Mapa JSON'
                        : 'TTF Vetorial'}{' '}
                      · {font.allFiles.length} arq · {formatBytes(font.totalBytes)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => triggerAssetDownload(fullUrl, font.name)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-white bg-[#1D2230] hover:bg-[#EA580C] rounded-lg transition-colors shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Baixar
                  </button>
                </div>
              </div>
            );
          })}
          {filteredFonts.length === 0 && (
            <div className="col-span-full py-16 text-center text-sm text-[#8E97AB]">
              Nenhuma fonte encontrada para &quot;{search}&quot;.
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between text-xs text-[#8E97AB] font-mono tabular-nums">
            <span>
              Mostrando {formatNumber(pageAssets.length)} de {formatNumber(filteredAssets.length)} arquivos
            </span>
            <span>
              Página {safePage} de {totalPages}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
            {pageAssets.map((asset, idx) => {
              const fullUrl = resolveCdnUrl(cdnBase, asset.url);
              return (
                <div
                  key={asset.id}
                  className="bg-[#13161F] border border-[#222736] hover:border-[#EA580C] rounded-xl overflow-hidden flex flex-col group transition-colors"
                >
                  <button
                    onClick={() => setLightboxIndex(idx)}
                    className="aspect-[4/3] checkerboard-bg p-2 relative overflow-hidden flex items-center justify-center w-full"
                    title={`Ampliar ${asset.name}`}
                  >
                    <AssetImage
                      src={fullUrl}
                      alt={asset.name}
                      className="max-w-full max-h-full object-contain transition-transform duration-200 group-hover:scale-105"
                    />
                    <span className="absolute top-1.5 right-1.5 p-1 rounded bg-[#0B0D12]/80 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                      <Maximize2 className="w-3 h-3" />
                    </span>
                  </button>

                  <div className="px-2.5 py-2 border-t border-[#1E2331] flex items-center justify-between gap-1.5">
                    <div className="min-w-0">
                      <div
                        className="text-[11px] font-mono text-[#E6E9F0] truncate"
                        title={asset.name}
                      >
                        {asset.name}
                      </div>
                      <div className="text-[10px] font-mono tabular-nums text-[#7C859B] truncate">
                        {asset.subfolder} · {formatBytes(asset.bytes)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        triggerAssetDownload(fullUrl, asset.name);
                      }}
                      className="p-1 text-[#8E97AB] hover:text-white shrink-0"
                      title="Baixar imagem original"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {filteredAssets.length === 0 && (
            <div className="py-16 text-center text-sm text-[#8E97AB]">
              Nenhuma imagem encontrada para os filtros selecionados.
            </div>
          )}

          {/* Pagination */}
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

      {/* Lightbox Modal for Visual Assets */}
      {lightboxAsset && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-0 sm:p-4 overscroll-contain"
          onClick={() => setLightboxIndex(null)}
        >
          <div
            className="w-full h-[100dvh] sm:h-[88vh] sm:max-w-5xl bg-[#13161F] sm:border sm:border-[#252B3B] sm:rounded-xl flex flex-col overflow-hidden overscroll-contain"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top Bar */}
            <div className="shrink-0 px-4 sm:px-5 py-3 border-b border-[#222736] flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-[#F97316] shrink-0" />
                  <h2 className="text-sm font-mono font-semibold text-white truncate">
                    {lightboxAsset.name}
                  </h2>
                </div>
                <div className="text-[11px] font-mono tabular-nums text-[#8E97AB] mt-0.5 truncate">
                  {lightboxAsset.url} · {formatBytes(lightboxAsset.bytes)}
                  {naturalSize ? ` · ${naturalSize.w}×${naturalSize.h}px` : ''}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="hidden sm:flex items-center gap-0.5 p-0.5 bg-[#0F1219] border border-[#222736] rounded-md">
                  {(
                    [
                      ['checker', 'Xadrez'],
                      ['dark', 'Escuro'],
                      ['light', 'Claro'],
                    ] as const
                  ).map(([bg, label]) => (
                    <button
                      key={bg}
                      onClick={() => setBgMode(bg)}
                      className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                        bgMode === bg ? 'bg-[#262D3F] text-white' : 'text-[#8E97AB] hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => triggerAssetDownload(lightboxRawUrl, lightboxAsset.name)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#EA580C] hover:bg-[#C2410C] rounded-lg transition-colors whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  Baixar Original
                </button>

                <button
                  onClick={() => setLightboxIndex(null)}
                  aria-label="Fechar visualização"
                  className="p-2 text-[#8E97AB] hover:text-white rounded-lg hover:bg-[#1D2230]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Stage */}
            <div
              className={`flex-1 min-h-0 relative flex items-center justify-center p-6 overflow-hidden ${stageBgClass}`}
            >
              {lightboxResolvedUrl ? (
                <img
                  src={lightboxResolvedUrl}
                  alt={lightboxAsset.name}
                  referrerPolicy="no-referrer"
                  onLoad={(e) => {
                    const el = e.currentTarget;
                    setNaturalSize({ w: el.naturalWidth, h: el.naturalHeight });
                  }}
                  className="max-w-full max-h-full object-contain"
                />
              ) : (
                <div className="text-xs text-[#8E97AB]">Carregando imagem do acervo...</div>
              )}

              {pageAssets.length > 1 && (
                <>
                  <button
                    onClick={() =>
                      setLightboxIndex((idx) =>
                        idx === null ? null : (idx - 1 + pageAssets.length) % pageAssets.length
                      )
                    }
                    aria-label="Imagem anterior"
                    className="absolute left-3 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-[#0B0D12]/80 hover:bg-[#EA580C] text-white border border-[#252B3B] transition-colors"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() =>
                      setLightboxIndex((idx) =>
                        idx === null ? null : (idx + 1) % pageAssets.length
                      )
                    }
                    aria-label="Próxima imagem"
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-[#0B0D12]/80 hover:bg-[#EA580C] text-white border border-[#252B3B] transition-colors"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </>
              )}
            </div>

            {/* Bottom Strip */}
            <div className="shrink-0 px-4 sm:px-5 py-2.5 bg-[#0F1219] border-t border-[#222736] flex items-center justify-between text-xs font-mono text-[#8E97AB]">
              <span>
                Pasta: <span className="text-[#D7DCE8]">{lightboxAsset.subfolder}</span>
              </span>
              <span className="tabular-nums">
                {(lightboxIndex ?? 0) + 1} / {pageAssets.length} na página
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Font Detail Modal */}
      {selectedFont && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 overscroll-contain"
          onClick={() => setSelectedFont(null)}
        >
          <div
            className="w-full max-w-2xl bg-[#13161F] border border-[#252B3B] rounded-xl overflow-hidden flex flex-col max-h-[85vh] overscroll-contain"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-[#222736] flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-mono font-semibold text-white truncate">
                  {selectedFont.name}
                </h3>
                <div className="text-xs font-mono text-[#8E97AB] mt-0.5">
                  {selectedFont.kind === 'ttf' ? 'Fonte TrueType (.ttf)' : 'Fonte Bitmap (.fnt)'} ·{' '}
                  {formatBytes(selectedFont.totalBytes)}
                </div>
              </div>
              <button
                onClick={() => setSelectedFont(null)}
                aria-label="Fechar detalhes da fonte"
                className="p-1.5 text-[#8E97AB] hover:text-white rounded-lg hover:bg-[#1D2230]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-5 space-y-4">
              {selectedFont.previewUrl && selectedFontPreviewResolvedUrl && (
                <div className="checkerboard-bg border border-[#222736] rounded-lg p-4 flex justify-center">
                  <img
                    src={selectedFontPreviewResolvedUrl}
                    alt={selectedFont.name}
                    referrerPolicy="no-referrer"
                    className="max-h-72 object-contain"
                  />
                </div>
              )}

              <div className="space-y-2">
                <div className="text-xs font-medium text-[#9CA5B9]">
                  Arquivos do pacote ({selectedFont.allFiles.length})
                </div>
                <div className="divide-y divide-[#1E2331] border border-[#222736] rounded-lg bg-[#0F1219]">
                  {selectedFont.allFiles.map((f) => (
                    <div
                      key={f.url}
                      className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-white truncate">{f.name}</div>
                        <div className="font-mono text-[11px] text-[#7C859B] truncate">{f.url}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => triggerAssetDownload(resolveCdnUrl(cdnBase, f.url), f.name)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-white bg-[#1D2230] hover:bg-[#EA580C] rounded-md shrink-0"
                      >
                        <Download className="w-3.5 h-3.5" />
                        {formatBytes(f.bytes)}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
