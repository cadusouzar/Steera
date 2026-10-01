import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, X } from 'lucide-react';
import AnimatedNumber from '../motion/AnimatedNumber';

// Peças de exibição do kit (01/10/2026): título de página, painel, card de número, selo de status
// e estado vazio. Panel/StatCard nasceram no Overview e foram extraídos para cá.

// ---------- PageHeader ----------

export const PageHeader = ({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) => (
  <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div className="min-w-0">
      <h1 className="text-[26px] md:text-[28px] font-semibold tracking-tight text-foreground leading-tight">{title}</h1>
      {description && <p className="mt-1 text-[14px] text-muted max-w-2xl">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
  </header>
);

// ---------- Panel ----------

export const Panel = ({
  title, action, children, className = '', padded = true,
}: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) => (
  <section className={`bg-panel border border-border rounded-lg shadow-sm flex flex-col ${className}`}>
    {(title || action) && (
      <header className="flex items-center justify-between gap-4 px-5 pt-5">
        {title && <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>}
        {action}
      </header>
    )}
    <div className={padded ? `flex-1 px-5 pb-5 ${title || action ? 'pt-4' : 'pt-5'}` : 'flex-1'}>{children}</div>
  </section>
);

export const PanelLink = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link to={to} className="group inline-flex items-center gap-1 text-[13px] text-muted hover:text-foreground transition-colors">
    {children}
    <ArrowRight size={14} strokeWidth={1.8} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
  </Link>
);

// ---------- StatCard ----------

export type LoadStatus = 'loading' | 'ready' | 'error';

export const StatValue = ({ value, format, suffix }: { value: number; format?: (n: number) => string; suffix?: ReactNode }) => (
  <span className="flex items-baseline gap-1.5">
    <AnimatedNumber value={value} format={format} className="text-[34px] leading-none font-semibold tracking-tight text-foreground" />
    {suffix && <span className="text-[15px] text-muted tabular">{suffix}</span>}
  </span>
);

// Card de número no formato da referência ("82 / 100" + faixa inferior com contexto). O card todo
// é clicável por um link de cobertura — assim o "Tentar de novo" do erro não fica dentro de um link.
export const StatCard = ({
  label, status, value, footer, error, to,
}: {
  label: string;
  status: LoadStatus;
  value: ReactNode;
  footer?: ReactNode;
  error?: ReactNode;
  to?: string;
}) => (
  <div className={`group relative bg-panel border border-border rounded-lg shadow-sm flex flex-col transition-[box-shadow,border-color] duration-200 ${to ? 'hover:shadow-md hover:border-foreground/15 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-foreground' : ''}`}>
    {to && <Link to={to} className="absolute inset-0 rounded-lg outline-none" aria-label={`${label}: abrir`} />}
    <div className="px-5 pt-5 pb-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] text-muted">{label}</span>
        {to && (
          <ArrowUpRight size={15} strokeWidth={1.6} className="text-muted opacity-0 -translate-y-0.5 translate-x-[-2px] transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0 group-hover:translate-y-0" aria-hidden="true" />
        )}
      </div>
      <div className="mt-2 min-h-[40px] flex items-end">
        {status === 'loading' && <span className="skeleton h-8 w-24" role="status" aria-label="Carregando" />}
        {status === 'ready' && value}
        {status === 'error' && <div className="relative z-10 w-full">{error}</div>}
      </div>
    </div>
    {footer !== undefined && (
      <div className="mt-auto border-t border-border px-5 py-3 text-[13px] text-muted min-h-[45px] flex items-center">
        {status === 'ready' ? footer : status === 'loading' ? <span className="skeleton h-3.5 w-32" /> : null}
      </div>
    )}
  </div>
);

// ---------- StatusBadge ----------

export type StatusTone = 'success' | 'warning' | 'danger' | 'neutral';

const TONE: Record<StatusTone, { dot: string; text: string; bg: string }> = {
  success: { dot: 'bg-success', text: 'text-success', bg: 'bg-success/10' },
  warning: { dot: 'bg-warning', text: 'text-warning', bg: 'bg-warning/10' },
  danger: { dot: 'bg-danger', text: 'text-danger', bg: 'bg-danger/10' },
  neutral: { dot: 'bg-muted', text: 'text-muted', bg: 'bg-secondary' },
};

export const StatusBadge = ({ tone, children }: { tone: StatusTone; children: ReactNode }) => (
  <span className={`inline-flex items-center gap-1.5 h-6 px-2 rounded text-[12px] font-medium whitespace-nowrap ${TONE[tone].bg} ${TONE[tone].text}`}>
    <span className={`h-1.5 w-1.5 rounded-full ${TONE[tone].dot}`} aria-hidden="true" />
    {children}
  </span>
);

// ---------- EmptyState ----------

export const EmptyState = ({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) => (
  <div className="flex flex-col items-start gap-3 px-5 py-10 sm:items-center sm:text-center">
    <div>
      <p className="text-[15px] font-semibold text-foreground">{title}</p>
      {description && <p className="mt-1 text-[14px] text-muted max-w-md">{description}</p>}
    </div>
    {action}
  </div>
);

// ---------- Notice ----------

const NOTICE_TONE = {
  danger: 'border-danger/30 bg-danger/[0.06] text-danger',
  warning: 'border-warning/30 bg-warning/[0.07] text-warning',
  info: 'border-border bg-secondary text-foreground',
} as const;

// Aviso em faixa (erro de carregamento, aviso de ação, informação). `onDismiss` mostra o "fechar".
export const Notice = ({
  tone = 'info', children, onDismiss, className = '',
}: { tone?: keyof typeof NOTICE_TONE; children: ReactNode; onDismiss?: () => void; className?: string }) => (
  <div
    role={tone === 'danger' ? 'alert' : 'status'}
    className={`flex items-start justify-between gap-3 rounded-md border px-4 py-3 text-[14px] ${NOTICE_TONE[tone]} ${className}`}
  >
    <div className="min-w-0">{children}</div>
    {onDismiss && (
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 -mr-1 h-6 w-6 inline-flex items-center justify-center rounded opacity-70 hover:opacity-100 outline-none focus-visible:ring-2 focus-visible:ring-current"
        aria-label="Fechar aviso"
      >
        <X size={15} strokeWidth={1.8} />
      </button>
    )}
  </div>
);
