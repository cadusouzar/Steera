import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Ban, Briefcase, CalendarPlus, Plane, Trash2, Undo2, Wallet, X, Zap } from 'lucide-react';
import { StatusBadge } from '../../../ui';
import type { TourViewProps } from '../tourTypes';
import { EmployeesListView } from './EmployeesScene';
import { Backdrop, FakeButton, FakeField, FakeTabs, RowFlash, TourModal, type FakeTab } from './tourParts';
import { EASE } from './tourMotion';

// Cena "Férias e afastamentos" do tour (roteiro `ferias` do esboço): na lista de funcionários,
// "Pagamentos e férias" de Diego Araújo abre a janela da ficha (components/FinanceAndVacationModal):
// aba Pagamentos → aba Férias → "Agendar férias" → início/fim (o prazo em dias aparece embaixo, como
// no sistema) → "Agendar férias" → aba Afastamento → "Agendar afastamento" → início/fim/motivo →
// "Agendar afastamento". Cada período aparece no histórico com a situação "Agendado".
// sub: 0 lista · 1 Pagamentos · 2 Férias · 3 formulário de férias · 4 férias agendadas ·
// 5 Afastamento · 6 formulário de afastamento · 7 afastamento agendado.
// typed.typedV: 1 início das férias · 2 fim · 3 início do afastamento · 4 fim · 5 motivo.
// Geometria (área de conteúdo 870 × 608; somar 230/52 para a janela): a janela fica em x 115–755,
// y 34 em diante; abas em y 118–162 — Pagamentos x 131–259, Férias x 263–351, Afastamento x 355–483.

const NAME = 'Diego Araújo';
const MODAL = { left: 115, top: 34, width: 640 };

const TABS: FakeTab[] = [
  { label: 'Pagamentos', icon: Wallet, left: 16, width: 128 },
  { label: 'Férias', icon: Plane, left: 148, width: 88 },
  { label: 'Afastamento', icon: Briefcase, left: 240, width: 128 },
];

const SectionTitle = ({ children, action }: { children: ReactNode; action?: ReactNode }) => (
  <div className="mb-3 flex h-8 items-center justify-between gap-3">
    <p className="text-[14px] font-semibold text-foreground">{children}</p>
    {action}
  </div>
);

interface Period { range: string; days: string; status: 'Agendado' | 'Concluído'; isNew?: boolean }

const PeriodRow = ({ p }: { p: Period }) => {
  const reduceMotion = useReducedMotion();
  return (
    <motion.li
      className="relative flex items-center justify-between gap-3 px-4 py-3"
      initial={reduceMotion || !p.isNew ? false : { opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: EASE }}
    >
      {p.isNew && <RowFlash />}
      <div className="relative min-w-0">
        <p className="text-[13.5px] tabular-nums text-foreground">{p.range}</p>
        <p className="text-[12px] text-muted">{p.days}</p>
      </div>
      <div className="relative flex items-center gap-2">
        <StatusBadge tone={p.status === 'Concluído' ? 'success' : 'neutral'}>{p.status}</StatusBadge>
        {p.status === 'Agendado' && <FakeButton variant="ghost" size="sm" icon={Ban}>Cancelar</FakeButton>}
      </div>
    </motion.li>
  );
};

const ScheduleForm = ({ title, submit, fields }: { title: string; submit: string; fields: ReactNode }) => {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className="mb-5 rounded-md border border-border p-4"
      initial={reduceMotion ? false : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
    >
      <p className="mb-3 text-[14px] font-semibold text-foreground">{title}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">{fields}</div>
      <div className="mt-4 flex justify-end gap-2">
        <FakeButton variant="secondary">Cancelar</FakeButton>
        <FakeButton>{submit}</FakeButton>
      </div>
    </motion.div>
  );
};

const PaymentsTab = () => (
  <div className="space-y-5">
    <div className="grid grid-cols-2 gap-4 rounded-md border border-border px-4 py-3">
      <div>
        <p className="text-[12px] text-muted">Salário base</p>
        <p className="mt-0.5 text-[20px] font-semibold tracking-tight tabular-nums text-foreground">R$ 3.100,00</p>
      </div>
      <div>
        <p className="text-[12px] text-muted">Dia de pagamento</p>
        <p className="mt-0.5 text-[14px] text-foreground">Todo dia 5</p>
      </div>
    </div>
    <div>
      <SectionTitle>Pagamento recorrente</SectionTitle>
      <ul className="divide-y divide-border rounded-md border border-border">
        <li className="flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-[13.5px] text-foreground">Salário mensal</p>
            <p className="text-[12px] text-muted"><span className="tabular-nums">R$ 3.100,00</span> · vence todo dia 5</p>
          </div>
          <div className="flex items-center gap-2">
            <FakeButton variant="secondary" size="sm" icon={Zap}>Gerar fatura do mês</FakeButton>
            <FakeButton variant="ghost" size="sm" icon={Trash2}>Excluir</FakeButton>
          </div>
        </li>
      </ul>
    </div>
    <div>
      <SectionTitle>Histórico de pagamentos</SectionTitle>
      <ul className="divide-y divide-border rounded-md border border-border">
        {[['Salário · setembro de 2026', '05/10/2026'], ['Salário · agosto de 2026', '04/09/2026']].map(([d, due]) => (
          <li key={d} className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-[13.5px] text-foreground">{d}</p>
              <p className="text-[12px] tabular-nums text-muted">{due} · R$ 3.100,00</p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge tone="success">Pago</StatusBadge>
              <FakeButton variant="ghost" size="sm" icon={Undo2}>Desfazer</FakeButton>
            </div>
          </li>
        ))}
      </ul>
    </div>
  </div>
);

