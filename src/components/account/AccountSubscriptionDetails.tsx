import React, { useEffect, useState } from 'react';
import { Check, CreditCard, Loader2 } from 'lucide-react';
import type { CurrentUser } from '../../lib/auth';
import { getMyPlan, type MyPlan } from '../../lib/api';

interface AccountSubscriptionDetailsProps {
  user: CurrentUser | null;
  // Ação extra abaixo do cartão do plano (ex.: "Ver planos" na área "Minha conta" do site).
  children?: React.ReactNode;
}

// Rótulos de módulos/recursos do catálogo de planos — cópia de frontend de
// backend/src/plans/plan-catalog.ts (FEATURE_LABELS), mesmo padrão de duplicação intencional já
// usado em src/lib/validation.ts (frontend nunca importa código do backend).
const PLAN_ITEM_LABELS: Record<string, string> = {
  DASHBOARD: 'Visão Geral',
  CLIENTES: 'Clientes',
  RH_CARGOS: 'Cargos',
  RH_FUNCIONARIOS: 'Funcionários',
  PONTO_REGISTRO: 'Ponto',
  PONTO_ADMINISTRACAO: 'Administração do Ponto',
  COMERCIAL: 'Comercial',
  OPERACOES: 'Operações',
  FINANCAS: 'Finanças',
  ANALYTICS: 'Analytics e Dashboards',
};

// Ordem crescente do catálogo (do mais barato ao mais caro) — usada só pra saber quais planos
// ficam "acima" do atual (candidatos a upgrade).
const PLAN_ORDER = ['GRATIS', 'BASICO', 'PRO', 'EMPRESARIAL'];

function formatLimit(value: number | null): string {
  return value === null ? 'Ilimitado' : String(value);
}

interface UsageRowProps {
  label: string;
  used: number;
  limit: number | null;
}

const UsageRow: React.FC<UsageRowProps> = ({ label, used, limit }) => (
  <div>
    <div className="flex justify-between text-sm font-medium mb-1.5">
      <span className="text-muted">{label}</span>
      <span className="text-foreground">
        {used} / {formatLimit(limit)}
      </span>
    </div>
    {limit !== null && (
      <div className="h-2 w-full bg-background rounded-full overflow-hidden border border-border/50">
        <div
          className="h-full bg-primary rounded-full"
          style={{ width: `${Math.min(100, (used / limit) * 100)}%` }}
        />
      </div>
    )}
  </div>
);

// Plano atual + uso + comparação dos 4 planos — compartilhado entre UserProfileDrawer (ERP) e
// /conta/assinatura (site). Dado real de GET /plans/me pra todo login (ADMIN ou EMPLOYEE, sem
// distinção — quem administra logins é uma questão de papel, não de leitura do plano). Sem
// cobrança/pagamento nesta versão, de propósito: "Fazer upgrade" existe só como vitrine.
const AccountSubscriptionDetails: React.FC<AccountSubscriptionDetailsProps> = ({ children }) => {
  const [plan, setPlan] = useState<MyPlan | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMyPlan()
      .then((data) => {
        if (!cancelled) setPlan(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) {
    return (
      <div className="bg-secondary/20 border border-border/60 p-6 rounded-2xl text-sm text-muted">
        Não foi possível carregar as informações do plano agora.
        {children && <div className="mt-4">{children}</div>}
      </div>
    );
  }

  if (!plan) {
    return (
      <div>
        <p className="text-sm text-muted flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Carregando...
        </p>
        {children && <div className="mt-4">{children}</div>}
      </div>
    );
  }

  const currentIndex = PLAN_ORDER.indexOf(plan.current.tier);

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-br from-primary/10 to-accent/10 border border-primary/20 p-6 md:p-8 rounded-3xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
          <CreditCard size={120} />
        </div>

        <span className="inline-block px-3 py-1 bg-primary/20 text-primary text-xs font-bold rounded-full uppercase tracking-wider mb-4 border border-primary/30">
          Plano Atual
        </span>

        <h3 className="text-3xl font-heading font-bold text-foreground mb-2">QuickFlow {plan.current.label}</h3>
        <p className="text-muted font-medium max-w-sm">
          Cobrança e faturas ainda não estão disponíveis nesta versão do QuickFlow.
        </p>
        {children && <div className="relative mt-6">{children}</div>}
      </div>

      <div className="bg-secondary/20 border border-border/60 p-6 rounded-2xl space-y-4">
        <h4 className="font-bold text-foreground">Uso do Plano</h4>
        <UsageRow label="Cargos Ativos" used={plan.usage.roles} limit={plan.current.limits.maxRoles} />
        <UsageRow label="Funcionários Ativos" used={plan.usage.employees} limit={plan.current.limits.maxEmployees} />
        <UsageRow
          label="Logins de Funcionário Ativos"
          used={plan.usage.employeeLogins}
          limit={plan.current.limits.maxEmployeeLogins}
        />
      </div>

      <div>
        <h4 className="font-bold text-foreground mb-4">Compare os planos</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {plan.catalog.map((item, idx) => {
            const isCurrent = item.tier === plan.current.tier;
            const canUpgrade = idx > currentIndex;

            return (
              <div
                key={item.tier}
                className={`border rounded-2xl p-5 flex flex-col ${
                  isCurrent ? 'border-primary bg-primary/5' : 'border-border/60 bg-panel'
                }`}
              >
                <div className="mb-3 min-h-[22px]">
                  {isCurrent && (
                    <span className="inline-block px-2.5 py-0.5 bg-primary/20 text-primary text-[11px] font-bold rounded-full uppercase tracking-wider">
                      Plano atual
                    </span>
                  )}
                </div>

                <h5 className="text-lg font-heading font-bold text-foreground">{item.label}</h5>
                <p className="text-sm text-muted mb-4">{item.priceLabel}</p>

                <ul className="space-y-1.5 text-sm text-foreground/80 mb-4">
                  {item.modules.map((moduleName) => (
                    <li key={moduleName} className="flex items-start gap-2">
                      <Check size={14} className="text-primary shrink-0 mt-0.5" />
                      <span>{PLAN_ITEM_LABELS[moduleName] ?? moduleName}</span>
                    </li>
                  ))}
                  {item.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <Check size={14} className="text-primary shrink-0 mt-0.5" />
                      <span>{PLAN_ITEM_LABELS[feature] ?? feature}</span>
                    </li>
                  ))}
                </ul>

                <div className="flex-1 text-xs text-muted space-y-1 pt-3 mt-auto border-t border-border/40">
                  <div>Cargos: {formatLimit(item.limits.maxRoles)}</div>
                  <div>Funcionários: {formatLimit(item.limits.maxEmployees)}</div>
                  <div>Logins de funcionário: {formatLimit(item.limits.maxEmployeeLogins)}</div>
                </div>

                {canUpgrade && (
                  <div className="mt-4">
                    <button
                      type="button"
                      disabled
                      className="w-full py-2 rounded-xl font-medium text-sm text-center bg-background border border-border text-muted cursor-not-allowed"
                    >
                      Fazer upgrade
                    </button>
                    <p className="text-[11px] text-muted mt-1.5 text-center">
                      Em breve — pagamento online ainda não disponível.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default AccountSubscriptionDetails;
