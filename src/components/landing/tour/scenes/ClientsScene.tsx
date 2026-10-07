import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, CheckCircle2, ChevronRight, FileText, Pencil, Plus, Repeat, Search, Trash2, Undo2, X } from 'lucide-react';
import { StatusBadge, type StatusTone } from '../../../ui';
import type { TourViewProps } from '../tourTypes';
import { Backdrop, FakeButton, FakeField, FakeSegmented, RowFlash, Screen, TourDrawer } from './tourParts';
import { EASE, useRise } from './tourMotion';

// Cena "Clientes e cobrança" do tour (roteiro `clientes` do esboço): lista de clientes
// (pages/app/ClientsList) com os totais da carteira → "Novo cliente" → formulário
// (pages/app/ClientForm) → "Salvar cliente" → o cliente novo aparece no topo; depois a linha do
// Mercado São Jorge abre a ficha (components/ClientFinanceDrawer), o lançamento atrasado de setembro
// é marcado como pago e, ao fechar a ficha, a situação e os totais da lista já estão atualizados.
// sub: 0 lista · 1 formulário · 2 lista com o cliente novo · 3 ficha · 4 lançamento pago ·
// 5 lista atualizada.
// typed.typedC: 1 nome · 2 categoria · 3 telefone · 4 e-mail.
// Geometria (área de conteúdo 870 × 608; somar 230/52 para a janela): "Novo cliente" x 706–838,
// y 28–66; formulário: "Salvar cliente" x 621–745, y 54–88; tabela com linhas de 50 px a partir de
// y 287; ficha (gaveta) x 270–870, "Marcar como pago" do 1º lançamento à direita.

const NEW_CLIENT = 'Restaurante Sabor da Casa';

const brlCompact = (n: number) => `R$ ${(n / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mil`;

type Health = 'overdue' | 'open' | 'ok';
const HEALTH: Record<Health, { label: string; tone: StatusTone }> = {
  overdue: { label: 'Com atrasos', tone: 'danger' },
  open: { label: 'Em aberto', tone: 'warning' },
  ok: { label: 'Em dia', tone: 'success' },
};

interface ClientRow { name: string; info: string; contact: string; paid: string; open: string; overdue?: string; health: Health; isNew?: boolean }

const CLIENTS: ClientRow[] = [
  { name: 'Mercado São Jorge', info: 'Mercearia · compras@saojorge.com.br', contact: '(11) 3456-7788', paid: 'R$ 6.000,00', open: 'R$ 2.400,00', overdue: 'R$ 1.200,00', health: 'overdue' },
  { name: 'Café Bom Dia', info: 'Cafeteria · contato@cafebomdia.com.br', contact: '(11) 99812-3344', paid: 'R$ 3.150,00', open: 'R$ 1.500,00', overdue: 'R$ 750,00', health: 'overdue' },
  { name: 'Hotel Primavera', info: 'Hotelaria · reservas@hotelprimavera.com.br', contact: '(11) 3021-4455', paid: 'R$ 8.900,00', open: 'R$ 1.350,00', overdue: 'R$ 450,00', health: 'overdue' },
  { name: 'Lanchonete Ponto Certo', info: 'Lanchonete · pontocerto@email.com', contact: '(11) 97733-1020', paid: 'R$ 4.800,00', open: 'R$ 0,00', health: 'ok' },
  { name: 'Escola Pequeno Príncipe', info: 'Escola · financeiro@pequenoprincipe.com.br', contact: '(11) 3388-9900', paid: 'R$ 2.200,00', open: 'R$ 950,00', health: 'open' },
];
const NEW_ROW: ClientRow = { name: NEW_CLIENT, info: 'Restaurante · compras@saborcasa.com.br', contact: '(11) 98765-4321', paid: 'R$ 0,00', open: 'R$ 0,00', health: 'ok', isNew: true };
const MERCADO_PAID: ClientRow = { ...CLIENTS[0], paid: 'R$ 7.200,00', open: 'R$ 1.200,00', overdue: undefined, health: 'open' };

const COLS = 'grid grid-cols-[1.75fr_1fr_0.85fr_0.95fr_104px_20px] items-center gap-3';

