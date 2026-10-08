import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowRightLeft, LayoutGrid, Package, ShoppingCart, Trash2 } from 'lucide-react';
import PermissionDeniedNotice from '../../components/PermissionDeniedNotice';
import { Button, PageHeader, Tabs, type TabItem } from '../../components/ui';
import MovementDetailModal from '../../components/stock/MovementDetailModal';
import MovementDialog, { type MovementMode } from '../../components/stock/MovementDialog';
import MovementsTab from '../../components/stock/MovementsTab';
import ProductDrawer, { type StockPermissions } from '../../components/stock/ProductDrawer';
import ProductFormModal from '../../components/stock/ProductFormModal';
import ProductPickerModal from '../../components/stock/ProductPickerModal';
import ProductsTab from '../../components/stock/ProductsTab';
import ReplenishmentTab from '../../components/stock/ReplenishmentTab';
import ReverseDialog from '../../components/stock/ReverseDialog';
import StockOverviewTab from '../../components/stock/StockOverviewTab';
import ProductTrashDrawer from '../../components/stock/ProductTrashDrawer';
import { useCan } from '../../lib/auth';
import { notifyStockChanged, useStockPendingCount } from '../../hooks/useStockPendingCount';
import { listTaxonomy, type Product, type ProductDetail, type StockMovement, type StockSituation, type TaxonomyItem } from '../../lib/stock';

// Estoque v1 (08/10/2026) — dados reais do backend (/stock/*), sem nenhum mock. Abas: Visão geral,
// Produtos, Movimentações e Reposição; a Lixeira é um botão no topo (igual a Clientes). Toda alteração de saldo passa pelas janelas de
// movimentação (entrada, saída, ajuste, estorno); o cadastro nunca edita saldo nem custo médio.
type TabId = 'visao-geral' | 'produtos' | 'movimentacoes' | 'reposicao';

