import type {
  Anim2DBundle,
  Anim2DInspectionResult,
  AssetFileRef,
  AudioRecord,
  CatalogSummary,
  ItemRecord,
  ManifestFile,
  NinjaRecord,
  PaginatedResponse,
  SkillRecord,
  SpineAtlasRegion,
  SpineBundle,
  SpineInspectionResult,
  SummonRecord,
  VideoRecord,
} from '../types';

const SUMMON_NAME_MAP: Array<[RegExp, string]> = [
  [/Dakuoyu/i, 'Katsuyu (Lesma Gigante)'],
  [/Hamaxianren|hmxr/i, 'Gama Sennin (Sapo Eremita)'],
  [/hamalong|0HMLstp/i, 'Gamahiro (Sapo Espadachim)'],
  [/HAMAYIN/i, 'Gamatora (Sapo Pergaminho)'],
  [/hamaji|hmj/i, 'Gamakichi'],
  [/Qingshe/i, 'Aoda (Serpente Azul)'],
  [/wanshe/i, 'Manda (Serpente Gigante)'],
  [/jushe/i, 'Serpente Colossal'],
  [/luoshengmen/i, 'Portão Rashōmon'],
  [/sanchongmen/i, 'Rashōmon Triplo'],
  [/wuchongmen/i, 'Rashōmon Quíntuplo'],
  [/SHANJIAOYU/i, 'Ibuse (Salamandra)'],
  [/shayu/i, 'Tubarão Gigante'],
  [/Xiaojiuwei/i, 'Mini Kurama (Nove Caudas)'],
  [/Wugong/i, 'Centopeia Gigante'],
  [/Zhizhu/i, 'Aranha Gigante'],
  [/qilin/i, 'Kirin'],
  [/renyuan/i, 'Rei Macaco Enma'],
  [/mengmo/i, 'Baku (Devorador de Sonhos)'],
  [/pak/i, 'Pakkun'],
  [/pangxie/i, 'Caranguejo Gigante'],
  [/renmao/i, 'Gato Ninja (Ninken)'],
  [/yaohu/i, 'Raposa Demoníaca'],
  [/lianyou/i, 'Kamatari (Doninha do Vento)'],
  [/shenzuoshuizhan/i, 'Invocação Corte Aquático'],
  [/shuangren/i, 'Invocação Lâminas Duplas'],
  [/jiaosha/i, 'Tubarão Devorador'],
  [/longjiao/i, 'Dragão Chifrudo'],
  [/xiba/i, 'Sapo das Chamas'],
  [/bcn/i, 'Besta Invocada BCN'],
  [/bh$/i, 'Tigre Branco'],
  [/bsl/i, 'Dragão Branco'],
  [/bs$/i, 'Serpente Branca'],
  [/gn$/i, 'Touro Gigante'],
  [/hw$/i, 'Rei Sapo'],
  [/jsl/i, 'Dragão Dourado'],
  [/jy$/i, 'Águia Gigante'],
  [/ls$/i, 'Leão Invocado'],
  [/mhw/i, 'Cão Ninja'],
  [/rg$/i, 'Cão de Batalha'],
  [/shen$/i, 'Estátua Gedō Mazō'],
  [/stg/i, 'Cão de Três Cabeças'],
  [/tt$/i, 'Tartaruga Ninja (Ningame)'],
  [/wy$/i, 'Corvo das Sombras'],
  [/xn$/i, 'Rinoceronte Gigante'],
  [/ywsp/i, 'Camaleão Gigante'],
  [/zcm/i, 'Gato da Fortuna'],
];

const STATUS_EFFECT_PATTERNS: Array<[RegExp, string]> = [
  [/Flutuaç[ãa]o|Flutuar/i, 'Flutuação'],
  [/Queda/i, 'Queda'],
  [/Voo|Repelir/i, 'Voo / Repulsão'],
  [/Queimadura|Chamas|Fogo/i, 'Queimadura'],
  [/Veneno|Envenen/i, 'Veneno'],
  [/Imobilidade|Paralis/i, 'Imobilidade'],
  [/Confus[ãa]o|Caos/i, 'Confusão'],
  [/Cura|Recupera.*vida|HP/i, 'Cura'],
  [/Escudo|Barreira/i, 'Escudo'],
  [/Chakra/i, 'Chakra'],
  [/Clone/i, 'Invoca Clone'],
  [/Selamento|Sela/i, 'Selamento'],
  [/Cegueira/i, 'Cegueira'],
  [/Purifica|remoç[ãa]o de debuff/i, 'Purificação'],
  [/Cr[íi]tico/i, 'Crítico'],
  [/Interrompe|Cancelar/i, 'Interrupção'],
];

export interface StudioSnapshot {
  sourceUrl: string;
  cdnBase: string;
  build: string;
  dataBuild: string;
  manifestFile: string;
  syncedAt: string;
  estudio: {
    herois?: Record<string, Record<string, unknown>>;
    skills?: Record<string, { name?: string; desc?: string }>;
    textos?: Record<string, string>;
    itens?: Record<string, { functiondesc?: string; name?: string }>;
  };
}

export interface FullCatalog {
  summary: CatalogSummary;
  ninjas: NinjaRecord[];
  ninjaMap: Map<string, NinjaRecord>;
  summons: SummonRecord[];
  summonMap: Map<string, SummonRecord>;
  summonFragments: AssetFileRef[];
  spineModels: SpineBundle[];
  spineMap: Map<string, SpineBundle>;
  anim2d: Anim2DBundle[];
  anim2dMap: Map<string, Anim2DBundle>;
  videos: VideoRecord[];
  videoMap: Map<string, VideoRecord>;
  skillIcons: AssetFileRef[];
  audio: AudioRecord[];
  audioMap: Map<string, AudioRecord>;
  techniques: SkillRecord[];
  items: ItemRecord[];
  rawArquivos: ManifestFile[];
}

