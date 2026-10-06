import { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronRight, FileText, Plus, Search, Trash2, X } from 'lucide-react';
import ClientFinanceDrawer from '../../components/ClientFinanceDrawer';
import ClientReportModal from '../../components/ClientReportModal';
import ClientTrashDrawer from '../../components/ClientTrashDrawer';
import {
  Button, ButtonLink, EmptyState, Input, Notice, PageHeader, SegmentedControl, StatCard, StatValue,
  StatusBadge, Table, TBody, TD, TH, THead, TR, toast, type LoadStatus, type StatusTone,
} from '../../components/ui';
import * as api from '../../lib/api';
import { useCan } from '../../lib/auth';
import { reloadAfterSave } from '../../lib/reloadAfterSave';
import type { ClientRecord, ClientTotals } from '../../lib/api';

export type { Receivable, Subscription } from '../../lib/api';
import type { Receivable, Subscription } from '../../lib/api';

// Clientes (redesenho monocromático, etapa 5 do polimento — 01/10/2026): tudo no kit de peças.
// Mudanças aprovadas pelo usuário: totais da carteira no topo (somados dos totais que a tela já
// carrega, sem rota nova); o "Filtros" sem ação virou o seletor de situação; a tabela caiu de 9
// colunas (1400px mínimos) para 5 — "Total gerado"/"Total pendente" só repetiam os outros números.

export interface Client extends ClientRecord {
  receivables: Receivable[];
  subscriptions: Subscription[];
}

export type ClientHealth = 'overdue' | 'open' | 'ok';
type HealthFilter = 'all' | ClientHealth;

const EMPTY_TOTALS: ClientTotals = { totalPaid: 0, totalPending: 0, totalOverdue: 0 };

const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

const healthOf = (t: ClientTotals): ClientHealth => (t.totalOverdue > 0 ? 'overdue' : t.totalPending > 0 ? 'open' : 'ok');

const HEALTH: Record<ClientHealth, { label: string; tone: StatusTone }> = {
  overdue: { label: 'Com atrasos', tone: 'danger' },
  open: { label: 'Em aberto', tone: 'warning' },
  ok: { label: 'Em dia', tone: 'success' },
};

