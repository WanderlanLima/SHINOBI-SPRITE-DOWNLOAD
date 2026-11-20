import { strToU8, Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import type { AssetFileRef, ZipExportRequest } from '../types';
import { buildCsvDatabase, type FullCatalog } from './catalogEngine';

export interface PlannedZipEntry {
  sourceUrl: string;
  zipPath: string;
  bytes: number;
}

export interface VirtualTextFile {
  zipPath: string;
  content: string;
}

export interface ZipProgress {
  completed: number;
  total: number;
  bytesDownloaded: number;
  totalBytes: number;
  currentFile: string;
}

export interface MobileCatalogPart {
  id: string;
  categoryKey:
    | 'database'
    | 'ninjas'
    | 'summons'
    | 'spines'
    | 'effects'
    | 'audio'
    | 'extras';
  categoryTitle: string;
  title: string;
  filename: string;
  folderHint: string;
  fileCount: number;
  totalBytes: number;
  entries: PlannedZipEntry[];
  virtualFiles: VirtualTextFile[];
}

export function slugify(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || 'item'
  );
}

function filterImages(
  files: AssetFileRef[],
  imageFormat: ZipExportRequest['imageFormat']
): AssetFileRef[] {
  if (imageFormat === 'both') return files;
  const nonImages = files.filter((f) => f.ext !== 'webp' && f.ext !== 'png');
  const images = files.filter((f) => f.ext === 'webp' || f.ext === 'png');

  const grouped = new Map<string, AssetFileRef[]>();
  for (const img of images) {
    const stem = img.name.replace(/\.(webp|png)$/i, '');
    const list = grouped.get(stem) || [];
    list.push(img);
    grouped.set(stem, list);
  }

  const kept: AssetFileRef[] = [...nonImages];
  for (const group of grouped.values()) {
    const preferred = group.find((f) => f.ext === imageFormat);
    kept.push(preferred || group[0]);
  }
  return kept;
}

export function buildDatabaseVirtualFiles(catalog: FullCatalog, root: string): VirtualTextFile[] {
  const { ninjasCsv, techniquesCsv } = buildCsvDatabase(catalog);
  const dbPayload = {
    origem: catalog.summary.sourceUrl,
    cdn: catalog.summary.cdnBase,
    build: catalog.summary.build,
    manifestoVersao: catalog.summary.manifestVersion,
    exportadoEm: new Date().toISOString(),
    resumo: catalog.summary.counts,
    ninjas: catalog.ninjas.map((n) => ({
      id: n.id,
      nome: n.name,
      funcao: n.role,
      crescimento: n.growvalue,
      taxaNivel: n.leveluprate,
      descricao: n.desc,
      spineHD: n.hasHdSpine,
      qtdRetratos: n.portraits.length,
      qtdAudios: n.audioFiles.length,
      habilidades: n.skills,
    })),
    invocacoes: catalog.summons.map((s) => ({
      id: s.id,
      codigo: s.rawCode,
      nome: s.name,
      arquivos: s.spine.allFiles.map((f) => f.url),
    })),
    itens: catalog.items,
  };

  return [
    {
      zipPath: `${root}/00_banco_de_dados/database_completo.json`,
      content: JSON.stringify(dbPayload, null, 2),
    },
    {
      zipPath: `${root}/00_banco_de_dados/ninjas_atributos.csv`,
      content: '\uFEFF' + ninjasCsv,
    },
    {
      zipPath: `${root}/00_banco_de_dados/tecnicas_habilidades.csv`,
      content: '\uFEFF' + techniquesCsv,
    },
    {
      zipPath: `${root}/00_banco_de_dados/sons_dublagens_indice.json`,
      content: JSON.stringify(
        catalog.audio.map((a) => ({
          id: a.id,
          categoria: a.category,
          ninjaId: a.heroId,
          ninjaNome: a.heroName,
          arquivo: a.filename,
          url: `${catalog.summary.cdnBase}${a.url}`,
          bytes: a.bytes,
        })),
        null,
        2
      ),
    },
    {
      zipPath: `${root}/00_banco_de_dados/README_ESTRUTURA.txt`,
      content: [
        'SHINOBI VAULT — EXPORTAÇÃO ORGANIZADA DE NARUTO JOTAGAME',
        `Origem: ${catalog.summary.sourceUrl}`,
        `Build: ${catalog.summary.build} | Manifesto: ${catalog.summary.manifestVersion}`,
        `Gerado em: ${new Date().toISOString()}`,
        '',
        'DICA PARA CELULAR (PARTES MÚLTIPLAS):',
        'Todas as partes usam a mesma pasta raiz. Extraia todas no mesmo diretório',
        '(usando ZArchiver no Android ou o app Arquivos no iOS) para unir todo o acervo:',
        '',
        '00_banco_de_dados/      -> JSON completo, planilhas CSV e índices',
        '01_ninjas/              -> Pastas individuais por ninja (retratos, Spine HD/batalha, áudios, ficha JSON)',
        '02_invocacoes/          -> 50 invocações Spine 3.8 + fragmentos',
        '03_animacoes_sprites/   -> Modelos Spine 3.8 separados por tipo',
        '04_habilidades_efeitos/ -> Efeitos Spine, spritesheets 2D, vídeos MP4 de esotéricas e ícones',
        '05_sons_e_dublagens/    -> Áudios MP3 separados por dublagens, esotéricas, derrota e combate',
      ].join('\n'),
    },
  ];
}

