import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, ChevronLeft, ChevronRight, MapPin, Paperclip, Undo2, Wrench, X } from 'lucide-react';
import { StatusBadge, type StatusTone } from '../../../ui';
import type { TourViewProps } from '../tourTypes';
import { Backdrop, FakeButton, FakeField, TourDrawer, TourModal } from './tourParts';
import { EASE, useRise } from './tourMotion';

// Cena "Bater ponto" do tour (roteiro `ponto` do esboço): a tela do funcionário (pages/app/
// TimeTracking) — relógio, "Registrar entrada" → janela de confirmação com a localização → a
// entrada das 08:02 aparece em "Marcações de hoje" e no espelho; depois o ajuste do dia: o botão de
// ajuste da linha de hoje abre a gaveta "Solicitar ajuste", o tipo vira "Corrigir o horário de uma
// marcação", o horário e a explicação são digitados e "Enviar solicitação" deixa o dia em análise.
// sub: 0 tela · 1 confirmar marcação · 2 entrada registrada · 3 gaveta de ajuste · 4 lista de tipos
// aberta · 5 tipo escolhido · 6 ajuste enviado.
// typed.typedP: 1 horário · 2 explicação.
// Geometria (área de conteúdo 870 × 608; somar 230/52 para a janela): "Registrar entrada"
// x 53–281, y 209–257; janela de confirmação x 245–625 a partir de y 110; espelho com linhas de
// 44 px (hoje é a 6ª, centrada em y 519), botão de ajuste centrado em x 805; gaveta x 430–870.

const START_SECONDS = 8 * 3600 + 1 * 60 + 57;
const REDUCED_SECONDS = 8 * 3600 + 2 * 60 + 30;
const pad = (n: number) => String(n).padStart(2, '0');
const clock = (s: number) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;