function toAssetRef(f: ManifestFile, category?: string): AssetFileRef {
  const name = f.url.split('/').pop() || f.url;
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  return { url: f.url, name, ext, bytes: f.bytes || 0, category };
}

function classifySkillType(slotCode: string): SkillRecord['skillType'] {
  if (/^a\d/i.test(slotCode)) return 'Esotérica';
  if (/^n\d/i.test(slotCode)) return 'Ataque Básico';
  if (/^c\d/i.test(slotCode)) return 'Perseguição';
  if (/^p\d/i.test(slotCode)) return 'Passiva';
  if (/^s\d/i.test(slotCode)) return 'Especial';
  return 'Outro';
}

function resolveSummonName(rawCode: string): string {
  for (const [re, label] of SUMMON_NAME_MAP) {
    if (re.test(rawCode)) return label;
  }
  return rawCode
    .replace(/^noe_/i, '')
    .replace(/^TONGLINGSHOU/i, 'Invocação ')
    .replace(/_/g, ' ')
    .trim();
}

function posixDirname(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx === -1 ? '' : p.slice(0, idx);
}

function posixJoin(dir: string, file: string): string {
  if (!dir) return file;
  return `${dir.replace(/\/+$/, '')}/${file.replace(/^\/+/, '')}`;
}

