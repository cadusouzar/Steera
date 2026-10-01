import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, RotateCw } from 'lucide-react';
import AnimatedNumber from '../../components/motion/AnimatedNumber';
import { ButtonLink, Panel, PanelLink, StatCard, StatValue } from '../../components/ui';
import { can, useCurrentUser } from '../../lib/auth';
import {
  countClients,
  countEmployees,
  getFinancialSummary,
  getTimeClockStatus,
  listActiveRoles,
  listJustificationsForReview,
  listManageableEmployees,
  listOwnTimePunches,
  listPendingAdjustmentRequests,
  type AdjustmentRequestRecord,
  type FinancialSummary,
  type TimePunch,
  type TimePunchType,
} from '../../lib/api';

// Painel do ERP (01/10/2026, redesenho monocromático): números reais vindos das rotas que já
// existem. Cada bloco só aparece com o módulo + a permissão daquele dado (o backend já recusa o
// resto — aqui é só pra não mostrar card vazio) e carrega/erra de forma independente.

type Load<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error' };

function useLoad<T>(enabled: boolean, loader: () => Promise<T>) {
  const [state, setState] = useState<Load<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState({ status: 'loading' });
    loader()
      .then((data) => { if (!cancelled) setState({ status: 'ready', data }); })
      .catch(() => { if (!cancelled) setState({ status: 'error' }); });
    return () => { cancelled = true; };
    // `loader` é recriado a cada render; a recarga é comandada por `enabled`/`attempt`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const brlCompact = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', notation: n >= 100_000 ? 'compact' : 'standard', maximumFractionDigits: n >= 100_000 ? 1 : 0 });

const ADJUSTMENT_LABELS: Record<AdjustmentRequestRecord['type'], string> = {
  add_missing_punch: 'Marcação esquecida',
  correct_time: 'Corrigir horário',
  remove_punch: 'Remover marcação',
};

const EASE = [0.16, 1, 0.3, 1] as const;

// ---------- peças ----------

const ErrorState = ({ onRetry }: { onRetry: () => void }) => (
  <div className="flex items-center justify-between gap-3 text-[13px] text-muted">
    <span>Não foi possível carregar.</span>
    <button type="button" onClick={onRetry} className="inline-flex items-center gap-1.5 font-medium text-foreground hover:underline underline-offset-4">
      <RotateCw size={13} strokeWidth={1.8} aria-hidden="true" /> Tentar de novo
    </button>
  </div>
);

// Liga o estado de carregamento local (`useLoad`) ao StatCard do kit.
const DashStat = ({
  label, load, render, footer, onRetry, to,
}: {
  label: string;
  load: Load<unknown>['status'];
  render: () => ReactNode;
  footer: () => ReactNode;
  onRetry: () => void;
  to: string;
}) => (
  <StatCard
    label={label}
    to={to}
    status={load}
    value={load === 'ready' ? render() : null}
    footer={load === 'ready' ? footer() : null}
    error={<ErrorState onRetry={onRetry} />}
  />
);

// ---------- blocos ----------

function greeting(date: Date) {
  const h = date.getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

const FinanceBlock = ({ load, onRetry }: { load: Load<FinancialSummary>; onRetry: () => void }) => {
  const reduceMotion = useReducedMotion();
  if (load.status === 'loading') {
    return (
      <div className="space-y-4">
        <span className="skeleton block h-2.5 w-full" />
        <div className="grid grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => <span key={i} className="skeleton h-12" />)}
        </div>
      </div>
    );
  }
  if (load.status === 'error') return <ErrorState onRetry={onRetry} />;
  const { totalPaid, totalPending, totalOverdue, topDefaulters } = load.data;
  const total = totalPaid + totalPending + totalOverdue;
  const segments = [
    { key: 'paid', label: 'Recebido', value: totalPaid, bar: 'bg-foreground', dot: 'bg-foreground' },
    { key: 'pending', label: 'A receber', value: totalPending, bar: 'bg-foreground/25', dot: 'bg-foreground/25' },
    { key: 'overdue', label: 'Atrasado', value: totalOverdue, bar: 'bg-danger', dot: 'bg-danger' },
  ];

  if (total === 0) {
    return (
      <p className="text-[14px] text-muted max-w-sm">
        Nenhum lançamento ainda. Quando você registrar cobranças dos clientes, o resumo de recebido, a receber e
        atrasado aparece aqui.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex h-2.5 w-full gap-[3px] overflow-hidden rounded-sm" role="img" aria-label={`Recebido ${brl(totalPaid)}, a receber ${brl(totalPending)}, atrasado ${brl(totalOverdue)}`}>
          {segments.filter((s) => s.value > 0).map((s, i) => (
            <motion.span
              key={s.key}
              className={`h-full ${s.bar} first:rounded-l-sm last:rounded-r-sm`}
              initial={reduceMotion ? false : { width: '0%' }}
              animate={{ width: `${(s.value / total) * 100}%` }}
              transition={{ duration: 0.9, delay: 0.1 + i * 0.08, ease: EASE }}
            />
          ))}
        </div>
        <dl className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {segments.map((s) => (
            <div key={s.key}>
              <dt className="flex items-center gap-2 text-[13px] text-muted">
                <span className={`h-2 w-2 rounded-full ${s.dot}`} aria-hidden="true" />
                {s.label}
              </dt>
              <dd className={`mt-1 text-[20px] font-semibold tracking-tight ${s.key === 'overdue' && s.value > 0 ? 'text-danger' : 'text-foreground'}`}>
                <AnimatedNumber value={s.value} format={brl} />
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {topDefaulters.length > 0 && (
        <div className="border-t border-border pt-4">
          <h3 className="text-[13px] text-muted mb-2">Maiores atrasos</h3>
          <ul className="divide-y divide-border">
            {topDefaulters.slice(0, 5).map((d) => (
              <li key={d.clientId} className="flex items-center justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-[14px] text-foreground truncate">{d.name}</p>
                  {d.category && <p className="text-[12px] text-muted truncate">{d.category}</p>}
                </div>
                <span className="text-[14px] font-medium text-danger tabular shrink-0">{brl(d.overdueAmount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

interface PontoQueue {
  adjustments: AdjustmentRequestRecord[];
  adjustmentsTotal: number;
  justificationsTotal: number;
  names: Record<string, string>;
}

const daysAgo = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'hoje';
  if (days === 1) return 'ontem';
  return `há ${days} dias`;
};

const formatDay = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });

const PontoQueueBlock = ({ load, onRetry }: { load: Load<PontoQueue>; onRetry: () => void }) => {
  if (load.status === 'loading') {
    return <div className="space-y-3">{[0, 1, 2].map((i) => <span key={i} className="skeleton block h-10" />)}</div>;
  }
  if (load.status === 'error') return <ErrorState onRetry={onRetry} />;
  const { adjustments, adjustmentsTotal, justificationsTotal, names } = load.data;
  if (adjustmentsTotal + justificationsTotal === 0) {
    return <p className="text-[14px] text-muted">Tudo em dia. Nenhuma solicitação aguardando análise.</p>;
  }
  return (
    <div>
      <p className="text-[13px] text-muted">
        <span className="text-foreground font-medium tabular">{adjustmentsTotal}</span> {adjustmentsTotal === 1 ? 'ajuste' : 'ajustes'}
        {' · '}
        <span className="text-foreground font-medium tabular">{justificationsTotal}</span> {justificationsTotal === 1 ? 'justificativa' : 'justificativas'}
      </p>
      {adjustments.length > 0 && (
        <ul className="mt-3 divide-y divide-border">
          {adjustments.map((a) => (
            <li key={a.id} className="py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[14px] text-foreground truncate">{names[a.employeeId] ?? 'Funcionário'}</p>
                <p className="text-[12px] text-muted truncate">{ADJUSTMENT_LABELS[a.type]} · {formatDay(a.targetDate)}</p>
              </div>
              <span className="text-[12px] text-muted shrink-0">{daysAgo(a.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

interface MyDay {
  next: TimePunchType;
  punches: TimePunch[];
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const MyDayBlock = ({ load, onRetry }: { load: Load<MyDay>; onRetry: () => void }) => {
  if (load.status === 'loading') return <div className="space-y-3"><span className="skeleton block h-7 w-48" /><span className="skeleton block h-10 w-32" /></div>;
  if (load.status === 'error') return <ErrorState onRetry={onRetry} />;
  const { next, punches } = load.data;
  const ordered = [...punches].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  const firstIn = ordered.find((p) => p.type === 'clock_in' || p.type === 'extra_in');
  const last = ordered[ordered.length - 1];

  let headline: string;
  let detail: string;
  if (next === 'break_start' || next === 'clock_out' || next === 'extra_out') {
    headline = 'Trabalhando';
    detail = firstIn ? `desde ${hhmm(firstIn.recordedAt)}` : 'jornada aberta';
  } else if (next === 'break_end') {
    headline = 'Em intervalo';
    detail = last ? `desde ${hhmm(last.recordedAt)}` : '';
  } else if (ordered.length > 0) {
    headline = 'Expediente encerrado';
    detail = last ? `saída às ${hhmm(last.recordedAt)}` : '';
  } else {
    headline = 'Ponto não registrado';
    detail = 'nenhuma marcação hoje';
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-[24px] font-semibold tracking-tight text-foreground leading-tight">{headline}</p>
        <p className="text-[14px] text-muted mt-0.5">{detail}</p>
      </div>
      {ordered.length > 0 && (
        <ol className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted tabular" aria-label="Marcações de hoje">
          {ordered.map((p) => <li key={p.id}>{hhmm(p.recordedAt)}</li>)}
        </ol>
      )}
      <ButtonLink to="/app/ponto" trailingIcon={ArrowRight} className="self-start">Bater ponto</ButtonLink>
    </div>
  );
};

// ---------- página ----------

const Overview = () => {
  const user = useCurrentUser();
  const reduceMotion = useReducedMotion();
  const modules = user?.modules ?? [];
  const locked = user?.plan?.locked ?? {};
  const has = (m: string) => modules.includes(m);

  const showEmployees = has('RH_FUNCIONARIOS') && can('funcionarios.ver', user);
  const showRoles = has('RH_CARGOS') && can('cargos.ver', user);
  const showClients = has('CLIENTES') && can('clientes.ver', user);
  const showFinance = (has('CLIENTES') || has('FINANCAS')) && can('financas.lancamentos.ver', user) && !locked.FINANCAS;
  const showPontoAdmin = has('PONTO_ADMINISTRACAO') && can('ponto.administrar', user) && !locked.PONTO_ADMINISTRACAO;
  const showMyDay = has('PONTO_REGISTRO') && can('ponto.registrar', user) && !!user?.employeeId && !locked.PONTO_REGISTRO;

  const employees = useLoad(showEmployees, async () => {
    const [active, total] = await Promise.all([countEmployees('active'), countEmployees()]);
    return { active, total };
  });
  const clients = useLoad(showClients, async () => {
    const [active, total] = await Promise.all([countClients('active'), countClients()]);
    return { active, total };
  });
  const finance = useLoad(showFinance, getFinancialSummary);
  const roles = useLoad(showRoles, async () => (await listActiveRoles()).length);
  const pontoQueue = useLoad<PontoQueue>(showPontoAdmin, async () => {
    const [adj, just, people] = await Promise.all([
      listPendingAdjustmentRequests({ status: 'pending', pageSize: 50 }),
      listJustificationsForReview({ status: 'pending', pageSize: 1 }),
      listManageableEmployees().catch(() => []),
    ]);
    const oldest = [...adj.items].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 5);
    return {
      adjustments: oldest,
      adjustmentsTotal: adj.total,
      justificationsTotal: just.total,
      names: Object.fromEntries(people.map((p) => [p.id, p.fullName])),
    };
  });
  const myDay = useLoad<MyDay>(showMyDay, async () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const [status, punches] = await Promise.all([getTimeClockStatus(), listOwnTimePunches(start.toISOString())]);
    return { next: status.nextAllowedType, punches };
  });

  const now = useMemo(() => new Date(), []);
  // Só o nome de verdade: sem nome cadastrado, a saudação fica sem vocativo (a parte local do
  // e-mail, tipo "joao.silva82", soaria robótica).
  const firstName = user?.name?.trim().split(/\s+/)[0] ?? '';
  const dateLabel = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  const statCards: ReactNode[] = [];
  if (showEmployees) {
    statCards.push(
      <DashStat
        key="employees"
        to="/app/funcionarios"
        label="Funcionários ativos"
        load={employees.state.status}
        onRetry={employees.retry}
        render={() => employees.state.status === 'ready' && (
          <StatValue value={employees.state.data.active} suffix={`/ ${employees.state.data.total}`} />
        )}
        footer={() => {
          if (employees.state.status !== 'ready') return null;
          const inactive = employees.state.data.total - employees.state.data.active;
          return inactive > 0 ? `${inactive} ${inactive === 1 ? 'inativo' : 'inativos'}` : 'Todos ativos';
        }}
      />,
    );
  }
  if (showClients) {
    statCards.push(
      <DashStat
        key="clients"
        to="/app/clientes"
        label="Clientes ativos"
        load={clients.state.status}
        onRetry={clients.retry}
        render={() => clients.state.status === 'ready' && (
          <StatValue value={clients.state.data.active} suffix={`/ ${clients.state.data.total}`} />
        )}
        footer={() => {
          if (clients.state.status !== 'ready') return null;
          const inactive = clients.state.data.total - clients.state.data.active;
          return inactive > 0 ? `${inactive} ${inactive === 1 ? 'inativo' : 'inativos'} no relatório` : 'Todos ativos';
        }}
      />,
    );
  }
  if (showFinance) {
    statCards.push(
      <DashStat
        key="finance"
        to="/app/clientes"
        label="Total recebido"
        load={finance.state.status}
        onRetry={finance.retry}
        render={() => finance.state.status === 'ready' && <StatValue value={finance.state.data.totalPaid} format={brlCompact} />}
        footer={() => {
          if (finance.state.status !== 'ready') return null;
          const { totalOverdue, totalPending } = finance.state.data;
          return totalOverdue > 0
            ? <span><span className="text-danger font-medium tabular">{brlCompact(totalOverdue)}</span> atrasado</span>
            : <span><span className="text-foreground font-medium tabular">{brlCompact(totalPending)}</span> a receber</span>;
        }}
      />,
    );
  }
  if (showPontoAdmin) {
    statCards.push(
      <DashStat
        key="ponto"
        to="/app/ponto-administracao"
        label="Pendências de ponto"
        load={pontoQueue.state.status}
        onRetry={pontoQueue.retry}
        render={() => pontoQueue.state.status === 'ready' && (
          <StatValue value={pontoQueue.state.data.adjustmentsTotal + pontoQueue.state.data.justificationsTotal} />
        )}
        footer={() => {
          if (pontoQueue.state.status !== 'ready') return null;
          const n = pontoQueue.state.data.adjustmentsTotal + pontoQueue.state.data.justificationsTotal;
          return n === 0 ? 'Nada aguardando análise' : 'Aguardando sua análise';
        }}
      />,
    );
  }

  const needsSetup = showRoles && roles.state.status === 'ready' && roles.state.data === 0;
  const nothingToShow = statCards.length === 0 && !showFinance && !showPontoAdmin && !showMyDay && !needsSetup;

  const fade = (delay: number) =>
    reduceMotion
      ? {}
      : {
        initial: { opacity: 0, y: 8, filter: 'blur(4px)' },
        animate: { opacity: 1, y: 0, filter: 'blur(0px)', transitionEnd: { filter: 'none' } },
        transition: { duration: 0.35, delay, ease: EASE },
      };

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8">
          <h1 className="text-[28px] md:text-[32px] font-semibold tracking-tight text-foreground leading-tight">
            {greeting(now)}{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="mt-1 text-[14px] text-muted first-letter:uppercase">
            {dateLabel}
            {user?.companyName ? ` · ${user.companyName}` : ''}
          </p>
        </header>

        {needsSetup && (
          <motion.section {...fade(0)} className="mb-6 bg-panel border border-border rounded-lg shadow-sm p-6 md:p-8 flex flex-col md:flex-row md:items-center gap-6 justify-between">
            <div className="max-w-xl">
              <h2 className="text-[18px] font-semibold text-foreground">Monte a estrutura da empresa</h2>
              <p className="mt-1.5 text-[14px] text-muted">
                Comece pelos cargos: cada funcionário é cadastrado num cargo, com departamento e cor. Depois é só adicionar as pessoas.
              </p>
            </div>
            <ol className="flex items-center gap-3 shrink-0">
              <li>
                <ButtonLink to="/app/cargos">1. Criar cargos</ButtonLink>
              </li>
              {showEmployees && (
                <li>
                  <ButtonLink to="/app/funcionarios" variant="secondary">2. Adicionar funcionários</ButtonLink>
                </li>
              )}
            </ol>
          </motion.section>
        )}

        {statCards.length > 0 && (
          <motion.div {...fade(0.04)} className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
            {statCards}
          </motion.div>
        )}

        {(showFinance || showPontoAdmin || showMyDay) && (
          <motion.div {...fade(0.1)} className="mt-6 grid gap-4 grid-cols-1 lg:grid-cols-12">
            {showFinance && (
              <Panel
                title="Financeiro"
                className={showPontoAdmin || showMyDay ? 'lg:col-span-7' : 'lg:col-span-12'}
                action={<PanelLink to="/app/clientes">Clientes</PanelLink>}
              >
                <FinanceBlock load={finance.state} onRetry={finance.retry} />
              </Panel>
            )}
            {(showPontoAdmin || showMyDay) && (
              <div className={`flex flex-col gap-4 ${showFinance ? 'lg:col-span-5' : 'lg:col-span-12 lg:grid lg:grid-cols-2'}`}>
                {showMyDay && (
                  <Panel title="Meu ponto hoje">
                    <MyDayBlock load={myDay.state} onRetry={myDay.retry} />
                  </Panel>
                )}
                {showPontoAdmin && (
                  <Panel title="Aguardando análise" action={<PanelLink to="/app/ponto-administracao">Ver todas</PanelLink>}>
                    <PontoQueueBlock load={pontoQueue.state} onRetry={pontoQueue.retry} />
                  </Panel>
                )}
              </div>
            )}
          </motion.div>
        )}

        {nothingToShow && (
          <p className="text-[14px] text-muted max-w-md">
            Seu acesso ainda não inclui nenhuma área com resumo aqui. Use o menu ao lado para abrir os módulos liberados para você.
          </p>
        )}
      </div>
    </div>
  );
};

export default Overview;
