import {
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  loadImageWithFallback,
  resolvePlayableUrl,
} from '../services/assetSource';
import { inspectSpineLive } from '../services/catalogEngine';
import type {
  NinjaRecord,
  NinjaSkillSlot,
  SpineAtlasRegion,
  SpineBundle,
  SpineInspectionResult,
} from '../types';
import { resolveCdnUrl } from '../utils/format';
import {
  type CompiledSpineSkeleton,
  compileSpineSkeleton,
  getAnimationDuration,
  renderSpineAtTime,
} from '../utils/spineRenderer';
import { AssetImage } from './AssetImage';

interface NinjaSkillShowcaseProps {
  ninja: NinjaRecord;
  cdnBase: string;
  onOpenFullPlayer: (bundle: SpineBundle, title: string, initialAnim?: string) => void;
}

function pickBestBattleSpine(ninja: NinjaRecord): SpineBundle | null {
  return (
    ninja.spineBundles.find(
      (s) => s.kind === 'personagem' && /^vdfno_\d+$/i.test(s.name)
    ) ||
    ninja.spineBundles.find(
      (s) => s.kind === 'personagem' && !/^vdfnop_/i.test(s.name)
    ) ||
    ninja.spineBundles.find((s) => s.kind === 'personagem') ||
    ninja.spineBundles.find((s) => s.kind === 'hd') ||
    ninja.spineBundles[0] ||
    null
  );
}

function resolveAnimationForSlot(
  slot: NinjaSkillSlot,
  availableAnims: string[]
): { animName: string; idleName: string } {
  const lowerMap = new Map<string, string>();
  for (const name of availableAnims) {
    lowerMap.set(name.toLowerCase(), name);
  }

  const idleName =
    lowerMap.get('idle') ||
    lowerMap.get('stand') ||
    lowerMap.get('loop') ||
    availableAnims[0] ||
    '';

  for (const candidate of slot.preferredAnims) {
    const hit = lowerMap.get(candidate.toLowerCase());
    if (hit) return { animName: hit, idleName };
  }

  const code = slot.slotCode.toLowerCase();
  if (code.startsWith('n')) {
    const hit = availableAnims.find((a) => /unique|aoyi|super|skill/i.test(a));
    if (hit) return { animName: hit, idleName };
  } else if (code.startsWith('s')) {
    const hit = availableAnims.find((a) => /^skill|unique/i.test(a));
    if (hit) return { animName: hit, idleName };
  } else if (code.startsWith('a')) {
    const hit = availableAnims.find((a) => /attack|atk/i.test(a));
    if (hit) return { animName: hit, idleName };
  } else if (code.startsWith('c')) {
    const hit = availableAnims.find((a) => /chase|combo|attack/i.test(a));
    if (hit) return { animName: hit, idleName };
  }

  return { animName: idleName, idleName };
}

function pickAudioForSlot(ninja: NinjaRecord, slotCode: string): string | null {
  if (ninja.audioFiles.length === 0) return null;
  const code = slotCode.toLowerCase();
  if (code.startsWith('p')) return null;

  if (code.startsWith('n')) {
    const esot =
      ninja.audioFiles.find((a) => a.category === 'dublagem_esoterica') ||
      ninja.audioFiles.find((a) => /^2\d{3}_/.test(a.filename));
    if (esot) return esot.url;
  } else if (code.startsWith('c')) {
    const chase =
      ninja.audioFiles.find((a) => /^3\d{3}_/.test(a.filename)) ||
      ninja.audioFiles.find((a) => /^1\d{3}_/.test(a.filename));
    if (chase) return chase.url;
  } else if (code.startsWith('s') || code.startsWith('a')) {
    const atk =
      ninja.audioFiles.find((a) => /^1\d{3}_/.test(a.filename)) ||
      ninja.audioFiles.find((a) => a.category === 'dublagem_falas');
    if (atk) return atk.url;
  }
  return null;
}

