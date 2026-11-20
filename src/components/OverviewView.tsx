import {
  ArrowRight,
  Database,
  Download,
  FileArchive,
  RefreshCw,
  Smartphone,
} from 'lucide-react';
import { useState } from 'react';
import type { FullCatalog } from '../services/catalogEngine';
import {
  downloadCustomRequestZip,
  downloadDatabaseFile,
  type ZipProgress,
} from '../services/clientZipper';
import type { ZipExportRequest } from '../types';
import { formatBytes, formatNumber } from '../utils/format';

export type NavSection =
  | 'overview'
  | 'ninjas'
  | 'summons'
  | 'spines'
  | 'effects'
  | 'audio'
  | 'techniques'
  | 'exporter';

interface OverviewViewProps {
  catalog: FullCatalog;
  syncing: boolean;
  onSync: () => void;
  onNavigate: (section: NavSection) => void;
}

export function OverviewView({ catalog, syncing, onSync, onNavigate }: OverviewViewProps) {
  const { summary } = catalog;
  const [busyPreset, setBusyPreset] = useState<string | null>(null);
  const [presetProgress, setPresetProgress] = useState<ZipProgress | null>(null);
  const [presetError, setPresetError] = useState<string | null>(null);

  const runPreset = async (key: string, req: ZipExportRequest) => {
    setBusyPreset(key);
    setPresetProgress(null);
    setPresetError(null);
    try {
      await downloadCustomRequestZip(catalog, req, (p) => setPresetProgress(p));
    } catch (e) {
      setPresetError(e instanceof Error ? e.message : 'Erro ao exportar pacote.');
    } finally {
      setBusyPreset(null);
      setPresetProgress(null);
    }
  };

  const categoryRows: Array<{
    section: NavSection;
    title: string;
    folder: string;
    count: number;
    detail: string;
  }> = [
    {
      section: 'ninjas',
      title: 'Ninjas e Retratos',
      folder: '01_ninjas/<id>_<nome>/',
      count: summary.counts.ninjas,
      detail: `${formatNumber(summary.counts.ninjasWithStats)} com ficha/atributos · ${formatNumber(summary.counts.ninjasWithHdSpine)} com Spine HD`,
    },
    {
      section: 'summons',
      title: 'Invocações (Bijuus e Bestas)',
      folder: '02_invocacoes/<nome>/',
      count: summary.counts.summons,
      detail: `50 skeletons Spine 3.8 + ${formatNumber(summary.counts.summonFragments)} ícones de fragmentos`,
    },
    {
      section: 'spines',
      title: 'Animações de Sprites (Spine 3.8)',
      folder: '03_animacoes_sprites/',
      count: summary.counts.spineModels,
      detail: `${formatNumber(summary.spineByKind.personagem || 0)} combate · ${formatNumber(summary.spineByKind.retrato || 0)} retratos · ${formatNumber(summary.spineByKind.hd || 0)} HD`,
    },
    {
      section: 'effects',
      title: 'Habilidades, Efeitos e Esotéricas',
      folder: '04_habilidades_efeitos/',
      count: summary.counts.spineEffects + summary.counts.anim2d + summary.counts.videos,
      detail: `${formatNumber(summary.counts.spineEffects)} efeitos Spine · ${formatNumber(summary.counts.anim2d)} atlases 2D · ${formatNumber(summary.counts.videos)} vídeos MP4 · ${formatNumber(summary.counts.skillIcons)} ícones`,
    },
    {
      section: 'audio',
      title: 'Sons e Dublagens (MP3)',
      folder: '05_sons_e_dublagens/',
      count: summary.counts.audio,
      detail: `${formatNumber(summary.audioByCategory.dublagem_falas || 0)} falas · ${formatNumber(summary.audioByCategory.dublagem_esoterica || 0)} esotéricas · ${formatNumber(summary.audioByCategory.vozes_combate || 0)} combate`,
    },
    {
      section: 'techniques',
      title: 'Técnicas, Atributos e Estatísticas',
      folder: '00_banco_de_dados/',
      count: summary.counts.techniques,
      detail: `${formatNumber(summary.counts.techniques)} descrições em PT-BR · ${formatNumber(summary.counts.items)} itens indexados`,
    },
  ];

  const presets: Array<{
    key: string;
    title: string;
    subtitle: string;
    payload: ZipExportRequest;
  }> = [
    {
      key: 'database_only',
      title: 'Banco de Dados Completo',
      subtitle: 'JSON estruturado + planilhas CSV de ninjas, atributos, técnicas, invocações e índices de áudio.',
      payload: {
        archiveName: 'naruto_jotagame_banco_de_dados',
        imageFormat: 'webp',
        includeDatabase: true,
        preset: 'database_only',
      },
    },
    {
      key: 'summons_pack',
      title: 'Todas as 50 Invocações + Fragmentos',
      subtitle: 'Skeletons Spine 3.8 (.json, .atlas), spritesheets WebP e ícones organizados em 02_invocacoes/.',
      payload: {
        archiveName: 'naruto_jotagame_invocacoes',
        imageFormat: 'webp',
        includeDatabase: true,
        preset: 'summons_pack',
      },
    },
    {
      key: 'dubs_pack',
      title: 'Pacote Dublagens e Falas (MP3)',
      subtitle: 'Falas de personagens, gritos de esotérica (AFaoyi) e áudios de derrota organizados por pasta.',
      payload: {
        archiveName: 'naruto_jotagame_dublagens',
        imageFormat: 'webp',
        includeDatabase: true,
        preset: 'dubs_pack',
      },
    },
    {
      key: 'featured_ninjas',
      title: '15 Ninjas Nomeados (Sprites + HD + Áudio)',
      subtitle: 'Pastas individuais por ninja contendo ficha JSON, retratos, Spine HD, batalha e dublagens.',
      payload: {
        archiveName: 'naruto_jotagame_ninjas_destaque',
        imageFormat: 'webp',
        includeDatabase: true,
        preset: 'featured_ninjas',
      },
    },
  ];

  return (
    <div className="space-y-8">
      {/* Intro Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-6 border-b border-[#1E2331]">
        <div className="max-w-3xl">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white [text-wrap:balance]">
            Acervo Indexado de naruto.jotagame.com
          </h1>
          <p className="text-sm text-[#98A1B5] mt-2 leading-relaxed">
            Site 100% estático pronto para GitHub Pages. Pesquise ninjas, reproduza animações Spine
            3.8 e 2D ao vivo, escute dublagens e baixe todo o acervo organizado em ZIP diretamente
            no celular ou computador.
          </p>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-mono tabular-nums text-[#7C859B] mt-3">
            <span>Build {summary.build}</span>
            <span aria-hidden="true">·</span>
            <span>Manifesto {summary.manifestVersion.slice(0, 12)}</span>
            <span aria-hidden="true">·</span>
            <span>CDN {summary.cdnBase}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            onClick={onSync}
            disabled={syncing}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium text-[#D7DCE8] bg-[#161A24] hover:bg-[#1F2534] border border-[#252B3B] rounded-lg transition-colors whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Recarregando...' : 'Recarregar CDN'}
          </button>
          <button
            onClick={() => downloadDatabaseFile(catalog, 'json')}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 text-xs font-medium text-[#D7DCE8] bg-[#161A24] hover:bg-[#1F2534] border border-[#252B3B] rounded-lg transition-colors whitespace-nowrap"
          >
            <Database className="w-3.5 h-3.5" />
            JSON Completo
          </button>
          <button
            onClick={() => onNavigate('exporter')}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-white bg-[#EA580C] hover:bg-[#C2410C] rounded-lg transition-colors whitespace-nowrap"
          >
            <Smartphone className="w-4 h-4" />
            Download Completo no Celular
          </button>
        </div>
      </div>

      {/* 4-Column Metric Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#13161F] border border-[#222736] rounded-xl p-4">
          <div className="text-xs text-[#8E97AB]">Arquivos no Manifesto</div>
          <div className="text-2xl font-semibold font-mono tabular-nums text-white mt-1.5">
            {formatNumber(summary.totalFiles)}
          </div>
          <div className="text-xs font-mono tabular-nums text-[#7C859B] mt-1">
            Volume total: {formatBytes(summary.totalBytes)}
          </div>
        </div>

        <div className="bg-[#13161F] border border-[#222736] rounded-xl p-4">
          <div className="text-xs text-[#8E97AB]">Ninjas e Invocações</div>
          <div className="text-2xl font-semibold font-mono tabular-nums text-white mt-1.5">
            {formatNumber(summary.counts.ninjas)} / {formatNumber(summary.counts.summons)}
          </div>
          <div className="text-xs font-mono tabular-nums text-[#7C859B] mt-1">
            {formatNumber(summary.counts.ninjasWithHdSpine)} ninjas com Spine HD
          </div>
        </div>

        <div className="bg-[#13161F] border border-[#222736] rounded-xl p-4">
          <div className="text-xs text-[#8E97AB]">Animações e Efeitos</div>
          <div className="text-2xl font-semibold font-mono tabular-nums text-white mt-1.5">
            {formatNumber(summary.counts.spineModels + summary.counts.anim2d)}
          </div>
          <div className="text-xs font-mono tabular-nums text-[#7C859B] mt-1">
            {formatNumber(summary.counts.videos)} vídeos MP4 · {formatNumber(summary.counts.skillIcons)} ícones
          </div>
        </div>

        <div className="bg-[#13161F] border border-[#222736] rounded-xl p-4">
          <div className="text-xs text-[#8E97AB]">Sons, Dublagens e Técnicas</div>
          <div className="text-2xl font-semibold font-mono tabular-nums text-white mt-1.5">
            {formatNumber(summary.counts.audio)}
          </div>
          <div className="text-xs font-mono tabular-nums text-[#7C859B] mt-1">
            {formatNumber(summary.counts.techniques)} técnicas em Português
          </div>
        </div>
      </div>

      {/* Directory Index Table */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-white">
            Estrutura do Banco de Dados e Pastas de Exportação
          </h2>
          <button
            onClick={() => onNavigate('exporter')}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#F97316] hover:text-[#FB923C] transition-colors whitespace-nowrap"
          >
            Abrir Exportador ZIP
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="bg-[#13161F] border border-[#222736] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#222736] bg-[#0F1219] text-xs text-[#8E97AB]">
                  <th className="py-3 px-4 font-medium">Categoria</th>
                  <th className="py-3 px-4 font-medium">Pasta dentro do ZIP</th>
                  <th className="py-3 px-4 font-medium text-right">Registros</th>
                  <th className="py-3 px-4 font-medium">Detalhamento</th>
                  <th className="py-3 px-4 font-medium text-right">Acesso</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1C2130] text-sm">
                {categoryRows.map((row) => (
                  <tr key={row.section} className="hover:bg-[#171B26] transition-colors">
                    <td className="py-3.5 px-4 font-medium text-white whitespace-nowrap">
                      {row.title}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs text-[#F97316] whitespace-nowrap">
                      {row.folder}
                    </td>
                    <td className="py-3.5 px-4 font-mono tabular-nums text-right text-white">
                      {formatNumber(row.count)}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-[#98A1B5]">{row.detail}</td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <button
                        onClick={() => onNavigate(row.section)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-[#D7DCE8] hover:text-white transition-colors"
                      >
                        Explorar
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Quick Organized ZIP Packs */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-white">
              Pacotes ZIP Organizados em 1 Clique
            </h2>
            <p className="text-xs text-[#8E97AB] mt-0.5">
              Gerados diretamente no navegador — funcionam sem servidor no GitHub Pages e no celular.
            </p>
          </div>
          {presetError && <span className="text-xs text-[#FCA5A5]">{presetError}</span>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {presets.map((p) => {
            const isBusy = busyPreset === p.key;
            return (
              <div
                key={p.key}
                className="bg-[#13161F] border border-[#222736] rounded-xl p-5 flex flex-col justify-between gap-4"
              >
                <div>
                  <h3 className="text-sm font-semibold text-white">{p.title}</h3>
                  <p className="text-xs text-[#98A1B5] mt-1.5 leading-relaxed">{p.subtitle}</p>
                </div>
                <div className="flex items-center justify-between gap-3 pt-3 border-t border-[#1E2331]">
                  <span className="text-[11px] font-mono text-[#7C859B] truncate">
                    {isBusy && presetProgress
                      ? `${presetProgress.completed}/${presetProgress.total} · ${formatBytes(presetProgress.bytesDownloaded)}`
                      : `${p.payload.archiveName}.zip`}
                  </span>
                  <button
                    onClick={() => runPreset(p.key, p.payload)}
                    disabled={busyPreset !== null}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-[#1F2536] hover:bg-[#EA580C] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    {isBusy ? (
                      <>
                        <Download className="w-3.5 h-3.5 animate-bounce" />
                        Gerando ZIP...
                      </>
                    ) : (
                      <>
                        <FileArchive className="w-3.5 h-3.5" />
                        Baixar ZIP
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
