import { Lock } from 'lucide-react';

// Tela de upgrade (Task 6, 26/09/2026): mostrada no lugar do <Outlet /> em AppLayout quando a
// pessoa abre direto pela URL uma rota cujo módulo/recurso o PLANO da empresa não inclui (mesmo
// que o perfil do login conceda o módulo — ver `locked`/rota travada em AppLayout.tsx). Espelha a
// mensagem que o backend já usa pro 403 PLAN_UPGRADE_REQUIRED. "Ver planos" abre a oferta de
// upgrade (PlanUpgradeModal) por cima, sem sair da página.
interface PlanUpgradeNoticeProps {
  featureLabel: string;
  planLabel: string;
  onShowPlans: () => void;
}

const PlanUpgradeNotice = ({ featureLabel, planLabel, onShowPlans }: PlanUpgradeNoticeProps) => {
  return (
    <div className="flex items-center justify-center min-h-full p-8">
      <div className="bg-panel border border-border rounded-3xl p-8 max-w-lg mx-auto text-center">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto mb-6">
          <Lock size={24} />
        </div>
        <h1 className="text-xl font-heading font-bold text-foreground mb-2">
          {featureLabel} está disponível a partir do plano {planLabel}
        </h1>
        <p className="text-muted mb-6">
          Seu plano atual não inclui este módulo. Faça upgrade para liberar.
        </p>
        <button
          type="button"
          onClick={onShowPlans}
          className="inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-3 rounded-full text-sm font-medium transition-colors shadow-sm"
        >
          Ver planos
        </button>
      </div>
    </div>
  );
};

export default PlanUpgradeNotice;
