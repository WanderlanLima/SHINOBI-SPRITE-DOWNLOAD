import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileArchive,
  Layers,
  Pause,
  Play,
  RotateCcw,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { formatBytes } from '../utils/format';

export type PlayerTarget =
  | { mode: 'spine'; bundle: SpineBundle; title?: string }
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
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [bgMode, setBgMode] = useState<BgMode>('checker');
  const [frameIndex, setFrameIndex] = useState(0);
  const [exportingZip, setExportingZip] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSpineData(null);
    setAnim2dData(null);
    setLoadedImages({});
    setFrameIndex(0);
    setViewTab('live');
    setPlaying(true);

    async function load() {
      try {
        const cdnBase = catalog.summary.cdnBase;
        if (target!.mode === 'spine') {
          const b = target!.bundle;
          const data = await inspectSpineLive(cdnBase, b.jsonUrl, b.atlasUrl);
          if (cancelled) return;
          setSpineData(data);
          const defaultAnim =
            data.animations.find((a) => /^idle$/i.test(a.name))?.name || data.animations[0]?.name || '';
          setSelectedAnim(defaultAnim);

          const imgs: Record<string, HTMLImageElement> = {};
          await Promise.all(
            data.pages.map(
              (page) =>
                new Promise<void>((resolve) => {
                  const img = new Image();
                  img.crossOrigin = 'anonymous';
                  img.referrerPolicy = 'no-referrer';
                  img.onload = () => {
                    imgs[page.filename] = img;
                    resolve();
                  };
                  img.onerror = () => resolve();
                  img.src = page.imageUrl;
                })
            )
          );
          if (!cancelled) setLoadedImages(imgs);
        } else {
          const b = target!.bundle;
          const data = await inspectAnim2DLive(cdnBase, b);
          if (cancelled) return;
          setAnim2dData(data);

          if (data.imageUrl) {
            await new Promise<void>((resolve) => {
              const img = new Image();
              img.crossOrigin = 'anonymous';
              img.referrerPolicy = 'no-referrer';
              img.onload = () => {
                if (!cancelled) setLoadedImages({ main: img });
                resolve();
              };
              img.onerror = () => resolve();
              img.src = data.imageUrl;
            });
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

  // Compute playable frame sequence for current selection
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
        // Resolve unique attachment frames in chronological order
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

      // Fallback: if the animation drives skeletal bones without frame attachments, cycle all atlas regions
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

  // Playback loop
  useEffect(() => {
    if (!playing || playableFrames.length <= 1 || viewTab !== 'live') return;
    const baseFps = target?.mode === 'anim2d' ? 15 : 12;
    const intervalMs = Math.max(24, Math.round(1000 / (baseFps * speed)));
    const timer = window.setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % playableFrames.length);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [playing, playableFrames.length, speed, viewTab, target?.mode]);

  // Draw current frame onto HTML5 canvas
  useEffect(() => {
    if (viewTab !== 'live') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const frame = playableFrames[frameIndex % Math.max(1, playableFrames.length)];
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
    ctx.translate(W / 2, H / 2);
    ctx.scale(scale, scale);

    if (frame.rotate) {
      // Spine atlas 90° clockwise rotation compensation
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(img, frame.x, frame.y, srcW, srcH, -srcW / 2, -srcH / 2, srcW, srcH);
    } else {
      ctx.drawImage(img, frame.x, frame.y, srcW, srcH, -drawW / 2, -drawH / 2, drawW, drawH);
    }
    ctx.restore();
  }, [playableFrames, frameIndex, loadedImages, zoom, viewTab]);

  if (!target) return null;

  const title = target.title || target.bundle.name;

  const handleSaveCurrentPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${target.bundle.name}_frame_${frameIndex + 1}.png`;
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

  const stageBgClass =
    bgMode === 'checker'
      ? 'checkerboard-bg'
      : bgMode === 'light'
      ? 'bg-[#EAECEF]'
      : 'bg-[#090B10]';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl max-h-[92vh] bg-[#13161F] border border-[#252B3B] rounded-xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top bar */}
        <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-[#222736]">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-white truncate">{title}</h2>
            <div className="flex items-center gap-2 text-xs text-[#8E97AB] font-mono tabular-nums mt-0.5">
              <span>{target.mode === 'spine' ? 'Spine 3.8' : 'TexturePacker 2D'}</span>
              <span aria-hidden="true">·</span>
              <span>{target.bundle.allFiles.length} arquivos</span>
              <span aria-hidden="true">·</span>
              <span>{formatBytes(target.bundle.totalBytes)}</span>
              {spineData && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{spineData.animations.length} animações</span>
                  <span aria-hidden="true">·</span>
                  <span>{spineData.regions.length} recortes</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleSaveCurrentPng}
              disabled={viewTab !== 'live' || playableFrames.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#E6E9F0] bg-[#1D2230] hover:bg-[#272E40] disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Salvar Frame PNG
            </button>
            <button
              onClick={handleExportBundleZip}
              disabled={exportingZip}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-[#EA580C] hover:bg-[#C2410C] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
            >
              <FileArchive className="w-3.5 h-3.5" />
              {exportingZip ? 'Compactando...' : 'Baixar Pacote ZIP'}
            </button>
            <button
              onClick={onClose}
              aria-label="Fechar player"
              className="p-1.5 text-[#8E97AB] hover:text-white rounded-lg hover:bg-[#1D2230] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Mode Switcher */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 bg-[#0F1219] border-b border-[#222736]">
          <div className="flex items-center gap-1 p-1 bg-[#161A25] rounded-lg">
            {(
              [
                ['live', 'Animação ao Vivo'],
                ['frames', 'Frames Extraídos'],
                ['sheet', 'Sprite Sheet'],
                ['json', 'Metadados'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setViewTab(key)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
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
            <div className="flex items-center gap-3 text-xs text-[#9CA5B9]">
              <div className="flex items-center gap-1 p-0.5 bg-[#161A25] rounded-md">
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

              <label className="flex items-center gap-2">
                <span>Zoom</span>
                <input
                  type="range"
                  min="0.4"
                  max="2.2"
                  step="0.1"
                  value={zoom}
                  onChange={(e) => setZoom(parseFloat(e.target.value))}
                  className="w-20 accent-[#EA580C]"
                />
                <span className="font-mono tabular-nums w-9 text-right">
                  {Math.round(zoom * 100)}%
                </span>
              </label>
            </div>
          )}
        </div>

        {/* Main Body */}
        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row min-h-[420px]">
          {/* Left Stage */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {loading ? (
              <div className="flex-1 flex items-center justify-center text-sm text-[#8E97AB]">
                Carregando skeleton e atlas do servidor CDN...
              </div>
            ) : error ? (
              <div className="flex-1 flex items-center justify-center p-6 text-sm text-[#FCA5A5]">
                {error}
              </div>
            ) : viewTab === 'live' ? (
              <>
                <div className={`flex-1 relative flex items-center justify-center overflow-hidden ${stageBgClass}`}>
                  <canvas
                    ref={canvasRef}
                    width={720}
                    height={460}
                    className="max-w-full max-h-[440px] object-contain"
                  />
                  {playableFrames.length > 0 && (
                    <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded bg-[#0B0D12]/85 border border-[#222736] text-[11px] font-mono tabular-nums text-[#C9D1E1]">
                      Frame {(frameIndex % playableFrames.length) + 1}/{playableFrames.length} ·{' '}
                      {playableFrames[frameIndex % playableFrames.length]?.label}
                    </div>
                  )}
                </div>

                {/* Playback Controls */}
                <div className="px-5 py-3 bg-[#10131B] border-t border-[#222736] flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPlaying((p) => !p)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#1F2536] hover:bg-[#2A3248] rounded-lg transition-colors"
                    >
                      {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      {playing ? 'Pausar' : 'Reproduzir'}
                    </button>
                    <button
                      onClick={() => {
                        setPlaying(false);
                        setFrameIndex((i) => (i - 1 + playableFrames.length) % Math.max(1, playableFrames.length));
                      }}
                      aria-label="Frame anterior"
                      className="p-1.5 text-[#C9D1E1] bg-[#181C28] hover:bg-[#242A3B] rounded-lg"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        setPlaying(false);
                        setFrameIndex((i) => (i + 1) % Math.max(1, playableFrames.length));
                      }}
                      aria-label="Próximo frame"
                      className="p-1.5 text-[#C9D1E1] bg-[#181C28] hover:bg-[#242A3B] rounded-lg"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        setFrameIndex(0);
                        setZoom(1);
                      }}
                      aria-label="Reiniciar"
                      className="p-1.5 text-[#C9D1E1] bg-[#181C28] hover:bg-[#242A3B] rounded-lg"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {playableFrames.length > 1 && (
                    <input
                      type="range"
                      min={0}
                      max={playableFrames.length - 1}
                      value={frameIndex % playableFrames.length}
                      onChange={(e) => {
                        setPlaying(false);
                        setFrameIndex(parseInt(e.target.value, 10));
                      }}
                      className="flex-1 min-w-[140px] accent-[#EA580C]"
                    />
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
              <div className="flex-1 overflow-y-auto p-5">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {playableFrames.slice(0, 80).map((f, idx) => (
                    <button
                      key={`${f.label}-${idx}`}
                      onClick={() => {
                        setFrameIndex(idx);
                        setPlaying(false);
                        setViewTab('live');
                      }}
                      className="text-left p-2.5 bg-[#0F1219] border border-[#222736] hover:border-[#EA580C] rounded-lg transition-colors"
                    >
                      <div className="text-xs font-mono text-white truncate">{f.label}</div>
                      <div className="text-[11px] font-mono tabular-nums text-[#8E97AB] mt-1">
                        {f.w}×{f.h}px · ({f.x}, {f.y})
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : viewTab === 'sheet' ? (
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {Object.entries(loadedImages).map(([pageName, img]) => (
                  <div key={pageName} className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-mono text-[#9CA5B9]">
                      <span>{pageName}</span>
                      <span className="tabular-nums">
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
              <div className="flex-1 overflow-y-auto p-5">
                <pre className="text-xs font-mono text-[#C9D1E1] bg-[#0B0D12] border border-[#222736] rounded-lg p-4 overflow-x-auto">
                  {JSON.stringify(
                    target.mode === 'spine'
                      ? {
                          skeleton: spineData?.skeleton,
                          bones: spineData?.bonesCount,
                          slots: spineData?.slotsCount,
                          skins: spineData?.skins,
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

          {/* Right Track List (Spine only) */}
          {target.mode === 'spine' && spineData && (
            <aside className="w-full lg:w-64 border-t lg:border-t-0 lg:border-l border-[#222736] bg-[#0F1219] flex flex-col">
              <div className="px-4 py-3 border-b border-[#222736] flex items-center gap-2 text-xs font-medium text-[#C9D1E1]">
                <Layers className="w-3.5 h-3.5 text-[#EA580C]" />
                <span>Faixas de Animação ({spineData.animations.length})</span>
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-[#1A1F2C]">
                {spineData.animations.map((anim) => {
                  const active = anim.name === selectedAnim;
                  return (
                    <button
                      key={anim.name}
                      onClick={() => {
                        setSelectedAnim(anim.name);
                        setFrameIndex(0);
                        setPlaying(true);
                      }}
                      className={`w-full text-left px-4 py-2.5 transition-colors ${
                        active ? 'bg-[#EA580C]/15 text-white' : 'text-[#A7B0C4] hover:bg-[#171B26]'
                      }`}
                    >
                      <div className="text-xs font-mono truncate">{anim.name}</div>
                      <div className="text-[11px] font-mono tabular-nums text-[#7C859B] mt-0.5">
                        {anim.duration}s · {anim.keyframeCount} keyframes
                      </div>
                    </button>
                  );
                })}
                {spineData.animations.length === 0 && (
                  <div className="p-4 text-xs text-[#7C859B]">
                    Nenhuma faixa nomeada neste skeleton.
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
