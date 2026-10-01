import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Pencil, Plus, Repeat, RotateCcw, Trash2, Undo2, Zap } from 'lucide-react';
import type { Client } from '../pages/app/ClientsList';
import type { ClientTotals } from '../lib/api';
import CustomFieldsFormSection from './CustomFieldsFormSection';
import {
  Button, ConfirmDialog, Drawer, EmptyState, Field, Input, Modal, Notice, SegmentedControl, StatusBadge,
  type StatusTone,
} from './ui';
import { isValidEmail, NAME_MAX_LENGTH } from '../lib/validation';
import { useCan } from '../lib/auth';

// Ficha do cliente (redesenho no kit, etapa 5 do polimento — 01/10/2026). Mudanças aprovadas: o
// "Gerar boleto" saiu (era simulação: só mostrava "Boleto gerado!" por 3s, sem nada no servidor);
// excluir lançamento, desfazer pagamento e cancelar assinatura confirmam numa janela do kit; o novo
// lançamento abre numa janela própria.

const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

// "YYYY-MM-DD" → "DD/MM/AAAA" sem passar por `Date` (que leria como meia-noite UTC e mostraria o
// dia anterior no Brasil).
const formatDateOnly = (value: string) => {
  const [year, month, day] = value.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
};

const RECEIVABLE_STATUS: Record<'paid' | 'pending' | 'overdue', { label: string; tone: StatusTone }> = {
  paid: { label: 'Pago', tone: 'success' },
  pending: { label: 'Pendente', tone: 'warning' },
  overdue: { label: 'Atrasado', tone: 'danger' },
};

type ClientEdit = Partial<{ name: string; category: string; contact: string; email: string | null; customFields: Record<string, unknown> }>;

type PendingConfirm =
  | { kind: 'deleteReceivable'; id: string; label: string }
  | { kind: 'unpay'; id: string; label: string }
  | { kind: 'deleteSubscription'; id: string; label: string };

interface ClientFinanceDrawerProps {
  client: Client | null;
  totals: ClientTotals;
  onClose: () => void;
  onMarkAsPaid: (clientId: string, receivableId: string) => Promise<boolean>;
  onUnmarkAsPaid: (clientId: string, receivableId: string) => Promise<boolean>;
  onDeleteReceivable: (clientId: string, receivableId: string) => Promise<boolean>;
  onAddReceivable: (clientId: string, rec: { description: string; amount: number; dueDate: string }) => Promise<boolean>;
  onAddSubscription: (clientId: string, sub: { description: string; amount: number; dueDay: number }) => Promise<boolean>;
  onDeleteSubscription: (clientId: string, subId: string) => Promise<boolean>;
  onGenerateCharge: (clientId: string, subId: string) => Promise<boolean>;
  isLoading?: boolean;
  actionError?: string | null;
  onDismissError?: () => void;
  onUpdateClient: (clientId: string, dto: ClientEdit) => Promise<boolean>;
  onDeactivateClient: (clientId: string, includeInRevenueReport: boolean) => Promise<boolean>;
  // Only ever offered for a client kept in the report (includeInRevenueReport
  // =true) — those stay reachable/inactive forever with no other UI path back
  // to active. A client removed from the report goes through the Lixeira's
  // own restore flow instead.
  onRestoreClient: (clientId: string) => Promise<boolean>;
}