const InventoryList = () => {
  const can = useCan();
  const perms: StockPermissions & { view: boolean; export: boolean } = {
    view: can('estoque.ver'),
    manageProducts: can('estoque.produtos.gerenciar'),
    move: can('estoque.movimentar'),
    adjust: can('estoque.ajustar'),
    reverse: can('estoque.estornar'),
    seeCosts: can('estoque.custos.ver'),
    trash: can('estoque.lixeira.gerenciar'),
    export: can('estoque.exportar'),
  };

  const [params, setParams] = useSearchParams();
  const pending = useStockPendingCount(perms.view, 'estoque');
  const tabs: TabItem<TabId>[] = [
    { id: 'visao-geral', label: 'Visão geral', icon: LayoutGrid },
    { id: 'produtos', label: 'Produtos', icon: Package },
    { id: 'movimentacoes', label: 'Movimentações', icon: ArrowRightLeft },
    {
      id: 'reposicao', label: 'Reposição', icon: ShoppingCart, count: pending,
      countLabel: pending === 1 ? '1 produto precisa de reposição' : `${pending ?? 0} produtos precisam de reposição`,
    },
  ];
  const requested = params.get('aba') as TabId | null;
  const tab: TabId = tabs.some((t) => t.id === requested) ? requested! : 'visao-geral';
  const [situationFilter, setSituationFilter] = useState<StockSituation | undefined>();
  const setTab = (id: TabId) => setParams((prev) => { const next = new URLSearchParams(prev); next.set('aba', id); return next; }, { replace: true });

  const [refreshKey, setRefreshKey] = useState(0);
  // Toda gravação recarrega abas/gaveta e avisa o número do menu e da aba Reposição.
  const refresh = useCallback(() => { setRefreshKey((k) => k + 1); notifyStockChanged(); }, []);

  const [categories, setCategories] = useState<TaxonomyItem[]>([]);
  const [brands, setBrands] = useState<TaxonomyItem[]>([]);
  useEffect(() => {
    if (!perms.view) return;
    listTaxonomy('categories').then(setCategories).catch(() => undefined);
    listTaxonomy('brands').then(setBrands).catch(() => undefined);
  }, [perms.view, refreshKey]);

  const [openProductId, setOpenProductId] = useState<string | null>(null);
  const [formProduct, setFormProduct] = useState<ProductDetail | null | undefined>(undefined); // undefined = fechado; null = novo
  const [movement, setMovement] = useState<{ mode: MovementMode; product: Product } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reverseTarget, setReverseTarget] = useState<StockMovement | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);

  if (!perms.view) {
    return <PermissionDeniedNotice message="Seu perfil não permite ver o estoque." backTo="/app" backLabel="Voltar para o início" />;
  }

  const goTo = (target: 'products' | 'movements' | 'replenishment', situation?: 'LOW' | 'OUT_OF_STOCK') => {
    setSituationFilter(situation);
    setTab(target === 'products' ? 'produtos' : target === 'movements' ? 'movimentacoes' : 'reposicao');
  };

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <div className="max-w-6xl mx-auto">
        <PageHeader
          title="Estoque"
          description="Produtos, saldos, custo médio e o histórico de cada movimentação."
          actions={perms.trash ? <Button variant="ghost" icon={Trash2} onClick={() => setTrashOpen(true)}>Lixeira</Button> : undefined}
        />

        <div className="mb-6 overflow-x-auto scrollbar-none -mx-4 px-4 md:mx-0 md:px-0">
          <Tabs<TabId> label="Seções do estoque" tabs={tabs} value={tab} onChange={setTab} />
        </div>

        {tab === 'visao-geral' && (
          <StockOverviewTab
            refreshKey={refreshKey}
            canSeeCosts={perms.seeCosts}
            canReverse={perms.reverse}
            onGoTo={goTo}
            onOpenMovement={setDetailId}
            onReverse={setReverseTarget}
          />
        )}
        {tab === 'produtos' && (
          <ProductsTab
            refreshKey={refreshKey}
            initialSituation={situationFilter}
            categories={categories}
            brands={brands}
            canSeeCosts={perms.seeCosts}
            canCreate={perms.manageProducts}
            canExport={perms.export}
            onCreate={() => setFormProduct(null)}
            onOpen={setOpenProductId}
          />
        )}
        {tab === 'movimentacoes' && (
          <MovementsTab
            refreshKey={refreshKey}
            canSeeCosts={perms.seeCosts}
            canReverse={perms.reverse}
            canExport={perms.export}
            canMove={perms.move || perms.adjust}
            onNewMovement={() => setPickerOpen(true)}
            onOpenMovement={setDetailId}
            onReverse={setReverseTarget}
          />
        )}
        {tab === 'reposicao' && <ReplenishmentTab refreshKey={refreshKey} canExport={perms.export} onOpen={setOpenProductId} />}
      </div>

      {perms.trash && (
        <ProductTrashDrawer
          open={trashOpen}
          onClose={() => setTrashOpen(false)}
          onOpenProduct={(id) => { setTrashOpen(false); setOpenProductId(id); }}
          onRestored={refresh}
        />
      )}

      <ProductDrawer
        productId={openProductId}
        refreshKey={refreshKey}
        can={perms}
        onClose={() => setOpenProductId(null)}
        onChanged={refresh}
        onEdit={(p) => setFormProduct(p)}
        onMove={(mode, p) => setMovement({ mode, product: p })}
        onReverse={setReverseTarget}
        onOpenMovement={setDetailId}
      />

      <ProductFormModal
        open={formProduct !== undefined}
        product={formProduct ?? null}
        onClose={() => setFormProduct(undefined)}
        categories={categories}
        brands={brands}
        onTaxonomyCreated={(kind, item) => (kind === 'categories' ? setCategories : setBrands)((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')))}
        onSaved={(saved) => { refresh(); if (formProduct === null) setOpenProductId(saved.id); }}
        canSeeCosts={perms.seeCosts}
        canMove={perms.move}
        canManageTaxonomy={perms.manageProducts}
      />

      <ProductPickerModal
        open={pickerOpen}
        canMove={perms.move}
        canAdjust={perms.adjust}
        onClose={() => setPickerOpen(false)}
        onPick={(mode, product) => { setPickerOpen(false); setMovement({ mode, product }); }}
      />

      <MovementDialog
        open={!!movement}
        mode={movement?.mode ?? 'entry'}
        product={movement?.product ?? null}
        canSeeCosts={perms.seeCosts}
        onClose={() => setMovement(null)}
        onDone={refresh}
      />

      <ReverseDialog
        movement={reverseTarget}
        unit={reverseTarget?.productUnit ?? null}
        onClose={() => setReverseTarget(null)}
        onDone={() => { setDetailId(null); refresh(); }}
      />

      <MovementDetailModal
        movementId={detailId}
        canSeeCosts={perms.seeCosts}
        canReverse={perms.reverse}
        onClose={() => setDetailId(null)}
        onOpenOther={setDetailId}
        onReverse={(m) => setReverseTarget(m)}
      />
    </div>
  );
};

export default InventoryList;
