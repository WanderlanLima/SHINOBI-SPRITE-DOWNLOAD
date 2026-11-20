import type { SpineAtlasRegion } from '../types';

interface BoneSetup {
  name: string;
  parentIndex: number;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  shearX: number;
  shearY: number;
}

interface SlotSetup {
  name: string;
  boneIndex: number;
  attachment: string | null;
  color: [number, number, number, number];
  blend: string;
}

interface RegionAttachment {
  name: string;
  path: string;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  width: number;
  height: number;
  color: [number, number, number, number];
}

interface WorldTransform {
  a: number;
  b: number;
  c: number;
  d: number;
  wx: number;
  wy: number;
}

export interface CompiledSpineSkeleton {
  bones: BoneSetup[];
  boneIndexByName: Map<string, number>;
  slots: SlotSetup[];
  attachments: Map<string, Map<string, RegionAttachment>>;
  regions: Map<string, SpineAtlasRegion>;
  animations: Record<string, any>;
  bounds: { x: number; y: number; width: number; height: number };
  fps: number;
}

function parseHexColor(hex?: string): [number, number, number, number] {
  if (!hex || typeof hex !== 'string') return [1, 1, 1, 1];
  const clean = hex.replace(/^#/, '');
  if (clean.length < 6) return [1, 1, 1, 1];
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const a = clean.length >= 8 ? parseInt(clean.slice(6, 8), 16) / 255 : 1;
  return [
    Number.isFinite(r) ? r : 1,
    Number.isFinite(g) ? g : 1,
    Number.isFinite(b) ? b : 1,
    Number.isFinite(a) ? a : 1,
  ];
}

export function compileSpineSkeleton(
  rawSkeleton: Record<string, any>,
  atlasRegions: SpineAtlasRegion[]
): CompiledSpineSkeleton {
  const rawBones: any[] = Array.isArray(rawSkeleton.bones) ? rawSkeleton.bones : [];
  const boneIndexByName = new Map<string, number>();
  const bones: BoneSetup[] = [];

  for (let i = 0; i < rawBones.length; i++) {
    const rb = rawBones[i] || {};
    const name = String(rb.name || `bone_${i}`);
    boneIndexByName.set(name, i);
    bones.push({
      name,
      parentIndex: rb.parent ? (boneIndexByName.get(String(rb.parent)) ?? -1) : -1,
      x: typeof rb.x === 'number' ? rb.x : 0,
      y: typeof rb.y === 'number' ? rb.y : 0,
      rotation: typeof rb.rotation === 'number' ? rb.rotation : 0,
      scaleX: typeof rb.scaleX === 'number' ? rb.scaleX : 1,
      scaleY: typeof rb.scaleY === 'number' ? rb.scaleY : 1,
      shearX: typeof rb.shearX === 'number' ? rb.shearX : 0,
      shearY: typeof rb.shearY === 'number' ? rb.shearY : 0,
    });
  }

  const rawSlots: any[] = Array.isArray(rawSkeleton.slots) ? rawSkeleton.slots : [];
  const slots: SlotSetup[] = rawSlots.map((rs: any, idx: number) => ({
    name: String(rs?.name || `slot_${idx}`),
    boneIndex: boneIndexByName.get(String(rs?.bone || '')) ?? 0,
    attachment: typeof rs?.attachment === 'string' ? rs.attachment : null,
    color: parseHexColor(rs?.color),
    blend: typeof rs?.blend === 'string' ? rs.blend : 'normal',
  }));

  const attachments = new Map<string, Map<string, RegionAttachment>>();
  const ingestSkinAttachments = (skinObj: Record<string, any> | undefined) => {
    if (!skinObj || typeof skinObj !== 'object') return;
    for (const [slotName, slotAtts] of Object.entries(skinObj)) {
      if (!slotAtts || typeof slotAtts !== 'object') continue;
      let slotMap = attachments.get(slotName);
      if (!slotMap) {
        slotMap = new Map();
        attachments.set(slotName, slotMap);
      }
      for (const [attName, rawAtt] of Object.entries(slotAtts as Record<string, any>)) {
        if (!rawAtt || typeof rawAtt !== 'object') continue;
        if (slotMap.has(attName)) continue;
        slotMap.set(attName, {
          name: attName,
          path: typeof rawAtt.path === 'string' ? rawAtt.path : typeof rawAtt.name === 'string' ? rawAtt.name : attName,
          x: typeof rawAtt.x === 'number' ? rawAtt.x : 0,
          y: typeof rawAtt.y === 'number' ? rawAtt.y : 0,
          rotation: typeof rawAtt.rotation === 'number' ? rawAtt.rotation : 0,
          scaleX: typeof rawAtt.scaleX === 'number' ? rawAtt.scaleX : 1,
          scaleY: typeof rawAtt.scaleY === 'number' ? rawAtt.scaleY : 1,
          width: typeof rawAtt.width === 'number' ? rawAtt.width : 0,
          height: typeof rawAtt.height === 'number' ? rawAtt.height : 0,
          color: parseHexColor(rawAtt.color),
        });
      }
    }
  };

  if (Array.isArray(rawSkeleton.skins)) {
    for (const skin of rawSkeleton.skins) {
      ingestSkinAttachments(skin?.attachments);
    }
  } else if (rawSkeleton.skins && typeof rawSkeleton.skins === 'object') {
    for (const skinObj of Object.values(rawSkeleton.skins as Record<string, any>)) {
      ingestSkinAttachments(skinObj);
    }
  }

  const regions = new Map<string, SpineAtlasRegion>();
  for (const r of atlasRegions) {
    regions.set(r.name, r);
  }

  const skelMeta = rawSkeleton.skeleton || {};
  const width = typeof skelMeta.width === 'number' && skelMeta.width > 1 ? skelMeta.width : 260;
  const height = typeof skelMeta.height === 'number' && skelMeta.height > 1 ? skelMeta.height : 260;
  const x = typeof skelMeta.x === 'number' ? skelMeta.x : -width / 2;
  const y = typeof skelMeta.y === 'number' ? skelMeta.y : 0;
  const fps = typeof skelMeta.fps === 'number' && skelMeta.fps > 0 ? skelMeta.fps : 30;

  return {
    bones,
    boneIndexByName,
    slots,
    attachments,
    regions,
    animations: (rawSkeleton.animations || {}) as Record<string, any>,
    bounds: { x, y, width, height },
    fps,
  };
}

export function getAnimationDuration(compiled: CompiledSpineSkeleton, animName: string): number {
  const anim = compiled.animations[animName];
  if (!anim) return 0;
  let maxTime = 0;

  const scanList = (list: any) => {
    if (!Array.isArray(list)) return;
    for (const kf of list) {
      if (typeof kf?.time === 'number' && kf.time > maxTime) maxTime = kf.time;
    }
  };

  for (const sData of Object.values((anim.slots || {}) as Record<string, any>)) {
    scanList(sData?.attachment);
    scanList(sData?.color);
  }
  for (const bData of Object.values((anim.bones || {}) as Record<string, any>)) {
    scanList(bData?.translate);
    scanList(bData?.rotate);
    scanList(bData?.scale);
    scanList(bData?.shear);
  }
  scanList(anim.events);

  return maxTime;
}

function findKeyframePair(frames: any[], time: number): [any, any, number] | null {
  if (!Array.isArray(frames) || frames.length === 0) return null;
  const firstT = typeof frames[0]?.time === 'number' ? frames[0].time : 0;
  if (time <= firstT || frames.length === 1) return [frames[0], frames[0], 0];

  const last = frames[frames.length - 1];
  const lastT = typeof last?.time === 'number' ? last.time : 0;
  if (time >= lastT) return [last, last, 0];

  let lo = 0;
  let hi = frames.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    const midT = typeof frames[mid]?.time === 'number' ? frames[mid].time : 0;
    if (midT <= time) lo = mid;
    else hi = mid;
  }

  const a = frames[lo];
  const b = frames[hi];
  if (a?.curve === 'stepped') return [a, b, 0];
  const ta = typeof a?.time === 'number' ? a.time : 0;
  const tb = typeof b?.time === 'number' ? b.time : ta;
  const span = tb - ta;
  const alpha = span > 0 ? Math.min(1, Math.max(0, (time - ta) / span)) : 0;
  return [a, b, alpha];
}

