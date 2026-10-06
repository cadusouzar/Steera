import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, ClipboardList, FileText, MapPin, Paperclip, Plus, Settings, Wrench, X } from 'lucide-react';
import {
  listManageableEmployees, listTimeInconsistencies, listPendingAdjustmentRequests, approveAdjustmentRequest,
  rejectAdjustmentRequest, listJustificationsForReview, reviewJustification, proactiveCorrection,
  listCompanyTimeEvents, listWorkSchedules, createWorkSchedule, listWorkLocations, createWorkLocation,
  updateWorkLocation, getTimeTrackingSettings, updateTimeTrackingSettings, fetchProtectedFileObjectUrl,
  hasDirectReports,
  type TimePunch, type AdjustmentRequestRecord, type JustificationRecord,
  type TimePunchType, type WorkScheduleRecord, type WorkLocationRecord, type TimeTrackingSettingsRecord,
} from '../../lib/api';
import { getCurrentUser } from '../../lib/auth';
import {
  Button, EmptyState, Field, Input, Modal, Notice, PageHeader, Panel, SegmentedControl, Select, StatusBadge,
  Switch, Table, Tabs, TBody, TD, TH, THead, TR, Textarea, toast, type StatusTone,
} from '../../components/ui';

// Administração de Ponto (redesenho no kit, etapa 4 do polimento — 01/10/2026). Mudanças aprovadas:
// rejeitar abre uma janela com motivo obrigatório (antes, uma linha improvisada no meio da tabela);
// filtro de situação em SegmentedControl; chaves de regras no Switch do kit e dias da semana em
// botões de alternância; e a correção do bug da janela de datas da Correção proativa (buscava o dia
// em UTC — batidas das 21h à meia-noite sumiam e as da madrugada seguinte apareciam no dia errado).

const PUNCH_TYPE_LABELS: Record<TimePunchType, string> = {
  clock_in: 'Entrada', break_start: 'Saída almoço', break_end: 'Volta almoço',
  clock_out: 'Saída', extra_in: 'Entrada extra', extra_out: 'Saída extra',
};
const ADJUSTMENT_TYPE_LABELS: Record<AdjustmentRequestRecord['type'], string> = {
  add_missing_punch: 'Adicionar marcação esquecida', correct_time: 'Corrigir horário', remove_punch: 'Remover marcação',
};
const JUSTIFICATION_TYPE_LABELS: Record<JustificationRecord['type'], string> = {
  absence: 'Ausência', incomplete_day: 'Dia incompleto', adjustment_support: 'Apoio a ajuste',
  medical_certificate: 'Atestado médico', other: 'Outro',
};
const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

type TabKey = 'inconsistencies' | 'adjustments' | 'justifications' | 'correction' | 'settings';
const TABS = [
  { id: 'inconsistencies' as const, label: 'Inconsistências', icon: AlertTriangle },
  { id: 'adjustments' as const, label: 'Ajustes', icon: ClipboardList },
  { id: 'justifications' as const, label: 'Justificativas', icon: FileText },
  { id: 'correction' as const, label: 'Correção proativa', icon: Wrench },
  { id: 'settings' as const, label: 'Configuração', icon: Settings },
];

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function formatDateOnly(dateStr: string) {
  return dateStr.slice(0, 10).split('-').reverse().join('/');
}
function formatTimeOnly(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Filtro de situação das abas Ajustes e Justificativas — antes eram fixas em "pendente", e um item
// analisado sumia da tela sem nenhum lugar pra consultar o motivo depois.
type ReviewStatusFilter = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'all';
const REVIEW_STATUS_LABELS: Record<ReviewStatusFilter, string> = {
  pending: 'Pendente', approved: 'Aprovada', rejected: 'Rejeitada', cancelled: 'Cancelada', all: 'Todas',
};
const REVIEW_TONE: Record<string, StatusTone> = { approved: 'success', rejected: 'danger', pending: 'warning', cancelled: 'neutral' };

const statusFilterOptions = (includeCancelled: boolean) =>
  (includeCancelled ? ['pending', 'approved', 'rejected', 'cancelled', 'all'] : ['pending', 'approved', 'rejected', 'all'])
    .map((v) => ({ value: v as ReviewStatusFilter, label: REVIEW_STATUS_LABELS[v as ReviewStatusFilter] }));

// `downloadUrl` nunca pode virar `<a href>` direto — a rota exige o JWT além do token de download, e
// um <a> não anexa Authorization. Abre uma aba em branco de forma SÍNCRONA (dentro do clique, pra não
// ser bloqueada como pop-up) e só depois a leva ao Object URL do fetch autenticado.
async function openAttachment(downloadUrl: string) {
  const win = window.open('', '_blank');
  try {
    const objectUrl = await fetchProtectedFileObjectUrl(downloadUrl);
    if (win) win.location.href = objectUrl;
    else window.open(objectUrl, '_blank');
  } catch {
    win?.close();
  }
}

const AttachmentButton = ({ url }: { url: string | null }) =>
  url ? (
    <Button variant="ghost" size="sm" icon={Paperclip} onClick={() => openAttachment(url)} className="-ml-3">Ver anexo</Button>
  ) : null;

const TimeTrackingAdmin = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('inconsistencies');

  // Mapa employeeId -> nome, reaproveitado por todas as seções (as listagens administrativas só
  // devolvem o id). Vem de GET /time-management/manageable-employees (exige só `ponto.administrar`),
  // não de GET /employees (`funcionarios.ver`): quem administra o Ponto sem ver o cadastro de
  // Funcionários continua vendo os nomes.
  const [employees, setEmployees] = useState<{ id: string; fullName: string }[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const employeeName = useCallback((id: string) => employees.find((e) => e.id === id)?.fullName ?? 'Funcionário', [employees]);

  useEffect(() => {
    listManageableEmployees().then(setEmployees).catch(() => {}).finally(() => setLoadingEmployees(false));
  }, []);

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <div className="max-w-6xl mx-auto">
        <PageHeader
          title="Administração de ponto"
          description="Analise inconsistências, aprove ou rejeite ajustes e justificativas, corrija marcações e configure as regras."
        />
        <Tabs<TabKey> label="Seções da administração de ponto" tabs={TABS} value={activeTab} onChange={setActiveTab} className="mb-6" />

        {loadingEmployees ? (
          <Panel><span className="skeleton block h-40" role="status" aria-label="Carregando" /></Panel>
        ) : (
          <>
            {activeTab === 'inconsistencies' && <InconsistenciesTab employeeName={employeeName} />}
            {activeTab === 'adjustments' && <AdjustmentsTab employeeName={employeeName} />}
            {activeTab === 'justifications' && <JustificationsTab employeeName={employeeName} />}
            {activeTab === 'correction' && <CorrectionTab employees={employees} />}
            {activeTab === 'settings' && <SettingsTab employees={employees} />}
          </>
        )}
      </div>
    </div>
  );
};