const ListView = ({ sub }: { sub: number }) => {
  const reduceMotion = useReducedMotion();
  const rise = useRise();
  const added = sub >= 2;
  const paid = sub >= 4;
  const rows = [...(added ? [NEW_ROW] : []), ...(paid ? [MERCADO_PAID, ...CLIENTS.slice(1)] : CLIENTS)];
  const stats = [
    { label: 'Recebido', value: brlCompact(paid ? 49500 : 48300), footer: 'Pagamentos confirmados' },
    { label: 'A receber', value: brlCompact(12600), footer: 'Dentro do prazo' },
    { label: 'Em atraso', value: brlCompact(paid ? 1200 : 2400), footer: paid ? '2 clientes com atraso' : '3 clientes com atraso' },
    { label: 'Clientes', value: String(added ? 42 : 41), footer: `${added ? 36 : 35} em dia` },
  ];
  return (
    <>
      <div className="absolute left-8 top-6">
        <p className="text-[28px] font-semibold leading-tight tracking-tight text-foreground">Clientes</p>
        <p className="mt-1 text-[14px] text-muted">Cadastros, cobranças e assinaturas de cada cliente.</p>
      </div>
      <div className="absolute right-8 top-7 flex gap-2">
        <FakeButton variant="secondary" icon={FileText} className="h-[38px]">Relatórios</FakeButton>
        <FakeButton variant="ghost" icon={Trash2} className="h-[38px]">Lixeira</FakeButton>
        <FakeButton icon={Plus} className="h-[38px] w-[132px]">Novo cliente</FakeButton>
      </div>

      <div className="absolute left-8 right-8 top-[92px] grid grid-cols-4 gap-3">
        {stats.map((s, i) => (
          <motion.div key={s.label} {...rise(0.04 + i * 0.04)} className="h-[84px] rounded-lg border border-border bg-panel px-4 py-3 shadow-sm">
            <p className="text-[12.5px] text-muted">{s.label}</p>
            <p className="mt-1 text-[21px] font-semibold leading-tight tracking-tight tabular-nums text-foreground">{s.value}</p>
            <p className="mt-0.5 text-[11.5px] text-muted">{s.footer}</p>
          </motion.div>
        ))}
      </div>

      <div className="absolute left-8 right-8 top-[192px] flex gap-3">
        <div className="flex h-[38px] flex-1 items-center gap-2 rounded-md border border-border bg-panel px-3 text-[13px] text-muted/80">
          <Search size={15} strokeWidth={1.8} className="text-muted" /> Buscar por nome, contato, e-mail ou categoria
        </div>
        <FakeSegmented options={['Todos', `Com atrasos ${paid ? 2 : 3}`, `Em aberto ${paid ? 2 : 1}`, `Em dia ${added ? 36 : 35}`]} active={0} />
      </div>

      <div className="absolute left-8 right-8 top-[246px] overflow-hidden rounded-lg border border-border bg-panel shadow-sm">
        <div className={`${COLS} h-10 border-b border-border px-5 text-[12.5px] font-medium text-muted`}>
          <span>Cliente</span>
          <span>Contato</span>
          <span className="text-right">Pago</span>
          <span className="text-right">Em aberto</span>
          <span>Situação</span>
          <span />
        </div>
        {rows.map((c, i) => {
          const health = HEALTH[c.health];
          const isNew = !!c.isNew && sub === 2;
          const changed = paid && c.name === CLIENTS[0].name && sub >= 5;
          return (
            <motion.div
              key={c.name}
              className={`${COLS} relative h-[50px] border-b border-border px-5 text-[13px] last:border-b-0 ${(sub === 3 || sub === 4) && c.name === CLIENTS[0].name ? 'bg-secondary/70' : ''}`}
              initial={reduceMotion ? false : isNew ? { opacity: 0, scale: 0.97 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.4, delay: isNew ? 0 : 0.12 + i * 0.05, ease: EASE }}
            >
              {(isNew || changed) && <RowFlash />}
              <span className="relative min-w-0">
                <span className="block truncate font-medium text-foreground">{c.name}</span>
                <span className="block truncate text-[11.5px] text-muted">{c.info}</span>
              </span>
              <span className="relative truncate whitespace-nowrap text-muted">{c.contact}</span>
              <span className="relative text-right tabular-nums text-foreground">{c.paid}</span>
              <span className="relative text-right">
                <span className="block tabular-nums text-foreground">{c.open}</span>
                {c.overdue && <span className="block text-[11.5px] tabular-nums text-danger">{c.overdue} em atraso</span>}
              </span>
              <span className="relative"><StatusBadge tone={health.tone}>{health.label}</StatusBadge></span>
              <ChevronRight size={16} strokeWidth={1.6} className="relative justify-self-end text-muted" />
            </motion.div>
          );
        })}
      </div>
    </>
  );
};

