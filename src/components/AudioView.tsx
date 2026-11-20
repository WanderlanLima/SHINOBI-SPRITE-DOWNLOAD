import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileArchive,
  Pause,
  Play,
  Plus,
  Search,
  Volume2,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { isZipBackupUrl, resolvePlayableUrl } from '../services/assetSource';
import { type FullCatalog, queryAudio } from '../services/catalogEngine';
import { downloadCustomRequestZip, type ZipProgress } from '../services/clientZipper';
import type { AudioRecord } from '../types';
import { formatBytes, formatNumber, resolveCdnUrl } from '../utils/format';

interface AudioViewProps {
  catalog: FullCatalog;
  queuedIds: Set<string>;
  onToggleQueue: (audio: AudioRecord) => void;
}

const AUDIO_CATEGORIES = [
  ['all', 'Todos'],
  ['dublagem_falas', 'Dublagem (Falas)'],
  ['dublagem_esoterica', 'Dublagem (Esotérica)'],
  ['dublagem_derrota', 'Dublagem (Derrota)'],
  ['dublagem_historia', 'História'],
  ['efeitos_habilidades', 'Efeitos e Habilidades'],
  ['vozes_combate', 'Vozes de Combate'],
] as const;

export function AudioView({ catalog, queuedIds, onToggleQueue }: AudioViewProps) {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('all');
  const [page, setPage] = useState(1);
  const [activeTrack, setActiveTrack] = useState<AudioRecord | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [exportingDubs, setExportingDubs] = useState(false);
  const [progress, setProgress] = useState<ZipProgress | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const cdnBase = catalog.summary.cdnBase;
  const data = useMemo(
    () => queryAudio(catalog, { q, category, page, limit: 45 }),
    [catalog, q, category, page]
  );

  const handlePlayToggle = async (track: AudioRecord) => {
    const el = audioRef.current;
    if (!el) return;

    if (activeTrack?.id === track.id) {
      if (isPlaying) {
        el.pause();
        setIsPlaying(false);
      } else {
        el.play().catch(() => {});
        setIsPlaying(true);
      }
      return;
    }

    setActiveTrack(track);
    const rawUrl = resolveCdnUrl(cdnBase, track.url);
    const playable = await resolvePlayableUrl(rawUrl);
    if (!playable) {
      setIsPlaying(false);
      return;
    }
    el.src = playable;
    el.play()
      .then(() => setIsPlaying(true))
      .catch(() => setIsPlaying(false));
  };

  const handleDownloadTrack = async (track: AudioRecord) => {
    const rawUrl = resolveCdnUrl(cdnBase, track.url);
    const resolved = isZipBackupUrl(rawUrl) ? await resolvePlayableUrl(rawUrl) : rawUrl;
    if (!resolved) return;
    const a = document.createElement('a');
    a.href = resolved;
    a.download = track.filename;
    a.target = '_blank';
    a.rel = 'noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleDownloadDubsPack = async () => {
    setExportingDubs(true);
    setProgress(null);
    try {
      await downloadCustomRequestZip(
        catalog,
        {
          archiveName: 'naruto_jotagame_dublagens_e_falas',
          imageFormat: 'webp',
          includeDatabase: true,
          preset: 'dubs_pack',
        },
        (p) => setProgress(p)
      );
    } finally {
      setExportingDubs(false);
      setProgress(null);
    }
  };

  return (
    <div className="space-y-5">
      <audio
        ref={audioRef}
        onEnded={() => setIsPlaying(false)}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
      />

      <div className="flex flex-col gap-3 pb-4 border-b border-[#1E2331]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-[#7C859B] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={q}
              onChange={(e) => {
                setPage(1);
                setQ(e.target.value);
              }}
              placeholder="Buscar áudio por nome, ID do ninja ou arquivo..."
              className="w-full pl-9 pr-3 py-2.5 text-sm bg-[#13161F] border border-[#242A3B] focus:border-[#EA580C] rounded-lg text-white placeholder:text-[#6F788E] outline-none"
            />
          </div>

          <button
            onClick={handleDownloadDubsPack}
            disabled={exportingDubs}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium text-white bg-[#EA580C] hover:bg-[#C2410C] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
          >
            <FileArchive className="w-4 h-4" />
            {exportingDubs && progress
              ? `Compactando ${progress.completed}/${progress.total}...`
              : exportingDubs
              ? 'Compactando Dublagens...'
              : 'Exportar Pacote de Dublagens (ZIP)'}
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-[#13161F] border border-[#222736] rounded-lg">
            {AUDIO_CATEGORIES.map(([key, label]) => (
              <button
                key={key}
                onClick={() => {
                  setPage(1);
                  setCategory(key);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  category === key ? 'bg-[#EA580C] text-white' : 'text-[#9CA5B9] hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="text-xs font-mono tabular-nums text-[#8E97AB]">
            {formatNumber(data.total)} arquivos de áudio
          </div>
        </div>
      </div>

      {activeTrack && (
        <div className="px-4 py-3 bg-[#151924] border border-[#EA580C]/40 rounded-xl flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => handlePlayToggle(activeTrack)}
              className="w-10 h-10 rounded-lg bg-[#EA580C] hover:bg-[#C2410C] text-white flex items-center justify-center shrink-0"
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <div className="min-w-0">
              <div className="text-sm font-mono text-white truncate">{activeTrack.filename}</div>
              <div className="text-xs text-[#98A1B5]">
                {activeTrack.categoryLabel}
                {activeTrack.heroName ? ` · ${activeTrack.heroName}` : ''} ·{' '}
                {formatBytes(activeTrack.bytes)}
              </div>
            </div>
          </div>

          <button
            onClick={() => handleDownloadTrack(activeTrack)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-[#1F2536] hover:bg-[#2A3248] rounded-lg whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Baixar MP3
          </button>
        </div>
      )}

      <div className="bg-[#13161F] border border-[#222736] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#222736] bg-[#0F1219] text-xs text-[#8E97AB]">
                <th className="py-3 px-4 font-medium w-12">Tocar</th>
                <th className="py-3 px-3 font-medium">Arquivo</th>
                <th className="py-3 px-3 font-medium">Categoria / Pasta ZIP</th>
                <th className="py-3 px-3 font-medium">Ninja Vinculado</th>
                <th className="py-3 px-3 font-medium text-right">Tamanho</th>
                <th className="py-3 px-4 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1C2130] text-sm">
              {data.items.map((aud) => {
                const playingThis = activeTrack?.id === aud.id && isPlaying;
                const queued = queuedIds.has(aud.id);
                return (
                  <tr key={aud.id} className="hover:bg-[#171B26] transition-colors">
                    <td className="py-2.5 px-4">
                      <button
                        onClick={() => handlePlayToggle(aud)}
                        aria-label={`Tocar ${aud.filename}`}
                        className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                          playingThis
                            ? 'bg-[#EA580C] text-white'
                            : 'bg-[#1B202E] text-[#C9D1E1] hover:bg-[#272E42] hover:text-white'
                        }`}
                      >
                        {playingThis ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      </button>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-xs text-white">
                      <div className="flex items-center gap-2">
                        <Volume2 className="w-3.5 h-3.5 text-[#7C859B] shrink-0" />
                        <span className="truncate max-w-xs">{aud.filename}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-xs text-[#98A1B5] whitespace-nowrap">
                      {aud.categoryLabel}{' '}
                      <span className="font-mono text-[#6F788E]">({aud.category})</span>
                    </td>
                    <td className="py-2.5 px-3 text-xs text-[#D7DCE8] whitespace-nowrap">
                      {aud.heroName || '—'}
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-right text-xs text-[#8E97AB]">
                      {formatBytes(aud.bytes)}
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          onClick={() => handleDownloadTrack(aud)}
                          className="p-2 text-[#9CA5B9] hover:text-white bg-[#1B202E] rounded-md"
                          title="Baixar MP3"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onToggleQueue(aud)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md ${
                            queued
                              ? 'bg-[#16A34A]/20 text-[#86EFAC]'
                              : 'bg-[#1B202E] text-[#D7DCE8] hover:bg-[#262D40]'
                          }`}
                        >
                          {queued ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                          {queued ? 'Na Fila' : 'ZIP'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {data.totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs font-mono tabular-nums text-[#8E97AB]">
            Página {data.page} de {data.totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={data.page <= 1}
              className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-[#D7DCE8] bg-[#13161F] border border-[#242A3B] hover:bg-[#1C2130] disabled:opacity-40 rounded-lg"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Anterior
            </button>
            <button
              onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
              disabled={data.page >= data.totalPages}
              className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-[#D7DCE8] bg-[#13161F] border border-[#242A3B] hover:bg-[#1C2130] disabled:opacity-40 rounded-lg"
            >
              Próxima
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
