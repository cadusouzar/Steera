// Base de referência — feriados nacionais e os estaduais mais amplamente reconhecidos, pesquisada
// em 14/09/2026. NÃO é uma fonte oficial autoatualizável: leis estaduais específicas podem mudar
// (ex.: Paraná revogou seu único feriado estadual em 2014 via Lei 18.384/2014 — por isso não tem
// entrada abaixo); revisar periodicamente. Feriados municipais não são cobertos (inviável manter
// uma base exaustiva) — a empresa complementa via HolidaysController (escopo COMPANY).

// Algoritmo de Gauss/computus anônimo — calcula o Domingo de Páscoa pra qualquer ano do
// calendário gregoriano. Fórmula padrão, sem dependência externa.
export function computeEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function getNationalAndMovableHolidays(year: number): { date: Date; name: string }[] {
  const easter = computeEasterSunday(year);
  return [
    { date: new Date(Date.UTC(year, 0, 1)), name: 'Confraternização Universal' },
    // Âncora do calendário litúrgico: Quarta-feira de Cinzas é sempre Páscoa - 46 dias (fato fixo,
    // independente do ano) — logo Carnaval é terça = Páscoa - 47, segunda = Páscoa - 48. O brief
    // original desta task tinha -47/-46 (nessa ordem) pras duas datas, o que faz a "terça-feira"
    // calculada cair em cima da própria Quarta-feira de Cinzas (bug pego rodando o teste do Passo 2
    // contra a implementação: o teste do brief já esperava 2026-02-16 pra segunda-feira, só o
    // offset da implementação estava errado) — corrigido aqui pra -48/-47.
    { date: addDays(easter, -48), name: 'Carnaval (segunda-feira)' },
    { date: addDays(easter, -47), name: 'Carnaval (terça-feira)' },
    { date: addDays(easter, -2), name: 'Sexta-feira Santa' },
    { date: addDays(easter, 60), name: 'Corpus Christi' },
    { date: new Date(Date.UTC(year, 3, 21)), name: 'Tiradentes' },
    { date: new Date(Date.UTC(year, 4, 1)), name: 'Dia do Trabalho' },
    { date: new Date(Date.UTC(year, 8, 7)), name: 'Independência do Brasil' },
    { date: new Date(Date.UTC(year, 9, 12)), name: 'Nossa Senhora Aparecida' },
    { date: new Date(Date.UTC(year, 10, 2)), name: 'Finados' },
    { date: new Date(Date.UTC(year, 10, 15)), name: 'Proclamação da República' },
    { date: new Date(Date.UTC(year, 10, 20)), name: 'Consciência Negra (data nacional desde 2023)' },
    { date: new Date(Date.UTC(year, 11, 25)), name: 'Natal' },
  ];
}

// Uma entrada é uma data fixa (mês/dia) OU relativa à Páscoa (easterOffset, mesmo mecanismo dos
// feriados móveis nacionais acima) — só o Espírito Santo usa a segunda forma hoje (Nossa Senhora
// da Penha, sempre numa segunda-feira, 8 dias após o Domingo de Páscoa).
type FixedStateHoliday = { month: number; day: number; name: string };
type MovableStateHoliday = { easterOffset: number; name: string };
type StateHolidayDef = FixedStateHoliday | MovableStateHoliday;

// Base curada dos feriados estaduais mais amplamente reconhecidos, por UF — não exaustiva, revisão
// periódica recomendada. Ver o relatório da Task 3 (task-3-report.md) para a fonte/confiança de
// cada linha (conhecimento de treinamento vs. pesquisa web em 14/09/2026, com URL quando aplicável).
// MT e PR ficam deliberadamente de fora (array vazio implícito, via `?? []` em getStateHolidays):
// MT só tem uma data cívica comemorativa SEM dispensa de trabalho (Lei 8007/2003 é explícita
// nisso); PR revogou seu único feriado estadual (19/dez) em 2014 (Lei 18.384/2014) e não tem
// nenhum outro atualmente.
const STATE_HOLIDAYS: Record<string, StateHolidayDef[]> = {
  AC: [{ month: 6, day: 15, name: 'Aniversário do Estado do Acre' }],
  AL: [{ month: 9, day: 16, name: 'Emancipação Política de Alagoas' }],
  AP: [{ month: 10, day: 5, name: 'Criação do Estado do Amapá' }],
  AM: [{ month: 9, day: 5, name: 'Elevação do Amazonas à Categoria de Província' }],
  BA: [{ month: 7, day: 2, name: 'Independência da Bahia' }],
  CE: [{ month: 3, day: 25, name: 'Data Magna do Ceará (Abolição da Escravatura no Ceará)' }],
  DF: [{ month: 4, day: 21, name: 'Fundação de Brasília' }],
  ES: [{ easterOffset: 8, name: 'Nossa Senhora da Penha' }],
  GO: [{ month: 7, day: 26, name: 'Fundação da Cidade de Goiás (Data Magna)' }],
  MA: [{ month: 7, day: 28, name: 'Adesão do Maranhão à Independência do Brasil' }],
  MT: [],
  MS: [{ month: 10, day: 11, name: 'Criação do Estado de Mato Grosso do Sul' }],
  MG: [{ month: 4, day: 21, name: 'Data Magna de Minas Gerais (Tiradentes)' }],
  PA: [{ month: 8, day: 15, name: 'Adesão do Grão-Pará à Independência do Brasil' }],
  PB: [{ month: 8, day: 5, name: 'Fundação do Estado da Paraíba' }],
  PR: [],
  PE: [{ month: 3, day: 6, name: 'Data Magna de Pernambuco (Revolução Pernambucana de 1817)' }],
  PI: [{ month: 10, day: 19, name: 'Dia do Piauí' }],
  RJ: [{ month: 4, day: 23, name: 'Dia de São Jorge' }],
  RN: [{ month: 10, day: 3, name: 'Mártires de Cunhaú e Uruaçu' }],
  RS: [{ month: 9, day: 20, name: 'Revolução Farroupilha' }],
  RO: [{ month: 1, day: 4, name: 'Criação do Estado de Rondônia' }],
  RR: [{ month: 10, day: 5, name: 'Elevação a Estado de Roraima' }],
  SC: [{ month: 8, day: 11, name: 'Dia do Estado de Santa Catarina (Data Magna)' }],
  SP: [{ month: 7, day: 9, name: 'Revolução Constitucionalista de 1932' }],
  SE: [{ month: 7, day: 8, name: 'Emancipação Política de Sergipe' }],
  TO: [{ month: 10, day: 5, name: 'Criação do Estado do Tocantins' }],
};

export function getStateHolidays(state: string, year: number): { date: Date; name: string }[] {
  const entries = STATE_HOLIDAYS[state.toUpperCase()] ?? [];
  const easter = computeEasterSunday(year);
  return entries.map((e) =>
    'easterOffset' in e
      ? { date: addDays(easter, e.easterOffset), name: e.name }
      : { date: new Date(Date.UTC(year, e.month - 1, e.day)), name: e.name },
  );
}
