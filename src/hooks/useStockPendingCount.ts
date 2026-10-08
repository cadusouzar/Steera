import { useCallback, useEffect, useState } from 'react';
import { getStockOverview } from '../lib/stock';

// Evento disparado pela tela de Estoque depois de qualquer gravação (movimentação, cadastro, lixeira),
// para o número do menu e da aba Reposição atualizar na hora, sem esperar o próximo minuto.
export const STOCK_CHANGED_EVENT = 'steera:stock-changed';

export function notifyStockChanged(): void {
  window.dispatchEvent(new Event(STOCK_CHANGED_EVENT));
}

// Quantos produtos ativos precisam de reposição (esgotados + estoque baixo) — badge do menu "Estoque"
// e da aba "Reposição", mesmo padrão de usePontoPendingCount. Reaproveita GET /stock/reports/overview
// (nenhum endpoint novo). Recarrega a cada troca de rota, a cada minuto e a cada gravação no estoque.
export function useStockPendingCount(enabled: boolean, refreshKey: string): number | null {
  const [count, setCount] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const overview = await getStockOverview();
      setCount(overview.lowStock + overview.outOfStock);
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
    window.addEventListener(STOCK_CHANGED_EVENT, onChanged);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(STOCK_CHANGED_EVENT, onChanged);
    };
  }, [enabled, load, refreshKey]);

  return count;
}
