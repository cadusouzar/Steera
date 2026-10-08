import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Pencil, RotateCcw, Scale } from 'lucide-react';
import { Button, ConfirmDialog, Drawer, EmptyState, Menu, Notice, toast, type MenuItem } from '../ui';
import { listActiveCustomFields, type CustomFieldDefinition } from '../../lib/api';
import {
  deactivateProduct, formatCost, formatDate, formatMoney, formatQuantity, formatCustomFieldValue, getProduct, listMovements,
  reactivateProduct, restoreProduct, trashProduct, type ProductDetail, type StockMovement,
} from '../../lib/stock';
import MovementsTable from './MovementsTable';
import ProductPhoto from './ProductPhoto';
import { LifecycleBadge, SituationBadge } from './StockBadges';
import type { MovementMode } from './MovementDialog';

export interface StockPermissions {
  manageProducts: boolean;
  move: boolean;
  adjust: boolean;
  reverse: boolean;
  seeCosts: boolean;
  trash: boolean;
}

interface Props {
  productId: string | null;
  refreshKey: number;
  can: StockPermissions;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (product: ProductDetail) => void;
  onMove: (mode: MovementMode, product: ProductDetail) => void;
  onReverse: (movement: StockMovement) => void;
  onOpenMovement: (id: string) => void;
}

const HISTORY_PAGE = 20;

const Info = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="min-w-0">
    <dt className="text-[12px] text-muted">{label}</dt>
    <dd className="mt-0.5 text-[14px] text-foreground break-words">{children ?? '—'}</dd>
  </div>
);

