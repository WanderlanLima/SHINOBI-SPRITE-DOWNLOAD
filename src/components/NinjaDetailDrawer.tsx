import {
  Check,
  Download,
  FileArchive,
  Film,
  Play,
  Plus,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useResolvedAssetUrl } from '../services/assetSource';
import type { FullCatalog } from '../services/catalogEngine';
import { downloadCustomRequestZip, type ZipProgress } from '../services/clientZipper';
import type { AudioRecord, NinjaRecord, SpineBundle, VideoRecord } from '../types';
import { formatBytes, resolveCdnUrl } from '../utils/format';
import { lockBodyScroll } from '../utils/scrollLock';
import type { DiscoveredSkeletonResources } from '../utils/spineCmdParser';
import { AssetImage } from './AssetImage';
import { NinjaSkillShowcase } from './NinjaSkillShowcase';

function DrawerVideoCard({ vid, cdnBase }: { vid: VideoRecord; cdnBase: string }) {
  const src = useResolvedAssetUrl(resolveCdnUrl(cdnBase, vid.url));
  return (
    <div className="bg-[#151924] border border-[#222736] rounded-lg overflow-hidden flex flex-col">
      {src ? (
        <video
          controls
          preload="none"
          playsInline
          src={src}
          className="w-full aspect-video bg-[#090B10] object-contain"
        />
      ) : (
        <div className="w-full aspect-video bg-[#090B10] flex items-center justify-center text-xs text-[#7C859B]">
          Carregando vídeo...
        </div>
      )}
      <div className="px-3 py-2 border-t border-[#222736] flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 min-w-0">
          <Film className="w-3.5 h-3.5 text-[#F97316] shrink-0" />
          <span className="font-mono text-white truncate" title={vid.filename}>
            {vid.filename}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] font-mono tabular-nums text-[#8E97AB]">
            {formatBytes(vid.bytes)}
          </span>
          {src && (
            <a
              href={src}
              download={vid.filename}
              target="_blank"
              rel="noreferrer"
              className="text-[#9CA5B9] hover:text-white"
              title="Baixar vídeo MP4"
            >
              <Download className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function DrawerAudioCard({ aud, cdnBase }: { aud: AudioRecord; cdnBase: string }) {
  const src = useResolvedAssetUrl(resolveCdnUrl(cdnBase, aud.url));
  return (
    <div className="p-3 bg-[#151924] border border-[#222736] rounded-lg flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <Volume2 className="w-3.5 h-3.5 text-[#F97316] shrink-0" />
          <span className="font-mono text-white truncate">{aud.filename}</span>
          <span className="text-[#8E97AB] shrink-0">· {aud.categoryLabel}</span>
        </div>
        {src && (
          <a
            href={src}
            download={aud.filename}
            target="_blank"
            rel="noreferrer"
            className="text-[#9CA5B9] hover:text-white inline-flex items-center gap-1 shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            MP3
          </a>
        )}
      </div>
      {src ? (
        <audio controls preload="none" src={src} className="w-full h-8" />
      ) : (
        <div className="h-8 flex items-center text-[11px] text-[#7C859B]">
          Preparando áudio do backup...
        </div>
      )}
    </div>
  );
}

interface NinjaDetailDrawerProps {
  ninja: NinjaRecord | null;
  catalog: FullCatalog;
  isQueued: boolean;
  onToggleQueue: (ninja: NinjaRecord) => void;
  onInspectSpine: (bundle: SpineBundle, title: string, initialAnim?: string) => void;
  onClose: () => void;
}

export function NinjaDetailDrawer({
  ninja,
  catalog,
  isQueued,
  onToggleQueue,
  onInspectSpine,
  onClose,
}: NinjaDetailDrawerProps) {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<ZipProgress | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [discoveredResources, setDiscoveredResources] =
    useState<DiscoveredSkeletonResources | null>(null);

  useEffect(() => {
    setDiscoveredResources(null);
  }, [ninja?.id]);

  const handleSkeletonResourcesDiscovered = useCallback(
    (res: DiscoveredSkeletonResources) => {
      setDiscoveredResources(res);
    },
    []
  );

  useEffect(() => {
    if (!ninja) return;
    return lockBodyScroll();
  }, [ninja]);

  const mergedEffects = useMemo<SpineBundle[]>(() => {
    if (!ninja) return [];
    const byId = new Map<string, SpineBundle>();
    if (discoveredResources) {
      for (const spineName of discoveredResources.vfxSpineNames) {
        const hit = catalog.spineByNameMap.get(spineName.toLowerCase());
        if (hit && !byId.has(hit.id)) byId.set(hit.id, hit);
      }
    }
    for (const eff of ninja.linkedEffects) {
      if (!byId.has(eff.id)) byId.set(eff.id, eff);
    }
    return [...byId.values()];
  }, [ninja, discoveredResources, catalog.spineByNameMap]);

  const mergedVideos = useMemo<VideoRecord[]>(() => {
    if (!ninja) return [];
    const byId = new Map<string, VideoRecord>();
    if (discoveredResources && discoveredResources.videoSources.length > 0) {
      const videoByStem = new Map<string, VideoRecord>();
      for (const v of catalog.videos) {
        videoByStem.set(v.filename.replace(/\.mp4$/i, '').toLowerCase(), v);
      }
      for (const source of discoveredResources.videoSources) {
        const hit = videoByStem.get(source.toLowerCase());
        if (hit && !byId.has(hit.id)) byId.set(hit.id, hit);
      }
    }
    for (const vid of ninja.linkedVideos) {
      if (!byId.has(vid.id)) byId.set(vid.id, vid);
    }
    return [...byId.values()];
  }, [ninja, discoveredResources, catalog.videos]);

  if (!ninja) return null;

  const cdnBase = catalog.summary.cdnBase;

  const handleDownloadNinjaZip = async () => {
    setDownloading(true);
    setProgress(null);
    setDownloadError(null);
    try {
      await downloadCustomRequestZip(
        catalog,
        {
          archiveName: `ninja_${ninja.id}_${ninja.name}`,
          imageFormat: 'webp',
          includeDatabase: false,
          ninjaIds: [ninja.id],
          includeNinjaPortraits: true,
          includeNinjaSpine: true,
          includeNinjaAudio: true,
        },
        (p) => setProgress(p)
      );
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : 'Erro ao exportar ZIP.');
    } finally {
      setDownloading(false);
      setProgress(null);
    }
  };

  const uniqueWebpPortraits = ninja.portraits.filter((p) => p.ext === 'webp');
  const displayPortraits = uniqueWebpPortraits.length > 0 ? uniqueWebpPortraits : ninja.portraits;

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/65 overscroll-contain"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl h-full bg-[#11141C] border-l border-[#222736] flex flex-col overflow-hidden overscroll-contain"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#222736] flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-white truncate">{ninja.name}</h2>
            <div className="flex flex-wrap items-center gap-2 text-xs text-[#8E97AB] font-mono tabular-nums mt-0.5">
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
                  <span>Crescimento {ninja.growvalue}</span>
                </>
              )}
              {ninja.leveluprate !== null && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Taxa/Nv {ninja.leveluprate}</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>{ninja.fileCount} arquivos</span>
              <span aria-hidden="true">·</span>
              <span>{formatBytes(ninja.totalBytes)}</span>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Fechar ficha"
            className="p-2 text-[#8E97AB] hover:text-white rounded-lg hover:bg-[#1B202E]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Strip */}
        <div className="px-6 py-3 bg-[#0E1118] border-b border-[#222736] flex flex-wrap items-center gap-2.5">
          <button
            onClick={handleDownloadNinjaZip}
            disabled={downloading}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-[#EA580C] hover:bg-[#C2410C] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
          >
            <FileArchive className="w-4 h-4" />
            {downloading && progress
              ? `Compactando ${progress.completed}/${progress.total}...`
              : downloading
              ? 'Gerando ZIP do Ninja...'
              : 'Baixar ZIP Organizado do Ninja'}
          </button>

          <button
            onClick={() => onToggleQueue(ninja)}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
              isQueued
                ? 'bg-[#16A34A]/15 border-[#16A34A]/40 text-[#86EFAC]'
                : 'bg-[#181C28] border-[#262D3F] text-[#D7DCE8] hover:bg-[#22283A]'
            }`}
          >
            {isQueued ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {isQueued ? 'Na Fila de Exportação' : 'Adicionar à Fila ZIP'}
          </button>

          {downloadError && (
            <span className="text-xs text-[#FCA5A5]">{downloadError}</span>
          )}
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y px-6 py-5 space-y-7">
          {/* Hero Visual + Name Banner */}
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-4 items-stretch">
            <div className="sm:col-span-2 aspect-square rounded-lg border border-[#222736] checkerboard-bg overflow-hidden p-2">
              <AssetImage
                src={resolveCdnUrl(cdnBase, ninja.portraitUrl || ninja.avatarUrl)}
                alt={ninja.name}
                fallbackLabel={ninja.id}
                className="w-full h-full object-contain"
              />
            </div>
            <div className="sm:col-span-3 flex flex-col justify-between gap-3 bg-[#151924] border border-[#222736] rounded-lg p-4">
              <div>
                <div className="text-xs text-[#8E97AB] mb-2">Atributos e Ficha Técnica</div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
                  <div>
                    <dt className="text-[11px] text-[#7E879D]">Identificador</dt>
                    <dd className="font-mono tabular-nums text-white">{ninja.id}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-[#7E879D]">Função em Combate</dt>
                    <dd className="text-white uppercase">{ninja.role || 'Não informada'}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-[#7E879D]">Valor de Crescimento</dt>
                    <dd className="font-mono tabular-nums text-white">
                      {ninja.growvalue !== null ? ninja.growvalue : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-[#7E879D]">Taxa de Nível</dt>
                    <dd className="font-mono tabular-nums text-white">
                      {ninja.leveluprate !== null ? `${ninja.leveluprate}x` : '—'}
                    </dd>
                  </div>
                </dl>
                {ninja.desc && (
                  <p className="text-xs text-[#A8B1C6] leading-relaxed mt-3 pt-3 border-t border-[#222736] whitespace-pre-line">
                    {ninja.desc}
                  </p>
                )}
              </div>

              {ninja.nameBannerUrl && (
                <div className="pt-2 border-t border-[#222736]">
                  <AssetImage
                    src={resolveCdnUrl(cdnBase, ninja.nameBannerUrl)}
                    alt={`Banner PT-BR ${ninja.name}`}
                    className="h-9 object-contain"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Interactive Skill Icons & Live Animation Preview (like in-game!) */}
          <section>
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-sm font-semibold text-white">
                Habilidades ({ninja.skillSlots.length})
              </h3>
              <span className="text-xs text-[#7E879D]">
                Clique nos ícones para ver a animação
              </span>
            </div>
            <NinjaSkillShowcase
              ninja={ninja}
              catalog={catalog}
              onOpenFullPlayer={onInspectSpine}
              onSkeletonResourcesDiscovered={handleSkeletonResourcesDiscovered}
            />
          </section>

          {/* Spine Animations */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">
                Sprites Animados Spine ({ninja.spineBundles.length})
              </h3>
              <span className="text-xs text-[#7E879D]">Todas as faixas e extração</span>
            </div>
            {ninja.spineBundles.length === 0 ? (
              <div className="p-4 text-xs text-[#7E879D] bg-[#151924] border border-[#222736] rounded-lg">
                Nenhum modelo Spine indexado diretamente por ID numérico (`vdfno_{ninja.id}`). Verifique a aba Animações Spine para buscar pelo nome em pinyin do personagem.
              </div>
            ) : (
              <div className="space-y-2">
                {ninja.spineBundles.map((sp) => (
                  <div
                    key={sp.id}
                    className="flex items-center justify-between gap-3 px-4 py-3 bg-[#151924] border border-[#222736] rounded-lg"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-mono text-white truncate">{sp.name}</div>
                      <div className="text-xs text-[#8E97AB] font-mono tabular-nums mt-0.5">
                        {sp.kind === 'hd' ? 'Spine HD' : 'Spine Batalha'} · {sp.allFiles.length} arquivos ·{' '}
                        {formatBytes(sp.totalBytes)}
                      </div>
                    </div>
                    <button
                      onClick={() => onInspectSpine(sp, `${ninja.name} (${sp.name})`)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#1F2536] hover:bg-[#EA580C] rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      <Play className="w-3.5 h-3.5" />
                      Abrir Player
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Linked Skill Visual Effects (Spine) */}
          {mergedEffects.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-white">
                  Efeitos Visuais de Habilidades ({mergedEffects.length})
                </h3>
                <span className="text-xs text-[#7E879D]">Confirmado via eventos @CMD do sprite</span>
              </div>
              <div className="space-y-2">
                {mergedEffects.map((eff) => (
                  <div
                    key={eff.id}
                    className="flex items-center justify-between gap-3 px-4 py-3 bg-[#151924] border border-[#222736] rounded-lg"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-[#F97316] shrink-0" />
                        <span className="text-sm font-mono text-white truncate">{eff.name}</span>
                      </div>
                      <div className="text-xs text-[#8E97AB] font-mono tabular-nums mt-0.5">
                        Efeito Spine 3.8 · {eff.allFiles.length} arquivos ·{' '}
                        {formatBytes(eff.totalBytes)}
                      </div>
                    </div>
                    <button
                      onClick={() => onInspectSpine(eff, `${ninja.name} · ${eff.name}`)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#1F2536] hover:bg-[#EA580C] rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      <Play className="w-3.5 h-3.5" />
                      Abrir Player
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Linked Official Hero Videos (MP4) */}
          {mergedVideos.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-white">
                  Vídeos de Esotérica e Close-Up ({mergedVideos.length})
                </h3>
                <span className="text-xs text-[#7E879D]">Vínculo exato do personagem</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {mergedVideos.map((vid) => (
                  <DrawerVideoCard key={vid.id} vid={vid} cdnBase={cdnBase} />
                ))}
              </div>
            </section>
          )}

          {/* Detailed Techniques Table */}
          {ninja.skills.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-white mb-3">
                Descrições Completas das Técnicas ({ninja.skills.length})
              </h3>
              <div className="divide-y divide-[#1E2331] border border-[#222736] rounded-lg bg-[#151924]">
                {ninja.skills.map((sk) => (
                  <div key={sk.id} className="p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="text-sm font-semibold text-white">{sk.name}</div>
                      <div className="text-xs font-mono text-[#F97316]">
                        {sk.skillType} · {sk.id}
                      </div>
                    </div>
                    <p className="text-xs text-[#B6BFCF] leading-relaxed mt-1.5 whitespace-pre-line">
                      {sk.desc}
                    </p>
                    {(sk.multipliers.length > 0 || sk.effects.length > 0) && (
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-[#8E97AB] mt-2">
                        {sk.multipliers.length > 0 && (
                          <span>Multiplicadores: {sk.multipliers.join(', ')}</span>
                        )}
                        {sk.multipliers.length > 0 && sk.effects.length > 0 && (
                          <span aria-hidden="true">·</span>
                        )}
                        {sk.effects.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-[#CBD5E1]">
                            <Sparkles className="w-3 h-3 text-[#F97316]" />
                            {sk.effects.join(', ')}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Linked Audio */}
          <section>
            <h3 className="text-sm font-semibold text-white mb-3">
              Sons e Dublagens Vinculados ({ninja.audioFiles.length})
            </h3>
            {ninja.audioFiles.length === 0 ? (
              <div className="p-4 text-xs text-[#7E879D] bg-[#151924] border border-[#222736] rounded-lg">
                Nenhum arquivo MP3 diretamente vinculado ao ID {ninja.id}. Consulte a aba Sons e Dublagens para todos os 5.662 áudios do jogo.
              </div>
            ) : (
              <div className="space-y-2">
                {ninja.audioFiles.map((aud) => (
                  <DrawerAudioCard key={aud.id} aud={aud} cdnBase={cdnBase} />
                ))}
              </div>
            )}
          </section>

          {/* Portrait Gallery */}
          <section>
            <h3 className="text-sm font-semibold text-white mb-3">
              Retratos e Artes Estáticas ({displayPortraits.length})
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {displayPortraits.map((p) => {
                const fullUrl = resolveCdnUrl(cdnBase, p.url);
                return (
                  <div
                    key={p.url}
                    className="bg-[#151924] border border-[#222736] rounded-lg overflow-hidden flex flex-col"
                  >
                    <div className="aspect-square checkerboard-bg p-2">
                      <AssetImage
                        src={fullUrl}
                        alt={p.name}
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <div className="px-2.5 py-2 border-t border-[#222736] flex items-center justify-between gap-1">
                      <span className="text-[11px] font-mono text-[#B6BFCF] truncate" title={p.name}>
                        {p.name}
                      </span>
                      <a
                        href={fullUrl}
                        target="_blank"
                        rel="noreferrer"
                        download={p.name}
                        className="text-[#8E97AB] hover:text-white shrink-0"
                        title="Abrir arquivo original"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
