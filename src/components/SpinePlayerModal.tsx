import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileArchive,
  Film,
  Layers,
  Move,
  Pause,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { loadImageWithFallback, resolvePlayableUrl } from '../services/assetSource';
import {
  type FullCatalog,
  inspectAnim2DLive,
  inspectSpineLive,
} from '../services/catalogEngine';
import { downloadCustomRequestZip } from '../services/clientZipper';
import type {
  Anim2DBundle,
  Anim2DInspectionResult,
  SpineAtlasRegion,
  SpineBundle,
  SpineInspectionResult,
} from '../types';
import { formatBytes, resolveCdnUrl } from '../utils/format';
import { lockBodyScroll } from '../utils/scrollLock';
import {
  exportAnim2DFramesZip,
  exportSpineAnimationFramesZip,
  type FrameExportProgress,
} from '../utils/spineExporter';
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

export type PlayerTarget =
  | { mode: 'spine'; bundle: SpineBundle; title?: string; initialAnim?: string }
  | { mode: 'anim2d'; bundle: Anim2DBundle; title?: string };

interface SpinePlayerModalProps {
  target: PlayerTarget | null;
  catalog: FullCatalog;
  onClose: () => void;
}

type ViewTab = 'live' | 'frames' | 'sheet' | 'json';
type BgMode = 'checker' | 'dark' | 'light';

