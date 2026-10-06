import React, { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { listTrashedClients, restoreClient } from '../lib/api';
import type { ClientRecord } from '../lib/api';
import { Button, Drawer, EmptyState, Modal, Notice, toast } from './ui';

// Lixeira de clientes (kit, etapa 5 do polimento — 01/10/2026). Recarrega a lista a cada abertura.
// "Restaurar" pergunta se o cliente volta a contar nos relatórios (pedido do usuário, 01/10/2026) — antes,
// restaurar reativava o cliente e o deixava fora dos relatórios sem avisar.

interface ClientTrashDrawerProps {
  open: boolean;
  onClose: () => void;
  // Chamado depois de uma restauração bem-sucedida — o pai recarrega a
  // listagem padrão de clientes (mais simples do que reconstruir o estado
  // completo do cliente a partir do payload parcial da lixeira).
  onRestored: () => void;
  // Sem `clientes.gerenciar` a lixeira fica só em leitura (o botão Restaurar some).
  canRestore: boolean;
}

const DAYS_UNTIL_PURGE = 30;

function daysRemaining(deactivatedAt: string | null): number {
  if (!deactivatedAt) return DAYS_UNTIL_PURGE;
  const elapsedMs = Date.now() - new Date(deactivatedAt).getTime();
  const elapsedDays = Math.floor(elapsedMs / 86_400_000);
  return Math.max(0, DAYS_UNTIL_PURGE - elapsedDays);
}

const ClientTrashDrawer: React.FC<ClientTrashDrawerProps> = ({ open, onClose, onRestored, canRestore }) => {
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<ClientRecord | null>(null);
  const [restoreChoice, setRestoreChoice] = useState<'report' | 'only' | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    listTrashedClients()
      .then((items) => { if (!cancelled) setClients(items); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Erro ao carregar a lixeira.'); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  const handleRestore = async (includeInRevenueReport: boolean) => {
    if (!restoreTarget || restoringId) return; // evita duplo clique disparando duas restaurações
    const id = restoreTarget.id;
    setRestoringId(id);
    setRestoreChoice(includeInRevenueReport ? 'report' : 'only');
    setError(null);
    try {
      await restoreClient(id, includeInRevenueReport);
      setClients((prev) => prev.filter((c) => c.id !== id));
      toast.success(`Cliente restaurado: ${restoreTarget.name}`);
      onRestored();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível restaurar o cliente.');
    } finally {
      setRestoringId(null);
      setRestoreChoice(null);
      setRestoreTarget(null);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Lixeira de clientes"
      description="Clientes removidos dos relatórios ficam aqui por 30 dias antes de serem apagados."
    >
      {error && <Notice tone="danger" className="mb-4">{error}</Notice>}

      {isLoading ? (
        <div className="space-y-2" role="status" aria-label="Carregando lixeira">
          {[0, 1, 2].map((i) => <span key={i} className="skeleton block h-14" />)}
        </div>
      ) : clients.length === 0 ? (
        <EmptyState title="Lixeira vazia" description="Ao excluir um cliente sem mantê-lo nos relatórios, ele aparece aqui." />
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {clients.map((client) => {
            const remaining = daysRemaining(client.deactivatedAt);
            return (
              <li key={client.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-foreground truncate">{client.name}</p>
                  <p className={`text-[13px] ${remaining <= 3 ? 'text-danger' : 'text-muted'}`}>
                    {remaining > 0 ? `Apagado em ${remaining} dia${remaining === 1 ? '' : 's'}` : 'Apagado hoje'}
                  </p>
                </div>
                {canRestore && (
                  <Button
                    variant="secondary" size="sm" icon={RotateCcw}
                    onClick={() => setRestoreTarget(client)}
                    disabled={!!restoringId}
                  >
                    Restaurar
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={!!restoreTarget}
        onClose={() => setRestoreTarget(null)}
        title="Restaurar cliente"
        description={restoreTarget ? `${restoreTarget.name} volta para a lista de clientes como ativo.` : undefined}
        size="sm"
        dismissable={!restoringId}
        footer={<Button variant="secondary" onClick={() => setRestoreTarget(null)} disabled={!!restoringId}>Cancelar</Button>}
      >
        <p className="text-[14px] text-foreground mb-4">Os valores deste cliente devem voltar a contar nos relatórios?</p>
        <div className="space-y-3">
          <div>
            <Button className="w-full" onClick={() => handleRestore(true)} loading={restoreChoice === 'report'} disabled={!!restoringId}>
              Sim, voltar aos relatórios
            </Button>
            <p className="mt-1.5 text-[13px] text-muted">Os lançamentos dele entram de novo no relatório financeiro.</p>
          </div>
          <div>
            <Button variant="secondary" className="w-full" onClick={() => handleRestore(false)} loading={restoreChoice === 'only'} disabled={!!restoringId}>
              Não, só reativar
            </Button>
            <p className="mt-1.5 text-[13px] text-muted">Volta a ser ativo, mas continua fora do relatório. A ficha avisa isso.</p>
          </div>
        </div>
      </Modal>
    </Drawer>
  );
};

export default ClientTrashDrawer;
