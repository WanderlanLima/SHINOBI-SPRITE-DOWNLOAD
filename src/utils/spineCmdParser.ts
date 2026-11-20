/**
 * Parser para os eventos `@CMD` embutidos nos skeletons Spine 3.8 (`vdfno_*.json`) de naruto.jotagame.com.
 *
 * O cliente original do jogo armazena dentro dos keyframes `events` (nome `@CMD`) exatamente:
 * - `{DISPLAYONFIGHTER:name="...",spine="noe_...",source="...",loop="none",targets=["self"],layer="rbg"}`
 * - `{DISPLAY:name="...",spine="noe_...",source="...",loop="once",layer="fg"}`
 * - `{SOUND:name="nos_157_2"}` -> `acervo/som/nos/157_2.mp3`
 * - `{PLAYVEDIO:source="vdfno_PEATDdbtx"}` -> `acervo/video/hero/vdfno_PEATDdbtx.mp4`
 * - `{ROCK:Hstrength=1.0,Vstrength=1.0}`
 * - `{SceneTransform:onlyBg=1,...}`
 */

export interface SpineVfxCmd {
  id: string;
  time: number;
  spineName: string;
  sourceAnim: string;
  layer: 'bg' | 'fg';
  loop: boolean;
  onSelf: boolean;
  isFullscreen: boolean;
}

export interface SpineSoundCmd {
  time: number;
  rawName: string;
  assetUrl: string;
}

export interface SpineVideoCmd {
  time: number;
  source: string;
  filename: string;
}

export interface SpineShakeCmd {
  time: number;
  strength: number;
}

export interface SpineDimCmd {
  time: number;
  durationSec: number;
  alpha: number;
}

export interface ParsedAnimCmdTimeline {
  vfx: SpineVfxCmd[];
  sounds: SpineSoundCmd[];
  videos: SpineVideoCmd[];
  shakes: SpineShakeCmd[];
  dims: SpineDimCmd[];
  /** Se a animação delega para outra faixa via `{PLAY:name="skill",loop=0}` (ex: skillAction -> skill) */
  delegatedAnim: string | null;
}

export interface DiscoveredSkeletonResources {
  vfxSpineNames: string[];
  videoSources: string[];
  soundUrls: string[];
}

function extractCommandBlocks(cmdString: string): Array<{ type: string; body: string }> {
  const blocks: Array<{ type: string; body: string }> = [];
  let i = 0;
  const n = cmdString.length;

  while (i < n) {
    if (cmdString[i] !== '{') {
      i++;
      continue;
    }
    let depth = 1;
    let j = i + 1;
    while (j < n && depth > 0) {
      if (cmdString[j] === '{') depth++;
      else if (cmdString[j] === '}') depth--;
      j++;
    }
    if (depth === 0) {
      const inner = cmdString.slice(i + 1, j - 1).trim();
      const colonIdx = inner.indexOf(':');
      if (colonIdx === -1) {
        blocks.push({ type: inner.toUpperCase(), body: '' });
      } else {
        blocks.push({
          type: inner.slice(0, colonIdx).trim().toUpperCase(),
          body: inner.slice(colonIdx + 1).trim(),
        });
      }
      i = j;
    } else {
      break;
    }
  }
  return blocks;
}

function readStrAttr(body: string, key: string): string | null {
  const re = new RegExp(`(?:^|,)\\s*${key}\\s*=\\s*"([^"]*)"`, 'i');
  const m = body.match(re);
  return m ? m[1] : null;
}

function readNumAttr(body: string, key: string): number | null {
  const re = new RegExp(`(?:^|,)\\s*${key}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`, 'i');
  const m = body.match(re);
  if (!m) return null;
  const val = parseFloat(m[1]);
  return Number.isFinite(val) ? val : null;
}

export function resolveCmdSoundUrl(rawName: string): string | null {
  const clean = rawName.trim().replace(/\.(mp3|ogg|wav)$/i, '');
  if (!clean) return null;

  // Padrão principal do motor de batalha: `nos_157_2` -> `acervo/som/nos/157_2.mp3`
  if (/^nos_/i.test(clean)) {
    return `acervo/som/nos/${clean.slice(4)}.mp3`;
  }
  if (/^lines_/i.test(clean)) {
    return `acervo/som/lines/${clean}.mp3`;
  }
  if (/^die_/i.test(clean)) {
    return `acervo/som/Die/${clean}.mp3`;
  }
  if (/_aoyiaf$/i.test(clean)) {
    return `acervo/som/AFaoyi/${clean}.mp3`;
  }
  return `acervo/som/${clean}.mp3`;
}

