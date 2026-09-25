import React, { useEffect, useState } from 'react';
import { CreditCard, Loader2 } from 'lucide-react';
import type { CurrentUser } from '../../lib/auth';
import { listSystemUsers } from '../../lib/api';

interface AccountSubscriptionDetailsProps {
  user: CurrentUser | null;
  // Ação extra abaixo do cartão do plano (ex.: "Ver planos" na área "Minha conta" do site).
  children?: React.ReactNode;
}

const PLAN_LABELS: Record<string, string> = {
  BASICO: 'Básico',
  PRO: 'Pro',
  EMPRESARIAL: 'Empresarial',
};

// Plano atual + uso de logins — compartilhado entre UserProfileDrawer (ERP) e /conta/assinatura
// (site). Sem cobrança/pagamento nesta versão, de propósito.
const AccountSubscriptionDetails: React.FC<AccountSubscriptionDetailsProps> = ({ user, children }) => {
  // Uso real de logins de funcionário só é relevante (e só é buscado) para um ADMIN: um EMPLOYEE
  // não gerencia o plano da empresa. GET /companies/me/users não tem @Roles('ADMIN') no backend,
  // mas buscar isso pra todo mundo seria uma chamada sem propósito.
  const [activeEmployeeLogins, setActiveEmployeeLogins] = useState<number | null>(null);
  const [usageError, setUsageError] = useState(false);
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    listSystemUsers()
      .then((users) => {
        if (!cancelled) setActiveEmployeeLogins(users.filter((u) => u.role === 'employee' && u.status === 'active').length);
      })
      .catch(() => {
        if (!cancelled) setUsageError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const planLabel = user?.planTier ? (PLAN_LABELS[user.planTier] ?? user.planTier) : '—';

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-br from-primary/10 to-accent/10 border border-primary/20 p-6 md:p-8 rounded-3xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
          <CreditCard size={120} />
        </div>

        <span className="inline-block px-3 py-1 bg-primary/20 text-primary text-xs font-bold rounded-full uppercase tracking-wider mb-4 border border-primary/30">
          Plano Atual
        </span>

        <h3 className="text-3xl font-heading font-bold text-foreground mb-2">QuickFlow {planLabel}</h3>
        <p className="text-muted font-medium max-w-sm">
          Cobrança e faturas ainda não estão disponíveis nesta versão do QuickFlow.
        </p>
        {children && <div className="relative mt-6">{children}</div>}
      </div>

      {isAdmin && (
        <div className="bg-secondary/20 border border-border/60 p-6 rounded-2xl">
          <h4 className="font-bold text-foreground mb-4">Uso do Plano</h4>

          {usageError ? (
            <p className="text-sm text-muted">Não foi possível carregar o uso do plano agora.</p>
          ) : activeEmployeeLogins === null ? (
            <p className="text-sm text-muted flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Carregando...</p>
          ) : (
            <div>
              <div className="flex justify-between text-sm font-medium mb-1.5">
                <span className="text-muted">Logins de Funcionário Ativos</span>
                <span className="text-foreground">
                  {activeEmployeeLogins} / {user?.maxEmployeeLogins ?? '—'}
                </span>
              </div>
              <div className="h-2 w-full bg-background rounded-full overflow-hidden border border-border/50">
                <div
                  className="h-full bg-primary rounded-full"
                  style={{
                    width: user?.maxEmployeeLogins
                      ? `${Math.min(100, (activeEmployeeLogins / user.maxEmployeeLogins) * 100)}%`
                      : '0%',
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AccountSubscriptionDetails;
