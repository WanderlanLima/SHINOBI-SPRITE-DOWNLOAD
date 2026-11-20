import { strToU8, Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import type { AssetFileRef, ManifestFile, ZipExportRequest } from '../types';
import {
  clearMirrorCheckpoint,
  type MirrorBackupCheckpoint,
  type MirrorStorageMode,
  saveMirrorCheckpoint,
} from '../utils/backupCheckpointDb';
import {
  FileSystemWritableSink,
  MemoryBufferSink,
  StreamingZip64Writer,
  supportsFileSystemSavePicker,
} from '../utils/zip64Stream';
import { fetchAssetBytesWithRetry } from './assetSource';
import {
  buildCsvDatabase,
  fetchBundledStudioSnapshot,
  type FullCatalog,
} from './catalogEngine';

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
  speedBytesPerSec?: number;
  etaSeconds?: number;
  failedCount?: number;
  pausedOffline?: boolean;
  stageLabel?: string;
}

export type MobilePartCategoryKey =
  | 'database'
  | 'ninjas'
  | 'summons'
  | 'spines'
  | 'spine_textures'
  | 'effects'
  | 'audio'
  | 'ui_maps'
  | 'items_misc';

export interface MobileCatalogPart {
  id: string;
  categoryKey: MobilePartCategoryKey;
  includedCategories: MobilePartCategoryKey[];
  categoryTitle: string;
  title: string;
  filename: string;
  folderHint: string;
  fileCount: number;
  totalBytes: number;
  entries: PlannedZipEntry[];
  virtualFiles: VirtualTextFile[];
}