export function buildCatalog(
  snapshot: StudioSnapshot,
  manifestVersion: string,
  arquivos: ManifestFile[]
): FullCatalog {
  const { estudio, cdnBase } = snapshot;
  const heroisMeta = estudio.herois || {};
  const skillsMeta = estudio.skills || {};
  const textosMeta = estudio.textos || {};
  const itensMeta = estudio.itens || {};

  let totalBytes = 0;

  const heroPortraitFiles = new Map<string, AssetFileRef[]>();
  const heroBannerFiles = new Map<string, AssetFileRef[]>();
  const heroSmallPicMap = new Map<string, AssetFileRef[]>();
  const spineGroupMap = new Map<string, { kind: SpineBundle['kind']; files: AssetFileRef[] }>();
  const summonSpineFiles = new Map<string, AssetFileRef[]>();
  const summonEffectWebps: AssetFileRef[] = [];
  const summonFragments: AssetFileRef[] = [];
  const anim2dAtlasMap = new Map<string, AssetFileRef>();
  const anim2dImgMap = new Map<string, AssetFileRef[]>();
  const videos: VideoRecord[] = [];
  const skillIcons: AssetFileRef[] = [];
  const audio: AudioRecord[] = [];
  const itemIcons = new Map<string, string>();

  for (const f of arquivos) {
    totalBytes += f.bytes || 0;
    const url = f.url;

    const heroMatch = url.match(/^acervo\/asset\/heros\/(\d+)\/(.+)$/);
    if (heroMatch) {
      const heroId = heroMatch[1];
      const list = heroPortraitFiles.get(heroId) || [];
      list.push(toAssetRef(f, 'retrato'));
      heroPortraitFiles.set(heroId, list);
      continue;
    }

    const ptHeroMatch = url.match(/^acervo\/language\/pt\/asset\/heros\/(\d+)\/(.+)$/);
    if (ptHeroMatch) {
      const heroId = ptHeroMatch[1];
      const list = heroBannerFiles.get(heroId) || [];
      list.push(toAssetRef(f, 'banner_pt'));
      heroBannerFiles.set(heroId, list);
      continue;
    }

    const newNameMatch = url.match(/^acervo\/language\/pt\/asset\/heros\/Newname\/newnamepic_(\d+)\.(webp|png)$/i);
    if (newNameMatch) {
      const heroId = newNameMatch[1];
      const list = heroBannerFiles.get(heroId) || [];
      list.push(toAssetRef(f, 'banner_pt'));
      heroBannerFiles.set(heroId, list);
      continue;
    }

    if (url.startsWith('acervo/asset/items/')) {
      const fname = url.slice('acervo/asset/items/'.length);
      const smallMatch = fname.match(/^smallpic_(\d+)\.(webp|png)$/i);
      if (smallMatch) {
        const heroId = smallMatch[1];
        const list = heroSmallPicMap.get(heroId) || [];
        list.push(toAssetRef(f, 'smallpic'));
        heroSmallPicMap.set(heroId, list);
        continue;
      }
      if (/^(skill_|EsoSkill_)/i.test(fname) && fname.endsWith('.webp')) {
        skillIcons.push(toAssetRef(f, 'icone_habilidade'));
        continue;
      }
      const itemIconMatch = fname.match(/^item_(\d+)\.webp$/i);
      if (itemIconMatch) {
        itemIcons.set(itemIconMatch[1], url);
      }
      continue;
    }

    if (url.startsWith('acervo/asset/spine-hd/') && !url.endsWith('indice.json')) {
      const fname = url.slice('acervo/asset/spine-hd/'.length);
      const isImg = /\.(webp|png)$/i.test(fname);
      let base = fname.replace(/(\.leve)?\.(json|atlas|webp|png)$/i, '');
      if (isImg) base = base.replace(/_([2-9]|[1-2]\d)$/, '');
      const key = `hd:${base}`;
      const entry = spineGroupMap.get(key) || { kind: 'hd', files: [] };
      entry.files.push(toAssetRef(f, 'spine_hd'));
      spineGroupMap.set(key, entry);
      continue;
    }

    if (url.startsWith('acervo/asset/spine-invocacoes/')) {
      const fname = url.slice('acervo/asset/spine-invocacoes/'.length);
      if (fname.startsWith('noe_')) {
        const base = fname.replace(/\.(json|atlas)$/i, '');
        const list = summonSpineFiles.get(base) || [];
        list.push(toAssetRef(f, 'invocacao'));
        summonSpineFiles.set(base, list);
      } else if (fname.endsWith('.webp') || fname.endsWith('.png')) {
        summonEffectWebps.push(toAssetRef(f, 'invocacao_sprite'));
      }
      continue;
    }

    if (url.startsWith('acervo/asset/invocacao/v1/fragmento_')) {
      summonFragments.push(toAssetRef(f, 'fragmento_invocacao'));
      continue;
    }

    if (url.startsWith('acervo/asset/spine/')) {
      const fname = url.slice('acervo/asset/spine/'.length);
      if (fname.includes('/')) continue;
      const isImg = /\.(webp|png)$/i.test(fname);
      let base = fname
        .replace(/\.leve\.(atlas|webp|png)$/i, '')
        .replace(/\.(json|atlas|webp|png)$/i, '');
      if (isImg) base = base.replace(/_([2-9]|[1-2]\d)$/, '');
      let kind: SpineBundle['kind'] = 'personagem';
      if (/_effect$/i.test(base) || /efeito/i.test(base)) kind = 'efeito';
      else if (/lihui\d*$/i.test(base)) kind = 'retrato';
      else if (/texie\d*$/i.test(base)) kind = 'esoterica';
      else if (/_ground$/i.test(base)) kind = 'cenario';
      else if (/_pintura$/i.test(base)) kind = 'pintura';

      const key = `sp:${base}`;
      const entry = spineGroupMap.get(key) || { kind, files: [] };
      entry.files.push(toAssetRef(f, `spine_${kind}`));
      spineGroupMap.set(key, entry);
      continue;
    }

    if (url.startsWith('dados/atlas/asset/anim/') && url.endsWith('.json')) {
      const base = url.slice('dados/atlas/asset/anim/'.length, -5);
      anim2dAtlasMap.set(base, toAssetRef(f, 'anim2d_atlas'));
      continue;
    }

    if (url.startsWith('acervo/asset/anim/')) {
      const fname = url.slice('acervo/asset/anim/'.length);
      const base = fname.replace(/(-sg)?\.(webp|png)$/i, '');
      const list = anim2dImgMap.get(base) || [];
      list.push(toAssetRef(f, 'anim2d_sprite'));
      anim2dImgMap.set(base, list);
      continue;
    }

    if (url.startsWith('acervo/video/') && url.endsWith('.mp4')) {
      const filename = url.split('/').pop() || url;
      const base = filename.replace(/\.mp4$/i, '');
      const kind: VideoRecord['kind'] = /aoyi/i.test(base)
        ? 'esoterica'
        : /texie/i.test(base)
        ? 'close_up'
        : 'outro';
      videos.push({ id: base, filename, url, kind, bytes: f.bytes || 0 });
      continue;
    }

    if (url.startsWith('acervo/som/') && /\.(mp3|ogg|wav)$/i.test(url)) {
      const filename = url.split('/').pop() || url;
      let category: AudioRecord['category'] = 'efeitos_habilidades';
      let categoryLabel = 'Efeitos e Habilidades';
      let heroId: string | null = null;

      if (url.startsWith('acervo/som/lines/')) {
        category = 'dublagem_falas';
        categoryLabel = 'Dublagem (Falas)';
        const m = filename.match(/lines_(\d+)/);
        if (m) heroId = m[1];
      } else if (url.startsWith('acervo/som/AFaoyi/')) {
        category = 'dublagem_esoterica';
        categoryLabel = 'Dublagem (Esotérica)';
        const m = filename.match(/^(\d+)_/);
        if (m) heroId = m[1];
      } else if (url.startsWith('acervo/som/Die/')) {
        category = 'dublagem_derrota';
        categoryLabel = 'Dublagem (Derrota)';
        const m = filename.match(/(\d{5,8})/);
        if (m) heroId = m[1];
      } else if (url.startsWith('acervo/som/HYstory/')) {
        category = 'dublagem_historia';
        categoryLabel = 'Dublagem (História)';
      } else if (url.startsWith('acervo/som/nos/')) {
        category = 'vozes_combate';
        categoryLabel = 'Vozes de Combate';
      } else {
        const m = filename.match(/^(\d{5,8})_/);
        if (m) heroId = m[1];
      }

      audio.push({
        id: url.replace(/^acervo\/som\//, '').replace(/\.(mp3|ogg|wav)$/i, '').replace(/\//g, '__'),
        filename,
        url,
        category,
        categoryLabel,
        heroId,
        heroName: null,
        bytes: f.bytes || 0,
      });
    }
  }

  const spineModels: SpineBundle[] = [];
  const spineMap = new Map<string, SpineBundle>();
  const heroSpineLookup = new Map<string, SpineBundle[]>();

  for (const [key, entry] of spineGroupMap.entries()) {
    const jsonFile = entry.files.find((x) => x.ext === 'json');
    if (!jsonFile) continue;
    const atlasFile =
      entry.files.find((x) => x.ext === 'atlas' && !x.name.includes('.leve.')) ||
      entry.files.find((x) => x.ext === 'atlas') ||
      null;
    const imageUrls = entry.files
      .filter((x) => x.ext === 'webp' && !x.name.includes('.leve.'))
      .map((x) => x.url);
    const pngUrls = entry.files.filter((x) => x.ext === 'png').map((x) => x.url);
    const finalImgs = imageUrls.length > 0 ? imageUrls : pngUrls;

    const rawId = key.replace(/^(hd|sp):/, '');
    const heroIdMatch = rawId.match(/^vdfnop?_(\d{6})/);
    const heroId = heroIdMatch ? heroIdMatch[1] : null;

    const bundle: SpineBundle = {
      id: key.replace(':', '__'),
      name: rawId,
      kind: entry.kind,
      jsonUrl: jsonFile.url,
      atlasUrl: atlasFile ? atlasFile.url : null,
      imageUrls: finalImgs,
      pngUrls,
      allFiles: entry.files,
      totalBytes: entry.files.reduce((acc, x) => acc + x.bytes, 0),
      heroId,
    };
    spineModels.push(bundle);
    spineMap.set(bundle.id, bundle);

    if (heroId) {
      const list = heroSpineLookup.get(heroId) || [];
      list.push(bundle);
      heroSpineLookup.set(heroId, list);
    }
  }

  const summons: SummonRecord[] = [];
  const summonMap = new Map<string, SummonRecord>();
  for (const [base, files] of summonSpineFiles.entries()) {
    const jsonFile = files.find((x) => x.ext === 'json');
    const atlasFile = files.find((x) => x.ext === 'atlas') || null;
    if (!jsonFile) continue;
    const stem = base.replace(/^noe_/i, '');
    const matchingImages = summonEffectWebps.filter((img) => {
      const imgStem = img.name
        .replace(/^efeito_/i, '')
        .replace(/(_\d+)?\.(webp|png)$/i, '');
      return imgStem.toLowerCase() === stem.toLowerCase();
    });
    const allFiles = [...files, ...matchingImages];
    const imageUrls = matchingImages.map((x) => x.url);
    const bundle: SpineBundle = {
      id: `inv__${base}`,
      name: base,
      kind: 'invocacao',
      jsonUrl: jsonFile.url,
      atlasUrl: atlasFile ? atlasFile.url : null,
      imageUrls,
      pngUrls: [],
      allFiles,
      totalBytes: allFiles.reduce((acc, x) => acc + x.bytes, 0),
    };
    spineMap.set(bundle.id, bundle);

    const summon: SummonRecord = {
      id: base,
      rawCode: stem,
      name: resolveSummonName(stem),
      spine: bundle,
      previewUrl: imageUrls[0] || null,
      totalBytes: bundle.totalBytes,
      fileCount: allFiles.length,
    };
    summons.push(summon);
    summonMap.set(summon.id, summon);
  }
  summons.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  const anim2d: Anim2DBundle[] = [];
  const anim2dMap = new Map<string, Anim2DBundle>();
  for (const [base, atlasFile] of anim2dAtlasMap.entries()) {
    const imgs = anim2dImgMap.get(base) || [];
    const webp = imgs.find((x) => x.ext === 'webp' && !x.name.includes('-sg')) || imgs.find((x) => x.ext === 'webp');
    const png = imgs.find((x) => x.ext === 'png' && !x.name.includes('-sg')) || imgs.find((x) => x.ext === 'png');
    const allFiles = [atlasFile, ...imgs];
    const bundle: Anim2DBundle = {
      id: base,
      name: base.replace(/image$/i, ''),
      atlasJsonUrl: atlasFile.url,
      imageUrl: webp?.url || png?.url || null,
      pngUrl: png?.url || null,
      allFiles,
      totalBytes: allFiles.reduce((acc, x) => acc + x.bytes, 0),
    };
    anim2d.push(bundle);
    anim2dMap.set(bundle.id, bundle);
  }
  anim2d.sort((a, b) => a.name.localeCompare(b.name));

  const allHeroIds = new Set<string>([
    ...heroPortraitFiles.keys(),
    ...Object.keys(heroisMeta),
    ...heroSpineLookup.keys(),
  ]);

  const heroNameMap = new Map<string, { name: string; official: boolean }>();
  for (const id of allHeroIds) {
    const meta = heroisMeta[id] || {};
    const directName =
      (typeof meta.name === 'string' && meta.name.trim()) ||
      (typeof textosMeta[`HeroBase_${id}_name`] === 'string' && textosMeta[`HeroBase_${id}_name`].trim()) ||
      '';
    if (directName) {
      heroNameMap.set(id, { name: directName, official: true });
      continue;
    }
    const rawDesc =
      (typeof meta.desc === 'string' && meta.desc) ||
      (typeof textosMeta[`HeroBase_${id}_desc`] === 'string' && textosMeta[`HeroBase_${id}_desc`]) ||
      '';
    const firstLine = rawDesc.split('\n')[0]?.trim() || '';
    if (firstLine && firstLine.length <= 42 && /\[.+\]/.test(firstLine) && !/Persegue|Causa|Ajustar/i.test(firstLine)) {
      heroNameMap.set(id, { name: firstLine, official: true });
    } else {
      heroNameMap.set(id, { name: `Ninja #${id}`, official: false });
    }
  }

  const heroSkillsLookup = new Map<string, SkillRecord[]>();
  const techniques: SkillRecord[] = [];
  for (const [skillId, sData] of Object.entries(skillsMeta)) {
    const m = skillId.match(/^hero(\d+)_([a-z0-9]+)$/i);
    let heroId: string | null = null;
    let slotCode = skillId;
    if (m) {
      const num = m[1];
      slotCode = m[2];
      const candidate6 = num.length >= 6 ? num : `100${num.padStart(3, '0')}`;
      if (allHeroIds.has(candidate6)) heroId = candidate6;
      else if (allHeroIds.has(num)) heroId = num;
      else heroId = candidate6;
    }

    const desc = (sData?.desc || '').trim();
    const skillType = classifySkillType(slotCode);
    const multipliers = [...new Set((desc.match(/\d+(?:[.,]\d+)?%/g) || []).slice(0, 6))];
    const effects = STATUS_EFFECT_PATTERNS.filter(([re]) => re.test(desc)).map(([, label]) => label);
    const resolvedHeroName = heroId ? heroNameMap.get(heroId)?.name || `Ninja #${heroId}` : null;

    const rec: SkillRecord = {
      id: skillId,
      heroId,
      heroName: resolvedHeroName,
      slotCode,
      skillType,
      name: (sData?.name || '').trim() || `${skillType} (${skillId})`,
      desc,
      multipliers,
      effects,
    };
    techniques.push(rec);
    if (heroId) {
      const list = heroSkillsLookup.get(heroId) || [];
      list.push(rec);
      heroSkillsLookup.set(heroId, list);
    }
  }
  techniques.sort((a, b) => a.id.localeCompare(b.id));

  const heroAudioLookup = new Map<string, AudioRecord[]>();
  for (const a of audio) {
    if (a.heroId) {
      a.heroName = heroNameMap.get(a.heroId)?.name || `Ninja #${a.heroId}`;
      const list = heroAudioLookup.get(a.heroId) || [];
      list.push(a);
      heroAudioLookup.set(a.heroId, list);
    }
  }

  const ninjas: NinjaRecord[] = [];
  const ninjaMap = new Map<string, NinjaRecord>();

  for (const id of allHeroIds) {
    const meta = heroisMeta[id] || {};
    const nameInfo = heroNameMap.get(id) || { name: `Ninja #${id}`, official: false };
    const portraits = [...(heroPortraitFiles.get(id) || []), ...(heroSmallPicMap.get(id) || [])];
    const bannersPt = heroBannerFiles.get(id) || [];
    const spineBundles = heroSpineLookup.get(id) || [];
    const audioFiles = heroAudioLookup.get(id) || [];
    const skills = heroSkillsLookup.get(id) || [];

    const pickImg = (prefix: string) =>
      portraits.find((p) => p.name.toLowerCase().startsWith(prefix.toLowerCase()) && p.ext === 'webp')?.url ||
      portraits.find((p) => p.name.toLowerCase().startsWith(prefix.toLowerCase()))?.url ||
      null;

    const avatarUrl =
      pickImg('smallpic_') || pickImg('middlepic_') || pickImg('halfpic_') || pickImg('Atlaspic_') || portraits[0]?.url || null;
    const portraitUrl =
      pickImg('largepic_') || pickImg('showpic_') || pickImg('halfpic_') || pickImg('Atlaspic_') || avatarUrl;
    const nameBannerUrl =
      bannersPt.find((b) => /newnamepic_|namepic_/i.test(b.name) && b.ext === 'webp')?.url ||
      bannersPt[0]?.url ||
      null;
    const skillBannerUrl =
      bannersPt.find((b) => /skillnamepic_/i.test(b.name) && b.ext === 'webp')?.url || null;

    const allBytes =
      portraits.reduce((s, x) => s + x.bytes, 0) +
      bannersPt.reduce((s, x) => s + x.bytes, 0) +
      spineBundles.reduce((s, x) => s + x.totalBytes, 0) +
      audioFiles.reduce((s, x) => s + x.bytes, 0);

    const fileCount =
      portraits.length +
      bannersPt.length +
      spineBundles.reduce((s, x) => s + x.allFiles.length, 0) +
      audioFiles.length;

    const rawDesc =
      (typeof meta.desc === 'string' && meta.desc.trim()) ||
      (typeof textosMeta[`HeroBase_${id}_desc`] === 'string' && textosMeta[`HeroBase_${id}_desc`].trim()) ||
      null;

    const ninja: NinjaRecord = {
      id,
      shortId: id.replace(/^100/, ''),
      name: nameInfo.name,
      hasOfficialName: nameInfo.official,
      role: typeof meta.type === 'string' ? meta.type : null,
      growvalue: typeof meta.growvalue === 'number' ? meta.growvalue : null,
      leveluprate: typeof meta.leveluprate === 'number' ? meta.leveluprate : null,
      ifHidden: typeof meta.ifHidden === 'number' ? meta.ifHidden : null,
      desc: rawDesc,
      avatarUrl,
      portraitUrl,
      nameBannerUrl,
      skillBannerUrl,
      portraits,
      bannersPt,
      spineBundles,
      audioFiles,
      skills,
      hasHdSpine: spineBundles.some((s) => s.kind === 'hd'),
      hasBattleSpine: spineBundles.some((s) => s.kind === 'personagem'),
      fileCount,
      totalBytes: allBytes,
    };

    ninjas.push(ninja);
    ninjaMap.set(id, ninja);
  }

  ninjas.sort((a, b) => {
    const scoreA =
      (a.hasOfficialName ? 1000 : 0) +
      (a.skills.length > 0 ? 500 : 0) +
      (a.hasHdSpine ? 250 : 0) +
      (a.audioFiles.length > 0 ? 100 : 0);
    const scoreB =
      (b.hasOfficialName ? 1000 : 0) +
      (b.skills.length > 0 ? 500 : 0) +
      (b.hasHdSpine ? 250 : 0) +
      (b.audioFiles.length > 0 ? 100 : 0);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return Number(a.id) - Number(b.id);
  });

  const items: ItemRecord[] = Object.entries(itensMeta).map(([id, data]) => ({
    id,
    desc: data?.functiondesc || data?.name || '',
    iconUrl: itemIcons.get(id) || null,
  }));

  const audioByCategory: Record<string, number> = {};
  for (const a of audio) {
    audioByCategory[a.category] = (audioByCategory[a.category] || 0) + 1;
  }

  const spineByKind: Record<string, number> = {};
  for (const s of spineModels) {
    spineByKind[s.kind] = (spineByKind[s.kind] || 0) + 1;
  }

  const videoMap = new Map(videos.map((v) => [v.id, v]));
  const audioMap = new Map(audio.map((a) => [a.id, a]));

  const summary: CatalogSummary = {
    sourceUrl: snapshot.sourceUrl || 'https://naruto.jotagame.com/',
    cdnBase,
    build: snapshot.build,
    dataBuild: snapshot.dataBuild,
    manifestVersion,
    syncedAt: snapshot.syncedAt,
    totalFiles: arquivos.length,
    totalBytes,
    counts: {
      ninjas: ninjas.length,
      ninjasWithStats: ninjas.filter((n) => n.growvalue !== null || n.role !== null || n.skills.length > 0).length,
      ninjasWithHdSpine: ninjas.filter((n) => n.hasHdSpine).length,
      summons: summons.length,
      summonFragments: summonFragments.length,
      spineModels: spineModels.length,
      spineEffects: spineModels.filter((s) => s.kind === 'efeito').length,
      anim2d: anim2d.length,
      videos: videos.length,
      skillIcons: skillIcons.length,
      audio: audio.length,
      techniques: techniques.length,
      items: items.length,
    },
    audioByCategory,
    spineByKind,
  };

  return {
    summary,
    ninjas,
    ninjaMap,
    summons,
    summonMap,
    summonFragments,
    spineModels,
    spineMap,
    anim2d,
    anim2dMap,
    videos,
    videoMap,
    skillIcons,
    audio,
    audioMap,
    techniques,
    items,
    rawArquivos: arquivos,
  };
}

export async function loadStaticCatalog(
  onStage?: (stage: string) => void
): Promise<FullCatalog> {
  onStage?.('Lendo snapshot estático do acervo...');
  const rawHref = window.location.href;
  const baseHref =
    window.location.pathname.endsWith('/') || window.location.pathname.endsWith('.html')
      ? rawHref
      : `${window.location.origin}${window.location.pathname}/${window.location.search}`;
  const snapUrl = new URL('./data/studio-snapshot.json', baseHref).toString();
  const snapRes = await fetch(snapUrl);
  if (!snapRes.ok) {
    throw new Error(`Snapshot estático não encontrado (${snapRes.status}).`);
  }
  const snapshot = (await snapRes.json()) as StudioSnapshot;

  onStage?.('Baixando manifesto oficial do CDN (80.000+ arquivos)...');
  const manifestUrl = `${snapshot.cdnBase}${snapshot.manifestFile}`;
  const manRes = await fetch(manifestUrl);
  if (!manRes.ok) {
    throw new Error(`Falha ao baixar manifesto do CDN (HTTP ${manRes.status}).`);
  }
  const manData = (await manRes.json()) as { versao?: string; arquivos?: ManifestFile[] };
  const arquivos = Array.isArray(manData.arquivos) ? manData.arquivos : [];

  onStage?.('Indexando ninjas, invocações, Spine, áudios e técnicas...');
  return buildCatalog(snapshot, manData.versao || snapshot.manifestFile, arquivos);
}

export function paginateList<T>(items: T[], page: number, limit: number): PaginatedResponse<T> {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * limit;
  return {
    items: items.slice(start, start + limit),
    total,
    page: safePage,
    limit,
    totalPages,
  };
}

export function queryNinjas(
  catalog: FullCatalog,
  opts: { q: string; role: string; filter: string; sort: string; page: number; limit: number }
): PaginatedResponse<NinjaRecord> {
  const q = opts.q.trim().toLowerCase();
  let list = catalog.ninjas;

  if (q) {
    list = list.filter(
      (n) =>
        n.id.includes(q) ||
        n.name.toLowerCase().includes(q) ||
        (n.desc && n.desc.toLowerCase().includes(q)) ||
        n.skills.some((s) => s.name.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q))
    );
  }

  if (opts.role !== 'all') {
    list = list.filter((n) => (n.role || '').toLowerCase() === opts.role.toLowerCase());
  }

  if (opts.filter === 'named') list = list.filter((n) => n.hasOfficialName);
  else if (opts.filter === 'skills') list = list.filter((n) => n.skills.length > 0);
  else if (opts.filter === 'hd') list = list.filter((n) => n.hasHdSpine);
  else if (opts.filter === 'audio') list = list.filter((n) => n.audioFiles.length > 0);

  if (opts.sort === 'id_asc') list = [...list].sort((a, b) => Number(a.id) - Number(b.id));
  else if (opts.sort === 'id_desc') list = [...list].sort((a, b) => Number(b.id) - Number(a.id));
  else if (opts.sort === 'grow_desc') list = [...list].sort((a, b) => (b.growvalue || 0) - (a.growvalue || 0));
  else if (opts.sort === 'files_desc') list = [...list].sort((a, b) => b.fileCount - a.fileCount);

  return paginateList(list, opts.page, opts.limit);
}