/** Relógio da tela: anda de segundo em segundo a partir de 08:01:57 (parado com movimento reduzido). */
const useClock = () => {
  const reduceMotion = useReducedMotion();
  const [secs, setSecs] = useState(reduceMotion ? REDUCED_SECONDS : START_SECONDS);
  useEffect(() => {
    if (reduceMotion) return;
    const id = window.setInterval(() => setSecs((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [reduceMotion]);
  return clock(secs);
};

interface Day { label: string; marks: string; worked: string; status: 'Completo' | 'Incompleto' | 'Folga'; today?: boolean }

const DAYS: Day[] = [
  { label: 'Qui., 01/10', marks: '08:00 12:00 13:00 17:04', worked: '8h04', status: 'Completo' },
  { label: 'Sex., 02/10', marks: '07:58 12:01 13:00 17:00', worked: '8h03', status: 'Completo' },
  { label: 'Sáb., 03/10', marks: '', worked: '0h00', status: 'Folga' },
  { label: 'Dom., 04/10', marks: '', worked: '0h00', status: 'Folga' },
  { label: 'Seg., 05/10', marks: '08:05 12:00 13:02 17:01', worked: '7h54', status: 'Incompleto' },
  { label: 'Ter., 06/10', marks: '', worked: '0h00', status: 'Incompleto', today: true },
];
const TONE: Record<Day['status'], StatusTone> = { Completo: 'success', Incompleto: 'warning', Folga: 'neutral' };
const COLS = 'grid grid-cols-[84px_1fr_72px_96px_32px] items-center gap-3';

const ADJUST_TYPES = ['Adicionar marcação esquecida', 'Corrigir o horário de uma marcação', 'Remover uma marcação errada'];
const REASON = 'Cheguei às 08:00, mas o celular demorou a pegar a localização.';

const PunchPanel = ({ time, punched }: { time: string; punched: boolean }) => {
  const reduceMotion = useReducedMotion();
  return (
    <div className="absolute left-8 top-24 h-[480px] w-[270px] rounded-lg border border-border bg-panel p-5 shadow-sm">
      <div className="text-center">
        <p className="text-[40px] font-semibold leading-none tracking-tight tabular-nums text-foreground">{time}</p>
        <p className="mt-2 text-[13.5px] text-muted">Terça-feira, 6 de outubro</p>
      </div>
      <FakeButton className="mt-6 h-12 w-full text-[14.5px]">{punched ? 'Registrar saída almoço' : 'Registrar entrada'}</FakeButton>
      <p className="mt-2 text-center text-[12px] text-muted">Pede localização</p>
      <div className="mt-6 border-t border-border pt-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[14px] font-semibold text-foreground">Marcações de hoje</p>
          <span className="text-[12px] tabular-nums text-muted">{punched ? 1 : 0}</span>
        </div>
        {punched ? (
          <motion.div
            className="relative pl-6"
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
          >
            <span className="absolute left-0 top-[13px] h-[11px] w-[11px] rounded-full border-2 border-foreground bg-panel" />
            <div className="flex items-center justify-between gap-3 rounded-md px-2 py-2">
              <span className="text-[13.5px] text-foreground">Entrada</span>
              <span className="flex items-center gap-2 text-muted">
                <MapPin size={13} strokeWidth={1.7} />
                <span className="text-[13.5px] font-medium tabular-nums text-foreground">08:02</span>
              </span>
            </div>
          </motion.div>
        ) : (
          <p className="text-[13.5px] text-muted">Nenhuma marcação ainda.</p>
        )}
      </div>
    </div>
  );
};

const Mirror = ({ sub }: { sub: number }) => {
  const rise = useRise();
  const punched = sub >= 2;
  const requested = sub >= 6;
  return (
    <>
      <motion.div {...rise(0.04)} className="absolute left-[318px] right-8 top-24 grid h-[72px] grid-cols-4 gap-px overflow-hidden rounded-lg border border-border bg-border shadow-sm">
        {[['Trabalhado', '24h01', ''], ['Esperado', '24h00', ''], ['Horas extras', '0h07', 'text-success'], ['Faltantes', '0h06', 'text-danger']].map(([l, v, tone]) => (
          <div key={l} className="bg-panel px-4 py-3">
            <p className="text-[12px] text-muted">{l}</p>
            <p className={`mt-1 text-[20px] font-semibold tracking-tight tabular-nums ${tone || 'text-foreground'}`}>{v}</p>
          </div>
        ))}
      </motion.div>

      <motion.div {...rise(0.1)} className="absolute left-[318px] right-8 top-[184px] overflow-hidden rounded-lg border border-border bg-panel shadow-sm">
        <div className="flex h-[52px] items-center justify-between border-b border-border px-5">
          <p className="text-[14px] font-semibold text-foreground">Espelho de ponto</p>
          <div className="flex items-center gap-1 text-muted">
            <ChevronLeft size={16} strokeWidth={1.7} />
            <span className="min-w-[104px] text-center text-[13.5px] font-medium text-foreground">Outubro 2026</span>
            <ChevronRight size={16} strokeWidth={1.7} className="opacity-40" />
          </div>
        </div>
        <div className={`${COLS} h-10 border-b border-border px-4 text-[12.5px] font-medium text-muted`}>
          <span>Dia</span>
          <span>Marcações</span>
          <span className="text-right">Trabalhado</span>
          <span>Situação</span>
          <span />
        </div>
        {DAYS.map((d) => {
          const marks = d.today && punched ? '08:02' : d.marks;
          return (
            <div key={d.label} className={`${COLS} h-11 border-b border-border px-4 text-[13px] last:border-b-0`}>
              <span className="whitespace-nowrap text-foreground">{d.label}</span>
              <span className={`truncate text-[12.5px] tabular-nums ${marks ? 'text-foreground' : 'text-muted'}`}>
                {marks ? marks.split(' ').map((m) => <span key={m} className="mr-2">{m}</span>) : '—'}
              </span>
              <span className="text-right tabular-nums text-foreground">{d.worked}</span>
              <span className="flex flex-col items-start gap-0.5">
                <StatusBadge tone={TONE[d.status]}>{d.status}</StatusBadge>
                {d.today && requested && <span className="whitespace-nowrap text-[11px] leading-none text-warning">Ajuste em análise</span>}
              </span>
              <span className="flex h-8 w-8 items-center justify-center justify-self-end rounded-md text-muted">
                {d.today && requested ? <Undo2 size={15} strokeWidth={1.8} /> : <Wrench size={15} strokeWidth={1.8} />}
              </span>
            </div>
          );
        })}
      </motion.div>
    </>
  );
};

const ConfirmModal = ({ time }: { time: string }) => (
  <TourModal left={245} top={110} width={380}>
    <div className="flex items-start justify-between gap-4 px-6 pb-4 pt-5">
      <div>
        <p className="text-[17px] font-semibold text-foreground">Registrar entrada</p>
        <p className="mt-1 text-[13.5px] text-muted">Confira o horário e confirme.</p>
      </div>
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted"><X size={17} strokeWidth={1.8} /></span>
    </div>
    <div className="flex flex-col items-center gap-4 px-6 pb-5">
      <p className="text-[34px] font-semibold leading-none tracking-tight tabular-nums text-foreground">{time}</p>
      <div className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2.5 text-[13px]">
        <span className="flex items-center gap-2 text-muted"><MapPin size={15} strokeWidth={1.7} /> Localização</span>
        <span className="text-success">Capturada</span>
      </div>
    </div>
    <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
      <FakeButton variant="secondary">Cancelar</FakeButton>
      <FakeButton>Registrar</FakeButton>
    </div>
  </TourModal>
);

const AdjustDrawer = ({ sub, t }: { sub: number; t: number }) => {
  const reduceMotion = useReducedMotion();
  const chosen = sub >= 5;
  const listOpen = sub === 4;
  return (
    <TourDrawer width={440}>
      <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
        <div>
          <p className="text-[17px] font-semibold text-foreground">Solicitar ajuste</p>
          <p className="mt-0.5 text-[13.5px] text-muted">Dia 06/10/2026 · analisado pelo seu superior</p>
        </div>
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted"><X size={17} strokeWidth={1.8} /></span>
      </div>
      <div className="relative flex-1 space-y-4 px-6 py-5">
        <div className="relative">
          <p className="mb-1.5 text-[12.5px] font-medium text-foreground">O que precisa ser ajustado<span className="text-danger"> *</span></p>
          <div className={`flex h-9 items-center justify-between rounded-md border bg-panel px-3 text-[13px] text-foreground transition-[border-color,box-shadow] duration-200 ${listOpen ? 'border-foreground/40 ring-2 ring-foreground/15' : 'border-border'}`}>
            {chosen ? ADJUST_TYPES[1] : ADJUST_TYPES[0]}
            <ChevronDown size={14} strokeWidth={1.8} className="text-muted" />
          </div>
          <AnimatePresence>
            {listOpen && (
              <motion.div
                className="absolute left-0 right-0 top-[64px] z-10 rounded-md border border-border bg-elevated p-1 shadow-lg"
                initial={reduceMotion ? false : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18 }}
              >
                {ADJUST_TYPES.map((o, i) => (
                  <p key={o} className={`flex h-9 items-center rounded px-3 text-[13px] text-foreground ${i === 1 ? 'bg-secondary' : ''}`}>{o}</p>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {chosen && <FakeField label="Marcação a corrigir" required select value="Entrada às 08:02" />}
        <div className="grid grid-cols-2 gap-4">
          <FakeField label={chosen ? 'Tipo correto' : 'Tipo a adicionar'} required select value="Entrada" />
          <FakeField label="Horário" required value={t >= 1 ? '08:00' : ''} placeholder="--:--" focused={t === 1} />
        </div>
        <FakeField label="Explique o que aconteceu" required rows={3} value={t >= 2 ? REASON : ''} placeholder="Ex.: esqueci de bater a saída, saí às 18h." focused={t === 2} />
        <div>
          <p className="mb-1.5 text-[12.5px] font-medium text-foreground">Comprovante</p>
          <div className="flex h-9 items-center gap-2 rounded-md border border-dashed border-border px-3 text-[13px] text-muted">
            <Paperclip size={14} strokeWidth={1.7} /> Escolher arquivo
          </div>
          <p className="mt-1 text-[11.5px] text-muted">Opcional. PDF, JPG ou PNG.</p>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
        <FakeButton variant="secondary">Cancelar</FakeButton>
        <FakeButton dim={t < 2}>Enviar solicitação</FakeButton>
      </div>
    </TourDrawer>
  );
};

const PunchScene = ({ sub, typed }: TourViewProps) => {
  const rise = useRise();
  const time = useClock();
  const t = typed.typedP ?? 0;
  const drawerOpen = sub >= 3 && sub <= 5;
  return (
    <div className="absolute inset-0">
      <motion.div {...rise(0)} className="absolute left-8 top-6">
        <p className="text-[28px] font-semibold leading-tight tracking-tight text-foreground">Controle de ponto</p>
        <p className="mt-1 text-[14px] text-muted">Registre sua jornada e acompanhe o espelho do mês.</p>
      </motion.div>
      <PunchPanel time={time} punched={sub >= 2} />
      <Mirror sub={sub} />
      <AnimatePresence>
        {sub === 1 && <Backdrop key="backdrop-confirm" />}
        {sub === 1 && <ConfirmModal key="confirm" time={time} />}
        {drawerOpen && <Backdrop key="backdrop-adjust" />}
        {drawerOpen && <AdjustDrawer key="adjust" sub={sub} t={t} />}
      </AnimatePresence>
    </div>
  );
};

export default PunchScene;