export type SingleMirrorScope = 'full_all' | 'full_webp' | 'core_playable' | 'quick_test';

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
        '00_banco_de_dados/               -> JSON completo, planilhas CSV e índices',
        '01_ninjas/                       -> Pastas individuais por ninja (retratos, ícones de habilidades, Spine HD/batalha, áudios, ficha JSON)',
        '02_invocacoes/                   -> 50 invocações Spine 3.8 + fragmentos',
        '03_animacoes_sprites/            -> Modelos Spine 3.8 + texturas complementares (no_* / ASTC)',
        '04_habilidades_efeitos/          -> Efeitos Spine, spritesheets 2D, vídeos MP4 de esotéricas e ícones',
        '05_sons_e_dublagens/             -> Áudios MP3 separados por dublagens, esotéricas, derrota e combate',
        '06_ui_mapas_e_ptbr/              -> Interface, mapas vivos, cenários, histórias paralelas e artes PT-BR',
        '07_itens_e_dados_restantes/      -> Ícones de itens, dados internos e todos os arquivos restantes do jogo',
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
      for (const f of filterImages(ninja.skillIcons, req.imageFormat)) {
        addFile(f.url, `${folder}/icones_habilidades/${f.name}`, f.bytes);
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
 * Divide TODO o conteúdo do jogo em partes otimizadas para download direto no celular ou PC.
 * - Nunca divide nem quebra nenhuma pasta de ninja, invocação, Spine ou atlas 2D.
 * - Aproveita ao máximo o tamanho configurado (ex.: 400 MB) sem criar partes minúsculas de 50 MB.
 * - Mantém 100% da hierarquia organizada dentro de naruto_jotagame_acervo/ para mesclagem automática.
 */
export function buildFullCatalogMobileParts(
  catalog: FullCatalog,
  imageFormat: ZipExportRequest['imageFormat'],
  maxPartMB = 150
): MobileCatalogPart[] {
  const root = 'naruto_jotagame_acervo';
  const maxBytes = Math.max(20, maxPartMB) * 1024 * 1024;
  // Scale file ceiling with maxPartMB so small files (audio/UI/icons) fill up to maxPartMB!
  const maxFilesPerPart = Math.max(12000, Math.round(maxPartMB * 85));
  const coveredUrls = new Set<string>();

  const trackEntry = (entry: PlannedZipEntry): PlannedZipEntry => {
    coveredUrls.add(entry.sourceUrl);
    return entry;
  };

  interface TaggedUnit {
    categoryKey: MobilePartCategoryKey;
    categoryShort: string;
    folderHint: string;
    entries: PlannedZipEntry[];
    virtualFiles: VirtualTextFile[];
    bytes: number;
  }

  const allUnits: TaggedUnit[] = [];

  // Helper to deduplicate raw manifest files by directory+stem when imageFormat !== 'both'
  const filterManifestFiles = (
    files: Array<{ url: string; bytes: number }>
  ): Array<{ url: string; bytes: number }> => {
    if (imageFormat === 'both') return files;
    const nonImg: Array<{ url: string; bytes: number }> = [];
    const grouped = new Map<string, Array<{ url: string; bytes: number; ext: string }>>();
    for (const f of files) {
      const m = f.url.match(/^(.*)\.(webp|png)$/i);
      if (!m) {
        nonImg.push(f);
        continue;
      }
      const key = m[1].toLowerCase();
      const ext = m[2].toLowerCase();
      const list = grouped.get(key) || [];
      list.push({ url: f.url, bytes: f.bytes, ext });
      grouped.set(key, list);
    }
    const kept = [...nonImg];
    for (const group of grouped.values()) {
      const pref = group.find((x) => x.ext === imageFormat);
      const pick = pref || group[0];
      kept.push({ url: pick.url, bytes: pick.bytes });
    }
    return kept;
  };

  // 0. Banco de Dados Completo
  const dbVirtual = buildDatabaseVirtualFiles(catalog, root);
  const dbBytes = dbVirtual.reduce((s, v) => s + v.content.length, 0);
  allUnits.push({
    categoryKey: 'database',
    categoryShort: '00. Banco de Dados',
    folderHint: '00_banco_de_dados/',
    entries: [],
    virtualFiles: dbVirtual,
    bytes: dbBytes,
  });

  // 1. Todos os Ninjas (cada pasta de ninja é uma unidade atômica indivisível!)
  for (const ninja of catalog.ninjas) {
    const folder = `${root}/01_ninjas/${ninja.id}_${slugify(ninja.name)}`;
    const entries: PlannedZipEntry[] = [];
    const seen = new Set<string>();
    const pushF = (f: AssetFileRef, sub: string) => {
      const zp = `${folder}/${sub}/${f.name}`;
      if (seen.has(zp)) return;
      seen.add(zp);
      entries.push(trackEntry({ sourceUrl: f.url, zipPath: zp, bytes: f.bytes }));
    };
    for (const f of filterImages(ninja.portraits, imageFormat)) pushF(f, 'retratos');
    for (const f of filterImages(ninja.bannersPt, imageFormat)) pushF(f, 'banners_pt');
    for (const f of filterImages(ninja.skillIcons, imageFormat)) pushF(f, 'icones_habilidades');
    for (const sp of ninja.spineBundles) {
      const sub = sp.kind === 'hd' ? `spine_hd/${sp.name}` : `spine_batalha/${sp.name}`;
      for (const f of filterImages(sp.allFiles, imageFormat)) pushF(f, sub);
    }
    for (const a of ninja.audioFiles) {
      const zp = `${folder}/audio/${a.category}/${a.filename}`;
      if (!seen.has(zp)) {
        seen.add(zp);
        entries.push(trackEntry({ sourceUrl: a.url, zipPath: zp, bytes: a.bytes }));
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
    allUnits.push({
      categoryKey: 'ninjas',
      categoryShort: '01. Ninjas',
      folderHint: '01_ninjas/',
      entries,
      virtualFiles,
      bytes,
    });
  }

  // 2. Todas as 50 Invocações + Fragmentos (cada invocação é indivisível)
  for (const s of catalog.summons) {
    const folder = `${root}/02_invocacoes/${slugify(s.name)}_${slugify(s.rawCode)}`;
    const files = filterImages(s.spine.allFiles, imageFormat);
    const entries = files.map((f) =>
      trackEntry({
        sourceUrl: f.url,
        zipPath: `${folder}/${f.name}`,
        bytes: f.bytes,
      })
    );
    if (entries.length > 0) {
      allUnits.push({
        categoryKey: 'summons',
        categoryShort: '02. Invocações',
        folderHint: '02_invocacoes/',
        entries,
        virtualFiles: [],
        bytes: entries.reduce((acc, e) => acc + e.bytes, 0),
      });
    }
  }
  if (catalog.summonFragments.length > 0) {
    const fragEntries = catalog.summonFragments.map((f) =>
      trackEntry({
        sourceUrl: f.url,
        zipPath: `${root}/02_invocacoes/fragmentos/${f.name}`,
        bytes: f.bytes,
      })
    );
    allUnits.push({
      categoryKey: 'summons',
      categoryShort: '02. Invocações',
      folderHint: '02_invocacoes/',
      entries: fragEntries,
      virtualFiles: [],
      bytes: fragEntries.reduce((acc, e) => acc + e.bytes, 0),
    });
  }

  // 3. Todas as Animações Spine (cada skeleton Spine é indivisível)
  for (const sp of catalog.spineModels.filter((s) => s.kind !== 'efeito')) {
    const folder = `${root}/03_animacoes_sprites/${sp.kind}/${slugify(sp.name)}`;
    const files = filterImages(sp.allFiles, imageFormat);
    const entries = files.map((f) =>
      trackEntry({
        sourceUrl: f.url,
        zipPath: `${folder}/${f.name}`,
        bytes: f.bytes,
      })
    );
    if (entries.length > 0) {
      allUnits.push({
        categoryKey: 'spines',
        categoryShort: '03. Spine 3.8',
        folderHint: '03_animacoes_sprites/',
        entries,
        virtualFiles: [],
        bytes: entries.reduce((acc, e) => acc + e.bytes, 0),
      });
    }
  }

  // 4. Habilidades, Efeitos Spine, Spritesheets 2D, Vídeos MP4 e Ícones
  for (const sp of catalog.spineModels.filter((s) => s.kind === 'efeito')) {
    const folder = `${root}/04_habilidades_efeitos/spine_efeitos/${slugify(sp.name)}`;
    const files = filterImages(sp.allFiles, imageFormat);
    const entries = files.map((f) =>
      trackEntry({
        sourceUrl: f.url,
        zipPath: `${folder}/${f.name}`,
        bytes: f.bytes,
      })
    );
    if (entries.length > 0) {
      allUnits.push({
        categoryKey: 'effects',
        categoryShort: '04. Efeitos/Vídeos',
        folderHint: '04_habilidades_efeitos/',
        entries,
        virtualFiles: [],
        bytes: entries.reduce((a, b) => a + b.bytes, 0),
      });
    }
  }
  for (const a2d of catalog.anim2d) {
    const folder = `${root}/04_habilidades_efeitos/spritesheets_2d/${slugify(a2d.name)}`;
    const files = filterImages(a2d.allFiles, imageFormat);
    const entries = files.map((f) =>
      trackEntry({
        sourceUrl: f.url,
        zipPath: `${folder}/${f.name}`,
        bytes: f.bytes,
      })
    );
    if (entries.length > 0) {
      allUnits.push({
        categoryKey: 'effects',
        categoryShort: '04. Efeitos/Vídeos',
        folderHint: '04_habilidades_efeitos/',
        entries,
        virtualFiles: [],
        bytes: entries.reduce((a, b) => a + b.bytes, 0),
      });
    }
  }
  for (const vid of catalog.videos) {
    allUnits.push({
      categoryKey: 'effects',
      categoryShort: '04. Efeitos/Vídeos',
      folderHint: '04_habilidades_efeitos/',
      entries: [
        trackEntry({
          sourceUrl: vid.url,
          zipPath: `${root}/04_habilidades_efeitos/videos_esotericas/${vid.filename}`,
          bytes: vid.bytes,
        }),
      ],
      virtualFiles: [],
      bytes: vid.bytes,
    });
  }
  for (let i = 0; i < catalog.skillIcons.length; i += 100) {
    const slice = catalog.skillIcons.slice(i, i + 100);
    const entries = slice.map((f) =>
      trackEntry({
        sourceUrl: f.url,
        zipPath: `${root}/04_habilidades_efeitos/icones_habilidades/${f.name}`,
        bytes: f.bytes,
      })
    );
    allUnits.push({
      categoryKey: 'effects',
      categoryShort: '04. Efeitos/Vídeos',
      folderHint: '04_habilidades_efeitos/',
      entries,
      virtualFiles: [],
      bytes: entries.reduce((a, b) => a + b.bytes, 0),
    });
  }

  // 5. Todos os Sons e Dublagens MP3 (agrupados em pequenos blocos por categoria de áudio)
  const audioByCat = new Map<string, typeof catalog.audio>();
  for (const a of catalog.audio) {
    const list = audioByCat.get(a.category) || [];
    list.push(a);
    audioByCat.set(a.category, list);
  }
  for (const list of audioByCat.values()) {
    for (let i = 0; i < list.length; i += 50) {
      const slice = list.slice(i, i + 50);
      const entries = slice.map((a) =>
        trackEntry({
          sourceUrl: a.url,
          zipPath: `${root}/05_sons_e_dublagens/${a.category}/${a.filename}`,
          bytes: a.bytes,
        })
      );
      allUnits.push({
        categoryKey: 'audio',
        categoryShort: '05. Sons/Dublagens',
        folderHint: '05_sons_e_dublagens/',
        entries,
        virtualFiles: [],
        bytes: entries.reduce((s, e) => s + e.bytes, 0),
      });
    }
  }

  // SWEEP 100% OF ALL REMAINING FILES IN THE MANIFEST (so nothing from the 12.8 GB is ever left out!)
  const remainingRaw = catalog.rawArquivos.filter((f) => !coveredUrls.has(f.url));
  const filteredRemaining = filterManifestFiles(remainingRaw);

  const orphanSpineFiles: Array<{ url: string; bytes: number }> = [];
  const uiMapsPtFiles: Array<{ url: string; bytes: number }> = [];
  const itemsMiscFiles: Array<{ url: string; bytes: number }> = [];

  for (const f of filteredRemaining) {
    const u = f.url;
    if (
      u.startsWith('acervo/asset/spine/') ||
      u.startsWith('acervo/asset/spine-hd/') ||
      u.startsWith('acervo/asset/spine-astc/') ||
      u.startsWith('acervo/asset/spine-invocacoes/')
    ) {
      orphanSpineFiles.push(f);
    } else if (
      u.startsWith('acervo/asset/ui/') ||
      u.startsWith('acervo/asset/mapavivo/') ||
      u.startsWith('acervo/language/') ||
      u.startsWith('acervo/asset/historiasparalelas/') ||
      u.startsWith('acervo/asset/vdf-fazenda/') ||
      u.startsWith('acervo/asset/minijogos/') ||
      u.startsWith('acervo/asset/myouboku/') ||
      u.startsWith('acervo/asset/evrec/') ||
      u.startsWith('acervo/asset/dimensaoparalela/') ||
      u.startsWith('acervo/asset/torreinterplano/') ||
      u.startsWith('acervo/asset/miau/') ||
      u.startsWith('acervo/ttf/')
    ) {
      uiMapsPtFiles.push(f);
    } else {
      itemsMiscFiles.push(f);
    }
  }

  // 3B. Texturas Spine Complementares (agrupadas por prefixo para manter organização)
  orphanSpineFiles.sort((a, b) => a.url.localeCompare(b.url));
  for (let i = 0; i < orphanSpineFiles.length; i += 25) {
    const slice = orphanSpineFiles.slice(i, i + 25);
    const entries = slice.map((f) => ({
      sourceUrl: f.url,
      zipPath: `${root}/03_animacoes_sprites/texturas_spine/${f.url.replace(/^acervo\/asset\//, '')}`,
      bytes: f.bytes,
    }));
    allUnits.push({
      categoryKey: 'spine_textures',
      categoryShort: '03B. Texturas Spine',
      folderHint: '03_animacoes_sprites/texturas_spine/',
      entries,
      virtualFiles: [],
      bytes: entries.reduce((s, e) => s + e.bytes, 0),
    });
  }

  // 6. Interface, Mapas Vivos, Cenários, Minijogos e PT-BR (ordenado por pasta)
  uiMapsPtFiles.sort((a, b) => a.url.localeCompare(b.url));
  for (let i = 0; i < uiMapsPtFiles.length; i += 40) {
    const slice = uiMapsPtFiles.slice(i, i + 40);
    const entries = slice.map((f) => ({
      sourceUrl: f.url,
      zipPath: `${root}/06_ui_mapas_e_ptbr/${f.url.replace(/^acervo\//, '')}`,
      bytes: f.bytes,
    }));
    allUnits.push({
      categoryKey: 'ui_maps',
      categoryShort: '06. UI/Mapas/PT-BR',
      folderHint: '06_ui_mapas_e_ptbr/',
      entries,
      virtualFiles: [],
      bytes: entries.reduce((s, e) => s + e.bytes, 0),
    });
  }

  // 7. Itens, Equipamentos, Dados e Demais Arquivos do Jogo
  itemsMiscFiles.sort((a, b) => a.url.localeCompare(b.url));
  for (let i = 0; i < itemsMiscFiles.length; i += 80) {
    const slice = itemsMiscFiles.slice(i, i + 80);
    const entries = slice.map((f) => ({
      sourceUrl: f.url,
      zipPath: `${root}/07_itens_e_dados_restantes/${f.url}`,
      bytes: f.bytes,
    }));
    allUnits.push({
      categoryKey: 'items_misc',
      categoryShort: '07. Itens/Restantes',
      folderHint: '07_itens_e_dados_restantes/',
      entries,
      virtualFiles: [],
      bytes: entries.reduce((s, e) => s + e.bytes, 0),
    });
  }

  // SMART SPACE-OPTIMIZING PACKER:
  // Packs atomic units sequentially in strict folder order right up to maxPartMB,
  // never splitting any ninja/summon/Spine folder and eliminating wasteful 50 MB fragments!
  const bins: TaggedUnit[][] = [];
  let currentBin: TaggedUnit[] = [];
  let currentBytes = 0;
  let currentFiles = 0;

  for (const unit of allUnits) {
    const uFiles = unit.entries.length + unit.virtualFiles.length;
    if (uFiles === 0) continue;

    if (
      currentBin.length > 0 &&
      (currentBytes + unit.bytes > maxBytes || currentFiles + uFiles > maxFilesPerPart)
    ) {
      bins.push(currentBin);
      currentBin = [];
      currentBytes = 0;
      currentFiles = 0;
    }

    currentBin.push(unit);
    currentBytes += unit.bytes;
    currentFiles += uFiles;
  }
  if (currentBin.length > 0) bins.push(currentBin);

  // If the final tail bin is tiny (< 15% of maxBytes) and merging into previous bin stays within +10% tolerance, merge cleanly!
  if (bins.length >= 2) {
    const lastBin = bins[bins.length - 1];
    const prevBin = bins[bins.length - 2];
    const lastBytes = lastBin.reduce((s, u) => s + u.bytes, 0);
    const prevBytes = prevBin.reduce((s, u) => s + u.bytes, 0);
    const lastFiles = lastBin.reduce((s, u) => s + u.entries.length + u.virtualFiles.length, 0);
    const prevFiles = prevBin.reduce((s, u) => s + u.entries.length + u.virtualFiles.length, 0);
    if (
      lastBytes < maxBytes * 0.15 &&
      prevBytes + lastBytes <= maxBytes * 1.1 &&
      prevFiles + lastFiles <= maxFilesPerPart
    ) {
      prevBin.push(...lastBin);
      bins.pop();
    }
  }

  const totalPartsStr = String(bins.length).padStart(2, '0');
  const parts: MobileCatalogPart[] = bins.map((group, idx) => {
    const entries = group.flatMap((u) => u.entries);
    const virtualFiles = group.flatMap((u) => u.virtualFiles);
    const totalBytes = group.reduce((s, u) => s + u.bytes, 0);
    const partNum = String(idx + 1).padStart(2, '0');

    // Collect distinct ordered categories & folder hints inside this packed part
    const catKeys: MobilePartCategoryKey[] = [];
    const catLabels: string[] = [];
    const folderHints: string[] = [];
    const bytesPerCat = new Map<MobilePartCategoryKey, number>();

    for (const u of group) {
      bytesPerCat.set(u.categoryKey, (bytesPerCat.get(u.categoryKey) || 0) + u.bytes);
      if (!catKeys.includes(u.categoryKey)) {
        catKeys.push(u.categoryKey);
        catLabels.push(u.categoryShort);
      }
      if (!folderHints.includes(u.folderHint)) {
        folderHints.push(u.folderHint);
      }
    }

    // Primary category = category with the largest byte share in this part
    let primaryKey = catKeys[0];
    let primaryBytes = -1;
    for (const [k, b] of bytesPerCat.entries()) {
      if (b > primaryBytes) {
        primaryBytes = b;
        primaryKey = k;
      }
    }

    const labelSummary =
      catLabels.length <= 2
        ? catLabels.join(' + ')
        : `${catLabels[0]} → ${catLabels[catLabels.length - 1]}`;

    return {
      id: `acervo_opt_p${partNum}_of_${totalPartsStr}_${imageFormat}_${maxPartMB}`,
      categoryKey: primaryKey,
      includedCategories: catKeys,
      categoryTitle: labelSummary,
      title: `Parte ${partNum}/${totalPartsStr} · ${labelSummary}`,
      filename: `naruto_jotagame_parte_${partNum}_de_${totalPartsStr}.zip`,
      folderHint: folderHints.join(' · '),
      fileCount: entries.length + virtualFiles.length,
      totalBytes,
      entries,
      virtualFiles,
    };
  });

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
 * usando fflate em modo streaming com pool contínuo de 16 workers, timeout por arquivo e retentativas.
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
  const startTime = performance.now();
  let lastEmit = 0;

  const emitProgress = (currentFile: string, force = false) => {
    const now = performance.now();
    if (!force && now - lastEmit < 100) return;
    lastEmit = now;
    const elapsedSec = Math.max(0.25, (now - startTime) / 1000);
    const speedBytesPerSec = bytesDownloaded / elapsedSec;
    const remainingBytes = Math.max(0, totalBytes - bytesDownloaded);
    const etaSeconds = speedBytesPerSec > 1024 ? remainingBytes / speedBytesPerSec : undefined;
    onProgress?.({
      completed,
      total: totalCount,
      bytesDownloaded,
      totalBytes,
      currentFile,
      speedBytesPerSec,
      etaSeconds,
      failedCount: failed,
    });
  };

  // 1. Append text / JSON / CSV files with deflate compression
  for (const vf of virtualFiles) {
    if (signal?.aborted) throw new DOMException('Download cancelado pelo usuário.', 'AbortError');
    const stream = new ZipDeflate(vf.zipPath, { level: 5 });
    zip.add(stream);
    const encoded = strToU8(vf.content);
    stream.push(encoded, true);
    completed++;
    bytesDownloaded += encoded.byteLength;
    emitProgress(vf.zipPath.split('/').pop() || vf.zipPath);
  }

  // 2. Fetch binary assets with fast continuous 16-worker pool + per-file timeout & automatic retry
  const CONCURRENCY = 16;
  let cursor = 0;

  const worker = async () => {
    while (cursor < entries.length) {
      if (signal?.aborted) return;
      const idx = cursor++;
      const item = entries[idx];
      try {
        const buf = await fetchAssetBytesWithRetry(cdnBase, item.sourceUrl, {
          signal,
          timeoutMs: 18000,
          maxRetries: 3,
          noStore: true,
        });
        // Use STORE (zero compression CPU overhead) for already-compressed media files
        const stream = ALREADY_COMPRESSED_EXT.test(item.zipPath)
          ? new ZipPassThrough(item.zipPath)
          : new ZipDeflate(item.zipPath, { level: 5 });
        zip.add(stream);
        stream.push(buf, true);
        bytesDownloaded += buf.byteLength;
      } catch (err) {
        if (signal?.aborted || (err as Error)?.name === 'AbortError') return;
        failed++;
      } finally {
        completed++;
        emitProgress(item.zipPath.split('/').pop() || item.zipPath);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, Math.max(1, entries.length)) }, () => worker())
  );

  if (signal?.aborted) {
    throw new DOMException('Download cancelado pelo usuário.', 'AbortError');
  }

  emitProgress('Finalizando ZIP...', true);
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

/**
 * Planeja o Backup Único no formato ESPELHO EXATO de naruto.jotagame.com
 * (manifesto.json + studio-snapshot.json + acervo/... + dados/... + d/...)
 * para upload no Google Drive e leitura direta por HTTP Range caso o jogo saia do ar.
 */
export function planSingleGameMirrorZip(
  catalog: FullCatalog,
  scope: SingleMirrorScope
): {
  filename: string;
  files: ManifestFile[];
  totalBytes: number;
  folderCounts: Record<string, number>;
} {
  let files: ManifestFile[] = [];

  if (scope === 'full_all') {
    files = catalog.rawArquivos;
  } else if (scope === 'full_webp') {
    // Deduplicate .webp/.png keeping .webp so the backup is ~9.1 GB and 100% complete visually!
    const nonImg: ManifestFile[] = [];
    const grouped = new Map<string, ManifestFile[]>();
    for (const f of catalog.rawArquivos) {
      const m = f.url.match(/^(.*)\.(webp|png)$/i);
      if (!m) {
        nonImg.push(f);
        continue;
      }
      const key = m[1].toLowerCase();
      const list = grouped.get(key) || [];
      list.push(f);
      grouped.set(key, list);
    }
    const kept = [...nonImg];
    for (const group of grouped.values()) {
      const webp = group.find((x) => /\.webp$/i.test(x.url));
      kept.push(webp || group[0]);
    }
    files = kept;
  } else if (scope === 'core_playable') {
    const allowed = new Set<string>();
    for (const n of catalog.ninjas) {
      for (const f of filterImages(n.portraits, 'webp')) allowed.add(f.url);
      for (const f of filterImages(n.bannersPt, 'webp')) allowed.add(f.url);
      for (const f of filterImages(n.skillIcons, 'webp')) allowed.add(f.url);
      for (const sp of n.spineBundles) {
        for (const f of filterImages(sp.allFiles, 'webp')) allowed.add(f.url);
      }
      for (const a of n.audioFiles) allowed.add(a.url);
    }
    for (const s of catalog.summons) {
      for (const f of filterImages(s.spine.allFiles, 'webp')) allowed.add(f.url);
    }
    for (const st of catalog.statusEffects) {
      for (const f of filterImages(st.spine.allFiles, 'webp')) allowed.add(f.url);
    }
    files = catalog.rawArquivos.filter((f) => allowed.has(f.url));
  } else {
    // quick_test: 15 named ninjas + 50 summons + 18 status effects (~200-300 MB, great for quick Drive testing!)
    const allowed = new Set<string>();
    for (const n of catalog.ninjas.filter((x) => x.hasOfficialName).slice(0, 15)) {
      for (const f of filterImages(n.portraits, 'webp')) allowed.add(f.url);
      for (const f of filterImages(n.bannersPt, 'webp')) allowed.add(f.url);
      for (const f of filterImages(n.skillIcons, 'webp')) allowed.add(f.url);
      for (const sp of n.spineBundles) {
        for (const f of filterImages(sp.allFiles, 'webp')) allowed.add(f.url);
      }
      for (const a of n.audioFiles) allowed.add(a.url);
    }
    for (const s of catalog.summons) {
      for (const f of filterImages(s.spine.allFiles, 'webp')) allowed.add(f.url);
    }
    for (const st of catalog.statusEffects) {
      for (const f of filterImages(st.spine.allFiles, 'webp')) allowed.add(f.url);
    }
    files = catalog.rawArquivos.filter((f) => allowed.has(f.url));
  }

  const folderCounts: Record<string, number> = {};
  let totalBytes = 0;
  for (const f of files) {
    totalBytes += f.bytes;
    const top = f.url.split('/')[0] || 'raiz';
    folderCounts[top] = (folderCounts[top] || 0) + 1;
  }

  const suffixMap: Record<SingleMirrorScope, string> = {
    full_all: 'naruto_jotagame_backup_completo_100.zip',
    full_webp: 'naruto_jotagame_backup_webp.zip',
    core_playable: 'naruto_jotagame_backup_nucleo_ninjas.zip',
    quick_test: 'naruto_jotagame_backup_teste_rapido.zip',
  };

  return {
    filename: suffixMap[scope],
    files,
    totalBytes,
    folderCounts,
  };
}

async function waitUntilOnlineOrAborted(
  signal?: AbortSignal,
  pauseSignal?: AbortSignal
): Promise<void> {
  if (typeof navigator === 'undefined' || navigator.onLine !== false) return;
  await new Promise<void>((resolve) => {
    const done = () => {
      window.removeEventListener('online', done);
      signal?.removeEventListener('abort', done);
      pauseSignal?.removeEventListener('abort', done);
      window.clearInterval(poll);
      resolve();
    };
    window.addEventListener('online', done, { once: true });
    signal?.addEventListener('abort', done, { once: true });
    pauseSignal?.addEventListener('abort', done, { once: true });
    const poll = window.setInterval(() => {
      if (navigator.onLine !== false) done();
    }, 1500);
  });
}

export interface OpfsStorageSupport {
  supported: boolean;
  availableBytes: number;
  quotaBytes: number;
  usageBytes: number;
}

function isDiskStateChangedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name || '';
  const msg = (err as { message?: string }).message || '';
  return (
    name === 'InvalidStateError' ||
    /state had changed since it was read from disk/i.test(msg) ||
    /cached in an interface object/i.test(msg)
  );
}

export async function getOpfsStorageSupport(): Promise<OpfsStorageSupport> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.storage ||
    typeof navigator.storage.getDirectory !== 'function'
  ) {
    return { supported: false, availableBytes: 0, quotaBytes: 0, usageBytes: 0 };
  }

  try {
    // Safari OPFS does not expose FileSystemFileHandle.createWritable(); verify it exists
    const hasWritable =
      typeof FileSystemFileHandle !== 'undefined' &&
      'createWritable' in FileSystemFileHandle.prototype;
    if (!hasWritable) {
      return { supported: false, availableBytes: 0, quotaBytes: 0, usageBytes: 0 };
    }
    await navigator.storage.getDirectory();
    let quotaBytes = 0;
    let usageBytes = 0;
    if (typeof navigator.storage.estimate === 'function') {
      const est = await navigator.storage.estimate();
      quotaBytes = est.quota || 0;
      usageBytes = est.usage || 0;
    }
    return {
      supported: true,
      quotaBytes,
      usageBytes,
      availableBytes: Math.max(0, quotaBytes - usageBytes),
    };
  } catch {
    return { supported: false, availableBytes: 0, quotaBytes: 0, usageBytes: 0 };
  }
}