export function SpinePlayerModal({ target, catalog, onClose }: SpinePlayerModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spineData, setSpineData] = useState<SpineInspectionResult | null>(null);
  const [anim2dData, setAnim2dData] = useState<Anim2DInspectionResult | null>(null);
  const [loadedImages, setLoadedImages] = useState<Record<string, HTMLImageElement>>({});

  const [viewTab, setViewTab] = useState<ViewTab>('live');
  const [selectedAnim, setSelectedAnim] = useState<string>('');
  const [trackSearch, setTrackSearch] = useState('');
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [showVfx, setShowVfx] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [activeVfxMap, setActiveVfxMap] = useState<Map<string, LoadedVfxSpine>>(new Map());
  const [loadingVfx, setLoadingVfx] = useState(false);

  const [bgMode, setBgMode] = useState<BgMode>('checker');
  const [frameIndex, setFrameIndex] = useState(0);
  const [spineTime, setSpineTime] = useState(0);
  const [activeSlotInfo, setActiveSlotInfo] = useState('');
  const [exportingZip, setExportingZip] = useState(false);
  const [exportingFrames, setExportingFrames] = useState(false);
  const [frameExportProgress, setFrameExportProgress] = useState<FrameExportProgress | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const spineTimeRef = useRef(0);
  const lastRafRef = useRef<number | null>(null);
  const dragOriginRef = useRef<{ clientX: number; clientY: number; panX: number; panY: number } | null>(null);
  const vfxCacheRef = useRef<Map<string, LoadedVfxSpine | null>>(new Map());
  const activeAudiosRef = useRef<Set<HTMLAudioElement>>(new Set());
  const firedSoundsRef = useRef<Set<number>>(new Set());

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

  useEffect(() => {
    if (!soundEnabled || !playing) stopAllAudio();
  }, [soundEnabled, playing]);

  useEffect(() => {
    return () => stopAllAudio();
  }, []);

  // Lock background page scroll while modal is open
  useEffect(() => {
    if (!target) return;
    return lockBodyScroll();
  }, [target]);

  // Close on Escape key
  useEffect(() => {
    if (!target) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [target, onClose]);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSpineData(null);
    setAnim2dData(null);
    setLoadedImages({});
    setActiveVfxMap(new Map());
    setFrameIndex(0);
    setSpineTime(0);
    spineTimeRef.current = 0;
    firedSoundsRef.current.clear();
    stopAllAudio();
    setActiveSlotInfo('');
    setTrackSearch('');
    setViewTab('live');
    setPlaying(true);
    setZoom(1);
    setPan({ x: 0, y: 0 });

    async function load() {
      try {
        const cdnBase = catalog.summary.cdnBase;
        if (target!.mode === 'spine') {
          const b = target!.bundle;
          const data = await inspectSpineLive(cdnBase, b.jsonUrl, b.atlasUrl);
          if (cancelled) return;
          setSpineData(data);
          const requestedAnim =
            target!.mode === 'spine' && target!.initialAnim
              ? data.animations.find((a) => a.name === target!.initialAnim)?.name ||
                data.animations.find(
                  (a) => a.name.toLowerCase() === target!.initialAnim!.toLowerCase()
                )?.name
              : undefined;
          const defaultAnim =
            requestedAnim ||
            data.animations.find((a) => /^idle$/i.test(a.name))?.name ||
            data.animations.find((a) => /^loop$/i.test(a.name))?.name ||
            data.animations[0]?.name ||
            '';
          setSelectedAnim(defaultAnim);

          const imgs: Record<string, HTMLImageElement> = {};
          await Promise.all(
            data.pages.map(async (page) => {
              const img = await loadImageWithFallback(page.imageUrl);
              if (img) imgs[page.filename] = img;
            })
          );
          if (!cancelled) setLoadedImages(imgs);
        } else {
          const b = target!.bundle;
          const data = await inspectAnim2DLive(cdnBase, b);
          if (cancelled) return;
          setAnim2dData(data);

          if (data.imageUrl) {
            const img = await loadImageWithFallback(data.imageUrl);
            if (!cancelled && img) setLoadedImages({ main: img });
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Erro ao inspecionar animação.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [target, catalog.summary.cdnBase]);

  // Compile Spine skeleton for real-time 60fps skeletal playback
  const compiledSpine = useMemo<CompiledSpineSkeleton | null>(() => {
    if (target?.mode !== 'spine' || !spineData?.rawSkeleton) return null;
    return compileSpineSkeleton(spineData.rawSkeleton, spineData.regions);
  }, [target?.mode, spineData]);

  // Follow delegated tracks (`uniqueSkill` -> `UniqueSkill`, `skillAction` -> `skill`) and parse `@CMD`
  const effectiveTrack = useMemo(() => {
    if (target?.mode !== 'spine' || !spineData?.rawSkeleton || !selectedAnim) {
      return { animName: selectedAnim, timeline: null };
    }
    return resolveEffectiveAnimation(spineData.rawSkeleton, selectedAnim);
  }, [target?.mode, spineData, selectedAnim]);

  const effectiveAnimName = effectiveTrack.animName || selectedAnim;
  const activeTimeline = effectiveTrack.timeline;

  const currentSpineDuration = useMemo(() => {
    if (!compiledSpine || !effectiveAnimName) return 0;
    return getAnimationDuration(compiledSpine, effectiveAnimName);
  }, [compiledSpine, effectiveAnimName]);

  // Preload `@CMD` `noe_*` VFX spines for the active animation track
  useEffect(() => {
    if (
      target?.mode !== 'spine' ||
      !activeTimeline ||
      activeTimeline.vfx.length === 0 ||
      !showVfx
    ) {
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
  }, [target?.mode, activeTimeline, catalog, showVfx]);

  const sceneBounds = useMemo(() => {
    if (!compiledSpine || !effectiveAnimName) return null;
    return computeSceneBoundsWithVfx(
      compiledSpine,
      effectiveAnimName,
      activeTimeline,
      activeVfxMap,
      showVfx
    );
  }, [compiledSpine, effectiveAnimName, activeTimeline, activeVfxMap, showVfx]);

  // Compute extracted region/frame list (used for Anim2D playback, Frames tab, and fallback)
  const playableFrames = useMemo(() => {
    if (target?.mode === 'anim2d' && anim2dData) {
      return anim2dData.frames.map((f, idx) => ({
        label: f.name,
        time: idx / 15,
        page: 'main',
        x: f.x,
        y: f.y,
        w: f.w,
        h: f.h,
        origW: f.w,
        origH: f.h,
        offsetX: 0,
        offsetY: 0,
        rotate: f.rotated,
      }));
    }

    if (target?.mode === 'spine' && spineData) {
      const regionMap = new Map<string, SpineAtlasRegion>();
      for (const r of spineData.regions) {
        regionMap.set(r.name, r);
      }

      const anim = spineData.animations.find((a) => a.name === selectedAnim);
      const frames: Array<{
        label: string;
        time: number;
        page: string;
        x: number;
        y: number;
        w: number;
        h: number;
        origW: number;
        origH: number;
        offsetX: number;
        offsetY: number;
        rotate: boolean;
      }> = [];

      if (anim && anim.attachmentFrames.length > 0) {
        for (const af of anim.attachmentFrames) {
          if (!af.attachment) continue;
          const reg = regionMap.get(af.attachment);
          if (!reg) continue;
          frames.push({
            label: `${af.slot}:${af.attachment}`,
            time: af.time,
            page: reg.page,
            x: reg.x,
            y: reg.y,
            w: reg.width,
            h: reg.height,
            origW: reg.origWidth || reg.width,
            origH: reg.origHeight || reg.height,
            offsetX: reg.offsetX,
            offsetY: reg.offsetY,
            rotate: reg.rotate,
          });
        }
      }

      if (frames.length === 0 && spineData.regions.length > 0) {
        const sorted = [...spineData.regions].sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { numeric: true })
        );
        for (let i = 0; i < sorted.length; i++) {
          const reg = sorted[i];
          frames.push({
            label: reg.name,
            time: i / 12,
            page: reg.page,
            x: reg.x,
            y: reg.y,
            w: reg.width,
            h: reg.height,
            origW: reg.origWidth || reg.width,
            origH: reg.origHeight || reg.height,
            offsetX: reg.offsetX,
            offsetY: reg.offsetY,
            rotate: reg.rotate,
          });
        }
      }

      return frames;
    }

    return [];
  }, [target, spineData, anim2dData, selectedAnim]);

  const filteredAnimations = useMemo(() => {
    if (!spineData) return [];
    const q = trackSearch.trim().toLowerCase();
    if (!q) return spineData.animations;
    return spineData.animations.filter((a) => a.name.toLowerCase().includes(q));
  }, [spineData, trackSearch]);

  const drawFallbackFrame = (
    ctx: CanvasRenderingContext2D,
    idx: number
  ) => {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    ctx.clearRect(0, 0, W, H);
    const frame = playableFrames[idx % Math.max(1, playableFrames.length)];
    if (!frame) return;
    const img = loadedImages[frame.page];
    if (!img) return;

    const srcW = frame.rotate ? frame.h : frame.w;
    const srcH = frame.rotate ? frame.w : frame.h;
    const drawW = frame.w;
    const drawH = frame.h;

    const fitScale = Math.min((W * 0.78) / Math.max(1, drawW), (H * 0.78) / Math.max(1, drawH), 2.5);
    const scale = fitScale * zoom;

    ctx.save();
    ctx.translate(W / 2 + pan.x, H / 2 + pan.y);
    ctx.scale(scale, scale);

    if (frame.rotate) {
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(img, frame.x, frame.y, srcW, srcH, -srcW / 2, -srcH / 2, srcW, srcH);
    } else {
      ctx.drawImage(img, frame.x, frame.y, srcW, srcH, -drawW / 2, -drawH / 2, drawW, drawH);
    }
    ctx.restore();
  };

  const renderCompositeSpineFrame = (ctx: CanvasRenderingContext2D, t: number) => {
    if (!compiledSpine || !sceneBounds) return { drawnSlots: 0, activeLabels: [] as string[] };
    const { layers, shakeX, shakeY, bgDimAlpha } = buildSceneLayersAtTime(
      compiledSpine,
      effectiveAnimName,
      t,
      loadedImages,
      activeTimeline,
      activeVfxMap,
      showVfx
    );
    const res = renderSpineScene(ctx, layers, sceneBounds, zoom, {
      panX: pan.x,
      panY: pan.y,
      shakeX,
      shakeY,
      bgDimAlpha,
    });
    if (res.drawnSlots === 0 && playableFrames.length > 0) {
      const estIdx =
        currentSpineDuration > 0
          ? Math.floor((t / currentSpineDuration) * playableFrames.length) % playableFrames.length
          : 0;
      drawFallbackFrame(ctx, estIdx);
    }
    return res;
  };

  // Real-time Spine 3.8 RAF loop (with `@CMD` VFX + synchronized `@CMD` SFX + anti-clipping bounds)
  useEffect(() => {
    if (target?.mode !== 'spine' || viewTab !== 'live' || !compiledSpine || !sceneBounds) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const hasImages = Object.keys(loadedImages).length > 0;
    if (!hasImages) return;

    const duration = currentSpineDuration;
    const cdnBase = catalog.summary.cdnBase;
    let rafId = 0;
    let lastUiSync = 0;
    lastRafRef.current = null;

    const triggerDueSounds = (t: number) => {
      if (!soundEnabled || !activeTimeline) return;
      for (let i = 0; i < activeTimeline.sounds.length; i++) {
        if (firedSoundsRef.current.has(i)) continue;
        const cue = activeTimeline.sounds[i];
        if (t >= cue.time) {
          firedSoundsRef.current.add(i);
          resolvePlayableUrl(resolveCdnUrl(cdnBase, cue.assetUrl)).then((playable) => {
            if (!playable || activeAudiosRef.current.size >= 5) return;
            const aud = new Audio(playable);
            aud.volume = 0.55;
            activeAudiosRef.current.add(aud);
            const cleanup = () => activeAudiosRef.current.delete(aud);
            aud.addEventListener('ended', cleanup, { once: true });
            aud.addEventListener('error', cleanup, { once: true });
            aud.play().catch(cleanup);
          });
        }
      }
    };

    // Always draw immediately for current time
    const initRes = renderCompositeSpineFrame(ctx, spineTimeRef.current);
    if (initRes.activeLabels.length > 0) {
      setActiveSlotInfo(initRes.activeLabels.slice(0, 3).join(' · '));
    }

    if (!playing || duration <= 0) {
      return;
    }

    const tick = (now: number) => {
      if (lastRafRef.current === null) {
        lastRafRef.current = now;
      }
      const dt = Math.min(0.1, (now - lastRafRef.current) / 1000) * speed;
      lastRafRef.current = now;

      let nextT = spineTimeRef.current + dt;
      if (duration > 0 && nextT >= duration) {
        nextT = nextT % duration;
        firedSoundsRef.current.clear();
      }
      spineTimeRef.current = nextT;

      triggerDueSounds(nextT);
      const res = renderCompositeSpineFrame(ctx, nextT);

      // Throttle React state updates to ~20fps so scrubber stays smooth without overhead
      if (now - lastUiSync > 50) {
        lastUiSync = now;
        setSpineTime(nextT);
        if (res.activeLabels.length > 0) {
          setActiveSlotInfo(res.activeLabels.slice(0, 3).join(' · '));
        }
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
      lastRafRef.current = null;
    };
  }, [
    target?.mode,
    viewTab,
    compiledSpine,
    effectiveAnimName,
    activeTimeline,
    activeVfxMap,
    showVfx,
    soundEnabled,
    sceneBounds,
    currentSpineDuration,
    loadedImages,
    playing,
    speed,
    zoom,
    pan,
    playableFrames,
    catalog.summary.cdnBase,
  ]);

  // Anim2D playback loop
  useEffect(() => {
    if (target?.mode !== 'anim2d' || !playing || playableFrames.length <= 1 || viewTab !== 'live') {
      return;
    }
    const intervalMs = Math.max(24, Math.round(1000 / (15 * speed)));
    const timer = window.setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % playableFrames.length);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [playing, playableFrames.length, speed, viewTab, target?.mode]);

  // Anim2D canvas drawing
  useEffect(() => {
    if (target?.mode !== 'anim2d' || viewTab !== 'live') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawFallbackFrame(ctx, frameIndex);
  }, [target?.mode, playableFrames, frameIndex, loadedImages, zoom, pan, viewTab]);

  if (!target) return null;

  const title = target.title || target.bundle.name;
  const isSpineMode = target.mode === 'spine';
  const loadedImageCount = Object.keys(loadedImages).length;
  const hasVfxCmds = Boolean(activeTimeline && activeTimeline.vfx.length > 0);
  const hasSoundCmds = Boolean(activeTimeline && activeTimeline.sounds.length > 0);
  const hasCameraOffset = zoom !== 1 || pan.x !== 0 || pan.y !== 0;

  const handleStagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    dragOriginRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };

  const handleStagePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragOriginRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    const scaleX = canvas && rect && rect.width > 0 ? canvas.width / rect.width : 1;
    const scaleY = canvas && rect && rect.height > 0 ? canvas.height / rect.height : 1;
    const dx = (e.clientX - dragOriginRef.current.clientX) * scaleX;
    const dy = (e.clientY - dragOriginRef.current.clientY) * scaleY;
    setPan({
      x: Math.max(-420, Math.min(420, dragOriginRef.current.panX + dx)),
      y: Math.max(-320, Math.min(320, dragOriginRef.current.panY + dy)),
    });
  };

  const handleStagePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragOriginRef.current) {
      dragOriginRef.current = null;
      setIsDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  const handleStep = (dir: -1 | 1) => {
    setPlaying(false);
    if (isSpineMode && compiledSpine && currentSpineDuration > 0) {
      const stepSec = 1 / Math.max(12, Math.min(30, compiledSpine.fps || 24));
      let next = spineTimeRef.current + dir * stepSec;
      if (next < 0) next = currentSpineDuration;
      if (next > currentSpineDuration) next = 0;
      spineTimeRef.current = next;
      setSpineTime(next);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (ctx) {
        renderCompositeSpineFrame(ctx, next);
      }
    } else if (playableFrames.length > 0) {
      setFrameIndex((i) => (i + dir + playableFrames.length) % playableFrames.length);
    }
  };

  const handleScrubSpine = (nextSec: number) => {
    setPlaying(false);
    spineTimeRef.current = nextSec;
    setSpineTime(nextSec);
    if (compiledSpine && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        renderCompositeSpineFrame(ctx, nextSec);
      }
    }
  };

  const handleSelectTrack = (animName: string) => {
    setSelectedAnim(animName);
    spineTimeRef.current = 0;
    firedSoundsRef.current.clear();
    stopAllAudio();
    setSpineTime(0);
    setFrameIndex(0);
    setPan({ x: 0, y: 0 });
    setPlaying(true);
    setViewTab('live');
  };

  const handleSaveCurrentPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    const suffix = isSpineMode
      ? `${selectedAnim || 'pose'}_${spineTime.toFixed(2)}s`
      : `frame_${frameIndex + 1}`;
    a.download = `${target.bundle.name}_${suffix}.png`;
    a.click();
  };

  const handleExportBundleZip = async () => {
    setExportingZip(true);
    try {
      await downloadCustomRequestZip(catalog, {
        archiveName: `animacao_${target.bundle.name}`,
        imageFormat: 'webp',
        includeDatabase: false,
        spineIds: target.mode === 'spine' ? [target.bundle.id] : [],
        anim2dIds: target.mode === 'anim2d' ? [target.bundle.id] : [],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao exportar pacote.');
    } finally {
      setExportingZip(false);
    }
  };

  const handleExportFramesZip = async () => {
    if (exportingFrames || loadedImageCount === 0) return;
    setExportingFrames(true);
    setFrameExportProgress({ completed: 0, total: 1, stage: 'Preparando frames...' });
    try {
      if (isSpineMode && compiledSpine) {
        await exportSpineAnimationFramesZip({
          bundleName: target.bundle.name,
          animName: effectiveAnimName || selectedAnim || 'pose',
          compiled: compiledSpine,
          loadedImages,
          zoom,
          fps: 24,
          frameSize: 480,
          onProgress: (p) => setFrameExportProgress(p),
        });
      } else if (!isSpineMode && loadedImages.main && playableFrames.length > 0) {
        await exportAnim2DFramesZip({
          bundleName: target.bundle.name,
          frames: playableFrames.map((f) => ({
            label: f.label,
            x: f.x,
            y: f.y,
            w: f.w,
            h: f.h,
            rotate: f.rotate,
          })),
          image: loadedImages.main,
          onProgress: (p) => setFrameExportProgress(p),
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao exportar frames PNG.');
    } finally {
      setExportingFrames(false);
      setFrameExportProgress(null);
    }
  };

  const stageBgClass =
    bgMode === 'checker'
      ? 'checkerboard-bg'
      : bgMode === 'light'
      ? 'bg-[#EAECEF]'
      : 'bg-[#090B10]';

  const hasTrackSidebar = isSpineMode && spineData && spineData.animations.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-0 sm:p-4 overscroll-contain"
      onClick={onClose}
    >
      <div
        className="w-full h-[100dvh] sm:h-[90vh] sm:max-w-5xl bg-[#13161F] sm:border sm:border-[#252B3B] sm:rounded-xl flex flex-col overflow-hidden overscroll-contain"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top bar */}
        <div className="shrink-0 flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-[#222736]">
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-semibold text-white truncate">{title}</h2>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] sm:text-xs text-[#8E97AB] font-mono tabular-nums mt-0.5">
              <span>{isSpineMode ? 'Spine 3.8' : 'TexturePacker 2D'}</span>
              <span aria-hidden="true">·</span>
              <span>{formatBytes(target.bundle.totalBytes)}</span>
              {spineData && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{spineData.animations.length} faixas</span>
                  <span className="hidden sm:inline" aria-hidden="true">
                    ·
                  </span>
                  <span className="hidden sm:inline">{spineData.regions.length} recortes</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              onClick={handleSaveCurrentPng}
              disabled={viewTab !== 'live' || loadedImageCount === 0}
              title="Salvar frame atual em PNG"
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-medium text-[#E6E9F0] bg-[#1D2230] hover:bg-[#272E40] disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Frame PNG</span>
              <span className="lg:hidden">PNG</span>
            </button>
            <button
              onClick={handleExportFramesZip}
              disabled={
                exportingFrames ||
                loadedImageCount === 0 ||
                (isSpineMode ? !compiledSpine : playableFrames.length === 0)
              }
              title="Exportar sequência de frames PNG + Sprite Sheet em ZIP"
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-medium text-[#E6E9F0] bg-[#1D2230] hover:bg-[#2A3348] border border-[#2C344A] disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap"
            >
              <Film className="w-3.5 h-3.5 text-[#F97316]" />
              <span className="hidden md:inline">
                {exportingFrames && frameExportProgress
                  ? `${frameExportProgress.completed}/${frameExportProgress.total} frames...`
                  : 'Frames + Sheet ZIP'}
              </span>
              <span className="md:hidden">
                {exportingFrames ? '...' : 'Sheet'}
              </span>
            </button>
            <button
              onClick={handleExportBundleZip}
              disabled={exportingZip}
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 text-xs font-medium text-white bg-[#EA580C] hover:bg-[#C2410C] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
            >
              <FileArchive className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">
                {exportingZip ? 'Compactando...' : 'Baixar ZIP'}
              </span>
              <span className="sm:hidden">{exportingZip ? '...' : 'ZIP'}</span>
            </button>
            <button
              onClick={onClose}
              aria-label="Fechar player"
              className="p-2 text-[#8E97AB] hover:text-white rounded-lg hover:bg-[#1D2230] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Mode Switcher */}
        <div className="shrink-0 flex items-center justify-between gap-3 px-4 sm:px-5 py-2 bg-[#0F1219] border-b border-[#222736] overflow-x-auto">
          <div className="flex items-center gap-1 p-1 bg-[#161A25] rounded-lg shrink-0">
            {(
              [
                ['live', 'Animação ao Vivo'],
                ['frames', 'Frames'],
                ['sheet', 'Sprite Sheet'],
                ['json', 'Metadados'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setViewTab(key)}
                className={`px-2.5 sm:px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  viewTab === key
                    ? 'bg-[#EA580C] text-white'
                    : 'text-[#9CA5B9] hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {viewTab === 'live' && (
            <div className="flex items-center gap-2 text-xs text-[#9CA5B9] shrink-0">
              {isSpineMode && hasVfxCmds && (
                <button
                  type="button"
                  onClick={() => setShowVfx((v) => !v)}
                  title="Ativar ou ocultar efeitos VFX (@CMD) da habilidade"
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                    showVfx
                      ? 'bg-[#EA580C]/20 text-[#FB923C] border border-[#EA580C]/40'
                      : 'bg-[#161A25] text-[#8E97AB] hover:text-white border border-transparent'
                  }`}
                >
                  <Sparkles className="w-3 h-3" />
                  <span>
                    VFX{loadingVfx ? '...' : activeVfxMap.size > 0 ? ` (${activeVfxMap.size})` : ''}
                  </span>
                </button>
              )}

              {isSpineMode && hasSoundCmds && (
                <button
                  type="button"
                  onClick={() => setSoundEnabled((s) => !s)}
                  title={soundEnabled ? 'Silenciar efeitos sonoros @CMD' : 'Ativar efeitos sonoros @CMD'}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                    soundEnabled
                      ? 'bg-[#EA580C]/20 text-[#FB923C] border border-[#EA580C]/40'
                      : 'bg-[#161A25] text-[#8E97AB] hover:text-white border border-transparent'
                  }`}
                >
                  {soundEnabled ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
                  <span className="hidden md:inline">Som</span>
                </button>
              )}

              <div className="flex items-center gap-0.5 p-0.5 bg-[#161A25] rounded-md">
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
                    className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                      bgMode === bg ? 'bg-[#262D3F] text-white' : 'text-[#8E97AB] hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <label className="hidden sm:flex items-center gap-2">
                <span>Zoom</span>
                <input
                  type="range"
                  min="0.3"
                  max="2.5"
                  step="0.05"
                  value={zoom}
                  onChange={(e) => setZoom(parseFloat(e.target.value))}
                  className="w-20 accent-[#EA580C]"
                />
                <span className="font-mono tabular-nums w-9 text-right">
                  {Math.round(zoom * 100)}%
                </span>
              </label>

              {hasCameraOffset && (
                <button
                  type="button"
                  onClick={() => {
                    setZoom(1);
                    setPan({ x: 0, y: 0 });
                  }}
                  title="Centralizar câmera"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-[#1D2230] hover:bg-[#2A3248] text-white whitespace-nowrap"
                >
                  <Move className="w-3 h-3" />
                  <span className="hidden md:inline">Centralizar</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Main Body: strictly bounded flex layout so Player NEVER collapses and Tracks scroll independently */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col lg:flex-row">
          {/* Left / Top Stage */}
          <div
            className={
              viewTab === 'live' && hasTrackSidebar
                ? 'shrink-0 h-[44dvh] min-h-[250px] max-h-[420px] lg:h-auto lg:max-h-none lg:flex-1 lg:min-h-0 flex flex-col min-w-0 overflow-hidden'
                : 'flex-1 min-h-0 flex flex-col min-w-0 overflow-hidden'
            }
          >
            {loading ? (
              <div className="flex-1 flex items-center justify-center p-6 text-sm text-[#8E97AB] text-center">
                Carregando skeleton e atlas do servidor CDN...
              </div>
            ) : error ? (
              <div className="flex-1 flex items-center justify-center p-6 text-sm text-[#FCA5A5] text-center">
                {error}
              </div>
            ) : viewTab === 'live' ? (
              <>
                <div
                  onPointerDown={handleStagePointerDown}
                  onPointerMove={handleStagePointerMove}
                  onPointerUp={handleStagePointerUp}
                  onPointerCancel={handleStagePointerUp}
                  className={`flex-1 min-h-0 relative flex items-center justify-center overflow-hidden select-none touch-none ${
                    isDragging ? 'cursor-grabbing' : 'cursor-grab'
                  } ${stageBgClass}`}
                >
                  <canvas
                    ref={canvasRef}
                    width={840}
                    height={540}
                    className="w-full h-full object-contain pointer-events-none"
                  />

                  {selectedAnim && isSpineMode && (
                    <div className="absolute top-2.5 left-2.5 px-2.5 py-1 rounded bg-[#0B0D12]/85 border border-[#222736] text-[11px] font-mono text-white max-w-[75%] truncate pointer-events-none">
                      {effectiveAnimName !== selectedAnim
                        ? `${selectedAnim} → ${effectiveAnimName}`
                        : selectedAnim}
                    </div>
                  )}

                  {loadedImageCount === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-[#FCA5A5] bg-[#0B0D12]/70">
                      Textura do atlas não encontrada neste servidor CDN.
                    </div>
                  )}

                  {isSpineMode ? (
                    <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between gap-2 pointer-events-none">
                      <div className="px-2.5 py-1 rounded bg-[#0B0D12]/85 border border-[#222736] text-[11px] font-mono tabular-nums text-[#C9D1E1] truncate">
                        {spineTime.toFixed(2)}s / {currentSpineDuration.toFixed(2)}s
                        {activeSlotInfo ? ` · ${activeSlotInfo}` : ''}
                      </div>
                      <div className="hidden sm:block px-2 py-0.5 rounded bg-[#0B0D12]/75 border border-[#222736] text-[10px] text-[#8E97AB] shrink-0">
                        Arraste para mover a câmera
                      </div>
                    </div>
                  ) : (
                    playableFrames.length > 0 && (
                      <div className="absolute bottom-2.5 left-2.5 px-2.5 py-1 rounded bg-[#0B0D12]/85 border border-[#222736] text-[11px] font-mono tabular-nums text-[#C9D1E1] pointer-events-none">
                        Frame {(frameIndex % playableFrames.length) + 1}/{playableFrames.length} ·{' '}
                        {playableFrames[frameIndex % playableFrames.length]?.label}
                      </div>
                    )
                  )}
                </div>

                {/* Playback Controls */}
                <div className="shrink-0 px-3 sm:px-5 py-2.5 bg-[#10131B] border-t border-[#222736] flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setPlaying((p) => !p)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#1F2536] hover:bg-[#2A3248] rounded-lg transition-colors"
                    >
                      {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      <span>{playing ? 'Pausar' : 'Play'}</span>
                    </button>
                    <button
                      onClick={() => handleStep(-1)}
                      aria-label="Frame anterior"
                      className="p-1.5 text-[#C9D1E1] bg-[#181C28] hover:bg-[#242A3B] rounded-lg"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleStep(1)}
                      aria-label="Próximo frame"
                      className="p-1.5 text-[#C9D1E1] bg-[#181C28] hover:bg-[#242A3B] rounded-lg"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        spineTimeRef.current = 0;
                        firedSoundsRef.current.clear();
                        stopAllAudio();
                        setSpineTime(0);
                        setFrameIndex(0);
                        setZoom(1);
                        setPan({ x: 0, y: 0 });
                      }}
                      aria-label="Reiniciar e centralizar"
                      className="p-1.5 text-[#C9D1E1] bg-[#181C28] hover:bg-[#242A3B] rounded-lg"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {isSpineMode && currentSpineDuration > 0 ? (
                    <input
                      type="range"
                      min={0}
                      max={currentSpineDuration}
                      step={0.01}
                      value={Math.min(spineTime, currentSpineDuration)}
                      onChange={(e) => handleScrubSpine(parseFloat(e.target.value))}
                      className="flex-1 min-w-[100px] accent-[#EA580C]"
                    />
                  ) : (
                    !isSpineMode &&
                    playableFrames.length > 1 && (
                      <input
                        type="range"
                        min={0}
                        max={playableFrames.length - 1}
                        value={frameIndex % playableFrames.length}
                        onChange={(e) => {
                          setPlaying(false);
                          setFrameIndex(parseInt(e.target.value, 10));
                        }}
                        className="flex-1 min-w-[100px] accent-[#EA580C]"
                      />
                    )
                  )}

                  <div className="flex items-center gap-1">
                    {[0.5, 1, 1.5, 2].map((spd) => (
                      <button
                        key={spd}
                        onClick={() => setSpeed(spd)}
                        className={`px-2 py-1 text-[11px] font-mono tabular-nums rounded ${
                          speed === spd
                            ? 'bg-[#EA580C] text-white'
                            : 'bg-[#181C28] text-[#9CA5B9] hover:text-white'
                        }`}
                      >
                        {spd}x
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : viewTab === 'frames' ? (
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y p-4 sm:p-5">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                  {playableFrames.slice(0, 120).map((f, idx) => (
                    <button
                      key={`${f.label}-${idx}`}
                      onClick={() => {
                        if (isSpineMode) {
                          handleScrubSpine(f.time);
                        } else {
                          setFrameIndex(idx);
                          setPlaying(false);
                        }
                        setViewTab('live');
                      }}
                      className="text-left p-2.5 bg-[#0F1219] border border-[#222736] hover:border-[#EA580C] rounded-lg transition-colors"
                    >
                      <div className="text-xs font-mono text-white truncate">{f.label}</div>
                      <div className="text-[11px] font-mono tabular-nums text-[#8E97AB] mt-1">
                        {f.w}×{f.h}px · {f.time.toFixed(2)}s
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : viewTab === 'sheet' ? (
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y p-4 sm:p-5 space-y-4">
                {Object.entries(loadedImages).map(([pageName, img]) => (
                  <div key={pageName} className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-mono text-[#9CA5B9]">
                      <span className="truncate">{pageName}</span>
                      <span className="tabular-nums shrink-0">
                        {img.naturalWidth} × {img.naturalHeight} px
                      </span>
                    </div>
                    <div className="checkerboard-bg border border-[#222736] rounded-lg p-3 flex justify-center">
                      <img
                        src={img.src}
                        alt={pageName}
                        referrerPolicy="no-referrer"
                        className="max-h-[380px] object-contain"
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y p-4 sm:p-5">
                <pre className="text-xs font-mono text-[#C9D1E1] bg-[#0B0D12] border border-[#222736] rounded-lg p-4 overflow-x-auto">
                  {JSON.stringify(
                    isSpineMode
                      ? {
                          skeleton: spineData?.skeleton,
                          bones: spineData?.bonesCount,
                          slots: spineData?.slotsCount,
                          skins: spineData?.skins,
                          pages: spineData?.pages,
                          animations: spineData?.animations.map((a) => ({
                            name: a.name,
                            duration: a.duration,
                            keyframes: a.keyframeCount,
                          })),
                          files: target.bundle.allFiles.map((f) => f.url),
                        }
                      : {
                          bundle: target.bundle.name,
                          framesCount: anim2dData?.frames.length,
                          files: target.bundle.allFiles.map((f) => f.url),
                        },
                    null,
                    2
                  )}
                </pre>
              </div>
            )}
          </div>

          {/* Right / Bottom Track List (Spine only) — independent bounded scroll */}
          {hasTrackSidebar && (
            <aside className="flex-1 min-h-0 lg:flex-none lg:w-72 border-t lg:border-t-0 lg:border-l border-[#222736] bg-[#0F1219] flex flex-col overflow-hidden">
              <div className="shrink-0 px-3.5 py-2.5 border-b border-[#222736] space-y-2">
                <div className="flex items-center justify-between gap-2 text-xs font-medium text-[#C9D1E1]">
                  <span className="flex items-center gap-2">
                    <Layers className="w-3.5 h-3.5 text-[#EA580C]" />
                    <span>Faixas de Animação ({spineData.animations.length})</span>
                  </span>
                </div>
                {spineData.animations.length > 6 && (
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-[#7C859B] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={trackSearch}
                      onChange={(e) => setTrackSearch(e.target.value)}
                      placeholder="Filtrar faixa (ex: idle, skill, attack)..."
                      className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#161A25] border border-[#252B3B] focus:border-[#EA580C] rounded-md text-white placeholder-[#6E778C] outline-none"
                    />
                  </div>
                )}
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y divide-y divide-[#1A1F2C]">
                {filteredAnimations.map((anim) => {
                  const active = anim.name === selectedAnim;
                  return (
                    <button
                      key={anim.name}
                      onClick={() => handleSelectTrack(anim.name)}
                      className={`w-full text-left px-4 py-2.5 transition-colors flex items-center justify-between gap-2 ${
                        active
                          ? 'bg-[#EA580C]/15 text-white border-l-2 border-[#EA580C]'
                          : 'text-[#A7B0C4] hover:bg-[#171B26]'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-mono truncate">{anim.name}</div>
                        <div className="text-[11px] font-mono tabular-nums text-[#7C859B] mt-0.5">
                          {anim.duration}s · {anim.keyframeCount} keyframes
                        </div>
                      </div>
                      {active && (
                        <span className="text-[10px] font-mono uppercase text-[#FB923C] shrink-0">
                          Ativa
                        </span>
                      )}
                    </button>
                  );
                })}
                {filteredAnimations.length === 0 && (
                  <div className="p-4 text-xs text-[#7C859B]">
                    Nenhuma faixa corresponde ao filtro &quot;{trackSearch}&quot;.
                  </div>
                )}
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
