import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ChevronLeft, ChevronRight, Image as ImageIcon, MapPin, Monitor, Paperclip, RotateCcw, Smartphone, Undo2, Wrench } from 'lucide-react';
import { getCurrentUser, refreshCurrentUser } from '../../lib/auth';
import {
  getTimeClockStatus, createTimePunch, getOwnTimeSummary, createAdjustmentRequest,
  listOwnAdjustmentRequests, cancelAdjustmentRequest, linkMyEmployee, listEmployees, fetchProtectedFileObjectUrl,
  type TimeClockStatus, type TimePunch, type MonthlySummary, type DailySummary,
  type AdjustmentRequestRecord, type TimePunchType, type EmployeeListItem,
} from '../../lib/api';
import RollingText from '../../components/motion/RollingText';
import { reloadAfterSave } from '../../lib/reloadAfterSave';
import { notifyPontoChanged } from '../../hooks/usePontoPendingCount';
import {
  Button, ButtonLink, ConfirmDialog, Drawer, Field, Input, Modal, Notice, PageHeader, Panel, Select,
  StatusBadge, Table, TBody, TD, TH, THead, TR, Textarea, toast, type StatusTone,
} from '../../components/ui';

// Controle de Ponto do funcionário (redesenho no kit, etapa 3 do polimento — 01/10/2026). Mudanças
// aprovadas: navegação de mês por setas (no lugar de dois selects), "Cancelar ajuste" pede
// confirmação e "hoje" passa a ser o dia LOCAL (antes era o dia UTC: entre 21h e meia-noite no
// horário de Brasília a tela já achava que era amanhã e "Marcações de hoje" aparecia vazia).

const PUNCH_TYPE_LABELS: Record<TimePunchType, string> = {
  clock_in: 'Entrada',
  break_start: 'Saída almoço',
  break_end: 'Volta almoço',
  clock_out: 'Saída',
  extra_in: 'Entrada extra',
  extra_out: 'Saída extra',
};

const ADJUSTMENT_TYPE_LABELS: Record<AdjustmentRequestRecord['type'], string> = {
  add_missing_punch: 'Adicionar marcação esquecida',
  correct_time: 'Corrigir o horário de uma marcação',
  remove_punch: 'Remover uma marcação errada',
};

