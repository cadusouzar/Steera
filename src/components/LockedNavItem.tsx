import { Lock, type LucideIcon } from 'lucide-react';

// Item de menu travado pelo plano da empresa (Task 6, 26/09/2026): renderizado no lugar de um
// item/submenu quando o PERFIL do login concede o módulo mas o PLANO não inclui (ver
// AppLayout.tsx, `locked`/`lockOf`). Clicar abre a oferta de upgrade (PlanUpgradeModal) por cima
// da tela atual — nunca navega, nem pra rota real do módulo (que também está travada, ver
// PlanUpgradeNotice) nem pra Assinatura.
interface LockedNavItemProps {
  icon: LucideIcon;
  label: string;
  planLabel: string;
  onClick: () => void;
}

const LockedNavItem = ({ icon: Icon, label, planLabel, onClick }: LockedNavItemProps) => {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Disponível no plano ${planLabel} — clique para ver os planos`}
      className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-slate-500 dark:text-slate-400 hover:bg-secondary/50 transition-all duration-300"
    >
      <Icon size={18} />
      <span className="flex-1">{label}</span>
      <Lock size={14} aria-hidden="true" />
      <span className="sr-only">(bloqueado)</span>
      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-primary/10 text-primary">
        {planLabel}
      </span>
    </button>
  );
};

export default LockedNavItem;