export async function discardOpfsStagingFile(opfsFileName?: string): Promise<void> {
  if (opfsFileName && typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(opfsFileName);
    } catch {
      // ignore if already removed or inaccessible
    }
  }
  await clearMirrorCheckpoint();
}

export function isAndroidBrowser(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '');
}

/**
 * Copia um backup ZIP64 já 100% finalizado no Cofre Seguro (OPFS) para a pasta real
 * do aparelho:
 * - No Android: usa por padrão o Gerenciador de Downloads nativo (<a download> direto do File no OPFS,
 *   consumindo 0 MB extras de RAM e evitando 100% o bug InvalidStateError do Android SAF/MediaStore!).
 * - No PC: usa por padrão showSaveFilePicker em blocos de 16 MB (~15-30s em SSD), mantendo o arquivo
 *   no OPFS intacto caso a pasta escolhida dê InvalidStateError.
 */
export async function exportReadyOpfsBackupToDisk(opts: {
  checkpoint: MirrorBackupCheckpoint;
  method?: 'auto' | 'browser_download' | 'file_picker';
  onProgress?: (progress: ZipProgress) => void;
  signal?: AbortSignal;
}): Promise<{ savedBytes: number; usedDirectDisk: boolean; keptInCache: boolean }> {
  const { checkpoint, method = 'auto', onProgress, signal } = opts;
  if (!checkpoint.opfsFileName) {
    throw new Error('Arquivo do Cofre Seguro não encontrado no checkpoint.');
  }

  const root = await navigator.storage.getDirectory();
  let opfsHandle: FileSystemFileHandle;
  try {
    opfsHandle = await root.getFileHandle(checkpoint.opfsFileName);
  } catch {
    await clearMirrorCheckpoint();
    throw new Error(
      'O arquivo temporário no Cofre Seguro foi limpo pelo navegador. Inicie o backup novamente.'
    );
  }

  const opfsFile = await opfsHandle.getFile();
  const totalSize = opfsFile.size;
  const android = isAndroidBrowser();

  const useFilePicker =
    method === 'file_picker'
      ? supportsFileSystemSavePicker()
      : method === 'browser_download'
      ? false
      : !android && supportsFileSystemSavePicker();

  if (useFilePicker) {
    let targetHandle: any;
    try {
      const picker = (window as unknown as {
        showSaveFilePicker: (pickerOpts: unknown) => Promise<any>;
      }).showSaveFilePicker;
      targetHandle = await picker({
        suggestedName: checkpoint.filename,
        types: [
          {
            description: 'Backup Único ZIP64 (naruto.jotagame.com)',
            accept: { 'application/zip': ['.zip'] },
          },
        ],
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        throw new DOMException('Salvamento cancelado pelo usuário.', 'AbortError');
      }
      throw err;
    }

    const writable = await targetHandle.createWritable();
    const CHUNK_SIZE = 16 * 1024 * 1024;
    const totalChunks = Math.max(1, Math.ceil(totalSize / CHUNK_SIZE));
    const startTime = performance.now();
    let written = 0;
    let chunkIndex = 0;

    try {
      for (let pos = 0; pos < totalSize; pos += CHUNK_SIZE) {
        if (signal?.aborted) {
          try {
            await writable.abort?.();
          } catch {
            // ignore
          }
          throw new DOMException('Cópia para o disco cancelada pelo usuário.', 'AbortError');
        }

        const end = Math.min(totalSize, pos + CHUNK_SIZE);
        const buf = await opfsFile.slice(pos, end).arrayBuffer();
        await writable.write(new Uint8Array(buf));
        written = end;
        chunkIndex++;

        const elapsedSec = Math.max(0.1, (performance.now() - startTime) / 1000);
        const speed = written / elapsedSec;
        const eta = speed > 1024 ? Math.max(0, totalSize - written) / speed : undefined;

        onProgress?.({
          completed: chunkIndex,
          total: totalChunks,
          bytesDownloaded: written,
          totalBytes: totalSize,
          currentFile: checkpoint.filename,
          speedBytesPerSec: speed,
          etaSeconds: eta,
          stageLabel: 'Copiando ZIP64 pronto para a pasta escolhida...',
        });
      }

      onProgress?.({
        completed: totalChunks,
        total: totalChunks,
        bytesDownloaded: totalSize,
        totalBytes: totalSize,
        currentFile: checkpoint.filename,
        stageLabel: 'Confirmando gravação final no disco...',
      });

      await writable.close();
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        throw err;
      }
      if (isDiskStateChangedError(err)) {
        const gb = (totalSize / (1024 * 1024 * 1024)).toFixed(2);
        throw new Error(
          android
            ? `O seletor de pastas do Android (SAF/MediaStore) bloqueou o salvamento final (InvalidStateError). Fique tranquilo: seu backup pronto de ${gb} GB CONTINUA 100% SALVO no Cofre Seguro! Clique no botão verde "Salvar na Pasta Downloads do Celular" para baixar via Gerenciador de Downloads nativo do Android sem esse erro.`
            : `A pasta escolhida foi modificada pelo OneDrive, Google Drive Desktop ou antivírus durante a gravação (InvalidStateError). Fique tranquilo: seu backup pronto de ${gb} GB CONTINUA 100% SALVO no Cofre Seguro! Escolha uma pasta local fora do OneDrive ou clique em "Baixar via Downloads do Navegador".`
        );
      }
      throw err;
    }

    // Somente apaga do Cofre Seguro DEPOIS que writable.close() concluiu com 100% de sucesso!
    try {
      await root.removeEntry(checkpoint.opfsFileName);
    } catch {
      // ignore
    }
    await clearMirrorCheckpoint();

    return { savedBytes: totalSize, usedDirectDisk: true, keptInCache: false };
  }

  // Envia direto do File no OPFS para o Gerenciador de Downloads nativo (0 RAM extra, imune ao SAF InvalidStateError!)
  const url = URL.createObjectURL(opfsFile);
  const a = document.createElement('a');
  a.href = url;
  a.download = checkpoint.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Mantém o URL válido por 15 minutos para transferências grandes no Android
  window.setTimeout(() => URL.revokeObjectURL(url), 15 * 60 * 1000);

  return { savedBytes: totalSize, usedDirectDisk: false, keptInCache: true };
}

