import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Lock, Plus, Sparkles, X } from 'lucide-react';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { getMyPlan, type MyPlan, type PlanCatalogItem, type PlanLimits } from '../lib/api';
import { PLAN_ITEM_LABELS, PLAN_ORDER, formatLimit } from '../lib/planCatalog';

// Oferta de upgrade (26/09/2026): aberta por cima da tela atual quando a pessoa clica num item de
// menu travado pelo plano (LockedNavItem) ou em "Ver planos" na tela de rota travada
// (PlanUpgradeNotice) — nunca navega, fechar deixa a pessoa exatamente onde estava. Mostra só os
// planos que liberam o módulo (acima do atual), com o plano mínimo em destaque. Dados de
// GET /plans/me (mesma fonte da aba Assinatura), então preço/limite nunca divergem do backend. Sem
// pagamento nesta versão: o botão de compra fica desabilitado com "Em breve".
export interface PlanUpgradeTarget {
  featureLabel: string; // o que a pessoa tentou abrir, ex. "Ponto"
  requiredTier: PlanCatalogItem['tier']; // plano mínimo que libera
  requiredLabel: string; // rótulo desse plano, ex. "Básico"
}

interface PlanUpgradeModalProps {
  target: PlanUpgradeTarget | null;
  onClose: () => void;
}

const LIMIT_ROWS: { key: keyof PlanLimits; label: string }[] = [
  { key: 'maxRoles', label: 'Cargos' },
  { key: 'maxEmployees', label: 'Funcionários' },
  { key: 'maxEmployeeLogins', label: 'Logins de funcionário' },
];

// O que o plano oferece a mais em relação ao plano atual: módulos/recursos novos e limites maiores.
function gainsOver(plan: PlanCatalogItem, current: PlanCatalogItem | undefined): string[] {
  const currentItems = new Set([...(current?.modules ?? []), ...(current?.features ?? [])]);
  const items = [...plan.modules, ...plan.features]
    .filter((item) => !currentItems.has(item))
    .map((item) => PLAN_ITEM_LABELS[item] ?? item);
  const limits = LIMIT_ROWS.filter(({ key }) => plan.limits[key] !== current?.limits[key]).map(
    ({ key, label }) => `${label}: ${formatLimit(plan.limits[key])}`,
  );
  return [...items, ...limits];
}

const PlanUpgradeModalContent = ({ target, onClose }: { target: PlanUpgradeTarget; onClose: () => void }) => {
  const [plan, setPlan] = useState<MyPlan | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEscapeKey(onClose);

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

  const currentIndex = plan ? PLAN_ORDER.indexOf(plan.current.tier) : -1;
  const currentItem = plan?.catalog.find((item) => item.tier === plan.current.tier);
  // Só planos acima do atual E que liberam o que a pessoa tentou abrir (ex.: Comercial não oferece o
  // Básico, que não libera Comercial).
  const minIndex = Math.max(currentIndex + 1, PLAN_ORDER.indexOf(target.requiredTier));
  const upgrades = plan ? plan.catalog.filter((item) => PLAN_ORDER.indexOf(item.tier) >= minIndex) : [];

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm"
      />
      <div className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none">
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="plan-upgrade-title"
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="w-full max-w-4xl max-h-[90vh] bg-background border border-border shadow-2xl rounded-3xl flex flex-col pointer-events-auto overflow-hidden"
        >
          <div className="p-6 border-b border-border flex items-start justify-between gap-4 bg-secondary/10 shrink-0">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Lock size={22} aria-hidden="true" />
              </div>
              <div>
                <h2 id="plan-upgrade-title" className="text-xl font-heading font-bold text-foreground">
                  Desbloqueie {target.featureLabel}
                </h2>
                <p className="text-sm text-muted mt-1">
                  Disponível a partir do plano {target.requiredLabel}. Veja tudo o que você ganha com o upgrade.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="p-2 text-muted hover:text-foreground bg-secondary/30 hover:bg-secondary/80 rounded-full transition-colors shrink-0"
            >
              <X size={20} />
            </button>
          </div>

          <div className="p-6 overflow-y-auto">
            {loadError ? (
              <p className="text-sm text-muted">Não foi possível carregar os planos agora.</p>
            ) : !plan ? (
              <p className="text-sm text-muted flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> Carregando planos...
              </p>
            ) : (
              <div
                className={`grid grid-cols-1 gap-4 ${
                  upgrades.length >= 3 ? 'md:grid-cols-3' : upgrades.length === 2 ? 'md:grid-cols-2' : ''
                }`}
              >
                {upgrades.map((item) => {
                  const recommended = item.tier === target.requiredTier;
                  return (
                    <div
                      key={item.tier}
                      className={`relative flex flex-col rounded-2xl border p-5 bg-panel ${
                        recommended ? 'border-primary ring-2 ring-primary/30' : 'border-border'
                      }`}
                    >
                      {recommended && (
                        <span className="absolute -top-3 left-5 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary text-white text-[11px] font-bold uppercase tracking-wide">
                          <Sparkles size={12} aria-hidden="true" /> Recomendado
                        </span>
                      )}
                      <div className="text-lg font-heading font-bold text-foreground">{item.label}</div>
                      <div className="text-sm text-muted mb-4">{item.priceLabel}</div>

                      <div className="text-xs font-bold uppercase tracking-wide text-muted mb-2">
                        O que você ganha
                      </div>
                      <ul className="flex-1 space-y-1.5 mb-5">
                        {gainsOver(item, currentItem).map((gain) => (
                          <li key={gain} className="flex items-start gap-2 text-sm text-foreground">
                            <Plus size={14} className="text-primary mt-0.5 shrink-0" aria-hidden="true" />
                            <span>{gain}</span>
                          </li>
                        ))}
                      </ul>

                      <button
                        type="button"
                        disabled
                        className={`w-full py-2.5 rounded-xl font-medium text-sm cursor-not-allowed ${
                          recommended
                            ? 'bg-primary text-white opacity-60'
                            : 'bg-background border border-border text-muted'
                        }`}
                      >
                        Quero o plano {item.label}
                      </button>
                      <p className="text-[11px] text-muted mt-1.5 text-center">
                        Em breve — pagamento online ainda não disponível.
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="px-6 py-4 border-t border-border flex justify-end shrink-0">
            <Link
              to="/conta/assinatura"
              onClick={onClose}
              className="text-sm font-medium text-primary hover:underline"
            >
              Comparar todos os planos
            </Link>
          </div>
        </motion.div>
      </div>
    </>
  );
};

// `onClose` precisa ser estável (useCallback no chamador) — vai pro useEscapeKey.
const PlanUpgradeModal = ({ target, onClose }: PlanUpgradeModalProps) => {
  return createPortal(
    <AnimatePresence>
      {target && <PlanUpgradeModalContent key={target.featureLabel} target={target} onClose={onClose} />}
    </AnimatePresence>,
    document.body,
  );
};

export default PlanUpgradeModal;
