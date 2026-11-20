import {
  Film,
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
  useResolvedAssetUrl,
} from '../services/assetSource';
import { type FullCatalog, inspectSpineLive } from '../services/catalogEngine';
import type {
  NinjaRecord,
  NinjaSkillSlot,
  SpineAtlasRegion,
  SpineBundle,
  SpineInspectionResult,
} from '../types';
import { resolveCdnUrl } from '../utils/format';
import {
  type DiscoveredSkeletonResources,
  extractAllSkeletonCmdResources,
} from '../utils/spineCmdParser';
import {
  type CompiledSpineSkeleton,
  compileSpineSkeleton,
  getAnimationDuration,
  renderSpineScene,
} from '../utils/spineRenderer';
import {
  type LoadedVfxSpine,
  buildSceneLayersAtTime,
  computeSceneBoundsWithVfx,
  loadVfxSpinesForTimeline,
  resolveEffectiveAnimation,
} from '../utils/spineVfxLoader';
import { AssetImage } from './AssetImage';

interface NinjaSkillShowcaseProps {
  ninja: NinjaRecord;
  catalog: FullCatalog;
  onOpenFullPlayer: (bundle: SpineBundle, title: string, initialAnim?: string) => void;
  onSkeletonResourcesDiscovered?: (resources: DiscoveredSkeletonResources) => void;
}

