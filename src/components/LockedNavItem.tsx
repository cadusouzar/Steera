import { Link } from 'react-router-dom';
import { Lock, type LucideIcon } from 'lucide-react';

// Item de menu travado pelo plano da empresa (Task 6, 26/09/2026): renderizado no lugar de um
// item/submenu quando o PERFIL do login concede o módulo mas o PLANO não inclui (ver
// AppLayout.tsx, `locked`/`lockOf`). Sempre leva pra Minha conta → Assinatura, nunca pra rota real
// do módulo — a rota em si também está travada (ver PlanUpgradeNotice, mostrado se a pessoa
// tentar acessá-la direto pela URL).
interface LockedNavItemProps {
  icon: LucideIcon;
  label: string;
  planLabel: string;
}

const LockedNavItem = ({ icon: Icon, label, planLabel }: LockedNavItemProps) => {
  return (
    <Link
      to="/conta/assinatura"
      title={`Disponível no plano ${planLabel} — clique para ver os planos`}
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-slate-500 dark:text-slate-400 hover:bg-secondary/50 transition-all duration-300"
    >
      <Icon size={18} />
      <span className="flex-1">{label}</span>
      <Lock size={14} />
      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-primary/10 text-primary">
        {planLabel}
      </span>
    </Link>
  );
};

export default LockedNavItem;
