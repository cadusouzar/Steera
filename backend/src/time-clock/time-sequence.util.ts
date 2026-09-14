import { TimeEventType } from '@prisma/client';

// Não é uma sequência posicional fixa — decide a partir do ÚLTIMO evento aberto do funcionário.
// "Aberto" = ainda não teve seu par de fechamento (CLOCK_IN sem CLOCK_OUT, BREAK_START sem
// BREAK_END, EXTRA_IN sem EXTRA_OUT) considerando TODOS os eventos do dia/jornada corrente, na
// ordem em que ocorreram — não só o último evento isolado. Isso corrige o bug real do front mockado
// que este módulo substitui (`punchSequence[liveTodayPunches.length]`, um índice posicional fixo
// que quebra silenciosamente assim que qualquer batida fica faltando).
export interface OpenState {
  clockOpen: boolean;
  breakOpen: boolean;
  extraOpen: boolean;
}

export function computeOpenState(eventsInOrder: { type: TimeEventType }[]): OpenState {
  let clockOpen = false;
  let breakOpen = false;
  let extraOpen = false;
  for (const e of eventsInOrder) {
    switch (e.type) {
      case 'CLOCK_IN':
        clockOpen = true;
        break;
      case 'CLOCK_OUT':
        clockOpen = false;
        break;
      case 'BREAK_START':
        breakOpen = true;
        break;
      case 'BREAK_END':
        breakOpen = false;
        break;
      case 'EXTRA_IN':
        extraOpen = true;
        break;
      case 'EXTRA_OUT':
        extraOpen = false;
        break;
    }
  }
  return { clockOpen, breakOpen, extraOpen };
}

export function getNextAllowedType(state: OpenState, allowExtraPeriods: boolean): TimeEventType | null {
  void allowExtraPeriods; // não influencia a "próxima ação sugerida" — só a lista completa em validateTransition
  if (!state.clockOpen) return 'CLOCK_IN';
  if (state.breakOpen) return 'BREAK_END';
  if (state.extraOpen) return 'EXTRA_OUT';
  // Jornada aberta, sem intervalo/extra em andamento: pode sair, começar intervalo, ou (se
  // permitido) iniciar período extra. CLOCK_OUT é a sugestão "primária" — o front oferece as
  // outras opções (BREAK_START/EXTRA_IN) como alternativas; ver validateTransition abaixo para a
  // lista completa de transições válidas neste estado.
  return 'CLOCK_OUT';
}

// O tipo de retorno inclui 'PENDING_REVIEW' pra casar com o contrato documentado (consumido tal
// qual pelas Tasks 7/8/9) — a lógica atual nunca produz esse valor (toda decisão de
// PENDING_REVIEW nesta task vem de foto/localização, resolvida em TimeClockService, não da
// sequência em si); reservado pra uma extensão futura da própria máquina de estados.
export function validateTransition(
  state: OpenState,
  requestedType: TimeEventType,
  allowExtraPeriods: boolean,
): 'VALID' | 'INVALID' | 'PENDING_REVIEW' {
  if (requestedType === 'CLOCK_IN') return state.clockOpen ? 'INVALID' : 'VALID';
  if (requestedType === 'CLOCK_OUT') return state.clockOpen && !state.breakOpen && !state.extraOpen ? 'VALID' : 'INVALID';
  if (requestedType === 'BREAK_START') return state.clockOpen && !state.breakOpen && !state.extraOpen ? 'VALID' : 'INVALID';
  if (requestedType === 'BREAK_END') return state.breakOpen ? 'VALID' : 'INVALID';
  if (requestedType === 'EXTRA_IN') {
    return allowExtraPeriods && state.clockOpen && !state.breakOpen && !state.extraOpen ? 'VALID' : 'INVALID';
  }
  if (requestedType === 'EXTRA_OUT') return state.extraOpen ? 'VALID' : 'INVALID';
  return 'INVALID';
}
