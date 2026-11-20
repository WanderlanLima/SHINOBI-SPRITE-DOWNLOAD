import type {
  Anim2DBundle,
  Anim2DInspectionResult,
  AssetFileRef,
  AudioRecord,
  CatalogSummary,
  FontAssetRecord,
  ItemRecord,
  ManifestFile,
  NinjaRecord,
  NinjaSkillSlot,
  PaginatedResponse,
  SkillRecord,
  SpineAtlasRegion,
  SpineBundle,
  SpineInspectionResult,
  StatusEffectRecord,
  SummonRecord,
  VideoRecord,
  VisualAssetCategory,
  VisualAssetRecord,
  VisualItemRecord,
} from '../types';
import { resolveCdnUrl } from '../utils/format';
import { fetchAssetText, ZIP_BACKUP_PREFIX } from './assetSource';
import type { RemoteZipReader } from './remoteZipReader';

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

const STATUS_SPINE_NAME_MAP: Array<[RegExp, string, string]> = [
  [/dianran/i, 'Queimadura (Ignição)', 'Dano Contínuo'],
  [/heiyan/i, 'Chamas Negras (Amaterasu)', 'Dano Contínuo'],
  [/zhongduchixu/i, 'Veneno (Contínuo)', 'Dano Contínuo'],
  [/zhongdu/i, 'Veneno (Ativação)', 'Dano Contínuo'],
  [/hunluanchixu/i, 'Confusão (Contínuo)', 'Controle'],
  [/hunluanchufa/i, 'Confusão (Ativação)', 'Controle'],
  [/dingshen/i, 'Imobilidade / Paralisia', 'Controle'],
  [/fengxue/i, 'Selamento de Chakra (Fūinjutsu)', 'Controle'],
  [/tianlao/i, 'Prisão Celestial (Tenrō)', 'Controle'],
  [/biaojichixu/i, 'Marcação de Alvo (Contínuo)', 'Debuff'],
  [/biaojiqidong/i, 'Marcação de Alvo (Ativação)', 'Debuff'],
  [/Zuzhoubioaji/i, 'Marca da Maldição', 'Debuff'],
  [/BUFFdianji/i, 'Sobrecarga Elétrica (Buff)', 'Buff'],
  [/xuzuobanbati/i, 'Super Armadura · Susano’o Madara', 'Armadura'],
  [/ZUOZHUXZbati/i, 'Super Armadura · Susano’o Sasuke', 'Armadura'],
  [/Banzhongyanzhizhan/i, 'Super Armadura · Madara Guerra', 'Armadura'],
  [/Yuzhibozhishui/i, 'Passiva Especial · Shisui', 'Passiva'],
  [/Youzhongguofeng/i, 'Passiva Especial · Itachi', 'Passiva'],
];

interface NinjaMediaRule {
  namePattern: RegExp;
  /** Tokens exatos permitidos para vídeos MP4 (match no filename em lowercase) */
  videoTokens: string[];
  /** Tokens proibidos para evitar falsos positivos (ex: tiandao em fengyingwoailuotiandao) */
  excludeVideoTokens?: string[];
  /** Tokens exatos permitidos para efeitos Spine (match no nome do bundle em lowercase) */
  effectTokens: string[];
}

/**
 * Regras específicas por variante de ninja (ordem da mais específica para a mais geral).
 * Para ninjas sem nome textual no snapshot, a descoberta exata de vídeo/efeito também ocorre
 * automaticamente ao vivo via comandos `@CMD` (`PLAYVEDIO` e `DISPLAYONFIGHTER`) no `vdfno_<id>.json`.
 */
