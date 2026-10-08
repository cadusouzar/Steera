import { useEffect, useMemo, useState } from 'react';
import { Button, Field, Input, Modal, Notice, Select, Textarea, toast } from '../ui';
import { ApiError } from '../../lib/apiError';
import {
  ENTRY_REASONS, EXIT_REASONS, formatQuantity, formatSignedQuantity, isFractionalUnit, MOVEMENT_REASON_LABELS, newRequestId,
  registerAdjustment, registerEntry, registerExit, toApiNumber, type MovementReason, type Product, type StockMovement,
} from '../../lib/stock';

export type MovementMode = 'entry' | 'exit' | 'adjust';

interface Props {
  open: boolean;
  mode: MovementMode;
  product: Product | null;
  canSeeCosts: boolean;
  onClose: () => void;
  onDone: (movement: StockMovement) => void;
}

const TITLES: Record<MovementMode, string> = {
  entry: 'Adicionar estoque',
  exit: 'Retirar estoque',
  adjust: 'Ajustar por contagem',
};

function parse(text: string): number | null {
  const api = toApiNumber(text);
  if (api === '') return null;
  const n = Number(api);
  return Number.isFinite(n) ? n : NaN;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

const MovementDialog = ({ open, mode, product, canSeeCosts, onClose, onDone }: Props) => {
  // Um id por abertura da janela: clique duplo ou reenvio do mesmo pedido nunca duplica a movimentação.
  const [requestId, setRequestId] = useState(newRequestId);
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [reason, setReason] = useState<MovementReason>('MANUAL_ENTRY');
  const [notes, setNotes] = useState('');
  const [documentRef, setDocumentRef] = useState('');
  const [expectedBalance, setExpectedBalance] = useState(0);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [balanceChanged, setBalanceChanged] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !product) return;
    setRequestId(newRequestId());
    setQuantity('');
    setUnitCost(mode === 'entry' && canSeeCosts && product.referenceCost != null ? String(product.referenceCost).replace('.', ',') : '');
    setReason(mode === 'exit' ? 'MANUAL_EXIT' : 'MANUAL_ENTRY');
    setNotes('');
    setDocumentRef('');
    setExpectedBalance(product.balance);
    setErrors({});
    setSubmitError(null);
    setBalanceChanged(null);
  }, [open, mode, product, canSeeCosts]);

  const unit = product?.unit ?? 'UN';
  const fractional = isFractionalUnit(unit);
  const qty = parse(quantity);
  const difference = mode === 'adjust' && qty !== null && !Number.isNaN(qty) ? round3(qty - expectedBalance) : null;
  const needsAdjustCost = mode === 'adjust' && difference !== null && difference > 0 && expectedBalance === 0;

  const reasons = mode === 'entry' ? ENTRY_REASONS : EXIT_REASONS;

  const validate = () => {
    const found: Record<string, string | undefined> = {};
    if (qty === null) found.quantity = mode === 'adjust' ? 'Informe a quantidade contada' : 'Informe a quantidade';
    else if (Number.isNaN(qty) || qty < 0) found.quantity = 'Informe um número válido';
    else if (mode !== 'adjust' && qty === 0) found.quantity = 'A quantidade precisa ser maior que zero';
    else if (!fractional && !Number.isInteger(qty)) found.quantity = `A unidade ${unit} só aceita números inteiros`;
    else if (mode === 'exit' && product && qty > product.balance) found.quantity = `Maior que o saldo disponível (${formatQuantity(product.balance, unit)})`;
    else if (mode === 'adjust' && difference === 0) found.quantity = 'A contagem é igual ao saldo: não há o que ajustar';
    if (mode === 'entry' || needsAdjustCost) {
      const cost = parse(unitCost);
      if (cost === null) found.unitCost = 'Informe o custo unitário (pode ser 0)';
      else if (Number.isNaN(cost) || cost < 0) found.unitCost = 'Informe um valor válido';
    }
    if (mode === 'adjust' && !notes.trim()) found.notes = 'Explique o motivo do ajuste';
    setErrors(found);
    return !Object.values(found).some(Boolean);
  };

  const submit = async () => {
    if (!product || !validate()) return;
    setSaving(true);
    setSubmitError(null);
    try {
      let movement: StockMovement;
      const common = { requestId, documentRef: documentRef.trim() || undefined };
      if (mode === 'entry') {
        movement = await registerEntry(product.id, { ...common, quantity: toApiNumber(quantity), unitCost: toApiNumber(unitCost), reason, notes: notes.trim() || undefined });
        toast.success(`Entrada registrada: ${formatQuantity(movement.quantity, unit)} de ${product.name}`);
      } else if (mode === 'exit') {
        movement = await registerExit(product.id, { ...common, quantity: toApiNumber(quantity), reason, notes: notes.trim() || undefined });
        toast.success(`Saída registrada: ${formatQuantity(movement.quantity, unit)} de ${product.name}`);
      } else {
        movement = await registerAdjustment(product.id, {
          ...common,
          countedQuantity: toApiNumber(quantity),
          expectedBalance: String(expectedBalance),
          notes: notes.trim(),
          ...(needsAdjustCost ? { unitCost: toApiNumber(unitCost) } : {}),
        });
        toast.success(`Ajuste registrado: ${product.name} (${formatSignedQuantity(movement.quantityDelta, unit)})`);
      }
      onDone(movement);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STOCK_BALANCE_CHANGED') {
        const current = Number(err.details.currentBalance);
        setExpectedBalance(current);
        setBalanceChanged(`O saldo mudou para ${formatQuantity(current, unit)} enquanto a contagem estava aberta. Revise a diferença e confirme de novo.`);
      } else {
        setSubmitError(err instanceof Error ? err.message : 'Não foi possível registrar a movimentação.');
      }
    } finally {
      setSaving(false);
    }
  };

  const differenceText = useMemo(() => {
    if (difference === null || Number.isNaN(difference)) return '—';
    if (difference === 0) return 'Sem diferença';
    return formatSignedQuantity(difference, unit);
  }, [difference, unit]);

  if (!product) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissable={!saving}
      title={TITLES[mode]}
      description={`${product.name} · ${product.sku}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={submit} loading={saving}>
            {mode === 'entry' ? 'Registrar entrada' : mode === 'exit' ? 'Registrar saída' : 'Confirmar ajuste'}
          </Button>
        </>
      }
    >
      {submitError && <Notice tone="danger" className="mb-4" onDismiss={() => setSubmitError(null)}>{submitError}</Notice>}
      {balanceChanged && <Notice tone="warning" className="mb-4">{balanceChanged}</Notice>}

      <dl className="mb-5 grid grid-cols-3 gap-3 rounded-md border border-border bg-secondary/50 px-4 py-3 text-[13px]">
        <div>
          <dt className="text-muted">Saldo atual</dt>
          <dd className="mt-0.5 font-semibold text-foreground tabular">{formatQuantity(mode === 'adjust' ? expectedBalance : product.balance, unit)}</dd>
        </div>
        {mode === 'adjust' && (
          <>
            <div>
              <dt className="text-muted">Contado</dt>
              <dd className="mt-0.5 font-semibold text-foreground tabular">{qty === null || Number.isNaN(qty) ? '—' : formatQuantity(qty, unit)}</dd>
            </div>
            <div>
              <dt className="text-muted">Diferença</dt>
              <dd className={`mt-0.5 font-semibold tabular ${difference && difference < 0 ? 'text-danger' : difference && difference > 0 ? 'text-success' : 'text-foreground'}`}>{differenceText}</dd>
            </div>
          </>
        )}
      </dl>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
        <Field
          label={mode === 'adjust' ? `Quantidade encontrada (${unit})` : `Quantidade (${unit})`}
          required
          htmlFor="movement-qty"
          error={errors.quantity}
          hint={fractional ? 'Aceita até 3 casas decimais' : 'Somente números inteiros'}
        >
          <Input id="movement-qty" inputMode="decimal" value={quantity} onChange={(e) => { setQuantity(e.target.value); setErrors((p) => ({ ...p, quantity: undefined })); }} invalid={!!errors.quantity} />
        </Field>

        {mode !== 'adjust' && (
          <Field label="Motivo" required htmlFor="movement-reason">
            <Select id="movement-reason" value={reason} onChange={(e) => setReason(e.target.value as MovementReason)}>
              {reasons.map((r) => <option key={r} value={r}>{MOVEMENT_REASON_LABELS[r]}</option>)}
            </Select>
          </Field>
        )}

        {(mode === 'entry' || needsAdjustCost) && (
          <Field
            label="Custo unitário"
            required
            htmlFor="movement-cost"
            error={errors.unitCost}
            hint={needsAdjustCost ? 'O saldo é zero, então não há custo médio: informe o custo dos itens encontrados.' : 'Custo zero é aceito quando for o caso.'}
          >
            <Input id="movement-cost" inputMode="decimal" placeholder="0,00" value={unitCost} onChange={(e) => { setUnitCost(e.target.value); setErrors((p) => ({ ...p, unitCost: undefined })); }} invalid={!!errors.unitCost} />
          </Field>
        )}

        <Field label="Referência do documento" htmlFor="movement-doc" hint="Opcional, ex.: NF 1234">
          <Input id="movement-doc" value={documentRef} maxLength={120} onChange={(e) => setDocumentRef(e.target.value)} />
        </Field>

        <Field
          label={mode === 'adjust' ? 'Justificativa' : 'Observação'}
          required={mode === 'adjust'}
          htmlFor="movement-notes"
          error={errors.notes}
          className="sm:col-span-2"
        >
          <Textarea id="movement-notes" rows={3} maxLength={2000} value={notes} onChange={(e) => { setNotes(e.target.value); setErrors((p) => ({ ...p, notes: undefined })); }} invalid={!!errors.notes} />
        </Field>
      </div>

      {mode === 'exit' && <p className="mt-4 text-[13px] text-muted">A saída é avaliada pelo custo médio atual do produto.</p>}
      {mode === 'adjust' && difference !== null && difference < 0 && <p className="mt-4 text-[13px] text-muted">A diferença sai do estoque pelo custo médio atual.</p>}
      {mode === 'adjust' && difference !== null && difference > 0 && !needsAdjustCost && <p className="mt-4 text-[13px] text-muted">A diferença entra no estoque pelo custo médio atual.</p>}
      {reason === 'PURCHASE_RECEIVED' && mode === 'entry' && (
        <p className="mt-4 text-[13px] text-muted">Este registro não cria nem altera pedidos no módulo de Compras.</p>
      )}
    </Modal>
  );
};

export default MovementDialog;
