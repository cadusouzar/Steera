import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import confetti from 'canvas-confetti';
import {
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
  X,
  TrendingUp,
  Landmark,
  Calendar,
  Building2,
  Utensils,
  Zap,
  Briefcase,
  MonitorPlay,
  ShoppingCart,
  Target,
  AlertCircle,
  Trash2,
  Edit2
} from 'lucide-react';

// --- Types & Interfaces ---

interface BaseItem {
  id: string;
  title: string;
  amount: number;
  category: string;
  date: string;
  icon?: React.ReactNode;
}

interface IncomeItem extends BaseItem {
  bank: string;
}

interface ExpenseItem extends BaseItem {
  bank: string;
}

interface FixedBillItem extends BaseItem {}

interface InvestmentItem extends BaseItem {
  bank: string;
  type: string; // CDB, LCI, Ações, etc.
  expectedReturn?: number; // % ao ano
}

// --- Mock Data ---

const initialIncomes: IncomeItem[] = [
  { id: 'i1', title: 'Salário Mensal', amount: 8500, category: 'Salário', date: '2023-11-05', bank: 'Itaú', icon: <Briefcase size={16}/> },
  { id: 'i2', title: 'Vale Refeição', amount: 800, category: 'Benefício', date: '2023-11-06', bank: 'Caju', icon: <Utensils size={16}/> },
];

const initialExpenses: ExpenseItem[] = [
  { id: 'e1', title: 'Netflix', amount: 55.9, category: 'Entretenimento', date: '2023-11-10', bank: 'Nubank', icon: <MonitorPlay size={16}/> },
  { id: 'e2', title: 'Supermercado', amount: 850, category: 'Alimentação', date: '2023-11-12', bank: 'Itaú', icon: <ShoppingCart size={16}/> },
];

const initialFixedBills: FixedBillItem[] = [
  { id: 'f1', title: 'Aluguel Escritório', amount: 2500, category: 'Moradia', date: 'Todo dia 05', icon: <Building2 size={16}/> },
  { id: 'f2', title: 'Conta de Energia', amount: 350, category: 'Utilidades', date: 'Todo dia 15', icon: <Zap size={16}/> },
];

const initialInvestments: InvestmentItem[] = [
  { id: 'inv1', title: 'Reserva de Emergência', amount: 15000, category: 'Renda Fixa', date: '2023-01-10', bank: 'Nubank', type: 'CDB 100% CDI', expectedReturn: 10.5, icon: <Landmark size={16}/> },
  { id: 'inv2', title: 'Ações BR', amount: 4500, category: 'Renda Variável', date: '2023-05-22', bank: 'XP', type: 'Ações', expectedReturn: 12.0, icon: <TrendingUp size={16}/> },
];

