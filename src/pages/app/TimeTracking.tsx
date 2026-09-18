import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  Clock, CheckCircle2, X, AlertCircle, Calendar, ChevronDown, Activity, UserCheck, AlertTriangle,
  Camera, MapPin, Smartphone, Monitor, Loader2, Image as ImageIcon, Paperclip, UserPlus, RotateCcw,
} from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { getCurrentUser, refreshCurrentUser } from '../../lib/auth';
import {
  getTimeClockStatus, createTimePunch, getOwnTimeSummary, createAdjustmentRequest,
  listOwnAdjustmentRequests, cancelAdjustmentRequest, linkMyEmployee, listEmployees, fetchProtectedFileObjectUrl,
  type TimeClockStatus, type TimePunch, type MonthlySummary, type DailySummary,
  type AdjustmentRequestRecord, type TimePunchType, type EmployeeListItem,
} from '../../lib/api';

const PUNCH_TYPE_LABELS: Record<TimePunchType, string> = {
  clock_in: 'Entrada',
  break_start: 'Saída Almoço',
  break_end: 'Volta Almoço',
  clock_out: 'Saída',
  extra_in: 'Entrada Extra',
  extra_out: 'Saída Extra',
};

const ADJUSTMENT_TYPE_LABELS: Record<AdjustmentRequestRecord['type'], string> = {
  add_missing_punch: 'Adicionar marcação faltante',
  correct_time: 'Corrigir horário de uma marcação',
  remove_punch: 'Remover marcação incorreta',
};

