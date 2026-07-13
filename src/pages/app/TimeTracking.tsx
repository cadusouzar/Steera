import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { Clock, CheckCircle2, X, AlertCircle, Calendar, ChevronDown, Activity, UserCheck, AlertTriangle, Camera, MapPin, Smartphone, Monitor, Loader2, Image as ImageIcon } from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';

// Types
export interface TimePunch {
  id: string;
  time: string; // ISO String for exact time
  type: 'Entrada' | 'Saída Almoço' | 'Volta Almoço' | 'Saída' | 'Entrada Extra' | 'Saída Extra';
  location?: { lat: number, lng: number };
  photoUrl?: string; // base64
  device?: 'Mobile' | 'Desktop';
}

export interface DailyRecord {
  id: string;
  date: string; // YYYY-MM-DD
  punches: TimePunch[];
  status: 'Completo' | 'Incompleto' | 'Falta' | 'Folga' | 'Feriado';
  maintenanceRequest?: {
    reason: string;
    status: 'Pendente' | 'Aprovado' | 'Recusado';
  };
}

// Generate mock data based on month and year
const generateMockRecords = (year: number, month: number): DailyRecord[] => {
  const records: DailyRecord[] = [];
  const today = new Date();
  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth();
  const isCurrentMonth = year === todayYear && month === todayMonth;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayDateStr = today.toISOString().split('T')[0];

  // We loop through all days in the requested month
  for (let i = 1; i <= daysInMonth; i++) {
    const d = new Date(year, month, i);
    const dateStr = d.toISOString().split('T')[0];
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;

    if (isCurrentMonth && dateStr > todayDateStr) {
      // Future days in current month are not generated
      break;
    }

    if (isCurrentMonth && dateStr === todayDateStr) {
      records.push({
        id: crypto.randomUUID(),
        date: dateStr,
        punches: [],
        status: 'Incompleto'
      });
      continue;
    }

    if (isWeekend) {
      records.push({
        id: crypto.randomUUID(),
        date: dateStr,
        punches: [],
        status: 'Folga'
      });
    } else {
      const isAbsent = Math.random() > 0.9;
      if (isAbsent) {
        records.push({
          id: crypto.randomUUID(),
          date: dateStr,
          punches: [],
          status: 'Falta'
        });
      } else {
        const hasExtra = Math.random() > 0.8;
        const p: TimePunch[] = [
          { id: crypto.randomUUID(), time: `${dateStr}T08:00:00.000Z`, type: 'Entrada' },
          { id: crypto.randomUUID(), time: `${dateStr}T12:00:00.000Z`, type: 'Saída Almoço' },
          { id: crypto.randomUUID(), time: `${dateStr}T13:00:00.000Z`, type: 'Volta Almoço' },
          { id: crypto.randomUUID(), time: `${dateStr}T17:00:00.000Z`, type: 'Saída' }
        ];
        if (hasExtra) {
          p.push({ id: crypto.randomUUID(), time: `${dateStr}T17:15:00.000Z`, type: 'Entrada Extra' });
          p.push({ id: crypto.randomUUID(), time: `${dateStr}T19:00:00.000Z`, type: 'Saída Extra' });
        }
        records.push({
          id: crypto.randomUUID(),
          date: dateStr,
          punches: p,
          status: 'Completo'
        });
      }
    }
  }
  return records.reverse(); // newest first
};