function InlineCutsceneVideo({
  videoUrl,
  cdnBase,
  onClose,
}: {
  videoUrl: string;
  cdnBase: string;
  onClose: () => void;
}) {
  const src = useResolvedAssetUrl(resolveCdnUrl(cdnBase, videoUrl));
  return (
    <div className="relative w-full h-full bg-[#07090E] flex items-center justify-center">
      {src ? (
        <video
          src={src}
          controls
          autoPlay
          playsInline
          onEnded={onClose}
          className="w-full h-full object-contain"
        />
      ) : (
        <div className="text-xs text-[#8E97AB]">Carregando cutscene MP4...</div>
      )}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-2 right-2 z-20 px-2 py-1 text-[10px] font-medium bg-[#0B0D12]/85 hover:bg-[#EA580C] text-white border border-[#2C344A] rounded transition-colors"
      >
        Voltar ao Sprite
      </button>
    </div>
  );
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
  availableAnims: string[],
  rawSkeleton: Record<string, any> | null | undefined
): { animName: string; idleName: string } {
  const exactSet = new Set(availableAnims);
  const firstLowerMap = new Map<string, string>();
  for (const name of availableAnims) {
    const k = name.toLowerCase();
    // Preserva a PRIMEIRA ocorrência (ex: 'UniqueSkill' antes de 'uniqueSkill' delegada!)
    if (!firstLowerMap.has(k)) firstLowerMap.set(k, name);
  }

  const pickCandidate = (candidates: string[]): string | null => {
    for (const c of candidates) {
      if (exactSet.has(c)) return c;
    }
    for (const c of candidates) {
      const hit = firstLowerMap.get(c.toLowerCase());
      if (hit) return hit;
    }
    return null;
  };

  const idleName =
    pickCandidate(['idle', 'stand', 'loop']) || availableAnims[0] || '';

  const finalize = (candidate: string): { animName: string; idleName: string } => {
    const resolved = resolveEffectiveAnimation(rawSkeleton, candidate);
    return { animName: resolved.animName || candidate, idleName };
  };

  const fromPreferred = pickCandidate(slot.preferredAnims);
  if (fromPreferred) return finalize(fromPreferred);

  // Mapeamento oficial confirmado no jogo:
  // s1 = Ogi (Esotérica) -> UniqueSkill
  // n1 = Ataque Normal   -> attack
  // a1 = Habilidade      -> skill
  // c1 = Perseguição 1   -> chase1
  // c2 = Perseguição 2   -> chase2
  // p1/p2 = Passivas     -> idle
  const code = slot.slotCode.toLowerCase();
  if (code.startsWith('s')) {
    const hit =
      pickCandidate(['UniqueSkill', 'uniqueSkill', 'superUniqueSkill']) ||
      availableAnims.find((a) => /unique|aoyi|super/i.test(a));
    if (hit) return finalize(hit);
  } else if (code.startsWith('n')) {
    const hit =
      pickCandidate(['attack', 'attackAction']) ||
      availableAnims.find((a) => /^attack|atk/i.test(a));
    if (hit) return finalize(hit);
  } else if (code.startsWith('a')) {
    const hit =
      pickCandidate(['skill', 'skillAction']) ||
      availableAnims.find((a) => /^skill/i.test(a));
    if (hit) return finalize(hit);
  } else if (code === 'c2') {
    const hit =
      pickCandidate(['chase2', 'chase2Action', 'chase1']) ||
      availableAnims.find((a) => /chase2|chase/i.test(a));
    if (hit) return finalize(hit);
  } else if (code.startsWith('c')) {
    const hit =
      pickCandidate(['chase1', 'chase1Action', 'chase']) ||
      availableAnims.find((a) => /chase|combo/i.test(a));
    if (hit) return finalize(hit);
  }

  return { animName: idleName, idleName };
}

function pickOfficialHeroVoiceForSlot(
  ninja: NinjaRecord,
  slotCode: string,
  hasCmdSounds: boolean
): string | null {
  if (ninja.audioFiles.length === 0) return null;
  const code = slotCode.toLowerCase();
  if (code.startsWith('p')) return null;

  // s1 = Ogi (Esotérica) -> dublagem oficial AFaoyi/<id>_aoyiaf.mp3 do próprio herói
  if (code.startsWith('s')) {
    const esot = ninja.audioFiles.find((a) => a.category === 'dublagem_esoterica');
    if (esot) return esot.url;
  }

  // Só usa fala genérica do herói se a faixa não possuir eventos @CMD {SOUND} próprios
  if (!hasCmdSounds) {
    const line = ninja.audioFiles.find((a) => a.category === 'dublagem_falas');
    if (line) return line.url;
  }

  return null;
}

export function NinjaSkillShowcase({
  ninja,
  catalog,
  onOpenFullPlayer,
  onSkeletonResourcesDiscovered,
}: NinjaSkillShowcaseProps) {
  const cdnBase = catalog.summary.cdnBase;
  const battleSpine = useMemo(() => pickBestBattleSpine(ninja), [ninja]);

  const [selectedSlotCode, setSelectedSlotCode] = useState<string | null>(null);
  const [playNonce, setPlayNonce] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showVfx, setShowVfx] = useState(true);
  const [showCutscene, setShowCutscene] = useState(false);
  const [playing, setPlaying] = useState(true);

  const [loadingSpine, setLoadingSpine] = useState(false);
  const [spineError, setSpineError] = useState<string | null>(null);
  const [spineData, setSpineData] = useState<SpineInspectionResult | null>(null);
  const [loadedImages, setLoadedImages] = useState<Record<string, HTMLImageElement>>({});

  const [activeVfxMap, setActiveVfxMap] = useState<Map<string, LoadedVfxSpine>>(new Map());
  const [loadingVfx, setLoadingVfx] = useState(false);

  // Live animation state (plays skill once with VFX + SFX, then smoothly loops idle)
  const [activeAnimName, setActiveAnimName] = useState('');
  const [isReturningIdle, setIsReturningIdle] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [currentDuration, setCurrentDuration] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeAudiosRef = useRef<Set<HTMLAudioElement>>(new Set());
  const firedSoundsRef = useRef<Set<number>>(new Set());
  const vfxCacheRef = useRef<Map<string, LoadedVfxSpine | null>>(new Map());
  const timeRef = useRef(0);
  const lastRafRef = useRef<number | null>(null);

  const stopAllAudio = () => {
    for (const aud of activeAudiosRef.current) {
      try {
        aud.pause();
        aud.currentTime = 0;
      } catch {
        // ignore
      }
    }
    activeAudiosRef.current.clear();
  };

  // Reset state when switching to a different ninja
  useEffect(() => {
    setSelectedSlotCode(null);
    setActiveAnimName('');
    setIsReturningIdle(false);
    setShowCutscene(false);
    setCurrentTime(0);
    setCurrentDuration(0);
    setActiveVfxMap(new Map());
    firedSoundsRef.current.clear();
    stopAllAudio();
  }, [ninja.id]);

  // Stop audio on unmount or mute
  useEffect(() => {
    if (!soundEnabled) stopAllAudio();
  }, [soundEnabled]);

  useEffect(() => {
    return () => {
      stopAllAudio();
    };
  }, []);

  // Preload the ninja's battle Spine cleanly whenever battleSpine or cdnBase changes.
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

        if (data.rawSkeleton && onSkeletonResourcesDiscovered) {
          onSkeletonResourcesDiscovered(extractAllSkeletonCmdResources(data.rawSkeleton));
        }

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
      spineData.animations.map((a) => a.name),
      spineData.rawSkeleton
    );
  }, [selectedSlot, spineData]);

  // Parse @CMD events (VFX, sounds, cutscene video, screen shake, backdrop dim) for the active skill track
  const activeTimeline = useMemo(() => {
    if (!spineData?.rawSkeleton || !resolvedTracks.animName) return null;
    return resolveEffectiveAnimation(spineData.rawSkeleton, resolvedTracks.animName).timeline;
  }, [spineData, resolvedTracks.animName]);

  // Resolve cutscene MP4 URL if this skill track triggers `{PLAYVEDIO}`
  const skillCutsceneUrl = useMemo(() => {
    if (!activeTimeline || activeTimeline.videos.length === 0) return null;
    const first = activeTimeline.videos[0];
    const targetLower = first.source.toLowerCase();
    const matched = catalog.videos.find(
      (v) => v.filename.replace(/\.mp4$/i, '').toLowerCase() === targetLower
    );
    return matched ? matched.url : `acervo/video/hero/${first.filename}`;
  }, [activeTimeline, catalog.videos]);

  // Load any `noe_*` VFX Spine overlays referenced by this skill's @CMD events
  useEffect(() => {
    if (!activeTimeline || activeTimeline.vfx.length === 0 || !showVfx) {
      setActiveVfxMap(new Map());
      setLoadingVfx(false);
      return;
    }

    let cancelled = false;
    setLoadingVfx(true);
    loadVfxSpinesForTimeline(activeTimeline.vfx, catalog, vfxCacheRef.current)
      .then((map) => {
        if (!cancelled) setActiveVfxMap(map);
      })
      .finally(() => {
        if (!cancelled) setLoadingVfx(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTimeline, catalog, showVfx]);

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

  const playCueUrl = (relativeUrl: string, volume = 0.65) => {
    if (!soundEnabled) return;
    resolvePlayableUrl(resolveCdnUrl(cdnBase, relativeUrl)).then((playable) => {
      if (!playable) return;
      // Avoid audio clipping when a frame triggers many simultaneous SFX
      if (activeAudiosRef.current.size >= 5) return;
      const aud = new Audio(playable);
      aud.volume = volume;
      activeAudiosRef.current.add(aud);
      const cleanup = () => activeAudiosRef.current.delete(aud);
      aud.addEventListener('ended', cleanup, { once: true });
      aud.addEventListener('error', cleanup, { once: true });
      aud.play().catch(cleanup);
    });
  };

  // Trigger skill animation from t=0 whenever user clicks a skill icon or clicks "Repetir"
  useEffect(() => {
    if (!selectedSlot || !compiledSpine || !resolvedTracks.animName) return;
    setActiveAnimName(resolvedTracks.animName);
    setIsReturningIdle(false);
    setShowCutscene(false);
    timeRef.current = 0;
    firedSoundsRef.current.clear();
    setCurrentTime(0);
    setCurrentDuration(getAnimationDuration(compiledSpine, resolvedTracks.animName));
    setPlaying(true);

    stopAllAudio();
    if (soundEnabled) {
      const hasCmdSounds = Boolean(activeTimeline && activeTimeline.sounds.length > 0);
      const voiceUrl = pickOfficialHeroVoiceForSlot(ninja, selectedSlot.slotCode, hasCmdSounds);
      if (voiceUrl) {
        playCueUrl(voiceUrl, 0.72);
      }
    }
  }, [
    selectedSlot,
    playNonce,
    compiledSpine,
    resolvedTracks.animName,
    activeTimeline,
    ninja,
    cdnBase,
    soundEnabled,
  ]);

  // 60 FPS live Canvas animation loop with multi-layer VFX + dynamic anti-clipping camera + @CMD SFX
  useEffect(() => {
    if (!selectedSlot || !compiledSpine || !activeAnimName || showCutscene) return;
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

    const timelineForRender = isReturningIdle ? null : activeTimeline;
    const sceneBounds = computeSceneBoundsWithVfx(
      compiledSpine,
      animToPlay,
      timelineForRender,
      activeVfxMap,
      showVfx
    );

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
      const scale = Math.min(
        (W * 0.78) / Math.max(1, reg.width),
        (H * 0.78) / Math.max(1, reg.height),
        2.2
      );
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

    const triggerDueSounds = (t: number) => {
      if (!soundEnabled || isReturningIdle || !activeTimeline) return;
      for (let i = 0; i < activeTimeline.sounds.length; i++) {
        if (firedSoundsRef.current.has(i)) continue;
        const cue = activeTimeline.sounds[i];
        if (t >= cue.time) {
          firedSoundsRef.current.add(i);
          playCueUrl(cue.assetUrl, 0.55);
        }
      }
    };

    const drawStage = (t: number) => {
      const { layers, shakeX, shakeY, bgDimAlpha } = buildSceneLayersAtTime(
        compiledSpine,
        animToPlay,
        t,
        loadedImages,
        timelineForRender,
        activeVfxMap,
        showVfx
      );
      const res = renderSpineScene(ctx, layers, sceneBounds, 1.0, {
        shakeX,
        shakeY,
        bgDimAlpha,
      });
      if (res.drawnSlots === 0 && fallbackFrames.length > 0) {
        drawFallbackRegion(t);
      }
    };

    drawStage(timeRef.current);
    if (playing) triggerDueSounds(timeRef.current);

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
        firedSoundsRef.current.clear();
      }

      timeRef.current = nextT;
      triggerDueSounds(nextT);
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
    activeTimeline,
    activeVfxMap,
    showVfx,
    showCutscene,
    loadedImages,
    playing,
    soundEnabled,
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
  const totalVfxCmds = activeTimeline?.vfx.length || 0;
  const loadedVfxCount = activeVfxMap.size;

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
                className={`text-[11px] font-medium leading-tight max-w-[68px] truncate ${
                  active ? 'text-[#FB923C]' : 'text-[#A7B0C4] group-hover:text-white'
                }`}
              >
                {slot.shortLabel}
              </span>
            </button>
          );
        })}
      </div>

      {/* Interactive Battle Stage + Skill Details Panel */}
      {selectedSlot && (
        <div className="bg-[#0F1219] border border-[#2A3144] rounded-xl overflow-hidden">
          {/* Header Strip */}
          <div className="px-4 py-2.5 bg-[#151924] border-b border-[#222736] flex flex-wrap items-center justify-between gap-2">
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
              {totalVfxCmds > 0 && (
                <button
                  type="button"
                  onClick={() => setShowVfx((v) => !v)}
                  title={showVfx ? 'Ocultar efeitos VFX da habilidade' : 'Mostrar efeitos VFX da habilidade'}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                    showVfx
                      ? 'text-[#FB923C] bg-[#EA580C]/15 hover:bg-[#EA580C]/25'
                      : 'text-[#7C859B] bg-[#1C2130] hover:text-white'
                  }`}
                >
                  <Sparkles className="w-3 h-3" />
                  <span>
                    VFX{loadingVfx ? '...' : loadedVfxCount > 0 ? ` (${loadedVfxCount})` : ''}
                  </span>
                </button>
              )}

              {skillCutsceneUrl && (
                <button
                  type="button"
                  onClick={() => {
                    stopAllAudio();
                    setShowCutscene((c) => !c);
                  }}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                    showCutscene
                      ? 'text-white bg-[#EA580C]'
                      : 'text-[#D4DAE8] bg-[#1D2230] hover:bg-[#2A3248]'
                  }`}
                >
                  <Film className="w-3 h-3" />
                  <span>Cutscene</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setSoundEnabled((s) => !s)}
                title={soundEnabled ? 'Silenciar efeitos e dublagem' : 'Ativar efeitos e dublagem'}
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
            {/* Live Sprite + VFX Arena Stage */}
            <div className="sm:col-span-6 relative bg-[radial-gradient(ellipse_at_50%_78%,rgba(234,88,12,0.16),rgba(11,13,18,0.98)_72%)] border-b sm:border-b-0 sm:border-r border-[#222736] flex flex-col">
              <div className="relative h-64 sm:h-72 flex items-center justify-center overflow-hidden">
                {showCutscene && skillCutsceneUrl ? (
                  <InlineCutsceneVideo
                    videoUrl={skillCutsceneUrl}
                    cdnBase={cdnBase}
                    onClose={() => setShowCutscene(false)}
                  />
                ) : (
                  <>
                    {/* Arena ground ring */}
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute bottom-6 w-36 h-10 rounded-full border border-[#F97316]/30 bg-[#F97316]/10 blur-[1px]"
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
                        width={560}
                        height={420}
                        className="relative z-10 w-full h-full object-contain"
                      />
                    )}

                    {displayedAnim && (
                      <div className="absolute top-2.5 left-2.5 z-20 px-2 py-0.5 rounded bg-[#0B0D12]/85 border border-[#242B3D] text-[10px] font-mono text-[#E6E9F0]">
                        {displayedAnim}
                        {isReturningIdle ? ' (stance)' : ''}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Compact Playback Strip */}
              {battleSpine && spineData && !showCutscene && (
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
                      onClick={() => {
                        setPlaying((p) => {
                          if (p) stopAllAudio();
                          return !p;
                        });
                      }}
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
                      : 'Animação oficial de combate do sprite com efeitos VFX e sons sincronizados pelo motor do jogo.')}
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
                Toque nos outros ícones acima para testar cada golpe, efeitos VFX e sons oficiais do ninja.
              </div>
            </div>
          </div>
        </div>
      )}

      {!selectedSlot && (
        <div className="px-3.5 py-2.5 text-xs text-[#98A1B5] bg-[#151924] border border-[#222736] rounded-lg flex items-center gap-2">
          <Play className="w-3.5 h-3.5 text-[#F97316] shrink-0" />
          <span>
            Clique em qualquer ícone de habilidade acima para ver o golpe com efeitos VFX e sons oficiais ao vivo.
          </span>
        </div>
      )}
    </div>
  );
}
