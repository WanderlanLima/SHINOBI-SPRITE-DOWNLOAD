import { ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type FullCatalog, queryTechniques } from '../services/catalogEngine';
import { downloadDatabaseFile } from '../services/clientZipper';
import { formatNumber } from '../utils/format';

interface TechniquesViewProps {
  catalog: FullCatalog;
  onOpenNinjaById: (heroId: string) => void;
}

const SKILL_TYPES = ['all', 'Esotérica', 'Ataque Básico', 'Perseguição', 'Passiva', 'Especial'] as const;
const EFFECT_FILTERS = [
  'all',
  'Flutuação',
  'Queda',
  'Voo / Repulsão',
  'Queimadura',
  'Veneno',
  'Imobilidade',
  'Confusão',
  'Cura',
  'Escudo',
  'Chakra',
  'Invoca Clone',
] as const;

export function TechniquesView({ catalog, onOpenNinjaById }: TechniquesViewProps) {
  const [q, setQ] = useState('');
  const [skillType, setSkillType] = useState('all');
  const [effect, setEffect] = useState('all');
  const [page, setPage] = useState(1);

  const data = useMemo(
    () => queryTechniques(catalog, { q, skillType, effect, page, limit: 35 }),
    [catalog, q, skillType, effect, page]
  );

  return (
    <div className="space-y-5">
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
              placeholder="Buscar técnica, efeito, multiplicador (ex: 165%, Clone, Chakra)..."
              className="w-full pl-9 pr-3 py-2.5 text-sm bg-[#13161F] border border-[#242A3B] focus:border-[#EA580C] rounded-lg text-white placeholder:text-[#6F788E] outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={effect}
              onChange={(e) => {
                setPage(1);
                setEffect(e.target.value);
              }}
              className="px-3 py-2 text-xs bg-[#13161F] border border-[#242A3B] rounded-lg text-[#D7DCE8] outline-none"
            >
              {EFFECT_FILTERS.map((ef) => (
                <option key={ef} value={ef}>
                  {ef === 'all' ? 'Todos os efeitos' : `Efeito: ${ef}`}
                </option>
              ))}
            </select>

            <button
              onClick={() => downloadDatabaseFile(catalog, 'csv', 'techniques')}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#D7DCE8] bg-[#161A24] hover:bg-[#1F2534] border border-[#242A3B] rounded-lg whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              CSV Técnicas
            </button>

            <button
              onClick={() => downloadDatabaseFile(catalog, 'csv', 'ninjas')}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-[#EA580C] hover:bg-[#C2410C] rounded-lg whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              CSV Atributos
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-[#13161F] border border-[#222736] rounded-lg">
            {SKILL_TYPES.map((st) => (
              <button
                key={st}
                onClick={() => {
                  setPage(1);
                  setSkillType(st);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  skillType === st ? 'bg-[#EA580C] text-white' : 'text-[#9CA5B9] hover:text-white'
                }`}
              >
                {st === 'all' ? 'Todos os Tipos' : st}
              </button>
            ))}
          </div>

          <div className="text-xs font-mono tabular-nums text-[#8E97AB]">
            {formatNumber(data.total)} técnicas registradas
          </div>
        </div>
      </div>

      <div className="bg-[#13161F] border border-[#222736] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#222736] bg-[#0F1219] text-xs text-[#8E97AB]">
                <th className="py-3 px-4 font-medium">Técnica / ID</th>
                <th className="py-3 px-3 font-medium">Tipo</th>
                <th className="py-3 px-3 font-medium">Ninja</th>
                <th className="py-3 px-3 font-medium">Multiplicadores / Efeitos</th>
                <th className="py-3 px-4 font-medium">Descrição Oficial (PT-BR)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1C2130] text-sm align-top">
              {data.items.map((t) => (
                <tr key={t.id} className="hover:bg-[#171B26] transition-colors">
                  <td className="py-3 px-4 whitespace-nowrap">
                    <div className="font-medium text-white text-xs">{t.name}</div>
                    <div className="font-mono text-[11px] text-[#7C859B] mt-0.5">{t.id}</div>
                  </td>
                  <td className="py-3 px-3 whitespace-nowrap text-xs font-medium text-[#F97316]">
                    {t.skillType}
                  </td>
                  <td className="py-3 px-3 whitespace-nowrap text-xs">
                    {t.heroId ? (
                      <button
                        onClick={() => onOpenNinjaById(t.heroId!)}
                        className="text-[#D7DCE8] hover:text-[#F97316] underline decoration-[#384159] underline-offset-2 transition-colors"
                      >
                        {t.heroName || `Ninja #${t.heroId}`}
                      </button>
                    ) : (
                      <span className="text-[#6F788E]">—</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-xs font-mono tabular-nums text-[#C9D1E1] min-w-[160px]">
                    {t.multipliers.length > 0 && <div>{t.multipliers.join(' · ')}</div>}
                    {t.effects.length > 0 && (
                      <div className="text-[11px] font-sans text-[#98A1B5] mt-0.5">
                        {t.effects.join(' · ')}
                      </div>
                    )}
                    {t.multipliers.length === 0 && t.effects.length === 0 && (
                      <span className="text-[#6F788E]">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-xs text-[#B6BFCF] leading-relaxed min-w-[280px] max-w-xl whitespace-pre-line">
                    {t.desc || '—'}
                  </td>
                </tr>
              ))}
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
