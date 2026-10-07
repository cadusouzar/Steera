import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, Briefcase, ChevronDown, ChevronRight, Plus, Search, User, Wallet } from 'lucide-react';
import { StatusBadge } from '../../../ui';
import type { TourViewProps } from '../tourTypes';
import TourTyped from './TourTyped';

// Cena "Funcionários" do tour (roteiro `func` do esboço): lista de funcionários (pages/app/
// EmployeesList) → "Novo funcionário" → formulário em abas (pages/app/EmployeeForm) com nome, CPF,
// telefone, cargo (que preenche o departamento, como no sistema), superior, admissão e salário →
// "Salvar funcionário" → Marina Alves aparece no topo da lista.
// sub: 0 lista · 1 aba Dados pessoais · 2 aba Cargo e vínculo · 3 aba Financeiro · 4 lista com Marina.
// typed.typedF: 1 nome · 2 CPF · 3 telefone · 4 cargo (+ departamento) · 5 superior · 6 admissão · 7 salário.
// Geometria usada pelo roteiro (coordenadas da área de conteúdo, 870 × 608; somar 230/52 para a
// janela): "Novo funcionário" x 662–838, y 28–66; formulário: "Salvar funcionário" x 605–745,
// y 54–88; abas em y 124–168 — "Cargo e vínculo" x 269–401, "Financeiro" x 405–517.

const EASE = [0.16, 1, 0.3, 1] as const;

const EMPLOYEES = [
  { name: 'Rafael Souza', role: 'Gerente', dept: 'Loja Centro', salary: 'R$ 5.800,00', active: true },
  { name: 'Fernanda Rocha', role: 'Confeiteira', dept: 'Produção', salary: 'R$ 3.200,00', active: true },
  { name: 'Diego Araújo', role: 'Padeiro', dept: 'Produção', salary: 'R$ 3.100,00', active: true },
  { name: 'Carla Mendes', role: 'Atendente', dept: 'Loja Centro', salary: 'R$ 2.400,00', active: true },
  { name: 'Bruno Lima', role: 'Caixa', dept: 'Loja Centro', salary: 'R$ 2.400,00', active: true },
  { name: 'Lucas Ferreira', role: 'Entregador', dept: 'Logística', salary: 'R$ 2.200,00', active: false },
];
const MARINA = { name: 'Marina Alves', role: 'Analista', dept: 'Financeiro', salary: 'R$ 4.100,00', active: true };

const COLS = 'grid grid-cols-[1.5fr_1fr_1fr_0.95fr_0.8fr_164px] items-center gap-3';

const TABS = [
  { label: 'Dados pessoais', icon: User, left: 12, width: 128 },
  { label: 'Cargo e vínculo', icon: Briefcase, left: 144, width: 132 },
  { label: 'Financeiro', icon: Wallet, left: 280, width: 112 },
];

interface FieldProps {
  label: string;
  required?: boolean;
  /** Valor digitado (ou já preenchido); vazio mostra o placeholder. */
  value?: string;
  placeholder?: string;
  focused?: boolean;
  select?: boolean;
  hint?: string;
  wide?: boolean;
}

const FakeField = ({ label, required, value, placeholder, focused, select, hint, wide }: FieldProps) => (
  <div className={wide ? 'col-span-2' : ''}>
    <p className="mb-1.5 text-[12.5px] font-medium text-foreground">
      {label}
      {required && <span className="text-danger"> *</span>}
    </p>
    <div
      className={`flex h-9 items-center justify-between gap-2 rounded-md border bg-panel px-3 text-[13px] transition-[border-color,box-shadow] duration-200 ${
        focused ? 'border-foreground/40 ring-2 ring-foreground/15' : 'border-border'
      }`}
    >
      {value ? (
        <span className="text-foreground">{focused && !select ? <TourTyped text={value} caret /> : value}</span>
      ) : (
        <span className="text-muted/80">{placeholder}</span>
      )}
      {select && <ChevronDown size={14} strokeWidth={1.8} className="shrink-0 text-muted" />}
    </div>
    {hint && <p className="mt-1 text-[11.5px] text-muted">{hint}</p>}
  </div>
);

