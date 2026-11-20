import { loadImageWithFallback } from '../services/assetSource';
import { type FullCatalog, inspectSpineLive } from '../services/catalogEngine';
import {
  type ParsedAnimCmdTimeline,
  type SpineVfxCmd,
  parseAnimationCmdTimeline,
} from './spineCmdParser';
import {
  type CompiledSpineSkeleton,
  type SpineBounds,
  type SpineSceneLayer,
  compileSpineSkeleton,
  computeAnimationBounds,
  getAnimationDuration,
  mergeSpineBounds,
} from './spineRenderer';

export interface LoadedVfxSpine {
  spineName: string;
  compiled: CompiledSpineSkeleton;
  images: Record<string, HTMLImageElement>;
  animNames: string[];
}

/**
 * Resolve uma faixa delegada (`uniqueSkill` -> `UniqueSkill`, `skillAction` -> `skill`)
 * e retorna o nome efetivo da faixa + sua timeline `@CMD` parseada.
 */
export function resolveEffectiveAnimation(
  rawSkeleton: Record<string, any> | null | undefined,
  requestedAnim: string
): { animName: string; timeline: ParsedAnimCmdTimeline } {
  let current = requestedAnim;
  let timeline = parseAnimationCmdTimeline(rawSkeleton, current);

  for (let hop = 0; hop < 2; hop++) {
    if (
      timeline.delegatedAnim &&
      rawSkeleton?.animations &&
      Object.prototype.hasOwnProperty.call(rawSkeleton.animations, timeline.delegatedAnim) &&
      timeline.delegatedAnim !== current
    ) {
      current = timeline.delegatedAnim;
      timeline = parseAnimationCmdTimeline(rawSkeleton, current);
    } else {
      break;
    }
  }

  return { animName: current, timeline };
}

export function resolveVfxAnimName(loaded: LoadedVfxSpine, requestedSource: string): string {
  if (!requestedSource) return loaded.animNames[0] || '';
  const exact = loaded.animNames.find((n) => n === requestedSource);
  if (exact) return exact;
  const lower = requestedSource.toLowerCase();
  const ci = loaded.animNames.find((n) => n.toLowerCase() === lower);
  if (ci) return ci;
  return loaded.animNames[0] || '';
}

/**
 * Carrega (com cache em memória) todos os Spines `noe_*` referenciados nos comandos `@CMD`
 * de uma animação, compatível com CDN ao vivo e Backup ZIP do Google Drive.
 */
export async function loadVfxSpinesForTimeline(
  vfxCmds: SpineVfxCmd[],
  catalog: FullCatalog,
  cache: Map<string, LoadedVfxSpine | null>
): Promise<Map<string, LoadedVfxSpine>> {
  const uniqueNames = new Map<string, string>();
  for (const cmd of vfxCmds) {
    const key = cmd.spineName.toLowerCase();
    if (!uniqueNames.has(key)) uniqueNames.set(key, cmd.spineName);
  }

  const cdnBase = catalog.summary.cdnBase;

  await Promise.all(
    Array.from(uniqueNames.entries()).map(async ([key, rawName]) => {
      if (cache.has(key)) return;
      const bundle = catalog.spineByNameMap.get(key);
      if (!bundle) {
        cache.set(key, null);
        return;
      }

      try {
        const data = await inspectSpineLive(cdnBase, bundle.jsonUrl, bundle.atlasUrl);
        if (!data.rawSkeleton) {
          cache.set(key, null);
          return;
        }
        const images: Record<string, HTMLImageElement> = {};
        await Promise.all(
          data.pages.map(async (page) => {
            const img = await loadImageWithFallback(page.imageUrl);
            if (img) images[page.filename] = img;
          })
        );
        if (Object.keys(images).length === 0) {
          cache.set(key, null);
          return;
        }
        const compiled = compileSpineSkeleton(data.rawSkeleton, data.regions);
        cache.set(key, {
          spineName: rawName,
          compiled,
          images,
          animNames: data.animations.map((a) => a.name),
        });
      } catch {
        cache.set(key, null);
      }
    })
  );

  const result = new Map<string, LoadedVfxSpine>();
  for (const key of uniqueNames.keys()) {
    const loaded = cache.get(key);
    if (loaded) result.set(key, loaded);
  }
  return result;
}