export function planCustomZip(catalog: FullCatalog, req: ZipExportRequest) {
  const root = slugify(req.archiveName || 'naruto_jotagame_acervo');
  const entries: PlannedZipEntry[] = [];
  const seen = new Set<string>();
  const virtualFiles: VirtualTextFile[] = [];

  const addFile = (sourceUrl: string, relZipPath: string, bytes: number) => {
    const full = `${root}/${relZipPath}`;
    if (seen.has(full)) return;
    seen.add(full);
    entries.push({ sourceUrl, zipPath: full, bytes });
  };

  const addVirtual = (relZipPath: string, content: string) => {
    const full = `${root}/${relZipPath}`;
    if (seen.has(full)) return;
    seen.add(full);
    virtualFiles.push({ zipPath: full, content });
  };

  let ninjaIds = req.ninjaIds || [];
  let summonIds = req.summonIds || [];
  let spineIds = req.spineIds || [];
  let anim2dIds = req.anim2dIds || [];
  let audioIds = req.audioIds || [];
  let videoIds = req.videoIds || [];

  if (req.preset === 'summons_pack') {
    summonIds = catalog.summons.map((s) => s.id);
  } else if (req.preset === 'dubs_pack') {
    audioIds = catalog.audio
      .filter(
        (a) =>
          a.category === 'dublagem_falas' ||
          a.category === 'dublagem_esoterica' ||
          a.category === 'dublagem_derrota'
      )
      .map((a) => a.id);
  } else if (req.preset === 'featured_ninjas') {
    ninjaIds = catalog.ninjas.filter((n) => n.hasOfficialName).slice(0, 15).map((n) => n.id);
  } else if (req.preset === 'effects_pack') {
    spineIds = catalog.spineModels.filter((s) => s.kind === 'efeito').slice(0, 25).map((s) => s.id);
    anim2dIds = catalog.anim2d.slice(0, 25).map((a) => a.id);
  }

  if (req.includeDatabase !== false) {
    for (const vf of buildDatabaseVirtualFiles(catalog, root)) {
      if (!seen.has(vf.zipPath)) {
        seen.add(vf.zipPath);
        virtualFiles.push(vf);
      }
    }
  }

  const incPortraits = req.includeNinjaPortraits !== false;
  const incSpine = req.includeNinjaSpine !== false;
  const incAudio = req.includeNinjaAudio !== false;

  for (const id of ninjaIds) {
    const ninja = catalog.ninjaMap.get(id);
    if (!ninja) continue;
    const folder = `01_ninjas/${ninja.id}_${slugify(ninja.name)}`;
    addVirtual(
      `${folder}/ficha_ninja.json`,
      JSON.stringify(
        {
          id: ninja.id,
          nome: ninja.name,
          funcao: ninja.role,
          crescimento: ninja.growvalue,
          taxaNivel: ninja.leveluprate,
          descricao: ninja.desc,
          tecnicas: ninja.skills,
        },
        null,
        2
      )
    );

    if (incPortraits) {
      for (const f of filterImages(ninja.portraits, req.imageFormat)) {
        addFile(f.url, `${folder}/retratos/${f.name}`, f.bytes);
      }
      for (const f of filterImages(ninja.bannersPt, req.imageFormat)) {
        addFile(f.url, `${folder}/banners_pt/${f.name}`, f.bytes);
      }
    }

    if (incSpine) {
      for (const sp of ninja.spineBundles) {
        const sub = sp.kind === 'hd' ? 'spine_hd' : 'spine_batalha';
        for (const f of filterImages(sp.allFiles, req.imageFormat)) {
          addFile(f.url, `${folder}/${sub}/${sp.name}/${f.name}`, f.bytes);
        }
      }
    }

    if (incAudio) {
      for (const a of ninja.audioFiles) {
        addFile(a.url, `${folder}/audio/${a.category}/${a.filename}`, a.bytes);
      }
    }
  }

  for (const id of summonIds) {
    const summon = catalog.summonMap.get(id);
    if (!summon) continue;
    const folder = `02_invocacoes/${slugify(summon.name)}_${slugify(summon.rawCode)}`;
    for (const f of filterImages(summon.spine.allFiles, req.imageFormat)) {
      addFile(f.url, `${folder}/${f.name}`, f.bytes);
    }
  }
  if (req.preset === 'summons_pack') {
    for (const frag of catalog.summonFragments) {
      addFile(frag.url, `02_invocacoes/fragmentos/${frag.name}`, frag.bytes);
    }
  }

  for (const id of spineIds) {
    const sp = catalog.spineMap.get(id);
    if (!sp) continue;
    const baseFolder =
      sp.kind === 'efeito'
        ? `04_habilidades_efeitos/spine_efeitos/${slugify(sp.name)}`
        : sp.kind === 'invocacao'
        ? `02_invocacoes/${slugify(sp.name)}`
        : `03_animacoes_sprites/${sp.kind}/${slugify(sp.name)}`;
    for (const f of filterImages(sp.allFiles, req.imageFormat)) {
      addFile(f.url, `${baseFolder}/${f.name}`, f.bytes);
    }
  }

  for (const id of anim2dIds) {
    const a2d = catalog.anim2dMap.get(id);
    if (!a2d) continue;
    const folder = `04_habilidades_efeitos/spritesheets_2d/${slugify(a2d.name)}`;
    for (const f of filterImages(a2d.allFiles, req.imageFormat)) {
      addFile(f.url, `${folder}/${f.name}`, f.bytes);
    }
  }

  for (const id of videoIds) {
    const vid = catalog.videoMap.get(id);
    if (!vid) continue;
    addFile(vid.url, `04_habilidades_efeitos/videos_esotericas/${vid.filename}`, vid.bytes);
  }

  for (const id of audioIds) {
    const aud = catalog.audioMap.get(id);
    if (!aud) continue;
    addFile(aud.url, `05_sons_e_dublagens/${aud.category}/${aud.filename}`, aud.bytes);
  }

  const folderTree: Record<string, number> = {};
  for (const v of virtualFiles) {
    const top = v.zipPath.split('/')[1] || 'raiz';
    folderTree[top] = (folderTree[top] || 0) + 1;
  }
  for (const e of entries) {
    const top = e.zipPath.split('/')[1] || 'raiz';
    folderTree[top] = (folderTree[top] || 0) + 1;
  }

  const totalBytes =
    entries.reduce((s, e) => s + e.bytes, 0) +
    virtualFiles.reduce((s, v) => s + v.content.length, 0);

  return {
    root,
    entries,
    virtualFiles,
    fileCount: entries.length + virtualFiles.length,
    totalBytes,
    folderTree,
    samplePaths: [
      ...virtualFiles.slice(0, 6).map((v) => v.zipPath),
      ...entries.slice(0, 24).map((e) => e.zipPath),
    ],
  };
}