const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function formatTimeOnly(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function formatDateLabel(dateStr: string) {
  const d = new Date(`${dateStr}T12:00:00`); // meio-dia local pra nunca cair no dia anterior por causa de fuso
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}
function formatMinutes(mins: number) {
  const abs = Math.abs(mins);
  return `${mins < 0 ? '-' : ''}${Math.floor(abs / 60)}h${String(abs % 60).padStart(2, '0')}`;
}
// Data local (não UTC) no formato YYYY-MM-DD.
function localDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// "Status do dia" é uma conveniência de exibição do frontend — o backend devolve os dados crus
// (isHoliday/isOnVacationOrLeave/hasOpenJourney/workedMinutes/expectedMinutes/events).
type DisplayStatus = 'Completo' | 'Incompleto' | 'Falta' | 'Folga' | 'Feriado';
function deriveDisplayStatus(day: DailySummary, todayStr: string): DisplayStatus {
  if (day.isHoliday) return 'Feriado';
  if (day.isOnVacationOrLeave) return 'Folga';
  if (day.expectedMinutes === 0) return 'Folga'; // fim de semana ou sem jornada configurada pra este dia
  if (day.events.length === 0) return day.date === todayStr ? 'Incompleto' : 'Falta';
  if (day.hasOpenJourney) return 'Incompleto';
  return day.workedMinutes >= day.expectedMinutes ? 'Completo' : 'Incompleto';
}
const STATUS_TONE: Record<DisplayStatus, StatusTone> = {
  Completo: 'success', Incompleto: 'warning', Falta: 'danger', Folga: 'neutral', Feriado: 'neutral',
};

const isMobileDevice = () => /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

const TimeTracking = () => {
  const currentUser = getCurrentUser();
  const [linkedEmployeeId, setLinkedEmployeeId] = useState<string | null>(currentUser?.employeeId ?? null);

  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // ---- Estado vazio: login sem employeeId vinculado ----
  const [linkableEmployees, setLinkableEmployees] = useState<EmployeeListItem[]>([]);
  const [loadingLinkable, setLoadingLinkable] = useState(false);
  const [selectedLinkId, setSelectedLinkId] = useState('');
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState('');
  // Login com alcance restrito não escolhe a própria ficha (o vínculo definiria o próprio alcance):
  // só quem tem acesso a todos os funcionários da empresa vincula, em Usuários.
  const canSelfLink = currentUser?.canSelfLinkEmployee !== false;

  useEffect(() => {
    if (linkedEmployeeId || !canSelfLink) return;
    let cancelled = false;
    setLoadingLinkable(true);
    listEmployees()
      // Só fichas ativas: o backend recusa vincular a uma ficha inativa.
      .then((items) => { if (!cancelled) setLinkableEmployees(items.filter((e) => e.status === 'active')); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingLinkable(false); });
    return () => { cancelled = true; };
  }, [linkedEmployeeId, canSelfLink]);

  const handleLinkEmployee = async () => {
    if (!selectedLinkId) return;
    setLinking(true);
    setLinkError('');
    try {
      await linkMyEmployee(selectedLinkId);
      const linkedName = linkableEmployees.find((emp) => emp.id === selectedLinkId)?.fullName;
      toast.success(linkedName ? `Ficha vinculada: ${linkedName}` : 'Ficha vinculada');
      await reloadAfterSave(
        async () => setLinkedEmployeeId((await refreshCurrentUser()).employeeId),
        () => setLinkError('Ficha vinculada, mas não foi possível atualizar a tela. Recarregue a página.'),
      );
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Não foi possível vincular seu login a este funcionário.');
    } finally {
      setLinking(false);
    }
  };

  // ---- Dados reais (só carregados quando há employeeId vinculado) ----
  const now = new Date();
  const realYear = now.getFullYear();
  const realMonth = now.getMonth(); // 0-indexado
  const todayStr = localDateStr(now);

  const [viewYear, setViewYear] = useState(realYear);
  const [viewMonth, setViewMonth] = useState(realMonth);
  const isCurrentMonth = viewYear === realYear && viewMonth === realMonth;
  const goMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    if (d.getFullYear() > realYear || (d.getFullYear() === realYear && d.getMonth() > realMonth)) return;
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);

  const [status, setStatus] = useState<TimeClockStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState('');

  const [todaySummary, setTodaySummary] = useState<DailySummary | null>(null);
  const [todayLoading, setTodayLoading] = useState(true);

  const [monthSummary, setMonthSummary] = useState<MonthlySummary | null>(null);
  const [monthLoading, setMonthLoading] = useState(true);
  const [monthError, setMonthError] = useState('');

  const [ownRequests, setOwnRequests] = useState<AdjustmentRequestRecord[]>([]);

  useEffect(() => {
    if (!linkedEmployeeId) return;
    let cancelled = false;
    setStatusLoading(true);
    setStatusError('');
    getTimeClockStatus()
      .then((s) => { if (!cancelled) setStatus(s); })
      .catch((err) => { if (!cancelled) setStatusError(err instanceof Error ? err.message : 'Não foi possível carregar o status do ponto.'); })
      .finally(() => { if (!cancelled) setStatusLoading(false); });
    return () => { cancelled = true; };
  }, [linkedEmployeeId, refreshKey]);

  useEffect(() => {
    if (!linkedEmployeeId) return;
    let cancelled = false;
    setTodayLoading(true);
    // Busca sempre o próprio mês/ano REAIS (não reaproveita monthSummary mesmo quando o espelho está
    // no mês atual) — garante dado fresco logo depois de bater um ponto.
    getOwnTimeSummary(realYear, realMonth + 1)
      .then((m) => { if (!cancelled) setTodaySummary(m.days.find((d) => d.date === todayStr) ?? null); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setTodayLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedEmployeeId, refreshKey]);

  useEffect(() => {
    if (!linkedEmployeeId) return;
    let cancelled = false;
    setMonthLoading(true);
    setMonthError('');
    getOwnTimeSummary(viewYear, viewMonth + 1)
      .then((m) => { if (!cancelled) setMonthSummary(m); })
      .catch((err) => { if (!cancelled) setMonthError(err instanceof Error ? err.message : 'Não foi possível carregar o espelho de ponto.'); })
      .finally(() => { if (!cancelled) setMonthLoading(false); });
    return () => { cancelled = true; };
  }, [linkedEmployeeId, viewYear, viewMonth, refreshKey]);

  useEffect(() => {
    if (!linkedEmployeeId) return;
    let cancelled = false;
    listOwnAdjustmentRequests()
      .then((items) => { if (!cancelled) setOwnRequests(items); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [linkedEmployeeId, refreshKey]);

  const pendingRequestForDate = (date: string) => ownRequests.find((r) => r.targetDate === date && r.status === 'pending');
  // Mais recente solicitação já resolvida pra esta data — mostra o resultado (e o motivo) em vez de
  // a solicitação simplesmente sumir depois de analisada.
  const lastResolvedRequestForDate = (date: string) =>
    ownRequests
      .filter((r) => r.targetDate === date && (r.status === 'approved' || r.status === 'rejected'))
      .sort((a, b) => (b.reviewedAt ?? b.createdAt).localeCompare(a.reviewedAt ?? a.createdAt))[0];

  // ---- Bater ponto: câmera, GPS, preview da foto, confirmação ----
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState('');
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locationError, setLocationError] = useState('');
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [capturedPhotoPreview, setCapturedPhotoPreview] = useState<string | null>(null);
  const [capturedPhotoBlob, setCapturedPhotoBlob] = useState<Blob | null>(null);
  const [submittingPunch, setSubmittingPunch] = useState(false);
  const [submitPunchError, setSubmitPunchError] = useState('');
  const [selectedPunchDetail, setSelectedPunchDetail] = useState<TimePunch | null>(null);
  const [viewingResolvedRequest, setViewingResolvedRequest] = useState<AdjustmentRequestRecord | null>(null);
  const [punchPhotoObjectUrl, setPunchPhotoObjectUrl] = useState<string | null>(null);
  const [punchPhotoLoading, setPunchPhotoLoading] = useState(false);

  // `photoDownloadUrl` nunca pode virar `<img src>` direto — a rota exige o JWT de acesso além do
  // token de download (ver fetchProtectedFileObjectUrl), então busca via fetch autenticado e usa um
  // Object URL local, revogado ao trocar de marcação/fechar.
  useEffect(() => {
    if (!selectedPunchDetail?.photoDownloadUrl) {
      setPunchPhotoObjectUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setPunchPhotoLoading(true);
    fetchProtectedFileObjectUrl(selectedPunchDetail.photoDownloadUrl)
      .then((url) => {
        if (cancelled) { URL.revokeObjectURL(url); return; }
        objectUrl = url;
        setPunchPhotoObjectUrl(url);
      })
      .catch(() => { if (!cancelled) setPunchPhotoObjectUrl(null); })
      .finally(() => { if (!cancelled) setPunchPhotoLoading(false); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selectedPunchDetail]);

  // Desliga a câmera se a pessoa sair da página com a confirmação aberta.
  const mediaStreamRef = useRef<MediaStream | null>(null);
  useEffect(() => { mediaStreamRef.current = mediaStream; }, [mediaStream]);
  useEffect(() => () => { mediaStreamRef.current?.getTracks().forEach((track) => track.stop()); }, []);
  // O <video> fica dentro do Modal (portal) e é remontado ao "tirar outra" — religa o stream nele.
  useEffect(() => {
    if (videoRef.current && mediaStream) videoRef.current.srcObject = mediaStream;
  }, [mediaStream, capturedPhotoPreview, isConfirmModalOpen]);

  // Reflete se a confirmação está aberta NO MOMENTO em que getUserMedia resolve (o closure veria o
  // valor antigo) — abrir e fechar rápido não deixa a câmera acesa.
  const punchModalOpenRef = useRef(false);

  const startCamera = () => {
    setCameraError('');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      .then((stream) => {
        if (!punchModalOpenRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        setMediaStream(stream);
      })
      .catch(() => setCameraError('Não foi possível acessar a câmera.'));
  };

  const stopCamera = () => {
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      setMediaStream(null);
    }
  };

  const openPunchModal = () => {
    if (!status?.nextAllowedType) return;
    punchModalOpenRef.current = true;
    setSubmitPunchError('');
    setCapturedPhotoPreview(null);
    setCapturedPhotoBlob(null);
    setIsConfirmModalOpen(true);

    if (status.requirePhoto) startCamera();

    setGpsCoords(null);
    setLocationError('');
    setIsGettingLocation(true);
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => { setGpsCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setIsGettingLocation(false); },
        () => { setLocationError('Não foi possível obter a localização.'); setIsGettingLocation(false); },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      );
    } else {
      setLocationError('Geolocalização não é suportada neste navegador.');
      setIsGettingLocation(false);
    }
  };

  const closeConfirmModal = () => {
    punchModalOpenRef.current = false;
    stopCamera();
    setIsConfirmModalOpen(false);
    setCapturedPhotoPreview(null);
    setCapturedPhotoBlob(null);
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setCapturedPhotoPreview(canvas.toDataURL('image/jpeg', 0.85));
    canvas.toBlob((blob) => setCapturedPhotoBlob(blob), 'image/jpeg', 0.85);
    stopCamera(); // não precisa mais do feed ao vivo depois de capturar a foto
  };

  const retakePhoto = () => {
    setCapturedPhotoPreview(null);
    setCapturedPhotoBlob(null);
    startCamera();
  };

  // A localização é buscada sempre (o backend usa lat/lng pra geofencing mesmo sem exigir), mas só
  // bloqueia o envio quando `requireLocation` for true.
  const canSubmitPunch =
    !submittingPunch &&
    (!status?.requirePhoto || !!capturedPhotoBlob) &&
    (!status?.requireLocation || (!isGettingLocation && !!gpsCoords));

  const submitPunch = async () => {
    if (!status?.nextAllowedType || !canSubmitPunch) return;
    setSubmittingPunch(true);
    setSubmitPunchError('');
    try {
      const punched = await createTimePunch({
        type: status.nextAllowedType,
        latitude: gpsCoords?.lat,
        longitude: gpsCoords?.lng,
        deviceReportedAt: new Date().toISOString(),
        isMobile: isMobileDevice(),
        photo: capturedPhotoBlob ? new File([capturedPhotoBlob], 'ponto.jpg', { type: 'image/jpeg' }) : undefined,
      });
      toast.success(`${PUNCH_TYPE_LABELS[punched.event.type]} registrada às ${formatTimeOnly(punched.event.recordedAt)}`);
      closeConfirmModal();
      bump();
    } catch (err) {
      // erro visível no próprio modal, que continua aberto pra tentar de novo
      setSubmitPunchError(err instanceof Error ? err.message : 'Não foi possível registrar a marcação.');
    } finally {
      setSubmittingPunch(false);
    }
  };

  // ---- Solicitação de ajuste ----
  const [maintenanceModalOpen, setMaintenanceModalOpen] = useState(false);
  const [adjustmentDay, setAdjustmentDay] = useState<DailySummary | null>(null);
  const [adjustmentType, setAdjustmentType] = useState<AdjustmentRequestRecord['type']>('correct_time');
  const [adjustmentRelatedEventId, setAdjustmentRelatedEventId] = useState('');
  const [adjustmentRequestedEventType, setAdjustmentRequestedEventType] = useState<TimePunchType>('clock_in');
  const [adjustmentRequestedTime, setAdjustmentRequestedTime] = useState('');
  const [maintenanceReason, setMaintenanceReason] = useState('');
  const [maintenanceAttachment, setMaintenanceAttachment] = useState<File | null>(null);
  const [submittingAdjustment, setSubmittingAdjustment] = useState(false);
  const [adjustmentError, setAdjustmentError] = useState('');
  const [cancellingRequestId, setCancellingRequestId] = useState<string | null>(null);
  const [confirmCancelRequest, setConfirmCancelRequest] = useState<AdjustmentRequestRecord | null>(null);

  const openMaintenance = (day: DailySummary) => {
    setAdjustmentDay(day);
    setAdjustmentType(day.events.length > 0 ? 'correct_time' : 'add_missing_punch');
    setAdjustmentRelatedEventId(day.events[0]?.id ?? '');
    setAdjustmentRequestedEventType(day.events[0]?.type ?? 'clock_in');
    setAdjustmentRequestedTime('');
    setMaintenanceReason('');
    setMaintenanceAttachment(null);
    setAdjustmentError('');
    setMaintenanceModalOpen(true);
  };

  const submitMaintenance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustmentDay || !maintenanceReason.trim()) return;
    setSubmittingAdjustment(true);
    setAdjustmentError('');
    try {
      const requestedTimeIso = adjustmentRequestedTime
        ? new Date(`${adjustmentDay.date}T${adjustmentRequestedTime}:00`).toISOString()
        : undefined;
      await createAdjustmentRequest({
        targetDate: adjustmentDay.date,
        type: adjustmentType,
        relatedEventId: adjustmentType !== 'add_missing_punch' ? adjustmentRelatedEventId : undefined,
        requestedEventType: adjustmentType !== 'remove_punch' ? adjustmentRequestedEventType : undefined,
        requestedTime: adjustmentType !== 'remove_punch' ? requestedTimeIso : undefined,
        reason: maintenanceReason,
        attachment: maintenanceAttachment ?? undefined,
      });
      toast.success('Solicitação de ajuste enviada');
      notifyPontoChanged();
      setMaintenanceModalOpen(false);
      bump();
    } catch (err) {
      setAdjustmentError(err instanceof Error ? err.message : 'Não foi possível enviar a solicitação.');
    } finally {
      setSubmittingAdjustment(false);
    }
  };

  const handleCancelRequest = async (id: string) => {
    setCancellingRequestId(id);
    try {
      await cancelAdjustmentRequest(id);
      toast.success('Solicitação de ajuste cancelada');
      notifyPontoChanged();
      setConfirmCancelRequest(null);
      bump();
    } catch (err) {
      setConfirmCancelRequest(null);
      setMonthError(err instanceof Error ? err.message : 'Não foi possível cancelar a solicitação.');
    } finally {
      setCancellingRequestId(null);
    }
  };

  // ---- Resumo do mês — direto dos totals já calculados pelo backend ----
  const totals = monthSummary?.totals ?? { workedMinutes: 0, expectedMinutes: 0, extraMinutes: 0, balanceMinutes: 0 };
  const missingMinutes = totals.balanceMinutes < 0 ? Math.abs(totals.balanceMinutes) : 0;
  const extraFromBalance = totals.balanceMinutes > 0 ? totals.balanceMinutes : totals.extraMinutes;

  const days = useMemo(() => [...(monthSummary?.days ?? [])].reverse(), [monthSummary]);

  // ==== Estado vazio: login sem ficha vinculada ====
  if (!linkedEmployeeId) {
    return (
      <div className="px-4 py-6 md:px-8 md:py-8">
        <div className="max-w-lg mx-auto">
          <Panel>
            <div className="py-4">
              <h1 className="text-[20px] font-semibold text-foreground">Vincule seu login a uma ficha</h1>
              {!canSelfLink ? (
                <p className="mt-2 text-[14px] text-muted">
                  Seu login ainda não tem uma ficha de funcionário, e isso é necessário para bater ponto. Peça a alguém com acesso a todos os funcionários da empresa para vincular seu login a uma ficha.
                </p>
              ) : (
                <>
                  <p className="mt-2 text-[14px] text-muted">
                    Para bater ponto, seu login precisa estar ligado a uma ficha de funcionário. Se a sua ficha ainda não existe, crie em Funcionários e volte aqui.
                  </p>
                  <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
                    <Field label="Minha ficha" htmlFor="link-employee" className="flex-1">
                      {loadingLinkable ? (
                        <span className="skeleton block h-10" role="status" aria-label="Carregando fichas" />
                      ) : linkableEmployees.length === 0 ? (
                        <p className="text-[14px] text-muted">Nenhum funcionário ativo cadastrado ainda.</p>
                      ) : (
                        <Select id="link-employee" value={selectedLinkId} onChange={(e) => setSelectedLinkId(e.target.value)}>
                          <option value="" disabled>Selecione</option>
                          {linkableEmployees.map((emp) => <option key={emp.id} value={emp.id}>{emp.fullName}</option>)}
                        </Select>
                      )}
                    </Field>
                    <Button onClick={handleLinkEmployee} loading={linking} disabled={!selectedLinkId}>Vincular</Button>
                  </div>
                  {linkError && <Notice tone="danger" className="mt-3">{linkError}</Notice>}
                  <ButtonLink to="/app/funcionarios" variant="ghost" size="sm" className="mt-4 -ml-3">Ir para Funcionários</ButtonLink>
                </>
              )}
            </div>
          </Panel>
        </div>
      </div>
    );
  }

  const timeText = currentTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const todayEvents = [...(todaySummary?.events ?? [])].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <div className="max-w-6xl mx-auto">
        <PageHeader title="Controle de ponto" description="Registre sua jornada e acompanhe o espelho do mês." />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* ---- Bater ponto ---- */}
          <Panel className="lg:col-span-1">
            <div className="text-center">
              <RollingText text={timeText} label={`Agora são ${timeText}`} className="text-[44px] leading-none font-semibold tracking-tight text-foreground" />
              <p className="mt-2 text-[14px] text-muted first-letter:uppercase">
                {currentTime.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
              </p>
            </div>

            <div className="mt-6">
              {statusLoading ? (
                <span className="skeleton block h-12" role="status" aria-label="Carregando status" />
              ) : statusError ? (
                <Notice tone="danger">{statusError}</Notice>
              ) : status?.nextAllowedType ? (
                <>
                  <Button onClick={openPunchModal} className="w-full h-12 text-[15px]">
                    Registrar {PUNCH_TYPE_LABELS[status.nextAllowedType].toLowerCase()}
                  </Button>
                  <p className="mt-2 text-center text-[12px] text-muted">
                    {status.requirePhoto && status.requireLocation ? 'Pede foto e localização'
                      : status.requirePhoto ? 'Pede foto'
                      : status.requireLocation ? 'Pede localização'
                      : 'Registra o horário na hora do clique'}
                  </p>
                </>
              ) : null}
            </div>

            <div className="mt-6 border-t border-border pt-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[14px] font-semibold text-foreground">Marcações de hoje</h2>
                <span className="text-[12px] text-muted tabular">{todayEvents.length}</span>
              </div>
              {todayLoading ? (
                <div className="space-y-2" role="status" aria-label="Carregando marcações">
                  <span className="skeleton block h-9" />
                  <span className="skeleton block h-9" />
                </div>
              ) : todayEvents.length === 0 ? (
                <p className="text-[14px] text-muted">Nenhuma marcação ainda.</p>
              ) : (
                <ol className="relative">
                  {todayEvents.map((p, i) => (
                    <li key={p.id} className="relative pl-6">
                      {/* trilho da linha do tempo */}
                      {i < todayEvents.length - 1 && <span className="absolute left-[5px] top-5 bottom-0 w-px bg-border" aria-hidden="true" />}
                      <span className="absolute left-0 top-[13px] h-[11px] w-[11px] rounded-full border-2 border-foreground bg-panel" aria-hidden="true" />
                      <button
                        type="button"
                        onClick={() => setSelectedPunchDetail(p)}
                        className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left hover:bg-secondary outline-none focus-visible:ring-2 focus-visible:ring-foreground"
                      >
                        <span className="text-[14px] text-foreground">{PUNCH_TYPE_LABELS[p.type]}</span>
                        <span className="flex items-center gap-2 text-muted">
                          {p.photoDownloadUrl && <Camera size={13} strokeWidth={1.7} aria-label="com foto" />}
                          {p.latitude != null && <MapPin size={13} strokeWidth={1.7} aria-label="com localização" />}
                          <span className="text-[14px] font-medium text-foreground tabular">{formatTimeOnly(p.recordedAt)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Panel>

          {/* ---- Espelho ---- */}
          <div className="lg:col-span-2 flex flex-col gap-4">
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-px overflow-hidden rounded-lg border border-border bg-border shadow-sm">
              {[
                ['Trabalhado', formatMinutes(totals.workedMinutes), 'text-foreground'],
                ['Esperado', formatMinutes(totals.expectedMinutes), 'text-foreground'],
                ['Horas extras', formatMinutes(extraFromBalance), extraFromBalance > 0 ? 'text-success' : 'text-foreground'],
                ['Faltantes', formatMinutes(missingMinutes), missingMinutes > 0 ? 'text-danger' : 'text-foreground'],
              ].map(([label, value, tone]) => (
                <div key={label} className="bg-panel px-4 py-4">
                  <dt className="text-[12px] text-muted">{label}</dt>
                  <dd className={`mt-1 text-[22px] font-semibold tracking-tight tabular ${tone}`}>
                    {monthLoading ? <span className="skeleton block h-7 w-20" /> : value}
                  </dd>
                </div>
              ))}
            </dl>

            <Panel
              padded={false}
              title="Espelho de ponto"
              action={
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" icon={ChevronLeft} onClick={() => goMonth(-1)} aria-label="Mês anterior" />
                  <span className="min-w-[108px] text-center text-[14px] font-medium text-foreground tabular whitespace-nowrap" aria-live="polite">
                    {MONTH_NAMES[viewMonth]} {viewYear}
                  </span>
                  <Button variant="ghost" size="sm" icon={ChevronRight} onClick={() => goMonth(1)} disabled={isCurrentMonth} aria-label="Próximo mês" />
                </div>
              }
            >
              <div className="pt-3">
                {monthError && <Notice tone="danger" className="mx-5 mb-3">{monthError}</Notice>}
                {monthLoading ? (
                  <div className="divide-y divide-border" role="status" aria-label="Carregando espelho">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <div key={i} className="flex items-center gap-6 px-5 h-12">
                        <span className="skeleton h-4 w-20" />
                        <span className="skeleton h-4 w-40" />
                        <span className="skeleton h-4 w-16 ml-auto" />
                      </div>
                    ))}
                  </div>
                ) : days.length === 0 ? (
                  <p className="px-5 pb-6 text-[14px] text-muted">Nenhum dia para mostrar neste mês.</p>
                ) : (
                  <Table>
                    <THead>
                      <tr>
                        <TH>Dia</TH>
                        <TH>Marcações</TH>
                        <TH align="right" className="hidden sm:table-cell">Trabalhado</TH>
                        <TH>Situação</TH>
                        <TH align="right"><span className="sr-only">Ajuste</span></TH>
                      </tr>
                    </THead>
                    <TBody>
                      {days.map((day) => {
                        const displayStatus = deriveDisplayStatus(day, todayStr);
                        const pending = pendingRequestForDate(day.date);
                        const resolved = pending ? undefined : lastResolvedRequestForDate(day.date);
                        return (
                          <TR key={day.date}>
                            <TD className="whitespace-nowrap capitalize">{formatDateLabel(day.date)}</TD>
                            <TD>
                              {day.events.length > 0 ? (
                                <span className="flex flex-wrap gap-x-2.5 gap-y-1 text-[13px] text-foreground tabular">
                                  {day.events.map((p) => (
                                    <span key={p.id} title={PUNCH_TYPE_LABELS[p.type]}>{formatTimeOnly(p.recordedAt)}</span>
                                  ))}
                                </span>
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </TD>
                            <TD align="right" className="tabular hidden sm:table-cell">{formatMinutes(day.workedMinutes)}</TD>
                            <TD>
                              <div className="flex flex-col items-start gap-1">
                                <StatusBadge tone={STATUS_TONE[displayStatus]}>{displayStatus}</StatusBadge>
                                {pending && <span className="text-[12px] text-warning whitespace-nowrap">Ajuste em análise</span>}
                                {resolved && (
                                  <span className={`text-[12px] ${resolved.status === 'approved' ? 'text-success' : 'text-danger'}`}>
                                    Ajuste {resolved.status === 'approved' ? 'aprovado' : 'rejeitado'}
                                    {resolved.reviewNote && (
                                      <>
                                        {' · '}
                                        <button type="button" onClick={() => setViewingResolvedRequest(resolved)} className="text-muted underline underline-offset-2 hover:text-foreground">
                                          ver motivo
                                        </button>
                                      </>
                                    )}
                                  </span>
                                )}
                              </div>
                            </TD>
                            <TD align="right">
                              {pending ? (
                                <Button variant="ghost" size="sm" icon={Undo2} onClick={() => setConfirmCancelRequest(pending)} aria-label={`Cancelar ajuste de ${formatDateLabel(day.date)}`}>
                                  <span className="hidden xl:inline">Cancelar ajuste</span>
                                </Button>
                              ) : (
                                <Button variant="ghost" size="sm" icon={Wrench} onClick={() => openMaintenance(day)} aria-label={`Solicitar ajuste em ${formatDateLabel(day.date)}`}>
                                  <span className="hidden xl:inline">Solicitar ajuste</span>
                                </Button>
                              )}
                            </TD>
                          </TR>
                        );
                      })}
                    </TBody>
                  </Table>
                )}
              </div>
            </Panel>
          </div>
        </div>
      </div>

      {/* ---- Confirmar marcação ---- */}
      <Modal
        open={isConfirmModalOpen && !!status?.nextAllowedType}
        onClose={closeConfirmModal}
        size="sm"
        dismissable={!submittingPunch}
        title={status?.nextAllowedType ? `Registrar ${PUNCH_TYPE_LABELS[status.nextAllowedType].toLowerCase()}` : 'Registrar'}
        description="Confira o horário e confirme."
        footer={
          <>
            <Button variant="secondary" onClick={closeConfirmModal} disabled={submittingPunch}>Cancelar</Button>
            <Button onClick={submitPunch} loading={submittingPunch} disabled={!canSubmitPunch}>Registrar</Button>
          </>
        }
      >
        <div className="flex flex-col items-center gap-4">
          <RollingText text={timeText} className="text-[36px] leading-none font-semibold tracking-tight text-foreground" />

          {status?.requirePhoto && (
            <div className="w-full max-w-[240px]">
              <div className="aspect-[3/4] w-full overflow-hidden rounded-md border border-border bg-secondary flex items-center justify-center">
                {capturedPhotoPreview ? (
                  <img src={capturedPhotoPreview} alt="Foto capturada" className="h-full w-full object-cover" />
                ) : cameraError ? (
                  <p className="px-4 text-center text-[13px] text-danger">{cameraError}</p>
                ) : (
                  <>
                    <video ref={videoRef} autoPlay playsInline muted className={`h-full w-full object-cover ${mediaStream ? 'block' : 'hidden'}`} />
                    {!mediaStream && <span className="skeleton h-full w-full" role="status" aria-label="Abrindo a câmera" />}
                  </>
                )}
              </div>
              <div className="mt-2 flex justify-center">
                {capturedPhotoPreview ? (
                  <Button variant="secondary" size="sm" icon={RotateCcw} onClick={retakePhoto}>Tirar outra</Button>
                ) : (
                  <Button variant="secondary" size="sm" icon={Camera} onClick={capturePhoto} disabled={!mediaStream}>Capturar foto</Button>
                )}
              </div>
            </div>
          )}

          <div className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2.5 text-[13px]">
            <span className="flex items-center gap-2 text-muted"><MapPin size={15} strokeWidth={1.7} aria-hidden="true" /> Localização</span>
            {isGettingLocation ? (
              <span className="text-muted">Buscando…</span>
            ) : locationError ? (
              <span className={status?.requireLocation ? 'text-danger' : 'text-muted'}>{locationError}</span>
            ) : (
              <span className="text-success">Capturada</span>
            )}
          </div>

          {submitPunchError && <Notice tone="danger" className="w-full">{submitPunchError}</Notice>}
          {/* Canvas oculto usado só pra desenhar/capturar o frame do vídeo */}
          <canvas ref={canvasRef} className="hidden" />
        </div>
      </Modal>

      {/* ---- Solicitar ajuste ---- */}
      <Drawer
        open={maintenanceModalOpen && !!adjustmentDay}
        onClose={() => setMaintenanceModalOpen(false)}
        title="Solicitar ajuste"
        description={adjustmentDay ? `Dia ${adjustmentDay.date.split('-').reverse().join('/')} · analisado pelo seu superior` : undefined}
        dismissable={!submittingAdjustment}
        footer={
          <>
            <Button variant="secondary" onClick={() => setMaintenanceModalOpen(false)} disabled={submittingAdjustment}>Cancelar</Button>
            <Button type="submit" form="maintenance-form" loading={submittingAdjustment} disabled={!maintenanceReason.trim()}>Enviar solicitação</Button>
          </>
        }
      >
        {adjustmentDay && (
          <form id="maintenance-form" onSubmit={submitMaintenance} className="space-y-4">
            <Field label="O que precisa ser ajustado" htmlFor="adj-type" required>
              <Select id="adj-type" value={adjustmentType} onChange={(e) => setAdjustmentType(e.target.value as AdjustmentRequestRecord['type'])}>
                {(Object.keys(ADJUSTMENT_TYPE_LABELS) as AdjustmentRequestRecord['type'][]).map((t) => (
                  <option key={t} value={t} disabled={t !== 'add_missing_punch' && adjustmentDay.events.length === 0}>{ADJUSTMENT_TYPE_LABELS[t]}</option>
                ))}
              </Select>
            </Field>

            {adjustmentType !== 'add_missing_punch' && (
              <Field label={adjustmentType === 'remove_punch' ? 'Marcação a remover' : 'Marcação a corrigir'} htmlFor="adj-event" required>
                <Select id="adj-event" required value={adjustmentRelatedEventId} onChange={(e) => setAdjustmentRelatedEventId(e.target.value)}>
                  {adjustmentDay.events.map((ev) => (
                    <option key={ev.id} value={ev.id}>{PUNCH_TYPE_LABELS[ev.type]} às {formatTimeOnly(ev.recordedAt)}</option>
                  ))}
                </Select>
              </Field>
            )}

            {adjustmentType !== 'remove_punch' && (
              <div className="grid grid-cols-2 gap-4">
                <Field label={adjustmentType === 'add_missing_punch' ? 'Tipo a adicionar' : 'Tipo correto'} htmlFor="adj-kind" required>
                  <Select id="adj-kind" value={adjustmentRequestedEventType} onChange={(e) => setAdjustmentRequestedEventType(e.target.value as TimePunchType)}>
                    {(Object.keys(PUNCH_TYPE_LABELS) as TimePunchType[]).map((t) => <option key={t} value={t}>{PUNCH_TYPE_LABELS[t]}</option>)}
                  </Select>
                </Field>
                <Field label="Horário" htmlFor="adj-time" required>
                  <Input id="adj-time" type="time" required value={adjustmentRequestedTime} onChange={(e) => setAdjustmentRequestedTime(e.target.value)} />
                </Field>
              </div>
            )}

            <Field label="Explique o que aconteceu" htmlFor="adj-reason" required>
              <Textarea id="adj-reason" required value={maintenanceReason} onChange={(e) => setMaintenanceReason(e.target.value)} placeholder="Ex.: esqueci de bater a saída, saí às 18h." />
            </Field>

            <Field label="Comprovante" htmlFor="adj-file" hint="Opcional. PDF, JPG ou PNG.">
              <label htmlFor="adj-file" className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 text-[14px] text-muted hover:border-foreground/30 hover:text-foreground">
                <Paperclip size={15} strokeWidth={1.7} aria-hidden="true" />
                <span className="truncate">{maintenanceAttachment ? maintenanceAttachment.name : 'Escolher arquivo'}</span>
              </label>
              <input id="adj-file" type="file" accept=".pdf,.jpg,.jpeg,.png" className="sr-only" onChange={(e) => setMaintenanceAttachment(e.target.files?.[0] ?? null)} />
            </Field>

            {adjustmentError && <Notice tone="danger">{adjustmentError}</Notice>}
          </form>
        )}
      </Drawer>

      {/* ---- Cancelar ajuste ---- */}
      <ConfirmDialog
        open={!!confirmCancelRequest}
        onClose={() => setConfirmCancelRequest(null)}
        onConfirm={() => confirmCancelRequest && handleCancelRequest(confirmCancelRequest.id)}
        busy={!!cancellingRequestId}
        title="Cancelar a solicitação de ajuste?"
        description={confirmCancelRequest
          ? `A solicitação do dia ${confirmCancelRequest.targetDate.split('-').reverse().join('/')} sai da análise do seu superior. Você pode pedir de novo depois.`
          : undefined}
        confirmLabel="Cancelar solicitação"
        cancelLabel="Manter"
        tone="danger"
      />

      {/* ---- Detalhe da marcação ---- */}
      <Modal
        open={!!selectedPunchDetail}
        onClose={() => setSelectedPunchDetail(null)}
        size="sm"
        title={selectedPunchDetail ? `${PUNCH_TYPE_LABELS[selectedPunchDetail.type]} às ${formatTimeOnly(selectedPunchDetail.recordedAt)}` : 'Marcação'}
      >
        {selectedPunchDetail && (
          <div className="space-y-4">
            {selectedPunchDetail.validationStatus !== 'valid' && (
              <Notice tone="warning">
                {selectedPunchDetail.validationStatus === 'pending_review' ? 'Marcação em análise pelo RH.' : 'Marcação corrigida administrativamente.'}
              </Notice>
            )}
            <div className="aspect-square w-full overflow-hidden rounded-md border border-border bg-secondary flex items-center justify-center">
              {!selectedPunchDetail.photoDownloadUrl ? (
                <span className="flex flex-col items-center gap-2 text-[13px] text-muted"><ImageIcon size={22} strokeWidth={1.5} aria-hidden="true" /> Sem foto</span>
              ) : punchPhotoObjectUrl ? (
                <img src={punchPhotoObjectUrl} alt="Foto da marcação" className="h-full w-full object-cover" />
              ) : punchPhotoLoading ? (
                <span className="skeleton h-full w-full" role="status" aria-label="Carregando foto" />
              ) : (
                <span className="text-[13px] text-muted">Não foi possível carregar a foto.</span>
              )}
            </div>
            <dl className="grid grid-cols-1 gap-3 text-[14px]">
              <div className="flex items-start gap-3">
                <MapPin size={16} strokeWidth={1.7} className="mt-0.5 text-muted" aria-hidden="true" />
                <div>
                  <dt className="text-[12px] text-muted">Localização</dt>
                  <dd className="text-foreground tabular">
                    {selectedPunchDetail.latitude != null && selectedPunchDetail.longitude != null
                      ? `${selectedPunchDetail.latitude.toFixed(6)}, ${selectedPunchDetail.longitude.toFixed(6)}`
                      : 'Não registrada'}
                  </dd>
                </div>
              </div>
              <div className="flex items-start gap-3">
                {selectedPunchDetail.source === 'mobile'
                  ? <Smartphone size={16} strokeWidth={1.7} className="mt-0.5 text-muted" aria-hidden="true" />
                  : <Monitor size={16} strokeWidth={1.7} className="mt-0.5 text-muted" aria-hidden="true" />}
                <div>
                  <dt className="text-[12px] text-muted">Origem</dt>
                  <dd className="text-foreground">
                    {selectedPunchDetail.source === 'mobile' ? 'Celular' : selectedPunchDetail.source === 'admin_manual' ? 'Correção administrativa' : 'Computador'}
                  </dd>
                </div>
              </div>
            </dl>
          </div>
        )}
      </Modal>

      {/* ---- Motivo da análise (reviewNote pode ter até 2000 caracteres) ---- */}
      <Modal
        open={!!viewingResolvedRequest}
        onClose={() => setViewingResolvedRequest(null)}
        size="sm"
        title="Motivo da análise"
        description={viewingResolvedRequest ? `${ADJUSTMENT_TYPE_LABELS[viewingResolvedRequest.type]} · ${formatDateLabel(viewingResolvedRequest.targetDate)}` : undefined}
      >
        {viewingResolvedRequest && (
          <div className="space-y-3">
            <StatusBadge tone={viewingResolvedRequest.status === 'approved' ? 'success' : 'danger'}>
              {viewingResolvedRequest.status === 'approved' ? 'Aprovado' : 'Rejeitado'}
            </StatusBadge>
            <p className="text-[14px] text-foreground whitespace-pre-wrap break-words">{viewingResolvedRequest.reviewNote}</p>
            {viewingResolvedRequest.reviewedAt && (
              <p className="text-[12px] text-muted">
                Analisado em {new Date(viewingResolvedRequest.reviewedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default TimeTracking;
