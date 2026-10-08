import { useCallback, useEffect, useState } from 'react';
import { listJustificationsForReview, listPendingAdjustmentRequests } from '../lib/api';

// Evento disparado depois de aprovar/rejeitar/pedir/cancelar algo do ponto, para o número do menu
// atualizar na hora (antes só mudava ao trocar de tela, dar F5 ou depois de um minuto).
export const PONTO_CHANGED_EVENT = 'steera:ponto-changed';

export function notifyPontoChanged(): void {
  window.dispatchEvent(new Event(PONTO_CHANGED_EVENT));
}

// Quantas solicitações de ajuste + justificativas aguardam análise (badge do menu "Administração de
// Ponto"). Usa as listagens que já existem com pageSize=1 só pra ler o `total` — nenhum endpoint
// novo. Escopo já vem do backend (quem só gerencia o próprio time vê só as do time). Recarrega a
// cada troca de rota (`refreshKey`) e a cada minuto, pra o número acompanhar aprovações feitas na
// própria tela de administração.
export function usePontoPendingCount(enabled: boolean, refreshKey: string): number | null {
  const [count, setCount] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [adjustments, justifications] = await Promise.all([
        listPendingAdjustmentRequests({ status: 'pending', pageSize: 1 }),
        listJustificationsForReview({ status: 'pending', pageSize: 1 }),
      ]);
      setCount(adjustments.total + justifications.total);
    } catch {
      // Badge é informativo: uma falha nunca mostra erro no menu, só esconde o número.
      setCount(null);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setCount(null);
      return;
    }
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    const onChanged = () => void load();
    window.addEventListener(PONTO_CHANGED_EVENT, onChanged);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(PONTO_CHANGED_EVENT, onChanged);
    };
  }, [enabled, load, refreshKey]);

  return count;
}