export function querySummons(catalog: FullCatalog, qRaw: string): SummonRecord[] {
  const q = qRaw.trim().toLowerCase();
  if (!q) return catalog.summons;
  return catalog.summons.filter(
    (s) => s.name.toLowerCase().includes(q) || s.rawCode.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)
  );
}

export function querySpines(
  catalog: FullCatalog,
  opts: { q: string; kind: string; page: number; limit: number }
): PaginatedResponse<SpineBundle> {
  const q = opts.q.trim().toLowerCase();
  let list = catalog.spineModels;
  if (opts.kind !== 'all') list = list.filter((s) => s.kind === opts.kind);
  if (q) {
    list = list.filter(
      (s) => s.name.toLowerCase().includes(q) || (s.heroId && s.heroId.includes(q)) || s.kind.includes(q)
    );
  }
  return paginateList(list, opts.page, opts.limit);
}

export function queryAudio(
  catalog: FullCatalog,
  opts: { q: string; category: string; page: number; limit: number }
): PaginatedResponse<AudioRecord> {
  const q = opts.q.trim().toLowerCase();
  let list = catalog.audio;
  if (opts.category !== 'all') list = list.filter((a) => a.category === opts.category);
  if (q) {
    list = list.filter(
      (a) =>
        a.filename.toLowerCase().includes(q) ||
        (a.heroId && a.heroId.includes(q)) ||
        (a.heroName && a.heroName.toLowerCase().includes(q))
    );
  }
  return paginateList(list, opts.page, opts.limit);
}