const TimeTracking = () => {
  const [currentTime, setCurrentTime] = useState(new Date());
  
  // Date filters
  const today = new Date();
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth());
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());
  
  const [records, setRecords] = useState<DailyRecord[]>(generateMockRecords(today.getFullYear(), today.getMonth()));

  // Refetch records when filters change
  useEffect(() => {
    setRecords(generateMockRecords(selectedYear, selectedMonth));
  }, [selectedMonth, selectedYear]);
  
  // Modal state
  const [maintenanceModalOpen, setMaintenanceModalOpen] = useState(false);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [maintenanceReason, setMaintenanceReason] = useState('');

  // Confirmation state
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [punchTimeToConfirm, setPunchTimeToConfirm] = useState<Date | null>(null);
  
  // Camera & GPS State
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState('');
  const [location, setLocation] = useState<{lat: number, lng: number} | null>(null);
  const [locationError, setLocationError] = useState('');
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [selectedPunchDetail, setSelectedPunchDetail] = useState<TimePunch | null>(null);

  useEscapeKey(() => {
    setMaintenanceModalOpen(false);
    setIsConfirmModalOpen(false);
  });

  // Real-time clock
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Today logic (independent of selected month/year so button works)
  const todayStr = new Date().toISOString().split('T')[0];
  
  // We only track the current day in state if we're viewing the current month, 
  // otherwise we can just inject a "today" record for the puncher.
  
  // Keep an isolated state for "today's punches" so you can always punch
  // regardless of which month you are viewing.
  const [liveTodayPunches, setLiveTodayPunches] = useState<TimePunch[]>([]);
  const [liveTodayStatus, setLiveTodayStatus] = useState<DailyRecord['status']>('Incompleto');

  // Sync initial live state from mock records if viewing current month
  useEffect(() => {
    if (selectedYear === new Date().getFullYear() && selectedMonth === new Date().getMonth()) {
      const tr = records.find(r => r.date === todayStr);
      if (tr) {
        setLiveTodayPunches(tr.punches);
        setLiveTodayStatus(tr.status);
      }
    }
  }, [records, selectedMonth, selectedYear, todayStr]);

  // Determine next punch type
  const punchSequence: TimePunch['type'][] = [
    'Entrada', 'Saída Almoço', 'Volta Almoço', 'Saída', 'Entrada Extra', 'Saída Extra'
  ];
  const nextPunchType = punchSequence[liveTodayPunches.length] || null;

  const handlePunchClick = () => {
    if (!nextPunchType) return;
    setPunchTimeToConfirm(new Date());
    setIsConfirmModalOpen(true);
    
    // Request Camera
    setCameraError('');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      .then(stream => {
        setMediaStream(stream);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      })
      .catch(err => {
        console.error("Camera error:", err);
        setCameraError('Câmera necessária para o registro.');
      });

    // Request GPS
    setLocation(null);
    setLocationError('');
    setIsGettingLocation(true);
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setIsGettingLocation(false);
        },
        (err) => {
          console.error("GPS error:", err);
          setLocationError('Localização necessária.');
          setIsGettingLocation(false);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    } else {
      setLocationError('GPS não suportado.');
      setIsGettingLocation(false);
    }
  };

  const closeConfirmModal = () => {
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      setMediaStream(null);
    }
    setIsConfirmModalOpen(false);
    setPunchTimeToConfirm(null);
  };

  const confirmPunch = () => {
    if (!nextPunchType || !punchTimeToConfirm || !location) return;

    let capturedPhoto = '';
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        capturedPhoto = canvas.toDataURL('image/jpeg', 0.8);
      }
    }

    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    const newPunch: TimePunch = {
      id: crypto.randomUUID(),
      time: punchTimeToConfirm.toISOString(),
      type: nextPunchType,
      location: location,
      photoUrl: capturedPhoto,
      device: isMobile ? 'Mobile' : 'Desktop'
    };

    const updatedPunches = [...liveTodayPunches, newPunch];
    let newStatus = liveTodayStatus;
    if (updatedPunches.length >= 4) {
      newStatus = 'Completo';
    }

    setLiveTodayPunches(updatedPunches);
    setLiveTodayStatus(newStatus);
    
    // If viewing current month, update the records list too
    if (selectedYear === new Date().getFullYear() && selectedMonth === new Date().getMonth()) {
      const newRecords = records.map(r => {
        if (r.date === todayStr) {
          return { ...r, punches: updatedPunches, status: newStatus };
        }
        return r;
      });
      setRecords(newRecords);
    }
    
    closeConfirmModal();
  };

  const openMaintenance = (recordId: string) => {
    setSelectedRecordId(recordId);
    setMaintenanceReason('');
    setMaintenanceModalOpen(true);
  };

  const submitMaintenance = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRecordId || !maintenanceReason) return;
    
    setRecords(records.map(r => {
      if (r.id === selectedRecordId) {
        return {
          ...r,
          maintenanceRequest: {
            reason: maintenanceReason,
            status: 'Pendente'
          }
        };
      }
      return r;
    }));
    
    setMaintenanceModalOpen(false);
  };

  // Math logic for hours
  const calculateTotalMs = (punches: TimePunch[]): number => {
    if (punches.length < 2) return 0;
    
    let totalMs = 0;
    
    if (punches[0] && punches[1]) {
      totalMs += new Date(punches[1].time).getTime() - new Date(punches[0].time).getTime();
    }
    if (punches[2] && punches[3]) {
      totalMs += new Date(punches[3].time).getTime() - new Date(punches[2].time).getTime();
    }
    if (punches[4] && punches[5]) {
      totalMs += new Date(punches[5].time).getTime() - new Date(punches[4].time).getTime();
    }
    return totalMs;
  };

  const calculateTotalHours = (punches: TimePunch[]): string => {
    const totalMs = calculateTotalMs(punches);
    if (totalMs === 0) return '00:00';
    
    const totalMins = Math.floor(totalMs / 60000);
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  };

  // Month Summary Logic
  const getMonthSummary = () => {
    let totalMs = 0;
    let expectedMs = 0; // 8 hours per workday (excluding Folga/Feriado)
    let extraMs = 0;
    let missingMs = 0;
    
    records.forEach(r => {
      // Workday means it's not Folga
      if (r.status !== 'Folga' && r.status !== 'Feriado') {
        const expectedDayMs = 8 * 60 * 60 * 1000;
        expectedMs += expectedDayMs;
        
        const dayMs = calculateTotalMs(r.punches);
        totalMs += dayMs;
        
        if (dayMs > expectedDayMs) {
          extraMs += (dayMs - expectedDayMs);
        } else if (dayMs < expectedDayMs && r.date < todayStr) {
          // Only calculate missing hours for past days
          missingMs += (expectedDayMs - dayMs);
        }
      }
    });

    const formatMsToHours = (ms: number) => {
      const totalMins = Math.floor(Math.abs(ms) / 60000);
      const hrs = Math.floor(totalMins / 60);
      const mins = totalMins % 60;
      return `${ms < 0 ? '-' : ''}${hrs.toString().padStart(2, '0')}h${mins.toString().padStart(2, '0')}m`;
    };

    return {
      total: formatMsToHours(totalMs),
      expected: formatMsToHours(expectedMs),
      extra: formatMsToHours(extraMs),
      missing: formatMsToHours(missingMs)
    };
  };

  const summary = getMonthSummary();

  const formatTimeOnly = (isoStr: string) => {
    return new Date(isoStr).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDateLabel = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00'); // Force midday to avoid timezone shift
    return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Completo': return 'bg-green-500/10 text-green-600 border-green-500/20';
      case 'Incompleto': return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20';
      case 'Falta': return 'bg-red-500/10 text-red-600 border-red-500/20';
      case 'Folga': return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
      default: return 'bg-secondary text-muted border-border';
    }
  };

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
            {nextPunchType ? (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handlePunchClick}
                className="w-full py-5 rounded-2xl text-white font-bold text-lg shadow-lg shadow-primary/25 bg-primary hover:bg-primary/90 transition-all flex flex-col items-center justify-center gap-1"
              >
                <span>Registrar {nextPunchType}</span>
                <span className="text-xs font-medium text-white/70">Clique para capturar o horário</span>
              </motion.button>
            ) : (
              <div className="w-full py-5 rounded-2xl bg-green-500/10 border border-green-500/20 text-green-600 font-bold flex flex-col items-center justify-center gap-1">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={20} />
                  <span>Jornada Completa</span>
                </div>
                <span className="text-xs font-medium text-green-600/70">Bom descanso!</span>
              </div>
            )}
          </div>

          <div className="w-full bg-secondary/10 border border-border/50 rounded-2xl p-5 flex-1 flex flex-col relative z-10 min-h-[250px]">
            <h3 className="text-sm font-bold text-foreground mb-4 text-left flex items-center justify-between">
              Marcações de Hoje
              <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full text-xs font-bold">{liveTodayPunches.length}/6</span>
            </h3>
            {liveTodayPunches.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-sm text-muted italic opacity-70">
                <Clock size={24} className="mb-2 opacity-20" />
                Nenhuma marcação ainda.
              </div>
            ) : (
              <div className="space-y-3 overflow-y-auto custom-scrollbar pr-2 flex-1">
                {liveTodayPunches.map((p) => (
                  <div 
                    key={p.id} 
                    className="flex justify-between items-center text-sm group bg-background/50 p-2.5 rounded-xl border border-border/40 hover:border-border hover:shadow-sm cursor-pointer transition-all"
                    onClick={() => setSelectedPunchDetail(p)}
                  >
                    <span className="text-foreground/80 font-medium flex items-center gap-2.5">
                      <div className="w-2 h-2 rounded-full bg-primary/40 group-hover:bg-primary transition-colors"></div>
                      {p.type}
                    </span>
                    <div className="flex items-center gap-3">
                      {/* Indicadores Visuais */}
                      <div className="flex gap-1.5 opacity-40 group-hover:opacity-100 transition-opacity">
                        {p.photoUrl && <Camera size={14} className="text-muted group-hover:text-primary transition-colors" />}
                        {p.location && <MapPin size={14} className="text-muted group-hover:text-primary transition-colors" />}
                      </div>
                      <span className="font-mono font-bold text-foreground bg-background px-3 py-1.5 rounded-lg border border-border shadow-sm text-xs">
                        {formatTimeOnly(p.time)}
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
            
            {/* Month/Year Selectors */}
            <div className="flex gap-2 w-full md:w-auto">
              <div className="relative flex-1 md:flex-none">
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(Number(e.target.value))}
                  className="w-full md:w-40 appearance-none bg-background border border-border rounded-xl px-4 py-2 pr-10 text-sm font-medium focus:outline-none focus:border-primary transition-colors cursor-pointer text-foreground"
                >
                  {['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'].map((m, i) => (
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
                  {[today.getFullYear() - 2, today.getFullYear() - 1, today.getFullYear()].map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
                <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              </div>
            </div>
          </div>
          
          <div className="flex-1 overflow-auto custom-scrollbar p-5">
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
                {records.map(record => (
                  <tr key={record.id} className="hover:bg-secondary/5 transition-colors">
                    <td className="py-4">
                      <div className="font-medium text-sm text-foreground capitalize">{formatDateLabel(record.date)}</div>
                    </td>
                    <td className="py-4 text-center">
                      {record.punches.length > 0 ? (
                        <div className="flex items-center justify-center flex-wrap gap-1">
                          {record.punches.map((p) => (
                            <span key={p.id} className="text-xs font-mono bg-secondary/50 text-foreground px-1.5 py-0.5 rounded border border-border" title={p.type}>
                              {formatTimeOnly(p.time)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted">-</span>
                      )}
                    </td>
                    <td className="py-4 text-center">
                      <span className="font-bold text-foreground">{calculateTotalHours(record.punches)}</span>
                    </td>
                    <td className="py-4 text-center">
                      <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium border ${getStatusColor(record.status)}`}>
                        {record.status}
                      </span>
                      {record.maintenanceRequest && (
                        <div className="text-[10px] mt-1 text-orange-500 font-medium">Ajuste Pendente</div>
                      )}
                    </td>
                    <td className="py-4 text-right">
                      <button
                        onClick={() => openMaintenance(record.id)}
                        disabled={!!record.maintenanceRequest}
                        className="text-xs font-medium text-primary hover:text-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Solicitar Ajuste
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Bottom Section: Journey Summary */}
      <div className="mt-6 shrink-0">
        <h2 className="text-lg font-heading font-bold text-foreground mb-4 flex items-center gap-2">
          <Activity size={20} className="text-primary" />
          Jornada do Mês ({['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'][selectedMonth]})
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-panel border border-border rounded-2xl p-5 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Clock size={24} className="text-primary" />
            </div>
            <div>
              <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Total Trabalhado</p>
              <p className="text-2xl font-heading font-bold text-foreground">{summary.total}</p>
            </div>
          </div>
          
          <div className="bg-panel border border-border rounded-2xl p-5 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-secondary/50 flex items-center justify-center shrink-0">
              <Calendar size={24} className="text-foreground/70" />
            </div>
            <div>
              <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Horas Esperadas</p>
              <p className="text-2xl font-heading font-bold text-foreground">{summary.expected}</p>
            </div>
          </div>

          <div className="bg-panel border border-border rounded-2xl p-5 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
              <UserCheck size={24} className="text-green-600" />
            </div>
            <div>
              <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Horas Extras</p>
              <p className="text-2xl font-heading font-bold text-green-600">{summary.extra}</p>
            </div>
          </div>

          <div className="bg-panel border border-border rounded-2xl p-5 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
              <AlertTriangle size={24} className="text-red-600" />
            </div>
            <div>
              <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Horas Faltantes</p>
              <p className="text-2xl font-heading font-bold text-red-600">{summary.missing}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Maintenance Drawer */}
      {maintenanceModalOpen && createPortal(
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
                initial={{ x: "100%", opacity: 0.5 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: "100%", opacity: 0.5 }}
                transition={{ type: "spring", damping: 30, stiffness: 300 }}
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
                    <p>Você está solicitando ajuste para o dia <strong>{records.find(r => r.id === selectedRecordId)?.date.split('-').reverse().join('/')}</strong>.</p>
                    <p className="mt-1 text-xs opacity-80">Sua solicitação será analisada pelo RH.</p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">Descreva a solicitação *</label>
                    <textarea
                      required
                      value={maintenanceReason}
                      onChange={(e) => setMaintenanceReason(e.target.value)}
                      placeholder="Ex: Esqueci de bater o ponto na saída, saí às 18:00..."
                      className="w-full bg-background border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary text-foreground transition-colors min-h-[120px] resize-none"
                    />
                  </div>
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
                    className="flex-1 py-3.5 bg-primary hover:bg-primary/90 text-white rounded-xl text-sm font-bold transition-colors shadow-lg shadow-primary/20"
                  >
                    Enviar Solicitação
                  </button>
                </div>
              </motion.div>
            </div>
          </>
        </AnimatePresence>,
        document.body
      )}

      {/* Confirmation Modal */}
      {isConfirmModalOpen && createPortal(
        <AnimatePresence>
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsConfirmModalOpen(false)}
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
                    {punchTimeToConfirm?.toLocaleTimeString('pt-BR')}
                  </div>
                  <p className="text-foreground/80 mb-6 text-sm font-medium">
                    Marcando: <strong>{nextPunchType}</strong>
                  </p>

                  <div className="w-full max-w-[240px] aspect-[3/4] bg-secondary/20 rounded-2xl border-2 border-border overflow-hidden relative shadow-inner mb-4 flex items-center justify-center">
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
                  </div>

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
                  
                  {/* Hidden Canvas to draw image */}
                  <canvas ref={canvasRef} className="hidden" />
                </div>

                <div className="p-5 border-t border-border bg-secondary/10 flex gap-3">
                  <button
                    type="button"
                    onClick={closeConfirmModal}
                    className="flex-1 py-3 rounded-xl font-medium border border-border text-foreground hover:bg-secondary transition-colors text-sm"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={confirmPunch}
                    disabled={!mediaStream || !location || isGettingLocation}
                    className="flex-1 py-3 bg-primary hover:bg-primary/90 disabled:bg-primary/50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-bold transition-colors shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
                  >
                    {(!mediaStream || !location) ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                    {(!mediaStream || !location) ? 'Aguardando' : 'Registrar'}
                  </button>
                </div>
              </motion.div>
            </div>
          </>
        </AnimatePresence>,
        document.body
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
                    <span className="font-bold text-lg text-primary">{selectedPunchDetail.type}</span>
                    <span className="font-mono font-bold text-foreground bg-secondary px-3 py-1 rounded-lg border border-border">
                      {formatTimeOnly(selectedPunchDetail.time)}
                    </span>
                  </div>

                  {selectedPunchDetail.photoUrl ? (
                    <div className="w-full aspect-square bg-secondary/20 rounded-xl border-2 border-border overflow-hidden mb-4 relative">
                      <img src={selectedPunchDetail.photoUrl} alt="Foto de Ponto" className="w-full h-full object-cover" />
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
                        {selectedPunchDetail.location ? (
                          <p className="text-muted font-mono text-[11px] truncate">
                            {selectedPunchDetail.location.lat.toFixed(6)}, {selectedPunchDetail.location.lng.toFixed(6)}
                          </p>
                        ) : (
                          <p className="text-muted text-xs italic">Não registrada</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-sm">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                        {selectedPunchDetail.device === 'Mobile' ? <Smartphone size={16} /> : <Monitor size={16} />}
                      </div>
                      <div>
                        <p className="font-semibold text-foreground text-xs uppercase tracking-wider mb-0.5">Dispositivo</p>
                        <p className="text-muted text-xs">
                          {selectedPunchDetail.device || 'Desconhecido'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          </>
        </AnimatePresence>,
        document.body
      )}

    </div>
  );
};

export default TimeTracking;