// ---------- peças compartilhadas da tela ----------

const SectionIntro = ({ title, description, action }: { title: string; description: string; action?: ReactNode }) => (
  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
    <div className="max-w-2xl">
      <h2 className="text-[16px] font-semibold text-foreground">{title}</h2>
      <p className="mt-1 text-[14px] text-muted">{description}</p>
    </div>
    {action}
  </div>
);

const ListState = ({ loading, error, empty, emptyTitle, emptyDescription, children }: {
  loading: boolean; error: string; empty: boolean; emptyTitle: string; emptyDescription?: string; children: ReactNode;
}) => (
  <Panel padded={false}>
    {error && <Notice tone="danger" className="m-4">{error}</Notice>}
    {loading ? (
      <div className="divide-y divide-border" role="status" aria-label="Carregando">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-6 px-5 h-14">
            <span className="skeleton h-4 w-36" /><span className="skeleton h-4 w-24" /><span className="skeleton h-4 w-20 ml-auto" />
          </div>
        ))}
      </div>
    ) : empty ? (
      <EmptyState title={emptyTitle} description={emptyDescription} />
    ) : (
      children
    )}
  </Panel>
);

interface ReviewTarget {
  typeLabel: string;
  employeeLabel: string;
  status: 'approved' | 'rejected';
  reviewNote: string | null;
  reviewedAt: string | null;
}

// Motivo da análise (até 2000 caracteres) — mesma janela usada do lado do funcionário.
const ReviewNoteModal = ({ target, onClose }: { target: ReviewTarget | null; onClose: () => void }) => (
  <Modal open={!!target} onClose={onClose} size="sm" title="Motivo da análise" description={target ? `${target.typeLabel} · ${target.employeeLabel}` : undefined}>
    {target && (
      <div className="space-y-3">
        <StatusBadge tone={target.status === 'approved' ? 'success' : 'danger'}>{target.status === 'approved' ? 'Aprovado' : 'Rejeitado'}</StatusBadge>
        <p className="text-[14px] text-foreground whitespace-pre-wrap break-words">{target.reviewNote}</p>
        {target.reviewedAt && <p className="text-[12px] text-muted">Analisado em {formatDateTime(target.reviewedAt)}</p>}
      </div>
    )}
  </Modal>
);

// Rejeição: motivo obrigatório, numa janela própria (antes era uma linha extra no meio da tabela).
const RejectModal = ({ open, title, description, busy, onClose, onConfirm }: {
  open: boolean; title: string; description?: string; busy: boolean; onClose: () => void; onConfirm: (reason: string) => void;
}) => {
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) setReason(''); }, [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      description={description}
      dismissable={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="danger" onClick={() => onConfirm(reason.trim())} loading={busy} disabled={!reason.trim()}>Rejeitar</Button>
        </>
      }
    >
      <Field label="Motivo da rejeição" htmlFor="reject-reason" required hint="O funcionário vê este motivo no espelho de ponto dele.">
        <Textarea id="reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus />
      </Field>
    </Modal>
  );
};

const ReviewCell = ({ status, reviewNote, reviewedAt, onViewNote, onApprove, onReject, busy }: {
  status: string; reviewNote: string | null; reviewedAt: string | null; onViewNote: () => void;
  onApprove: () => void; onReject: () => void; busy: boolean;
}) => {
  if (status === 'pending') {
    return (
      <div className="flex items-center justify-end gap-1.5">
        <Button variant="secondary" size="sm" icon={Check} onClick={onApprove} loading={busy}>Aprovar</Button>
        <Button variant="ghost" size="sm" icon={X} onClick={onReject} disabled={busy}>Rejeitar</Button>
      </div>
    );
  }
  if (status === 'approved' || status === 'rejected') {
    return (
      <div className="text-right text-[12px] text-muted">
        {reviewNote && (
          <button type="button" onClick={onViewNote} className="text-foreground underline underline-offset-2 hover:no-underline">
            Ver motivo
          </button>
        )}
        {reviewedAt && <p className="mt-0.5 tabular">{formatDateTime(reviewedAt)}</p>}
      </div>
    );
  }
  return <span className="text-muted">—</span>;
};

