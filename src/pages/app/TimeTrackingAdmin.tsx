import { Fragment, useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Users, ClipboardList, FileText, AlertTriangle, Settings, MapPin,
  Check, X, Loader2, Plus, Paperclip, Wrench,
} from 'lucide-react';
import {
  listEmployees, listManageableEmployees, listTimeInconsistencies, listPendingAdjustmentRequests, approveAdjustmentRequest,
  rejectAdjustmentRequest, listJustificationsForReview, reviewJustification, proactiveCorrection,
  listCompanyTimeEvents, listWorkSchedules, createWorkSchedule, listWorkLocations, createWorkLocation,
  updateWorkLocation, getTimeTrackingSettings, updateTimeTrackingSettings, fetchProtectedFileObjectUrl,
  hasDirectReports,
  type EmployeeListItem, type TimePunch, type AdjustmentRequestRecord, type JustificationRecord,
  type TimePunchType, type WorkScheduleRecord, type WorkLocationRecord, type TimeTrackingSettingsRecord,
} from '../../lib/api';
import { getCurrentUser } from '../../lib/auth';

const PUNCH_TYPE_LABELS: Record<TimePunchType, string> = {
  clock_in: 'Entrada', break_start: 'Saída Almoço', break_end: 'Volta Almoço',
  clock_out: 'Saída', extra_in: 'Entrada Extra', extra_out: 'Saída Extra',
};
const ADJUSTMENT_TYPE_LABELS: Record<AdjustmentRequestRecord['type'], string> = {
  add_missing_punch: 'Adicionar marcação faltante', correct_time: 'Corrigir horário', remove_punch: 'Remover marcação',
};
const JUSTIFICATION_TYPE_LABELS: Record<JustificationRecord['type'], string> = {
  absence: 'Ausência', incomplete_day: 'Dia incompleto', adjustment_support: 'Suporte a ajuste',
  medical_certificate: 'Atestado médico', other: 'Outro',
};
const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

type TabKey = 'inconsistencies' | 'adjustments' | 'justifications' | 'correction' | 'settings';
const TABS: { key: TabKey; label: string; icon: typeof Users }[] = [
  { key: 'inconsistencies', label: 'Inconsistências', icon: AlertTriangle },
  { key: 'adjustments', label: 'Solicitações de Ajuste', icon: ClipboardList },
  { key: 'justifications', label: 'Justificativas', icon: FileText },
  { key: 'correction', label: 'Correção Proativa', icon: Wrench },
  { key: 'settings', label: 'Configuração', icon: Settings },
];

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function formatDateOnly(dateStr: string) {
  return dateStr.split('-').reverse().join('/');
}

// `downloadUrl` nunca pode virar `<a href>` direto — a rota exige o JWT de acesso normal além do
// token de download (ver fetchProtectedFileObjectUrl em src/lib/api.ts), e um <a> disparado pelo
// browser nunca consegue anexar um cabeçalho Authorization. Abre uma aba em branco de forma
// SÍNCRONA (dentro do próprio clique, pra não ser bloqueada como pop-up) e só depois navega ela
// pro Object URL, uma vez que o fetch autenticado resolve.
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