const NINJA_MEDIA_RULES: NinjaMediaRule[] = [
  // Os 6 Caminhos de Pain + Nagato — rigorosamente separados para nunca misturar vídeos!
  {
    namePattern: /caminho asura/i,
    videoTokens: ['xiuluodao_'],
    effectTokens: ['pesld', 'xiuluodao'],
  },
  {
    namePattern: /caminho animal/i,
    videoTokens: ['chushengdao_'],
    effectTokens: ['pecsd', 'chushengdao'],
  },
  {
    namePattern: /pain.*deva|caminho deva/i,
    videoTokens: ['peien_texie', 'peien_herovideo', 'tiandaopeien_', 'vdfno_peatd'],
    excludeVideoTokens: ['woailuo'],
    effectTokens: ['peatd', 'tiandaopeien'],
  },
  {
    namePattern: /caminho humano/i,
    videoTokens: ['renjiandao_'],
    effectTokens: ['perjd', 'renjiandao'],
  },
  {
    namePattern: /caminho preta/i,
    videoTokens: ['eguidao_'],
    effectTokens: ['peegd', 'eguidao'],
  },
  {
    namePattern: /caminho naraka/i,
    videoTokens: ['diyudao_'],
    effectTokens: ['pedyd', 'diyudao'],
  },
  {
    namePattern: /nagato/i,
    videoTokens: ['changmen_', 'qncm_'],
    effectTokens: ['changmen', 'huituchangmen'],
  },
  // Variantes específicas de personagens nomeados no catálogo oficial
  {
    namePattern: /sasuke.*susano/i,
    videoTokens: ['xuzuozuozhu_', 'vdfno_zuozhu_xznh', 'xznhsp'],
    effectTokens: ['xuzuozuozhu', 'zuozhuxz'],
  },
  {
    namePattern: /madara/i,
    videoTokens: ['yuzhiboban', 'vdfno_yuzhiboban'],
    effectTokens: ['yuzhiboban', 'xuzuoban', 'banzhongyanzhizhan'],
  },
  {
    namePattern: /itachi.*anbu/i,
    videoTokens: ['anbuyou_'],
    effectTokens: ['anbuyou'],
  },
  {
    namePattern: /itachi.*susano/i,
    videoTokens: ['xznhyou'],
    effectTokens: ['xuzuoyou'],
  },
  {
    namePattern: /itachi/i,
    videoTokens: ['yuzhiboyou_', 'you_texie', 'you_unskill', 'vdfno_youyd'],
    effectTokens: ['yuzhiboyou', 'you_effect'],
  },
  {
    namePattern: /tobi\b.*akatsuki/i,
    videoTokens: ['afei_'],
    effectTokens: ['afei_'],
  },
  {
    namePattern: /m[áa]scara branca|obito/i,
    videoTokens: ['baimianju_', 'vdfno_daitu', 'mianjunantexie'],
    effectTokens: ['baimianju', 'daitu'],
  },
  {
    namePattern: /tsunade.*jovem/i,
    videoTokens: ['gangshou_texie', 'gangshou_herovideo'],
    effectTokens: ['gangshou_effect'],
  },
  {
    namePattern: /tsunade/i,
    videoTokens: ['baihaogangshou_', 'bhgs_', 'yongzhuanggangshou'],
    effectTokens: ['gangshou', 'bhgs'],
  },
  {
    namePattern: /deidara.*reanima/i,
    videoTokens: ['htddl_'],
    effectTokens: ['htddl', 'huitudidala'],
  },
  {
    namePattern: /deidara/i,
    videoTokens: ['didala_', 'ddl_texie', 'vdfno_ddl'],
    excludeVideoTokens: ['htddl'],
    effectTokens: ['didala_effect', 'didalapifu'],
  },
  {
    namePattern: /sasori/i,
    videoTokens: ['xie_texie', 'xie_herovideo', 'baijixie_', 'vdfno_xie'],
    effectTokens: ['baijixie', 'xie_effect'],
  },
  {
    namePattern: /kakuzu/i,
    videoTokens: ['jiaodu_texie', 'jiaodu2_texie'],
    effectTokens: ['jiaodu'],
  },
  {
    namePattern: /hidan/i,
    videoTokens: ['feiduan_texie'],
    effectTokens: ['feiduan'],
  },
  {
    namePattern: /kisame/i,
    videoTokens: ['guijiao_'],
    effectTokens: ['guijiao'],
  },
  {
    namePattern: /konan/i,
    videoTokens: ['xiaonan_', 'vdfno_xiaonan'],
    effectTokens: ['xiaonan'],
  },
  {
    namePattern: /tobirama|segundo hokage/i,
    videoTokens: ['qsfjsp_', 'vdfno_erdaidazhao'],
    effectTokens: ['qianshoufeijian', 'xinchunfeijian'],
  },
  {
    namePattern: /hashirama|primeiro hokage/i,
    videoTokens: ['qianshouzhujian_', 'huituzhujian', 'vdfno_shujiejianglin'],
    effectTokens: ['qianshouzhujian'],
  },
  {
    namePattern: /hiruzen|terceiro hokage/i,
    videoTokens: ['yuanfeirizhan_', 'yfrz_', 'huituyfrz_', 'vdfno_yuanfei'],
    effectTokens: ['yuanfeirizhan', 'yfrz'],
  },
  {
    namePattern: /minato|quarto hokage/i,
    videoTokens: ['bofengshuime_', 'shuimen_'],
    effectTokens: ['shuimen'],
  },
  {
    namePattern: /naruto/i,
    videoTokens: ['mingren_', 'vdfno_mingren', 'vdfno_5nrt'],
    effectTokens: ['mingren'],
  },
  {
    namePattern: /sasuke/i,
    videoTokens: ['sasuke_', 'zuozhuxiao_', 'zyzuozhu_', 'vdfno_5ssk', 'vdfno_qilin'],
    effectTokens: ['zuozhu'],
  },
  {
    namePattern: /kakashi/i,
    videoTokens: ['kakaxi_'],
    effectTokens: ['kakaxi'],
  },
  {
    namePattern: /sakura/i,
    videoTokens: ['xiaoying_'],
    effectTokens: ['xiaoying'],
  },
  {
    namePattern: /jiraiya/i,
    videoTokens: ['zilaiye_', 'xrzly_'],
    effectTokens: ['zilaiye'],
  },
  {
    namePattern: /orochimaru/i,
    videoTokens: ['dashewan_', 'dashewa_', 'rzdsw'],
    effectTokens: ['dashewan', 'dsw'],
  },
  {
    namePattern: /gaara/i,
    videoTokens: ['woailuo_', 'woailuorjdz_', 'fengyingwoailuo', 'vdfno_fengying'],
    effectTokens: ['woailuo'],
  },
  {
    namePattern: /hinata/i,
    videoTokens: ['chutian_'],
    effectTokens: ['chutian'],
  },
  {
    namePattern: /neji/i,
    videoTokens: ['ningci'],
    effectTokens: ['ningci'],
  },
  {
    namePattern: /shikamaru/i,
    videoTokens: ['luwan_'],
    effectTokens: ['luwan'],
  },
  {
    namePattern: /rock lee|\blee\b/i,
    videoTokens: ['xiaoli_'],
    effectTokens: ['xiaoli'],
  },
  {
    namePattern: /guy|gai/i,
    videoTokens: ['kai_texie', 'jingmenkai_'],
    effectTokens: ['kai_effect', 'jingmenkai'],
  },
  {
    namePattern: /shisui/i,
    videoTokens: ['yuzhibozhishui_', 'vdfno_zhishui'],
    effectTokens: ['zhishui'],
  },
  {
    namePattern: /killer bee|\bbee\b/i,
    videoTokens: ['qilabi_', 'qlbwssp_'],
    effectTokens: ['qilabi'],
  },
  {
    namePattern: /onoki|ōnoki/i,
    videoTokens: ['dayemu_', 'vdfno_tuying'],
    effectTokens: ['dayemu'],
  },
  {
    namePattern: /mei terumi|terumi/i,
    videoTokens: ['zhaomeiming_', 'zhaomeimin_', 'vdfno_shuiying'],
    effectTokens: ['zhaomeiming'],
  },
  {
    namePattern: /raikage/i,
    videoTokens: ['leiying_', 'sandaileiying', 'sidaileiying'],
    effectTokens: ['leiying'],
  },
  {
    namePattern: /kabuto/i,
    videoTokens: ['yaoshidou_', 'xianrendou_'],
    effectTokens: ['yaoshidou', 'xianrendou'],
  },
  {
    namePattern: /asuma/i,
    videoTokens: ['asima_'],
    effectTokens: ['asima'],
  },
  {
    namePattern: /yamato/i,
    videoTokens: ['dahe_', 'vdfno_dahe'],
    effectTokens: ['dahe'],
  },
  {
    namePattern: /hanz[ōo]/i,
    videoTokens: ['banzang_', 'shanjiaoyubanzang_', 'vdfno_hanzo'],
    effectTokens: ['banzang'],
  },
  {
    namePattern: /zabuza/i,
    videoTokens: ['zaibuzhan_'],
    effectTokens: ['zaibuzhan', 'zbz_'],
  },
  {
    namePattern: /j[ūu]go/i,
    videoTokens: ['zhongwu_'],
    effectTokens: ['zhongwu'],
  },
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
  statusEffects: StatusEffectRecord[];
  spineModels: SpineBundle[];
  spineMap: Map<string, SpineBundle>;
  /** Lookup case-insensitive pelo nome exato do bundle Spine (ex: `noe_pesldgwhs`) para resolver `@CMD` VFX */
  spineByNameMap: Map<string, SpineBundle>;
  anim2d: Anim2DBundle[];
  anim2dMap: Map<string, Anim2DBundle>;
  videos: VideoRecord[];
  videoMap: Map<string, VideoRecord>;
  skillIcons: AssetFileRef[];
  audio: AudioRecord[];
  audioMap: Map<string, AudioRecord>;
  techniques: SkillRecord[];
  items: ItemRecord[];
  visualItems: VisualItemRecord[];
  visualAssets: VisualAssetRecord[];
  fontAssets: FontAssetRecord[];
  rawArquivos: ManifestFile[];
}

