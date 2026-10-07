import type { CSSProperties, ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import AnimatedNumber from '../../../motion/AnimatedNumber';

// Cena "Visão geral" do tour: o painel do ERP (pages/app/Overview) com números de uma empresa
// fictícia — cards de número, resumo financeiro, "Meu ponto hoje" e a fila "Aguardando análise".
// Posições absolutas (coordenadas da área de conteúdo, 870 × 608) para o roteiro do cursor bater.
// Layout usado pelo roteiro (tourScenes.ts): cards em y 96–202 (o 4º, "Pendências de ponto", em
// x 645–838); "Aguardando análise" em x 508–838, y 346–576.

const EASE = [0.16, 1, 0.3, 1] as const;

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const STATS = [
  { label: 'Funcionários ativos', value: 24, suffix: '/ 26', footer: '2 inativos' },
  { label: 'Clientes ativos', value: 38, suffix: '/ 41', footer: '3 inativos no relatório' },
  { label: 'Total recebido', value: 48300, money: true, footer: <span><span className="font-medium text-foreground">R$ 12.600</span> a receber</span> },
  { label: 'Pendências de ponto', value: 3, footer: 'Aguardando sua análise' },
];

const FINANCE = [
  { key: 'paid', label: 'Recebido', value: 48300, bar: 'bg-foreground', dot: 'bg-foreground' },
  { key: 'pending', label: 'A receber', value: 12600, bar: 'bg-foreground/25', dot: 'bg-foreground/25' },
  { key: 'overdue', label: 'Atrasado', value: 2400, bar: 'bg-danger', dot: 'bg-danger' },
];
const FINANCE_TOTAL = FINANCE.reduce((s, f) => s + f.value, 0);

const DEFAULTERS = [
  { name: 'Mercado São Jorge', category: 'Mercearia', amount: 1200 },
  { name: 'Café Bom Dia', category: 'Cafeteria', amount: 750 },
  { name: 'Hotel Primavera', category: 'Hotelaria', amount: 450 },
];

const QUEUE = [
  { name: 'Fernanda Rocha', what: 'Remover marcação · 28 de set.', when: 'há 2 dias' },
  { name: 'Carla Mendes', what: 'Corrigir horário · 21 de set.', when: 'há 3 dias' },
  { name: 'Diego Araújo', what: 'Marcação esquecida · 24 de set.', when: 'ontem' },
];

const Card = ({ className = '', style, children }: { className?: string; style?: CSSProperties; children: ReactNode }) => (
  <div className={`absolute rounded-lg border border-border bg-panel shadow-sm ${className}`} style={style}>{children}</div>
);

const OverviewScene = () => {
  const reduceMotion = useReducedMotion();
  const fade = (delay: number) =>
    reduceMotion
      ? {}
      : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.35, delay, ease: EASE },
      };

  return (
    <div className="absolute inset-0">
      <motion.div {...fade(0)} className="absolute left-8 top-6">
        <p className="text-[28px] font-semibold leading-tight tracking-tight text-foreground">Bom dia, Rafael</p>
        <p className="mt-1 text-[14px] text-muted">Terça-feira, 6 de outubro · Padaria Central</p>
      </motion.div>

      <motion.div {...fade(0.04)} className="absolute inset-0">
        {STATS.map((s, i) => (
          <Card key={s.label} className="flex flex-col" style={{ left: 32 + i * 204.5, top: 96, width: 192.5, height: 106 }}>
            <div className="px-4 pt-3.5">
              <div className="flex items-start justify-between">
                <span className="text-[12.5px] text-muted">{s.label}</span>
                <ArrowUpRight size={14} strokeWidth={1.6} className="text-muted/60" />
              </div>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                <AnimatedNumber
                  value={s.value}
                  format={s.money ? brl : undefined}
                  className={`${s.money ? 'text-[22px]' : 'text-[28px]'} font-semibold leading-none tracking-tight text-foreground whitespace-nowrap`}
                />
                {s.suffix && <span className="text-[13px] text-muted">{s.suffix}</span>}
              </div>
            </div>
            <div className="mt-auto border-t border-border px-4 py-2 text-[12px] text-muted">{s.footer}</div>
          </Card>
        ))}
      </motion.div>

      <motion.div {...fade(0.1)} className="absolute inset-0">
        <Card className="px-5 py-4" style={{ left: 32, top: 216, width: 464, height: 360 }}>
          <div className="flex items-center justify-between">
            <span className="text-[14px] font-semibold text-foreground">Financeiro</span>
            <span className="inline-flex items-center gap-1 text-[12.5px] text-muted">Clientes <ArrowRight size={13} strokeWidth={1.8} /></span>
          </div>
          <div className="mt-4 flex h-2.5 w-full gap-[3px] overflow-hidden rounded-sm">
            {FINANCE.map((f, i) => (
              <motion.span
                key={f.key}
                className={`h-full ${f.bar}`}
                initial={reduceMotion ? false : { width: '0%' }}
                animate={{ width: `${(f.value / FINANCE_TOTAL) * 100}%` }}
                transition={{ duration: 0.9, delay: 0.2 + i * 0.08, ease: EASE }}
              />
            ))}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {FINANCE.map((f) => (
              <div key={f.key}>
                <p className="flex items-center gap-1.5 text-[12px] text-muted">
                  <span className={`h-2 w-2 rounded-full ${f.dot}`} />
                  {f.label}
                </p>
                <AnimatedNumber
                  value={f.value}
                  format={brl}
                  className={`mt-1 block text-[18px] font-semibold tracking-tight ${f.key === 'overdue' ? 'text-danger' : 'text-foreground'}`}
                />
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-border pt-3">
            <p className="mb-1 text-[12px] text-muted">Maiores atrasos</p>
            {DEFAULTERS.map((d) => (
              <div key={d.name} className="flex items-center justify-between border-b border-border py-2 last:border-b-0">
                <div>
                  <p className="text-[13px] text-foreground">{d.name}</p>
                  <p className="text-[11.5px] text-muted">{d.category}</p>
                </div>
                <span className="text-[13px] font-medium text-danger">{brl(d.amount)}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="px-5 py-4" style={{ left: 508, top: 216, width: 330, height: 118 }}>
          <span className="text-[14px] font-semibold text-foreground">Meu ponto hoje</span>
          <div className="mt-2 flex items-end justify-between">
            <div>
              <p className="text-[21px] font-semibold leading-tight tracking-tight text-foreground">Trabalhando</p>
              <p className="text-[12.5px] text-muted">desde 07:58</p>
            </div>
            <span className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[13px] font-medium text-primary-foreground">
              Bater ponto <ArrowRight size={14} strokeWidth={1.8} />
            </span>
          </div>
        </Card>

        <Card className="px-5 py-4" style={{ left: 508, top: 346, width: 330, height: 230 }}>
          <div className="flex items-center justify-between">
            <span className="text-[14px] font-semibold text-foreground">Aguardando análise</span>
            <span className="inline-flex items-center gap-1 text-[12.5px] text-muted">Ver todas <ArrowRight size={13} strokeWidth={1.8} /></span>
          </div>
          <p className="mt-2 text-[12.5px] text-muted">
            <span className="font-medium text-foreground">3</span> ajustes · <span className="font-medium text-foreground">0</span> justificativas
          </p>
          <div className="mt-1.5">
            {QUEUE.map((q) => (
              <div key={q.name} className="flex items-center justify-between border-b border-border py-[7px] last:border-b-0">
                <div>
                  <p className="text-[13px] text-foreground">{q.name}</p>
                  <p className="text-[11.5px] text-muted">{q.what}</p>
                </div>
                <span className="text-[11.5px] text-muted">{q.when}</span>
              </div>
            ))}
          </div>
        </Card>
      </motion.div>
    </div>
  );
};

export default OverviewScene;