function sampleAngleDelta(a0: number, a1: number, alpha: number): number {
  let diff = a1 - a0;
  diff -= (16384 - Math.trunc(16384.499999999996 - diff / 360)) * 360;
  return a0 + diff * alpha;
}

export interface RenderSpineResult {
  drawnSlots: number;
  activeLabels: string[];
}

export function renderSpineAtTime(
  ctx: CanvasRenderingContext2D,
  compiled: CompiledSpineSkeleton,
  animName: string,
  time: number,
  loadedImages: Record<string, HTMLImageElement>,
  zoom: number
): RenderSpineResult {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);

  const anim = compiled.animations[animName] || null;
  const bonesAnim = (anim?.bones || {}) as Record<string, any>;
  const slotsAnim = (anim?.slots || {}) as Record<string, any>;

  // 1. Evaluate local bone transforms
  const localBones = compiled.bones.map((b) => {
    let x = b.x;
    let y = b.y;
    let rotation = b.rotation;
    let scaleX = b.scaleX;
    let scaleY = b.scaleY;
    let shearX = b.shearX;
    let shearY = b.shearY;

    const bAnim = bonesAnim[b.name];
    if (bAnim) {
      const tr = findKeyframePair(bAnim.translate, time);
      if (tr) {
        const [k0, k1, alpha] = tr;
        const x0 = typeof k0.x === 'number' ? k0.x : 0;
        const y0 = typeof k0.y === 'number' ? k0.y : 0;
        const x1 = typeof k1.x === 'number' ? k1.x : 0;
        const y1 = typeof k1.y === 'number' ? k1.y : 0;
        x += x0 + (x1 - x0) * alpha;
        y += y0 + (y1 - y0) * alpha;
      }

      const rot = findKeyframePair(bAnim.rotate, time);
      if (rot) {
        const [k0, k1, alpha] = rot;
        const a0 = typeof k0.angle === 'number' ? k0.angle : 0;
        const a1 = typeof k1.angle === 'number' ? k1.angle : 0;
        rotation += sampleAngleDelta(a0, a1, alpha);
      }

      const sc = findKeyframePair(bAnim.scale, time);
      if (sc) {
        const [k0, k1, alpha] = sc;
        const sx0 = typeof k0.x === 'number' ? k0.x : 1;
        const sy0 = typeof k0.y === 'number' ? k0.y : 1;
        const sx1 = typeof k1.x === 'number' ? k1.x : 1;
        const sy1 = typeof k1.y === 'number' ? k1.y : 1;
        scaleX *= sx0 + (sx1 - sx0) * alpha;
        scaleY *= sy0 + (sy1 - sy0) * alpha;
      }

      const sh = findKeyframePair(bAnim.shear, time);
      if (sh) {
        const [k0, k1, alpha] = sh;
        const hx0 = typeof k0.x === 'number' ? k0.x : 0;
        const hy0 = typeof k0.y === 'number' ? k0.y : 0;
        const hx1 = typeof k1.x === 'number' ? k1.x : 0;
        const hy1 = typeof k1.y === 'number' ? k1.y : 0;
        shearX += hx0 + (hx1 - hx0) * alpha;
        shearY += hy0 + (hy1 - hy0) * alpha;
      }
    }

    return { x, y, rotation, scaleX, scaleY, shearX, shearY };
  });

  // 2. Compute world bone matrices in Spine Y-up space
  const worldBones: WorldTransform[] = new Array(compiled.bones.length);
  const DEG = Math.PI / 180;

  for (let i = 0; i < compiled.bones.length; i++) {
    const setup = compiled.bones[i];
    const lb = localBones[i];
    const rotRad = (lb.rotation + lb.shearX) * DEG;
    const rotYRad = (lb.rotation + 90 + lb.shearY) * DEG;
    const la = Math.cos(rotRad) * lb.scaleX;
    const lbM = Math.cos(rotYRad) * lb.scaleY;
    const lc = Math.sin(rotRad) * lb.scaleX;
    const ld = Math.sin(rotYRad) * lb.scaleY;

    if (setup.parentIndex < 0) {
      worldBones[i] = { a: la, b: lbM, c: lc, d: ld, wx: lb.x, wy: lb.y };
    } else {
      const p = worldBones[setup.parentIndex];
      worldBones[i] = {
        a: p.a * la + p.b * lc,
        b: p.a * lbM + p.b * ld,
        c: p.c * la + p.d * lc,
        d: p.c * lbM + p.d * ld,
        wx: p.a * lb.x + p.b * lb.y + p.wx,
        wy: p.c * lb.x + p.d * lb.y + p.wy,
      };
    }
  }

  // 3. Collect visible drawable slots and compute dynamic bounding box
  interface DrawItem {
    slot: SlotSetup;
    bone: WorldTransform;
    att: RegionAttachment;
    region: SpineAtlasRegion;
    img: HTMLImageElement;
    alpha: number;
  }

  const drawItems: DrawItem[] = [];
  const activeLabels: string[] = [];

  for (const slot of compiled.slots) {
    const sAnim = slotsAnim[slot.name];
    let attName = slot.attachment;

    if (sAnim && Array.isArray(sAnim.attachment) && sAnim.attachment.length > 0) {
      // Attachment timelines are stepped; before first keyframe, setup pose applies
      const firstT = typeof sAnim.attachment[0]?.time === 'number' ? sAnim.attachment[0].time : 0;
      if (time >= firstT) {
        let chosen = sAnim.attachment[0];
        for (let i = 1; i < sAnim.attachment.length; i++) {
          const kfT = typeof sAnim.attachment[i]?.time === 'number' ? sAnim.attachment[i].time : 0;
          if (kfT <= time) chosen = sAnim.attachment[i];
          else break;
        }
        attName = typeof chosen?.name === 'string' ? chosen.name : null;
      }
    }

    if (!attName) continue;

    let alpha = slot.color[3];
    if (sAnim && Array.isArray(sAnim.color) && sAnim.color.length > 0) {
      const colPair = findKeyframePair(sAnim.color, time);
      if (colPair) {
        const [k0, k1, tAlpha] = colPair;
        const c0 = parseHexColor(k0?.color);
        const c1 = parseHexColor(k1?.color);
        alpha = c0[3] + (c1[3] - c0[3]) * tAlpha;
      }
    }
    if (alpha <= 0.004) continue;

    const slotMap = compiled.attachments.get(slot.name);
    const att = slotMap?.get(attName);
    const region =
      (att && (compiled.regions.get(att.path) || compiled.regions.get(att.name))) ||
      compiled.regions.get(attName);
    if (!region) continue;

    const img = loadedImages[region.page];
    if (!img) continue;

    const bone = worldBones[slot.boneIndex] || { a: 1, b: 0, c: 0, d: 1, wx: 0, wy: 0 };
    const effectiveAtt: RegionAttachment = att || {
      name: attName,
      path: region.name,
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      width: region.origWidth || region.width,
      height: region.origHeight || region.height,
      color: [1, 1, 1, 1],
    };

    drawItems.push({
      slot,
      bone,
      att: effectiveAtt,
      region,
      img,
      alpha: Math.min(1, Math.max(0, alpha * effectiveAtt.color[3])),
    });
    activeLabels.push(`${slot.name}:${attName}`);
  }

  if (drawItems.length === 0) {
    return { drawnSlots: 0, activeLabels };
  }

  // Fit skeleton bounds neatly inside canvas (use skeleton setup bounds + slight padding)
  const bnd = compiled.bounds;
  const refW = Math.max(120, bnd.width);
  const refH = Math.max(120, bnd.height);
  const centerX = bnd.x + bnd.width / 2;
  const centerY = bnd.y + bnd.height / 2;

  const fitScale = Math.min((W * 0.72) / refW, (H * 0.74) / refH, 2.4);
  const finalScale = fitScale * zoom;

  ctx.save();
  // Map Spine (centerX, centerY) with Y-up to Canvas (W/2, H/2) with Y-down
  ctx.translate(W / 2, H / 2);
  ctx.scale(finalScale, -finalScale);
  ctx.translate(-centerX, -centerY);

  for (const item of drawItems) {
    const { bone, att, region, img, alpha, slot } = item;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (slot.blend === 'additive') {
      ctx.globalCompositeOperation = 'lighter';
    }

    // Apply bone world transform: [a, c, b, d, wx, wy]
    ctx.transform(bone.a, bone.c, bone.b, bone.d, bone.wx, bone.wy);

    // Apply attachment local transform
    ctx.translate(att.x, att.y);
    if (att.rotation !== 0) {
      ctx.rotate(att.rotation * DEG);
    }
    if (att.scaleX !== 1 || att.scaleY !== 1) {
      ctx.scale(att.scaleX, att.scaleY);
    }

    // Account for atlas whitespace trimming (origWidth/origHeight + offsetX/offsetY)
    const origW = region.origWidth || region.width;
    const origH = region.origHeight || region.height;
    const targetW = att.width || origW;
    const targetH = att.height || origH;

    const sxScale = origW > 0 ? targetW / origW : 1;
    const syScale = origH > 0 ? targetH / origH : 1;

    // Region center relative to untrimmed original center in Spine Y-up coordinates
    const trimCenterX = (region.offsetX + region.width / 2 - origW / 2) * sxScale;
    const trimCenterY = (region.offsetY + region.height / 2 - origH / 2) * syScale;

    ctx.translate(trimCenterX, trimCenterY);
    // Flip Y back to image-down for canvas drawImage
    ctx.scale(1, -1);

    const drawW = region.width * sxScale;
    const drawH = region.height * syScale;

    if (region.rotate) {
      // Spine atlas `rotate: true` stores the region rotated 90° CCW in texture space
      // (srcW = region.height, srcH = region.width); rotating +90° CW restores it upright.
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(
        img,
        region.x,
        region.y,
        region.height,
        region.width,
        -drawH / 2,
        -drawW / 2,
        drawH,
        drawW
      );
    } else {
      ctx.drawImage(
        img,
        region.x,
        region.y,
        region.width,
        region.height,
        -drawW / 2,
        -drawH / 2,
        drawW,
        drawH
      );
    }

    ctx.restore();
  }

  ctx.restore();
  return { drawnSlots: drawItems.length, activeLabels };
}