export function parseAnimationCmdTimeline(
  rawSkeleton: Record<string, any> | null | undefined,
  animName: string
): ParsedAnimCmdTimeline {
  const result: ParsedAnimCmdTimeline = {
    vfx: [],
    sounds: [],
    videos: [],
    shakes: [],
    dims: [],
    delegatedAnim: null,
  };

  if (!rawSkeleton || !animName) return result;
  const anim = rawSkeleton.animations?.[animName];
  const events: any[] = Array.isArray(anim?.events) ? anim.events : [];
  if (events.length === 0) return result;

  const fps = typeof rawSkeleton.skeleton?.fps === 'number' && rawSkeleton.skeleton.fps > 0
    ? rawSkeleton.skeleton.fps
    : 24;

  let vfxSeq = 0;

  for (const ev of events) {
    if (ev?.name !== '@CMD' || typeof ev?.string !== 'string') continue;
    const time = typeof ev.time === 'number' && Number.isFinite(ev.time) ? Math.max(0, ev.time) : 0;
    const blocks = extractCommandBlocks(ev.string);

    for (const blk of blocks) {
      if (blk.type === 'DISPLAYONFIGHTER' || blk.type === 'DISPLAY') {
        const spineName = readStrAttr(blk.body, 'spine');
        if (!spineName) continue;
        const sourceAnim = readStrAttr(blk.body, 'source') || '';
        const layerRaw = (readStrAttr(blk.body, 'layer') || '').toLowerCase();
        const loopRaw = (readStrAttr(blk.body, 'loop') || 'none').toLowerCase();
        const layer: 'bg' | 'fg' =
          layerRaw === 'bg' || layerRaw === 'rbg' || layerRaw === 'back' ? 'bg' : 'fg';
        const onSelf = /targets\s*=\s*\[\s*"self"\s*\]/i.test(blk.body);

        result.vfx.push({
          id: `${vfxSeq++}_${spineName}_${sourceAnim}_${time.toFixed(3)}`,
          time,
          spineName,
          sourceAnim,
          layer,
          loop: loopRaw === 'loop' || loopRaw === 'true' || loopRaw === '1',
          onSelf,
          isFullscreen: blk.type === 'DISPLAY',
        });
      } else if (blk.type === 'SOUND') {
        const rawName = readStrAttr(blk.body, 'name');
        if (!rawName) continue;
        const assetUrl = resolveCmdSoundUrl(rawName);
        if (!assetUrl) continue;
        result.sounds.push({ time, rawName, assetUrl });
      } else if (blk.type === 'PLAYVEDIO' || blk.type === 'PLAYVIDEO') {
        const source = readStrAttr(blk.body, 'source') || readStrAttr(blk.body, 'name');
        if (!source) continue;
        const clean = source.replace(/\.mp4$/i, '');
        result.videos.push({
          time,
          source: clean,
          filename: `${clean}.mp4`,
        });
      } else if (blk.type === 'ROCK') {
        const h = readNumAttr(blk.body, 'Hstrength') ?? 0.8;
        const v = readNumAttr(blk.body, 'Vstrength') ?? 0.8;
        result.shakes.push({ time, strength: Math.max(h, v) });
      } else if (blk.type === 'SCENETRANSFORM') {
        const durFrames = readNumAttr(blk.body, 'duration') ?? 45;
        result.dims.push({
          time,
          durationSec: Math.max(0.2, durFrames / Math.max(24, fps)),
          alpha: 0.45,
        });
      } else if (blk.type === 'PLAY') {
        const targetName = readStrAttr(blk.body, 'name');
        if (targetName && !/^(run|shunyi|idle)$/i.test(targetName)) {
          result.delegatedAnim = targetName;
        }
      }
    }
  }

  return result;
}

/**
 * Varre todas as faixas de animação de um `vdfno_*.json` para descobrir 100% dos
 * efeitos VFX (`noe_*`), vídeos MP4 (`PLAYVEDIO`) e sons (`nos_*`) oficiais daquele ninja.
 */
export function extractAllSkeletonCmdResources(
  rawSkeleton: Record<string, any> | null | undefined
): DiscoveredSkeletonResources {
  const vfxSet = new Set<string>();
  const videoSet = new Set<string>();
  const soundSet = new Set<string>();

  if (!rawSkeleton?.animations || typeof rawSkeleton.animations !== 'object') {
    return { vfxSpineNames: [], videoSources: [], soundUrls: [] };
  }

  for (const animName of Object.keys(rawSkeleton.animations)) {
    const parsed = parseAnimationCmdTimeline(rawSkeleton, animName);
    for (const v of parsed.vfx) vfxSet.add(v.spineName);
    for (const vid of parsed.videos) videoSet.add(vid.source);
    for (const snd of parsed.sounds) soundSet.add(snd.assetUrl);
  }

  return {
    vfxSpineNames: [...vfxSet],
    videoSources: [...videoSet],
    soundUrls: [...soundSet],
  };
}