// ==== Inconsistências ====
function InconsistenciesTab({ employeeName }: { employeeName: (id: string) => string }) {
  const [items, setItems] = useState<TimePunch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    listTimeInconsistencies()
      .then(setItems)
      .catch((err) => setError(err instanceof Error ? err.message : 'Não foi possível carregar as inconsistências.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <SectionIntro
        title="Marcações com inconsistência"
        description="Fora da área configurada ou com localização exigida e indisponível. A marcação nunca é rejeitada: fica registrada para análise."
      />
      <ListState loading={loading} error={error} empty={items.length === 0} emptyTitle="Nenhuma inconsistência" emptyDescription="Todas as marcações estão dentro das regras configuradas.">
        <Table>
          <THead>
            <tr><TH>Funcionário</TH><TH>Marcação</TH><TH className="hidden sm:table-cell">Data e hora</TH><TH>Localização</TH></tr>
          </THead>
          <TBody>
            {items.map((p) => (
              <TR key={p.id}>
                <TD>{employeeName(p.employeeId)}<span className="block text-[12px] text-muted sm:hidden tabular">{formatDateTime(p.recordedAt)}</span></TD>
                <TD>{PUNCH_TYPE_LABELS[p.type]}</TD>
                <TD className="hidden sm:table-cell tabular">{formatDateTime(p.recordedAt)}</TD>
                <TD>
                  {p.locationStatus === 'out_of_range' ? <StatusBadge tone="danger">Fora da área</StatusBadge>
                    : p.locationStatus === 'unavailable' ? <StatusBadge tone="warning">Indisponível</StatusBadge>
                    : p.locationStatus === 'imprecise' ? <StatusBadge tone="warning">Imprecisa</StatusBadge>
                    : <StatusBadge tone="neutral">Em análise</StatusBadge>}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </ListState>
    </>
  );
}

// ==== Solicitações de ajuste ====
function AdjustmentsTab({ employeeName }: { employeeName: (id: string) => string }) {
  const [items, setItems] = useState<AdjustmentRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [actingId, setActingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ReviewStatusFilter>('pending');
  const [viewingNote, setViewingNote] = useState<AdjustmentRequestRecord | null>(null);
  const [rejecting, setRejecting] = useState<AdjustmentRequestRecord | null>(null);

  useEffect(() => {
    setLoading(true);
    setError('');
    listPendingAdjustmentRequests({ status: statusFilter === 'all' ? undefined : statusFilter, pageSize: 100 })
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof Error ? err.message : 'Não foi possível carregar as solicitações.'))
      .finally(() => setLoading(false));
  }, [statusFilter, refreshKey]);

  const handleApprove = async (id: string) => {
    setActingId(id);
    setError('');
    try {
      await approveAdjustmentRequest(id);
      const approved = items.find((i) => i.id === id);
      toast.success(approved ? `Ajuste aprovado: ${employeeName(approved.employeeId)}` : 'Ajuste aprovado');
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível aprovar a solicitação.');
    } finally {
      setActingId(null);
    }
  };

  const handleReject = async (reason: string) => {
    if (!rejecting || !reason) return;
    setActingId(rejecting.id);
    setError('');
    try {
      await rejectAdjustmentRequest(rejecting.id, reason);
      toast.success(`Ajuste rejeitado: ${employeeName(rejecting.employeeId)}`);
      setRejecting(null);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setRejecting(null);
      setError(err instanceof Error ? err.message : 'Não foi possível rejeitar a solicitação.');
    } finally {
      setActingId(null);
    }
  };

  return (
    <>
      <SectionIntro
        title="Solicitações de ajuste"
        description="Aprovar cria uma nova marcação com trilha de auditoria; a original nunca é alterada. Rejeitar exige um motivo, que o funcionário vê."
        action={<SegmentedControl<ReviewStatusFilter> label="Filtrar por situação" value={statusFilter} onChange={setStatusFilter} options={statusFilterOptions(true)} />}
      />
      <ListState loading={loading} error={error} empty={items.length === 0} emptyTitle="Nenhuma solicitação" emptyDescription="Nada encontrado nesta situação.">
        <Table>
          <THead>
            <tr><TH>Funcionário</TH><TH>Pedido</TH><TH className="hidden md:table-cell">Motivo do funcionário</TH><TH>Situação</TH><TH align="right"><span className="sr-only">Análise</span></TH></tr>
          </THead>
          <TBody>
            {items.map((r) => (
              <TR key={r.id} className="align-top">
                <TD>
                  {employeeName(r.employeeId)}
                  <span className="block text-[12px] text-muted tabular">{formatDateOnly(r.targetDate)}</span>
                </TD>
                <TD>
                  {ADJUSTMENT_TYPE_LABELS[r.type]}
                  {r.requestedTime && <span className="block text-[12px] text-muted">{r.requestedEventType ? `${PUNCH_TYPE_LABELS[r.requestedEventType]} às ` : ''}{formatTimeOnly(r.requestedTime)}</span>}
                </TD>
                <TD className="hidden md:table-cell max-w-xs">
                  <span className="line-clamp-3 text-[13px]">{r.reason}</span>
                  {r.downloadUrl && <span className="mt-1 block"><AttachmentButton url={r.downloadUrl} /></span>}
                </TD>
                <TD><StatusBadge tone={REVIEW_TONE[r.status] ?? 'neutral'}>{REVIEW_STATUS_LABELS[r.status]}</StatusBadge></TD>
                <TD align="right">
                  <ReviewCell
                    status={r.status} reviewNote={r.reviewNote} reviewedAt={r.reviewedAt} busy={actingId === r.id}
                    onViewNote={() => setViewingNote(r)} onApprove={() => handleApprove(r.id)} onReject={() => setRejecting(r)}
                  />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </ListState>
      <RejectModal
        open={!!rejecting}
        title="Rejeitar solicitação de ajuste"
        description={rejecting ? `${employeeName(rejecting.employeeId)} · ${formatDateOnly(rejecting.targetDate)} · ${ADJUSTMENT_TYPE_LABELS[rejecting.type]}` : undefined}
        busy={!!rejecting && actingId === rejecting.id}
        onClose={() => setRejecting(null)}
        onConfirm={handleReject}
      />
      <ReviewNoteModal
        target={viewingNote ? {
          typeLabel: ADJUSTMENT_TYPE_LABELS[viewingNote.type], employeeLabel: employeeName(viewingNote.employeeId),
          status: viewingNote.status as 'approved' | 'rejected', reviewNote: viewingNote.reviewNote, reviewedAt: viewingNote.reviewedAt,
        } : null}
        onClose={() => setViewingNote(null)}
      />
    </>
  );
}

// ==== Justificativas ====
function JustificationsTab({ employeeName }: { employeeName: (id: string) => string }) {
  const [items, setItems] = useState<JustificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [actingId, setActingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ReviewStatusFilter>('pending');
  const [viewingNote, setViewingNote] = useState<JustificationRecord | null>(null);
  const [rejecting, setRejecting] = useState<JustificationRecord | null>(null);

  useEffect(() => {
    setLoading(true);
    setError('');
    listJustificationsForReview({ status: statusFilter === 'all' ? undefined : (statusFilter as 'pending' | 'approved' | 'rejected'), pageSize: 100 })
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof Error ? err.message : 'Não foi possível carregar as justificativas.'))
      .finally(() => setLoading(false));
  }, [statusFilter, refreshKey]);

  const handleApprove = async (id: string) => {
    setActingId(id);
    setError('');
    try {
      await reviewJustification(id, 'approve');
      const approved = items.find((i) => i.id === id);
      toast.success(approved ? `Justificativa aprovada: ${employeeName(approved.employeeId)}` : 'Justificativa aprovada');
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível aprovar a justificativa.');
    } finally {
      setActingId(null);
    }
  };

  const handleReject = async (reason: string) => {
    if (!rejecting || !reason) return;
    setActingId(rejecting.id);
    setError('');
    try {
      await reviewJustification(rejecting.id, 'reject', reason);
      toast.success(`Justificativa rejeitada: ${employeeName(rejecting.employeeId)}`);
      setRejecting(null);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setRejecting(null);
      setError(err instanceof Error ? err.message : 'Não foi possível rejeitar a justificativa.');
    } finally {
      setActingId(null);
    }
  };

  const period = (j: JustificationRecord) =>
    j.relatedDate ? formatDateOnly(j.relatedDate)
      : j.periodStart && j.periodEnd ? `${formatDateOnly(j.periodStart)} a ${formatDateOnly(j.periodEnd)}`
      : '—';

  return (
    <>
      <SectionIntro
        title="Justificativas e atestados"
        description="Atestado é dado sensível de saúde: o anexo é a única evidência, nunca um diagnóstico digitado. Aprovar não altera marcações."
        action={<SegmentedControl<ReviewStatusFilter> label="Filtrar por situação" value={statusFilter} onChange={setStatusFilter} options={statusFilterOptions(false)} />}
      />
      <ListState loading={loading} error={error} empty={items.length === 0} emptyTitle="Nenhuma justificativa" emptyDescription="Nada encontrado nesta situação.">
        <Table>
          <THead>
            <tr><TH>Funcionário</TH><TH>Tipo</TH><TH className="hidden md:table-cell">Descrição</TH><TH>Situação</TH><TH align="right"><span className="sr-only">Análise</span></TH></tr>
          </THead>
          <TBody>
            {items.map((j) => (
              <TR key={j.id} className="align-top">
                <TD>
                  {employeeName(j.employeeId)}
                  <span className="block text-[12px] text-muted tabular">{period(j)}</span>
                </TD>
                <TD>{JUSTIFICATION_TYPE_LABELS[j.type]}</TD>
                <TD className="hidden md:table-cell max-w-xs">
                  <span className="line-clamp-3 text-[13px]">{j.description}</span>
                  {j.downloadUrl && <span className="mt-1 block"><AttachmentButton url={j.downloadUrl} /></span>}
                </TD>
                <TD><StatusBadge tone={REVIEW_TONE[j.status] ?? 'neutral'}>{REVIEW_STATUS_LABELS[j.status]}</StatusBadge></TD>
                <TD align="right">
                  <ReviewCell
                    status={j.status} reviewNote={j.reviewNote} reviewedAt={j.reviewedAt} busy={actingId === j.id}
                    onViewNote={() => setViewingNote(j)} onApprove={() => handleApprove(j.id)} onReject={() => setRejecting(j)}
                  />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </ListState>
      <RejectModal
        open={!!rejecting}
        title="Rejeitar justificativa"
        description={rejecting ? `${employeeName(rejecting.employeeId)} · ${JUSTIFICATION_TYPE_LABELS[rejecting.type]}` : undefined}
        busy={!!rejecting && actingId === rejecting.id}
        onClose={() => setRejecting(null)}
        onConfirm={handleReject}
      />
      <ReviewNoteModal
        target={viewingNote ? {
          typeLabel: JUSTIFICATION_TYPE_LABELS[viewingNote.type], employeeLabel: employeeName(viewingNote.employeeId),
          status: viewingNote.status as 'approved' | 'rejected', reviewNote: viewingNote.reviewNote, reviewedAt: viewingNote.reviewedAt,
        } : null}
        onClose={() => setViewingNote(null)}
      />
    </>
  );
}

// ==== Correção proativa ====
// Janela do dia LOCAL escolhido, em ISO (UTC). Antes usava `${data}T00:00:00.000Z`…`T23:59:59.999Z`
// — o dia em UTC: no Brasil, batidas das 21h à meia-noite ficavam de fora e as da madrugada seguinte
// (até 3h) apareciam como se fossem do dia (bug corrigido em 01/10/2026).
function localDayWindow(dateStr: string) {
  const start = new Date(`${dateStr}T00:00:00`);
  const end = new Date(`${dateStr}T23:59:59.999`);
  return { from: start.toISOString(), to: end.toISOString() };
}

function CorrectionTab({ employees }: { employees: { id: string; fullName: string }[] }) {
  // A lista já é escopada a "quem eu de fato consigo corrigir" (ADMIN com acesso total vê todos, um
  // superior só os subordinados diretos) — nunca a listagem completa da empresa.
  const [employeeId, setEmployeeId] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [type, setType] = useState<AdjustmentRequestRecord['type']>('correct_time');
  const [dayEvents, setDayEvents] = useState<TimePunch[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [relatedEventId, setRelatedEventId] = useState('');
  const [requestedEventType, setRequestedEventType] = useState<TimePunchType>('clock_in');
  const [requestedTime, setRequestedTime] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!employeeId || !targetDate) { setDayEvents([]); return; }
    let cancelled = false;
    setLoadingEvents(true);
    listCompanyTimeEvents(employeeId, { ...localDayWindow(targetDate), pageSize: 50 })
      .then((res) => { if (!cancelled) setDayEvents([...res.items].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))); })
      .catch(() => { if (!cancelled) setDayEvents([]); })
      .finally(() => { if (!cancelled) setLoadingEvents(false); });
    return () => { cancelled = true; };
  }, [employeeId, targetDate, refreshKey]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId || !targetDate || !reason.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const requestedTimeIso = requestedTime ? new Date(`${targetDate}T${requestedTime}:00`).toISOString() : undefined;
      await proactiveCorrection(employeeId, {
        targetDate,
        type,
        relatedEventId: type !== 'add_missing_punch' ? relatedEventId : undefined,
        requestedEventType: type !== 'remove_punch' ? requestedEventType : undefined,
        requestedTime: type !== 'remove_punch' ? requestedTimeIso : undefined,
        reason: reason.trim(),
      });
      toast.success(`Correção registrada: ${employees.find((emp) => emp.id === employeeId)?.fullName ?? 'funcionário'}`);
      setReason('');
      setRelatedEventId('');
      setRequestedTime('');
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível registrar a correção.');
    } finally {
      setSubmitting(false);
    }
  };

  const canPickEvent = type !== 'add_missing_punch';

  return (
    <>
      <SectionIntro
        title="Correção proativa"
        description="Corrige a marcação de um funcionário sem solicitação prévia. Gera a mesma trilha de auditoria de uma aprovação, nunca uma escrita silenciosa."
      />
      <div className="grid gap-4 lg:grid-cols-5">
        <Panel className="lg:col-span-3">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <Notice tone="danger">{error}</Notice>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Funcionário" htmlFor="c-emp" required>
                <Select id="c-emp" required value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); }}>
                  <option value="" disabled>Selecione</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}
                </Select>
              </Field>
              <Field label="Dia" htmlFor="c-date" required>
                <Input id="c-date" required type="date" value={targetDate} onChange={(e) => { setTargetDate(e.target.value); }} />
              </Field>
            </div>
            <Field label="Tipo de correção" htmlFor="c-type" required>
              <Select id="c-type" value={type} onChange={(e) => setType(e.target.value as AdjustmentRequestRecord['type'])}>
                {(Object.keys(ADJUSTMENT_TYPE_LABELS) as AdjustmentRequestRecord['type'][]).map((t) => <option key={t} value={t}>{ADJUSTMENT_TYPE_LABELS[t]}</option>)}
              </Select>
            </Field>
            {canPickEvent && employeeId && targetDate && (
              <Field label="Marcação afetada" htmlFor="c-event" required>
                {loadingEvents ? (
                  <span className="skeleton block h-10" role="status" aria-label="Carregando marcações" />
                ) : dayEvents.length === 0 ? (
                  <p className="text-[14px] text-muted">Nenhuma marcação deste funcionário neste dia.</p>
                ) : (
                  <Select id="c-event" required value={relatedEventId} onChange={(e) => setRelatedEventId(e.target.value)}>
                    <option value="" disabled>Selecione</option>
                    {dayEvents.map((ev) => <option key={ev.id} value={ev.id}>{PUNCH_TYPE_LABELS[ev.type]} às {formatTimeOnly(ev.recordedAt)}</option>)}
                  </Select>
                )}
              </Field>
            )}
            {type !== 'remove_punch' && (
              <div className="grid grid-cols-2 gap-4">
                <Field label="Tipo correto" htmlFor="c-kind" required>
                  <Select id="c-kind" value={requestedEventType} onChange={(e) => setRequestedEventType(e.target.value as TimePunchType)}>
                    {(Object.keys(PUNCH_TYPE_LABELS) as TimePunchType[]).map((t) => <option key={t} value={t}>{PUNCH_TYPE_LABELS[t]}</option>)}
                  </Select>
                </Field>
                <Field label="Horário correto" htmlFor="c-time" required>
                  <Input id="c-time" required type="time" value={requestedTime} onChange={(e) => setRequestedTime(e.target.value)} />
                </Field>
              </div>
            )}
            <Field label="Motivo" htmlFor="c-reason" required hint="Obrigatório: fica na trilha de auditoria.">
              <Textarea id="c-reason" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" loading={submitting} disabled={!employeeId || !targetDate || !reason.trim()}>Registrar correção</Button>
            </div>
          </form>
        </Panel>

        <Panel className="lg:col-span-2" title="Marcações do dia">
          {!employeeId || !targetDate ? (
            <p className="text-[14px] text-muted">Escolha o funcionário e o dia para ver as marcações.</p>
          ) : loadingEvents ? (
            <div className="space-y-2" role="status" aria-label="Carregando marcações"><span className="skeleton block h-9" /><span className="skeleton block h-9" /></div>
          ) : dayEvents.length === 0 ? (
            <p className="text-[14px] text-muted">Nenhuma marcação neste dia.</p>
          ) : (
            <ul className="divide-y divide-border">
              {dayEvents.map((ev) => (
                <li key={ev.id} className="flex items-center justify-between py-2.5 text-[14px]">
                  <span className="text-foreground">{PUNCH_TYPE_LABELS[ev.type]}</span>
                  <span className="flex items-center gap-2">
                    {ev.source === 'admin_manual' && <StatusBadge tone="neutral">Correção</StatusBadge>}
                    <span className="font-medium text-foreground tabular">{formatTimeOnly(ev.recordedAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

// ==== Configuração ====
function SettingsTab({ employees }: { employees: { id: string; fullName: string }[] }) {
  const myHasFullPontoAccess = getCurrentUser()?.hasFullPontoAccess ?? false;
  const [myOwnEmployeeId] = useState<string | null>(getCurrentUser()?.employeeId ?? null);
  const [ownTeam, setOwnTeam] = useState<boolean | null>(null);

  // GET /time-management/has-direct-reports, não employees.length: pra um ADMIN de acesso total a
  // listagem administrável é a empresa INTEIRA, então "Minha equipe" apareceria mesmo sem nenhum
  // subordinado direto (e a regra salva não valeria pra ninguém).
  useEffect(() => {
    hasDirectReports().then(setOwnTeam).catch(() => setOwnTeam(false));
  }, []);

  if (ownTeam === null) {
    return <Panel><span className="skeleton block h-40" role="status" aria-label="Carregando" /></Panel>;
  }

  // "Minha equipe" também exige o próprio login vinculado a uma ficha — sem isso não há managerId.
  const hasOwnTeam = ownTeam && !!myOwnEmployeeId;

  return (
    <div className="space-y-6">
      <SettingsPanel hasFullPontoAccess={myHasFullPontoAccess} hasOwnTeam={hasOwnTeam} myOwnEmployeeId={myOwnEmployeeId} />
      <WorkSchedulesPanel hasFullPontoAccess={myHasFullPontoAccess} hasOwnTeam={hasOwnTeam} myOwnEmployeeId={myOwnEmployeeId} employees={employees} />
      <WorkLocationsPanel canEdit={myHasFullPontoAccess} />
    </div>
  );
}

function SettingsPanel({ hasFullPontoAccess, hasOwnTeam, myOwnEmployeeId }: { hasFullPontoAccess: boolean; hasOwnTeam: boolean; myOwnEmployeeId: string | null }) {
  // 'company' só é opção pra quem tem hasFullPontoAccess; 'team' só pra quem tem hasOwnTeam. Quem
  // tem as duas alterna; quem só tem uma vê só aquela, sem seletor.
  const [scope, setScope] = useState<'company' | 'team'>(hasFullPontoAccess ? 'company' : 'team');
  const [settings, setSettings] = useState<TimeTrackingSettingsRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    const managerId = scope === 'team' ? (myOwnEmployeeId ?? undefined) : undefined;
    getTimeTrackingSettings(managerId)
      .then(setSettings)
      .catch((err) => setError(err instanceof Error ? err.message : 'Erro ao carregar as regras.'))
      .finally(() => setLoading(false));
  }, [scope, myOwnEmployeeId]);

  const set = (key: 'requirePhoto' | 'requireLocation' | 'allowLocationException' | 'allowExtraPeriods', value: boolean) => {
    if (!settings) return;
    setSettings({ ...settings, [key]: value });
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setError('');
    try {
      const managerId = scope === 'team' ? (myOwnEmployeeId ?? undefined) : undefined;
      setSettings(await updateTimeTrackingSettings({ ...settings, managerId }));
      toast.success('Regras do ponto salvas');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar as regras.');
    } finally {
      setSaving(false);
    }
  };

  if (!hasFullPontoAccess && !hasOwnTeam) {
    return (
      <Panel title="Regras para bater ponto">
        <p className="text-[14px] text-muted">Você ainda não gerencia nenhum funcionário, então não há regras para configurar aqui.</p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Regras para bater ponto"
      action={hasFullPontoAccess && hasOwnTeam ? (
        <SegmentedControl<'company' | 'team'>
          label="Escopo das regras"
          value={scope}
          onChange={setScope}
          options={[{ value: 'company', label: 'Empresa' }, { value: 'team', label: 'Minha equipe' }]}
        />
      ) : undefined}
    >
      <p className="mb-4 text-[14px] text-muted">
        {scope === 'company' ? 'Nenhuma regra vem pré-definida: ligue o que a empresa exige.' : 'Vale só para os seus subordinados diretos, por cima do padrão da empresa.'}
      </p>
      {/* Abrir esta aba nunca cria a regra de equipe: enquanto ela não existir, o que aparece é o padrão
          da empresa, e o primeiro "Salvar" cria a sobrescrita. */}
      {scope === 'team' && settings?.inherited && (
        <Notice tone="info" className="mb-4">Sua equipe ainda não tem regras próprias: os valores abaixo vêm do padrão da empresa. Ao salvar, passam a valer só para a sua equipe.</Notice>
      )}
      {error && <Notice tone="danger" className="mb-4">{error}</Notice>}
      {loading || !settings ? (
        <div className="space-y-3" role="status" aria-label="Carregando regras">{[0, 1, 2, 3].map((i) => <span key={i} className="skeleton block h-10" />)}</div>
      ) : (
        <>
          <div className="divide-y divide-border rounded-md border border-border">
            {[
              ['requirePhoto', 'Exigir foto', 'O funcionário tira uma selfie ao bater o ponto.'],
              ['requireLocation', 'Exigir localização', 'A marcação só é enviada com a localização do aparelho.'],
              ['allowLocationException', 'Aceitar sem localização, para análise', 'Em vez de bloquear, a marcação entra em Inconsistências.'],
              ['allowExtraPeriods', 'Permitir períodos extras', 'Libera Entrada extra e Saída extra depois da saída.'],
            ].map(([key, label, description]) => (
              <div key={key} className="px-4 py-3">
                <Switch
                  checked={settings[key as 'requirePhoto']}
                  onChange={(v) => set(key as 'requirePhoto', v)}
                  label={label}
                  description={description}
                />
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-end gap-3">
            <Button onClick={save} loading={saving}>Salvar regras</Button>
          </div>
        </>
      )}
    </Panel>
  );
}

function WorkSchedulesPanel({ hasFullPontoAccess, hasOwnTeam, myOwnEmployeeId, employees }: {
  hasFullPontoAccess: boolean; hasOwnTeam: boolean; myOwnEmployeeId: string | null; employees: { id: string; fullName: string }[];
}) {
  const [items, setItems] = useState<WorkScheduleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tier, setTier] = useState<'company' | 'team' | 'individual'>(hasFullPontoAccess ? 'company' : 'individual');
  const emptyForm = () => ({
    employeeId: '', name: '', weekDays: [1, 2, 3, 4, 5] as number[],
    expectedStartTime: '08:00', expectedEndTime: '17:00', breakMinutes: 60,
    dailyMinutes: 480, weeklyMinutes: 2400, validFrom: new Date().toISOString().slice(0, 10),
  });
  const [form, setForm] = useState(emptyForm);
  const [employeeError, setEmployeeError] = useState('');

  // GET /work-schedules sem filtro exige hasFullPontoAccess (404 pra quem não tem) — um superior
  // restrito lista só o próprio padrão de time e as jornadas individuais de quem ele administra (uma
  // chamada por employeeId; a API não aceita lista). Acesso total pede tudo de uma vez.
  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const fetchAll = hasFullPontoAccess
      ? listWorkSchedules()
      : Promise.all([
        hasOwnTeam && myOwnEmployeeId ? listWorkSchedules({ managerId: myOwnEmployeeId }) : Promise.resolve([]),
        ...employees.map((e) => listWorkSchedules({ employeeId: e.id })),
      ]).then((lists) => lists.flat());
    fetchAll.then(setItems).catch((err) => setError(err instanceof Error ? err.message : 'Erro ao carregar jornadas.')).finally(() => setLoading(false));
  }, [hasFullPontoAccess, hasOwnTeam, myOwnEmployeeId, employees]);
  useEffect(() => { load(); }, [load]);

  const toggleWeekDay = (d: number) => {
    setForm((f) => ({ ...f, weekDays: f.weekDays.includes(d) ? f.weekDays.filter((x) => x !== d) : [...f.weekDays, d].sort() }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || form.weekDays.length === 0) return;
    if (tier === 'individual' && !form.employeeId) { setEmployeeError('Escolha o funcionário.'); return; }
    setSaving(true);
    setError('');
    try {
      const createdSchedule = await createWorkSchedule({
        ...form,
        employeeId: tier === 'individual' ? form.employeeId : undefined,
        managerId: tier === 'team' ? (myOwnEmployeeId ?? undefined) : undefined,
      });
      toast.success(`Jornada criada: ${createdSchedule.name}`);
      setShowForm(false);
      setForm(emptyForm());
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar a jornada.');
    } finally {
      setSaving(false);
    }
  };

  const rowLabel = (s: WorkScheduleRecord) => {
    if (s.employeeId) return employees.find((e) => e.id === s.employeeId)?.fullName ?? 'Individual';
    if (s.managerId) return 'Padrão da equipe';
    return 'Padrão da empresa';
  };

  const tierOptions = [
    ...(hasFullPontoAccess ? [{ value: 'company' as const, label: 'Empresa' }] : []),
    ...(hasOwnTeam ? [{ value: 'team' as const, label: 'Minha equipe' }] : []),
    { value: 'individual' as const, label: 'Individual' },
  ];

  return (
    <Panel
      title="Jornadas de trabalho"
      action={!showForm ? <Button variant="secondary" size="sm" icon={Plus} onClick={() => setShowForm(true)}>Nova jornada</Button> : undefined}
    >
      <p className="mb-4 text-[14px] text-muted">Três níveis: padrão da empresa, padrão da equipe ou individual. O mais específico vale.</p>
      {error && <Notice tone="danger" className="mb-4">{error}</Notice>}

      {showForm && (
        <form onSubmit={submit} className="mb-5 space-y-4 rounded-md border border-border p-4">
          {tierOptions.length > 1 && (
            <SegmentedControl<'company' | 'team' | 'individual'> label="Nível da jornada" value={tier} onChange={(t) => { setTier(t); setEmployeeError(''); }} options={tierOptions} />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {tier === 'individual' && (
              <Field label="Funcionário" htmlFor="ws-emp" required error={employeeError || undefined}>
                <Select id="ws-emp" required invalid={!!employeeError} value={form.employeeId} onChange={(e) => { setForm({ ...form, employeeId: e.target.value }); setEmployeeError(''); }}>
                  <option value="" disabled>Selecione</option>
                  {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.fullName}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Nome" htmlFor="ws-name" required>
              <Input id="ws-name" required placeholder="Ex.: Loja 8h às 17h" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
          </div>
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium text-foreground">Dias de trabalho</legend>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_LABELS.map((label, i) => {
                const on = form.weekDays.includes(i);
                return (
                  <button
                    type="button" key={i} aria-pressed={on} onClick={() => toggleWeekDay(i)}
                    className={`h-9 w-11 rounded-md border text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-foreground ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted hover:text-foreground'}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Entrada" htmlFor="ws-start" required><Input id="ws-start" required type="time" value={form.expectedStartTime} onChange={(e) => setForm({ ...form, expectedStartTime: e.target.value })} /></Field>
            <Field label="Saída" htmlFor="ws-end" required><Input id="ws-end" required type="time" value={form.expectedEndTime} onChange={(e) => setForm({ ...form, expectedEndTime: e.target.value })} /></Field>
            <Field label="Vigente desde" htmlFor="ws-from" required className="col-span-2 sm:col-span-1"><Input id="ws-from" required type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} /></Field>
            <Field label="Intervalo (min)" htmlFor="ws-break"><Input id="ws-break" type="number" min={0} value={form.breakMinutes} onChange={(e) => setForm({ ...form, breakMinutes: Number(e.target.value) })} /></Field>
            <Field label="Carga diária (min)" htmlFor="ws-daily"><Input id="ws-daily" type="number" min={0} value={form.dailyMinutes} onChange={(e) => setForm({ ...form, dailyMinutes: Number(e.target.value) })} /></Field>
            <Field label="Carga semanal (min)" htmlFor="ws-weekly"><Input id="ws-weekly" type="number" min={0} value={form.weeklyMinutes} onChange={(e) => setForm({ ...form, weeklyMinutes: Number(e.target.value) })} /></Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setShowForm(false); setForm(emptyForm()); setEmployeeError(''); }}>Cancelar</Button>
            <Button type="submit" loading={saving} disabled={!form.name.trim() || form.weekDays.length === 0}>Criar jornada</Button>
          </div>
        </form>
      )}

      {loading ? (
        <span className="skeleton block h-24" role="status" aria-label="Carregando jornadas" />
      ) : items.length === 0 ? (
        <p className="text-[14px] text-muted">Nenhuma jornada configurada ainda. Sem jornada, o dia conta como folga no espelho.</p>
      ) : (
        <div className="-mx-5 -mb-5 border-t border-border">
          <Table>
            <THead><tr><TH>Nível</TH><TH>Nome</TH><TH>Dias</TH><TH>Horário</TH><TH align="right">Carga diária</TH></tr></THead>
            <TBody>
              {items.map((s) => (
                <TR key={s.id}>
                  <TD>{rowLabel(s)}</TD>
                  <TD>{s.name}</TD>
                  <TD className="text-muted">{s.weekDays.map((d) => WEEKDAY_LABELS[d]).join(', ')}</TD>
                  <TD className="tabular whitespace-nowrap">{s.expectedStartTime} às {s.expectedEndTime}</TD>
                  <TD align="right" className="tabular">{Math.floor(s.dailyMinutes / 60)}h{String(s.dailyMinutes % 60).padStart(2, '0')}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </Panel>
  );
}

function WorkLocationsPanel({ canEdit }: { canEdit: boolean }) {
  const [items, setItems] = useState<WorkLocationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', latitude: '', longitude: '', radiusMeters: 100 });

  const load = useCallback(() => {
    setLoading(true);
    listWorkLocations().then(setItems).catch((err) => setError(err instanceof Error ? err.message : 'Erro ao carregar locais.')).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.latitude || !form.longitude) return;
    setSaving(true);
    setError('');
    try {
      const createdLocation = await createWorkLocation({ name: form.name, latitude: Number(form.latitude), longitude: Number(form.longitude), radiusMeters: form.radiusMeters });
      toast.success(`Local cadastrado: ${createdLocation.name}`);
      setShowForm(false);
      setForm({ name: '', latitude: '', longitude: '', radiusMeters: 100 });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar o local.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (loc: WorkLocationRecord) => {
    setTogglingId(loc.id);
    try {
      await updateWorkLocation(loc.id, { active: !loc.active });
      toast.success(`Local atualizado: ${loc.name}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível atualizar o local.');
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <Panel
      title="Locais de trabalho"
      action={canEdit && !showForm ? <Button variant="secondary" size="sm" icon={Plus} onClick={() => setShowForm(true)}>Novo local</Button> : undefined}
    >
      <p className="mb-4 text-[14px] text-muted">Opcional. Sem nenhum local, a distância nunca é usada para validar uma marcação.</p>
      {error && <Notice tone="danger" className="mb-4">{error}</Notice>}

      {showForm && canEdit && (
        <form onSubmit={submit} className="mb-5 space-y-4 rounded-md border border-border p-4">
          <Field label="Nome" htmlFor="wl-name" required><Input id="wl-name" required placeholder="Ex.: Loja centro" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Latitude" htmlFor="wl-lat" required><Input id="wl-lat" required inputMode="decimal" placeholder="-23.5505" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} /></Field>
            <Field label="Longitude" htmlFor="wl-lng" required><Input id="wl-lng" required inputMode="decimal" placeholder="-46.6333" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} /></Field>
            <Field label="Raio (m)" htmlFor="wl-radius" className="col-span-2 sm:col-span-1"><Input id="wl-radius" type="number" min={10} value={form.radiusMeters} onChange={(e) => setForm({ ...form, radiusMeters: Number(e.target.value) })} /></Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button type="submit" loading={saving} disabled={!form.name.trim() || !form.latitude || !form.longitude}>Criar local</Button>
          </div>
        </form>
      )}

      {loading ? (
        <span className="skeleton block h-20" role="status" aria-label="Carregando locais" />
      ) : items.length === 0 ? (
        <p className="text-[14px] text-muted">Nenhum local configurado.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {items.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <MapPin size={16} strokeWidth={1.7} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-[14px] text-foreground">{l.name}</p>
                  <p className="text-[12px] text-muted tabular">{l.latitude.toFixed(5)}, {l.longitude.toFixed(5)} · raio {l.radiusMeters} m</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge tone={l.active ? 'success' : 'neutral'}>{l.active ? 'Ativo' : 'Inativo'}</StatusBadge>
                {canEdit && (
                  <Button variant="ghost" size="sm" loading={togglingId === l.id} onClick={() => toggleActive(l)}>{l.active ? 'Desativar' : 'Ativar'}</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export default TimeTrackingAdmin;