const TimeTrackingAdmin = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('inconsistencies');

  // Mapa employeeId -> nome, reaproveitado por todas as seções (nenhuma das listagens
  // administrativas devolve o nome do funcionário junto, só o id).
  const [employees, setEmployees] = useState<EmployeeListItem[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const employeeName = useCallback(
    (id: string) => employees.find((e) => e.id === id)?.fullName ?? id,
    [employees],
  );

  useEffect(() => {
    listEmployees().then(setEmployees).catch(() => {}).finally(() => setLoadingEmployees(false));
  }, []);

  return (
    <div className="p-6 md:p-8 relative">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: 'easeOut' }} className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-heading font-bold text-foreground tracking-tight">Administração de Ponto</h1>
            <p className="text-muted mt-2 max-w-lg">
              Analise inconsistências, aprove ou rejeite solicitações de ajuste e justificativas, corrija
              marcações proativamente e configure jornadas, locais de trabalho e regras da empresa.
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="glass-panel p-1.5 rounded-2xl border border-border/60 mb-8 flex flex-wrap items-center gap-1 shadow-sm">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                activeTab === key ? 'bg-primary text-white shadow-sm' : 'text-muted hover:text-foreground hover:bg-secondary/50'
              }`}
            >
              <Icon size={16} /> {label}
            </button>
          ))}
        </div>

        {loadingEmployees ? (
          <div className="glass-panel rounded-3xl border border-border/60 py-24 flex items-center justify-center text-muted">
            <Loader2 className="animate-spin" size={28} />
          </div>
        ) : (
          <>
            {activeTab === 'inconsistencies' && <InconsistenciesTab employeeName={employeeName} />}
            {activeTab === 'adjustments' && <AdjustmentsTab employeeName={employeeName} />}
            {activeTab === 'justifications' && <JustificationsTab employeeName={employeeName} />}
            {activeTab === 'correction' && <CorrectionTab />}
            {activeTab === 'settings' && <SettingsTab />}
          </>
        )}
      </motion.div>
    </div>
  );
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
    <SectionPanel title="Marcações com inconsistência" subtitle="Fora da área configurada, localização exigida mas indisponível, entre outras — nunca uma marcação simplesmente rejeitada, sempre registrada para análise." error={error} loading={loading} empty={items.length === 0} emptyLabel="Nenhuma inconsistência pendente.">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b-2 border-border/60 bg-secondary/10">
            <Th>Funcionário</Th><Th>Tipo</Th><Th>Data/Hora</Th><Th>Status</Th><Th>Localização</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {items.map((p) => (
            <tr key={p.id} className="hover:bg-secondary/20 transition-colors">
              <Td>{employeeName(p.employeeId)}</Td>
              <Td>{PUNCH_TYPE_LABELS[p.type]}</Td>
              <Td>{formatDateTime(p.recordedAt)}</Td>
              <Td><Badge tone="yellow">{p.validationStatus === 'pending_review' ? 'Em análise' : p.validationStatus}</Badge></Td>
              <Td>{p.locationStatus === 'out_of_range' ? <Badge tone="red">Fora da área</Badge> : p.locationStatus === 'unavailable' ? <Badge tone="yellow">Indisponível</Badge> : '-'}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </SectionPanel>
  );
}

// ==== Solicitações de Ajuste ====
function AdjustmentsTab({ employeeName }: { employeeName: (id: string) => string }) {
  const [items, setItems] = useState<AdjustmentRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    listPendingAdjustmentRequests({ status: 'pending', pageSize: 100 })
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof Error ? err.message : 'Não foi possível carregar as solicitações.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const handleApprove = async (id: string) => {
    setActingId(id);
    setError('');
    try {
      await approveAdjustmentRequest(id);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível aprovar a solicitação.');
    } finally {
      setActingId(null);
    }
  };

  const handleReject = async (id: string) => {
    if (!rejectReason.trim()) return;
    setActingId(id);
    setError('');
    try {
      await rejectAdjustmentRequest(id, rejectReason.trim());
      setRejectingId(null);
      setRejectReason('');
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível rejeitar a solicitação.');
    } finally {
      setActingId(null);
    }
  };

  return (
    <SectionPanel title="Solicitações de ajuste pendentes" subtitle="Aprovar gera uma nova marcação e uma trilha de auditoria completa; o registro original nunca é alterado. Rejeitar exige um motivo." error={error} loading={loading} empty={items.length === 0} emptyLabel="Nenhuma solicitação pendente.">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b-2 border-border/60 bg-secondary/10">
            <Th>Funcionário</Th><Th>Data</Th><Th>Tipo</Th><Th>Motivo</Th><Th>Anexo</Th><Th className="text-right">Ações</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {items.map((r) => (
            <Fragment key={r.id}>
              <tr className="hover:bg-secondary/20 transition-colors align-top">
                <Td>{employeeName(r.employeeId)}</Td>
                <Td>{formatDateOnly(r.targetDate)}</Td>
                <Td>{ADJUSTMENT_TYPE_LABELS[r.type]}</Td>
                <Td className="max-w-xs"><span className="text-sm">{r.reason}</span></Td>
                <Td>{r.downloadUrl ? <button onClick={() => openAttachment(r.downloadUrl!)} className="text-primary hover:underline inline-flex items-center gap-1 text-sm"><Paperclip size={14} /> Ver</button> : '-'}</Td>
                <Td className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => handleApprove(r.id)} disabled={actingId === r.id} className="px-3 py-2 rounded-lg bg-green-500/10 text-green-600 hover:bg-green-500/20 text-xs font-bold flex items-center gap-1 disabled:opacity-50">
                      <Check size={14} /> Aprovar
                    </button>
                    <button onClick={() => { setRejectingId(rejectingId === r.id ? null : r.id); setRejectReason(''); }} className="px-3 py-2 rounded-lg bg-red-500/10 text-red-600 hover:bg-red-500/20 text-xs font-bold flex items-center gap-1">
                      <X size={14} /> Rejeitar
                    </button>
                  </div>
                </Td>
              </tr>
              {rejectingId === r.id && (
                <tr key={`${r.id}-reject`}>
                  <td colSpan={6} className="px-4 pb-4">
                    <div className="flex gap-2 bg-red-500/5 border border-red-500/20 rounded-xl p-3">
                      <input
                        autoFocus
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="Motivo da rejeição (obrigatório)"
                        className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary text-foreground"
                      />
                      <button onClick={() => handleReject(r.id)} disabled={!rejectReason.trim() || actingId === r.id} className="px-4 py-2 rounded-lg bg-red-500 text-white text-xs font-bold disabled:opacity-50">
                        Confirmar
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </SectionPanel>
  );
}

// ==== Justificativas ====
function JustificationsTab({ employeeName }: { employeeName: (id: string) => string }) {
  const [items, setItems] = useState<JustificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    listJustificationsForReview({ status: 'pending', pageSize: 100 })
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof Error ? err.message : 'Não foi possível carregar as justificativas.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const handleApprove = async (id: string) => {
    setActingId(id);
    setError('');
    try {
      await reviewJustification(id, 'approve');
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível aprovar a justificativa.');
    } finally {
      setActingId(null);
    }
  };

  const handleReject = async (id: string) => {
    if (!rejectReason.trim()) return;
    setActingId(id);
    setError('');
    try {
      await reviewJustification(id, 'reject', rejectReason.trim());
      setRejectingId(null);
      setRejectReason('');
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível rejeitar a justificativa.');
    } finally {
      setActingId(null);
    }
  };

  return (
    <SectionPanel title="Justificativas e atestados pendentes" subtitle="Atestados são tratados como dado sensível de saúde — o anexo é a única evidência aceita, nunca um diagnóstico digitado." error={error} loading={loading} empty={items.length === 0} emptyLabel="Nenhuma justificativa pendente.">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b-2 border-border/60 bg-secondary/10">
            <Th>Funcionário</Th><Th>Tipo</Th><Th>Descrição</Th><Th>Anexo</Th><Th className="text-right">Ações</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {items.map((j) => (
            <Fragment key={j.id}>
              <tr className="hover:bg-secondary/20 transition-colors align-top">
                <Td>{employeeName(j.employeeId)}</Td>
                <Td>{JUSTIFICATION_TYPE_LABELS[j.type]}</Td>
                <Td className="max-w-xs"><span className="text-sm">{j.description}</span></Td>
                <Td>{j.downloadUrl ? <button onClick={() => openAttachment(j.downloadUrl!)} className="text-primary hover:underline inline-flex items-center gap-1 text-sm"><Paperclip size={14} /> Ver</button> : '-'}</Td>
                <Td className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => handleApprove(j.id)} disabled={actingId === j.id} className="px-3 py-2 rounded-lg bg-green-500/10 text-green-600 hover:bg-green-500/20 text-xs font-bold flex items-center gap-1 disabled:opacity-50">
                      <Check size={14} /> Aprovar
                    </button>
                    <button onClick={() => { setRejectingId(rejectingId === j.id ? null : j.id); setRejectReason(''); }} className="px-3 py-2 rounded-lg bg-red-500/10 text-red-600 hover:bg-red-500/20 text-xs font-bold flex items-center gap-1">
                      <X size={14} /> Rejeitar
                    </button>
                  </div>
                </Td>
              </tr>
              {rejectingId === j.id && (
                <tr key={`${j.id}-reject`}>
                  <td colSpan={5} className="px-4 pb-4">
                    <div className="flex gap-2 bg-red-500/5 border border-red-500/20 rounded-xl p-3">
                      <input
                        autoFocus
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="Motivo da rejeição (obrigatório)"
                        className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary text-foreground"
                      />
                      <button onClick={() => handleReject(j.id)} disabled={!rejectReason.trim() || actingId === j.id} className="px-4 py-2 rounded-lg bg-red-500 text-white text-xs font-bold disabled:opacity-50">
                        Confirmar
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </SectionPanel>
  );
}

// ==== Correção Proativa ====
function CorrectionTab() {
  // Escopado a "quem eu de fato consigo corrigir" (ADMIN vê todos, superior vê só seus
  // subordinados diretos) — nunca a listagem completa da empresa (listEmployees/EmployeeListItem),
  // que mostrava mais opções do que as que um superior direto conseguia de fato usar (achado na
  // revisão final de 14/09/2026, ver DECISOES-TECNICAS.md).
  const [manageableEmployees, setManageableEmployees] = useState<{ id: string; fullName: string }[]>([]);
  useEffect(() => {
    listManageableEmployees().then(setManageableEmployees).catch(() => setManageableEmployees([]));
  }, []);

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
  const [success, setSuccess] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!employeeId || !targetDate) { setDayEvents([]); return; }
    setLoadingEvents(true);
    listCompanyTimeEvents(employeeId, { from: `${targetDate}T00:00:00.000Z`, to: `${targetDate}T23:59:59.999Z`, pageSize: 50 })
      .then((res) => setDayEvents(res.items))
      .catch(() => setDayEvents([]))
      .finally(() => setLoadingEvents(false));
  }, [employeeId, targetDate, refreshKey]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId || !targetDate || !reason.trim()) return;
    setSubmitting(true);
    setError('');
    setSuccess(false);
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
      setSuccess(true);
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

  return (
    <div className="glass-panel rounded-3xl border border-border/60 p-6 md:p-8 shadow-sm max-w-2xl">
      <h2 className="text-lg font-heading font-bold text-foreground mb-1">Correção proativa</h2>
      <p className="text-sm text-muted mb-6">
        Corrige a marcação de um funcionário sem precisar de uma solicitação prévia. Gera a mesma trilha
        de auditoria de uma aprovação normal — nunca uma escrita silenciosa.
      </p>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 mb-4 text-red-600 text-sm">{error}</div>}
      {success && <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-4 mb-4 text-green-600 text-sm flex items-center gap-2"><Check size={16} /> Correção registrada com sucesso.</div>}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-foreground/90 mb-2 uppercase tracking-wider">Funcionário *</label>
            <select required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="w-full bg-background border border-border rounded-xl px-3 py-3 text-sm focus:outline-none focus:border-primary text-foreground">
              <option value="">Selecione...</option>
              {manageableEmployees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-foreground/90 mb-2 uppercase tracking-wider">Data *</label>
            <input required type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="w-full bg-background border border-border rounded-xl px-3 py-3 text-sm focus:outline-none focus:border-primary text-foreground" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-foreground/90 mb-2 uppercase tracking-wider">Tipo de correção *</label>
          <select value={type} onChange={(e) => setType(e.target.value as AdjustmentRequestRecord['type'])} className="w-full bg-background border border-border rounded-xl px-3 py-3 text-sm focus:outline-none focus:border-primary text-foreground">
            {(Object.keys(ADJUSTMENT_TYPE_LABELS) as AdjustmentRequestRecord['type'][]).map((t) => <option key={t} value={t}>{ADJUSTMENT_TYPE_LABELS[t]}</option>)}
          </select>
        </div>

        {type !== 'add_missing_punch' && employeeId && targetDate && (
          <div>
            <label className="block text-xs font-semibold text-foreground/90 mb-2 uppercase tracking-wider">Marcação afetada *</label>
            {loadingEvents ? (
              <p className="text-xs text-muted flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Carregando marcações...</p>
            ) : dayEvents.length === 0 ? (
              <p className="text-xs text-muted italic">Nenhuma marcação encontrada para este funcionário nesta data.</p>
            ) : (
              <select required value={relatedEventId} onChange={(e) => setRelatedEventId(e.target.value)} className="w-full bg-background border border-border rounded-xl px-3 py-3 text-sm focus:outline-none focus:border-primary text-foreground">
                <option value="">Selecione...</option>
                {dayEvents.map((ev) => <option key={ev.id} value={ev.id}>{PUNCH_TYPE_LABELS[ev.type]} — {new Date(ev.recordedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</option>)}
              </select>
            )}
          </div>
        )}

        {type !== 'remove_punch' && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-foreground/90 mb-2 uppercase tracking-wider">Tipo correto *</label>
              <select value={requestedEventType} onChange={(e) => setRequestedEventType(e.target.value as TimePunchType)} className="w-full bg-background border border-border rounded-xl px-3 py-3 text-sm focus:outline-none focus:border-primary text-foreground">
                {(Object.keys(PUNCH_TYPE_LABELS) as TimePunchType[]).map((t) => <option key={t} value={t}>{PUNCH_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-foreground/90 mb-2 uppercase tracking-wider">Horário correto *</label>
              <input required type="time" value={requestedTime} onChange={(e) => setRequestedTime(e.target.value)} className="w-full bg-background border border-border rounded-xl px-3 py-3 text-sm focus:outline-none focus:border-primary text-foreground" />
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-foreground/90 mb-2 uppercase tracking-wider">Motivo *</label>
          <textarea required value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Justifique a correção — obrigatório, sem exceção." className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary text-foreground resize-none" />
        </div>

        <button type="submit" disabled={submitting || !employeeId || !targetDate || !reason.trim()} className="w-full py-3.5 bg-primary hover:bg-primary/90 disabled:bg-primary/50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-bold transition-colors shadow-lg shadow-primary/20 flex items-center justify-center gap-2">
          {submitting && <Loader2 size={16} className="animate-spin" />} Registrar Correção
        </button>
      </form>
    </div>
  );
}

// ==== Configuração ====
function SettingsTab() {
  const myHasFullPontoAccess = getCurrentUser()?.hasFullPontoAccess ?? false;
  const [myOwnEmployeeId] = useState<string | null>(getCurrentUser()?.employeeId ?? null);
  const [ownTeam, setOwnTeam] = useState<boolean | null>(null);

  // GET /time-management/has-direct-reports, não listManageableEmployees().length (corrigido na
  // revisão final de 15/09/2026): pra um ADMIN de acesso total a listagem devolve a empresa
  // INTEIRA (bypass 'ALL' de getManageableEmployeeIds), então qualquer admin com um Employee
  // vinculado via o botão "Minha equipe" mesmo sem nenhum subordinado direto — e a configuração de
  // time salva ali não valeria pra ninguém. Este endpoint responde exatamente "alguém ATIVO tem o
  // meu Employee como managerId?", independente de hasFullPontoAccess/role.
  useEffect(() => {
    hasDirectReports().then(setOwnTeam).catch(() => setOwnTeam(false));
  }, []);

  if (ownTeam === null) {
    return <div className="py-8 flex items-center justify-center text-muted"><Loader2 className="animate-spin" size={24} /></div>;
  }

  // "Minha equipe" também exige o próprio login estar vinculado a um Employee — sem isso não há
  // managerId nenhum pra escopar a configuração.
  const hasOwnTeam = ownTeam && !!myOwnEmployeeId;

  return (
    <div className="space-y-8">
      <SettingsPanel hasFullPontoAccess={myHasFullPontoAccess} hasOwnTeam={hasOwnTeam} myOwnEmployeeId={myOwnEmployeeId} />
      <WorkSchedulesPanel hasFullPontoAccess={myHasFullPontoAccess} hasOwnTeam={hasOwnTeam} myOwnEmployeeId={myOwnEmployeeId} />
      <WorkLocationsPanel canEdit={myHasFullPontoAccess} />
    </div>
  );
}

function SettingsPanel({ hasFullPontoAccess, hasOwnTeam, myOwnEmployeeId }: { hasFullPontoAccess: boolean; hasOwnTeam: boolean; myOwnEmployeeId: string | null }) {
  // 'company' só é uma opção pra quem tem hasFullPontoAccess; 'team' só é uma opção pra quem tem
  // hasOwnTeam. Quem tem as duas alterna; quem só tem uma vê só aquela, sem seletor.
  const [scope, setScope] = useState<'company' | 'team'>(hasFullPontoAccess ? 'company' : 'team');
  const [settings, setSettings] = useState<TimeTrackingSettingsRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const managerId = scope === 'team' ? (myOwnEmployeeId ?? undefined) : undefined;
    getTimeTrackingSettings(managerId).then(setSettings).catch((err) => setError(err instanceof Error ? err.message : 'Erro ao carregar configurações.')).finally(() => setLoading(false));
  }, [scope, myOwnEmployeeId]);
  useEffect(() => { load(); }, [load]);

  const toggle = (key: keyof TimeTrackingSettingsRecord) => {
    if (!settings) return;
    setSettings({ ...settings, [key]: !settings[key] });
    setSaved(false);
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setError('');
    try {
      const managerId = scope === 'team' ? (myOwnEmployeeId ?? undefined) : undefined;
      const updated = await updateTimeTrackingSettings({ ...settings, managerId });
      setSettings(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar as configurações.');
    } finally {
      setSaving(false);
    }
  };

  if (!hasFullPontoAccess && !hasOwnTeam) {
    return (
      <div className="glass-panel rounded-3xl border border-border/60 p-6 md:p-8 shadow-sm">
        <h2 className="text-lg font-heading font-bold text-foreground mb-1">Regras da empresa</h2>
        <p className="text-sm text-muted">Você ainda não gerencia nenhum funcionário — nada para configurar aqui.</p>
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-3xl border border-border/60 p-6 md:p-8 shadow-sm">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h2 className="text-lg font-heading font-bold text-foreground">Regras da empresa</h2>
        {hasFullPontoAccess && hasOwnTeam && (
          <div className="flex gap-1 bg-secondary/30 rounded-lg p-1">
            <button onClick={() => setScope('company')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${scope === 'company' ? 'bg-primary text-white' : 'text-muted'}`}>Padrão da empresa</button>
            <button onClick={() => setScope('team')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${scope === 'team' ? 'bg-primary text-white' : 'text-muted'}`}>Minha equipe</button>
          </div>
        )}
      </div>
      <p className="text-sm text-muted mb-6">
        {scope === 'company' ? 'Nenhuma regra vem pré-definida — configure o que sua empresa exige para bater ponto.' : 'Vale só para os seus subordinados diretos, sobrescrevendo o padrão da empresa.'}
      </p>
      {/* Abrir esta aba NUNCA cria a configuração de time (a leitura é somente leitura desde a
          revisão de 15/09/2026) — enquanto a equipe não tiver regras próprias, o que aparece aqui
          é o padrão da empresa, e é o primeiro "Salvar" que cria a sobrescrita. */}
      {scope === 'team' && settings?.inherited && (
        <div className="rounded-xl border border-border/60 bg-secondary/20 p-4 mb-4 text-sm text-muted">
          Sua equipe ainda não tem regras próprias — os valores abaixo estão <strong className="text-foreground/80">herdados do padrão da empresa</strong>. Ao salvar, eles passam a valer só para os seus subordinados diretos.
        </div>
      )}
      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 mb-4 text-red-600 text-sm">{error}</div>}
      {loading || !settings ? (
        <div className="py-8 flex items-center justify-center text-muted"><Loader2 className="animate-spin" size={24} /></div>
      ) : (
        <div className="space-y-3">
          <ToggleRow label="Exigir foto na marcação" checked={settings.requirePhoto} onChange={() => toggle('requirePhoto')} />
          <ToggleRow label="Exigir localização na marcação" checked={settings.requireLocation} onChange={() => toggle('requireLocation')} />
          <ToggleRow label="Permitir exceção de localização (fica em análise em vez de bloquear)" checked={settings.allowLocationException} onChange={() => toggle('allowLocationException')} />
          <ToggleRow label="Permitir períodos extras (Entrada/Saída Extra)" checked={settings.allowExtraPeriods} onChange={() => toggle('allowExtraPeriods')} />
          <button onClick={save} disabled={saving} className="mt-4 px-5 py-3 bg-primary hover:bg-primary/90 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition-colors flex items-center gap-2">
            {saving && <Loader2 size={16} className="animate-spin" />} Salvar {saved && <Check size={16} />}
          </button>
        </div>
      )}
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex items-center justify-between gap-4 p-3 rounded-xl hover:bg-secondary/20 cursor-pointer transition-colors">
      <span className="text-sm text-foreground/90">{label}</span>
      <button type="button" onClick={onChange} className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${checked ? 'bg-primary' : 'bg-secondary'}`}>
        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </label>
  );
}