const FormView = ({ t }: { t: number }) => {
  const reduceMotion = useReducedMotion();
  return (
    <>
      <p className="absolute left-[125px] top-5 inline-flex items-center gap-1.5 text-[12.5px] text-muted">
        <ArrowLeft size={14} strokeWidth={1.8} /> Clientes
      </p>
      <p className="absolute left-[125px] top-[42px] text-[26px] font-semibold leading-tight tracking-tight text-foreground">Novo cliente</p>
      <p className="absolute left-[125px] top-[78px] w-[380px] text-[12.5px] leading-snug text-muted">
        Os campos com * são obrigatórios. Cobranças e assinaturas ficam na ficha, depois do cadastro.
      </p>
      <FakeButton variant="secondary" size="sm" className="absolute left-[527px] top-[54px] h-[34px] w-[86px]">Cancelar</FakeButton>
      <FakeButton size="sm" className="absolute left-[621px] top-[54px] h-[34px] w-[124px]">Salvar cliente</FakeButton>

      <motion.div
        className="absolute left-[125px] top-[124px] grid w-[620px] grid-cols-2 gap-x-4 gap-y-3.5 rounded-lg border border-border bg-panel p-5 shadow-sm"
        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.06, ease: EASE }}
      >
        <FakeField className="col-span-2" label="Nome" required value={t >= 1 ? NEW_CLIENT : ''} placeholder="Nome da pessoa ou empresa" focused={t === 1} />
        <FakeField label="Categoria ou observação" value={t >= 2 ? 'Restaurante' : ''} focused={t === 2} hint="Ex.: turma, plano, segmento." />
        <FakeField label="Telefone ou contato" required value={t >= 3 ? '(11) 98765-4321' : ''} placeholder="(00) 00000-0000" focused={t === 3} />
        <FakeField className="col-span-2" label="E-mail" value={t >= 4 ? 'compras@saborcasa.com.br' : ''} placeholder="email@exemplo.com" focused={t === 4} />
      </motion.div>
    </>
  );
};

interface Receivable { id: string; title: string; due: string; paid: boolean; overdue: boolean }