const VacationTab = ({ sub, t }: { sub: number; t: number }) => {
  const formOpen = sub === 3;
  const periods: Period[] = [
    ...(sub >= 4 ? [{ range: '04/01/2027 até 18/01/2027', days: '15 dias', status: 'Agendado' as const, isNew: true }] : []),
    { range: '06/01/2026 até 20/01/2026', days: '15 dias', status: 'Concluído' },
  ];
  return (
    <div>
      {formOpen && (
        <ScheduleForm
          title="Agendar novo período"
          submit="Agendar férias"
          fields={(
            <>
              <FakeField label="Início" required value={t >= 1 ? '04/01/2027' : ''} placeholder="dd/mm/aaaa" focused={t === 1} />
              <FakeField label="Fim" required value={t >= 2 ? '18/01/2027' : ''} placeholder="dd/mm/aaaa" focused={t === 2} hint={t >= 2 ? '15 dias' : undefined} />
            </>
          )}
        />
      )}
      <SectionTitle action={formOpen ? undefined : <FakeButton variant="secondary" size="sm" icon={CalendarPlus}>Agendar férias</FakeButton>}>
        Histórico de férias
      </SectionTitle>
      <ul className="divide-y divide-border rounded-md border border-border">
        {periods.map((p) => <PeriodRow key={p.range} p={p} />)}
      </ul>
    </div>
  );
};

const LeaveTab = ({ sub, t }: { sub: number; t: number }) => {
  const formOpen = sub === 6;
  return (
    <div>
      {formOpen && (
        <ScheduleForm
          title="Agendar afastamento"
          submit="Agendar afastamento"
          fields={(
            <>
              <FakeField label="Início" required value={t >= 3 ? '09/11/2026' : ''} placeholder="dd/mm/aaaa" focused={t === 3} />
              <FakeField label="Fim" required value={t >= 4 ? '11/11/2026' : ''} placeholder="dd/mm/aaaa" focused={t === 4} hint={t >= 4 ? '3 dias' : undefined} />
              <FakeField className="col-span-2" label="Motivo" value={t >= 5 ? 'Licença médica' : ''} placeholder="Ex.: licença médica" focused={t === 5} hint="Opcional." />
            </>
          )}
        />
      )}
      <SectionTitle action={formOpen ? undefined : <FakeButton variant="secondary" size="sm" icon={CalendarPlus}>Agendar afastamento</FakeButton>}>
        Histórico de afastamentos
      </SectionTitle>
      {sub >= 7 ? (
        <ul className="divide-y divide-border rounded-md border border-border">
          <PeriodRow p={{ range: '09/11/2026 até 11/11/2026', days: '3 dias · Licença médica', status: 'Agendado', isNew: true }} />
        </ul>
      ) : (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-[13.5px] text-muted">Nenhum afastamento registrado.</p>
      )}
    </div>
  );
};

const VacationScene = ({ sub, typed }: TourViewProps) => {
  const t = typed.typedV ?? 0;
  const tab = sub <= 1 ? 0 : sub <= 4 ? 1 : 2;
  return (
    <div className="absolute inset-0">
      <EmployeesListView added flash={false} />
      <AnimatePresence>
        {sub >= 1 && <Backdrop key="backdrop" />}
        {sub >= 1 && (
          <TourModal key="modal" {...MODAL}>
            <div className="flex items-start justify-between gap-4 px-6 pb-4 pt-5">
              <div>
                <p className="text-[17px] font-semibold text-foreground">{NAME}</p>
                <p className="mt-1 text-[13.5px] text-muted">CLT · admitido em 12/03/2024</p>
              </div>
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted"><X size={17} strokeWidth={1.8} /></span>
            </div>
            <FakeTabs tabs={TABS} active={tab} />
            <div className="min-h-[240px] px-6 pb-6 pt-5">
              {tab === 0 && <PaymentsTab />}
              {tab === 1 && <VacationTab sub={sub} t={t} />}
              {tab === 2 && <LeaveTab sub={sub} t={t} />}
            </div>
          </TourModal>
        )}
      </AnimatePresence>
    </div>
  );
};

export default VacationScene;