/**
 * Divide TODO o conteúdo do jogo em partes organizadas e seguras para download direto no celular.
 * Cada parte respeita o teto de MB escolhido (ex.: 90 MB) para não estourar a RAM do navegador mobile,
 * e todas compartilham a mesma pasta raiz para mesclagem perfeita ao descompactar.
 */
export function buildFullCatalogMobileParts(
  catalog: FullCatalog,
  imageFormat: ZipExportRequest['imageFormat'],
  maxPartMB = 90
): MobileCatalogPart[] {
  const root = 'naruto_jotagame_acervo';
  const maxBytes = maxPartMB * 1024 * 1024;
  const maxFilesPerPart = 900;
  const parts: MobileCatalogPart[] = [];

  // Helper to chunk grouped units (e.g. a ninja folder stays together inside one ZIP part!)
  type Unit = { entries: PlannedZipEntry[]; virtualFiles: VirtualTextFile[]; bytes: number };
  const chunkUnits = (
    categoryKey: MobileCatalogPart['categoryKey'],
    categoryTitle: string,
    prefix: string,
    folderHint: string,
    units: Unit[]
  ) => {
    const chunks: Unit[][] = [];
    let current: Unit[] = [];
    let curBytes = 0;
    let curFiles = 0;

    for (const u of units) {
      const uFiles = u.entries.length + u.virtualFiles.length;
      if (uFiles === 0) continue;
      if (
        current.length > 0 &&
        (curBytes + u.bytes > maxBytes || curFiles + uFiles > maxFilesPerPart)
      ) {
        chunks.push(current);
        current = [];
        curBytes = 0;
        curFiles = 0;
      }
      current.push(u);
      curBytes += u.bytes;
      curFiles += uFiles;
    }
    if (current.length > 0) chunks.push(current);

    chunks.forEach((group, idx) => {
      const entries = group.flatMap((u) => u.entries);
      const virtualFiles = group.flatMap((u) => u.virtualFiles);
      const totalBytes = group.reduce((s, u) => s + u.bytes, 0);
      const partNum = String(idx + 1).padStart(2, '0');
      const totalParts = String(chunks.length).padStart(2, '0');
      const suffix = chunks.length > 1 ? ` — Parte ${partNum}/${totalParts}` : ' (Completo)';
      parts.push({
        id: `${prefix}_p${partNum}_${imageFormat}_${maxPartMB}`,
        categoryKey,
        categoryTitle,
        title: `${categoryTitle}${suffix}`,
        filename:
          chunks.length > 1
            ? `${prefix}_parte_${partNum}_de_${totalParts}.zip`
            : `${prefix}_completo.zip`,
        folderHint,
        fileCount: entries.length + virtualFiles.length,
        totalBytes,
        entries,
        virtualFiles,
      });
    });
  };

  // 0. Banco de Dados Completo
  const dbVirtual = buildDatabaseVirtualFiles(catalog, root);
  const dbBytes = dbVirtual.reduce((s, v) => s + v.content.length, 0);
  parts.push({
    id: `00_banco_de_dados`,
    categoryKey: 'database',
    categoryTitle: '00. Banco de Dados',
    title: 'Banco de Dados Completo (JSON + CSV + Índices)',
    filename: '00_banco_de_dados_completo.zip',
    folderHint: '00_banco_de_dados/',
    fileCount: dbVirtual.length,
    totalBytes: dbBytes,
    entries: [],
    virtualFiles: dbVirtual,
  });

  // 1. Todos os 894 Ninjas
  const ninjaUnits: Unit[] = catalog.ninjas.map((ninja) => {
    const folder = `${root}/01_ninjas/${ninja.id}_${slugify(ninja.name)}`;
    const entries: PlannedZipEntry[] = [];
    const seen = new Set<string>();
    const pushF = (f: AssetFileRef, sub: string) => {
      const zp = `${folder}/${sub}/${f.name}`;
      if (seen.has(zp)) return;
      seen.add(zp);
      entries.push({ sourceUrl: f.url, zipPath: zp, bytes: f.bytes });
    };
    for (const f of filterImages(ninja.portraits, imageFormat)) pushF(f, 'retratos');
    for (const f of filterImages(ninja.bannersPt, imageFormat)) pushF(f, 'banners_pt');
    for (const sp of ninja.spineBundles) {
      const sub = sp.kind === 'hd' ? `spine_hd/${sp.name}` : `spine_batalha/${sp.name}`;
      for (const f of filterImages(sp.allFiles, imageFormat)) pushF(f, sub);
    }
    for (const a of ninja.audioFiles) {
      const zp = `${folder}/audio/${a.category}/${a.filename}`;
      if (!seen.has(zp)) {
        seen.add(zp);
        entries.push({ sourceUrl: a.url, zipPath: zp, bytes: a.bytes });
      }
    }
    const ficha = JSON.stringify(
      {
        id: ninja.id,
        nome: ninja.name,
        funcao: ninja.role,
        crescimento: ninja.growvalue,
        taxaNivel: ninja.leveluprate,
        descricao: ninja.desc,
        tecnicas: ninja.skills,
      },
      null,
      2
    );
    const virtualFiles = [{ zipPath: `${folder}/ficha_ninja.json`, content: ficha }];
    const bytes = entries.reduce((s, e) => s + e.bytes, 0) + ficha.length;
    return { entries, virtualFiles, bytes };
  });
  chunkUnits('ninjas', '01. Todos os Ninjas (894)', '01_ninjas', '01_ninjas/<id>_<nome>/', ninjaUnits);

  // 2. Todas as 50 Invocações + Fragmentos
  const summonUnits: Unit[] = catalog.summons.map((s) => {
    const folder = `${root}/02_invocacoes/${slugify(s.name)}_${slugify(s.rawCode)}`;
    const files = filterImages(s.spine.allFiles, imageFormat);
    const entries = files.map((f) => ({
      sourceUrl: f.url,
      zipPath: `${folder}/${f.name}`,
      bytes: f.bytes,
    }));
    return { entries, virtualFiles: [], bytes: entries.reduce((acc, e) => acc + e.bytes, 0) };
  });
  if (catalog.summonFragments.length > 0) {
    const fragEntries = catalog.summonFragments.map((f) => ({
      sourceUrl: f.url,
      zipPath: `${root}/02_invocacoes/fragmentos/${f.name}`,
      bytes: f.bytes,
    }));
    summonUnits.push({
      entries: fragEntries,
      virtualFiles: [],
      bytes: fragEntries.reduce((acc, e) => acc + e.bytes, 0),
    });
  }
  chunkUnits('summons', '02. Todas as Invocações (50)', '02_invocacoes', '02_invocacoes/', summonUnits);

  // 3. Todas as Animações Spine (excluindo efeitos que vão para pasta 04)
  const spineUnits: Unit[] = catalog.spineModels
    .filter((s) => s.kind !== 'efeito')
    .map((sp) => {
      const folder = `${root}/03_animacoes_sprites/${sp.kind}/${slugify(sp.name)}`;
      const files = filterImages(sp.allFiles, imageFormat);
      const entries = files.map((f) => ({
        sourceUrl: f.url,
        zipPath: `${folder}/${f.name}`,
        bytes: f.bytes,
      }));
      return { entries, virtualFiles: [], bytes: entries.reduce((acc, e) => acc + e.bytes, 0) };
    });
  chunkUnits('spines', '03. Animações Spine 3.8', '03_animacoes_spine', '03_animacoes_sprites/', spineUnits);

  // 4. Habilidades, Efeitos Spine, Spritesheets 2D, Vídeos MP4 e Ícones
  const effectUnits: Unit[] = [];
  for (const sp of catalog.spineModels.filter((s) => s.kind === 'efeito')) {
    const folder = `${root}/04_habilidades_efeitos/spine_efeitos/${slugify(sp.name)}`;
    const files = filterImages(sp.allFiles, imageFormat);
    const entries = files.map((f) => ({
      sourceUrl: f.url,
      zipPath: `${folder}/${f.name}`,
      bytes: f.bytes,
    }));
    effectUnits.push({ entries, virtualFiles: [], bytes: entries.reduce((a, b) => a + b.bytes, 0) });
  }
  for (const a2d of catalog.anim2d) {
    const folder = `${root}/04_habilidades_efeitos/spritesheets_2d/${slugify(a2d.name)}`;
    const files = filterImages(a2d.allFiles, imageFormat);
    const entries = files.map((f) => ({
      sourceUrl: f.url,
      zipPath: `${folder}/${f.name}`,
      bytes: f.bytes,
    }));
    effectUnits.push({ entries, virtualFiles: [], bytes: entries.reduce((a, b) => a + b.bytes, 0) });
  }
  for (const vid of catalog.videos) {
    effectUnits.push({
      entries: [
        {
          sourceUrl: vid.url,
          zipPath: `${root}/04_habilidades_efeitos/videos_esotericas/${vid.filename}`,
          bytes: vid.bytes,
        },
      ],
      virtualFiles: [],
      bytes: vid.bytes,
    });
  }
  // Batch skill icons in chunks of 100
  for (let i = 0; i < catalog.skillIcons.length; i += 100) {
    const slice = catalog.skillIcons.slice(i, i + 100);
    const entries = slice.map((f) => ({
      sourceUrl: f.url,
      zipPath: `${root}/04_habilidades_efeitos/icones_habilidades/${f.name}`,
      bytes: f.bytes,
    }));
    effectUnits.push({ entries, virtualFiles: [], bytes: entries.reduce((a, b) => a + b.bytes, 0) });
  }
  chunkUnits(
    'effects',
    '04. Habilidades, Efeitos, Vídeos e Ícones',
    '04_habilidades_efeitos',
    '04_habilidades_efeitos/',
    effectUnits
  );

  // 5. Todos os Sons e Dublagens MP3
  const audioUnits: Unit[] = [];
  for (let i = 0; i < catalog.audio.length; i += 40) {
    const slice = catalog.audio.slice(i, i + 40);
    const entries = slice.map((a) => ({
      sourceUrl: a.url,
      zipPath: `${root}/05_sons_e_dublagens/${a.category}/${a.filename}`,
      bytes: a.bytes,
    }));
    audioUnits.push({ entries, virtualFiles: [], bytes: entries.reduce((s, e) => s + e.bytes, 0) });
  }
  chunkUnits(
    'audio',
    '05. Todos os Sons e Dublagens (MP3)',
    '05_sons_dublagens',
    '05_sons_e_dublagens/',
    audioUnits
  );

  return parts;
}