const ClientDrawer = ({ sub }: { sub: number }) => {
  const paid = sub >= 4;
  const receivables: Receivable[] = [
    { id: 'set', title: 'Fornecimento de pães · setembro', due: 'Vence 10/09/2026 · assinatura', paid, overdue: !paid },
    { id: 'out', title: 'Fornecimento de pães · outubro', due: 'Vence 10/10/2026 · assinatura', paid: false, overdue: false },
  ];
  return (
    <TourDrawer width={600}>
      <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
        <div>
          <p className="text-[17px] font-semibold text-foreground">Mercado São Jorge</p>
          <p className="mt-0.5 text-[13.5px] text-muted">Mercearia</p>
        </div>
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted"><X size={17} strokeWidth={1.8} /></span>
      </div>
      <div className="flex-1 overflow-hidden px-6 py-5">
        <div className="mb-5 grid grid-cols-[1fr_1.6fr_1fr_1fr] gap-x-4 rounded-md border border-border px-4 py-3">
          <div><p className="text-[12px] text-muted">Contato</p><p className="mt-0.5 text-[13.5px] text-foreground">(11) 3456-7788</p></div>
          <div className="min-w-0"><p className="text-[12px] text-muted">E-mail</p><p className="mt-0.5 truncate text-[13.5px] text-foreground">compras@saojorge.com.br</p></div>
          <div><p className="text-[12px] text-muted">Pago</p><p className="mt-0.5 text-[13.5px] tabular-nums text-foreground">{paid ? 'R$ 7.200,00' : 'R$ 6.000,00'}</p></div>
          <div>
            <p className="text-[12px] text-muted">Em aberto</p>
            <p className="mt-0.5 text-[13.5px] tabular-nums text-foreground">{paid ? 'R$ 1.200,00' : 'R$ 2.400,00'}</p>
            {!paid && <p className="text-[11.5px] tabular-nums text-danger">R$ 1.200,00 em atraso</p>}
          </div>
        </div>

        <div className="border-b border-border pb-5">
          <div className="mb-3 flex h-8 items-center justify-between">
            <p className="text-[14px] font-semibold text-foreground">Assinaturas ativas</p>
            <FakeButton variant="secondary" size="sm" icon={Plus}>Nova assinatura</FakeButton>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-md border border-border px-4 py-3">
            <div>
              <p className="flex items-center gap-1.5 text-[13.5px] font-medium text-foreground">
                <Repeat size={14} strokeWidth={1.8} className="text-muted" /> Fornecimento semanal de pães
              </p>
              <p className="text-[12.5px] text-muted"><span className="tabular-nums text-foreground">R$ 1.200,00</span> · vence todo dia 10</p>
            </div>
            <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
              <CheckCircle2 size={14} strokeWidth={1.8} className="text-success" /> Fatura do mês gerada
            </span>
          </div>
        </div>

        <div className="pt-5">
          <div className="mb-3 flex h-8 items-center justify-between">
            <p className="text-[14px] font-semibold text-foreground">Lançamentos</p>
            <FakeButton variant="secondary" size="sm" icon={Plus}>Nova cobrança</FakeButton>
          </div>
          <ul className="divide-y divide-border rounded-md border border-border">
            {receivables.map((r) => {
              const status = r.paid ? { label: 'Pago', tone: 'success' as const } : r.overdue ? { label: 'Atrasado', tone: 'danger' as const } : { label: 'Pendente', tone: 'warning' as const };
              return (
                <li key={r.id} className="relative px-4 py-3">
                  {r.id === 'set' && paid && <RowFlash />}
                  <div className="relative flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-medium text-foreground">{r.title}</p>
                      <p className="text-[12.5px] text-muted">{r.due}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[13.5px] tabular-nums text-foreground">R$ 1.200,00</p>
                      <div className="mt-1"><StatusBadge tone={status.tone}>{status.label}</StatusBadge></div>
                    </div>
                  </div>
                  <div className="relative mt-2 flex items-center justify-end gap-1">
                    <FakeButton variant="ghost" size="sm" icon={Trash2}>Excluir</FakeButton>
                    {r.paid
                      ? <FakeButton variant="ghost" size="sm" icon={Undo2}>Desfazer pagamento</FakeButton>
                      : <FakeButton variant="secondary" size="sm" icon={CheckCircle2}>Marcar como pago</FakeButton>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
        <FakeButton variant="ghost" icon={Trash2} className="mr-auto">Excluir cliente</FakeButton>
        <FakeButton icon={Pencil}>Editar</FakeButton>
      </div>
    </TourDrawer>
  );
};

const ClientsScene = ({ sub, typed }: TourViewProps) => {
  const t = typed.typedC ?? 0;
  const drawerOpen = sub === 3 || sub === 4;
  return (
    <div className="absolute inset-0">
      <AnimatePresence initial={false}>
        {sub === 1 ? (
          <Screen key="form"><FormView t={t} /></Screen>
        ) : (
          <Screen key={sub >= 2 ? 'list-added' : 'list'}><ListView sub={sub} /></Screen>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {drawerOpen && <Backdrop key="backdrop" />}
        {drawerOpen && <ClientDrawer key="drawer" sub={sub} />}
      </AnimatePresence>
    </div>
  );
};

export default ClientsScene;
