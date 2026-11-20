import {
  BookOpen,
  FileArchive,
  Flame,
  LayoutDashboard,
  Layers,
  Menu,
  Sparkles,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AudioView } from './components/AudioView';
import { EffectsView } from './components/EffectsView';
import { NinjaDetailDrawer } from './components/NinjaDetailDrawer';
import { NinjasView } from './components/NinjasView';
import { type NavSection, OverviewView } from './components/OverviewView';
import { type PlayerTarget, SpinePlayerModal } from './components/SpinePlayerModal';
import { SpinesView } from './components/SpinesView';
import { SummonsView } from './components/SummonsView';
import { TechniquesView } from './components/TechniquesView';
import { ZipExporterView } from './components/ZipExporterView';
import { type FullCatalog, loadStaticCatalog } from './services/catalogEngine';
import type {
  Anim2DBundle,
  AudioRecord,
  NinjaRecord,
  SpineBundle,
  SummonRecord,
  VideoRecord,
  ZipExportItem,
} from './types';
import { formatNumber } from './utils/format';

const SECTION_TITLES: Record<NavSection, string> = {
  overview: 'Visão Geral',
  ninjas: 'Ninjas e Retratos',
  summons: 'Invocações',
  spines: 'Animações Spine',
  effects: 'Habilidades e Efeitos',
  audio: 'Sons e Dublagens',
  techniques: 'Técnicas e Atributos',
  exporter: 'Exportador ZIP',
};