function toAssetRef(f: ManifestFile, category?: string): AssetFileRef {
  const name = f.url.split('/').pop() || f.url;
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  return { url: f.url, name, ext, bytes: f.bytes || 0, category };
}

function classifySkillType(slotCode: string): SkillRecord['skillType'] {
  // Validado diretamente nas tabelas do jogo e nos eventos `@CMD` de `vdfno_*.json`:
  // s1 = Suprema/Ogi (UniqueSkill), a1 = Habilidade/Especial (skill), n1 = Ataque Normal (attack)
  if (/^s\d/i.test(slotCode)) return 'Esotérica';
  if (/^a\d/i.test(slotCode)) return 'Especial';
  if (/^n\d/i.test(slotCode)) return 'Ataque Básico';
  if (/^c\d/i.test(slotCode)) return 'Perseguição';
  if (/^p\d/i.test(slotCode)) return 'Passiva';
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
  let encryptedTablesCount = 0;

  const heroPortraitFiles = new Map<string, AssetFileRef[]>();
  const heroBannerFiles = new Map<string, AssetFileRef[]>();
  const heroSmallPicMap = new Map<string, AssetFileRef[]>();
  const heroSkillIconFiles = new Map<string, Map<string, AssetFileRef[]>>();
  const spineGroupMap = new Map<string, { displayName: string; kind: SpineBundle['kind']; files: AssetFileRef[] }>();
  const summonSpineFiles = new Map<string, AssetFileRef[]>();
  const summonEffectWebps: AssetFileRef[] = [];
  const summonFragments: AssetFileRef[] = [];
  const statusSpineFiles = new Map<string, AssetFileRef[]>();
  const statusEffectWebps: AssetFileRef[] = [];
  const anim2dAtlasMap = new Map<string, AssetFileRef>();
  const anim2dImgMap = new Map<string, AssetFileRef[]>();
  const videos: VideoRecord[] = [];
  const skillIcons: AssetFileRef[] = [];
  const audio: AudioRecord[] = [];
  const itemIcons = new Map<string, string>();
  const visualItemRawMap = new Map<
    string,
    { id: string; name: string; group: VisualItemRecord['group']; groupLabel: string; url: string; bytes: number; ext: string }
  >();
  const visualAssetDedupMap = new Map<string, VisualAssetRecord>();
  const ttfFiles: AssetFileRef[] = [];
  const bitmapFontGroups = new Map<string, AssetFileRef[]>();

  const registerVisualAsset = (
    f: ManifestFile,
    category: VisualAssetCategory,
    subfolder: string
  ) => {
    const url = f.url;
    if (!/\.(webp|png|jpg|jpeg)$/i.test(url)) return;
    const key = url.replace(/\.(webp|png|jpg|jpeg)$/i, '').toLowerCase();
    const ext = (url.split('.').pop() || '').toLowerCase();
    const existing = visualAssetDedupMap.get(key);
    if (existing && existing.ext === 'webp') return;
    const name = url.split('/').pop() || url;
    visualAssetDedupMap.set(key, {
      id: key,
      name,
      url,
      category,
      subfolder,
      ext,
      bytes: f.bytes || 0,
    });
  };

  for (const f of arquivos) {
    totalBytes += f.bytes || 0;
    const url = f.url;

    if (url.startsWith('d/')) {
      encryptedTablesCount++;
      continue;
    }

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
      if (/^(skill_|EsoSkill_)/i.test(fname) && /\.(webp|png)$/i.test(fname)) {
        const ref = toAssetRef(f, 'icone_habilidade');
        if (fname.endsWith('.webp')) {
          skillIcons.push(ref);
        }
        const heroSkillMatch = fname.match(/^skill_hero(\d+)_([a-z0-9]+)\.(webp|png)$/i);
        if (heroSkillMatch) {
          const rawNum = heroSkillMatch[1];
          const slotCode = heroSkillMatch[2].toLowerCase();
          const heroId6 = rawNum.length >= 6 ? rawNum : `100${rawNum.padStart(3, '0')}`;
          let slotMap = heroSkillIconFiles.get(heroId6);
          if (!slotMap) {
            slotMap = new Map();
            heroSkillIconFiles.set(heroId6, slotMap);
          }
          const arr = slotMap.get(slotCode) || [];
          arr.push(ref);
          slotMap.set(slotCode, arr);
        }
        continue;
      }
      const itemIconMatch = fname.match(/^item_(\d+)\.(webp|png)$/i);
      if (itemIconMatch) {
        const itemId = itemIconMatch[1];
        if (fname.endsWith('.webp')) itemIcons.set(itemId, url);
        const key = `item:${itemId}`;
        const prev = visualItemRawMap.get(key);
        if (!prev || (prev.ext !== 'webp' && fname.endsWith('.webp'))) {
          visualItemRawMap.set(key, {
            id: itemId,
            name: `Item #${itemId}`,
            group: 'item',
            groupLabel: 'Item',
            url,
            bytes: f.bytes || 0,
            ext: fname.endsWith('.webp') ? 'webp' : 'png',
          });
        }
        continue;
      }
      if (/\.(webp|png)$/i.test(fname)) {
        const stem = fname.replace(/\.(webp|png)$/i, '');
        const key = `other_item:${stem.toLowerCase()}`;
        const prev = visualItemRawMap.get(key);
        if (!prev || (prev.ext !== 'webp' && fname.endsWith('.webp'))) {
          visualItemRawMap.set(key, {
            id: stem,
            name: stem,
            group: 'outro',
            groupLabel: 'Especial',
            url,
            bytes: f.bytes || 0,
            ext: fname.endsWith('.webp') ? 'webp' : 'png',
          });
        }
      }
      continue;
    }

    if (url.startsWith('acervo/asset/spine-no-estados/')) {
      const fname = url.slice('acervo/asset/spine-no-estados/'.length);
      if (fname.startsWith('noe_') && /\.(json|atlas)$/i.test(fname)) {
        const base = fname.replace(/\.(json|atlas)$/i, '');
        const list = statusSpineFiles.get(base) || [];
        list.push(toAssetRef(f, 'estado_combate'));
        statusSpineFiles.set(base, list);
      } else if (/\.(webp|png)$/i.test(fname)) {
        statusEffectWebps.push(toAssetRef(f, 'estado_combate_sprite'));
      }
      continue;
    }

    if (url.startsWith('acervo/ttf/')) {
      ttfFiles.push(toAssetRef(f, 'fonte_ttf'));
      continue;
    }

    if (url.startsWith('acervo/fonts/')) {
      const fname = url.slice('acervo/fonts/'.length);
      const base = fname
        .replace(/\.fnt\.json$/i, '')
        .replace(/\.(fnt|webp|png)$/i, '')
        .replace(/_\d+$/, '');
      const list = bitmapFontGroups.get(base) || [];
      list.push(toAssetRef(f, 'fonte_bitmap'));
      bitmapFontGroups.set(base, list);
      continue;
    }

    if (url.startsWith('acervo/asset/spine-hd/') && !url.endsWith('indice.json')) {
      const fname = url.slice('acervo/asset/spine-hd/'.length);
      const isImg = /\.(webp|png)$/i.test(fname);
      let base = fname.replace(/(\.leve)?\.(json|atlas|webp|png)$/i, '');
      if (isImg) base = base.replace(/_([2-9]|[1-2]\d)$/, '');
      const key = `hd:${base.toLowerCase()}`;
      const entry = spineGroupMap.get(key) || { displayName: base, kind: 'hd', files: [] };
      if (fname.endsWith('.json')) entry.displayName = base;
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

      // As texturas de todos os 1.356 efeitos de habilidade `noe_<X>` chamam-se `efeito_<X>*.webp`:
      // unificamos no mesmo bundle `sp:noe_<x>` (case-insensitive) para que cada VFX tenha suas texturas!
      if (isImg && /^efeito_/i.test(base)) {
        base = `noe_${base.slice('efeito_'.length)}`;
      }

      let kind: SpineBundle['kind'] = 'personagem';
      if (/^noe_/i.test(base) || /_effect$/i.test(base) || /efeito/i.test(base)) kind = 'efeito';
      else if (/lihui\d*$/i.test(base)) kind = 'retrato';
      else if (/texie\d*$/i.test(base)) kind = 'esoterica';
      else if (/_ground$/i.test(base)) kind = 'cenario';
      else if (/_pintura$/i.test(base)) kind = 'pintura';

      const key = `sp:${base.toLowerCase()}`;
      const entry = spineGroupMap.get(key) || { displayName: base, kind, files: [] };
      if (fname.endsWith('.json')) {
        entry.displayName = base;
        entry.kind = kind;
      }
      entry.files.push(toAssetRef(f, `spine_${kind}`));
      spineGroupMap.set(key, entry);
      continue;
    }

    if (url.startsWith('dados/atlas/asset/anim/') && url.endsWith('.json')) {
      const base = url.slice('dados/atlas/asset/anim/'.length, -5);
      anim2dAtlasMap.set(`base:${base}`, toAssetRef(f, 'anim2d_atlas'));
      continue;
    }

    if (url.startsWith('dados/atlas/language/pt/asset/anim/') && url.endsWith('.json')) {
      const base = url.slice('dados/atlas/language/pt/asset/anim/'.length, -5);
      anim2dAtlasMap.set(`pt:${base}`, toAssetRef(f, 'anim2d_atlas_pt'));
      continue;
    }

    if (url.startsWith('acervo/asset/anim/')) {
      const fname = url.slice('acervo/asset/anim/'.length);
      const base = fname.replace(/(-sg)?\.(webp|png)$/i, '');
      const list = anim2dImgMap.get(`base:${base}`) || [];
      list.push(toAssetRef(f, 'anim2d_sprite'));
      anim2dImgMap.set(`base:${base}`, list);
      continue;
    }

    if (url.startsWith('acervo/language/pt/asset/anim/')) {
      const fname = url.slice('acervo/language/pt/asset/anim/'.length);
      const base = fname.replace(/(-sg)?\.(webp|png)$/i, '');
      const list = anim2dImgMap.get(`pt:${base}`) || [];
      list.push(toAssetRef(f, 'anim2d_sprite_pt'));
      anim2dImgMap.set(`pt:${base}`, list);
      continue;
    }

    if (url.startsWith('acervo/asset/ui/ninjaTool/') && /\.(webp|png)$/i.test(url)) {
      const fname = url.split('/').pop() || url;
      const stem = fname.replace(/\.(webp|png)$/i, '');
      const key = `tool:${stem.toLowerCase()}`;
      const prev = visualItemRawMap.get(key);
      if (!prev || (prev.ext !== 'webp' && fname.endsWith('.webp'))) {
        visualItemRawMap.set(key, {
          id: stem,
          name: stem,
          group: 'ferramenta',
          groupLabel: 'Ferramenta Ninja',
          url,
          bytes: f.bytes || 0,
          ext: fname.endsWith('.webp') ? 'webp' : 'png',
        });
      }
      continue;
    }

    if (url.startsWith('acervo/asset/ui/rune/') && /\.(webp|png)$/i.test(url)) {
      const fname = url.split('/').pop() || url;
      const stem = fname.replace(/\.(webp|png)$/i, '');
      const key = `rune:${stem.toLowerCase()}`;
      const prev = visualItemRawMap.get(key);
      if (!prev || (prev.ext !== 'webp' && fname.endsWith('.webp'))) {
        visualItemRawMap.set(key, {
          id: stem,
          name: stem,
          group: 'runa',
          groupLabel: 'Runa / Magatama',
          url,
          bytes: f.bytes || 0,
          ext: fname.endsWith('.webp') ? 'webp' : 'png',
        });
      }
      continue;
    }

    // Visual Explorer Categories (UI, Arenas, Live Maps, Story, Titles, PT-BR, Extras)
    if (url.startsWith('acervo/asset/ui/bg/') || url.startsWith('acervo/asset/ui/blockBgshow/') || url.startsWith('acervo/asset/ui/equipQuilityBg/') || url.startsWith('acervo/asset/ui/tower/')) {
      const parts = url.split('/');
      registerVisualAsset(f, 'arenas_fundos', parts[3] === 'bg' && parts.length > 5 ? `bg/${parts[4]}` : parts[3] || 'bg');
      continue;
    }
    if (url.startsWith('acervo/asset/mapavivo/') || url.startsWith('acervo/asset/dimensaoparalela/') || url.startsWith('acervo/asset/torreinterplano/') || url.startsWith('acervo/asset/sedeguilda/') || url.startsWith('acervo/asset/grandeguerra/')) {
      const parts = url.split('/');
      registerVisualAsset(f, 'mapas_vivos', parts[2] || 'mapavivo');
      continue;
    }
    if (url.startsWith('acervo/asset/ui/Plot/') || url.startsWith('acervo/asset/historiasparalelas/') || url.startsWith('acervo/asset/abertura/')) {
      const parts = url.split('/');
      registerVisualAsset(f, 'historia_dialogos', parts[2] === 'ui' ? 'Plot' : parts[2] || 'historia');
      continue;
    }
    if (url.startsWith('acervo/asset/ui/titulos-no/') || url.startsWith('acervo/asset/ui/photoframe/') || url.startsWith('acervo/asset/ui/vip-no/') || url.startsWith('acervo/asset/ui/huizhang/') || url.startsWith('acervo/asset/ui/achievementicon/') || url.startsWith('acervo/asset/vipplacas/')) {
      const parts = url.split('/');
      registerVisualAsset(f, 'titulos_molduras', parts[2] === 'ui' ? parts[3] : parts[2]);
      continue;
    }
    if (url.startsWith('acervo/language/pt/')) {
      const parts = url.split('/');
      registerVisualAsset(f, 'artes_ptbr', parts.slice(3, 5).join('/') || 'pt');
      continue;
    }
    if (
      url.startsWith('acervo/asset/vdf-fazenda/') ||
      url.startsWith('acervo/asset/minijogos/') ||
      url.startsWith('acervo/asset/myouboku/') ||
      url.startsWith('acervo/asset/transformacao/') ||
      url.startsWith('acervo/asset/templo/') ||
      url.startsWith('acervo/asset/expression/') ||
      url.startsWith('acervo/asset/vdf-emoji/') ||
      url.startsWith('acervo/asset/vdf-poker/') ||
      url.startsWith('acervo/asset/vdf-cassino/') ||
      url.startsWith('acervo/asset/ui/ActivityWujitaTrip/') ||
      url.startsWith('acervo/asset/ui/Treasure/') ||
      url.startsWith('acervo/asset/ui/activityTaskIcon/')
    ) {
      const parts = url.split('/');
      registerVisualAsset(f, 'modos_extras', parts[2] === 'ui' ? parts[3] : parts[2]);
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
        categoryLabel = 'Efeitos e Vozes de Batalha (@CMD)';
        // IMPORTANTE: Arquivos em `acervo/som/nos/<N>_<M>.mp3` usam IDs internos sequenciais
        // chamados via `{SOUND:name="nos_N_M"}` dentro do `vdfno_<id>.json` de cada ninja.
        // NÃO correspondem aos últimos 3 dígitos do Hero ID (evita atribuir vozes de outros ninjas!).
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
  const spineByNameMap = new Map<string, SpineBundle>();
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

    const rawId = entry.displayName;
    const prefix = key.startsWith('hd:') ? 'hd' : 'sp';
    const heroIdMatch = rawId.match(/^vdfnop?_(\d{6})/i);
    const heroId = heroIdMatch ? heroIdMatch[1] : null;

    const bundle: SpineBundle = {
      id: `${prefix}__${rawId}`,
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
    if (!spineByNameMap.has(rawId.toLowerCase()) || prefix === 'sp') {
      spineByNameMap.set(rawId.toLowerCase(), bundle);
    }

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
    if (!spineByNameMap.has(base.toLowerCase())) {
      spineByNameMap.set(base.toLowerCase(), bundle);
    }

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

  // Status effects Spine bundles (acervo/asset/spine-no-estados/)
  const statusEffects: StatusEffectRecord[] = [];
  for (const [base, files] of statusSpineFiles.entries()) {
    const jsonFile = files.find((x) => x.ext === 'json');
    if (!jsonFile) continue;
    const atlasFile = files.find((x) => x.ext === 'atlas') || null;
    const stem = base.replace(/^noe_/i, '');
    const matchingImages = statusEffectWebps.filter((w) => {
      const wStem = w.name.replace(/^efeito_/i, '').replace(/(_\d+)?\.(webp|png)$/i, '');
      return wStem.toLowerCase() === stem.toLowerCase();
    });
    const allFiles = [...files, ...matchingImages];
    const imageUrls = matchingImages.map((x) => x.url);
    const bundle: SpineBundle = {
      id: `estado__${base}`,
      name: base,
      kind: 'efeito',
      jsonUrl: jsonFile.url,
      atlasUrl: atlasFile ? atlasFile.url : null,
      imageUrls,
      pngUrls: [],
      allFiles,
      totalBytes: allFiles.reduce((acc, x) => acc + x.bytes, 0),
    };
    spineMap.set(bundle.id, bundle);
    if (!spineByNameMap.has(base.toLowerCase())) {
      spineByNameMap.set(base.toLowerCase(), bundle);
    }

    const matchedLabel = STATUS_SPINE_NAME_MAP.find(([re]) => re.test(stem));
    statusEffects.push({
      id: base,
      rawCode: stem,
      name: matchedLabel ? matchedLabel[1] : stem.replace(/_/g, ' '),
      category: matchedLabel ? matchedLabel[2] : 'Estado de Combate',
      spine: bundle,
      previewUrl: imageUrls[0] || null,
      totalBytes: bundle.totalBytes,
      fileCount: allFiles.length,
    });
  }
  statusEffects.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  const anim2d: Anim2DBundle[] = [];
  const anim2dMap = new Map<string, Anim2DBundle>();
  for (const [key, atlasFile] of anim2dAtlasMap.entries()) {
    const isPt = key.startsWith('pt:');
    const rawBase = key.replace(/^(base|pt):/, '');
    const imgs = anim2dImgMap.get(key) || [];
    const webp = imgs.find((x) => x.ext === 'webp' && !x.name.includes('-sg')) || imgs.find((x) => x.ext === 'webp');
    const png = imgs.find((x) => x.ext === 'png' && !x.name.includes('-sg')) || imgs.find((x) => x.ext === 'png');
    const allFiles = [atlasFile, ...imgs];
    const displayName = rawBase.replace(/image$/i, '') + (isPt ? ' [PT-BR]' : '');
    const bundle: Anim2DBundle = {
      id: key.replace(':', '__'),
      name: displayName,
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
    const iconSlotMap = heroSkillIconFiles.get(id);
    const heroSkillIconList: AssetFileRef[] = [];
    if (iconSlotMap) {
      for (const refs of iconSlotMap.values()) {
        heroSkillIconList.push(...refs);
      }
    }

    const SKILL_SLOT_DEFS: Array<{
      code: string;
      label: string;
      shortLabel: string;
      preferredAnims: string[];
      isPassive: boolean;
    }> = [
      {
        code: 's1',
        label: 'Ogi (Esotérica)',
        shortLabel: 'Ogi',
        preferredAnims: ['UniqueSkill', 'uniqueSkill', 'superUniqueSkill', 'aoyi', 'skill2'],
        isPassive: false,
      },
      {
        code: 'n1',
        label: 'Ataque Normal',
        shortLabel: 'Ataque',
        preferredAnims: ['attack', 'attackAction', 'atk', 'atk1'],
        isPassive: false,
      },
      {
        code: 'a1',
        label: 'Habilidade',
        shortLabel: 'Habilidade',
        preferredAnims: ['skill', 'skillAction', 'skill1', 'cast'],
        isPassive: false,
      },
      {
        code: 'c1',
        label: 'Perseguição 1',
        shortLabel: 'Perseg. 1',
        preferredAnims: ['chase1', 'chase1Action', 'chase'],
        isPassive: false,
      },
      {
        code: 'c2',
        label: 'Perseguição 2',
        shortLabel: 'Perseg. 2',
        preferredAnims: ['chase2', 'chase2Action', 'chase1'],
        isPassive: false,
      },
      {
        code: 'p1',
        label: 'Habilidade Passiva 1',
        shortLabel: 'Passiva 1',
        preferredAnims: ['idle', 'win', 'stand'],
        isPassive: true,
      },
      {
        code: 'p2',
        label: 'Habilidade Passiva 2',
        shortLabel: 'Passiva 2',
        preferredAnims: ['idle', 'win', 'stand'],
        isPassive: true,
      },
    ];

    const skillByCode = new Map<string, SkillRecord>();
    for (const sk of skills) {
      skillByCode.set(sk.slotCode.toLowerCase(), sk);
    }

    const skillSlots: NinjaSkillSlot[] = [];
    const usedSlotCodes = new Set<string>();
    for (const def of SKILL_SLOT_DEFS) {
      const iconRefs = iconSlotMap?.get(def.code) || [];
      const iconUrl =
        iconRefs.find((r) => r.ext === 'webp')?.url || iconRefs[0]?.url || null;
      const matchedSkill = skillByCode.get(def.code) || null;
      if (iconUrl || matchedSkill) {
        usedSlotCodes.add(def.code);
        skillSlots.push({
          slotCode: def.code,
          label: def.label,
          shortLabel: def.shortLabel,
          iconUrl,
          skill: matchedSkill,
          preferredAnims: def.preferredAnims,
          isPassive: def.isPassive,
        });
      }
    }

    // Add any additional custom skill slots if present
    for (const sk of skills) {
      const code = sk.slotCode.toLowerCase();
      if (usedSlotCodes.has(code)) continue;
      const iconRefs = iconSlotMap?.get(code) || [];
      const iconUrl = iconRefs.find((r) => r.ext === 'webp')?.url || iconRefs[0]?.url || null;
      skillSlots.push({
        slotCode: code,
        label: sk.skillType,
        shortLabel: code.toUpperCase(),
        iconUrl,
        skill: sk,
        preferredAnims: code.startsWith('p')
          ? ['idle']
          : code.startsWith('c')
          ? ['chase1', 'chase2']
          : code.startsWith('s')
          ? ['UniqueSkill', 'uniqueSkill', 'skill']
          : code.startsWith('n')
          ? ['attack', 'attackAction']
          : ['skill', 'UniqueSkill', 'attack'],
        isPassive: code.startsWith('p'),
      });
    }

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
      audioFiles.reduce((s, x) => s + x.bytes, 0) +
      heroSkillIconList.reduce((s, x) => s + x.bytes, 0);

    const fileCount =
      portraits.length +
      bannersPt.length +
      spineBundles.reduce((s, x) => s + x.allFiles.length, 0) +
      audioFiles.length +
      heroSkillIconList.length;

    const rawDesc =
      (typeof meta.desc === 'string' && meta.desc.trim()) ||
      (typeof textosMeta[`HeroBase_${id}_desc`] === 'string' && textosMeta[`HeroBase_${id}_desc`].trim()) ||
      null;

    // Cross-link videos and Spine effects using FIRST matching variant-specific rule (no cross-path leakage!)
    const matchedRule = nameInfo.official
      ? NINJA_MEDIA_RULES.find((r) => r.namePattern.test(nameInfo.name)) || null
      : null;
    const shortId = id.replace(/^100/, '');

    const linkedVideos = videos
      .filter((v) => {
        const lower = v.filename.toLowerCase();
        if (lower.includes(id)) return true;
        if (!matchedRule) return false;
        if (matchedRule.excludeVideoTokens?.some((ex) => lower.includes(ex))) return false;
        return matchedRule.videoTokens.some((tok) => lower.includes(tok));
      })
      .slice(0, 8);

    const linkedEffects = matchedRule
      ? spineModels
          .filter((s) => {
            if (s.kind !== 'efeito') return false;
            const lower = s.name.toLowerCase();
            return matchedRule.effectTokens.some((tok) => lower.includes(tok));
          })
          .slice(0, 12)
      : [];

    const ninja: NinjaRecord = {
      id,
      shortId,
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
      skillSlots,
      skillIcons: heroSkillIconList,
      linkedVideos,
      linkedEffects,
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

  const visualItems: VisualItemRecord[] = [];
  for (const raw of visualItemRawMap.values()) {
    const meta = raw.group === 'item' ? itensMeta[raw.id] : undefined;
    const desc = (meta?.functiondesc || meta?.name || '').trim() || null;
    visualItems.push({
      id: raw.id,
      name: meta?.name?.trim() || raw.name,
      group: raw.group,
      groupLabel: raw.groupLabel,
      url: raw.url,
      desc,
      bytes: raw.bytes,
    });
  }
  visualItems.sort((a, b) => {
    const dA = a.desc ? 1 : 0;
    const dB = b.desc ? 1 : 0;
    if (dB !== dA) return dB - dA;
    return a.id.localeCompare(b.id, undefined, { numeric: true });
  });

  const visualAssets = [...visualAssetDedupMap.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  );

  const fontAssets: FontAssetRecord[] = [];
  for (const ttf of ttfFiles) {
    fontAssets.push({
      id: `ttf_${ttf.name}`,
      name: ttf.name.replace(/\.ttf$/i, ''),
      kind: 'ttf',
      fileUrl: ttf.url,
      previewUrl: null,
      allFiles: [ttf],
      totalBytes: ttf.bytes,
    });
  }
  for (const [base, files] of bitmapFontGroups.entries()) {
    const fntFile = files.find((x) => x.ext === 'fnt') || files[0];
    const preview =
      files.find((x) => x.ext === 'webp') || files.find((x) => x.ext === 'png') || null;
    fontAssets.push({
      id: `fnt_${base}`,
      name: base,
      kind: 'bitmap',
      fileUrl: fntFile.url,
      previewUrl: preview ? preview.url : null,
      allFiles: files,
      totalBytes: files.reduce((s, x) => s + x.bytes, 0),
    });
  }
  fontAssets.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'ttf' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

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
      statusEffects: statusEffects.length,
      visualAssets: visualAssets.length,
      visualItems: visualItems.length,
      fontAssets: fontAssets.length,
      encryptedTables: encryptedTablesCount,
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
    statusEffects,
    spineModels,
    spineMap,
    spineByNameMap,
    anim2d,
    anim2dMap,
    videos,
    videoMap,
    skillIcons,
    audio,
    audioMap,
    techniques,
    items,
    visualItems,
    visualAssets,
    fontAssets,
    rawArquivos: arquivos,
  };
}

let cachedStudioSnapshot: StudioSnapshot | null = null;

export function getCachedStudioSnapshot(): StudioSnapshot | null {
  return cachedStudioSnapshot;
}

export async function fetchBundledStudioSnapshot(): Promise<StudioSnapshot> {
  if (cachedStudioSnapshot) return cachedStudioSnapshot;
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
  cachedStudioSnapshot = snapshot;
  return snapshot;
}

export async function loadStaticCatalog(
  onStage?: (stage: string) => void
): Promise<FullCatalog> {
  onStage?.('Lendo snapshot estático do acervo...');
  const snapshot = await fetchBundledStudioSnapshot();

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

/**
 * Carrega o catálogo completo da aplicação diretamente a partir de um arquivo ZIP de backup
 * (hospedado no Google Drive ou selecionado do dispositivo), mantendo a aplicação 100% funcional
 * mesmo se naruto.jotagame.com deixar de existir.
 */
export async function loadCatalogFromZipArchive(
  reader: RemoteZipReader,
  onStage?: (stage: string) => void
): Promise<FullCatalog> {
  onStage?.('Lendo metadados (studio-snapshot.json) dentro do backup ZIP...');

  let snapshot: StudioSnapshot | null = null;
  const snapEntry =
    reader.findEntry('studio-snapshot.json') ||
    reader.findEntry('dados/studio-snapshot.json') ||
    reader.findEntry('00_banco_de_dados/studio-snapshot.json');

  if (snapEntry) {
    try {
      const txt = await reader.readFileText(snapEntry.normalizedPath);
      snapshot = JSON.parse(txt) as StudioSnapshot;
      cachedStudioSnapshot = snapshot;
    } catch {
      snapshot = null;
    }
  }
  if (!snapshot) {
    snapshot = await fetchBundledStudioSnapshot();
  }

  onStage?.('Lendo manifesto de arquivos do backup ZIP...');
  let arquivos: ManifestFile[] = [];
  let manifestVersion = `backup-zip:${reader.source.label}`;

  const manifestEntry =
    reader.findEntry('manifesto.json') ||
    reader.findEntry(snapshot.manifestFile.replace(/^\/+/, '')) ||
    reader.findEntry('dados/manifesto.json');

  if (manifestEntry) {
    try {
      const manTxt = await reader.readFileText(manifestEntry.normalizedPath);
      const manData = JSON.parse(manTxt) as { versao?: string; arquivos?: ManifestFile[] };
      if (Array.isArray(manData.arquivos) && manData.arquivos.length > 0) {
        // Keep only entries that actually exist inside this ZIP (works for both 100% full AND partial backups!)
        const present = manData.arquivos.filter((a) => reader.hasEntry(a.url));
        arquivos = present.length > 0 ? present : manData.arquivos;
        if (manData.versao) manifestVersion = `${manData.versao} (Backup ZIP)`;
      }
    } catch {
      arquivos = [];
    }
  }

  // Fallback: reconstruct ManifestFile[] directly from the ZIP Central Directory!
  if (arquivos.length === 0) {
    onStage?.('Reconstruindo manifesto diretamente da estrutura de pastas do ZIP...');
    arquivos = reader.entries
      .filter(
        (e) =>
          e.normalizedPath.startsWith('acervo/') ||
          e.normalizedPath.startsWith('dados/') ||
          e.normalizedPath.startsWith('d/')
      )
      .map((e) => ({
        url: e.normalizedPath,
        hash: '',
        bytes: e.uncompressedSize,
      }));
  }

  if (arquivos.length === 0) {
    throw new Error(
      'Este arquivo ZIP não contém as pastas originais do jogo (acervo/, dados/). Exporte usando "Backup Único (Estrutura Original do Jogo)" para criar um backup compatível.'
    );
  }

  onStage?.(
    `Indexando ${arquivos.length.toLocaleString('pt-BR')} arquivos do backup ZIP...`
  );
  const backupSnapshot: StudioSnapshot = {
    ...snapshot,
    cdnBase: ZIP_BACKUP_PREFIX,
  };
  return buildCatalog(backupSnapshot, manifestVersion, arquivos);
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
  const [jsonText, atlasText] = await Promise.all([
    fetchAssetText(cdnBase, jsonUrl),
    atlasUrl ? fetchAssetText(cdnBase, atlasUrl).catch(() => null) : Promise.resolve(null),
  ]);

  const skel = JSON.parse(jsonText) as Record<string, any>;
  const baseDir = posixDirname(atlasUrl || jsonUrl);

  let pages: SpineInspectionResult['pages'] = [];
  let regions: SpineAtlasRegion[] = [];
  if (atlasText) {
    const parsed = parseSpineAtlasText(atlasText, baseDir);
    pages = parsed.pages.map((p) => ({
      ...p,
      imageUrl: resolveCdnUrl(cdnBase, p.imageUrl),
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
  const text = await fetchAssetText(cdnBase, bundle.atlasJsonUrl);
  const data = JSON.parse(text) as { frames?: Record<string, any> };
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
    imageUrl: bundle.imageUrl ? resolveCdnUrl(cdnBase, bundle.imageUrl) : '',
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
