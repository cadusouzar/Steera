import React, { useEffect, useMemo, useState } from 'react';
import { Printer } from 'lucide-react';
import * as api from '../lib/api';
import type { FinancialSummary } from '../lib/api';
import { customPeriod, formatPeriod, presetPeriod, toDateInput, type PeriodPreset, type ReportPeriod } from '../lib/reportPeriod';
import { Button, EmptyState, Field, Input, Modal, Notice, SegmentedControl, Table, TBody, TD, TH, THead, TR } from './ui';

// Relatório financeiro geral (kit, etapa 5 do polimento — 01/10/2026). Período (06/10/2026): atalhos
// por dia de calendário + "Personalizado" com data e hora — é assim que quem fecha o caixa depois
// da meia-noite tira o fechamento do dia trabalhado. Impresso, serve como folha de fechamento.

interface ClientReportModalProps {
  open: boolean;
  onClose: () => void;
}

const PRESETS: Array<{ value: PeriodPreset; label: string }> = [
  { value: 'today', label: 'Hoje' },
  { value: 'yesterday', label: 'Ontem' },
  { value: 'thisMonth', label: 'Este mês' },
  { value: 'lastMonth', label: 'Mês passado' },
  { value: 'custom', label: 'Personalizado' },
];

const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
const formatDate = (isoDate: string) => isoDate.split('-').reverse().join('/');
const formatDateTime = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

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
  const [preset, setPreset] = useState<PeriodPreset>('thisMonth');
  const today = toDateInput(new Date());
  const [custom, setCustom] = useState({ startDate: today, startTime: '00:00', endDate: today, endTime: '23:59' });
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const period: ReportPeriod | null = useMemo(
    () => (preset === 'custom'
      ? customPeriod(custom.startDate, custom.startTime, custom.endDate, custom.endTime)
      : presetPeriod(preset)),
    [preset, custom],
  );
  const customInvalid = preset === 'custom' && period === null;
  const periodKey = period ? `${period.from.getTime()}-${period.to.getTime()}` : '';

  useEffect(() => {
    if (!open || !period) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    api.getFinancialSummary(period)
      .then((res) => { if (!cancelled) setSummary(res); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Não foi possível carregar o relatório.'); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
    // periodKey resume `period` (um objeto novo a cada render do useMemo não muda a chave).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, periodKey]);

  const receiptsTotal = summary?.receipts.reduce((sum, r) => sum + r.amount, 0) ?? 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Relatório financeiro"
      description={period ? `Período: ${formatPeriod(period)}` : 'Escolha o período do relatório.'}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
          <Button icon={Printer} onClick={() => window.print()} disabled={!summary || isLoading || customInvalid}>Imprimir</Button>
        </>
      }
    >
      <div className="mb-5 space-y-4">
        <div className="overflow-x-auto scrollbar-none">
          <SegmentedControl label="Período do relatório" options={PRESETS} value={preset} onChange={setPreset} />
        </div>
        {preset === 'custom' && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label="Data de início" htmlFor="report-start-date">
              <Input id="report-start-date" type="date" value={custom.startDate} invalid={customInvalid}
                onChange={(e) => setCustom((c) => ({ ...c, startDate: e.target.value }))} />
            </Field>
            <Field label="Hora de início" htmlFor="report-start-time">
              <Input id="report-start-time" type="time" value={custom.startTime} invalid={customInvalid}
                onChange={(e) => setCustom((c) => ({ ...c, startTime: e.target.value }))} />
            </Field>
            <Field label="Data de fim" htmlFor="report-end-date">
              <Input id="report-end-date" type="date" value={custom.endDate} invalid={customInvalid}
                onChange={(e) => setCustom((c) => ({ ...c, endDate: e.target.value }))} />
            </Field>
            <Field label="Hora de fim" htmlFor="report-end-time" error={customInvalid ? 'O início precisa ser antes do fim.' : undefined}>
              <Input id="report-end-time" type="time" value={custom.endTime} invalid={customInvalid}
                onChange={(e) => setCustom((c) => ({ ...c, endTime: e.target.value }))} />
            </Field>
          </div>
        )}
      </div>

      {customInvalid ? null : isLoading ? (
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
            <Figure label="Recebido" value={summary.totalPaid} hint="Pago no período" />
            <Figure label="A receber" value={summary.totalPending} hint="Vence no período, no prazo" />
            <Figure label="Em atraso" value={summary.totalOverdue} hint="Venceu no período e não foi pago" danger />
            <Figure label="Recorrente" value={summary.totalRecurring} hint="Situação atual, por mês" />
          </div>

          <h3 className="mt-6 mb-3 text-[14px] font-semibold text-foreground">Recebimentos do período</h3>
          {summary.receiptsTruncated && (
            <Notice tone="warning" className="mb-3">
              Mostrando os primeiros 1.000 recebimentos. O total recebido considera todos.
            </Notice>
          )}
          {summary.receipts.length > 0 ? (
            <div className="rounded-md border border-border overflow-hidden">
              <Table>
                <THead>
                  <tr>
                    <TH>Cliente</TH>
                    <TH className="hidden md:table-cell">Descrição</TH>
                    <TH className="hidden sm:table-cell">Vencimento</TH>
                    <TH>Pago em</TH>
                    <TH align="right">Valor</TH>
                  </tr>
                </THead>
                <TBody>
                  {summary.receipts.map((r) => (
                    <TR key={r.id}>
                      <TD><span className="font-medium">{r.clientName}</span></TD>
                      <TD className="text-muted hidden md:table-cell">{r.description}</TD>
                      <TD className="text-muted tabular hidden sm:table-cell">{formatDate(r.dueDate)}</TD>
                      <TD className="tabular whitespace-nowrap">{formatDateTime(r.paidAt)}</TD>
                      <TD align="right" className="tabular whitespace-nowrap">{formatCurrency(r.amount)}</TD>
                    </TR>
                  ))}
                  <TR>
                    <TD className="font-semibold">Total ({summary.receipts.length})</TD>
                    <TD className="hidden md:table-cell" />
                    <TD className="hidden sm:table-cell" />
                    <TD />
                    <TD align="right" className="tabular font-semibold whitespace-nowrap">{formatCurrency(receiptsTotal)}</TD>
                  </TR>
                </TBody>
              </Table>
            </div>
          ) : (
            <div className="rounded-md border border-border">
              <EmptyState title="Nenhum recebimento no período" description="Nenhum lançamento foi marcado como pago entre o início e o fim escolhidos." />
            </div>
          )}

          <h3 className="mt-6 mb-3 text-[14px] font-semibold text-foreground">
            Maiores atrasos <span className="font-normal text-muted">· situação atual</span>
          </h3>
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
