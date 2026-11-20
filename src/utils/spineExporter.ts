import { strToU8, Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { slugify, triggerBlobDownload } from '../services/clientZipper';
import {
  type CompiledSpineSkeleton,
  getAnimationDuration,
  renderSpineAtTime,
} from './spineRenderer';

export interface FrameExportProgress {
  completed: number;
  total: number;
  stage: string;
}

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Falha ao codificar frame PNG.'));
          return;
        }
        blob
          .arrayBuffer()
          .then((buf) => resolve(new Uint8Array(buf)))
          .catch(reject);
      },
      'image/png'
    );
  });
}

export async function exportSpineAnimationFramesZip(opts: {
  bundleName: string;
  animName: string;
  compiled: CompiledSpineSkeleton;
  loadedImages: Record<string, HTMLImageElement>;
  zoom?: number;
  fps?: number;
  frameSize?: number;
  onProgress?: (p: FrameExportProgress) => void;
}): Promise<{ frameCount: number }> {
  const {
    bundleName,
    animName,
    compiled,
    loadedImages,
    zoom = 1,
    fps = 24,
    frameSize = 480,
    onProgress,
  } = opts;

  const duration = getAnimationDuration(compiled, animName);
  const rawCount = duration > 0 ? Math.max(1, Math.round(duration * fps)) : 1;
  // Cap at 96 frames so sprite sheet & ZIP stay safe on mobile phone RAM
  const frameCount = Math.min(96, rawCount);

  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = frameSize;
  frameCanvas.height = frameSize;
  const fCtx = frameCanvas.getContext('2d');
  if (!fCtx) throw new Error('Contexto 2D indisponível neste navegador.');

  // Prepare grid sprite sheet canvas
  const cols = Math.min(8, frameCount);
  const rows = Math.ceil(frameCount / cols);
  const sheetCanvas = document.createElement('canvas');
  sheetCanvas.width = cols * frameSize;
  sheetCanvas.height = rows * frameSize;
  const sCtx = sheetCanvas.getContext('2d');

  const safeBundle = slugify(bundleName);
  const safeAnim = slugify(animName || 'pose');
  const root = `${safeBundle}_${safeAnim}_frames`;

  const chunks: BlobPart[] = [];
  const zip = new Zip((err, data) => {
    if (err) throw err;
    if (data && data.length > 0) chunks.push(new Uint8Array(data));
  });

  const frameManifest: Array<{
    index: number;
    file: string;
    time: number;
    sheetX: number;
    sheetY: number;
    width: number;
    height: number;
  }> = [];

  for (let i = 0; i < frameCount; i++) {
    const t = frameCount > 1 ? (i / frameCount) * duration : 0;
    renderSpineAtTime(fCtx, compiled, animName, t, loadedImages, zoom);

    const col = i % cols;
    const row = Math.floor(i / cols);
    if (sCtx) {
      sCtx.drawImage(frameCanvas, col * frameSize, row * frameSize);
    }

    const pngBytes = await canvasToPngBytes(frameCanvas);
    const filename = `frame_${String(i + 1).padStart(3, '0')}.png`;
    const entry = new ZipPassThrough(`${root}/frames/${filename}`);
    zip.add(entry);
    entry.push(pngBytes, true);

    frameManifest.push({
      index: i + 1,
      file: `frames/${filename}`,
      time: Number(t.toFixed(4)),
      sheetX: col * frameSize,
      sheetY: row * frameSize,
      width: frameSize,
      height: frameSize,
    });

    onProgress?.({
      completed: i + 1,
      total: frameCount + 1,
      stage: `Renderizando frame ${i + 1}/${frameCount}...`,
    });
  }

  // Export combined grid Sprite Sheet PNG
  if (sCtx && sheetCanvas.width <= 8192 && sheetCanvas.height <= 8192) {
    onProgress?.({
      completed: frameCount,
      total: frameCount + 1,
      stage: 'Gerando Sprite Sheet PNG...',
    });
    const sheetBytes = await canvasToPngBytes(sheetCanvas);
    const sheetEntry = new ZipPassThrough(`${root}/spritesheet_${safeAnim}.png`);
    zip.add(sheetEntry);
    sheetEntry.push(sheetBytes, true);
  }

  // Metadata JSON
  const metaJson = JSON.stringify(
    {
      bundle: bundleName,
      animation: animName,
      durationSeconds: Number(duration.toFixed(3)),
      fps: frameCount > 1 && duration > 0 ? Number((frameCount / duration).toFixed(2)) : fps,
      frameWidth: frameSize,
      frameHeight: frameSize,
      sheetCols: cols,
      sheetRows: rows,
      frames: frameManifest,
    },
    null,
    2
  );
  const metaEntry = new ZipDeflate(`${root}/metadata.json`, { level: 5 });
  zip.add(metaEntry);
  metaEntry.push(strToU8(metaJson), true);

  zip.end();

  onProgress?.({
    completed: frameCount + 1,
    total: frameCount + 1,
    stage: 'Concluído!',
  });

  const blob = new Blob(chunks, { type: 'application/zip' });
  triggerBlobDownload(blob, `${root}.zip`);
  return { frameCount };
}

export async function exportAnim2DFramesZip(opts: {
  bundleName: string;
  frames: Array<{
    label: string;
    x: number;
    y: number;
    w: number;
    h: number;
    rotate: boolean;
  }>;
  image: HTMLImageElement;
  onProgress?: (p: FrameExportProgress) => void;
}): Promise<{ frameCount: number }> {
  const { bundleName, frames, image, onProgress } = opts;
  const safeBundle = slugify(bundleName);
  const root = `${safeBundle}_frames_2d`;

  const chunks: BlobPart[] = [];
  const zip = new Zip((err, data) => {
    if (err) throw err;
    if (data && data.length > 0) chunks.push(new Uint8Array(data));
  });

  const maxFrames = Math.min(120, frames.length);
  for (let i = 0; i < maxFrames; i++) {
    const f = frames[i];
    const c = document.createElement('canvas');
    c.width = Math.max(1, f.w);
    c.height = Math.max(1, f.h);
    const ctx = c.getContext('2d');
    if (ctx) {
      if (f.rotate) {
        ctx.translate(c.width / 2, c.height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.drawImage(image, f.x, f.y, f.h, f.w, -f.h / 2, -f.w / 2, f.h, f.w);
      } else {
        ctx.drawImage(image, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
      }
    }
    const pngBytes = await canvasToPngBytes(c);
    const filename = `frame_${String(i + 1).padStart(3, '0')}_${slugify(f.label)}.png`;
    const entry = new ZipPassThrough(`${root}/frames/${filename}`);
    zip.add(entry);
    entry.push(pngBytes, true);

    onProgress?.({
      completed: i + 1,
      total: maxFrames,
      stage: `Extraindo frame ${i + 1}/${maxFrames}...`,
    });
  }

  zip.end();
  const blob = new Blob(chunks, { type: 'application/zip' });
  triggerBlobDownload(blob, `${root}.zip`);
  return { frameCount: maxFrames };
}