export function queryTechniques(
  catalog: FullCatalog,
  opts: { q: string; skillType: string; effect: string; page: number; limit: number }
): PaginatedResponse<SkillRecord> {
  const q = opts.q.trim().toLowerCase();
  let list = catalog.techniques;
  if (opts.skillType !== 'all') list = list.filter((t) => t.skillType === opts.skillType);
  if (opts.effect !== 'all') list = list.filter((t) => t.effects.includes(opts.effect));
  if (q) {
    list = list.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.desc.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q) ||
        (t.heroName && t.heroName.toLowerCase().includes(q)) ||
        (t.heroId && t.heroId.includes(q))
    );
  }
  return paginateList(list, opts.page, opts.limit);
}

function parseSpineAtlasText(atlasText: string, baseDirUrl: string) {
  const lines = atlasText.split(/\r?\n/);
  const pages: Array<{ filename: string; imageUrl: string; width: number; height: number }> = [];
  const regions: SpineAtlasRegion[] = [];

  let currentPage = '';
  let currentRegion: SpineAtlasRegion | null = null;
  let expectingPageHeader = true;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      if (currentRegion) {
        regions.push(currentRegion);
        currentRegion = null;
      }
      expectingPageHeader = true;
      continue;
    }

    if (expectingPageHeader && /\.(webp|png|jpg)$/i.test(trimmed)) {
      currentPage = trimmed;
      expectingPageHeader = false;
      pages.push({
        filename: trimmed,
        imageUrl: posixJoin(baseDirUrl, trimmed),
        width: 0,
        height: 0,
      });
      continue;
    }

    if (rawLine.startsWith(' ') || rawLine.startsWith('\t')) {
      const [key, valRaw] = trimmed.split(':').map((s) => s.trim());
      if (!valRaw) continue;
      if (currentRegion) {
        if (key === 'rotate') currentRegion.rotate = valRaw === 'true' || valRaw === '90';
        else if (key === 'xy') {
          const [x, y] = valRaw.split(',').map((n) => parseInt(n.trim(), 10) || 0);
          currentRegion.x = x;
          currentRegion.y = y;
        } else if (key === 'size') {
          const [w, h] = valRaw.split(',').map((n) => parseInt(n.trim(), 10) || 0);
          currentRegion.width = w;
          currentRegion.height = h;
        } else if (key === 'orig') {
          const [w, h] = valRaw.split(',').map((n) => parseInt(n.trim(), 10) || 0);
          currentRegion.origWidth = w;
          currentRegion.origHeight = h;
        } else if (key === 'offset') {
          const [ox, oy] = valRaw.split(',').map((n) => parseInt(n.trim(), 10) || 0);
          currentRegion.offsetX = ox;
          currentRegion.offsetY = oy;
        }
      }
      continue;
    }

    if (trimmed.includes(':')) {
      const [key, valRaw] = trimmed.split(':').map((s) => s.trim());
      if (key === 'size' && pages.length > 0 && !currentRegion) {
        const [w, h] = valRaw.split(',').map((n) => parseInt(n.trim(), 10) || 0);
        pages[pages.length - 1].width = w;
        pages[pages.length - 1].height = h;
      }
      continue;
    }

    if (currentRegion) regions.push(currentRegion);
    currentRegion = {
      name: trimmed,
      page: currentPage,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      origWidth: 0,
      origHeight: 0,
      offsetX: 0,
      offsetY: 0,
      rotate: false,
    };
  }

  if (currentRegion) regions.push(currentRegion);
  return { pages, regions };
}