export default function App() {
  const [section, setSection] = useState<NavSection>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [catalog, setCatalog] = useState<FullCatalog | null>(null);
  const [loadingStage, setLoadingStage] = useState('Carregando acervo estático...');
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);

  const [selectedNinja, setSelectedNinja] = useState<NinjaRecord | null>(null);
  const [playerTarget, setPlayerTarget] = useState<PlayerTarget | null>(null);
  const [queue, setQueue] = useState<ZipExportItem[]>([]);

  const loadCatalog = useCallback(async (isReload = false) => {
    if (isReload) setSyncing(true);
    else setLoadingCatalog(true);
    setFatalError(null);
    try {
      const cat = await loadStaticCatalog((stage) => setLoadingStage(stage));
      setCatalog(cat);
    } catch (e) {
      setFatalError(
        e instanceof Error ? e.message : 'Erro ao carregar o manifesto do CDN.'
      );
    } finally {
      setLoadingCatalog(false);
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    loadCatalog(false);
  }, [loadCatalog]);

  const toggleQueueItem = useCallback((item: ZipExportItem) => {
    setQueue((prev) => {
      const exists = prev.some((x) => x.type === item.type && x.id === item.id);
      if (exists) return prev.filter((x) => !(x.type === item.type && x.id === item.id));
      return [...prev, item];
    });
  }, []);

  const queuedNinjaIds = useMemo(
    () => new Set(queue.filter((x) => x.type === 'ninja').map((x) => x.id)),
    [queue]
  );
  const queuedSummonIds = useMemo(
    () => new Set(queue.filter((x) => x.type === 'summon').map((x) => x.id)),
    [queue]
  );
  const queuedSpineIds = useMemo(
    () => new Set(queue.filter((x) => x.type === 'spine').map((x) => x.id)),
    [queue]
  );
  const queuedAnim2dIds = useMemo(
    () => new Set(queue.filter((x) => x.type === 'anim2d').map((x) => x.id)),
    [queue]
  );
  const queuedVideoIds = useMemo(
    () => new Set(queue.filter((x) => x.type === 'video').map((x) => x.id)),
    [queue]
  );
  const queuedAudioIds = useMemo(
    () => new Set(queue.filter((x) => x.type === 'audio').map((x) => x.id)),
    [queue]
  );

  const handleToggleNinja = (ninja: NinjaRecord) => {
    toggleQueueItem({
      type: 'ninja',
      id: ninja.id,
      label: `${ninja.name} (${ninja.id})`,
      estimatedBytes: ninja.totalBytes,
      fileCount: ninja.fileCount,
    });
  };

  const handleToggleSummon = (summon: SummonRecord) => {
    toggleQueueItem({
      type: 'summon',
      id: summon.id,
      label: summon.name,
      estimatedBytes: summon.totalBytes,
      fileCount: summon.fileCount,
    });
  };

  const handleToggleSpine = (bundle: SpineBundle) => {
    toggleQueueItem({
      type: 'spine',
      id: bundle.id,
      label: bundle.name,
      estimatedBytes: bundle.totalBytes,
      fileCount: bundle.allFiles.length,
    });
  };

  const handleToggleAnim2d = (bundle: Anim2DBundle) => {
    toggleQueueItem({
      type: 'anim2d',
      id: bundle.id,
      label: bundle.name,
      estimatedBytes: bundle.totalBytes,
      fileCount: bundle.allFiles.length,
    });
  };

  const handleToggleVideo = (video: VideoRecord) => {
    toggleQueueItem({
      type: 'video',
      id: video.id,
      label: video.filename,
      estimatedBytes: video.bytes,
      fileCount: 1,
    });
  };

  const handleToggleAudio = (audio: AudioRecord) => {
    toggleQueueItem({
      type: 'audio',
      id: audio.id,
      label: audio.filename,
      estimatedBytes: audio.bytes,
      fileCount: 1,
    });
  };

  const handleOpenNinjaById = (heroId: string) => {
    if (!catalog) return;
    const found = catalog.ninjaMap.get(heroId);
    if (found) setSelectedNinja(found);
  };

  const summary = catalog?.summary || null;

  const navItems: Array<{
    key: NavSection;
    label: string;
    icon: typeof LayoutDashboard;
    count?: number;
  }> = [
    { key: 'overview', label: 'Visão Geral', icon: LayoutDashboard },
    { key: 'ninjas', label: 'Ninjas', icon: Users, count: summary?.counts.ninjas },
    { key: 'summons', label: 'Invocações', icon: Flame, count: summary?.counts.summons },
    { key: 'spines', label: 'Animações Spine', icon: Layers, count: summary?.counts.spineModels },
    {
      key: 'effects',
      label: 'Habilidades e Efeitos',
      icon: Sparkles,
      count: summary
        ? summary.counts.spineEffects + summary.counts.anim2d + summary.counts.videos
        : undefined,
    },
    { key: 'audio', label: 'Sons e Dublagens', icon: Volume2, count: summary?.counts.audio },
    {
      key: 'techniques',
      label: 'Técnicas e Atributos',
      icon: BookOpen,
      count: summary?.counts.techniques,
    },
    {
      key: 'exporter',
      label: 'Exportador ZIP',
      icon: FileArchive,
      count: queue.length || undefined,
    },
  ];

  const handleSelectNav = (next: NavSection) => {
    setSection(next);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-[#0B0D12] text-[#E6E9F0] flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-64 shrink-0 border-r border-[#1E2331] bg-[#0F1219] flex-col sticky top-0 h-screen">
        <div className="h-14 px-5 border-b border-[#1E2331] flex items-center">
          <button
            onClick={() => handleSelectNav('overview')}
            className="font-display text-base font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            Shinobi Vault
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = section === item.key;
            return (
              <button
                key={item.key}
                onClick={() => handleSelectNav(item.key)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  active
                    ? 'bg-[#EA580C]/15 text-white font-medium'
                    : 'text-[#9CA5B9] hover:text-white hover:bg-[#161A25]'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Icon
                    className={`w-4 h-4 shrink-0 ${active ? 'text-[#F97316]' : 'text-[#7C859B]'}`}
                  />
                  <span className="truncate">{item.label}</span>
                </span>
                {typeof item.count === 'number' && (
                  <span
                    className={`text-[11px] font-mono tabular-nums shrink-0 ${
                      active ? 'text-[#FB923C]' : 'text-[#6E778C]'
                    }`}
                  >
                    {formatNumber(item.count)}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-[#1E2331] text-[11px] text-[#7C859B] space-y-1">
          <div className="font-mono truncate">naruto.jotagame.com</div>
          {summary && (
            <div className="font-mono tabular-nums">
              {formatNumber(summary.totalFiles)} arquivos · 100% Estático
            </div>
          )}
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden bg-black/70 flex"
          onClick={() => setMobileMenuOpen(false)}
        >
          <aside
            className="w-72 max-w-[82vw] bg-[#0F1219] border-r border-[#1E2331] flex flex-col h-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-14 px-5 border-b border-[#1E2331] flex items-center justify-between">
              <span className="font-display text-base font-bold text-white">Shinobi Vault</span>
              <button
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Fechar menu"
                className="p-2 text-[#9CA5B9] hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = section === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => handleSelectNav(item.key)}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-3 rounded-lg text-sm transition-colors ${
                      active
                        ? 'bg-[#EA580C]/15 text-white font-medium'
                        : 'text-[#9CA5B9] hover:text-white hover:bg-[#161A25]'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <Icon
                        className={`w-4 h-4 shrink-0 ${
                          active ? 'text-[#F97316]' : 'text-[#7C859B]'
                        }`}
                      />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {typeof item.count === 'number' && (
                      <span className="text-[11px] font-mono tabular-nums text-[#7C859B]">
                        {formatNumber(item.count)}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 px-4 sm:px-6 border-b border-[#1E2331] bg-[#0B0D12]/95 sticky top-0 z-30 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Abrir navegação"
              className="lg:hidden p-2 -ml-1 text-[#9CA5B9] hover:text-white rounded-lg hover:bg-[#161A25]"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-[#7C859B] hidden sm:inline whitespace-nowrap">Acervo</span>
              <span className="text-[#4B5469] hidden sm:inline" aria-hidden="true">
                /
              </span>
              <span className="font-medium text-white truncate">{SECTION_TITLES[section]}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={() => handleSelectNav('exporter')}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-white bg-[#EA580C] hover:bg-[#C2410C] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <FileArchive className="w-3.5 h-3.5" />
              <span>Exportar ZIP{queue.length > 0 ? ` (${queue.length})` : ''}</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {loadingCatalog ? (
            <div className="py-24 text-center space-y-3">
              <div className="text-sm font-medium text-white">{loadingStage}</div>
              <p className="text-xs text-[#8E97AB]">
                Tudo funciona direto no navegador sem servidor — compatível com GitHub Pages e celular.
              </p>
            </div>
          ) : fatalError || !catalog ? (
            <div className="p-6 bg-[#1F1215] border border-[#4C1D24] rounded-xl text-center space-y-3">
              <p className="text-sm text-[#FCA5A5]">
                {fatalError || 'Não foi possível carregar o catálogo.'}
              </p>
              <button
                onClick={() => loadCatalog(false)}
                className="px-4 py-2 text-xs font-medium text-white bg-[#EA580C] hover:bg-[#C2410C] rounded-lg"
              >
                Tentar Novamente
              </button>
            </div>
          ) : (
            <>
              {section === 'overview' && (
                <OverviewView
                  catalog={catalog}
                  syncing={syncing}
                  onSync={() => loadCatalog(true)}
                  onNavigate={handleSelectNav}
                />
              )}

              {section === 'ninjas' && (
                <NinjasView
                  catalog={catalog}
                  queuedIds={queuedNinjaIds}
                  onToggleQueue={handleToggleNinja}
                  onSelectNinja={setSelectedNinja}
                  onInspectSpine={(bundle, title) =>
                    setPlayerTarget({ mode: 'spine', bundle, title })
                  }
                />
              )}

              {section === 'summons' && (
                <SummonsView
                  catalog={catalog}
                  queuedIds={queuedSummonIds}
                  onToggleQueue={handleToggleSummon}
                  onInspectSpine={(bundle, title) =>
                    setPlayerTarget({ mode: 'spine', bundle, title })
                  }
                />
              )}

              {section === 'spines' && (
                <SpinesView
                  catalog={catalog}
                  queuedIds={queuedSpineIds}
                  onToggleQueue={handleToggleSpine}
                  onInspectSpine={(bundle, title) =>
                    setPlayerTarget({ mode: 'spine', bundle, title })
                  }
                />
              )}

              {section === 'effects' && (
                <EffectsView
                  catalog={catalog}
                  queuedSpineIds={queuedSpineIds}
                  queuedAnim2dIds={queuedAnim2dIds}
                  queuedVideoIds={queuedVideoIds}
                  onToggleSpineQueue={handleToggleSpine}
                  onToggleAnim2dQueue={handleToggleAnim2d}
                  onToggleVideoQueue={handleToggleVideo}
                  onInspectSpine={(bundle, title) =>
                    setPlayerTarget({ mode: 'spine', bundle, title })
                  }
                  onInspectAnim2d={(bundle, title) =>
                    setPlayerTarget({ mode: 'anim2d', bundle, title })
                  }
                />
              )}

              {section === 'audio' && (
                <AudioView
                  catalog={catalog}
                  queuedIds={queuedAudioIds}
                  onToggleQueue={handleToggleAudio}
                />
              )}

              {section === 'techniques' && (
                <TechniquesView catalog={catalog} onOpenNinjaById={handleOpenNinjaById} />
              )}

              {section === 'exporter' && (
                <ZipExporterView
                  catalog={catalog}
                  queue={queue}
                  onRemoveItem={(type, id) =>
                    setQueue((prev) => prev.filter((x) => !(x.type === type && x.id === id)))
                  }
                  onClearQueue={() => setQueue([])}
                />
              )}
            </>
          )}
        </main>
      </div>

      {catalog && (
        <>
          <NinjaDetailDrawer
            ninja={selectedNinja}
            catalog={catalog}
            isQueued={selectedNinja ? queuedNinjaIds.has(selectedNinja.id) : false}
            onToggleQueue={handleToggleNinja}
            onInspectSpine={(bundle, title) => setPlayerTarget({ mode: 'spine', bundle, title })}
            onClose={() => setSelectedNinja(null)}
          />

          <SpinePlayerModal
            target={playerTarget}
            catalog={catalog}
            onClose={() => setPlayerTarget(null)}
          />
        </>
      )}
    </div>
  );
}