export function NinjaSkillShowcase({
  ninja,
  cdnBase,
  onOpenFullPlayer,
}: NinjaSkillShowcaseProps) {
  const battleSpine = useMemo(() => pickBestBattleSpine(ninja), [ninja]);

  const [selectedSlotCode, setSelectedSlotCode] = useState<string | null>(null);
  const [playNonce, setPlayNonce] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [playing, setPlaying] = useState(true);

  const [loadingSpine, setLoadingSpine] = useState(false);
  const [spineError, setSpineError] = useState<string | null>(null);
  const [spineData, setSpineData] = useState<SpineInspectionResult | null>(null);
  const [loadedImages, setLoadedImages] = useState<Record<string, HTMLImageElement>>({});

  // Live animation state (plays skill once, then smoothly loops idle like in the game!)
  const [activeAnimName, setActiveAnimName] = useState('');
  const [isReturningIdle, setIsReturningIdle] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [currentDuration, setCurrentDuration] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timeRef = useRef(0);
  const lastRafRef = useRef<number | null>(null);

  // Reset state when switching to a different ninja
  useEffect(() => {
    setSelectedSlotCode(null);
    setActiveAnimName('');
    setIsReturningIdle(false);
    setCurrentTime(0);
    setCurrentDuration(0);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  }, [ninja.id]);

  // Stop audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // Preload the ninja's battle Spine cleanly whenever battleSpine or cdnBase changes.
  // NOTE: loadingSpine is intentionally NOT in the dependency array so React does not cancel the fetch!
  useEffect(() => {
    if (!battleSpine) {
      setSpineData(null);
      setLoadedImages({});
      setSpineError(null);
      setLoadingSpine(false);
      return;
    }

    let cancelled = false;
    setLoadingSpine(true);
    setSpineError(null);
    setSpineData(null);
    setLoadedImages({});

    async function load() {
      try {
        const data = await inspectSpineLive(cdnBase, battleSpine!.jsonUrl, battleSpine!.atlasUrl);
        if (cancelled) return;
        setSpineData(data);

        const imgs: Record<string, HTMLImageElement> = {};
        await Promise.all(
          data.pages.map(async (page) => {
            const img = await loadImageWithFallback(page.imageUrl);
            if (img) imgs[page.filename] = img;
          })
        );
        if (!cancelled) setLoadedImages(imgs);
      } catch (e) {
        if (!cancelled) {
          setSpineError(e instanceof Error ? e.message : 'Erro ao carregar sprite animado.');
        }
      } finally {
        if (!cancelled) setLoadingSpine(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [battleSpine?.id, cdnBase]);

  const selectedSlot = useMemo(
    () => ninja.skillSlots.find((s) => s.slotCode === selectedSlotCode) || null,
    [ninja.skillSlots, selectedSlotCode]
  );

  const compiledSpine = useMemo<CompiledSpineSkeleton | null>(() => {
    if (!spineData?.rawSkeleton) return null;
    return compileSpineSkeleton(spineData.rawSkeleton, spineData.regions);
  }, [spineData]);

  // Resolve target skill animation + idle animation whenever slot or spine changes
  const resolvedTracks = useMemo(() => {
    if (!selectedSlot || !spineData) return { animName: '', idleName: '' };
    return resolveAnimationForSlot(
      selectedSlot,
      spineData.animations.map((a) => a.name)
    );
  }, [selectedSlot, spineData]);

  // Fallback frames in case a non-standard Spine track relies purely on region attachments
  const fallbackFrames = useMemo(() => {
    if (!spineData) return [];
    const regionMap = new Map<string, SpineAtlasRegion>();
    for (const r of spineData.regions) regionMap.set(r.name, r);

    const anim = spineData.animations.find((a) => a.name === activeAnimName);
    const list: SpineAtlasRegion[] = [];
    if (anim && anim.attachmentFrames.length > 0) {
      for (const af of anim.attachmentFrames) {
        if (!af.attachment) continue;
        const reg = regionMap.get(af.attachment);
        if (reg) list.push(reg);
      }
    }
    if (list.length === 0) return spineData.regions;
    return list;
  }, [spineData, activeAnimName]);

  // Trigger skill animation from t=0 whenever user clicks a skill icon or clicks "Repetir"
  useEffect(() => {
    if (!selectedSlot || !compiledSpine || !resolvedTracks.animName) return;
    setActiveAnimName(resolvedTracks.animName);
    setIsReturningIdle(false);
    timeRef.current = 0;
    setCurrentTime(0);
    setCurrentDuration(getAnimationDuration(compiledSpine, resolvedTracks.animName));
    setPlaying(true);

    // Trigger combat/Ogi voice dub on user click
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (soundEnabled) {
      const audioUrl = pickAudioForSlot(ninja, selectedSlot.slotCode);
      if (audioUrl) {
        let aborted = false;
        resolvePlayableUrl(resolveCdnUrl(cdnBase, audioUrl)).then((playable) => {
          if (aborted || !playable) return;
          const aud = new Audio(playable);
          aud.volume = 0.7;
          audioRef.current = aud;
          aud.play().catch(() => {
            // Ignore browser autoplay block if any
          });
        });
        return () => {
          aborted = true;
        };
      }
    }
  }, [selectedSlot, playNonce, compiledSpine, resolvedTracks.animName, ninja, cdnBase, soundEnabled]);

  // 60 FPS live Canvas animation loop (plays skill once -> transitions back to idle loop!)
  useEffect(() => {
    if (!selectedSlot || !compiledSpine || !activeAnimName) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (Object.keys(loadedImages).length === 0) return;

    const animToPlay =
      isReturningIdle && resolvedTracks.idleName
        ? resolvedTracks.idleName
        : activeAnimName;
    const duration = getAnimationDuration(compiledSpine, animToPlay);
    setCurrentDuration(duration);

    let rafId = 0;
    let lastUiSync = 0;
    lastRafRef.current = null;

    const drawFallbackRegion = (t: number) => {
      if (fallbackFrames.length === 0) return;
      const idx =
        duration > 0
          ? Math.floor((t / duration) * fallbackFrames.length) % fallbackFrames.length
          : 0;
      const reg = fallbackFrames[idx];
      const img = loadedImages[reg.page];
      if (!img) return;
      const W = ctx.canvas.width;
      const H = ctx.canvas.height;
      ctx.clearRect(0, 0, W, H);
      const srcW = reg.rotate ? reg.height : reg.width;
      const srcH = reg.rotate ? reg.width : reg.height;
      const scale = Math.min((W * 0.78) / Math.max(1, reg.width), (H * 0.78) / Math.max(1, reg.height), 2.2);
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.scale(scale, scale);
      if (reg.rotate) {
        ctx.rotate(-Math.PI / 2);
        ctx.drawImage(img, reg.x, reg.y, srcW, srcH, -srcW / 2, -srcH / 2, srcW, srcH);
      } else {
        ctx.drawImage(img, reg.x, reg.y, srcW, srcH, -reg.width / 2, -reg.height / 2, reg.width, reg.height);
      }
      ctx.restore();
    };

    const drawStage = (t: number) => {
      const res = renderSpineAtTime(ctx, compiledSpine, animToPlay, t, loadedImages, 1.05);
      if (res.drawnSlots === 0 && fallbackFrames.length > 0) {
        drawFallbackRegion(t);
      }
    };

    drawStage(timeRef.current);

    if (!playing || duration <= 0) return;

    const tick = (now: number) => {
      if (lastRafRef.current === null) lastRafRef.current = now;
      const dt = Math.min(0.08, (now - lastRafRef.current) / 1000);
      lastRafRef.current = now;

      let nextT = timeRef.current + dt;
      if (nextT >= duration) {
        if (
          !isReturningIdle &&
          !selectedSlot.isPassive &&
          resolvedTracks.idleName &&
          resolvedTracks.idleName !== activeAnimName
        ) {
          timeRef.current = 0;
          setIsReturningIdle(true);
          return;
        }
        nextT = nextT % duration;
      }

      timeRef.current = nextT;
      drawStage(nextT);

      if (now - lastUiSync > 50) {
        lastUiSync = now;
        setCurrentTime(nextT);
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
      lastRafRef.current = null;
    };
  }, [
    selectedSlot,
    compiledSpine,
    activeAnimName,
    isReturningIdle,
    resolvedTracks.idleName,
    loadedImages,
    playing,
    fallbackFrames,
  ]);

  if (ninja.skillSlots.length === 0) {
    return (
      <div className="p-4 text-xs text-[#7E879D] bg-[#151924] border border-[#222736] rounded-lg">
        Nenhum ícone ou descrição de habilidade indexado para este ninja.
      </div>
    );
  }

  const handleSelectSkill = (slotCode: string) => {
    setSelectedSlotCode(slotCode);
    setPlayNonce((n) => n + 1);
  };

  const displayedAnim =
    isReturningIdle && resolvedTracks.idleName ? resolvedTracks.idleName : activeAnimName;
  const loadedImageCount = Object.keys(loadedImages).length;

  return (
    <div className="space-y-4">
      {/* Row of clickable skill icons — just like the character screen in the game */}
      <div className="flex items-start gap-2.5 overflow-x-auto pb-1">
        {ninja.skillSlots.map((slot) => {
          const active = slot.slotCode === selectedSlotCode;
          return (
            <button
              key={slot.slotCode}
              type="button"
              onClick={() => handleSelectSkill(slot.slotCode)}
              className="group flex flex-col items-center gap-1.5 shrink-0 focus:outline-none"
              title={`${slot.label}${slot.skill ? ` — ${slot.skill.name}` : ''}`}
            >
              <div
                className={`relative w-14 h-14 rounded-xl overflow-hidden border-2 transition-all bg-[#0D1017] flex items-center justify-center ${
                  active
                    ? 'border-[#F97316] scale-105 shadow-[0_0_16px_rgba(234,88,12,0.35)]'
                    : 'border-[#2B3245] group-hover:border-[#EA580C]/70'
                }`}
              >
                {slot.iconUrl ? (
                  <AssetImage
                    src={resolveCdnUrl(cdnBase, slot.iconUrl)}
                    alt={slot.label}
                    fallbackLabel={slot.slotCode}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-xs font-mono font-bold uppercase text-[#9CA5B9]">
                    {slot.slotCode}
                  </span>
                )}
                {!slot.isPassive && (
                  <span className="absolute bottom-0.5 right-0.5 w-4 h-4 rounded-full bg-black/75 flex items-center justify-center">
                    <Play className="w-2.5 h-2.5 text-[#FB923C] fill-[#FB923C]" />
                  </span>
                )}
              </div>
              <span
                className={`text-[11px] font-medium leading-tight max-w-[66px] truncate ${
                  active ? 'text-[#FB923C]' : 'text-[#A7B0C4] group-hover:text-white'
                }`}
              >
                {slot.shortLabel}
              </span>
            </button>
          );
        })}
      </div>

      {/* Interactive Battle Stage + Skill Details Panel (opens when any skill icon is clicked!) */}
      {selectedSlot && (
        <div className="bg-[#0F1219] border border-[#2A3144] rounded-xl overflow-hidden">
          {/* Header Strip */}
          <div className="px-4 py-2.5 bg-[#151924] border-b border-[#222736] flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-semibold text-[#F97316] uppercase tracking-wide shrink-0">
                {selectedSlot.label}
              </span>
              {selectedSlot.skill?.name && (
                <>
                  <span className="text-[#4B5469]" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-xs font-medium text-white truncate">
                    {selectedSlot.skill.name}
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setSoundEnabled((s) => !s)}
                title={soundEnabled ? 'Desativar som da dublagem' : 'Ativar som da dublagem'}
                className={`p-1.5 rounded-md transition-colors ${
                  soundEnabled
                    ? 'text-[#FB923C] bg-[#EA580C]/15 hover:bg-[#EA580C]/25'
                    : 'text-[#7C859B] bg-[#1C2130] hover:text-white'
                }`}
              >
                {soundEnabled ? (
                  <Volume2 className="w-3.5 h-3.5" />
                ) : (
                  <VolumeX className="w-3.5 h-3.5" />
                )}
              </button>
              {battleSpine && (
                <button
                  type="button"
                  onClick={() =>
                    onOpenFullPlayer(
                      battleSpine,
                      `${ninja.name} (${battleSpine.name})`,
                      resolvedTracks.animName || undefined
                    )
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-[#D4DAE8] bg-[#1D2230] hover:bg-[#EA580C] hover:text-white rounded-md transition-colors whitespace-nowrap"
                >
                  <Maximize2 className="w-3 h-3" />
                  Player Completo
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12">
            {/* Live Sprite Arena Stage */}
            <div className="sm:col-span-6 relative bg-[radial-gradient(ellipse_at_50%_78%,rgba(234,88,12,0.16),rgba(11,13,18,0.98)_72%)] border-b sm:border-b-0 sm:border-r border-[#222736] flex flex-col">
              <div className="relative h-60 sm:h-64 flex items-center justify-center overflow-hidden">
                {/* Arena ground ring under the ninja's feet */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute bottom-6 w-36 h-10 rounded-full border border-[#F97316]/35 bg-[#F97316]/10 blur-[1px]"
                />

                {!battleSpine ? (
                  <div className="p-4 text-center text-xs text-[#8E97AB]">
                    Este ninja não possui sprite Spine de batalha vinculado por ID.
                  </div>
                ) : loadingSpine ? (
                  <div className="p-4 text-center text-xs text-[#8E97AB]">
                    Carregando animação do ninja...
                  </div>
                ) : spineError ? (
                  <div className="p-4 text-center text-xs text-[#FCA5A5]">{spineError}</div>
                ) : loadedImageCount === 0 && spineData ? (
                  <div className="p-4 text-center text-xs text-[#FCA5A5]">
                    Textura do sprite não encontrada para este ninja.
                  </div>
                ) : (
                  <canvas
                    ref={canvasRef}
                    width={480}
                    height={360}
                    className="relative z-10 w-full h-full object-contain"
                  />
                )}

                {displayedAnim && (
                  <div className="absolute top-2.5 left-2.5 z-20 px-2 py-0.5 rounded bg-[#0B0D12]/85 border border-[#242B3D] text-[10px] font-mono text-[#E6E9F0]">
                    {displayedAnim}
                    {isReturningIdle ? ' (stance)' : ''}
                  </div>
                )}
              </div>

              {/* Compact Playback Strip */}
              {battleSpine && spineData && (
                <div className="px-3 py-2 bg-[#0B0D12]/90 border-t border-[#1E2331] flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleSelectSkill(selectedSlot.slotCode)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-white bg-[#EA580C] hover:bg-[#C2410C] rounded-md transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Repetir
                    </button>
                    <button
                      type="button"
                      onClick={() => setPlaying((p) => !p)}
                      aria-label={playing ? 'Pausar' : 'Reproduzir'}
                      className="p-1.5 text-[#C9D1E1] bg-[#181C28] hover:bg-[#242B3D] rounded-md"
                    >
                      {playing ? (
                        <Pause className="w-3.5 h-3.5" />
                      ) : (
                        <Play className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                  <span className="text-[11px] font-mono tabular-nums text-[#8E97AB]">
                    {currentTime.toFixed(2)}s / {currentDuration.toFixed(2)}s
                  </span>
                </div>
              )}
            </div>

            {/* Skill Description & Metadata */}
            <div className="sm:col-span-6 p-4 flex flex-col justify-between gap-3">
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  {selectedSlot.iconUrl && (
                    <div className="w-12 h-12 rounded-lg border border-[#2C344A] overflow-hidden shrink-0 bg-[#0B0D12]">
                      <AssetImage
                        src={resolveCdnUrl(cdnBase, selectedSlot.iconUrl)}
                        alt={selectedSlot.label}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white">
                      {selectedSlot.skill?.name || selectedSlot.label}
                    </div>
                    <div className="text-[11px] font-mono text-[#8E97AB] mt-0.5">
                      Slot {selectedSlot.slotCode.toUpperCase()}
                      {resolvedTracks.animName ? ` · Faixa ${resolvedTracks.animName}` : ''}
                    </div>
                  </div>
                </div>

                <p className="text-xs text-[#C7CFDF] leading-relaxed whitespace-pre-line">
                  {selectedSlot.skill?.desc ||
                    (selectedSlot.isPassive
                      ? 'Habilidade passiva ativa durante a batalha (o sprite permanece em pose de combate).'
                      : 'Animação oficial de combate do sprite vinculada a este ícone de habilidade.')}
                </p>

                {selectedSlot.skill &&
                  (selectedSlot.skill.multipliers.length > 0 ||
                    selectedSlot.skill.effects.length > 0) && (
                    <div className="space-y-1.5 pt-2 border-t border-[#1E2331] text-[11px] font-mono">
                      {selectedSlot.skill.multipliers.length > 0 && (
                        <div className="text-[#9CA5B9]">
                          Multiplicadores:{' '}
                          <span className="text-white">
                            {selectedSlot.skill.multipliers.join(', ')}
                          </span>
                        </div>
                      )}
                      {selectedSlot.skill.effects.length > 0 && (
                        <div className="flex items-center gap-1.5 text-[#CBD5E1]">
                          <Sparkles className="w-3 h-3 text-[#F97316] shrink-0" />
                          <span>{selectedSlot.skill.effects.join(', ')}</span>
                        </div>
                      )}
                    </div>
                  )}
              </div>

              <div className="text-[11px] text-[#7C859B] pt-2 border-t border-[#1E2331]">
                Toque nos outros ícones acima para testar cada golpe e dublagem do ninja.
              </div>
            </div>
          </div>
        </div>
      )}

      {!selectedSlot && (
        <div className="px-3.5 py-2.5 text-xs text-[#98A1B5] bg-[#151924] border border-[#222736] rounded-lg flex items-center gap-2">
          <Play className="w-3.5 h-3.5 text-[#F97316] shrink-0" />
          <span>
            Clique em qualquer ícone de habilidade acima para ver a animação do sprite e os detalhes do golpe ao vivo.
          </span>
        </div>
      )}
    </div>
  );
}