const Section = ({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) => (
  <section className="mt-6">
    <div className="flex items-center justify-between gap-3 mb-3">
      <h3 className="text-[14px] font-semibold text-foreground">{title}</h3>
      {action}
    </div>
    {children}
  </section>
);

const ProductDrawer = ({ productId, refreshKey, can, onClose, onChanged, onEdit, onMove, onReverse, onOpenMovement }: Props) => {
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [fields, setFields] = useState<CustomFieldDefinition[]>([]);
  const [history, setHistory] = useState<StockMovement[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'deactivate' | 'trash' | 'restore' | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (id: string) => {
    setLoadError(null);
    try {
      const [p, page, defs] = await Promise.all([
        getProduct(id),
        listMovements({ productId: id, page: 1, pageSize: HISTORY_PAGE }),
        listActiveCustomFields('product').catch(() => [] as CustomFieldDefinition[]),
      ]);
      setProduct(p);
      setHistory(page.items);
      setHistoryTotal(page.total);
      setHistoryPage(1);
      setFields(defs);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar o produto.');
    }
  }, []);

  useEffect(() => {
    if (!productId) {
      setProduct(null);
      return;
    }
    setActionError(null);
    load(productId);
  }, [productId, refreshKey, load]);

  const loadMore = async () => {
    if (!product) return;
    const next = historyPage + 1;
    try {
      const page = await listMovements({ productId: product.id, page: next, pageSize: HISTORY_PAGE });
      setHistory((prev) => [...prev, ...page.items]);
      setHistoryPage(next);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível carregar mais movimentações.');
    }
  };

  const run = async (action: () => Promise<ProductDetail>, success: (p: ProductDetail) => string) => {
    setBusy(true);
    setActionError(null);
    try {
      const updated = await action();
      toast.success(success(updated));
      setConfirm(null);
      onChanged();
      if (productId) await load(productId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível concluir a ação.');
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  const lifecycle = product?.lifecycle;
  const isCurrent = lifecycle === 'ACTIVE' || lifecycle === 'INACTIVE';
  const canMoveNow = !!product && isCurrent;

  const menuItems: MenuItem[] = [];
  if (product && isCurrent && can.manageProducts) {
    menuItems.push(
      lifecycle === 'ACTIVE'
        ? { label: 'Inativar produto', onSelect: () => setConfirm('deactivate') }
        : { label: 'Reativar produto', onSelect: () => run(() => reactivateProduct(product.id), (p) => `Produto reativado: ${p.name}`) },
    );
  }
  if (product && isCurrent && can.trash) {
    menuItems.push({ label: 'Excluir (enviar para a lixeira)', onSelect: () => setConfirm('trash'), tone: 'danger' });
  }

  const footer = product && isCurrent ? (
    <>
      {menuItems.length > 0 && <Menu label="Mais ações" items={menuItems} />}
      {can.manageProducts && <Button variant="secondary" icon={Pencil} onClick={() => onEdit(product)}>Editar</Button>}
      {can.adjust && <Button variant="secondary" icon={Scale} onClick={() => onMove('adjust', product)}>Ajustar</Button>}
      {can.move && <Button variant="secondary" icon={ArrowUpFromLine} onClick={() => onMove('exit', product)} disabled={product.balance <= 0}>Retirar</Button>}
      {can.move && <Button icon={ArrowDownToLine} onClick={() => onMove('entry', product)}>Adicionar</Button>}
    </>
  ) : product && lifecycle === 'TRASHED' && can.trash ? (
    <Button icon={RotateCcw} onClick={() => setConfirm('restore')}>Restaurar</Button>
  ) : undefined;

  const filledFields = fields;

  return (
    <>
      <Drawer
        open={!!productId}
        onClose={onClose}
        size="lg"
        title={product ? product.name : 'Produto'}
        description={product ? `${product.sku}${product.barcode ? ` · EAN ${product.barcode}` : ''}` : undefined}
        footer={footer}
      >
        {loadError && (
          <Notice tone="danger">
            {loadError}{' '}
            {productId && <button type="button" className="underline underline-offset-4 font-medium" onClick={() => load(productId)}>Tentar de novo</button>}
          </Notice>
        )}
        {!product && !loadError && (
          <div className="space-y-3" role="status" aria-label="Carregando produto">
            <span className="skeleton block h-24 w-full" />
            <span className="skeleton block h-4 w-2/3" />
            <span className="skeleton block h-4 w-1/2" />
          </div>
        )}
        {product && (
          <>
            {actionError && <Notice tone="danger" className="mb-4" onDismiss={() => setActionError(null)}>{actionError}</Notice>}
            {lifecycle === 'TRASHED' && product.restoreDeadline && (
              <Notice tone="warning" className="mb-4">
                Na lixeira desde {formatDate(product.trashedAt!)}{product.trashedByName ? `, por ${product.trashedByName}` : ''}. Pode ser restaurado até{' '}
                {formatDate(product.restoreDeadline)}. Depois disso,{' '}
                {product.afterTrashOutcome === 'DELETE'
                  ? 'será excluído definitivamente (não tem movimentações).'
                  : 'será arquivado de forma permanente: sai da lixeira, mas o cadastro e o histórico ficam guardados para consulta.'}
              </Notice>
            )}
            {lifecycle === 'ARCHIVED' && (
              <Notice tone="info" className="mb-4">
                Produto excluído e arquivado em {formatDate(product.archivedAt!)}. Mantido só para consulta do histórico — não recebe movimentações nem pode ser restaurado.
              </Notice>
            )}
            {product.missingRequiredCustomFields.length > 0 && isCurrent && (
              <Notice tone="warning" className="mb-4">
                Campos obrigatórios sem valor: {product.missingRequiredCustomFields.map((f) => f.displayName).join(', ')}.
                {can.manageProducts && ' Preencha em “Editar”.'}
              </Notice>
            )}

            <div className="flex items-start gap-4">
              <ProductPhoto photoUrl={product.photoUrl} name={product.name} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <LifecycleBadge lifecycle={product.lifecycle} />
                  <SituationBadge situation={product.situation} />
                </div>
                <dl className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <Info label="Saldo atual">
                    <span className="text-[20px] font-semibold tabular">{formatQuantity(product.balance, product.unit)}</span>
                  </Info>
                  {can.seeCosts && product.averageCost !== undefined && (
                    <Info label="Custo médio"><span className="tabular">{formatCost(product.averageCost)}</span></Info>
                  )}
                  {can.seeCosts && product.stockValue !== undefined && (
                    <Info label="Valor em estoque"><span className="tabular">{formatMoney(product.stockValue)}</span></Info>
                  )}
                </dl>
              </div>
            </div>

            <Section title="Identificação e organização">
              <dl className="grid grid-cols-2 gap-4">
                <Info label="Unidade">{product.unit}</Info>
                <Info label="Categoria">{product.categoryName}</Info>
                <Info label="Marca">{product.brandName}</Info>
                <Info label="Localização">{product.location}</Info>
                <Info label="Fornecedor principal"><span className="text-muted">Disponível quando houver cadastro de fornecedores</span></Info>
                {product.description && <div className="col-span-2"><Info label="Descrição">{product.description}</Info></div>}
              </dl>
            </Section>

            <Section title="Valores e controle">
              <dl className="grid grid-cols-2 gap-4">
                <Info label="Preço de venda">{product.salePrice === null ? null : formatMoney(product.salePrice)}</Info>
                {can.seeCosts && <Info label="Custo de referência">{product.referenceCost == null ? null : formatCost(product.referenceCost)}</Info>}
                <Info label="Estoque mínimo">{product.minStock === null ? 'Sem alerta de mínimo' : formatQuantity(product.minStock, product.unit)}</Info>
                <Info label="Estoque alvo">{product.targetStock === null ? null : formatQuantity(product.targetStock, product.unit)}</Info>
              </dl>
            </Section>

            {filledFields.length > 0 && (
              <Section title="Campos personalizados">
                <dl className="grid grid-cols-2 gap-4">
                  {filledFields.map((f) => (
                    <Info key={f.id} label={f.displayName}>{formatCustomFieldValue(f.type, product.customFields[f.columnName])}</Info>
                  ))}
                </dl>
              </Section>
            )}

            <Section title="Histórico de movimentações">
              {history.length === 0 ? (
                <div className="rounded-md border border-border">
                  <EmptyState title="Nenhuma movimentação" description="Entradas, saídas e ajustes deste produto aparecem aqui." />
                </div>
              ) : (
                <div className="rounded-md border border-border overflow-hidden">
                  <MovementsTable
                    items={history}
                    unit={product.unit}
                    compact
                    canSeeCosts={can.seeCosts}
                    canReverse={can.reverse && canMoveNow}
                    onOpen={(m) => onOpenMovement(m.id)}
                    onReverse={onReverse}
                  />
                </div>
              )}
              {history.length < historyTotal && (
                <div className="mt-3 flex justify-center">
                  <Button variant="ghost" onClick={loadMore}>Carregar mais ({historyTotal - history.length})</Button>
                </div>
              )}
              {can.reverse && canMoveNow && history.length > 0 && (
                <p className="mt-3 text-[12px] text-muted">Nesta versão, só a última movimentação do produto pode ser estornada.</p>
              )}
            </Section>
          </>
        )}
      </Drawer>

      {product && (
        <>
          <ConfirmDialog
            open={confirm === 'deactivate'}
            onClose={() => setConfirm(null)}
            onConfirm={() => run(() => deactivateProduct(product.id), (p) => `Produto inativado: ${p.name}`)}
            busy={busy}
            title={`Inativar ${product.name}?`}
            description="O produto continua consultável e pode receber movimentações para regularizar o saldo. Ele deixa de contar nos alertas de estoque baixo e esgotado."
            confirmLabel="Inativar"
          />
          <ConfirmDialog
            open={confirm === 'trash'}
            onClose={() => setConfirm(null)}
            onConfirm={() => run(() => trashProduct(product.id), (p) => `Produto enviado para a lixeira: ${p.name}`)}
            busy={busy}
            tone="danger"
            confirmDisabled={product.balance !== 0}
            title={`Excluir ${product.name}?`}
            confirmLabel="Enviar para a lixeira"
          >
            {product.balance !== 0 ? (
              <Notice tone="warning">
                Este produto ainda tem {formatQuantity(product.balance, product.unit)} em estoque. O saldo não é zerado automaticamente:
                registre uma saída ou um ajuste justificado antes de excluir.
              </Notice>
            ) : (
              <p className="text-[14px] text-muted">
                O produto fica na lixeira por 30 dias e pode ser restaurado nesse prazo. Depois,{' '}
                {product.hasMovements
                  ? 'como tem movimentações, será arquivado de forma permanente: o histórico e os relatórios continuam com ele.'
                  : 'como não tem movimentações, será excluído definitivamente.'}
              </p>
            )}
          </ConfirmDialog>
          <ConfirmDialog
            open={confirm === 'restore'}
            onClose={() => setConfirm(null)}
            onConfirm={() => run(() => restoreProduct(product.id), (p) => `Produto restaurado: ${p.name}`)}
            busy={busy}
            title={`Restaurar ${product.name}?`}
            description="O produto volta com o mesmo status, foto, campos e histórico de antes. Nenhuma movimentação é gerada."
            confirmLabel="Restaurar"
          />
        </>
      )}
    </>
  );
};

export default ProductDrawer;
