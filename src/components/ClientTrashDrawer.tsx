import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Trash2, RotateCcw, Loader2 } from 'lucide-react';
import { listTrashedClients, restoreClient } from '../lib/api';
import type { ClientRecord } from '../lib/api';

interface ClientTrashDrawerProps {
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

const ClientTrashDrawer: React.FC<ClientTrashDrawerProps> = ({ onClose, onRestored, canRestore }) => {
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    listTrashedClients()
      .then((items) => { if (!cancelled) setClients(items); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Erro ao carregar a lixeira.'); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleRestore = async (id: string) => {
    if (restoringId) return; // evita duplo clique disparando duas restaurações
    setRestoringId(id);
    setError(null);
    try {
      await restoreClient(id);
      setClients((prev) => prev.filter((c) => c.id !== id));
      onRestored();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível restaurar o cliente.');
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[120] bg-background/80 backdrop-blur-sm flex justify-end"
      >
        <motion.div
          onClick={(e) => e.stopPropagation()}
          initial={{ x: '100%', opacity: 0.5 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0.5 }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          className="bg-background border-l border-border/60 w-full max-w-lg h-full flex flex-col shadow-2xl relative"
        >
          <div className="p-6 md:p-8 border-b border-border/40 shrink-0 bg-secondary/10 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-red-500/10 border border-red-500/20 text-red-500 flex items-center justify-center shrink-0">
                <Trash2 size={20} />
              </div>
              <div>
                <h2 className="text-lg font-heading font-bold text-foreground">Lixeira de Clientes</h2>
                <p className="text-xs text-muted">Excluídos há menos de 30 dias podem ser restaurados</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 text-muted hover:text-foreground bg-secondary/50 hover:bg-secondary/80 rounded-full transition-colors">
              <X size={20} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 md:p-8">
            {error && (
              <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 text-sm">
                {error}
              </div>
            )}

            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-muted">
                <Loader2 className="animate-spin" size={24} />
              </div>
            ) : clients.length === 0 ? (
              <div className="text-center py-12 bg-secondary/10 border border-border/40 border-dashed rounded-2xl">
                <Trash2 size={32} className="mx-auto text-muted/50 mb-3" />
                <p className="text-sm font-bold text-foreground">Lixeira vazia</p>
                <p className="text-xs text-muted mt-1">Clientes excluídos sem manter no relatório aparecem aqui por 30 dias.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {clients.map((client) => {
                  const remaining = daysRemaining(client.deactivatedAt);
                  const isRestoring = restoringId === client.id;
                  return (
                    <div key={client.id} className="p-4 rounded-2xl border border-border/40 bg-secondary/10 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-foreground truncate">{client.name}</p>
                        <p className="text-xs text-muted">
                          {remaining > 0 ? `Expira em ${remaining} dia${remaining === 1 ? '' : 's'}` : 'Expira hoje'}
                        </p>
                      </div>
                      {canRestore && (
                      <button
                        onClick={() => handleRestore(client.id)}
                        disabled={isRestoring}
                        className="shrink-0 flex items-center gap-1.5 text-xs font-bold text-primary hover:text-primary-foreground hover:bg-primary px-3 py-2 rounded-lg transition-colors border border-primary/30 disabled:opacity-60"
                      >
                        <RotateCcw size={14} />
                        {isRestoring ? 'Restaurando...' : 'Restaurar'}
                      </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default ClientTrashDrawer;
