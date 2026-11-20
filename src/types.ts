export interface ManifestFile {
  url: string;
  hash: string;
  bytes: number;
}

export interface AssetFileRef {
  url: string;
  name: string;
  ext: string;
  bytes: number;
  category?: string;
}

export interface SpineBundle {
  id: string;
  name: string;
  kind: 'personagem' | 'hd' | 'invocacao' | 'efeito' | 'retrato' | 'esoterica' | 'cenario' | 'pintura';
  jsonUrl: string;
  atlasUrl: string | null;
  imageUrls: string[];
  pngUrls: string[];
  allFiles: AssetFileRef[];
  totalBytes: number;
  heroId?: string | null;
}

export interface Anim2DBundle {
  id: string;
  name: string;
  atlasJsonUrl: string;
  imageUrl: string | null;
  pngUrl: string | null;
  allFiles: AssetFileRef[];
  totalBytes: number;
}

export interface SkillRecord {
  id: string;
  heroId: string | null;
  heroName: string | null;
  slotCode: string;
  skillType: 'Esotérica' | 'Ataque Básico' | 'Perseguição' | 'Passiva' | 'Especial' | 'Outro';
  name: string;
  desc: string;
  multipliers: string[];
  effects: string[];
}

export interface AudioRecord {
  id: string;
  filename: string;
  url: string;
  category:
    | 'dublagem_falas'
    | 'dublagem_esoterica'
    | 'dublagem_derrota'
    | 'dublagem_historia'
    | 'efeitos_habilidades'
    | 'vozes_combate';
  categoryLabel: string;
  heroId: string | null;
  heroName: string | null;
  bytes: number;
}

export interface VideoRecord {
  id: string;
  filename: string;
  url: string;
  kind: 'esoterica' | 'close_up' | 'outro';
  bytes: number;
}

export interface NinjaSkillSlot {
  slotCode: string;
  label: string;
  shortLabel: string;
  iconUrl: string | null;
  skill: SkillRecord | null;
  preferredAnims: string[];
  isPassive: boolean;
}

export interface NinjaRecord {
  id: string;
  shortId: string;
  name: string;
  hasOfficialName: boolean;
  role: string | null;
  growvalue: number | null;
  leveluprate: number | null;
  ifHidden: number | null;
  desc: string | null;
  avatarUrl: string | null;
  portraitUrl: string | null;
  nameBannerUrl: string | null;
  skillBannerUrl: string | null;
  portraits: AssetFileRef[];
  bannersPt: AssetFileRef[];
  spineBundles: SpineBundle[];
  audioFiles: AudioRecord[];
  skills: SkillRecord[];
  skillSlots: NinjaSkillSlot[];
  skillIcons: AssetFileRef[];
  linkedVideos: VideoRecord[];
  linkedEffects: SpineBundle[];
  hasHdSpine: boolean;
  hasBattleSpine: boolean;
  fileCount: number;
  totalBytes: number;
}

export interface SummonRecord {
  id: string;
  rawCode: string;
  name: string;
  spine: SpineBundle;
  previewUrl: string | null;
  totalBytes: number;
  fileCount: number;
}

export interface StatusEffectRecord {
  id: string;
  rawCode: string;
  name: string;
  category: string;
  spine: SpineBundle;
  previewUrl: string | null;
  totalBytes: number;
  fileCount: number;
}

export interface ItemRecord {
  id: string;
  desc: string;
  iconUrl: string | null;
}

export type VisualAssetCategory =
  | 'arenas_fundos'
  | 'mapas_vivos'
  | 'historia_dialogos'
  | 'titulos_molduras'
  | 'artes_ptbr'
  | 'modos_extras';

export interface VisualAssetRecord {
  id: string;
  name: string;
  url: string;
  category: VisualAssetCategory;
  subfolder: string;
  ext: string;
  bytes: number;
}

export interface FontAssetRecord {
  id: string;
  name: string;
  kind: 'ttf' | 'bitmap';
  fileUrl: string;
  previewUrl: string | null;
  allFiles: AssetFileRef[];
  totalBytes: number;
}

export interface VisualItemRecord {
  id: string;
  name: string;
  group: 'item' | 'ferramenta' | 'runa' | 'outro';
  groupLabel: string;
  url: string;
  desc: string | null;
  bytes: number;
}

export interface CatalogSummary {
  sourceUrl: string;
  cdnBase: string;
  build: string;
  dataBuild: string;
  manifestVersion: string;
  syncedAt: string;
  totalFiles: number;
  totalBytes: number;
  counts: {
    ninjas: number;
    ninjasWithStats: number;
    ninjasWithHdSpine: number;
    summons: number;
    summonFragments: number;
    spineModels: number;
    spineEffects: number;
    anim2d: number;
    videos: number;
    skillIcons: number;
    audio: number;
    techniques: number;
    items: number;
    statusEffects: number;
    visualAssets: number;
    visualItems: number;
    fontAssets: number;
    encryptedTables: number;
  };
  audioByCategory: Record<string, number>;
  spineByKind: Record<string, number>;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface SpineAtlasRegion {
  name: string;
  page: string;
  x: number;
  y: number;
  width: number;
  height: number;
  origWidth: number;
  origHeight: number;
  offsetX: number;
  offsetY: number;
  rotate: boolean;
}

export interface SpineInspectionResult {
  skeleton: {
    hash?: string;
    spine?: string;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    fps?: number;
  };
  bonesCount: number;
  slotsCount: number;
  skins: string[];
  animations: Array<{
    name: string;
    duration: number;
    keyframeCount: number;
    attachmentFrames: Array<{ time: number; slot: string; attachment: string | null }>;
  }>;
  pages: Array<{
    filename: string;
    imageUrl: string;
    width: number;
    height: number;
  }>;
  regions: SpineAtlasRegion[];
  rawSkeleton: Record<string, unknown>;
}

export interface Anim2DInspectionResult {
  imageUrl: string;
  frames: Array<{
    name: string;
    x: number;
    y: number;
    w: number;
    h: number;
    rotated: boolean;
  }>;
}

export interface ZipExportItem {
  type: 'ninja' | 'summon' | 'spine' | 'anim2d' | 'audio' | 'video';
  id: string;
  label: string;
  estimatedBytes: number;
  fileCount: number;
}

export interface ZipExportRequest {
  archiveName?: string;
  imageFormat: 'webp' | 'png' | 'both';
  includeDatabase: boolean;
  preset?: 'queue' | 'database_only' | 'summons_pack' | 'dubs_pack' | 'featured_ninjas' | 'effects_pack';
  ninjaIds?: string[];
  summonIds?: string[];
  spineIds?: string[];
  anim2dIds?: string[];
  audioIds?: string[];
  videoIds?: string[];
  includeNinjaPortraits?: boolean;
  includeNinjaSpine?: boolean;
  includeNinjaAudio?: boolean;
}