export default function FinancesSaaS() {
  const [incomes, setIncomes] = useState<IncomeItem[]>(initialIncomes);
  const [expenses, setExpenses] = useState<ExpenseItem[]>(initialExpenses);
  const [fixedBills, setFixedBills] = useState<FixedBillItem[]>(initialFixedBills);
  const [investments, setInvestments] = useState<InvestmentItem[]>(initialInvestments);

  // Modals state
  const [activeModal, setActiveModal] = useState<'NONE' | 'INCOME' | 'EXPENSE' | 'FIXED' | 'INVESTMENT'>('NONE');
  
  // UX State
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Goals State
  const [reserveGoal, setReserveGoal] = useState<number>(30000);
  const [isEditingGoal, setIsEditingGoal] = useState(false);

  // Form State
  const [formData, setFormData] = useState({ 
    title: '', 
    amount: '', 
    category: 'Outros', 
    bank: 'Nubank', 
    recurrence: 'Todo dia 05 do mês',
    paymentMethod: 'Cartão de Crédito',
    expectedReturn: '10'
  });

  // ESC Listener
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveModal('NONE');
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  const handleSaveTransaction = () => {
    if (!formData.title || !formData.amount) return;
    
    const val = parseFloat(formData.amount);
    const newId = Date.now().toString();
    const today = new Date().toISOString().split('T')[0];

    if (activeModal === 'INCOME') {
      setIncomes([{ id: newId, title: formData.title, amount: val, category: formData.category, date: today, bank: formData.bank, icon: <ArrowUpRight size={16}/> }, ...incomes]);
    } else if (activeModal === 'EXPENSE') {
      setExpenses([{ id: newId, title: formData.title, amount: val, category: formData.category, date: today, bank: formData.paymentMethod, icon: <ArrowDownRight size={16}/> }, ...expenses]);
    } else if (activeModal === 'FIXED') {
      setFixedBills([{ id: newId, title: formData.title, amount: val, category: formData.category, date: formData.recurrence, icon: <Calendar size={16}/> }, ...fixedBills]);
    } else if (activeModal === 'INVESTMENT') {
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#4f46e5', '#818cf8', '#10b981', '#fbbf24', '#ffffff']
      });
      setInvestments([{ 
        id: newId, 
        title: formData.title, 
        amount: val, 
        category: formData.category, 
        date: today, 
        bank: formData.bank, 
        type: 'Aporte Manual', 
        expectedReturn: parseFloat(formData.expectedReturn) || 0,
        icon: <Wallet size={16}/> 
      }, ...investments]);
    }

    setActiveModal('NONE');
    setFormData({ title: '', amount: '', category: 'Outros', bank: 'Nubank', recurrence: 'Todo dia 05 do mês', paymentMethod: 'Cartão de Crédito', expectedReturn: '10' });
  };

  // Calculations
  const totalIncomes = incomes.reduce((acc, curr) => acc + curr.amount, 0);
  const rawExpenses = expenses.reduce((acc, curr) => acc + curr.amount, 0);
  const totalFixedBills = fixedBills.reduce((acc, curr) => acc + curr.amount, 0);
  const totalExpenses = rawExpenses + totalFixedBills;
  
  const currentBalance = totalIncomes - totalExpenses;
  
  const totalInvested = investments.reduce((acc, curr) => acc + curr.amount, 0);

  // Projections Logic (Compound Interest)
  const yearsToProject = 6;
  const projections = useMemo(() => {
    const today = new Date();
    
    // Base point (Year 0 / Today)
    const basePoint = {
      label: 'Hoje',
      year: today.getFullYear(),
      amount: totalInvested
    };
    
    const futurePoints = Array.from({ length: yearsToProject }).map((_, yearIndex) => {
      const yearOffset = yearIndex + 1;
      let totalForYear = 0;
      investments.forEach(inv => {
        const rate = (inv.expectedReturn || 0) / 100;
        totalForYear += inv.amount * Math.pow(1 + rate, yearOffset);
      });
      
      const targetDate = new Date(today);
      targetDate.setFullYear(today.getFullYear() + yearOffset);
      
      // Formats like "jul/2026"
      const month = targetDate.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
      const label = `${month}/${targetDate.getFullYear()}`;
      
      return { 
        label,
        year: targetDate.getFullYear(), 
        amount: totalForYear 
      };
    });
    
    return [basePoint, ...futurePoints];
  }, [investments, totalInvested]);

  const maxProjection = projections.length > 0 ? projections[projections.length - 1].amount : 0;
  const projectedProfit = maxProjection - totalInvested;

  // Visual Progress for the Center Circle
  const fillPercentage = (totalIncomes + totalExpenses) === 0 ? 0 : (totalIncomes / (totalIncomes + totalExpenses)) * 100;

  // Goals & Bills Logic
  const goalProgress = reserveGoal > 0 ? Math.min(100, Math.max(0, (totalInvested / reserveGoal) * 100)) : 0;

  const getDaysUntilDue = (dateStr: string) => {
    if (!dateStr) return null;
    const match = dateStr.match(/\d+/);
    if (!match) return null;
    const day = parseInt(match[0], 10);
    const today = new Date();
    const currentDay = today.getDate();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    
    let targetDate = new Date(currentYear, currentMonth, day);
    if (day < currentDay) {
      targetDate = new Date(currentYear, currentMonth + 1, day);
    }
    
    const diffTime = targetDate.getTime() - today.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const dueSoonBills = fixedBills.filter(f => {
    const days = getDaysUntilDue(f.date);
    return days !== null && days <= 5;
  });
  const dueTodayCount = dueSoonBills.filter(f => getDaysUntilDue(f.date) === 0).length;
  const dueSoonTotal = dueSoonBills.reduce((acc, curr) => acc + curr.amount, 0);

  const handleDelete = (type: 'INCOME' | 'EXPENSE' | 'FIXED' | 'INVESTMENT', id: string) => {
    if (type === 'INCOME') setIncomes(prev => prev.filter(i => i.id !== id));
    if (type === 'EXPENSE') setExpenses(prev => prev.filter(i => i.id !== id));
    if (type === 'FIXED') setFixedBills(prev => prev.filter(i => i.id !== id));
    if (type === 'INVESTMENT') setInvestments(prev => prev.filter(i => i.id !== id));
  };

  // --- Helpers ---
  const formatCurrency = (val: number) => 
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  return (
    <div className="p-4 md:p-8 h-full overflow-y-auto custom-scrollbar flex flex-col gap-6 md:gap-8 bg-background relative">
      
      {/* BACKGROUND ELEMENTS */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] bg-primary/5 rounded-[100%] blur-3xl pointer-events-none" />

      {/* 1. HEADER & CENTRAL BALANCE */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center relative z-10 pt-4 pb-8">
        
        {/* LEFT COLUMN: Métricas do Mês */}
        <div className="hidden md:flex flex-col gap-4">
           <div className="bg-panel border border-border p-4 rounded-3xl shadow-sm hover:border-green-500/30 transition-colors">
              <p className="text-sm text-muted font-semibold mb-2">Entradas no Mês</p>
              <div className="flex justify-between items-end">
                 <h3 className="font-heading font-bold text-2xl text-green-500">R$ 12.450,00</h3>
                 <div className="flex flex-col items-end">
                   <span className="text-[10px] font-bold bg-green-500/10 text-green-500 px-2 py-1 rounded-lg flex items-center gap-1">
                      <ArrowUpRight size={12}/> +12%
                   </span>
                   <span className="text-[9px] text-muted font-medium mt-1">vs mês anterior</span>
                 </div>
              </div>
           </div>
           
           <div className="bg-panel border border-border p-4 rounded-3xl shadow-sm hover:border-red-500/30 transition-colors">
              <p className="text-sm text-muted font-semibold mb-2">Saídas no Mês</p>
              <div className="flex justify-between items-end">
                 <h3 className="font-heading font-bold text-2xl text-red-500">R$ 4.055,90</h3>
                 <div className="flex flex-col items-end">
                   <span className="text-[10px] font-bold bg-red-500/10 text-red-500 px-2 py-1 rounded-lg flex items-center gap-1">
                      <ArrowDownRight size={12}/> -5%
                   </span>
                   <span className="text-[9px] text-muted font-medium mt-1">vs mês anterior</span>
                 </div>
              </div>
           </div>
        </div>

        {/* CENTER COLUMN: Saldo */}
        <div className="flex flex-col items-center justify-center relative z-20">
          <p className="text-muted font-semibold tracking-widest uppercase text-xs mb-3">Saldo Disponível</p>
          <div className="relative group">
            <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl group-hover:bg-primary/30 transition-all duration-500"></div>

            {/* Central Circle */}
            <motion.div 
              className="w-44 h-44 md:w-52 md:h-52 rounded-full bg-panel border-4 border-background flex flex-col items-center justify-center relative z-10 shadow-2xl overflow-hidden"
              whileHover={{ scale: 1.05 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            >
              <style>{`
                @keyframes slide-wave {
                  0% { transform: translateX(0); }
                  100% { transform: translateX(-50%); }
                }
              `}</style>
              {/* Internal Liquid Base with SVG Waves */}
              <motion.div 
                className="absolute bottom-0 left-0 right-0 z-0 pointer-events-none"
                initial={false}
                animate={{ height: `${fillPercentage}%` }}
                transition={{ duration: 1.5, type: 'spring', bounce: 0.2 }}
              >
                {/* Layer 1 (Back, Slower, Lighter) */}
                <div className="absolute inset-0 opacity-[0.08]">
                  <div 
                    className="absolute w-[200%] h-[20px] left-0"
                    style={{
                      top: '-19px',
                      background: `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" viewBox="0 0 1600 88.7"><path d="M0,44.3 C200,44.3 200,88.7 400,88.7 C600,88.7 600,44.3 800,44.3 C1000,44.3 1000,88.7 1200,88.7 C1400,88.7 1400,44.3 1600,44.3 L1600,88.7 L0,88.7 Z" fill="%2310b981"/></svg>')`,
                      backgroundSize: '100% 100%',
                      animation: 'slide-wave 6s linear infinite'
                    }}
                  />
                  <div className="absolute inset-0 bg-[#10b981] -top-[1px]" />
                </div>

                {/* Layer 2 (Front, Faster, Darker) */}
                <div className="absolute inset-0 opacity-[0.15]">
                  <div 
                    className="absolute w-[200%] h-[24px] left-0"
                    style={{
                      top: '-23px',
                      background: `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" viewBox="0 0 1600 88.7"><path d="M0,44.3 C200,44.3 200,0 400,0 C600,0 600,44.3 800,44.3 C1000,44.3 1000,0 1200,0 C1400,0 1400,44.3 1600,44.3 L1600,88.7 L0,88.7 Z" fill="%2310b981"/></svg>')`,
                      backgroundSize: '100% 100%',
                      animation: 'slide-wave 4s linear infinite'
                    }}
                  />
                  <div className="absolute inset-0 bg-[#10b981] -top-[1px]" />
                </div>
              </motion.div>

              {/* Text / Value */}
              <div className="relative z-10 flex flex-col items-center drop-shadow-md">
                <h1 className="text-3xl md:text-4xl font-heading font-extrabold text-foreground tracking-tight flex items-center justify-center gap-1.5 whitespace-nowrap">
                  <span className="text-primary text-xl">R$</span>
                  <motion.span
                    key={currentBalance}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className={currentBalance < 0 ? "text-red-500" : currentBalance > 0 ? "text-primary" : "text-foreground"}
                  >
                    {currentBalance < 0 ? '-' : ''}{formatCurrency(Math.abs(currentBalance)).replace('R$', '').trim()}
                  </motion.span>
                </h1>
              </div>
            </motion.div>
          </div>
        </div>

        {/* RIGHT COLUMN: Metas e Alertas */}
        <div className="hidden md:flex flex-col gap-4">
           {/* Goal Progress */}
           <div className="bg-panel border border-border p-5 rounded-3xl shadow-sm hover:border-primary/30 transition-colors group relative">
              <div className="flex justify-between items-center mb-3">
                 <p className="text-sm font-bold text-foreground flex items-center gap-2">
                    <Target size={16} className="text-primary"/> Meta: Reserva
                    <button 
                      onClick={() => setIsEditingGoal(!isEditingGoal)} 
                      className="text-muted hover:text-primary transition-colors opacity-0 group-hover:opacity-100 p-1"
                    >
                      <Edit2 size={12} />
                    </button>
                 </p>
                 <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-1 rounded-md">{goalProgress.toFixed(0)}%</span>
              </div>

              {isEditingGoal ? (
                 <div className="mb-3 flex items-center gap-2">
                    <input 
                      type="number" 
                      autoFocus
                      value={reserveGoal || ''} 
                      onChange={(e) => setReserveGoal(Number(e.target.value))}
                      onBlur={() => setIsEditingGoal(false)}
                      onKeyDown={(e) => e.key === 'Enter' && setIsEditingGoal(false)}
                      className="bg-background border border-border rounded-lg px-2 py-1 text-sm w-full outline-none focus:border-primary"
                    />
                 </div>
              ) : (
                 <div className="w-full bg-secondary/50 rounded-full h-2.5 mb-3 overflow-hidden cursor-pointer" onClick={() => setIsEditingGoal(true)}>
                    <div className="bg-primary h-full rounded-full relative transition-all duration-1000" style={{ width: `${goalProgress}%` }}>
                       <div className="absolute inset-0 bg-white/20 w-full h-full animate-[shimmer_2s_infinite]"></div>
                    </div>
                 </div>
              )}
              
              <p className="text-[10px] font-semibold text-muted flex justify-between">
                 <span>{formatCurrency(totalInvested)} guardados</span>
                 <span>Alvo: {formatCurrency(reserveGoal)}</span>
              </p>
           </div>

           {/* Alert */}
           {dueSoonBills.length > 0 && (
             <div className="bg-amber-500/5 border border-amber-500/20 p-4 rounded-3xl shadow-sm">
                <div className="flex items-start gap-3">
                   <AlertCircle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                   <div>
                      <p className="text-sm font-bold text-amber-600 dark:text-amber-400">
                        {dueTodayCount > 0 ? `${dueTodayCount} conta(s) vence(m) hoje` : `${dueSoonBills.length} conta(s) vencendo em breve`}
                      </p>
                      <p className="text-xs font-medium text-amber-600/70 dark:text-amber-400/70 mt-1">
                        Total: {formatCurrency(dueSoonTotal)}. Pague agora para evitar juros.
                      </p>
                   </div>
                </div>
             </div>
           )}
        </div>

      </div>

      {/* 2. MIDDLE ROW: Bento Grid for Flow */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 relative z-10">
        
        {/* DESPESAS DO MES */}
        <div className="bg-panel border border-border rounded-[2rem] shadow-sm flex flex-col overflow-hidden h-[400px]">
          <div className="p-5 border-b border-border flex justify-between items-center bg-red-500/5">
            <h2 className="font-bold text-foreground flex items-center gap-2">
              <ArrowDownRight className="text-red-500" size={20} />
              Despesas do Mês
            </h2>
            <button 
              onClick={() => setActiveModal('EXPENSE')}
              className="w-8 h-8 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-transform hover:scale-110 shadow-lg shadow-red-500/20"
            >
              <Plus size={18} />
            </button>
          </div>
          <div className="p-4 flex-1 overflow-y-auto custom-scrollbar space-y-3">
            {expenses.map(e => (
              <div key={e.id} className="group/item flex items-center justify-between p-3 rounded-2xl bg-background border border-border hover:border-red-500/30 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-red-500/10 text-red-500 flex items-center justify-center shrink-0">
                    {e.icon || <ArrowDownRight size={18}/>}
                  </div>
                  <div className="min-w-0 pr-2">
                    <p className="font-bold text-sm text-foreground truncate">{e.title}</p>
                    <p className="text-xs text-muted font-medium truncate">{e.category} • {e.bank}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <p className="font-bold text-red-500 text-sm">-{formatCurrency(e.amount)}</p>
                  <button 
                    onClick={() => {
                      if (confirmDeleteId === e.id) {
                        handleDelete('EXPENSE', e.id);
                        setConfirmDeleteId(null);
                      } else {
                        setConfirmDeleteId(e.id);
                      }
                    }}
                    onMouseLeave={() => confirmDeleteId === e.id && setConfirmDeleteId(null)}
                    className={`h-7 rounded-lg flex items-center justify-center transition-all shadow-sm overflow-hidden ${
                      confirmDeleteId === e.id 
                      ? 'bg-red-600 text-white px-2 w-auto' 
                      : 'w-7 bg-red-500/10 text-red-500 opacity-0 group-hover/item:opacity-100 hover:bg-red-500 hover:text-white'
                    }`}
                  >
                    {confirmDeleteId === e.id ? <span className="text-[10px] font-bold uppercase tracking-wider">Confirmar</span> : <Trash2 size={14} />}
                  </button>
                </div>
              </div>
            ))}
            {expenses.length === 0 && <p className="text-center text-muted text-sm mt-10">Nenhuma despesa registrada.</p>}
          </div>
          <div className="p-4 border-t border-border bg-background/50 flex justify-between items-center">
            <span className="text-sm font-semibold text-muted">Total:</span>
            <span className="text-lg font-bold text-red-500">{formatCurrency(totalExpenses)}</span>
          </div>
        </div>

        {/* VALORES RECEBIDOS */}
        <div className="bg-panel border border-border rounded-[2rem] shadow-sm flex flex-col overflow-hidden h-[400px]">
          <div className="p-5 border-b border-border flex justify-between items-center bg-green-500/5">
            <h2 className="font-bold text-foreground flex items-center gap-2">
              <ArrowUpRight className="text-green-500" size={20} />
              Valores Recebidos
            </h2>
            <button 
              onClick={() => setActiveModal('INCOME')}
              className="w-8 h-8 rounded-full bg-green-500 text-white flex items-center justify-center hover:bg-green-600 transition-transform hover:scale-110 shadow-lg shadow-green-500/20"
            >
              <Plus size={18} />
            </button>
          </div>
          <div className="p-4 flex-1 overflow-y-auto custom-scrollbar space-y-3">
            {incomes.map(i => (
              <div key={i.id} className="group/item flex items-center justify-between p-3 rounded-2xl bg-background border border-border hover:border-green-500/30 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-green-500/10 text-green-500 flex items-center justify-center shrink-0">
                    {i.icon || <ArrowUpRight size={18}/>}
                  </div>
                  <div className="min-w-0 pr-2">
                    <p className="font-bold text-sm text-foreground truncate">{i.title}</p>
                    <p className="text-xs text-muted font-medium truncate">{i.category} • {i.bank}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <p className="font-bold text-green-500 text-sm">+{formatCurrency(i.amount)}</p>
                  <button 
                    onClick={() => {
                      if (confirmDeleteId === i.id) {
                        handleDelete('INCOME', i.id);
                        setConfirmDeleteId(null);
                      } else {
                        setConfirmDeleteId(i.id);
                      }
                    }}
                    onMouseLeave={() => confirmDeleteId === i.id && setConfirmDeleteId(null)}
                    className={`h-7 rounded-lg flex items-center justify-center transition-all shadow-sm overflow-hidden ${
                      confirmDeleteId === i.id 
                      ? 'bg-red-600 text-white px-2 w-auto' 
                      : 'w-7 bg-green-500/10 text-green-500 opacity-0 group-hover/item:opacity-100 hover:bg-red-500 hover:text-white'
                    }`}
                  >
                    {confirmDeleteId === i.id ? <span className="text-[10px] font-bold uppercase tracking-wider">Confirmar</span> : <Trash2 size={14} />}
                  </button>
                </div>
              </div>
            ))}
            {incomes.length === 0 && <p className="text-center text-muted text-sm mt-10">Nenhuma entrada registrada.</p>}
          </div>
          <div className="p-4 border-t border-border bg-background/50 flex justify-between items-center">
            <span className="text-sm font-semibold text-muted">Total:</span>
            <span className="text-lg font-bold text-green-500">{formatCurrency(totalIncomes)}</span>
          </div>
        </div>

        {/* CONTAS FIXAS */}
        <div className="bg-panel border border-border rounded-[2rem] shadow-sm flex flex-col overflow-hidden h-[400px]">
          <div className="p-5 border-b border-border flex justify-between items-center bg-secondary/30">
            <h2 className="font-bold text-foreground flex items-center gap-2">
              <Calendar className="text-primary" size={20} />
              Contas Fixas
            </h2>
            <button 
              onClick={() => setActiveModal('FIXED')}
              className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-transform hover:scale-110 shadow-lg shadow-primary/20"
            >
              <Plus size={18} />
            </button>
          </div>
          <div className="p-4 flex-1 overflow-y-auto custom-scrollbar space-y-3">
            {fixedBills.map(f => (
              <div key={f.id} className="group/item flex items-center justify-between p-3 rounded-2xl bg-background border border-border hover:border-primary/30 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    {f.icon || <Calendar size={18}/>}
                  </div>
                  <div className="min-w-0 pr-2">
                    <p className="font-bold text-sm text-foreground truncate">{f.title}</p>
                    <p className="text-xs text-muted font-medium truncate flex items-center gap-1.5">
                      {f.date}
                      {(() => {
                        const days = getDaysUntilDue(f.date);
                        if (days === null) return null;
                        if (days === 0) return <span className="text-amber-500 font-bold">• Vence hoje</span>;
                        if (days === 1) return <span className="text-amber-500 font-medium">• Vence amanhã</span>;
                        if (days <= 5) return <span className="text-amber-500/80 font-medium">• Vence em {days} dias</span>;
                        return <span className="text-muted/70">• Faltam {days} dias</span>;
                      })()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <p className="font-bold text-foreground text-sm">{formatCurrency(f.amount)}</p>
                  <button 
                    onClick={() => {
                      if (confirmDeleteId === f.id) {
                        handleDelete('FIXED', f.id);
                        setConfirmDeleteId(null);
                      } else {
                        setConfirmDeleteId(f.id);
                      }
                    }}
                    onMouseLeave={() => confirmDeleteId === f.id && setConfirmDeleteId(null)}
                    className={`h-7 rounded-lg flex items-center justify-center transition-all shadow-sm overflow-hidden ${
                      confirmDeleteId === f.id 
                      ? 'bg-red-600 text-white px-2 w-auto' 
                      : 'w-7 bg-primary/10 text-primary opacity-0 group-hover/item:opacity-100 hover:bg-red-500 hover:text-white'
                    }`}
                  >
                    {confirmDeleteId === f.id ? <span className="text-[10px] font-bold uppercase tracking-wider">Confirmar</span> : <Trash2 size={14} />}
                  </button>
                </div>
              </div>
            ))}
            {fixedBills.length === 0 && <p className="text-center text-muted text-sm mt-10">Nenhuma conta fixa.</p>}
          </div>
          <div className="p-4 border-t border-border bg-background/50 flex justify-between items-center">
            <span className="text-sm font-semibold text-muted">Total de Contas Fixas:</span>
            <span className="text-lg font-bold text-primary">{formatCurrency(totalFixedBills)}</span>
          </div>
        </div>

      </div>

      {/* 3. BOTTOM ROW: Investments & Projection */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 relative z-10 pb-8">
        
        {/* INVESTIMENTOS */}
        <div className="bg-panel border border-border rounded-3xl shadow-sm flex flex-col overflow-hidden h-[350px]">
          <div className="p-5 border-b border-border flex justify-between items-center bg-foreground/5">
            <h2 className="font-bold text-foreground flex items-center gap-2">
              <Wallet className="text-foreground" size={20} />
              Investimentos
            </h2>
            <button 
              onClick={() => setActiveModal('INVESTMENT')}
              className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-transform hover:scale-110 shadow-lg shadow-primary/20"
            >
              <Plus size={18} />
            </button>
          </div>
          <div className="p-4 flex-1 overflow-y-auto custom-scrollbar grid grid-cols-1 md:grid-cols-2 gap-4 auto-rows-max">
            {investments.map(inv => (
              <div key={inv.id} className="group/item p-4 rounded-2xl bg-background border border-border flex flex-col justify-between hover:border-foreground/30 transition-colors relative">
                <div className="flex justify-between items-start mb-4">
                  <div className="w-10 h-10 rounded-xl bg-foreground/10 text-foreground flex items-center justify-center">
                    {inv.icon || <TrendingUp size={18} />}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase font-bold text-foreground bg-foreground/10 px-2 py-1 rounded-lg">
                      {inv.bank}
                    </span>
                    <button 
                      onClick={() => {
                        if (confirmDeleteId === inv.id) {
                          handleDelete('INVESTMENT', inv.id);
                          setConfirmDeleteId(null);
                        } else {
                          setConfirmDeleteId(inv.id);
                        }
                      }}
                      onMouseLeave={() => confirmDeleteId === inv.id && setConfirmDeleteId(null)}
                      className={`h-6 rounded-md flex items-center justify-center transition-all shadow-sm overflow-hidden shrink-0 ${
                        confirmDeleteId === inv.id 
                        ? 'bg-red-600 text-white px-2 w-auto opacity-100' 
                        : 'w-6 bg-red-500/10 text-red-500 opacity-0 group-hover/item:opacity-100 hover:bg-red-500 hover:text-white'
                      }`}
                    >
                      {confirmDeleteId === inv.id ? <span className="text-[9px] font-bold uppercase tracking-wider">Confirmar</span> : <Trash2 size={12} />}
                    </button>
                  </div>
                </div>
                <div>
                  <p className="font-bold text-foreground truncate">{inv.title}</p>
                  <p className="text-xs text-muted mb-2">{inv.type} <span className="font-bold text-foreground">({inv.expectedReturn || 0}% a.a)</span></p>
                  <p className="font-heading font-extrabold text-xl text-foreground">
                    {formatCurrency(inv.amount)}
                  </p>
                </div>
              </div>
            ))}
            {investments.length === 0 && <p className="text-muted text-sm col-span-2 text-center mt-6">Nenhum investimento registrado.</p>}
          </div>
        </div>

        {/* PROJEÇÃO */}
        <div className="bg-panel border border-border rounded-[2rem] shadow-sm flex flex-col overflow-hidden h-[350px] relative">
          <div className="p-5 border-b border-border flex justify-between items-center relative z-10 bg-emerald-500/5">
            <h2 className="font-bold text-foreground flex items-center gap-2">
              <TrendingUp className="text-emerald-500" size={20} />
              Projeção de Investimentos
            </h2>
            <span className="text-xs font-bold text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded-md">6 Anos</span>
          </div>
          
          <div className="p-6 flex-1 flex flex-col relative z-10">
            <div className="flex justify-between items-start mb-2">
              <div>
                <p className="text-muted text-[10px] font-bold uppercase tracking-wider mb-1">Montante Final</p>
                <h3 className="text-3xl font-heading font-extrabold text-foreground">{formatCurrency(maxProjection)}</h3>
              </div>
              <div className="text-right">
                <p className="text-muted text-[10px] font-bold uppercase tracking-wider mb-1">Rendimento Bruto</p>
                <p className="text-xl font-bold text-emerald-500">+{formatCurrency(projectedProfit)}</p>
              </div>
            </div>

            {/* Area Chart Container */}
            <div className="flex-1 mt-6 relative w-full h-full group">
              {/* Background Grid Lines */}
              <div className="absolute inset-0 flex flex-col justify-between opacity-5 pointer-events-none">
                <div className="border-t border-foreground w-full"></div>
                <div className="border-t border-foreground w-full"></div>
                <div className="border-t border-foreground w-full"></div>
                <div className="border-t border-foreground w-full"></div>
              </div>

              {/* The SVG Chart */}
              <svg className="absolute inset-0 w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 100">
                <defs>
                  <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {/* Area Fill */}
                <polygon 
                  points={`0,100 ${projections.map((p, i) => `${(i / (projections.length - 1)) * 100},${maxProjection > 0 ? 100 - (p.amount / maxProjection) * 100 : 100}`).join(' ')} 100,100`} 
                  fill="url(#chartGradient)"
                  className="transition-all duration-1000"
                />
                {/* Line */}
                <polyline 
                  points={projections.map((p, i) => `${(i / (projections.length - 1)) * 100},${maxProjection > 0 ? 100 - (p.amount / maxProjection) * 100 : 100}`).join(' ')} 
                  fill="none" 
                  stroke="#10b981" 
                  strokeWidth="3" 
                  strokeLinecap="round" 
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  className="transition-all duration-1000 drop-shadow-[0_4px_10px_rgba(16,185,129,0.5)]"
                />
              </svg>

              {/* Interactive Tooltips (Full-height columns for easy hover) */}
              {projections.map((proj, i) => {
                const x = (i / (projections.length - 1)) * 100;
                const y = maxProjection > 0 ? 100 - (proj.amount / maxProjection) * 100 : 100;
                return (
                  <div 
                    key={i} 
                    className="absolute top-0 bottom-0 w-16 -translate-x-1/2 cursor-crosshair group/point z-20"
                    style={{ left: `${x}%` }}
                  >
                    {/* Vertical Guide Line (appears on hover) */}
                    <div 
                      className="absolute left-1/2 -translate-x-1/2 bottom-0 w-px bg-gradient-to-t from-emerald-500/0 via-emerald-500/40 to-emerald-500/0 opacity-0 group-hover/point:opacity-100 transition-opacity duration-300 pointer-events-none"
                      style={{ top: `${y}%` }}
                    />

                    {/* The dot itself (always visible) */}
                    <div 
                      className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 bg-background border-2 border-emerald-500 rounded-full transition-all duration-300 ring-4 ring-transparent group-hover/point:bg-emerald-500 group-hover/point:w-3 group-hover/point:h-3 group-hover/point:border-0 group-hover/point:ring-emerald-500/30"
                      style={{ top: `${y}%` }}
                    />
                    
                    {/* The Tooltip Card */}
                    <div 
                      className="absolute left-1/2 -translate-x-1/2 bg-foreground text-background text-[10px] font-bold px-3 py-2 rounded-xl opacity-0 group-hover/point:opacity-100 transition-all duration-300 pointer-events-none whitespace-nowrap shadow-2xl flex flex-col items-center gap-1 scale-95 group-hover/point:scale-100 origin-bottom"
                      style={{ top: `calc(${y}% - 48px)` }}
                    >
                      <span className="text-background/70 font-medium capitalize">{proj.label}</span>
                      <span className="text-sm">{formatCurrency(proj.amount)}</span>
                      {/* Triangle pointer */}
                      <div className="absolute top-full left-1/2 -translate-x-1/2 border-[5px] border-transparent border-t-foreground"></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

      </div>

      {/* --- SIDEBAR MODAL (SLIDE-OVER) --- */}
      {activeModal !== 'NONE' && createPortal(
        <AnimatePresence>
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setActiveModal('NONE')}
              className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm"
            />
            
            {/* Slide-over Panel (Solid Background) */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 bottom-0 z-[101] w-full max-w-md bg-background border-l border-border shadow-2xl flex flex-col"
            >
              {/* Header */}
              <div className="p-6 border-b border-border flex items-center justify-between bg-secondary/10 shrink-0">
                <h2 className="text-xl font-heading font-bold text-foreground flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center shadow-md ${
                      activeModal === 'INCOME' ? 'text-white bg-green-500 shadow-green-500/20' :
                      activeModal === 'EXPENSE' ? 'text-white bg-red-500 shadow-red-500/20' :
                      activeModal === 'FIXED' ? 'text-primary-foreground bg-primary shadow-primary/20' :
                      'text-primary-foreground bg-primary shadow-primary/20'
                  }`}>
                    {activeModal === 'INCOME' && <ArrowUpRight size={20} />}
                    {activeModal === 'EXPENSE' && <ArrowDownRight size={20} />}
                    {activeModal === 'FIXED' && <Calendar size={20} />}
                    {activeModal === 'INVESTMENT' && <Wallet size={20} />}
                  </div>
                  Novo Registro
                </h2>
                <button
                  onClick={() => setActiveModal('NONE')}
                  className="p-2 text-muted hover:text-foreground bg-secondary/50 hover:bg-secondary/80 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              
              {/* Form Body */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                
                {/* Tipo de Registro */}
                <div className="flex justify-between items-center p-4 bg-secondary/5 border border-border rounded-2xl">
                  <div>
                    <p className="text-sm text-muted font-medium">Tipo da transação</p>
                    <p className="font-bold text-foreground mt-0.5">
                      {activeModal === 'INCOME' ? 'Receita / Entrada' :
                       activeModal === 'EXPENSE' ? 'Despesa / Saída' :
                       activeModal === 'FIXED' ? 'Conta Fixa (Recorrente)' :
                       'Investimento / Aporte'}
                    </p>
                  </div>
                  {activeModal === 'INCOME' && <span className="bg-green-500/10 text-green-500 px-3 py-1 rounded-full text-xs font-bold border border-green-500/20">+ Receita</span>}
                  {activeModal === 'EXPENSE' && <span className="bg-red-500/10 text-red-500 px-3 py-1 rounded-full text-xs font-bold border border-red-500/20">- Despesa</span>}
                </div>

                <div className="space-y-4">
                  {/* Título e Valor - Compartilhado por todos */}
                  <div>
                    <label className="block text-sm font-semibold text-foreground mb-1.5">Descrição / Título</label>
                    <input 
                      type="text" 
                      value={formData.title}
                      onChange={e => setFormData(p => ({...p, title: e.target.value}))}
                      placeholder="Ex: Aluguel, Salário, Supermercado..."
                      className="w-full bg-panel border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-semibold text-foreground mb-1.5">Valor (R$)</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted font-bold">R$</span>
                      <input 
                        type="number"
                        value={formData.amount}
                        onChange={e => setFormData(p => ({...p, amount: e.target.value}))} 
                        placeholder="0.00"
                        className="w-full bg-panel border border-border rounded-xl pl-12 pr-4 py-3 text-foreground font-heading font-bold placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    {/* Data não faz sentido para Conta Fixa, pois é recorrente */}
                    {activeModal !== 'FIXED' && (
                      <div>
                        <label className="block text-sm font-semibold text-foreground mb-1.5">Data</label>
                        <input 
                          type="date" 
                          defaultValue={new Date().toISOString().split('T')[0]}
                          className="w-full bg-panel border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                        />
                      </div>
                    )}
                    
                    <div className={activeModal === 'FIXED' ? "col-span-2" : ""}>
                      <label className="block text-sm font-semibold text-foreground mb-1.5">Categoria</label>
                      <select 
                        value={formData.category}
                        onChange={e => setFormData(p => ({...p, category: e.target.value}))}
                        className="w-full bg-panel border border-border rounded-xl px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all appearance-none cursor-pointer"
                      >
                        {activeModal === 'INCOME' ? (
                          <>
                            <option>Salário</option>
                            <option>Benefício</option>
                            <option>Rendimento</option>
                            <option>Freelance</option>
                            <option>Outros</option>
                          </>
                        ) : activeModal === 'INVESTMENT' ? (
                          <>
                            <option>Renda Fixa</option>
                            <option>Ações</option>
                            <option>Fundos</option>
                            <option>Cripto</option>
                          </>
                        ) : (
                          <>
                            <option>Alimentação</option>
                            <option>Moradia</option>
                            <option>Transporte</option>
                            <option>Lazer</option>
                            <option>Saúde</option>
                            <option>Outros</option>
                          </>
                        )}
                      </select>
                    </div>
                  </div>

                  {/* Conta Bancária apenas para Entrada e Investimentos */}
                  {(activeModal === 'INCOME' || activeModal === 'INVESTMENT') && (
                    <div>
                      <label className="block text-sm font-semibold text-foreground mb-1.5">Conta de Destino / Origem</label>
                      <div className="grid grid-cols-3 gap-2">
                         {['Nubank', 'Itaú', 'XP'].map(bank => (
                           <button 
                              key={bank}
                              onClick={() => setFormData(p => ({...p, bank}))}
                              className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${
                                formData.bank === bank 
                                ? 'border-primary bg-primary/5 text-primary' 
                                : 'border-transparent bg-panel hover:bg-secondary/50 text-muted hover:text-foreground'
                              }`}
                           >
                              <Building2 size={20} className="mb-1" />
                              <span className="text-xs font-bold">{bank}</span>
                           </button>
                         ))}
                      </div>
                    </div>
                  )}

                  {/* Forma de Saída para Despesas */}
                  {activeModal === 'EXPENSE' && (
                    <div>
                      <label className="block text-sm font-semibold text-foreground mb-1.5">Forma de Pagamento</label>
                      <div className="grid grid-cols-3 gap-2">
                         {['Cartão', 'Pix', 'Boleto'].map(method => (
                           <button 
                              key={method}
                              onClick={() => setFormData(p => ({...p, paymentMethod: method}))}
                              className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${
                                formData.paymentMethod === method 
                                ? 'border-red-500 bg-red-500/5 text-red-500' 
                                : 'border-transparent bg-panel hover:bg-secondary/50 text-muted hover:text-foreground'
                              }`}
                           >
                              <Wallet size={20} className="mb-1" />
                              <span className="text-xs font-bold">{method}</span>
                           </button>
                         ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Taxa de Retorno (apenas investimentos) */}
                  {activeModal === 'INVESTMENT' && (
                    <div>
                      <label className="block text-sm font-semibold text-foreground mb-1.5 flex items-center justify-between">
                         Taxa de Retorno Esperada
                         <span className="text-[10px] text-muted font-normal">% ao ano</span>
                      </label>
                      <div className="relative">
                        <input 
                          type="number"
                          value={formData.expectedReturn}
                          onChange={e => setFormData(p => ({...p, expectedReturn: e.target.value}))} 
                          placeholder="Ex: 10.5"
                          className="w-full bg-panel border border-border rounded-xl pr-8 pl-4 py-3 text-foreground font-heading font-bold focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted font-bold">%</span>
                      </div>
                      <p className="text-[10px] text-muted mt-1.5 leading-tight">Para Ações ou Variável, use uma média histórica estimada (ex: 8% a 12%).</p>
                    </div>
                  )}
                  
                  {/* Regra de Recorrência apenas para Fixas */}
                  {activeModal === 'FIXED' && (
                    <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl mt-4">
                      <label className="block text-sm font-semibold text-primary mb-1.5 flex items-center gap-2">
                        <Calendar size={16} /> Regra de Recorrência
                      </label>
                      <select 
                        value={formData.recurrence}
                        onChange={e => setFormData(p => ({...p, recurrence: e.target.value}))}
                        className="w-full bg-panel border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all appearance-none text-sm cursor-pointer"
                      >
                        <option>Todo dia 05 do mês</option>
                        <option>Todo dia 10 do mês</option>
                        <option>Todo dia 15 do mês</option>
                        <option>Todo dia 20 do mês</option>
                      </select>
                    </div>
                  )}

                </div>
              </div>
              
              {/* Footer Actions */}
              <div className="p-6 border-t border-border bg-background shrink-0 flex gap-3">
                <button 
                  onClick={() => setActiveModal('NONE')}
                  className="flex-1 py-3.5 bg-secondary hover:bg-secondary/80 text-foreground font-bold rounded-xl transition-all"
                >
                  Cancelar
                </button>
                <button 
                  onClick={handleSaveTransaction}
                  className={`flex-[2] py-3.5 font-bold rounded-xl transition-transform hover:scale-[1.02] active:scale-95 shadow-lg flex items-center justify-center gap-2 ${
                    activeModal === 'INCOME' ? 'text-white bg-green-500 hover:bg-green-600 shadow-green-500/20' :
                    activeModal === 'EXPENSE' ? 'text-white bg-red-500 hover:bg-red-600 shadow-red-500/20' :
                    activeModal === 'FIXED' ? 'text-primary-foreground bg-primary hover:bg-primary/90 shadow-primary/20' :
                    'text-primary-foreground bg-primary hover:bg-primary/90 shadow-primary/20'
                  }`}
                >
                  <Plus size={18} />
                  Salvar Registro
                </button>
              </div>

            </motion.div>
          </>
        </AnimatePresence>,
        document.body
      )}

    </div>
  );
}