/**
 * Gera um ÚNICO arquivo ZIP64 mantendo 100% da estrutura original de naruto.jotagame.com
 * (manifesto.json + studio-snapshot.json + acervo/... + dados/... + d/...).
 *
 * Motor de alta velocidade & anti-travamento:
 * - Cofre Seguro (OPFS) por padrão: baixa na sandbox privada do navegador (imune ao InvalidStateError
 *   causado por OneDrive / Google Drive Desktop / Antivírus) e só depois copia para sua pasta em segundos!
 * - Pool contínuo de 12–36 workers HTTP sem barreiras de lote (satura conexões rápidas!)
 * - Timeout individual por arquivo (18s) + 3 retentativas automáticas + `cache: 'no-store'`
 * - Escrita bufferizada em blocos de 8 MB (~100x menos chamadas de disco IPC no Chrome)
 * - Suporte a Pausar e Salvar Progresso (Checkpoint no IndexedDB) + Retomar exatamente de onde parou!
 * - Wake Lock automático para impedir suspensão do PC/celular + pausa automática se a internet cair
 */
export async function generateSingleGameMirrorZip64(opts: {
  catalog: FullCatalog;
  scope: SingleMirrorScope;
  storageMode?: MirrorStorageMode;
  concurrency?: number;
  resumeCheckpoint?: MirrorBackupCheckpoint | null;
  onProgress?: (progress: ZipProgress) => void;
  signal?: AbortSignal;
  pauseSignal?: AbortSignal;
}): Promise<{
  downloaded: number;
  failed: number;
  usedDirectDisk: boolean;
  paused: boolean;
  readyInOpfs: boolean;
}> {
  const {
    catalog,
    scope,
    storageMode = 'opfs',
    concurrency = 24,
    resumeCheckpoint = null,
    onProgress,
    signal,
    pauseSignal,
  } = opts;
  const effectiveScope = resumeCheckpoint ? resumeCheckpoint.scope : scope;
  const effectiveStorageMode: MirrorStorageMode = resumeCheckpoint
    ? resumeCheckpoint.storageMode
    : storageMode;
  const plan = planSingleGameMirrorZip(catalog, effectiveScope);
  const cdnBase = catalog.summary.cdnBase;

  let sink: FileSystemWritableSink | MemoryBufferSink | null = null;
  let fileHandle: any = null;
  let activeOpfsFileName: string | undefined;
  let usedDirectDisk = false;
  let writer: StreamingZip64Writer;

  let completed = 0;
  let bytesDownloaded = 0;
  let initialBytesDownloaded = 0;
  let failed = 0;
  let totalCount = plan.files.length + 2;
  let totalBytes = plan.totalBytes;
  let remainingFiles: ManifestFile[] = plan.files;

  if (resumeCheckpoint && resumeCheckpoint.storageMode === 'opfs' && resumeCheckpoint.opfsFileName) {
    try {
      const root = await navigator.storage.getDirectory();
      const opfsHandle = await root.getFileHandle(resumeCheckpoint.opfsFileName, { create: false });
      const existingFile = await opfsHandle.getFile();
      if (existingFile.size < resumeCheckpoint.offset) {
        throw new Error(
          'O arquivo parcial no Cofre Seguro foi alterado ou truncado pelo navegador. Descarte o checkpoint e inicie um novo backup.'
        );
      }
      const writable = await opfsHandle.createWritable({ keepExistingData: true });
      await writable.truncate(resumeCheckpoint.offset);
      await writable.seek(resumeCheckpoint.offset);
      sink = new FileSystemWritableSink(writable, 8 * 1024 * 1024);
      activeOpfsFileName = resumeCheckpoint.opfsFileName;
      usedDirectDisk = true;

      writer = new StreamingZip64Writer(sink, {
        initialOffset: resumeCheckpoint.offset,
        initialEntries: resumeCheckpoint.entries,
      });

      const alreadyDone = new Set(resumeCheckpoint.entries.map((e) => e.path));
      remainingFiles = plan.files.filter((f) => !alreadyDone.has(f.url.replace(/^\/+/, '')));
      completed = resumeCheckpoint.entries.length;
      bytesDownloaded = resumeCheckpoint.bytesDownloaded;
      initialBytesDownloaded = bytesDownloaded;
      totalCount = Math.max(plan.files.length + 2, completed + remainingFiles.length);
      totalBytes = Math.max(resumeCheckpoint.totalBytes, plan.totalBytes);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        throw new DOMException('Retomada cancelada pelo usuário.', 'AbortError');
      }
      throw err;
    }
  } else if (resumeCheckpoint && resumeCheckpoint.handle) {
    fileHandle = resumeCheckpoint.handle;
    try {
      if (typeof fileHandle.queryPermission === 'function') {
        const perm = await fileHandle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted' && typeof fileHandle.requestPermission === 'function') {
          const reqPerm = await fileHandle.requestPermission({ mode: 'readwrite' });
          if (reqPerm !== 'granted') {
            throw new Error(
              'Permissão de gravação negada para retomar o arquivo salvo. Clique em "Continuar" novamente e permita o acesso ao arquivo.'
            );
          }
        }
      }
      const existingFile = await fileHandle.getFile();
      if (existingFile.size < resumeCheckpoint.offset) {
        throw new Error(
          'O arquivo parcial salvo anteriormente foi movido, apagado ou alterado no disco. Descarte o checkpoint e inicie um novo backup.'
        );
      }
      const writable = await fileHandle.createWritable({ keepExistingData: true });
      await writable.truncate(resumeCheckpoint.offset);
      await writable.seek(resumeCheckpoint.offset);
      sink = new FileSystemWritableSink(writable, 8 * 1024 * 1024);
      usedDirectDisk = true;

      writer = new StreamingZip64Writer(sink, {
        initialOffset: resumeCheckpoint.offset,
        initialEntries: resumeCheckpoint.entries,
      });

      const alreadyDone = new Set(resumeCheckpoint.entries.map((e) => e.path));
      remainingFiles = plan.files.filter((f) => !alreadyDone.has(f.url.replace(/^\/+/, '')));
      completed = resumeCheckpoint.entries.length;
      bytesDownloaded = resumeCheckpoint.bytesDownloaded;
      initialBytesDownloaded = bytesDownloaded;
      totalCount = Math.max(plan.files.length + 2, completed + remainingFiles.length);
      totalBytes = Math.max(resumeCheckpoint.totalBytes, plan.totalBytes);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        throw new DOMException('Retomada cancelada pelo usuário.', 'AbortError');
      }
      throw err;
    }
  } else {
    if (effectiveStorageMode === 'opfs') {
      const opfsSupport = await getOpfsStorageSupport();
      if (opfsSupport.supported) {
        const requiredBytes = plan.totalBytes * 1.03 + 64 * 1024 * 1024;
        if (opfsSupport.quotaBytes > 0 && opfsSupport.availableBytes < requiredBytes) {
          const availGb = (opfsSupport.availableBytes / (1024 * 1024 * 1024)).toFixed(2);
          const reqGb = (requiredBytes / (1024 * 1024 * 1024)).toFixed(2);
          throw new Error(
            `Espaço insuficiente no Cofre Seguro do navegador (disponível: ${availGb} GB, necessário: ${reqGb} GB). Libere espaço em disco, troque para o modo "Direto no Disco" (em uma pasta local fora do OneDrive) ou use o Script Turbo (.mjs).`
          );
        }

        try {
          await navigator.storage.persist?.().catch(() => false);
          const root = await navigator.storage.getDirectory();
          const opfsName = `shinobi_staging_${effectiveScope}.zip`;
          const opfsHandle = await root.getFileHandle(opfsName, { create: true });
          const writable = await opfsHandle.createWritable();
          sink = new FileSystemWritableSink(writable, 8 * 1024 * 1024);
          activeOpfsFileName = opfsName;
          usedDirectDisk = true;
        } catch (err) {
          throw new Error(
            `Não foi possível abrir o Cofre Seguro (OPFS): ${
              err instanceof Error ? err.message : 'erro desconhecido'
            }. Tente o modo "Direto no Disco" ou o Script Turbo (.mjs).`
          );
        }
      }
    }

    if (!sink && supportsFileSystemSavePicker()) {
      try {
        const picker = (window as unknown as {
          showSaveFilePicker: (pickerOpts: unknown) => Promise<any>;
        }).showSaveFilePicker;
        fileHandle = await picker({
          suggestedName: plan.filename,
          types: [
            {
              description: 'Backup Único ZIP64 (naruto.jotagame.com)',
              accept: { 'application/zip': ['.zip'] },
            },
          ],
        });
        const writable = await fileHandle.createWritable();
        sink = new FileSystemWritableSink(writable, 8 * 1024 * 1024);
        usedDirectDisk = true;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          throw new DOMException('Salvamento cancelado pelo usuário.', 'AbortError');
        }
        // Blocked in iframe or unsupported -> fall through to memory check
      }
    }

    if (!sink) {
      if (plan.totalBytes > 650 * 1024 * 1024) {
        throw new Error(
          `Este backup único tem ${(plan.totalBytes / (1024 * 1024 * 1024)).toFixed(
            2
          )} GB e precisa do Cofre Seguro (OPFS) ou gravação direta em disco (Chrome/Edge) ou do Script Turbo (.mjs) abaixo. Para testar aqui agora mesmo, selecione "Backup Teste Rápido (~260 MB)".`
        );
      }
      sink = new MemoryBufferSink();
    }

    writer = new StreamingZip64Writer(sink);

    // 1. Embed studio-snapshot.json & manifesto.json at root (exact game mirror metadata!)
    const snapshot = await fetchBundledStudioSnapshot();
    const snapBytes = strToU8(JSON.stringify(snapshot));
    await writer.addFile('studio-snapshot.json', snapBytes);

    const manifestPayload = {
      versao: catalog.summary.manifestVersion,
      origem: catalog.summary.sourceUrl,
      build: catalog.summary.build,
      geradoEm: new Date().toISOString(),
      escopoBackup: effectiveScope,
      arquivos: plan.files,
    };
    const manBytes = strToU8(JSON.stringify(manifestPayload));
    await writer.addFile('manifesto.json', manBytes);

    totalCount = plan.files.length + 2;
    totalBytes = plan.totalBytes + snapBytes.byteLength + manBytes.byteLength;
    completed = 2;
    bytesDownloaded = snapBytes.byteLength + manBytes.byteLength;
    initialBytesDownloaded = bytesDownloaded;
  }

  // Request Screen Wake Lock so PC/phone doesn't sleep mid-backup
  let wakeLock: { release?: () => Promise<void> } | null = null;
  try {
    const nav = navigator as unknown as {
      wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
    };
    if (nav.wakeLock) {
      wakeLock = await nav.wakeLock.request('screen');
    }
  } catch {
    // ignore unsupported or denied wake lock
  }

  // Combine cancel signal + pause signal for network workers
  const fetchCtrl = new AbortController();
  const stopFetching = () => fetchCtrl.abort();
  signal?.addEventListener('abort', stopFetching, { once: true });
  pauseSignal?.addEventListener('abort', stopFetching, { once: true });

  const sessionStart = performance.now();
  let lastEmit = 0;
  let speedWindowStart = sessionStart;
  let speedWindowBytes = 0;
  let smoothedSpeed = 0;
  let isPausedOffline = false;
  let currentFileLabel = resumeCheckpoint ? 'Retomando backup salvo...' : 'manifesto.json';

  const emitProgress = (force = false, stageLabel?: string) => {
    const now = performance.now();
    if (!force && now - lastEmit < 120) return;
    lastEmit = now;

    const winSec = (now - speedWindowStart) / 1000;
    if (winSec >= 1.2) {
      const instant = speedWindowBytes / winSec;
      smoothedSpeed = smoothedSpeed > 0 ? smoothedSpeed * 0.65 + instant * 0.35 : instant;
      speedWindowStart = now;
      speedWindowBytes = 0;
    } else if (smoothedSpeed === 0) {
      const totalSec = Math.max(0.25, (now - sessionStart) / 1000);
      smoothedSpeed = (bytesDownloaded - initialBytesDownloaded) / totalSec;
    }

    const remainingBytes = Math.max(0, totalBytes - bytesDownloaded);
    const etaSeconds = smoothedSpeed > 2048 ? remainingBytes / smoothedSpeed : undefined;

    onProgress?.({
      completed,
      total: totalCount,
      bytesDownloaded,
      totalBytes,
      currentFile: currentFileLabel,
      speedBytesPerSec: smoothedSpeed,
      etaSeconds,
      failedCount: failed,
      pausedOffline: isPausedOffline,
      stageLabel,
    });
  };

  emitProgress(
    true,
    resumeCheckpoint
      ? 'Retomando de onde parou...'
      : activeOpfsFileName
      ? 'Baixando no Cofre Seguro (protegido contra erros de disco)...'
      : 'Iniciando conexões paralelas...'
  );

  const failedItems: ManifestFile[] = [];

  // Pipelined continuous worker pool + bounded write queue (max 24 MB in RAM!)
  const runDownloadPass = async (
    items: ManifestFile[],
    workerCount: number,
    timeoutMs: number,
    isRetryPass: boolean
  ) => {
    if (items.length === 0) return;
    const MAX_QUEUE_BYTES = 24 * 1024 * 1024;
    const writeQueue: Array<{ item: ManifestFile; data: Uint8Array }> = [];
    let queuedBytes = 0;
    let workersFinished = false;
    let cursor = 0;
    let consecutiveNetErrors = 0;
    let writeFatalError: unknown = null;

    let wakeWriter: (() => void) | null = null;
    const queueNotFullWaiters: Array<() => void> = [];

    const notifyWriter = () => {
      if (wakeWriter) {
        const fn = wakeWriter;
        wakeWriter = null;
        fn();
      }
    };

    const notifyWorkersSpace = () => {
      while (queueNotFullWaiters.length > 0 && queuedBytes < MAX_QUEUE_BYTES) {
        const fn = queueNotFullWaiters.shift();
        fn?.();
      }
    };

    // Dedicated serialized writer coroutine — continuously drains into 8 MB buffered ZIP64 stream
    const writerLoop = (async () => {
      try {
        while (!workersFinished || writeQueue.length > 0) {
          if (signal?.aborted) break;
          if (writeQueue.length === 0) {
            await new Promise<void>((resolve) => {
              wakeWriter = resolve;
            });
            continue;
          }
          const next = writeQueue.shift()!;
          queuedBytes -= next.data.byteLength;
          notifyWorkersSpace();

          await writer.addFile(next.item.url, next.data);
          bytesDownloaded += next.data.byteLength;
          speedWindowBytes += next.data.byteLength;
          completed++;
          currentFileLabel = next.item.url.split('/').pop() || next.item.url;
          emitProgress(false, isRetryPass ? 'Recuperando arquivos com falha...' : undefined);
        }
      } catch (err) {
        writeFatalError = err;
        fetchCtrl.abort();
      } finally {
        while (queueNotFullWaiters.length > 0) {
          queueNotFullWaiters.shift()?.();
        }
      }
    })();

    const worker = async () => {
      while (cursor < items.length) {
        if (fetchCtrl.signal.aborted || writeFatalError) return;

        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          isPausedOffline = true;
          emitProgress(true, 'Sem internet — aguardando conexão voltar...');
          await waitUntilOnlineOrAborted(signal, pauseSignal);
          isPausedOffline = false;
          if (fetchCtrl.signal.aborted) return;
          emitProgress(true, 'Conexão restabelecida — continuando...');
        }

        while (queuedBytes >= MAX_QUEUE_BYTES && !fetchCtrl.signal.aborted && !writeFatalError) {
          await new Promise<void>((resolve) => {
            queueNotFullWaiters.push(resolve);
          });
        }
        if (fetchCtrl.signal.aborted || writeFatalError) return;

        const idx = cursor++;
        if (idx >= items.length) return;
        const item = items[idx];

        try {
          const data = await fetchAssetBytesWithRetry(cdnBase, item.url, {
            signal: fetchCtrl.signal,
            timeoutMs,
            maxRetries: 3,
            noStore: true,
          });
          consecutiveNetErrors = 0;
          writeQueue.push({ item, data });
          queuedBytes += data.byteLength;
          notifyWriter();
        } catch (err) {
          if (fetchCtrl.signal.aborted || (err as Error)?.name === 'AbortError') return;
          consecutiveNetErrors++;
          if (!isRetryPass) {
            failedItems.push(item);
          } else {
            failed++;
            completed++;
            emitProgress();
          }
          if (consecutiveNetErrors >= 12) {
            consecutiveNetErrors = 0;
            await new Promise((r) => window.setTimeout(r, 1500));
          }
        }
      }
    };

    try {
      const actualWorkers = Math.max(1, Math.min(workerCount, items.length));
      await Promise.all(Array.from({ length: actualWorkers }, () => worker()));
    } finally {
      workersFinished = true;
      notifyWriter();
      await writerLoop;
    }

    if (writeFatalError) {
      throw writeFatalError;
    }
  };

  try {
    await runDownloadPass(remainingFiles, Math.max(4, Math.min(48, concurrency)), 18000, false);

    // Automatic recovery pass for any transient network failures before finalizing
    if (
      !signal?.aborted &&
      !pauseSignal?.aborted &&
      failedItems.length > 0 &&
      failedItems.length <= 300
    ) {
      const toRetry = [...failedItems];
      failedItems.length = 0;
      emitProgress(true, `Tentando recuperar ${toRetry.length} arquivo(s) que oscilaram...`);
      await runDownloadPass(toRetry, 8, 28000, true);
    } else if (!pauseSignal?.aborted && !signal?.aborted && failedItems.length > 0) {
      failed += failedItems.length;
      completed += failedItems.length;
    }

    // Graceful Pause & Save Checkpoint to OPFS or Disk + IndexedDB!
    if (pauseSignal?.aborted && !signal?.aborted) {
      if (usedDirectDisk && (activeOpfsFileName || fileHandle)) {
        emitProgress(
          true,
          activeOpfsFileName
            ? 'Salvando progresso no Cofre Seguro para continuar depois...'
            : 'Salvando progresso no disco para continuar depois...'
        );
        const snap = await writer.flushAndSuspend();
        await saveMirrorCheckpoint({
          scope: effectiveScope,
          storageMode: activeOpfsFileName ? 'opfs' : 'direct_disk',
          filename: plan.filename,
          opfsFileName: activeOpfsFileName,
          handle: activeOpfsFileName ? undefined : fileHandle,
          readyToExport: false,
          offset: snap.offset,
          entries: snap.entries,
          failedUrls: failedItems.map((f) => f.url),
          bytesDownloaded,
          totalFiles: totalCount,
          totalBytes,
        });
        return {
          downloaded: snap.entries.length,
          failed,
          usedDirectDisk,
          paused: true,
          readyInOpfs: false,
        };
      }
      throw new DOMException('Backup pausado/cancelado.', 'AbortError');
    }

    if (signal?.aborted) {
      try {
        await sink.close();
      } catch {
        // ignore close error on abort
      }
      if (activeOpfsFileName) {
        await discardOpfsStagingFile(activeOpfsFileName);
      }
      throw new DOMException('Backup cancelado pelo usuário.', 'AbortError');
    }

    emitProgress(true, 'Gravando índice ZIP64 Central Directory...');
    try {
      await writer.finalize();
    } catch (err) {
      if (isDiskStateChangedError(err)) {
        throw new Error(
          isAndroidBrowser()
            ? 'O Android (MediaStore / Storage Access Framework) alterou o arquivo na pasta Downloads durante a gravação longa e o Chrome bloqueou a finalização (InvalidStateError). Use o modo "Cofre Seguro (OPFS — Recomendado)" — que grava na área isolada do navegador e depois envia para Downloads sem esse erro — ou use o Script Turbo (.mjs) no Termux.'
            : 'O navegador bloqueou o salvamento final porque o arquivo .zip foi tocado pelo OneDrive, Google Drive Desktop, antivírus ou Explorador de Arquivos durante o download (InvalidStateError). Use o modo "Cofre Seguro (OPFS — Recomendado)" para ficar 100% imune a esse erro, ou salve em uma pasta local fora do OneDrive (ex.: C:\\Backups).'
        );
      }
      throw err;
    }

    if (activeOpfsFileName) {
      const root = await navigator.storage.getDirectory();
      const opfsHandle = await root.getFileHandle(activeOpfsFileName);
      const finalFile = await opfsHandle.getFile();
      await saveMirrorCheckpoint({
        scope: effectiveScope,
        storageMode: 'opfs',
        filename: plan.filename,
        opfsFileName: activeOpfsFileName,
        readyToExport: true,
        offset: finalFile.size,
        entries: [],
        failedUrls: [],
        bytesDownloaded: finalFile.size,
        totalFiles: writer.getEntryCount(),
        totalBytes: finalFile.size,
      });
      return {
        downloaded: writer.getEntryCount(),
        failed,
        usedDirectDisk: true,
        paused: false,
        readyInOpfs: true,
      };
    }

    await clearMirrorCheckpoint();

    if (sink instanceof MemoryBufferSink) {
      triggerBlobDownload(sink.toBlob(), plan.filename);
    }

    return {
      downloaded: writer.getEntryCount(),
      failed,
      usedDirectDisk,
      paused: false,
      readyInOpfs: false,
    };
  } finally {
    signal?.removeEventListener('abort', stopFetching);
    pauseSignal?.removeEventListener('abort', stopFetching);
    try {
      await wakeLock?.release?.();
    } catch {
      // ignore
    }
  }
}