const ALREADY_COMPRESSED_EXT = /\.(webp|png|jpg|jpeg|mp3|ogg|mp4|webm|zip)$/i;

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 15000);
}

/**
 * Cria um arquivo ZIP organizado 100% no navegador (funciona no GitHub Pages e direto no celular)
 * usando fflate em modo streaming com concorrência controlada para economizar memória RAM.
 */
export async function generateAndDownloadClientZip(opts: {
  cdnBase: string;
  filename: string;
  entries: PlannedZipEntry[];
  virtualFiles: VirtualTextFile[];
  onProgress?: (progress: ZipProgress) => void;
  signal?: AbortSignal;
}): Promise<{ downloaded: number; failed: number }> {
  const { cdnBase, filename, entries, virtualFiles, onProgress, signal } = opts;
  const chunks: BlobPart[] = [];

  const zip = new Zip((err, data, final) => {
    if (err) throw err;
    if (data && data.length > 0) {
      chunks.push(new Uint8Array(data));
    }
    void final;
  });

  const totalCount = entries.length + virtualFiles.length;
  const totalBytes =
    entries.reduce((s, e) => s + e.bytes, 0) +
    virtualFiles.reduce((s, v) => s + v.content.length, 0);

  let completed = 0;
  let bytesDownloaded = 0;
  let failed = 0;

  // 1. Append text / JSON / CSV files with deflate compression
  for (const vf of virtualFiles) {
    if (signal?.aborted) throw new DOMException('Download cancelado pelo usuário.', 'AbortError');
    const stream = new ZipDeflate(vf.zipPath, { level: 5 });
    zip.add(stream);
    const encoded = strToU8(vf.content);
    stream.push(encoded, true);
    completed++;
    bytesDownloaded += encoded.byteLength;
    onProgress?.({
      completed,
      total: totalCount,
      bytesDownloaded,
      totalBytes,
      currentFile: vf.zipPath.split('/').pop() || vf.zipPath,
    });
  }

  // 2. Fetch binary assets with mobile-friendly concurrency (6 workers)
  const CONCURRENCY = 6;
  let cursor = 0;

  const worker = async () => {
    while (cursor < entries.length) {
      if (signal?.aborted) return;
      const idx = cursor++;
      const item = entries[idx];
      try {
        const res = await fetch(`${cdnBase}${item.sourceUrl}`, { signal });
        if (!res.ok) {
          failed++;
        } else {
          const buf = new Uint8Array(await res.arrayBuffer());
          // Use STORE (zero compression CPU overhead) for already-compressed media files
          const stream = ALREADY_COMPRESSED_EXT.test(item.zipPath)
            ? new ZipPassThrough(item.zipPath)
            : new ZipDeflate(item.zipPath, { level: 5 });
          zip.add(stream);
          stream.push(buf, true);
          bytesDownloaded += buf.byteLength;
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        failed++;
      } finally {
        completed++;
        onProgress?.({
          completed,
          total: totalCount,
          bytesDownloaded,
          totalBytes,
          currentFile: item.zipPath.split('/').pop() || item.zipPath,
        });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, Math.max(1, entries.length)) }, () => worker())
  );

  if (signal?.aborted) {
    throw new DOMException('Download cancelado pelo usuário.', 'AbortError');
  }

  zip.end();

  const blob = new Blob(chunks, { type: 'application/zip' });
  const safeName = filename.endsWith('.zip') ? filename : `${filename}.zip`;
  triggerBlobDownload(blob, safeName);

  return { downloaded: completed - failed, failed };
}

