import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Plus, Search, X } from 'lucide-react';
import { Button, EmptyState, Input, Notice, Select, Switch, Table, TBody, TD, TH, THead, TR } from '../ui';
import {
  downloadStockCsv, findProductByCode, formatMoney, formatQuantity, listProducts, SITUATION_LABELS,
  type Product, type ProductFilters, type StockSituation, type TaxonomyItem,
} from '../../lib/stock';
import { LifecycleBadge, SituationBadge } from './StockBadges';

interface Props {
  refreshKey: number;
  initialSituation?: StockSituation;
  categories: TaxonomyItem[];
  brands: TaxonomyItem[];
  canSeeCosts: boolean;
  canCreate: boolean;
  canExport: boolean;
  onCreate: () => void;
  onOpen: (id: string) => void;
}

const PAGE_SIZE = 50;

const ProductsTab = ({ refreshKey, initialSituation, categories, brands, canSeeCosts, canCreate, canExport, onCreate, onOpen }: Props) => {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState<'' | 'ACTIVE' | 'INACTIVE'>('');
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [situation, setSituation] = useState<'' | StockSituation>(initialSituation ?? '');
  const [showDeleted, setShowDeleted] = useState(false);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (initialSituation) { setSituation(initialSituation); setPage(1); } }, [initialSituation]);

  useEffect(() => {
    const t = window.setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 250);
    return () => window.clearTimeout(t);
  }, [search]);

  const filters: ProductFilters = {
    search: debounced || undefined,
    status: status || undefined,
    categoryId: categoryId || undefined,
    brandId: brandId || undefined,
    situation: situation || undefined,
    view: showDeleted ? 'all' : 'current',
  };
  const filtersKey = JSON.stringify(filters);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listProducts({ ...JSON.parse(filtersKey), page, pageSize: PAGE_SIZE });
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar os produtos.');
    } finally {
      setLoading(false);
    }
  }, [filtersKey, page]);

  useEffect(() => { load(); }, [load, refreshKey]);

  // Leitor de código de barras: funciona como teclado e termina com Enter. Um código exato (SKU ou
  // EAN) abre o produto direto; se não houver, a busca normal continua valendo.
  const onSearchEnter = async () => {
    const code = search.trim();
    if (!code) return;
    try {
      const product = await findProductByCode(code);
      setSearch('');
      setNotice(null);
      onOpen(product.id);
    } catch {
      setNotice(`Nenhum produto com o código exato “${code}”. Mostrando resultados parecidos.`);
    }
  };

  const clearFilters = () => {
    setSearch(''); setStatus(''); setCategoryId(''); setBrandId(''); setSituation(''); setShowDeleted(false); setPage(1);
  };
  const hasFilters = !!(search || status || categoryId || brandId || situation || showDeleted);

  const exportCsv = async () => {
    setExporting(true);
    setError(null);
    try {
      await downloadStockCsv('position', filters);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível gerar a planilha.');
    } finally {
      setExporting(false);
    }
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search size={16} strokeWidth={1.8} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
          <Input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setNotice(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSearchEnter(); } }}
            placeholder="Buscar por nome, SKU ou código de barras (leitor: bipe e Enter)"
            aria-label="Buscar produtos"
            className="pl-9 pr-9"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded text-muted hover:text-foreground hover:bg-secondary" aria-label="Limpar busca">
              <X size={15} strokeWidth={1.8} />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {canExport && <Button variant="secondary" icon={Download} onClick={exportCsv} loading={exporting}>Exportar CSV</Button>}
          {canCreate && <Button icon={Plus} onClick={onCreate}>Novo produto</Button>}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-2">
        <Select aria-label="Filtrar por status" value={status} onChange={(e) => { setStatus(e.target.value as '' | 'ACTIVE' | 'INACTIVE'); setPage(1); }}>
          <option value="">Todos os status</option>
          <option value="ACTIVE">Ativos</option>
          <option value="INACTIVE">Inativos</option>
        </Select>
        <Select aria-label="Filtrar por situação do estoque" value={situation} onChange={(e) => { setSituation(e.target.value as '' | StockSituation); setPage(1); }}>
          <option value="">Toda situação de estoque</option>
          {(['OUT_OF_STOCK', 'LOW', 'NORMAL', 'NO_MIN_ALERT'] as StockSituation[]).map((s) => <option key={s} value={s}>{SITUATION_LABELS[s]}</option>)}
        </Select>
        <Select aria-label="Filtrar por categoria" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }}>
          <option value="">Todas as categorias</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select aria-label="Filtrar por marca" value={brandId} onChange={(e) => { setBrandId(e.target.value); setPage(1); }}>
          <option value="">Todas as marcas</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </Select>
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="w-full sm:w-auto">
          <Switch checked={showDeleted} onChange={(v) => { setShowDeleted(v); setPage(1); }} label="Exibir produtos excluídos" description="Inclui os que estão na lixeira e os arquivados" />
        </div>
        {hasFilters && <Button variant="ghost" size="sm" onClick={clearFilters}>Limpar filtros</Button>}
      </div>

      {notice && <Notice tone="info" className="mb-4" onDismiss={() => setNotice(null)}>{notice}</Notice>}
      {error && (
        <Notice tone="danger" className="mb-4">
          {error} <button type="button" onClick={load} className="underline underline-offset-4 font-medium">Tentar de novo</button>
        </Notice>
      )}

      <div className="bg-panel border border-border rounded-lg shadow-sm overflow-hidden">
        {loading ? (
          <div className="divide-y divide-border" role="status" aria-label="Carregando produtos">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-6 px-5 h-14">
                <span className="skeleton h-4 w-48" />
                <span className="skeleton h-4 w-20 hidden sm:block" />
                <span className="skeleton h-4 w-16 ml-auto" />
                <span className="skeleton h-4 w-20" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          total === 0 && !hasFilters ? (
            <EmptyState
              title="Nenhum produto cadastrado"
              description="Cadastre o primeiro produto para controlar saldo, custos e movimentações."
              action={canCreate ? <Button icon={Plus} onClick={onCreate}>Novo produto</Button> : undefined}
            />
          ) : (
            <EmptyState title="Nenhum produto encontrado" description="Nada corresponde à busca e aos filtros." action={<Button variant="secondary" onClick={clearFilters}>Limpar busca e filtros</Button>} />
          )
        ) : (
          <Table minWidth={720}>
            <THead>
              <tr>
                <TH>Produto</TH>
                <TH>SKU</TH>
                <TH>Unidade</TH>
                <TH align="right">Saldo</TH>
                <TH align="right">Mínimo</TH>
                <TH>Situação</TH>
                {canSeeCosts && <TH align="right">Valor em estoque</TH>}
              </tr>
            </THead>
            <TBody>
              {items.map((p) => (
                <TR key={p.id} interactive onClick={() => onOpen(p.id)}>
                  <TD>
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onOpen(p.id); }}
                        className="font-medium text-foreground text-left hover:underline underline-offset-4 outline-none focus-visible:underline truncate max-w-[260px]"
                      >
                        {p.name}
                      </button>
                      <LifecycleBadge lifecycle={p.lifecycle} />
                    </div>
                    <span className="block text-[12px] text-muted truncate max-w-[300px]">
                      {[p.categoryName, p.brandName, p.location].filter(Boolean).join(' · ') || 'Sem categoria'}
                    </span>
                  </TD>
                  <TD className="text-[13px] text-muted whitespace-nowrap">{p.sku}</TD>
                  <TD className="text-[13px] text-muted">{p.unit}</TD>
                  <TD align="right" className="tabular whitespace-nowrap font-medium">{formatQuantity(p.balance)}</TD>
                  <TD align="right" className="tabular whitespace-nowrap text-muted">{p.minStock === null ? '—' : formatQuantity(p.minStock)}</TD>
                  <TD><SituationBadge situation={p.situation} /></TD>
                  {canSeeCosts && <TD align="right" className="tabular whitespace-nowrap">{formatMoney(p.stockValue ?? 0)}</TD>}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>

      {!loading && total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between text-[13px] text-muted">
          <span>{total} produtos · página {page} de {pages}</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" icon={ChevronLeft} onClick={() => setPage((p) => p - 1)} disabled={page <= 1}>Anterior</Button>
            <Button variant="secondary" size="sm" trailingIcon={ChevronRight} onClick={() => setPage((p) => p + 1)} disabled={page >= pages}>Próxima</Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductsTab;