function WorkSchedulesPanel({ hasFullPontoAccess, hasOwnTeam, myOwnEmployeeId }: { hasFullPontoAccess: boolean; hasOwnTeam: boolean; myOwnEmployeeId: string | null }) {
  // Escopado a "quem eu de fato consigo administrar" (mesmo raciocínio já usado em CorrectionTab),
  // nunca a listagem completa da empresa — usado só como fonte do seletor "Individual".
  const [manageableEmployees, setManageableEmployees] = useState<{ id: string; fullName: string }[]>([]);
  useEffect(() => { listManageableEmployees().then(setManageableEmployees).catch(() => setManageableEmployees([])); }, []);

  const [items, setItems] = useState<WorkScheduleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tier, setTier] = useState<'company' | 'team' | 'individual'>(hasFullPontoAccess ? 'company' : 'individual');
  const [form, setForm] = useState({
    employeeId: '', name: '', weekDays: [1, 2, 3, 4, 5] as number[],
    expectedStartTime: '08:00', expectedEndTime: '17:00', breakMinutes: 60,
    dailyMinutes: 480, weeklyMinutes: 2400, validFrom: new Date().toISOString().slice(0, 10),
  });

  // GET /work-schedules sem NENHUM filtro exige hasFullPontoAccess (404 pra quem não tem — ver
  // WorkSchedulesController.findAll) — um superior restrito nunca pode listar "tudo", só o próprio
  // padrão de time (managerId=myOwnEmployeeId) e as jornadas individuais de quem ele administra
  // (uma chamada por employeeId, já que a API não aceita uma lista de ids). Full access continua
  // pedindo tudo de uma vez (inclui todos os níveis da empresa inteira).
  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const fetchAll = hasFullPontoAccess
      ? listWorkSchedules()
      : Promise.all([
          hasOwnTeam && myOwnEmployeeId ? listWorkSchedules({ managerId: myOwnEmployeeId }) : Promise.resolve([]),
          ...manageableEmployees.map((e) => listWorkSchedules({ employeeId: e.id })),
        ]).then((lists) => lists.flat());
    fetchAll.then(setItems).catch((err) => setError(err instanceof Error ? err.message : 'Erro ao carregar jornadas.')).finally(() => setLoading(false));
  }, [hasFullPontoAccess, hasOwnTeam, myOwnEmployeeId, manageableEmployees]);
  useEffect(() => { load(); }, [load]);

  const toggleWeekDay = (d: number) => {
    setForm((f) => ({ ...f, weekDays: f.weekDays.includes(d) ? f.weekDays.filter((x) => x !== d) : [...f.weekDays, d].sort() }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || form.weekDays.length === 0) return;
    if (tier === 'individual' && !form.employeeId) return;
    setSaving(true);
    setError('');
    try {
      await createWorkSchedule({
        ...form,
        employeeId: tier === 'individual' ? form.employeeId : undefined,
        managerId: tier === 'team' ? (myOwnEmployeeId ?? undefined) : undefined,
      });
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar a jornada.');
    } finally {
      setSaving(false);
    }
  };

  const rowLabel = (s: WorkScheduleRecord) => {
    if (s.employeeId) return manageableEmployees.find((e) => e.id === s.employeeId)?.fullName ?? s.employeeId;
    if (s.managerId) return 'Padrão do time';
    return 'Padrão da empresa';
  };

  return (
    <div className="glass-panel rounded-3xl border border-border/60 p-6 md:p-8 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-heading font-bold text-foreground">Jornadas de trabalho</h2>
        <button onClick={() => setShowForm((s) => !s)} className="text-sm font-medium text-primary hover:text-primary/80 flex items-center gap-1">
          <Plus size={16} /> Nova Jornada
        </button>
      </div>
      <p className="text-sm text-muted mb-6">Três níveis — padrão da empresa, padrão do time, ou individual — o mais específico sempre vence.</p>
      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 mb-4 text-red-600 text-sm">{error}</div>}

      {showForm && (
        <form onSubmit={submit} className="mb-6 p-5 bg-secondary/10 border border-border/50 rounded-2xl space-y-4">
          <div className="flex gap-1 bg-secondary/30 rounded-lg p-1 w-fit">
            {hasFullPontoAccess && <button type="button" onClick={() => setTier('company')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tier === 'company' ? 'bg-primary text-white' : 'text-muted'}`}>Empresa</button>}
            {hasOwnTeam && <button type="button" onClick={() => setTier('team')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tier === 'team' ? 'bg-primary text-white' : 'text-muted'}`}>Meu time</button>}
            <button type="button" onClick={() => setTier('individual')} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tier === 'individual' ? 'bg-primary text-white' : 'text-muted'}`}>Individual</button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {tier === 'individual' && (
              <select required value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground">
                <option value="">Funcionário...</option>
                {manageableEmployees.map((emp) => <option key={emp.id} value={emp.id}>{emp.fullName}</option>)}
              </select>
            )}
            <input required placeholder="Nome (ex: Comercial 8h-17h)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground" />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {WEEKDAY_LABELS.map((label, i) => (
              <button type="button" key={i} onClick={() => toggleWeekDay(i)} className={`w-10 h-10 rounded-lg text-xs font-bold transition-colors ${form.weekDays.includes(i) ? 'bg-primary text-white' : 'bg-secondary text-muted'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input required type="time" value={form.expectedStartTime} onChange={(e) => setForm({ ...form, expectedStartTime: e.target.value })} className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground" />
            <input required type="time" value={form.expectedEndTime} onChange={(e) => setForm({ ...form, expectedEndTime: e.target.value })} className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <NumberField label="Intervalo (min)" value={form.breakMinutes} onChange={(v) => setForm({ ...form, breakMinutes: v })} />
            <NumberField label="Carga diária (min)" value={form.dailyMinutes} onChange={(v) => setForm({ ...form, dailyMinutes: v })} />
            <NumberField label="Carga semanal (min)" value={form.weeklyMinutes} onChange={(v) => setForm({ ...form, weeklyMinutes: v })} />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Vigente a partir de</label>
            <input required type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground" />
          </div>
          <button type="submit" disabled={saving} className="px-5 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition-colors flex items-center gap-2">
            {saving && <Loader2 size={16} className="animate-spin" />} Criar Jornada
          </button>
        </form>
      )}

      {loading ? (
        <div className="py-8 flex items-center justify-center text-muted"><Loader2 className="animate-spin" size={24} /></div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted italic py-4">Nenhuma jornada configurada ainda.</p>
      ) : (
        <table className="w-full text-left border-collapse">
          <thead><tr className="border-b border-border/40"><Th>Nível</Th><Th>Nome</Th><Th>Dias</Th><Th>Horário</Th><Th>Carga diária</Th></tr></thead>
          <tbody className="divide-y divide-border/40">
            {items.map((s) => (
              <tr key={s.id}>
                <Td>{rowLabel(s)}</Td>
                <Td>{s.name}</Td>
                <Td>{s.weekDays.map((d) => WEEKDAY_LABELS[d]).join(', ')}</Td>
                <Td>{s.expectedStartTime} - {s.expectedEndTime}</Td>
                <Td>{Math.floor(s.dailyMinutes / 60)}h{(s.dailyMinutes % 60).toString().padStart(2, '0')}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function WorkLocationsPanel({ canEdit }: { canEdit: boolean }) {
  const [items, setItems] = useState<WorkLocationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
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
      await createWorkLocation({ name: form.name, latitude: Number(form.latitude), longitude: Number(form.longitude), radiusMeters: form.radiusMeters });
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
    try {
      await updateWorkLocation(loc.id, { active: !loc.active });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível atualizar o local.');
    }
  };

  return (
    <div className="glass-panel rounded-3xl border border-border/60 p-6 md:p-8 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-heading font-bold text-foreground">Locais de trabalho</h2>
        {canEdit && (
          <button onClick={() => setShowForm((s) => !s)} className="text-sm font-medium text-primary hover:text-primary/80 flex items-center gap-1">
            <Plus size={16} /> Novo Local
          </button>
        )}
      </div>
      <p className="text-sm text-muted mb-6">Opcional — sem nenhum local configurado, a distância nunca é usada para validar uma marcação.</p>
      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 mb-4 text-red-600 text-sm">{error}</div>}

      {showForm && canEdit && (
        <form onSubmit={submit} className="mb-6 p-5 bg-secondary/10 border border-border/50 rounded-2xl space-y-3">
          <input required placeholder="Nome (ex: Sede)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground" />
          <div className="grid grid-cols-3 gap-3">
            <input required placeholder="Latitude" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground" />
            <input required placeholder="Longitude" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground" />
            <NumberField label="Raio (m)" value={form.radiusMeters} onChange={(v) => setForm({ ...form, radiusMeters: v })} />
          </div>
          <button type="submit" disabled={saving} className="px-5 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition-colors flex items-center gap-2">
            {saving && <Loader2 size={16} className="animate-spin" />} Criar Local
          </button>
        </form>
      )}

      {loading ? (
        <div className="py-8 flex items-center justify-center text-muted"><Loader2 className="animate-spin" size={24} /></div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted italic py-4">Nenhum local configurado ainda.</p>
      ) : (
        <table className="w-full text-left border-collapse">
          <thead><tr className="border-b border-border/40"><Th>Nome</Th><Th>Coordenadas</Th><Th>Raio</Th><Th>Status</Th><Th className="text-right">Ação</Th></tr></thead>
          <tbody className="divide-y divide-border/40">
            {items.map((l) => (
              <tr key={l.id}>
                <Td className="flex items-center gap-2"><MapPin size={14} className="text-muted" /> {l.name}</Td>
                <Td><span className="font-mono text-xs">{l.latitude.toFixed(5)}, {l.longitude.toFixed(5)}</span></Td>
                <Td>{l.radiusMeters}m</Td>
                <Td>{l.active ? <Badge tone="green">Ativo</Badge> : <Badge tone="gray">Inativo</Badge>}</Td>
                <Td className="text-right">
                  {canEdit && (
                    <button onClick={() => toggleActive(l)} className="text-xs font-medium text-primary hover:text-primary/80">
                      {l.active ? 'Desativar' : 'Ativar'}
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ==== Componentes utilitários compartilhados ====
function SectionPanel({ title, subtitle, error, loading, empty, emptyLabel, children }: {
  title: string; subtitle: string; error: string; loading: boolean; empty: boolean; emptyLabel: string; children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="text-lg font-heading font-bold text-foreground mb-1">{title}</h2>
      <p className="text-sm text-muted mb-6">{subtitle}</p>
      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 mb-4 text-red-600 text-sm">{error}</div>}
      <div className="glass-panel rounded-3xl border border-border/60 overflow-hidden shadow-sm">
        {loading ? (
          <div className="py-24 flex items-center justify-center text-muted"><Loader2 className="animate-spin" size={28} /></div>
        ) : empty ? (
          <div className="py-16 text-center text-muted text-sm">{emptyLabel}</div>
        ) : (
          <div className="overflow-x-auto p-2">{children}</div>
        )}
      </div>
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider ${className}`}>{children}</th>;
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 text-sm text-foreground/90 ${className}`}>{children}</td>;
}
function Badge({ tone, children }: { tone: 'green' | 'yellow' | 'red' | 'gray'; children: React.ReactNode }) {
  const toneClass = {
    green: 'bg-green-500/10 text-green-600 border-green-500/20',
    yellow: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
    red: 'bg-red-500/10 text-red-600 border-red-500/20',
    gray: 'bg-secondary text-foreground/60 border-border',
  }[tone];
  return <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium border ${toneClass}`}>{children}</span>;
}
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="block text-xs text-muted mb-1">{label}</label>
      <input type="number" min={0} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground" />
    </div>
  );
}

export default TimeTrackingAdmin;