export async function inspectSpineLive(
  cdnBase: string,
  jsonUrl: string,
  atlasUrl: string | null
): Promise<SpineInspectionResult> {
  const [jsonRes, atlasRes] = await Promise.all([
    fetch(`${cdnBase}${jsonUrl}`),
    atlasUrl ? fetch(`${cdnBase}${atlasUrl}`) : Promise.resolve(null),
  ]);

  if (!jsonRes.ok) {
    throw new Error(`Skeleton Spine indisponível (HTTP ${jsonRes.status}).`);
  }

  const skel = (await jsonRes.json()) as Record<string, any>;
  const baseDir = posixDirname(atlasUrl || jsonUrl);

  let pages: SpineInspectionResult['pages'] = [];
  let regions: SpineAtlasRegion[] = [];
  if (atlasRes && atlasRes.ok) {
    const atlasText = await atlasRes.text();
    const parsed = parseSpineAtlasText(atlasText, baseDir);
    pages = parsed.pages.map((p) => ({
      ...p,
      imageUrl: `${cdnBase}${p.imageUrl}`,
    }));
    regions = parsed.regions;
  }

  const animationsObj = (skel.animations || {}) as Record<string, any>;
  const animations = Object.entries(animationsObj).map(([name, anim]) => {
    let maxTime = 0;
    let keyframeCount = 0;
    const attachmentFrames: Array<{ time: number; slot: string; attachment: string | null }> = [];

    const slotsAnim = anim?.slots || {};
    for (const [slotName, sData] of Object.entries(slotsAnim as Record<string, any>)) {
      if (Array.isArray(sData?.attachment)) {
        for (const kf of sData.attachment) {
          const t = typeof kf.time === 'number' ? kf.time : 0;
          if (t > maxTime) maxTime = t;
          keyframeCount++;
          attachmentFrames.push({ time: t, slot: slotName, attachment: kf.name ?? null });
        }
      }
      if (Array.isArray(sData?.color)) {
        for (const kf of sData.color) {
          if (typeof kf.time === 'number' && kf.time > maxTime) maxTime = kf.time;
          keyframeCount++;
        }
      }
    }

    const bonesAnim = anim?.bones || {};
    for (const bData of Object.values(bonesAnim as Record<string, any>)) {
      for (const track of ['translate', 'rotate', 'scale', 'shear']) {
        if (Array.isArray(bData?.[track])) {
          for (const kf of bData[track]) {
            if (typeof kf.time === 'number' && kf.time > maxTime) maxTime = kf.time;
            keyframeCount++;
          }
        }
      }
    }

    if (Array.isArray(anim?.events)) {
      for (const ev of anim.events) {
        if (typeof ev?.time === 'number' && ev.time > maxTime) maxTime = ev.time;
      }
    }

    attachmentFrames.sort((a, b) => a.time - b.time);
    return { name, duration: Number(maxTime.toFixed(3)), keyframeCount, attachmentFrames };
  });

  const skinsList = Array.isArray(skel.skins)
    ? skel.skins.map((s: any) => s.name || 'default')
    : Object.keys(skel.skins || {});

  return {
    skeleton: skel.skeleton || {},
    bonesCount: Array.isArray(skel.bones) ? skel.bones.length : 0,
    slotsCount: Array.isArray(skel.slots) ? skel.slots.length : 0,
    skins: skinsList,
    animations,
    pages,
    regions,
    rawSkeleton: skel,
  };
}