const Section = ({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) => (
  <section className="py-5 first:pt-0 border-b border-border last:border-0">
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="text-[14px] font-semibold text-foreground">{title}</h3>
      {action}
    </div>
    {children}
  </section>
);

const ClientFinanceDrawer: React.FC<ClientFinanceDrawerProps> = ({
  client: clientProp, totals, onClose, onMarkAsPaid, onUnmarkAsPaid, onDeleteReceivable,
  onAddReceivable, onAddSubscription, onDeleteSubscription, onGenerateCharge, isLoading,
  actionError, onDismissError, onUpdateClient, onDeactivateClient, onRestoreClient,
}) => {
  // Permissões por ação (27/09/2026): editar/excluir/reativar o cliente exige `clientes.gerenciar`;
  // ver lançamentos/assinaturas exige `financas.lancamentos.ver`; criar/pagar/desfazer/excluir/gerar
  // fatura exige `financas.lancamentos.gerenciar`. Sem a permissão, o botão nem aparece.
  const can = useCan();
  const canManageClient = can('clientes.gerenciar');
  const canViewFinance = can('financas.lancamentos.ver');
  const canManageFinance = can('financas.lancamentos.gerenciar');

  // Mantém o último cliente na tela durante a animação de saída da gaveta.
  const lastClient = useRef<Client | null>(null);
  if (clientProp) lastClient.current = clientProp;
  const client = clientProp ?? lastClient.current;

  // Edição do cadastro
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', category: '', contact: '', email: '' });
  const [editCustomFields, setEditCustomFields] = useState<Record<string, unknown>>({});
  const [editErrors, setEditErrors] = useState<{ name?: string; contact?: string; email?: string }>({});
  const [isSaving, setIsSaving] = useState(false);

  // Novo lançamento
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addType, setAddType] = useState<'single' | 'recurring'>('single');
  const [newRec, setNewRec] = useState({ description: '', amount: '', dueDate: '' });
  const [newSub, setNewSub] = useState({ description: '', amount: '', dueDay: '' });
  const [isAdding, setIsAdding] = useState(false);

  // Ações por item
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Excluir (inativar) — duas escolhas excludentes (manter no relatório ou lixeira), não um "tem certeza?".
  const [isDeactivateOpen, setIsDeactivateOpen] = useState(false);
  const [deactivating, setDeactivating] = useState<'keep' | 'trash' | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  // Trocar de cliente (ou fechar) sempre sai da edição.
  const clientId = clientProp?.id;
  useEffect(() => {
    setIsEditing(false);
    setIsAddOpen(false);
  }, [clientId]);

  if (!client) return null;

  // "Assinaturas ativas" mostra só o que está em vigor — uma assinatura pausada (ex.: cliente
  // inativado, que pausa as assinaturas dele) não deve aparecer com "Gerar fatura do mês".
  const activeSubscriptions = client.subscriptions?.filter((sub) => sub.status === 'active') ?? [];
  const receivables = [...client.receivables].sort((a, b) => b.dueDate.localeCompare(a.dueDate));

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  // Só uma dica de interface — o backend continua sendo a fonte da verdade (um 409 vira erro na tela).
  const hasChargeThisMonth = (subscriptionId: string) =>
    client.receivables.some(
      (r) => r.subscriptionId === subscriptionId && r.referenceYear === currentYear && r.referenceMonth === currentMonth,
    );

  const handleEditClick = () => {
    setEditForm({ name: client.name, category: client.category ?? '', contact: client.contact, email: client.email ?? '' });
    setEditCustomFields(client.customFields ?? {});
    setEditErrors({});
    setIsEditing(true);
  };

  const validateEdit = () => {
    const errors: typeof editErrors = {};
    if (!editForm.name.trim()) errors.name = 'Informe o nome';
    else if (editForm.name.length > NAME_MAX_LENGTH) errors.name = `Nome deve ter no máximo ${NAME_MAX_LENGTH} caracteres`;
    if (!editForm.contact.trim()) errors.contact = 'Informe um contato';
    if (editForm.email && !isValidEmail(editForm.email)) errors.email = 'E-mail inválido';
    setEditErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveEdit = async () => {
    if (isSaving || !validateEdit()) return;
    setIsSaving(true);
    // `null` explícito (nunca string vazia) pra limpar o e-mail — o backend só aceita "sem
    // e-mail" como null/undefined, uma string vazia ainda cai na validação de formato e
    // vazava um erro técnico cru pro usuário (achado durante a auditoria de segurança).
    const ok = await onUpdateClient(client.id, {
      name: editForm.name.trim(),
      category: editForm.category.trim(),
      contact: editForm.contact.trim(),
      email: editForm.email.trim() || null,
      customFields: editCustomFields,
    });
    setIsSaving(false);
    if (ok) setIsEditing(false);
  };

  const openAdd = (type: 'single' | 'recurring') => {
    setAddType(type);
    setNewRec({ description: '', amount: '', dueDate: '' });
    setNewSub({ description: '', amount: '', dueDay: '' });
    setIsAddOpen(true);
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isAdding) return;
    setIsAdding(true);
    const ok = addType === 'single'
      ? await onAddReceivable(client.id, { description: newRec.description.trim(), amount: parseFloat(newRec.amount), dueDate: newRec.dueDate })
      : await onAddSubscription(client.id, { description: newSub.description.trim(), amount: parseFloat(newSub.amount), dueDay: parseInt(newSub.dueDay, 10) });
    setIsAdding(false);
    if (ok) setIsAddOpen(false);
  };

  const runItem = async (id: string, action: () => Promise<boolean>) => {
    if (busyId) return;
    setBusyId(id);
    await action();
    setBusyId(null);
  };

  const handleConfirm = async () => {
    if (!pendingConfirm || busyId) return;
    const { kind, id } = pendingConfirm;
    setBusyId(id);
    if (kind === 'deleteReceivable') await onDeleteReceivable(client.id, id);
    else if (kind === 'unpay') await onUnmarkAsPaid(client.id, id);
    else await onDeleteSubscription(client.id, id);
    setBusyId(null);
    // Em erro a janela fecha também: o aviso da gaveta explica o que houve.
    setPendingConfirm(null);
  };

  const handleDeactivate = async (includeInRevenueReport: boolean) => {
    if (deactivating) return;
    setDeactivating(includeInRevenueReport ? 'keep' : 'trash');
    await onDeactivateClient(client.id, includeInRevenueReport);
    setDeactivating(null);
    setIsDeactivateOpen(false);
  };

  const handleRestore = async () => {
    if (isRestoring) return;
    setIsRestoring(true);
    await onRestoreClient(client.id);
    setIsRestoring(false);
  };

  const isInactive = client.status === 'inactive';
  const outstanding = totals.totalPending + totals.totalOverdue;

  const footer = isEditing ? (
    <>
      <Button variant="secondary" onClick={() => setIsEditing(false)} disabled={isSaving}>Cancelar</Button>
      <Button onClick={handleSaveEdit} loading={isSaving}>Salvar alterações</Button>
    </>
  ) : !canManageClient || isLoading ? undefined : isInactive ? (
    <Button icon={RotateCcw} onClick={handleRestore} loading={isRestoring}>Reativar cliente</Button>
  ) : (
    <>
      <Button variant="ghost" icon={Trash2} onClick={() => setIsDeactivateOpen(true)} className="mr-auto">Excluir cliente</Button>
      <Button icon={Pencil} onClick={handleEditClick}>Editar</Button>
    </>
  );

  const editBody = (
    <div className="space-y-4">
      <Field label="Nome" required error={editErrors.name} htmlFor="client-edit-name">
        <Input
          id="client-edit-name" value={editForm.name} maxLength={NAME_MAX_LENGTH} invalid={!!editErrors.name}
          onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} data-autofocus
        />
      </Field>
      <Field label="Categoria ou observação" htmlFor="client-edit-category">
        <Input id="client-edit-category" value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Telefone ou contato" required error={editErrors.contact} htmlFor="client-edit-contact">
          <Input
            id="client-edit-contact" value={editForm.contact} invalid={!!editErrors.contact}
            onChange={(e) => setEditForm({ ...editForm, contact: e.target.value })}
          />
        </Field>
        <Field label="E-mail" error={editErrors.email} htmlFor="client-edit-email">
          <Input
            id="client-edit-email" type="email" value={editForm.email} invalid={!!editErrors.email}
            onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
            onBlur={() => setEditErrors((prev) => ({ ...prev, email: editForm.email && !isValidEmail(editForm.email) ? 'E-mail inválido' : undefined }))}
          />
        </Field>
      </div>
      <CustomFieldsFormSection entity="client" values={editCustomFields} onChange={setEditCustomFields} />
    </div>
  );

  const loadingBody = (
    <div className="space-y-3" role="status" aria-label="Carregando lançamentos">
      {[0, 1, 2].map((i) => <span key={i} className="skeleton block h-14" />)}
    </div>
  );

  const viewBody = (
    <>
      {isInactive && (
        <Notice className="mb-5">Cliente inativo. Os valores dele continuam contando nos relatórios.</Notice>
      )}
      {/* Quem restaura da lixeira escolhe se o cliente volta aos relatórios; se escolheu "não" (ou foi
          restaurado antes dessa pergunta existir), a ficha precisa dizer que ele está fora. */}
      {!isInactive && !client.includeInRevenueReport && (
        <Notice tone="warning" className="mb-5">Este cliente não conta nos relatórios financeiros (foi restaurado da lixeira sem voltar a eles).</Notice>
      )}

      <dl className="mb-5 grid grid-cols-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-3 rounded-md border border-border px-4 py-3">
        <div className="min-w-0">
          <dt className="text-[12px] text-muted">Contato</dt>
          <dd className="mt-0.5 text-[14px] text-foreground break-words">{client.contact}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[12px] text-muted">E-mail</dt>
          <dd className="mt-0.5 text-[14px] text-foreground break-words">{client.email || <span className="text-muted">Não informado</span>}</dd>
        </div>
        {canViewFinance && (
          <>
            <div>
              <dt className="text-[12px] text-muted">Pago</dt>
              <dd className="mt-0.5 text-[14px] text-foreground tabular">{formatCurrency(totals.totalPaid)}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-muted">Em aberto</dt>
              <dd className="mt-0.5 text-[14px] text-foreground tabular">
                {formatCurrency(outstanding)}
                {totals.totalOverdue > 0 && <span className="block text-[12px] text-danger">{formatCurrency(totals.totalOverdue)} em atraso</span>}
              </dd>
            </div>
          </>
        )}
      </dl>

      {!canViewFinance ? (
        <EmptyState title="Lançamentos indisponíveis" description="Seu perfil não permite ver os lançamentos e assinaturas deste cliente." />
      ) : isLoading ? loadingBody : (
        <>
          <Section
            title="Assinaturas ativas"
            action={canManageFinance ? <Button variant="secondary" size="sm" icon={Plus} onClick={() => openAdd('recurring')}>Nova assinatura</Button> : undefined}
          >
            {activeSubscriptions.length === 0 ? (
              <p className="text-[14px] text-muted">Nenhuma assinatura ativa.</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {activeSubscriptions.map((sub) => {
                  const generated = hasChargeThisMonth(sub.id);
                  return (
                    <li key={sub.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-[14px] font-medium text-foreground flex items-center gap-1.5">
                          <Repeat size={14} strokeWidth={1.8} className="text-muted shrink-0" aria-hidden="true" />
                          <span className="truncate">{sub.description}</span>
                        </p>
                        <p className="text-[13px] text-muted"><span className="tabular text-foreground">{formatCurrency(sub.amount)}</span> · vence todo dia {sub.dueDay}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        {generated ? (
                          <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
                            <CheckCircle2 size={14} strokeWidth={1.8} className="text-success" aria-hidden="true" /> Fatura do mês gerada
                          </span>
                        ) : canManageFinance && (
                          <Button
                            variant="secondary" size="sm" icon={Zap}
                            loading={busyId === sub.id}
                            onClick={() => runItem(sub.id, () => onGenerateCharge(client.id, sub.id))}
                          >
                            Gerar fatura do mês
                          </Button>
                        )}
                        {canManageFinance && (
                          <Button
                            variant="ghost" size="sm" icon={Trash2}
                            onClick={() => setPendingConfirm({ kind: 'deleteSubscription', id: sub.id, label: sub.description })}
                            aria-label={`Cancelar assinatura ${sub.description}`}
                          />
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section
            title="Lançamentos"
            action={canManageFinance ? <Button variant="secondary" size="sm" icon={Plus} onClick={() => openAdd('single')}>Nova cobrança</Button> : undefined}
          >
            {receivables.length === 0 ? (
              <p className="text-[14px] text-muted">Nenhuma cobrança registrada para este cliente.</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {receivables.map((rec) => {
                  const status = RECEIVABLE_STATUS[rec.status];
                  return (
                    <li key={rec.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-[14px] font-medium text-foreground truncate">{rec.description}</p>
                          <p className="text-[13px] text-muted">
                            Vence {formatDateOnly(rec.dueDate)}{rec.subscriptionId ? ' · assinatura' : ''}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[14px] text-foreground tabular">{formatCurrency(rec.amount)}</p>
                          <div className="mt-1"><StatusBadge tone={status.tone}>{status.label}</StatusBadge></div>
                        </div>
                      </div>
                      {canManageFinance && (
                        <div className="mt-2 flex flex-wrap items-center justify-end gap-1">
                          <Button
                            variant="ghost" size="sm" icon={Trash2}
                            onClick={() => setPendingConfirm({ kind: 'deleteReceivable', id: rec.id, label: rec.description })}
                          >
                            Excluir
                          </Button>
                          {rec.status === 'paid' ? (
                            <Button
                              variant="ghost" size="sm" icon={Undo2}
                              onClick={() => setPendingConfirm({ kind: 'unpay', id: rec.id, label: rec.description })}
                            >
                              Desfazer pagamento
                            </Button>
                          ) : (
                            <Button
                              variant="secondary" size="sm" icon={CheckCircle2}
                              loading={busyId === rec.id}
                              onClick={() => runItem(rec.id, () => onMarkAsPaid(client.id, rec.id))}
                            >
                              Marcar como pago
                            </Button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </>
      )}
    </>
  );

  const confirmCopy = pendingConfirm && {
    deleteReceivable: {
      title: 'Excluir lançamento?',
      description: `“${pendingConfirm.label}” será apagado do histórico deste cliente.`,
      confirmLabel: 'Excluir lançamento',
      tone: 'danger' as const,
    },
    unpay: {
      title: 'Desfazer pagamento?',
      description: `“${pendingConfirm.label}” volta a ficar em aberto (ou atrasado, se já venceu).`,
      confirmLabel: 'Desfazer pagamento',
      tone: 'default' as const,
    },
    deleteSubscription: {
      title: 'Cancelar assinatura?',
      description: `“${pendingConfirm.label}” deixa de gerar cobranças. As faturas já geradas continuam no histórico.`,
      confirmLabel: 'Cancelar assinatura',
      tone: 'danger' as const,
    },
  }[pendingConfirm.kind];

  return (
    <>
      <Drawer
        open={!!clientProp}
        onClose={onClose}
        title={
          <span className="flex items-center gap-2 min-w-0">
            <span className="truncate">{isEditing ? 'Editar cliente' : client.name}</span>
            {!isEditing && isInactive && <StatusBadge tone="neutral">Inativo</StatusBadge>}
          </span>
        }
        description={isEditing ? client.name : client.category || 'Sem categoria'}
        size="lg"
        dismissable={!isSaving}
        footer={footer}
      >
        {actionError && <Notice tone="danger" className="mb-5" onDismiss={onDismissError}>{actionError}</Notice>}
        {isEditing ? editBody : viewBody}
      </Drawer>

      <Modal
        open={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        title="Novo lançamento"
        description={client.name}
        dismissable={!isAdding}
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsAddOpen(false)} disabled={isAdding}>Cancelar</Button>
            <Button type="submit" form="client-add-entry" loading={isAdding}>
              {addType === 'single' ? 'Lançar cobrança' : 'Criar assinatura'}
            </Button>
          </>
        }
      >
        <SegmentedControl<'single' | 'recurring'>
          label="Tipo de lançamento"
          value={addType}
          onChange={setAddType}
          options={[{ value: 'single', label: 'Cobrança única' }, { value: 'recurring', label: 'Assinatura mensal' }]}
          className="mb-5"
        />
        <form id="client-add-entry" onSubmit={handleAddSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {addType === 'single' ? (
            <>
              <Field label="Descrição" required htmlFor="rec-description" className="sm:col-span-2">
                <Input id="rec-description" required value={newRec.description} onChange={(e) => setNewRec({ ...newRec, description: e.target.value })} placeholder="Ex.: Material didático" data-autofocus />
              </Field>
              <Field label="Valor (R$)" required htmlFor="rec-amount">
                <Input id="rec-amount" required type="number" inputMode="decimal" step="0.01" min="0.01" value={newRec.amount} onChange={(e) => setNewRec({ ...newRec, amount: e.target.value })} placeholder="0,00" />
              </Field>
              <Field label="Vencimento" required htmlFor="rec-due">
                <Input id="rec-due" required type="date" value={newRec.dueDate} onChange={(e) => setNewRec({ ...newRec, dueDate: e.target.value })} />
              </Field>
            </>
          ) : (
            <>
              <Field label="Nome da assinatura ou plano" required htmlFor="sub-description" className="sm:col-span-2">
                <Input id="sub-description" required value={newSub.description} onChange={(e) => setNewSub({ ...newSub, description: e.target.value })} placeholder="Ex.: Mensalidade" data-autofocus />
              </Field>
              <Field label="Valor mensal (R$)" required htmlFor="sub-amount">
                <Input id="sub-amount" required type="number" inputMode="decimal" step="0.01" min="0.01" value={newSub.amount} onChange={(e) => setNewSub({ ...newSub, amount: e.target.value })} placeholder="0,00" />
              </Field>
              <Field label="Dia do vencimento" required hint="De 1 a 31. Em meses mais curtos, vence no último dia." htmlFor="sub-due-day">
                <Input id="sub-due-day" required type="number" inputMode="numeric" min="1" max="31" value={newSub.dueDay} onChange={(e) => setNewSub({ ...newSub, dueDay: e.target.value })} placeholder="Ex.: 5" />
              </Field>
            </>
          )}
        </form>
      </Modal>

      <ConfirmDialog
        open={!!pendingConfirm}
        onClose={() => !busyId && setPendingConfirm(null)}
        onConfirm={handleConfirm}
        title={confirmCopy?.title ?? ''}
        description={confirmCopy?.description}
        confirmLabel={confirmCopy?.confirmLabel ?? 'Confirmar'}
        cancelLabel="Voltar"
        tone={confirmCopy?.tone}
        busy={!!busyId}
      />

      <Modal
        open={isDeactivateOpen}
        onClose={() => setIsDeactivateOpen(false)}
        title="Excluir cliente"
        description={`${client.name} ficará inativo. Nada é apagado na hora.`}
        size="sm"
        dismissable={!deactivating}
        footer={<Button variant="secondary" onClick={() => setIsDeactivateOpen(false)} disabled={!!deactivating}>Cancelar</Button>}
      >
        <p className="text-[14px] text-foreground mb-4">Os valores deste cliente devem continuar nos relatórios?</p>
        <div className="space-y-3">
          <div>
            <Button className="w-full" onClick={() => handleDeactivate(true)} loading={deactivating === 'keep'} disabled={!!deactivating}>
              Manter nos relatórios
            </Button>
            <p className="mt-1.5 text-[13px] text-muted">O cliente continua na lista como inativo e pode ser reativado.</p>
          </div>
          <div>
            <Button variant="danger" className="w-full" onClick={() => handleDeactivate(false)} loading={deactivating === 'trash'} disabled={!!deactivating}>
              Remover e mandar para a lixeira
            </Button>
            <p className="mt-1.5 text-[13px] text-muted">Sai da lista e dos relatórios. Pode ser restaurado da lixeira por 30 dias; depois é apagado.</p>
          </div>
        </div>
      </Modal>
    </>
  );
};

export default ClientFinanceDrawer;