export function downloadMirrorZip64ScriptFile(catalog: FullCatalog): void {
  const cdn = catalog.summary.cdnBase.startsWith('http')
    ? catalog.summary.cdnBase
    : 'https://cdn.jotagame.com/';
  const script = `#!/usr/bin/env node
// Shinobi Vault — Gerador Turbo & Retomável de Backup ZIP64 Único (naruto.jotagame.com)
// - 32 conexões paralelas contínuas (máxima velocidade na sua internet!)
// - Timeout individual por arquivo + 4 retentativas automáticas (NUNCA trava!)
// - Buffer de escrita de 8 MB em disco + retomada automática via .checkpoint.json (Ctrl+C seguro!)
// - Zero dependências externas (Node.js 18+). Funciona em Windows, Mac, Linux e Android (Termux).
// Execute: node gerar_backup_unico_zip64.mjs
import fs from 'node:fs';
import path from 'node:path';

const CDN = '${cdn}';
const OUT_ZIP = path.resolve('./naruto_jotagame_backup_completo_100.zip');
const CKPT_FILE = OUT_ZIP + '.checkpoint.json';
const CONCURRENCY = 32;
const WRITE_BUFFER_SIZE = 8 * 1024 * 1024;

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[i] = c >>> 0;
}
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function writeU64(view, pos, val) {
  view.setUint32(pos, val >>> 0, true);
  view.setUint32(pos + 4, Math.floor(val / 4294967296) >>> 0, true);
}
async function fetchWithRetry(url, maxRetries = 4) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(18000 + attempt * 8000) });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      if (r.status === 404 || r.status === 403) return null;
    } catch {}
    if (attempt < maxRetries) await new Promise((res) => setTimeout(res, 350 * (attempt + 1)));
  }
  return null;
}

async function main() {
  console.log('1/3 Baixando manifesto oficial de naruto.jotagame.com...');
  const html = await (await fetch('https://naruto.jotagame.com/jogar?app=1', { signal: AbortSignal.timeout(20000) })).text();
  const rec = JSON.parse(html.match(/window\\.__VDF_RECURSOS__\\s*=\\s*(\\{[^;]+\\})/)[1]);
  const manData = await (await fetch(CDN + rec.manifesto, { signal: AbortSignal.timeout(30000) })).json();
  const arquivos = manData.arquivos || [];

  let offset = 0;
  let entries = [];
  let resuming = false;
  let fd;

  if (fs.existsSync(CKPT_FILE) && fs.existsSync(OUT_ZIP)) {
    const ck = JSON.parse(fs.readFileSync(CKPT_FILE, 'utf8'));
    const st = fs.statSync(OUT_ZIP);
    if (st.size >= ck.offset && Array.isArray(ck.entries)) {
      offset = ck.offset;
      entries = ck.entries;
      resuming = true;
      fd = fs.openSync(OUT_ZIP, 'r+');
      fs.ftruncateSync(fd, offset);
      console.log(\`Retomando checkpoint salvo: \${entries.length} arquivos (\${(offset / 1073741824).toFixed(2)} GB) já gravados!\`);
    }
  }
  if (!resuming) {
    fd = fs.openSync(OUT_ZIP, 'w');
  }

  let outBuf = Buffer.allocUnsafe(WRITE_BUFFER_SIZE);
  let outUsed = 0;
  let filePos = offset;
  function flushOut() {
    if (outUsed === 0) return;
    fs.writeSync(fd, outBuf, 0, outUsed, filePos);
    filePos += outUsed;
    outUsed = 0;
  }
  function writeBuffered(chunk) {
    if (chunk.length >= WRITE_BUFFER_SIZE) {
      flushOut();
      fs.writeSync(fd, chunk, 0, chunk.length, filePos);
      filePos += chunk.length;
      return;
    }
    if (outUsed + chunk.length > WRITE_BUFFER_SIZE) flushOut();
    chunk.copy(outBuf, outUsed);
    outUsed += chunk.length;
  }
  function writeEntry(relPath, buf) {
    const clean = relPath.replace(/^\\/+/, '');
    const nameBytes = Buffer.from(clean, 'utf8');
    const size = buf.length;
    const crc = crc32(buf);
    const entryOffset = offset;
    const header = Buffer.alloc(30 + nameBytes.length);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(0, 8); // STORE
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0x5421, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(size, 18);
    header.writeUInt32LE(size, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28);
    nameBytes.copy(header, 30);
    writeBuffered(header);
    if (size > 0) writeBuffered(buf);
    offset += header.length + size;
    entries.push({ path: clean, crc, size, offset: entryOffset });
  }
  function saveCkpt() {
    flushOut();
    fs.writeFileSync(CKPT_FILE, JSON.stringify({ offset, entries }));
  }

  let stopRequested = false;
  process.on('SIGINT', () => {
    if (stopRequested) process.exit(1);
    stopRequested = true;
    console.log('\\nPausando com segurança e salvando checkpoint...');
  });

  if (!resuming) {
    writeEntry('manifesto.json', Buffer.from(JSON.stringify(manData), 'utf8'));
  }

  const doneSet = new Set(entries.map((e) => e.path));
  const pending = arquivos.filter((f) => !doneSet.has(f.url.replace(/^\\/+/, '')));
  console.log(\`2/3 Baixando \${pending.length} arquivos restantes com \${CONCURRENCY} conexões paralelas...\`);

  let cursor = 0;
  let sessionDone = 0;
  let sessionBytes = 0;
  let failed = 0;
  const t0 = Date.now();
  const totalBytesAll = arquivos.reduce((s, f) => s + (f.bytes || 0), 0);

  async function worker() {
    while (!stopRequested) {
      const idx = cursor++;
      if (idx >= pending.length) return;
      const f = pending[idx];
      const buf = await fetchWithRetry(CDN + f.url);
      if (stopRequested) return;
      if (buf) {
        writeEntry(f.url, buf);
        sessionBytes += buf.length;
      } else {
        failed++;
      }
      sessionDone++;
      if (sessionDone % 500 === 0) {
        saveCkpt();
        const sec = Math.max(0.5, (Date.now() - t0) / 1000);
        const mbps = (sessionBytes / 1048576 / sec).toFixed(1);
        const gb = (offset / 1073741824).toFixed(2);
        const remBytes = Math.max(0, totalBytesAll - offset);
        const etaMin = sessionBytes > 0 ? Math.round(remBytes / (sessionBytes / sec) / 60) : '?';
        console.log(\`Progresso: \${entries.length}/\${arquivos.length} | \${gb} GB | \${mbps} MB/s | ETA ~\${etaMin} min | falhas: \${failed}\`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, pending.length)) }, () => worker()));

  if (stopRequested) {
    saveCkpt();
    fs.closeSync(fd);
    console.log(\`Checkpoint salvo em \${CKPT_FILE} (\${(offset / 1073741824).toFixed(2)} GB). Execute novamente para continuar exatamente de onde parou!\`);
    return;
  }

  console.log('3/3 Finalizando índice ZIP64 Central Directory...');
  const cdStart = offset;
  let cdSize = 0;
  for (const e of entries) {
    const nameBytes = Buffer.from(e.path, 'utf8');
    const needOff64 = e.offset >= 0xffffffff;
    const extraLen = needOff64 ? 12 : 0;
    const recBuf = Buffer.alloc(46 + nameBytes.length + extraLen);
    const v = new DataView(recBuf.buffer, recBuf.byteOffset, recBuf.byteLength);
    v.setUint32(0, 0x02014b50, true);
    v.setUint16(4, 45, true);
    v.setUint16(6, needOff64 ? 45 : 20, true);
    v.setUint16(8, 0x0800, true);
    v.setUint16(10, 0, true);
    v.setUint16(14, 0x5421, true);
    v.setUint32(16, e.crc, true);
    v.setUint32(20, e.size, true);
    v.setUint32(24, e.size, true);
    v.setUint16(28, nameBytes.length, true);
    v.setUint16(30, extraLen, true);
    v.setUint32(42, needOff64 ? 0xffffffff : e.offset, true);
    nameBytes.copy(recBuf, 46);
    if (needOff64) {
      const ep = 46 + nameBytes.length;
      v.setUint16(ep, 0x0001, true);
      v.setUint16(ep + 2, 8, true);
      writeU64(v, ep + 4, e.offset);
    }
    writeBuffered(recBuf);
    cdSize += recBuf.length;
  }

  const count = entries.length;
  const z64Off = cdStart + cdSize;
  const z64 = Buffer.alloc(76);
  const zv = new DataView(z64.buffer, z64.byteOffset, z64.byteLength);
  zv.setUint32(0, 0x06064b50, true);
  writeU64(zv, 4, 44);
  zv.setUint16(12, 45, true);
  zv.setUint16(14, 45, true);
  writeU64(zv, 24, count);
  writeU64(zv, 32, count);
  writeU64(zv, 40, cdSize);
  writeU64(zv, 48, cdStart);
  zv.setUint32(56, 0x07064b50, true);
  writeU64(zv, 64, z64Off);
  zv.setUint32(72, 1, true);
  writeBuffered(z64);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(count >= 0xffff ? 0xffff : count, 8);
  eocd.writeUInt16LE(count >= 0xffff ? 0xffff : count, 10);
  eocd.writeUInt32LE(cdSize >= 0xffffffff ? 0xffffffff : cdSize, 12);
  eocd.writeUInt32LE(cdStart >= 0xffffffff ? 0xffffffff : cdStart, 16);
  writeBuffered(eocd);
  flushOut();
  fs.closeSync(fd);
  if (fs.existsSync(CKPT_FILE)) fs.unlinkSync(CKPT_FILE);
  console.log(\`Backup ZIP64 único concluído! (\${(offset / 1073741824).toFixed(2)} GB | \${entries.length} arquivos | falhas: \${failed})\`);
}
main();
`;
  const blob = new Blob([script], { type: 'application/javascript;charset=utf-8' });
  triggerBlobDownload(blob, 'gerar_backup_unico_zip64.mjs');
}

export function downloadMirrorScriptFile(catalog: FullCatalog): void {
  downloadMirrorZip64ScriptFile(catalog);
}