export async function downloadCustomRequestZip(
  catalog: FullCatalog,
  req: ZipExportRequest,
  onProgress?: (progress: ZipProgress) => void,
  signal?: AbortSignal
): Promise<{ downloaded: number; failed: number }> {
  const plan = planCustomZip(catalog, req);
  return generateAndDownloadClientZip({
    cdnBase: catalog.summary.cdnBase,
    filename: `${plan.root}.zip`,
    entries: plan.entries,
    virtualFiles: plan.virtualFiles,
    onProgress,
    signal,
  });
}

export function downloadDatabaseFile(
  catalog: FullCatalog,
  format: 'json' | 'csv',
  table: 'ninjas' | 'techniques' = 'ninjas'
): void {
  if (format === 'csv') {
    const { ninjasCsv, techniquesCsv } = buildCsvDatabase(catalog);
    const isTech = table === 'techniques';
    const blob = new Blob(['\uFEFF' + (isTech ? techniquesCsv : ninjasCsv)], {
      type: 'text/csv;charset=utf-8',
    });
    triggerBlobDownload(
      blob,
      `naruto_jotagame_${isTech ? 'tecnicas' : 'ninjas_atributos'}.csv`
    );
    return;
  }

  const payload = {
    summary: catalog.summary,
    ninjas: catalog.ninjas,
    summons: catalog.summons,
    techniques: catalog.techniques,
    items: catalog.items,
    audioCount: catalog.audio.length,
    spineCount: catalog.spineModels.length,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  triggerBlobDownload(blob, 'naruto_jotagame_database.json');
}

export function downloadMirrorScriptFile(catalog: FullCatalog): void {
  const script = `#!/usr/bin/env node
// Shinobi Vault — Script de Espelhamento Completo (${catalog.summary.totalFiles} arquivos)
// Execute: node extrair_naruto_jotagame.mjs
import fs from 'node:fs';
import path from 'node:path';

const CDN = '${catalog.summary.cdnBase}';
const MANIFESTO = '${catalog.summary.manifestVersion}';
const OUT_DIR = path.resolve('./naruto_jotagame_completo');

function mapPath(url) {
  let m;
  if ((m = url.match(/^acervo\\/asset\\/heros\\/(\\d+)\\/(.+)$/))) return path.join('01_ninjas', m[1], 'retratos', m[2]);
  if ((m = url.match(/^acervo\\/language\\/pt\\/asset\\/heros\\/(\\d+)\\/(.+)$/))) return path.join('01_ninjas', m[1], 'banners_pt', m[2]);
  if ((m = url.match(/^acervo\\/asset\\/spine-hd\\/(vdfno_(\\d{6}).*)$/))) return path.join('01_ninjas', m[2], 'spine_hd', m[1]);
  if (url.startsWith('acervo/asset/spine-invocacoes/')) return path.join('02_invocacoes', 'spine', path.basename(url));
  if (url.startsWith('acervo/asset/invocacao/')) return path.join('02_invocacoes', url.replace('acervo/asset/invocacao/', ''));
  if (url.startsWith('acervo/asset/spine/')) {
    const f = path.basename(url);
    return path.join(f.includes('_effect') ? '04_habilidades_efeitos/spine_efeitos' : '03_animacoes_sprites/spine', f);
  }
  if (url.startsWith('acervo/asset/anim/') || url.startsWith('dados/atlas/asset/anim/')) return path.join('04_habilidades_efeitos/spritesheets_2d', path.basename(url));
  if (url.startsWith('acervo/video/')) return path.join('04_habilidades_efeitos/videos_esotericas', path.basename(url));
  if (url.startsWith('acervo/som/')) return path.join('05_sons_e_dublagens', url.replace('acervo/som/', ''));
  return path.join('06_ui_e_outros', url);
}

async function main() {
  const html = await (await fetch('https://naruto.jotagame.com/jogar?app=1')).text();
  const rec = JSON.parse(html.match(/window\\.__VDF_RECURSOS__\\s*=\\s*(\\{[^;]+\\})/)[1]);
  const data = await (await fetch(CDN + rec.manifesto)).json();
  const files = data.arquivos.filter((f) => f.url.startsWith('acervo/') || f.url.startsWith('dados/'));
  console.log('Baixando', files.length, 'arquivos (manifesto', MANIFESTO, ')...');
  let i = 0, done = 0;
  async function worker() {
    while (i < files.length) {
      const f = files[i++];
      const dest = path.join(OUT_DIR, mapPath(f.url));
      if (fs.existsSync(dest)) { done++; continue; }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      try {
        const r = await fetch(CDN + f.url);
        if (r.ok) fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
      } catch {}
      if (++done % 250 === 0) console.log(done + '/' + files.length);
    }
  }
  await Promise.all(Array.from({ length: 12 }, () => worker()));
  console.log('Concluído em:', OUT_DIR);
}
main();
`;
  const blob = new Blob([script], { type: 'application/javascript;charset=utf-8' });
  triggerBlobDownload(blob, 'extrair_naruto_jotagame.mjs');
}
