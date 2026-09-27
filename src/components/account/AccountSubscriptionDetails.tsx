import React, { useEffect, useState } from 'react';
import { Check, CreditCard, Info, Loader2 } from 'lucide-react';
import type { CurrentUser } from '../../lib/auth';
import { getMyPlan, type MyPlan } from '../../lib/api';
import { PLAN_ITEM_LABELS, PLAN_ORDER, formatLimit } from '../../lib/planCatalog';
import BillingContacts from './BillingContacts';

interface AccountSubscriptionDetailsProps {
  user: CurrentUser | null;
  // Ação extra abaixo do cartão do plano (ex.: "Ver planos" na área "Minha conta" do site).
  children?: React.ReactNode;
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
// cobrança/pagamento nesta versão, de propósito: "Fazer upgrade" existe só como vitrine — e só
// aparece pra quem tem `assinatura.gerenciar` (`canManageSubscription`, 27/09/2026); os demais veem
// com quem falar pra mudar o plano.
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
  const canManage = plan.canManageSubscription;

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-br from-primary/10 to-accent/10 border border-primary/20 p-6 md:p-8 rounded-3xl">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="inline-block px-3 py-1 bg-primary/20 text-primary text-xs font-bold rounded-full uppercase tracking-wider mb-4 border border-primary/30">
              Plano Atual
            </span>
            <h3 className="text-3xl font-heading font-bold text-foreground mb-2">QuickFlow {plan.current.label}</h3>
            <p className="text-muted font-medium max-w-sm">
              Cobrança e faturas ainda não estão disponíveis nesta versão do QuickFlow.
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <CreditCard size={22} aria-hidden="true" />
          </div>
        </div>
        {children && <div className="mt-6">{children}</div>}
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
        {/* Um plano por linha (não colunas): este componente vive tanto no drawer estreito do ERP
            quanto na página /conta, e breakpoints do Tailwind olham a janela, não o container. */}
        <div className="space-y-3">
          {plan.catalog.map((item, idx) => {
            const isCurrent = item.tier === plan.current.tier;
            const canUpgrade = idx > currentIndex;
            const items = [...item.modules, ...item.features];

            return (
              <div
                key={item.tier}
                className={`border rounded-2xl p-4 sm:p-5 ${
                  isCurrent ? 'border-primary bg-primary/5' : 'border-border/60 bg-panel'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h5 className="text-lg font-heading font-bold text-foreground">{item.label}</h5>
                      {isCurrent && (
                        <span className="px-2.5 py-0.5 bg-primary/20 text-primary text-[11px] font-bold rounded-full uppercase tracking-wider">
                          Plano atual
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted">{item.priceLabel}</p>
                  </div>
                  {canManage && canUpgrade && (
                    <button
                      type="button"
                      disabled
                      title="Em breve — pagamento online ainda não disponível."
                      className="px-4 py-2 rounded-xl font-medium text-sm bg-background border border-border text-muted cursor-not-allowed shrink-0"
                    >
                      Fazer upgrade
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5 mt-3">
                  {items.map((name) => (
                    <span
                      key={name}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs text-foreground/80 bg-secondary/40 border border-border/60"
                    >
                      <Check size={12} className="text-primary shrink-0" aria-hidden="true" />
                      {PLAN_ITEM_LABELS[name] ?? name}
                    </span>
                  ))}
                </div>

                <div className="grid grid-cols-3 gap-2 mt-3">
                  {[
                    { label: 'Cargos', value: item.limits.maxRoles },
                    { label: 'Funcionários', value: item.limits.maxEmployees },
                    { label: 'Logins', value: item.limits.maxEmployeeLogins },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded-xl bg-background/60 border border-border/50 px-2 py-2 text-center">
                      <div className="text-[11px] text-muted truncate">{label}</div>
                      <div className="text-sm font-bold text-foreground">{formatLimit(value)}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {canManage && currentIndex < PLAN_ORDER.length - 1 && (
          <p className="text-xs text-muted mt-3">Upgrade em breve — pagamento online ainda não disponível.</p>
        )}
        {!canManage && (
          <div className="mt-4 rounded-2xl border border-border/60 bg-secondary/20 p-4">
            <p className="text-sm text-muted flex items-start gap-2 mb-3">
              <Info size={16} className="text-primary mt-0.5 shrink-0" aria-hidden="true" />
              <span>Para mudar o plano, fale com quem administra a assinatura da empresa:</span>
            </p>
            <BillingContacts contacts={plan.billingContacts} />
          </div>
        )}
      </div>
    </div>
  );
};

export default AccountSubscriptionDetails;
