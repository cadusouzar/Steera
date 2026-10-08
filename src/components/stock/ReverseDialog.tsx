import { useEffect, useState } from 'react';
import { Button, Field, Modal, Notice, Textarea, toast } from '../ui';
import {
  formatDateTime, formatSignedQuantity, MOVEMENT_TYPE_LABELS, newRequestId, reverseMovement, type StockMovement,
} from '../../lib/stock';

interface Props {
  movement: StockMovement | null;
  unit: string | null;
  onClose: () => void;
  onDone: (reversal: StockMovement) => void;
}

// Estorno: cria uma movimentação nova, ligada à original, com o efeito exatamente oposto. Nesta versão
// só a última movimentação do produto pode ser estornada (sem recalcular o histórico de custos).
const ReverseDialog = ({ movement, unit, onClose, onDone }: Props) => {
  const [requestId, setRequestId] = useState(newRequestId);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!movement) return;
    setRequestId(newRequestId());
    setNotes('');
    setError(undefined);
    setSubmitError(null);
  }, [movement]);

  const submit = async () => {
    if (!movement) return;
    if (!notes.trim()) {
      setError('Explique por que a movimentação está sendo estornada');
      return;
    }
    setSaving(true);
    setSubmitError(null);
    try {
      const reversal = await reverseMovement(movement.id, { requestId, notes: notes.trim() });
      toast.success(`Movimentação estornada: ${movement.productName}`);
      onDone(reversal);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Não foi possível estornar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={!!movement}
      onClose={onClose}
      dismissable={!saving}
      size="sm"
      title="Estornar movimentação"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="danger" onClick={submit} loading={saving}>Estornar</Button>
        </>
      }
    >
      {movement && (
        <>
          {submitError && <Notice tone="danger" className="mb-4">{submitError}</Notice>}
          <p className="text-[14px] text-foreground">
            {MOVEMENT_TYPE_LABELS[movement.type]} de <span className="font-medium">{formatSignedQuantity(movement.quantityDelta, unit)}</span> em{' '}
            {formatDateTime(movement.createdAt)}, por {movement.performedByName}.
          </p>
          <p className="mt-2 text-[13px] text-muted">
            O estorno gera um novo registro com o efeito contrário (quantidade e valor exatos da original). A movimentação original
            não é apagada nem editada. Nesta versão, só a última movimentação do produto pode ser estornada.
          </p>
          <Field label="Justificativa" required htmlFor="reverse-notes" error={error} className="mt-4">
            <Textarea id="reverse-notes" rows={3} maxLength={2000} value={notes} onChange={(e) => { setNotes(e.target.value); setError(undefined); }} invalid={!!error} />
          </Field>
        </>
      )}
    </Modal>
  );
};

export default ReverseDialog;