export async function inspectAnim2DLive(
  cdnBase: string,
  bundle: Anim2DBundle
): Promise<Anim2DInspectionResult> {
  const res = await fetch(`${cdnBase}${bundle.atlasJsonUrl}`);
  if (!res.ok) throw new Error(`Atlas 2D indisponível (HTTP ${res.status}).`);
  const data = (await res.json()) as { frames?: Record<string, any> };
  const framesObj = data.frames || {};
  const frames = Object.entries(framesObj)
    .map(([name, info]) => ({
      name,
      x: info?.frame?.x || 0,
      y: info?.frame?.y || 0,
      w: info?.frame?.w || 0,
      h: info?.frame?.h || 0,
      rotated: Boolean(info?.rotated),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  return {
    imageUrl: bundle.imageUrl ? `${cdnBase}${bundle.imageUrl}` : '',
    frames,
  };
}

export function buildCsvDatabase(catalog: FullCatalog): { ninjasCsv: string; techniquesCsv: string } {
  const esc = (v: unknown) => {
    const s = String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ');
    return `"${s}"`;
  };

  const ninjaHeader = [
    'ID',
    'Nome',
    'Funcao',
    'Crescimento',
    'TaxaNivel',
    'Oculto',
    'SpineHD',
    'SpineBatalha',
    'QtdRetratos',
    'QtdAudios',
    'QtdTecnicas',
    'TotalArquivos',
    'TamanhoBytes',
    'Descricao',
  ].join(',');

  const ninjaRows = catalog.ninjas.map((n) =>
    [
      esc(n.id),
      esc(n.name),
      esc(n.role || ''),
      esc(n.growvalue ?? ''),
      esc(n.leveluprate ?? ''),
      esc(n.ifHidden ?? ''),
      esc(n.hasHdSpine ? 'Sim' : 'Nao'),
      esc(n.hasBattleSpine ? 'Sim' : 'Nao'),
      esc(n.portraits.length),
      esc(n.audioFiles.length),
      esc(n.skills.length),
      esc(n.fileCount),
      esc(n.totalBytes),
      esc(n.desc || ''),
    ].join(',')
  );

  const techHeader = [
    'ID',
    'NinjaID',
    'NinjaNome',
    'Slot',
    'Tipo',
    'Nome',
    'Multiplicadores',
    'Efeitos',
    'Descricao',
  ].join(',');

  const techRows = catalog.techniques.map((t) =>
    [
      esc(t.id),
      esc(t.heroId || ''),
      esc(t.heroName || ''),
      esc(t.slotCode),
      esc(t.skillType),
      esc(t.name),
      esc(t.multipliers.join(' | ')),
      esc(t.effects.join(' | ')),
      esc(t.desc),
    ].join(',')
  );

  return {
    ninjasCsv: [ninjaHeader, ...ninjaRows].join('\n'),
    techniquesCsv: [techHeader, ...techRows].join('\n'),
  };
}