const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function formatTimeOnly(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function formatDateLabel(dateStr: string) {
  const d = new Date(`${dateStr}T12:00:00`); // meio-dia local pra nunca cair no dia anterior por causa de fuso
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}
function formatMinutesSigned(mins: number) {
  const sign = mins < 0 ? '-' : '';
  const abs = Math.abs(mins);
  const hrs = Math.floor(abs / 60);
  const rem = abs % 60;
  return `${sign}${hrs.toString().padStart(2, '0')}h${rem.toString().padStart(2, '0')}m`;
}
function formatMinutesHHmm(mins: number) {
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
}

// Deriva um "status do dia" só pra manter o vocabulário visual que a tela já tinha
// (Completo/Incompleto/Falta/Folga/Feriado) — é uma conveniência de exibição do frontend, não um
// conceito do backend (que devolve isHoliday/isOnVacationOrLeave/hasOpenJourney/workedMinutes/
// expectedMinutes/events crus, sem nenhum "status" pronto).
type DisplayStatus = 'Completo' | 'Incompleto' | 'Falta' | 'Folga' | 'Feriado';
function deriveDisplayStatus(day: DailySummary, todayStr: string): DisplayStatus {
  if (day.isHoliday) return 'Feriado';
  if (day.isOnVacationOrLeave) return 'Folga';
  if (day.expectedMinutes === 0) return 'Folga'; // fim de semana ou sem jornada configurada pra este dia
  if (day.events.length === 0) return day.date === todayStr ? 'Incompleto' : 'Falta';
  if (day.hasOpenJourney) return 'Incompleto';
  return day.workedMinutes >= day.expectedMinutes ? 'Completo' : 'Incompleto';
}
function getStatusColor(status: DisplayStatus) {
  switch (status) {
    case 'Completo': return 'bg-green-500/10 text-green-600 border-green-500/20';
    case 'Incompleto': return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20';
    case 'Falta': return 'bg-red-500/10 text-red-600 border-red-500/20';
    case 'Folga': return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
    case 'Feriado': return 'bg-purple-500/10 text-purple-600 border-purple-500/20';
    default: return 'bg-secondary text-muted border-border';
  }
}

const isMobileDevice = () => /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

const TimeTracking = () => {
  const currentUser = getCurrentUser();
  const [linkedEmployeeId, setLinkedEmployeeId] = useState<string | null>(currentUser?.employeeId ?? null);

  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEscapeKey(() => {
    setMaintenanceModalOpen(false);
    setIsConfirmModalOpen(false);
  });

  // ---- Estado vazio: login sem employeeId vinculado ----
  const [linkableEmployees, setLinkableEmployees] = useState<EmployeeListItem[]>([]);
  const [loadingLinkable, setLoadingLinkable] = useState(false);
  const [selectedLinkId, setSelectedLinkId] = useState('');
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState('');

  useEffect(() => {
    if (linkedEmployeeId) return;
    let cancelled = false;
    setLoadingLinkable(true);
    listEmployees()
      .then((items) => { if (!cancelled) setLinkableEmployees(items); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingLinkable(false); });
    return () => { cancelled = true; };
  }, [linkedEmployeeId]);

  const handleLinkEmployee = async () => {
    if (!selectedLinkId) return;
    setLinking(true);
    setLinkError('');
    try {
      await linkMyEmployee(selectedLinkId);
      const updated = await refreshCurrentUser();
      setLinkedEmployeeId(updated.employeeId);
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Não foi possível vincular seu login a este funcionário.');
    } finally {
      setLinking(false);
    }
  };

  // ---- Dados reais (só carregados quando há employeeId vinculado) ----
  const now = new Date();
  const realYear = now.getFullYear();
  const realMonth = now.getMonth() + 1; // API usa mês 1-indexado
  const todayStr = now.toISOString().slice(0, 10);

  const [selectedMonth, setSelectedMonth] = useState(now.getMonth()); // 0-indexado, como o <select> original
  const [selectedYear, setSelectedYear] = useState(realYear);

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
    // Busca sempre o próprio mês/ano REAIS (não reaproveita monthSummary mesmo quando o espelho
    // está no mês atual) — reaproveitar arriscaria mostrar dado desatualizado bem no momento mais
    // importante: logo depois de bater um ponto (refreshKey muda os dois efeitos juntos, mas o
    // valor de monthSummary só é atualizado quando O OUTRO efeito termina, então ler o closure
    // dele aqui poderia pegar a versão antiga). Uma chamada a mais é um custo pequeno e aceitável
    // pela garantia de dado sempre fresco.
    getOwnTimeSummary(realYear, realMonth)
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
    getOwnTimeSummary(selectedYear, selectedMonth + 1)
      .then((m) => { if (!cancelled) setMonthSummary(m); })
      .catch((err) => { if (!cancelled) setMonthError(err instanceof Error ? err.message : 'Não foi possível carregar o espelho de ponto.'); })
      .finally(() => { if (!cancelled) setMonthLoading(false); });
    return () => { cancelled = true; };
  }, [linkedEmployeeId, selectedYear, selectedMonth, refreshKey]);

  useEffect(() => {
    if (!linkedEmployeeId) return;
    let cancelled = false;
    listOwnAdjustmentRequests()
      .then((items) => { if (!cancelled) setOwnRequests(items); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [linkedEmployeeId, refreshKey]);

  const pendingRequestForDate = (date: string) => ownRequests.find((r) => r.targetDate === date && r.status === 'pending');

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
  const [punchPhotoObjectUrl, setPunchPhotoObjectUrl] = useState<string | null>(null);
  const [punchPhotoLoading, setPunchPhotoLoading] = useState(false);

  // `photoDownloadUrl` nunca pode virar `<img src>` direto — a rota exige o JWT de acesso normal
  // além do token de download (ver fetchProtectedFileObjectUrl em src/lib/api.ts), então busca a
  // imagem via fetch autenticado e usa um Object URL local. Revoga o Object URL anterior ao trocar
  // de marcação/fechar o modal, pra não vazar memória.
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

  // Garante que a câmera é desligada se o usuário sair da página com o modal de confirmação
  // ainda aberto (ex.: navegou pra outra rota) — sem isso o stream ficaria vivo indefinidamente,
  // já que stopCamera() só é chamado pelos handlers normais de fechar o modal.
  const mediaStreamRef = useRef<MediaStream | null>(null);
  useEffect(() => { mediaStreamRef.current = mediaStream; }, [mediaStream]);
  useEffect(() => () => { mediaStreamRef.current?.getTracks().forEach((track) => track.stop()); }, []);

  // Reflete se o modal de confirmação está aberto NO MOMENTO em que a promise de
  // getUserMedia resolve — não pode ler o state `isConfirmModalOpen` direto ali dentro
  // porque o closure captura o valor de quando startCamera() foi chamada, não o atual.
  // Sem isso, abrir e fechar o modal rápido antes da permissão de câmera resolver deixaria
  // o stream vivo (luz da câmera acesa) mesmo com o modal já fechado.
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
        if (videoRef.current) videoRef.current.srcObject = stream;
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

  // A localização é sempre buscada de forma otimista, mesmo quando não é exigida (o backend
  // aproveita lat/lng pra classificar geofencing mesmo sem exigir — ver createPunch no backend),
  // mas só bloqueia o envio quando `requireLocation` for true — antes disso, `isGettingLocation`
  // sozinho travava "Registrar" até o GPS responder (ou até os 10s de timeout do
  // getCurrentPosition esgotarem) mesmo com a exigência desligada, fazendo a marcação parecer
  // travada/exigindo localização quando na verdade não exigia nada.
  const canSubmitPunch =
    !submittingPunch &&
    (!status?.requirePhoto || !!capturedPhotoBlob) &&
    (!status?.requireLocation || (!isGettingLocation && !!gpsCoords));

  const submitPunch = async () => {
    if (!status?.nextAllowedType || !canSubmitPunch) return;
    setSubmittingPunch(true);
    setSubmitPunchError('');
    try {
      await createTimePunch({
        type: status.nextAllowedType,
        latitude: gpsCoords?.lat,
        longitude: gpsCoords?.lng,
        deviceReportedAt: new Date().toISOString(),
        isMobile: isMobileDevice(),
        photo: capturedPhotoBlob ? new File([capturedPhotoBlob], 'ponto.jpg', { type: 'image/jpeg' }) : undefined,
      });
      closeConfirmModal();
      bump();
    } catch (err) {
      // erro visível no próprio modal — nunca alert(), e o modal continua aberto pro usuário tentar de novo
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

  const openMaintenance = (day: DailySummary) => {
    setAdjustmentDay(day);
    setAdjustmentType('correct_time');
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
    if (!adjustmentDay || !maintenanceReason) return;
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
      bump();
    } catch (err) {
      setMonthError(err instanceof Error ? err.message : 'Não foi possível cancelar a solicitação.');
    } finally {
      setCancellingRequestId(null);
    }
  };

  // ---- Resumo do mês (cards de baixo) — direto dos totals já calculados pelo backend ----
  const totals = monthSummary?.totals ?? { workedMinutes: 0, expectedMinutes: 0, extraMinutes: 0, balanceMinutes: 0 };
  const missingMinutes = totals.balanceMinutes < 0 ? Math.abs(totals.balanceMinutes) : 0;
  const extraFromBalance = totals.balanceMinutes > 0 ? totals.balanceMinutes : totals.extraMinutes;

  // ==== Estado vazio: login sem employeeId vinculado ====
  if (!linkedEmployeeId) {
    return (
      <div className="p-8 h-full flex flex-col items-center justify-center">
        <div className="max-w-md w-full bg-panel border border-border rounded-2xl shadow-sm p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <UserPlus size={28} className="text-primary" />
          </div>
          <h2 className="text-xl font-heading font-bold text-foreground mb-2">Cadastro de funcionário necessário</h2>
          <p className="text-muted text-sm mb-6">
            Seu login ainda não está vinculado a um cadastro de funcionário — isso é necessário para bater
            ponto. Crie seu cadastro em Funcionários (se ainda não existir) e depois vincule seu login a ele
            abaixo.
          </p>
          <Link to="/app/funcionarios" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80 mb-6">
            Ir para Funcionários →
          </Link>

          <div className="border-t border-border pt-6 text-left">
            <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">
              Vincular meu login a um funcionário existente
            </label>
            {loadingLinkable ? (
              <p className="text-xs text-muted italic flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Carregando funcionários...</p>
            ) : linkableEmployees.length === 0 ? (
              <p className="text-xs text-muted italic">Nenhum funcionário cadastrado ainda.</p>
            ) : (
              <div className="flex gap-2">
                <select
                  value={selectedLinkId}
                  onChange={(e) => setSelectedLinkId(e.target.value)}
                  className="flex-1 bg-background border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-primary text-foreground"
                >
                  <option value="">Selecione...</option>
                  {linkableEmployees.map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.fullName}</option>
                  ))}
                </select>
                <button
                  onClick={handleLinkEmployee}
                  disabled={!selectedLinkId || linking}
                  className="px-4 py-2.5 bg-primary hover:bg-primary/90 disabled:bg-primary/50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-bold transition-colors flex items-center gap-2"
                >
                  {linking && <Loader2 size={16} className="animate-spin" />}
                  Vincular
                </button>
              </div>
            )}
            {linkError && (
              <div className="mt-3 bg-red-500/10 border border-red-500/20 text-red-600 text-xs p-3 rounded-xl flex items-start gap-2">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                {linkError}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 h-full flex flex-col">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 shrink-0">
        <div>
          <h1 className="text-3xl font-heading font-bold text-foreground flex items-center gap-2">
            <Clock size={28} className="text-primary" />
            Controle de Ponto
          </h1>
          <p className="text-muted mt-1">Registre sua jornada de trabalho e gerencie marcações.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 overflow-hidden">

        {/* Left Side: Clock Puncher */}
        <div className="lg:col-span-1 bg-panel border border-border rounded-2xl shadow-sm flex flex-col p-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-bl-full blur-3xl pointer-events-none"></div>
          <div className="absolute bottom-0 left-0 w-24 h-24 bg-primary/5 rounded-tr-full blur-2xl pointer-events-none"></div>

          <div className="flex flex-col items-center justify-center mb-8 relative z-10 text-center">
            <h2 className="text-xs font-semibold text-muted uppercase tracking-[0.2em] mb-3">Horário Atual</h2>
            <div className="text-5xl md:text-6xl font-heading font-bold text-foreground mb-2 tabular-nums tracking-tight">
              {currentTime.toLocaleTimeString('pt-BR')}
            </div>
            <div className="text-sm font-medium text-foreground/70">
              {currentTime.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
          </div>

          <div className="w-full mb-8 relative z-10">
            {statusLoading ? (
              <div className="w-full py-5 rounded-2xl bg-secondary/10 border border-border/50 flex items-center justify-center gap-2 text-muted text-sm font-medium">
                <Loader2 size={20} className="animate-spin" /> Carregando status...
              </div>
            ) : statusError ? (
              <div className="w-full rounded-2xl bg-red-500/10 border border-red-500/20 text-red-600 text-sm p-4 flex items-start gap-2">
                <AlertCircle size={16} className="shrink-0 mt-0.5" /> {statusError}
              </div>
            ) : status?.nextAllowedType ? (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={openPunchModal}
                className="w-full py-5 rounded-2xl text-white font-bold text-lg shadow-lg shadow-primary/25 bg-primary hover:bg-primary/90 transition-all flex flex-col items-center justify-center gap-1"
              >
                <span>Registrar {PUNCH_TYPE_LABELS[status.nextAllowedType]}</span>
                <span className="text-xs font-medium text-white/70">Clique para capturar o horário</span>
              </motion.button>
            ) : null}
          </div>

          <div className="w-full bg-secondary/10 border border-border/50 rounded-2xl p-5 flex-1 flex flex-col relative z-10 min-h-[250px]">
            <h3 className="text-sm font-bold text-foreground mb-4 text-left flex items-center justify-between">
              Marcações de Hoje
              <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full text-xs font-bold">{todaySummary?.events.length ?? 0}</span>
            </h3>
            {todayLoading ? (
              <div className="flex-1 flex items-center justify-center text-muted">
                <Loader2 size={24} className="animate-spin opacity-50" />
              </div>
            ) : !todaySummary || todaySummary.events.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-sm text-muted italic opacity-70">
                <Clock size={24} className="mb-2 opacity-20" />
                Nenhuma marcação ainda.
              </div>
            ) : (
              <div className="space-y-3 overflow-y-auto custom-scrollbar pr-2 flex-1">
                {todaySummary.events.map((p) => (
                  <div
                    key={p.id}
                    className="flex justify-between items-center text-sm group bg-background/50 p-2.5 rounded-xl border border-border/40 hover:border-border hover:shadow-sm cursor-pointer transition-all"
                    onClick={() => setSelectedPunchDetail(p)}
                  >
                    <span className="text-foreground/80 font-medium flex items-center gap-2.5">
                      <div className="w-2 h-2 rounded-full bg-primary/40 group-hover:bg-primary transition-colors"></div>
                      {PUNCH_TYPE_LABELS[p.type]}
                    </span>
                    <div className="flex items-center gap-3">
                      <div className="flex gap-1.5 opacity-40 group-hover:opacity-100 transition-opacity">
                        {p.photoDownloadUrl && <Camera size={14} className="text-muted group-hover:text-primary transition-colors" />}
                        {p.latitude != null && <MapPin size={14} className="text-muted group-hover:text-primary transition-colors" />}
                      </div>
                      <span className="font-mono font-bold text-foreground bg-background px-3 py-1.5 rounded-lg border border-border shadow-sm text-xs">
                        {formatTimeOnly(p.recordedAt)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Side: History */}
        <div className="lg:col-span-2 bg-panel border border-border rounded-2xl shadow-sm flex flex-col overflow-hidden">
          <div className="p-5 border-b border-border flex flex-col md:flex-row justify-between items-center bg-secondary/30 gap-4">
            <h2 className="font-bold text-foreground flex items-center gap-2">
              <Calendar size={18} className="text-primary" />
              Espelho de Ponto
            </h2>

            <div className="flex gap-2 w-full md:w-auto">
              <div className="relative flex-1 md:flex-none">
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(Number(e.target.value))}
                  className="w-full md:w-40 appearance-none bg-background border border-border rounded-xl px-4 py-2 pr-10 text-sm font-medium focus:outline-none focus:border-primary transition-colors cursor-pointer text-foreground"
                >
                  {MONTH_NAMES.map((m, i) => (
                    <option key={m} value={i}>{m}</option>
                  ))}
                </select>
                <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              </div>
              <div className="relative flex-1 md:flex-none">
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                  className="w-full md:w-28 appearance-none bg-background border border-border rounded-xl px-4 py-2 pr-10 text-sm font-medium focus:outline-none focus:border-primary transition-colors cursor-pointer text-foreground"
                >
                  {[realYear - 2, realYear - 1, realYear].map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
                <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-auto custom-scrollbar p-5">
            {monthError && (
              <div className="mb-4 bg-red-500/10 border border-red-500/20 text-red-600 text-sm p-4 rounded-xl flex items-start gap-2">
                <AlertCircle size={16} className="shrink-0 mt-0.5" /> {monthError}
              </div>
            )}
            {monthLoading ? (
              <div className="flex items-center justify-center py-16 text-muted">
                <Loader2 size={28} className="animate-spin opacity-50" />
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b-2 border-border/60">
                    <th className="pb-3 text-xs font-semibold text-muted uppercase tracking-wider">Data</th>
                    <th className="pb-3 text-xs font-semibold text-muted uppercase tracking-wider text-center">Registros (Horários)</th>
                    <th className="pb-3 text-xs font-semibold text-muted uppercase tracking-wider text-center">Horas Trabalhadas</th>
                    <th className="pb-3 text-xs font-semibold text-muted uppercase tracking-wider text-center">Status</th>
                    <th className="pb-3 text-xs font-semibold text-muted uppercase tracking-wider text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {[...(monthSummary?.days ?? [])].reverse().map((day) => {
                    const displayStatus = deriveDisplayStatus(day, todayStr);
                    const pending = pendingRequestForDate(day.date);
                    return (
                      <tr key={day.date} className="hover:bg-secondary/5 transition-colors">
                        <td className="py-4">
                          <div className="font-medium text-sm text-foreground capitalize">{formatDateLabel(day.date)}</div>
                        </td>
                        <td className="py-4 text-center">
                          {day.events.length > 0 ? (
                            <div className="flex items-center justify-center flex-wrap gap-1">
                              {day.events.map((p) => (
                                <span key={p.id} className="text-xs font-mono bg-secondary/50 text-foreground px-1.5 py-0.5 rounded border border-border" title={PUNCH_TYPE_LABELS[p.type]}>
                                  {formatTimeOnly(p.recordedAt)}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-muted">-</span>
                          )}
                        </td>
                        <td className="py-4 text-center">
                          <span className="font-bold text-foreground">{formatMinutesHHmm(day.workedMinutes)}</span>
                        </td>
                        <td className="py-4 text-center">
                          <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium border ${getStatusColor(displayStatus)}`}>
                            {displayStatus}
                          </span>
                          {pending && (
                            <div className="text-[10px] mt-1 text-orange-500 font-medium">Ajuste Pendente</div>
                          )}
                        </td>
                        <td className="py-4 text-right">
                          {pending ? (
                            <button
                              onClick={() => handleCancelRequest(pending.id)}
                              disabled={cancellingRequestId === pending.id}
                              className="text-xs font-medium text-red-500 hover:text-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {cancellingRequestId === pending.id ? 'Cancelando...' : 'Cancelar Ajuste'}
                            </button>
                          ) : (
                            <button
                              onClick={() => openMaintenance(day)}
                              className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                            >
                              Solicitar Ajuste
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Section: Journey Summary */}
      <div className="mt-6 shrink-0">
        <h2 className="text-lg font-heading font-bold text-foreground mb-4 flex items-center gap-2">
          <Activity size={20} className="text-primary" />
          Jornada do Mês ({MONTH_NAMES[selectedMonth]})
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-panel border border-border rounded-2xl p-5 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Clock size={24} className="text-primary" />
            </div>
            <div>
              <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Total Trabalhado</p>
              <p className="text-2xl font-heading font-bold text-foreground">{formatMinutesSigned(totals.workedMinutes)}</p>
            </div>
          </div>

          <div className="bg-panel border border-border rounded-2xl p-5 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-secondary/50 flex items-center justify-center shrink-0">
              <Calendar size={24} className="text-foreground/70" />
            </div>
            <div>
              <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Horas Esperadas</p>
              <p className="text-2xl font-heading font-bold text-foreground">{formatMinutesSigned(totals.expectedMinutes)}</p>
            </div>
          </div>

          <div className="bg-panel border border-border rounded-2xl p-5 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
              <UserCheck size={24} className="text-green-600" />
            </div>
            <div>
              <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Horas Extras</p>
              <p className="text-2xl font-heading font-bold text-green-600">{formatMinutesSigned(extraFromBalance)}</p>
            </div>
          </div>

          <div className="bg-panel border border-border rounded-2xl p-5 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
              <AlertTriangle size={24} className="text-red-600" />
            </div>
            <div>
              <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Horas Faltantes</p>
              <p className="text-2xl font-heading font-bold text-red-600">{formatMinutesSigned(missingMinutes)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Maintenance Drawer */}
      {maintenanceModalOpen && adjustmentDay && createPortal(
        <AnimatePresence>
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMaintenanceModalOpen(false)}
              className="fixed inset-0 z-[100] bg-background/60 backdrop-blur-sm"
            />
            <div className="fixed inset-0 z-[101] flex justify-end pointer-events-none">
              <motion.div
                initial={{ x: '100%', opacity: 0.5 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: '100%', opacity: 0.5 }}
                transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                className="w-full max-w-md bg-background border-l border-border shadow-2xl h-full flex flex-col pointer-events-auto"
              >
                <div className="p-6 md:p-8 border-b border-border flex items-center justify-between bg-secondary/10 shrink-0">
                  <div>
                    <h2 className="text-xl font-heading font-bold text-foreground flex items-center gap-2">
                      <AlertCircle size={20} className="text-orange-500" />
                      Solicitar Manutenção
                    </h2>
                    <p className="text-muted text-sm mt-1">Informe ao RH o motivo do ajuste de ponto.</p>
                  </div>
                  <button
                    onClick={() => setMaintenanceModalOpen(false)}
                    className="p-2 text-muted hover:text-foreground bg-secondary/30 hover:bg-secondary/80 rounded-full transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>

                <form id="maintenanceForm" onSubmit={submitMaintenance} className="p-6 md:p-8 flex-1 overflow-y-auto custom-scrollbar space-y-6">
                  <div className="bg-orange-500/10 border border-orange-500/20 text-orange-600 text-sm p-4 rounded-xl">
                    <p>Você está solicitando ajuste para o dia <strong>{adjustmentDay.date.split('-').reverse().join('/')}</strong>.</p>
                    <p className="mt-1 text-xs opacity-80">Sua solicitação será analisada pelo seu superior.</p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">Tipo de solicitação *</label>
                    <select
                      value={adjustmentType}
                      onChange={(e) => setAdjustmentType(e.target.value as AdjustmentRequestRecord['type'])}
                      className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary text-foreground transition-colors"
                    >
                      {(Object.keys(ADJUSTMENT_TYPE_LABELS) as AdjustmentRequestRecord['type'][]).map((t) => (
                        <option key={t} value={t}>{ADJUSTMENT_TYPE_LABELS[t]}</option>
                      ))}
                    </select>
                  </div>

                  {adjustmentType !== 'add_missing_punch' && (
                    <div>
                      <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">
                        {adjustmentType === 'remove_punch' ? 'Marcação a remover *' : 'Marcação a corrigir *'}
                      </label>
                      {adjustmentDay.events.length === 0 ? (
                        <p className="text-xs text-muted italic">Este dia não tem marcações para selecionar.</p>
                      ) : (
                        <select
                          required
                          value={adjustmentRelatedEventId}
                          onChange={(e) => setAdjustmentRelatedEventId(e.target.value)}
                          className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary text-foreground transition-colors"
                        >
                          {adjustmentDay.events.map((ev) => (
                            <option key={ev.id} value={ev.id}>{PUNCH_TYPE_LABELS[ev.type]} — {formatTimeOnly(ev.recordedAt)}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}

                  {adjustmentType !== 'remove_punch' && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">
                          {adjustmentType === 'add_missing_punch' ? 'Tipo a adicionar *' : 'Tipo correto *'}
                        </label>
                        <select
                          value={adjustmentRequestedEventType}
                          onChange={(e) => setAdjustmentRequestedEventType(e.target.value as TimePunchType)}
                          className="w-full bg-background border border-border rounded-xl px-3 py-3 text-sm focus:outline-none focus:border-primary text-foreground transition-colors"
                        >
                          {(Object.keys(PUNCH_TYPE_LABELS) as TimePunchType[]).map((t) => (
                            <option key={t} value={t}>{PUNCH_TYPE_LABELS[t]}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">Horário *</label>
                        <input
                          type="time"
                          required
                          value={adjustmentRequestedTime}
                          onChange={(e) => setAdjustmentRequestedTime(e.target.value)}
                          className="w-full bg-background border border-border rounded-xl px-3 py-3 text-sm focus:outline-none focus:border-primary text-foreground transition-colors"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">Descreva a solicitação *</label>
                    <textarea
                      required
                      value={maintenanceReason}
                      onChange={(e) => setMaintenanceReason(e.target.value)}
                      placeholder="Ex: Esqueci de bater o ponto na saída, saí às 18:00..."
                      className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary text-foreground transition-colors min-h-[100px] resize-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">Anexo (opcional)</label>
                    <label className="flex items-center gap-2 w-full bg-background border border-dashed border-border rounded-xl px-4 py-3 text-sm text-muted cursor-pointer hover:border-primary transition-colors">
                      <Paperclip size={16} />
                      {maintenanceAttachment ? maintenanceAttachment.name : 'Anexar comprovante (PDF, JPG ou PNG)'}
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        className="hidden"
                        onChange={(e) => setMaintenanceAttachment(e.target.files?.[0] ?? null)}
                      />
                    </label>
                  </div>

                  {adjustmentError && (
                    <div className="bg-red-500/10 border border-red-500/20 text-red-600 text-sm p-4 rounded-xl flex items-start gap-2">
                      <AlertCircle size={16} className="shrink-0 mt-0.5" /> {adjustmentError}
                    </div>
                  )}
                </form>

                <div className="p-6 border-t border-border bg-background flex gap-3 sticky bottom-0">
                  <button
                    type="button"
                    onClick={() => setMaintenanceModalOpen(false)}
                    className="flex-1 py-3.5 rounded-xl font-medium border border-border text-foreground hover:bg-secondary transition-colors text-sm"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    form="maintenanceForm"
                    disabled={submittingAdjustment}
                    className="flex-1 py-3.5 bg-primary hover:bg-primary/90 disabled:bg-primary/50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-bold transition-colors shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
                  >
                    {submittingAdjustment && <Loader2 size={16} className="animate-spin" />}
                    Enviar Solicitação
                  </button>
                </div>
              </motion.div>
            </div>
          </>
        </AnimatePresence>,
        document.body,
      )}

      {/* Confirmation Modal */}
      {isConfirmModalOpen && status?.nextAllowedType && createPortal(
        <AnimatePresence>
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeConfirmModal}
              className="fixed inset-0 z-[100] bg-background/60 backdrop-blur-sm"
            />
            <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none">
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="w-full max-w-md bg-background border border-border shadow-2xl rounded-2xl flex flex-col pointer-events-auto overflow-hidden"
              >
                <div className="p-5 border-b border-border flex items-center justify-between bg-secondary/10 shrink-0">
                  <h2 className="text-lg font-heading font-bold text-foreground">Confirmar Marcação</h2>
                  <button
                    onClick={closeConfirmModal}
                    className="p-2 text-muted hover:text-foreground bg-secondary/30 hover:bg-secondary/80 rounded-full transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="p-6 text-center flex flex-col items-center">
                  <div className="text-4xl font-heading font-bold text-primary tabular-nums mb-1">
                    {new Date().toLocaleTimeString('pt-BR')}
                  </div>
                  <p className="text-foreground/80 mb-6 text-sm font-medium">
                    Marcando: <strong>{PUNCH_TYPE_LABELS[status.nextAllowedType]}</strong>
                  </p>

                  {status.requirePhoto && (
                    <div className="w-full max-w-[240px] aspect-[3/4] bg-secondary/20 rounded-2xl border-2 border-border overflow-hidden relative shadow-inner mb-4 flex items-center justify-center">
                      {capturedPhotoPreview ? (
                        <img src={capturedPhotoPreview} alt="Foto capturada" className="w-full h-full object-cover" />
                      ) : (
                        <>
                          <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted
                            className={`w-full h-full object-cover ${cameraError ? 'hidden' : 'block'}`}
                          />
                          {cameraError && (
                            <div className="flex flex-col items-center text-red-500 p-4 text-center">
                              <Camera size={32} className="mb-2 opacity-50" />
                              <span className="text-xs font-bold uppercase tracking-wider">{cameraError}</span>
                            </div>
                          )}
                          {!cameraError && !mediaStream && (
                            <div className="flex flex-col items-center text-muted">
                              <Loader2 size={32} className="mb-2 animate-spin" />
                              <span className="text-xs font-medium">Acessando câmera...</span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {status.requirePhoto && mediaStream && !capturedPhotoPreview && (
                    <button
                      type="button"
                      onClick={capturePhoto}
                      className="mb-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-secondary hover:bg-secondary/80 text-foreground text-sm font-medium transition-colors"
                    >
                      <Camera size={16} /> Capturar Foto
                    </button>
                  )}
                  {status.requirePhoto && capturedPhotoPreview && (
                    <button
                      type="button"
                      onClick={retakePhoto}
                      className="mb-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-secondary hover:bg-secondary/80 text-foreground text-sm font-medium transition-colors"
                    >
                      <RotateCcw size={14} /> Tirar Outra
                    </button>
                  )}

                  <div className="w-full flex flex-col gap-2 bg-secondary/10 rounded-xl p-3 border border-border/50">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-muted font-medium">
                        <MapPin size={16} /> Localização:
                      </span>
                      {isGettingLocation ? (
                        <span className="flex items-center gap-2 text-primary font-bold animate-pulse text-xs">
                          <Loader2 size={12} className="animate-spin" /> Buscando...
                        </span>
                      ) : locationError ? (
                        <span className="text-red-500 font-bold text-xs">{locationError}</span>
                      ) : (
                        <span className="text-green-600 font-bold text-xs flex items-center gap-1">
                          <CheckCircle2 size={14} /> Capturada
                        </span>
                      )}
                    </div>
                  </div>

                  {submitPunchError && (
                    <div className="w-full mt-3 bg-red-500/10 border border-red-500/20 text-red-600 text-sm p-3 rounded-xl flex items-start gap-2 text-left">
                      <AlertCircle size={14} className="shrink-0 mt-0.5" /> {submitPunchError}
                    </div>
                  )}

                  {/* Canvas oculto usado só pra desenhar/capturar o frame do vídeo */}
                  <canvas ref={canvasRef} className="hidden" />
                </div>

                <div className="p-5 border-t border-border bg-secondary/10 flex gap-3">
                  <button
                    type="button"
                    onClick={closeConfirmModal}
                    disabled={submittingPunch}
                    className="flex-1 py-3 rounded-xl font-medium border border-border text-foreground hover:bg-secondary transition-colors text-sm disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={submitPunch}
                    disabled={!canSubmitPunch}
                    className="flex-1 py-3 bg-primary hover:bg-primary/90 disabled:bg-primary/50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-bold transition-colors shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
                  >
                    {submittingPunch ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                    {submittingPunch ? 'Enviando...' : 'Registrar'}
                  </button>
                </div>
              </motion.div>
            </div>
          </>
        </AnimatePresence>,
        document.body,
      )}

      {/* Punch Detail Modal */}
      {selectedPunchDetail && createPortal(
        <AnimatePresence>
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedPunchDetail(null)}
              className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm"
            />
            <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none">
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="w-full max-w-sm bg-background border border-border shadow-2xl rounded-2xl flex flex-col pointer-events-auto overflow-hidden"
              >
                <div className="p-5 border-b border-border flex items-center justify-between bg-secondary/10 shrink-0">
                  <h2 className="text-lg font-heading font-bold text-foreground">Detalhes da Marcação</h2>
                  <button
                    onClick={() => setSelectedPunchDetail(null)}
                    className="p-2 text-muted hover:text-foreground bg-secondary/30 hover:bg-secondary/80 rounded-full transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <span className="font-bold text-lg text-primary">{PUNCH_TYPE_LABELS[selectedPunchDetail.type]}</span>
                    <span className="font-mono font-bold text-foreground bg-secondary px-3 py-1 rounded-lg border border-border">
                      {formatTimeOnly(selectedPunchDetail.recordedAt)}
                    </span>
                  </div>

                  {selectedPunchDetail.validationStatus !== 'valid' && (
                    <div className="mb-4 bg-yellow-500/10 border border-yellow-500/20 text-yellow-600 text-xs p-3 rounded-xl flex items-start gap-2">
                      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                      {selectedPunchDetail.validationStatus === 'pending_review' ? 'Marcação em análise pelo RH.' : 'Marcação corrigida administrativamente.'}
                    </div>
                  )}

                  {selectedPunchDetail.photoDownloadUrl ? (
                    <div className="w-full aspect-square bg-secondary/20 rounded-xl border-2 border-border overflow-hidden mb-4 relative flex items-center justify-center">
                      {punchPhotoObjectUrl ? (
                        <img src={punchPhotoObjectUrl} alt="Foto de Ponto" className="w-full h-full object-cover" />
                      ) : punchPhotoLoading ? (
                        <Loader2 size={24} className="animate-spin text-muted" />
                      ) : (
                        <span className="text-xs text-muted">Não foi possível carregar a foto.</span>
                      )}
                    </div>
                  ) : (
                    <div className="w-full aspect-square bg-secondary/20 rounded-xl border border-dashed border-border mb-4 flex flex-col items-center justify-center text-muted">
                      <ImageIcon size={32} className="opacity-50 mb-2" />
                      <span className="text-xs">Sem foto</span>
                    </div>
                  )}

                  <div className="space-y-3 bg-secondary/10 p-4 rounded-xl border border-border/50">
                    <div className="flex items-center gap-3 text-sm">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                        <MapPin size={16} />
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <p className="font-semibold text-foreground text-xs uppercase tracking-wider mb-0.5">Localização</p>
                        {selectedPunchDetail.latitude != null && selectedPunchDetail.longitude != null ? (
                          <p className="text-muted font-mono text-[11px] truncate">
                            {selectedPunchDetail.latitude.toFixed(6)}, {selectedPunchDetail.longitude.toFixed(6)}
                          </p>
                        ) : (
                          <p className="text-muted text-xs italic">Não registrada</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-sm">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                        {selectedPunchDetail.source === 'mobile' ? <Smartphone size={16} /> : <Monitor size={16} />}
                      </div>
                      <div>
                        <p className="font-semibold text-foreground text-xs uppercase tracking-wider mb-0.5">Dispositivo</p>
                        <p className="text-muted text-xs">
                          {selectedPunchDetail.source === 'mobile' ? 'Mobile' : selectedPunchDetail.source === 'admin_manual' ? 'Correção administrativa' : 'Desktop'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          </>
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
};

export default TimeTracking;