const ClientsList = () => {
  // Permissões por ação: "Novo cliente" e restaurar da lixeira só com `clientes.gerenciar`;
  // lançamentos/assinaturas no drawer só são buscados com `financas.lancamentos.ver`.
  const can = useCan();
  const canManageClients = can('clientes.gerenciar');
  const canViewFinance = can('financas.lancamentos.ver');
  const [clients, setClients] = useState<Client[]>([]);
  const [totalsByClientId, setTotalsByClientId] = useState<Record<string, ClientTotals>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [isDrawerLoading, setIsDrawerLoading] = useState(false);

  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isTrashOpen, setIsTrashOpen] = useState(false);

  const loadClients = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const basics = await api.listClients();
      setClients(basics.map((c) => ({ ...c, receivables: [], subscriptions: [] })));

      // Uma chamada por cliente (pendência registrada no vault: falta uma rota que devolva os
      // totais da carteira de uma vez).
      const totalsEntries = await Promise.all(
        basics.map(async (c) => [c.id, await api.getClientTotals(c.id).catch(() => EMPTY_TOTALS)] as const),
      );
      setTotalsByClientId(Object.fromEntries(totalsEntries));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar os clientes.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  const totalsOf = useCallback((id: string) => totalsByClientId[id] ?? EMPTY_TOTALS, [totalsByClientId]);

  const portfolio = useMemo(() => clients.reduce(
    (acc, c) => {
      const t = totalsOf(c.id);
      acc.paid += t.totalPaid;
      acc.pending += t.totalPending;
      acc.overdue += t.totalOverdue;
      acc.byHealth[healthOf(t)] += 1;
      return acc;
    },
    { paid: 0, pending: 0, overdue: 0, byHealth: { overdue: 0, open: 0, ok: 0 } as Record<ClientHealth, number> },
  ), [clients, totalsOf]);

  const filteredClients = clients.filter(c => {
    if (healthFilter !== 'all' && healthOf(totalsOf(c.id)) !== healthFilter) return false;
    if (!searchQuery) return true;
    const lowerQuery = searchQuery.toLowerCase().trim();
    return c.name.toLowerCase().includes(lowerQuery) ||
           c.category.toLowerCase().includes(lowerQuery) ||
           c.contact.toLowerCase().includes(lowerQuery) ||
           (c.email ?? '').toLowerCase().includes(lowerQuery);
  });

  // Re-fetches one client's receivables/subscriptions/totals and syncs them
  // into both the open drawer (if it's this client) and the totals used by
  // the table's health badge.
  const refreshClientDetails = async (clientId: string) => {
    if (!canViewFinance) return;
    const [receivables, subscriptions, totals] = await Promise.all([
      api.listReceivables(clientId),
      api.listSubscriptions(clientId),
      api.getClientTotals(clientId).catch(() => EMPTY_TOTALS),
    ]);

    setTotalsByClientId(prev => ({ ...prev, [clientId]: totals }));
    setSelectedClient(prev => (prev && prev.id === clientId ? { ...prev, receivables, subscriptions } : prev));
  };

  const handleSelectClient = async (client: Client) => {
    setSelectedClient(client);
    setActionError(null);
    if (!canViewFinance) return;
    setIsDrawerLoading(true);
    try {
      const [receivables, subscriptions] = await Promise.all([
        api.listReceivables(client.id),
        api.listSubscriptions(client.id),
      ]);
      setSelectedClient(prev => (prev && prev.id === client.id ? { ...prev, receivables, subscriptions } : prev));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível carregar os dados do cliente.');
    } finally {
      setIsDrawerLoading(false);
    }
  };

  // Envolve cada ação do drawer: limpa o erro anterior, executa, recarrega o cliente e devolve se deu certo
  // (as janelas do drawer só fecham quando a ação passou).
  const runAction = async (clientId: string, action: () => Promise<unknown>, fallback: string, successMessage: string): Promise<boolean> => {
    setActionError(null);
    try {
      await action();
      toast.success(successMessage);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : fallback);
      return false;
    }
    // A ação já deu certo: se só a recarga falhar, não pode virar "erro ao salvar" (a janela ficaria aberta e o reenvio duplicaria).
    await reloadAfterSave(() => refreshClientDetails(clientId), setActionError);
    return true;
  };

  const handleUpdateClient = async (
    clientId: string,
    dto: Partial<{ name: string; category: string; contact: string; email: string | null; customFields: Record<string, unknown> }>,
  ): Promise<boolean> => {
    setActionError(null);
    try {
      const updated = await api.updateClient(clientId, dto);
      toast.success(`Cliente atualizado: ${updated.name}`);
      setClients(prev => prev.map(c => (c.id === clientId ? { ...c, ...updated } : c)));
      setSelectedClient(prev => (prev && prev.id === clientId ? { ...prev, ...updated } : prev));
      return true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível salvar as alterações do cliente.');
      return false;
    }
  };

  // "Excluir cliente" na UI — exclusão lógica (inativa o cliente; não existe
  // hard delete no backend de propósito, pra preservar o histórico financeiro).
  // Só some da tabela local quando vai pra lixeira (includeInRevenueReport=
  // false) — quem é mantido no relatório continua na lista, só com o selo
  // "Inativo", já que precisa ficar alcançável pra ser reativado.
  const handleDeactivateClient = async (clientId: string, includeInRevenueReport: boolean): Promise<boolean> => {
    setActionError(null);
    try {
      const updated = await api.deactivateClient(clientId, includeInRevenueReport);
      toast.success(includeInRevenueReport ? `Cliente desativado: ${updated.name}` : `Cliente enviado para a lixeira: ${updated.name}`);
      if (includeInRevenueReport) {
        setClients(prev => prev.map(c => (c.id === clientId ? { ...c, ...updated } : c)));
      } else {
        setClients(prev => prev.filter(c => c.id !== clientId));
        setTotalsByClientId(prev => {
          const next = { ...prev };
          delete next[clientId];
          return next;
        });
      }
      setSelectedClient(null);
      return true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível excluir o cliente.');
      return false;
    }
  };

  // "Reativar cliente" — desfaz a inativação (só aparece pra cliente
  // inativo mantido no relatório; o grupo removido do relatório vai pra
  // lixeira e reativa por lá).
  const handleRestoreClient = async (clientId: string): Promise<boolean> => {
    setActionError(null);
    try {
      const updated = await api.restoreClient(clientId);
      toast.success(`Cliente restaurado: ${updated.name}`);
      setClients(prev => prev.map(c => (c.id === clientId ? { ...c, ...updated } : c)));
      setSelectedClient(prev => (prev && prev.id === clientId ? { ...prev, ...updated } : prev));
      return true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível reativar o cliente.');
      return false;
    }
  };

  const statStatus: LoadStatus = isLoading ? 'loading' : loadError ? 'error' : 'ready';
  const statError = <span className="text-[13px] text-muted">Indisponível</span>;
  const money = (n: number) => formatCurrency(n);

  const emptyState = clients.length === 0 ? (
    <EmptyState
      title="Nenhum cliente ainda"
      description="Cadastre o primeiro cliente para lançar cobranças e assinaturas."
      action={canManageClients ? <ButtonLink to="/app/clientes/novo" icon={Plus}>Novo cliente</ButtonLink> : undefined}
    />
  ) : (
    <EmptyState
      title="Nenhum cliente encontrado"
      description={searchQuery ? `Nada corresponde a “${searchQuery}” neste filtro.` : 'Nenhum cliente nesta situação.'}
      action={<Button variant="secondary" onClick={() => { setSearchQuery(''); setHealthFilter('all'); }}>Limpar busca e filtro</Button>}
    />
  );

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <div className="max-w-6xl mx-auto">
        <PageHeader
          title="Clientes"
          description="Cadastros, cobranças e assinaturas de cada cliente."
          actions={
            <>
              {canViewFinance && <Button variant="secondary" icon={FileText} onClick={() => setIsReportModalOpen(true)}>Relatórios</Button>}
              <Button variant="ghost" icon={Trash2} onClick={() => setIsTrashOpen(true)}>Lixeira</Button>
              {canManageClients && <ButtonLink to="/app/clientes/novo" icon={Plus}>Novo cliente</ButtonLink>}
            </>
          }
        />

        {canViewFinance && (
          <div className="mb-6 grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            <StatCard label="Recebido" status={statStatus} error={statError} value={<StatValue value={portfolio.paid} format={money} compact />} footer="Pagamentos confirmados" />
            <StatCard label="A receber" status={statStatus} error={statError} value={<StatValue value={portfolio.pending} format={money} compact />} footer="Dentro do prazo" />
            <StatCard
              label="Em atraso"
              status={statStatus}
              error={statError}
              value={<StatValue value={portfolio.overdue} format={money} compact />}
              footer={portfolio.byHealth.overdue === 0 ? 'Nenhum cliente atrasado' : `${portfolio.byHealth.overdue} cliente${portfolio.byHealth.overdue === 1 ? '' : 's'} com atraso`}
            />
            <StatCard
              label="Clientes"
              status={statStatus}
              error={statError}
              value={<StatValue value={clients.length} />}
              footer={`${portfolio.byHealth.ok} em dia`}
            />
          </div>
        )}

        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search size={16} strokeWidth={1.8} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
            <Input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por nome, contato, e-mail ou categoria"
              aria-label="Buscar clientes"
              className="pl-9 pr-9"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded text-muted hover:text-foreground hover:bg-secondary"
                aria-label="Limpar busca"
              >
                <X size={15} strokeWidth={1.8} />
              </button>
            )}
          </div>
          {canViewFinance && (
            <div className="overflow-x-auto scrollbar-none -mx-4 px-4 md:mx-0 md:px-0">
              <SegmentedControl<HealthFilter>
                label="Filtrar por situação financeira"
                value={healthFilter}
                onChange={setHealthFilter}
                options={[
                  { value: 'all', label: 'Todos' },
                  { value: 'overdue', label: `Com atrasos ${portfolio.byHealth.overdue}` },
                  { value: 'open', label: `Em aberto ${portfolio.byHealth.open}` },
                  { value: 'ok', label: `Em dia ${portfolio.byHealth.ok}` },
                ]}
              />
            </div>
          )}
        </div>

        {loadError && (
          <Notice tone="danger" className="mb-4">
            {loadError}{' '}
            <button type="button" onClick={() => loadClients()} className="underline underline-offset-4 font-medium">Tentar de novo</button>
          </Notice>
        )}

        <div className="bg-panel border border-border rounded-lg shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="divide-y divide-border" aria-label="Carregando clientes" role="status">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-6 px-5 h-14">
                  <span className="skeleton h-4 w-44" />
                  <span className="skeleton h-4 w-24 hidden sm:block" />
                  <span className="skeleton h-4 w-20 ml-auto" />
                  <span className="skeleton h-4 w-16" />
                </div>
              ))}
            </div>
          ) : loadError ? null : filteredClients.length > 0 ? (
            <Table>
              <THead>
                <tr>
                  <TH>Cliente</TH>
                  <TH className="hidden md:table-cell">Contato</TH>
                  {canViewFinance && <TH align="right" className="hidden sm:table-cell">Pago</TH>}
                  {canViewFinance && <TH align="right">Em aberto</TH>}
                  {canViewFinance && <TH className="hidden sm:table-cell">Situação</TH>}
                  <TH align="right"><span className="sr-only">Abrir</span></TH>
                </tr>
              </THead>
              <TBody>
                {filteredClients.map((client) => {
                  const totals = totalsOf(client.id);
                  const health = HEALTH[healthOf(totals)];
                  const outstanding = totals.totalPending + totals.totalOverdue;
                  return (
                    <TR key={client.id} interactive onClick={() => handleSelectClient(client)}>
                      <TD>
                        <div className="max-w-[165px] sm:max-w-none">
                        <div className="flex items-center gap-2 min-w-0">
                          {/* Botão real com o nome: dá acesso por teclado à ficha (a linha inteira é só atalho de mouse). */}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleSelectClient(client); }}
                            className="font-medium text-foreground text-left hover:underline underline-offset-4 outline-none focus-visible:underline truncate"
                          >
                            {client.name}
                          </button>
                          {client.status === 'inactive' && <StatusBadge tone="neutral">Inativo</StatusBadge>}
                        </div>
                        <span className="block text-[12px] text-muted truncate">
                          {[client.category, client.email].filter(Boolean).join(' · ') || 'Sem categoria'}
                        </span>
                        </div>
                      </TD>
                      <TD className="text-muted hidden md:table-cell whitespace-nowrap">{client.contact}</TD>
                      {canViewFinance && <TD align="right" className="tabular hidden sm:table-cell whitespace-nowrap">{formatCurrency(totals.totalPaid)}</TD>}
                      {canViewFinance && (
                        <TD align="right">
                          <span className="tabular whitespace-nowrap">{formatCurrency(outstanding)}</span>
                          {totals.totalOverdue > 0 && (
                            <span className="block text-[12px] text-danger tabular"><span className="whitespace-nowrap">{formatCurrency(totals.totalOverdue)}</span> em atraso</span>
                          )}
                        </TD>
                      )}
                      {canViewFinance && (
                        <TD className="hidden sm:table-cell">
                          <StatusBadge tone={health.tone}>{health.label}</StatusBadge>
                        </TD>
                      )}
                      <TD align="right" className="w-8">
                        <ChevronRight size={16} strokeWidth={1.6} className="text-muted inline" aria-hidden="true" />
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          ) : (
            emptyState
          )}
        </div>
      </div>

      <ClientFinanceDrawer
        client={selectedClient}
        totals={selectedClient ? totalsOf(selectedClient.id) : EMPTY_TOTALS}
        onClose={() => setSelectedClient(null)}
        isLoading={isDrawerLoading}
        actionError={actionError}
        onDismissError={() => setActionError(null)}
        onMarkAsPaid={(clientId, id) => runAction(clientId, () => api.payReceivable(id), 'Não foi possível marcar o lançamento como pago.', 'Lançamento marcado como pago')}
        onUnmarkAsPaid={(clientId, id) => runAction(clientId, () => api.unpayReceivable(id), 'Não foi possível desfazer o pagamento.', 'Lançamento voltou para pendente')}
        onDeleteReceivable={(clientId, id) => runAction(clientId, () => api.deleteReceivable(id), 'Não foi possível excluir o lançamento.', 'Lançamento excluído')}
        onDeleteSubscription={(clientId, id) => runAction(clientId, () => api.deleteSubscription(id), 'Não foi possível cancelar a assinatura.', 'Assinatura excluída')}
        onAddReceivable={(clientId, rec) => runAction(clientId, () => api.createReceivable(clientId, rec), 'Não foi possível lançar a cobrança.', 'Lançamento criado')}
        onAddSubscription={(clientId, sub) => runAction(clientId, () => api.createSubscription(clientId, sub), 'Não foi possível criar a assinatura.', 'Assinatura criada')}
        onGenerateCharge={(clientId, id) => runAction(clientId, () => api.generateCharge(id), 'Não foi possível gerar a fatura do mês.', 'Fatura do mês gerada')}
        onUpdateClient={handleUpdateClient}
        onDeactivateClient={handleDeactivateClient}
        onRestoreClient={handleRestoreClient}
      />

      <ClientReportModal open={isReportModalOpen} onClose={() => setIsReportModalOpen(false)} />

      <ClientTrashDrawer
        open={isTrashOpen}
        onClose={() => setIsTrashOpen(false)}
        onRestored={loadClients}
        canRestore={canManageClients}
      />
    </div>
  );
};

export default ClientsList;
