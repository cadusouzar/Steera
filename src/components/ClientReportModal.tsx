import React, { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import * as api from '../lib/api';
import type { FinancialSummary } from '../lib/api';
import { Button, EmptyState, Modal, Notice, Table, TBody, TD, TH, THead, TR } from './ui';

// Relatório financeiro geral (kit, etapa 5 do polimento — 01/10/2026). Recarrega a cada abertura.

interface ClientReportModalProps {
  open: boolean;
  onClose: () => void;
}

const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

const Figure = ({ label, value, hint, danger }: { label: string; value: number; hint: string; danger?: boolean }) => (
  <div className="rounded-md border border-border px-4 py-3">
    <p className="text-[13px] text-muted">{label}</p>
    <p className={`mt-1 text-[22px] font-semibold tracking-tight tabular ${danger && value > 0 ? 'text-danger' : 'text-foreground'}`}>
      {formatCurrency(value)}
    </p>
    <p className="text-[12px] text-muted">{hint}</p>
  </div>
);

const ClientReportModal: React.FC<ClientReportModalProps> = ({ open, onClose }) => {
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    api.getFinancialSummary()
      .then((res) => { if (!cancelled) setSummary(res); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Não foi possível carregar o relatório.'); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Relatório financeiro"
      description="Todos os clientes que contam nos relatórios."
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
          <Button icon={Printer} onClick={() => window.print()} disabled={!summary || isLoading}>Imprimir</Button>
        </>
      }
    >
      {isLoading ? (
        <div className="space-y-4" role="status" aria-label="Carregando relatório">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => <span key={i} className="skeleton block h-[86px]" />)}
          </div>
          <span className="skeleton block h-40" />
        </div>
      ) : error ? (
        <Notice tone="danger">{error}</Notice>
      ) : summary && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Figure label="Recebido" value={summary.totalPaid} hint="Total já pago" />
            <Figure label="A receber" value={summary.totalPending} hint="Dentro do prazo" />
            <Figure label="Em atraso" value={summary.totalOverdue} hint="Vencido e não pago" danger />
            <Figure label="Recorrente" value={summary.totalRecurring} hint="Assinaturas por mês" />
          </div>

          <h3 className="mt-6 mb-3 text-[14px] font-semibold text-foreground">Maiores atrasos</h3>
          {summary.topDefaulters.length > 0 ? (
            <div className="rounded-md border border-border overflow-hidden">
              <Table>
                <THead>
                  <tr>
                    <TH>Cliente</TH>
                    <TH className="hidden sm:table-cell">Contato</TH>
                    <TH align="right">Em atraso</TH>
                  </tr>
                </THead>
                <TBody>
                  {summary.topDefaulters.map((d) => (
                    <TR key={d.clientId}>
                      <TD>
                        <span className="font-medium">{d.name}</span>
                        {d.category && <span className="block text-[12px] text-muted">{d.category}</span>}
                      </TD>
                      <TD className="text-muted hidden sm:table-cell">{d.contact}</TD>
                      <TD align="right" className="tabular text-danger whitespace-nowrap">{formatCurrency(d.overdueAmount)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          ) : (
            <div className="rounded-md border border-border">
              <EmptyState title="Nenhum cliente em atraso" description="Todos os lançamentos estão pagos ou dentro do prazo." />
            </div>
          )}
        </>
      )}
    </Modal>
  );
};

export default ClientReportModal;