function getVfxOffset(cmd: SpineVfxCmd): { offsetX: number; offsetY: number } {
  // Efeitos de impacto no alvo (`onSelf=false` e não fullscreen) são exibidos levemente à frente do ninja
  if (!cmd.onSelf && !cmd.isFullscreen) {
    return { offsetX: 95, offsetY: 0 };
  }
  return { offsetX: 0, offsetY: 0 };
}

export function computeSceneBoundsWithVfx(
  charCompiled: CompiledSpineSkeleton,
  charAnim: string,
  timeline: ParsedAnimCmdTimeline | null,
  vfxMap: Map<string, LoadedVfxSpine>,
  showVfx: boolean
): SpineBounds {
  let bounds = computeAnimationBounds(charCompiled, charAnim);
  if (!showVfx || !timeline || timeline.vfx.length === 0 || vfxMap.size === 0) {
    return bounds;
  }

  for (const cmd of timeline.vfx) {
    const loaded = vfxMap.get(cmd.spineName.toLowerCase());
    if (!loaded) continue;
    const vfxAnim = resolveVfxAnimName(loaded, cmd.sourceAnim);
    if (!vfxAnim) continue;
    const rawVfxBounds = computeAnimationBounds(loaded.compiled, vfxAnim);
    const { offsetX, offsetY } = getVfxOffset(cmd);
    const shifted: SpineBounds = {
      x: rawVfxBounds.x + offsetX,
      y: rawVfxBounds.y + offsetY,
      width: rawVfxBounds.width,
      height: rawVfxBounds.height,
    };
    bounds = mergeSpineBounds(bounds, shifted, cmd.isFullscreen ? 2.1 : 2.5);
  }

  return bounds;
}

export function buildSceneLayersAtTime(
  charCompiled: CompiledSpineSkeleton,
  charAnim: string,
  charTime: number,
  charImages: Record<string, HTMLImageElement>,
  timeline: ParsedAnimCmdTimeline | null,
  vfxMap: Map<string, LoadedVfxSpine>,
  showVfx: boolean
): {
  layers: SpineSceneLayer[];
  activeVfxCount: number;
  shakeX: number;
  shakeY: number;
  bgDimAlpha: number;
} {
  const layers: SpineSceneLayer[] = [
    {
      compiled: charCompiled,
      animName: charAnim,
      time: charTime,
      images: charImages,
      zOrder: 'char',
    },
  ];

  let activeVfxCount = 0;
  let shakeX = 0;
  let shakeY = 0;
  let bgDimAlpha = 0;

  if (showVfx && timeline) {
    for (const cmd of timeline.vfx) {
      if (charTime < cmd.time) continue;
      const loaded = vfxMap.get(cmd.spineName.toLowerCase());
      if (!loaded) continue;
      const vfxAnim = resolveVfxAnimName(loaded, cmd.sourceAnim);
      if (!vfxAnim) continue;

      const dur = getAnimationDuration(loaded.compiled, vfxAnim);
      const elapsed = charTime - cmd.time;
      let vfxTime = 0;
      if (dur > 0) {
        if (!cmd.loop && elapsed > dur + 0.05) continue;
        vfxTime = cmd.loop ? elapsed % dur : Math.min(elapsed, dur);
      } else if (!cmd.loop && elapsed > 0.35) {
        continue;
      }

      const { offsetX, offsetY } = getVfxOffset(cmd);
      layers.push({
        compiled: loaded.compiled,
        animName: vfxAnim,
        time: vfxTime,
        images: loaded.images,
        zOrder: cmd.layer,
        offsetX,
        offsetY,
      });
      activeVfxCount++;
    }

    for (const shk of timeline.shakes) {
      const dt = charTime - shk.time;
      if (dt >= 0 && dt <= 0.28) {
        const amp = Math.min(11, shk.strength * 6.5) * (1 - dt / 0.28);
        shakeX += Math.sin(dt * 78) * amp;
        shakeY += Math.cos(dt * 63) * amp * 0.7;
      }
    }

    for (const dim of timeline.dims) {
      const dt = charTime - dim.time;
      if (dt >= 0 && dt <= dim.durationSec) {
        const edge = Math.min(0.15, dim.durationSec * 0.2);
        let fade = 1;
        if (dt < edge) fade = dt / edge;
        else if (dt > dim.durationSec - edge) fade = Math.max(0, (dim.durationSec - dt) / edge);
        bgDimAlpha = Math.max(bgDimAlpha, dim.alpha * fade);
      }
    }
  }

  return { layers, activeVfxCount, shakeX, shakeY, bgDimAlpha };
}