/** Lista de funcionários; também é o fundo da cena de Férias (sem o destaque de "recém-cadastrada"). */
export const EmployeesListView = ({ added, flash = true }: { added: boolean; flash?: boolean }) => {
  const reduceMotion = useReducedMotion();
  const rows = added ? [MARINA, ...EMPLOYEES] : EMPLOYEES;
  const total = rows.length;
  const active = rows.filter((r) => r.active).length;
  return (
    <motion.div
      key="list"
      className="absolute inset-0"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="absolute left-8 top-6">
        <p className="text-[28px] font-semibold leading-tight tracking-tight text-foreground">Funcionários</p>
        <p className="mt-1 text-[14px] text-muted">Gerencie a base de pessoas da sua empresa.</p>
      </div>
      <span className="absolute right-8 top-7 inline-flex h-[38px] w-[176px] items-center justify-center gap-2 rounded-md bg-primary text-[13.5px] font-medium text-primary-foreground">
        <Plus size={16} strokeWidth={2} /> Novo funcionário
      </span>

      <div className="absolute left-8 right-8 top-24 flex gap-3">
        <div className="flex h-[38px] flex-1 items-center gap-2 rounded-md border border-border bg-panel px-3 text-[13px] text-muted/80">
          <Search size={15} strokeWidth={1.8} className="text-muted" /> Buscar por nome, cargo ou departamento
        </div>
        <div className="inline-flex h-[38px] items-center gap-0.5 rounded-md border border-border bg-secondary p-0.5 text-[12.5px]">
          <span className="flex h-full items-center rounded bg-panel px-3 text-foreground shadow-sm ring-1 ring-border/70">Todos {total}</span>
          <span className="flex h-full items-center px-3 text-muted">Ativos {active}</span>
          <span className="flex h-full items-center px-3 text-muted">Inativos {total - active}</span>
        </div>
      </div>

      <div className="absolute left-8 right-8 top-[148px] overflow-hidden rounded-lg border border-border bg-panel shadow-sm">
        <div className={`${COLS} h-10 border-b border-border px-5 text-[12.5px] font-medium text-muted`}>
          <span>Nome</span>
          <span>Cargo</span>
          <span>Departamento</span>
          <span className="text-right">Salário</span>
          <span>Situação</span>
          <span />
        </div>
        {rows.map((e, i) => {
          const isNew = flash && added && e === MARINA;
          return (
            <motion.div
              key={e.name}
              className={`${COLS} relative h-[46px] border-b border-border px-5 text-[13px] last:border-b-0`}
              initial={reduceMotion ? false : isNew ? { opacity: 0, scale: 0.97 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.4, delay: isNew ? 0 : 0.12 + i * 0.06, ease: EASE }}
            >
              {isNew && !reduceMotion && (
                <motion.span
                  className="absolute inset-0 bg-secondary"
                  initial={{ opacity: 1 }}
                  animate={{ opacity: 0 }}
                  transition={{ duration: 2, delay: 0.4 }}
                />
              )}
              <span className="relative truncate font-medium text-foreground">{e.name}</span>
              <span className="relative truncate text-muted">{e.role}</span>
              <span className="relative truncate text-muted">{e.dept}</span>
              <span className="relative text-right tabular-nums text-foreground">{e.salary}</span>
              <span className="relative">
                <StatusBadge tone={e.active ? 'success' : 'neutral'}>{e.active ? 'Ativo' : 'Inativo'}</StatusBadge>
              </span>
              <span className="relative flex items-center justify-end gap-1.5 text-[12.5px] text-muted">
                <Wallet size={14} strokeWidth={1.7} /> Pagamentos e férias
                <ChevronRight size={15} strokeWidth={1.6} />
              </span>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
};

const FormView = ({ tab, t }: { tab: number; t: number }) => {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      key="form"
      className="absolute inset-0"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      <p className="absolute left-[125px] top-5 inline-flex items-center gap-1.5 text-[12.5px] text-muted">
        <ArrowLeft size={14} strokeWidth={1.8} /> Funcionários
      </p>
      <p className="absolute left-[125px] top-[42px] text-[26px] font-semibold leading-tight tracking-tight text-foreground">Novo funcionário</p>
      <p className="absolute left-[125px] top-[78px] w-[360px] text-[12.5px] leading-snug text-muted">
        Os campos com * são obrigatórios. Advertências e férias ficam na ficha, depois do cadastro.
      </p>
      <span className="absolute left-[511px] top-[54px] inline-flex h-[34px] w-[86px] items-center justify-center rounded-md border border-border bg-panel text-[13px] font-medium text-foreground">
        Cancelar
      </span>
      <span className="absolute left-[605px] top-[54px] inline-flex h-[34px] w-[140px] items-center justify-center rounded-md bg-primary text-[13px] font-medium text-primary-foreground">
        Salvar funcionário
      </span>

      <motion.div
        className="absolute left-[125px] top-[124px] w-[620px] rounded-lg border border-border bg-panel shadow-sm"
        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.06, ease: EASE }}
      >
        <div className="relative h-11 border-b border-border">
          {TABS.map((tb, i) => {
            const Icon = tb.icon;
            const on = i === tab;
            return (
              <span
                key={tb.label}
                className={`absolute top-0 flex h-11 items-center justify-center gap-2 text-[13px] transition-colors duration-200 ${on ? 'text-foreground' : 'text-muted'}`}
                style={{ left: tb.left, width: tb.width }}
              >
                <Icon size={15} strokeWidth={1.7} /> {tb.label}
              </span>
            );
          })}
          <span
            className="absolute bottom-0 h-[2px] rounded-full bg-foreground transition-[left,width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{ left: TABS[tab].left + 8, width: TABS[tab].width - 16 }}
          />
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 p-5">
          {tab === 0 && (
            <>
              <FakeField wide label="Nome completo" required value={t >= 1 ? 'Marina Alves' : ''} focused={t === 1} />
              <FakeField label="CPF" required value={t >= 2 ? '123.456.789-09' : ''} placeholder="000.000.000-00" focused={t === 2} />
              <FakeField label="E-mail" placeholder="email@exemplo.com" />
              <FakeField label="Telefone / WhatsApp" value={t >= 3 ? '(11) 99123-4567' : ''} placeholder="(00) 00000-0000" focused={t === 3} />
              <FakeField label="Endereço" placeholder="Rua, número, bairro, cidade" />
            </>
          )}
          {tab === 1 && (
            <>
              <FakeField
                wide select label="Cargo" required value={t >= 4 ? 'Analista (Financeiro)' : ''} placeholder="Selecione um cargo"
                focused={t === 4} hint="Os cargos são cadastrados na tela de Cargos."
              />
              <FakeField
                wide select label="Superior" value={t >= 5 ? 'Rafael Souza' : 'Nenhum (sem superior)'} focused={t === 5}
                hint="Quem administra o ponto deste funcionário (aprova ou rejeita ajustes e corrige marcações). Opcional."
              />
              <FakeField wide label="Departamento" required value={t >= 4 ? 'Financeiro' : ''} />
              <FakeField label="Data de admissão" required value={t >= 6 ? '06/10/2026' : ''} placeholder="dd/mm/aaaa" focused={t === 6} />
              <FakeField select label="Tipo de contrato" value="CLT" />
            </>
          )}
          {tab === 2 && (
            <>
              <FakeField label="Salário base (R$)" required value={t >= 7 ? '4.100,00' : ''} placeholder="0,00" focused={t === 7} />
              <FakeField select label="Dia de pagamento" value="5º dia útil" />
              <FakeField wide label="Dados bancários" hint="Opcional: banco, agência, conta ou PIX." />
              <div className="col-span-2 flex items-start justify-between gap-4 rounded-md border border-border px-4 py-3">
                <div>
                  <p className="text-[13px] font-medium text-foreground">Gerar o salário automaticamente todo mês</p>
                  <p className="mt-0.5 text-[12px] text-muted">Cria o pagamento do salário no dia escolhido, sem precisar lançar à mão.</p>
                </div>
                <span className="relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-foreground">
                  <span className="inline-block h-5 w-5 translate-x-[22px] rounded-full bg-panel shadow-sm" />
                </span>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

const EmployeesScene = ({ sub, typed }: TourViewProps) => {
  const t = typed.typedF ?? 0;
  const formOpen = sub >= 1 && sub <= 3;
  return (
    <div className="absolute inset-0">
      <AnimatePresence initial={false}>
        {formOpen ? <FormView key="form" tab={sub - 1} t={t} /> : <EmployeesListView key={sub >= 4 ? 'list-added' : 'list'} added={sub >= 4} />}
      </AnimatePresence>
    </div>
  );
};

export default EmployeesScene;
