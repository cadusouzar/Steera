import { useEffect, useState, type ReactNode } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import CustomFieldsFormSection from '../CustomFieldsFormSection';
import { Button, Field, Input, Modal, Notice, Select, Switch, Textarea, toast } from '../ui';
import ProductPhoto from './ProductPhoto';
import TaxonomyField from './TaxonomyField';
import {
  createProduct, isFractionalUnit, removeProductPhoto, STOCK_UNITS, toApiNumber, updateProduct, uploadProductPhoto,
  type ProductDetail, type ProductInput, type TaxonomyItem,
} from '../../lib/stock';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Sem produto = cadastro novo. */
  product: ProductDetail | null;
  categories: TaxonomyItem[];
  brands: TaxonomyItem[];
  onTaxonomyCreated: (kind: 'categories' | 'brands', item: TaxonomyItem) => void;
  onSaved: (product: ProductDetail) => void;
  canSeeCosts: boolean;
  canMove: boolean;
  canManageTaxonomy: boolean;
}

interface FormState {
  name: string;
  autoSku: boolean;
  sku: string;
  barcode: string;
  description: string;
  categoryId: string;
  brandId: string;
  unit: string;
  active: boolean;
  location: string;
  referenceCost: string;
  salePrice: string;
  minStock: string;
  targetStock: string;
  initialQuantity: string;
  initialUnitCost: string;
}

const numberText = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v).replace('.', ','));

function initialState(product: ProductDetail | null): FormState {
  return {
    name: product?.name ?? '',
    autoSku: !product,
    sku: product?.sku ?? '',
    barcode: product?.barcode ?? '',
    description: product?.description ?? '',
    categoryId: product?.categoryId ?? '',
    brandId: product?.brandId ?? '',
    unit: product?.unit ?? 'UN',
    active: product ? product.status === 'ACTIVE' : true,
    location: product?.location ?? '',
    referenceCost: numberText(product?.referenceCost),
    salePrice: numberText(product?.salePrice),
    minStock: numberText(product?.minStock),
    targetStock: numberText(product?.targetStock),
    initialQuantity: '',
    initialUnitCost: '',
  };
}

type Errors = Partial<Record<keyof FormState | 'photo', string>>;

function parseLocal(text: string): number | null {
  const api = toApiNumber(text);
  if (api === '') return null;
  const n = Number(api);
  return Number.isFinite(n) ? n : NaN;
}

// Mesmas regras do backend (que continua sendo a fronteira real): só um atalho de UX.
function validate(form: FormState, isCreate: boolean): Errors {
  const errors: Errors = {};
  if (!form.name.trim()) errors.name = 'Informe o nome do produto';
  if (!form.autoSku && !form.sku.trim()) errors.sku = 'Informe o SKU ou marque para gerar automaticamente';
  if (!form.autoSku && form.sku.trim() && !/^[A-Za-z0-9][A-Za-z0-9._\-/ ]*$/.test(form.sku.trim())) {
    errors.sku = 'Use letras, números e . _ - /';
  }
  const fractional = isFractionalUnit(form.unit);
  const checkQty = (key: 'minStock' | 'targetStock' | 'initialQuantity') => {
    const n = parseLocal(form[key]);
    if (n === null) return n;
    if (Number.isNaN(n) || n < 0) errors[key] = 'Informe um número válido';
    else if (!fractional && !Number.isInteger(n)) errors[key] = `A unidade ${form.unit} só aceita números inteiros`;
    return n;
  };
  const checkMoney = (key: 'referenceCost' | 'salePrice' | 'initialUnitCost') => {
    const n = parseLocal(form[key]);
    if (n !== null && (Number.isNaN(n) || n < 0)) errors[key] = 'Informe um valor válido';
    return n;
  };
  const min = checkQty('minStock');
  const target = checkQty('targetStock');
  if (min !== null && target !== null && !errors.minStock && !errors.targetStock && target < min) {
    errors.targetStock = 'O estoque alvo não pode ser menor que o mínimo';
  }
  checkMoney('referenceCost');
  checkMoney('salePrice');
  if (isCreate) {
    const qty = checkQty('initialQuantity');
    const cost = checkMoney('initialUnitCost');
    if (qty !== null && qty > 0 && cost === null && !errors.initialUnitCost) {
      errors.initialUnitCost = 'Informe o custo unitário do saldo inicial (pode ser 0)';
    }
  }
  return errors;
}

const Section = ({ title, description, children }: { title: string; description?: string; children: ReactNode }) => (
  <section className="pt-5 first:pt-0 border-t border-border first:border-t-0 mt-5 first:mt-0">
    <h3 className="text-[14px] font-semibold text-foreground">{title}</h3>
    {description && <p className="text-[13px] text-muted mt-0.5">{description}</p>}
    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-4">{children}</div>
  </section>
);

const ProductFormModal = ({
  open, onClose, product, categories, brands, onTaxonomyCreated, onSaved, canSeeCosts, canMove, canManageTaxonomy,
}: Props) => {
  const isCreate = !product;
  const [form, setForm] = useState<FormState>(() => initialState(product));
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Errors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(initialState(product));
    setCustomFields(product?.customFields ?? {});
    setErrors({});
    setSubmitError(null);
    setPhotoFile(null);
    setRemovePhoto(false);
  }, [open, product]);

  useEffect(() => {
    if (!photoFile) { setPhotoPreview(null); return; }
    const url = URL.createObjectURL(photoFile);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const pickPhoto = (file: File | undefined) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setErrors((prev) => ({ ...prev, photo: 'A foto precisa ser JPG ou PNG' }));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErrors((prev) => ({ ...prev, photo: 'A foto pode ter no máximo 5 MB' }));
      return;
    }
    setErrors((prev) => ({ ...prev, photo: undefined }));
    setRemovePhoto(false);
    setPhotoFile(file);
  };

  const unitLocked = !!product?.hasMovements;
  const nullable = (text: string) => (text.trim() === '' ? null : text.trim());
  const nullableNumber = (text: string) => (text.trim() === '' ? null : toApiNumber(text));

  const submit = async () => {
    const found = validate(form, isCreate);
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;
    setSaving(true);
    setSubmitError(null);
    const input: ProductInput = {
      name: form.name.trim(),
      barcode: nullable(form.barcode),
      description: nullable(form.description),
      categoryId: form.categoryId || null,
      brandId: form.brandId || null,
      unit: form.unit,
      location: nullable(form.location),
      salePrice: nullableNumber(form.salePrice),
      minStock: nullableNumber(form.minStock),
      targetStock: nullableNumber(form.targetStock),
      customFields,
      ...(canSeeCosts ? { referenceCost: nullableNumber(form.referenceCost) } : {}),
    };
    try {
      let saved: ProductDetail;
      if (isCreate) {
        const qty = nullableNumber(form.initialQuantity);
        saved = await createProduct({
          ...input,
          ...(form.autoSku ? {} : { sku: form.sku.trim() }),
          status: form.active ? 'ACTIVE' : 'INACTIVE',
          ...(qty && Number(qty) > 0 ? { initialQuantity: qty, initialUnitCost: toApiNumber(form.initialUnitCost) } : {}),
        });
      } else {
        saved = await updateProduct(product.id, { ...input, sku: form.sku.trim() });
      }
      // A foto vai depois do cadastro (precisa do id). Se só ela falhar, o produto já está salvo.
      try {
        if (photoFile) saved = await uploadProductPhoto(saved.id, photoFile);
        else if (removePhoto && saved.photoUrl) saved = await removeProductPhoto(saved.id);
      } catch (err) {
        toast.success(isCreate ? `Produto cadastrado: ${saved.name}` : `Produto atualizado: ${saved.name}`);
        onSaved(saved);
        setSubmitError(`Produto salvo, mas a foto não foi enviada: ${err instanceof Error ? err.message : 'erro desconhecido'}`);
        setSaving(false);
        return;
      }
      toast.success(isCreate ? `Produto cadastrado: ${saved.name}` : `Produto atualizado: ${saved.name}`);
      onSaved(saved);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Não foi possível salvar o produto.');
    } finally {
      setSaving(false);
    }
  };

  const currentPhoto = removePhoto ? null : product?.photoUrl ?? null;
  const qtyHint = isFractionalUnit(form.unit) ? 'Aceita até 3 casas decimais' : 'Somente números inteiros';

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissable={!saving}
      size="lg"
      title={isCreate ? 'Novo produto' : `Editar ${product.name}`}
      description={isCreate ? 'Só nome e unidade são obrigatórios. O resto pode ser preenchido depois.' : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={submit} loading={saving}>{isCreate ? 'Cadastrar produto' : 'Salvar alterações'}</Button>
        </>
      }
    >
      {submitError && <Notice tone="danger" className="mb-4" onDismiss={() => setSubmitError(null)}>{submitError}</Notice>}

      <Section title="Identificação">
        <Field label="Nome" required htmlFor="product-name" error={errors.name} className="md:col-span-2">
          <Input id="product-name" value={form.name} maxLength={255} onChange={(e) => set('name', e.target.value)} invalid={!!errors.name} />
        </Field>
        <Field
          label="SKU"
          required
          htmlFor="product-sku"
          error={errors.sku}
          hint={isCreate && form.autoSku ? 'Será gerado ao salvar (ex.: PRD-000001)' : 'Código único do produto na empresa'}
        >
          <Input
            id="product-sku"
            value={isCreate && form.autoSku ? '' : form.sku}
            placeholder={isCreate && form.autoSku ? 'Automático' : undefined}
            disabled={isCreate && form.autoSku}
            maxLength={60}
            onChange={(e) => set('sku', e.target.value.toUpperCase())}
            invalid={!!errors.sku}
          />
          {isCreate && (
            <label className="mt-2 flex items-center gap-2 text-[13px] text-muted">
              <input type="checkbox" checked={form.autoSku} onChange={(e) => set('autoSku', e.target.checked)} className="h-4 w-4 accent-foreground" />
              Gerar automaticamente
            </label>
          )}
        </Field>
        <Field label="Código de barras (EAN)" htmlFor="product-barcode" hint="Guardado como texto: zeros à esquerda são mantidos">
          <Input id="product-barcode" value={form.barcode} maxLength={60} inputMode="numeric" onChange={(e) => set('barcode', e.target.value)} />
        </Field>
        <Field
          label="Unidade de medida"
          required
          htmlFor="product-unit"
          hint={unitLocked ? 'Não pode mudar depois que o produto teve movimentações' : qtyHint}
        >
          <Select id="product-unit" value={form.unit} onChange={(e) => set('unit', e.target.value)} disabled={unitLocked}>
            {STOCK_UNITS.map((u) => <option key={u.code} value={u.code}>{`${u.code} — ${u.label}`}</option>)}
          </Select>
        </Field>
        {isCreate && (
          <div className="flex items-end pb-2">
            <Switch checked={form.active} onChange={(v: boolean) => set('active', v)} label={form.active ? 'Produto ativo' : 'Produto inativo'} />
          </div>
        )}
        <Field label="Descrição" htmlFor="product-description" className="md:col-span-2">
          <Textarea id="product-description" rows={3} maxLength={2000} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <div className="md:col-span-2">
          <span className="block text-[13px] font-medium text-foreground mb-1.5">Foto</span>
          <div className="flex items-center gap-4">
            {photoPreview ? (
              <img src={photoPreview} alt="Prévia da foto" className="h-14 w-14 rounded-md border border-border object-cover" />
            ) : (
              <ProductPhoto photoUrl={currentPhoto} name={form.name || 'produto'} />
            )}
            <label className="inline-flex">
              <input type="file" accept="image/jpeg,image/png" className="sr-only" onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ''; }} />
              <span className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-border text-[13px] font-medium text-foreground hover:bg-secondary cursor-pointer focus-within:ring-2 focus-within:ring-foreground">
                <ImagePlus size={15} strokeWidth={1.8} aria-hidden="true" />
                {photoPreview || currentPhoto ? 'Trocar foto' : 'Escolher foto'}
              </span>
            </label>
            {(photoPreview || currentPhoto) && (
              <Button variant="ghost" size="sm" icon={Trash2} onClick={() => { setPhotoFile(null); setRemovePhoto(true); }}>Remover</Button>
            )}
          </div>
          {errors.photo ? <p className="text-[12px] text-danger mt-1.5" role="alert">{errors.photo}</p> : <p className="text-[12px] text-muted mt-1.5">JPG ou PNG, até 5 MB.</p>}
        </div>
      </Section>

      <Section title="Organização">
        <TaxonomyField kind="categories" label="Categoria" items={categories} value={form.categoryId} onChange={(v) => set('categoryId', v)} onCreated={(i) => onTaxonomyCreated('categories', i)} canCreate={canManageTaxonomy} />
        <TaxonomyField kind="brands" label="Marca" items={brands} value={form.brandId} onChange={(v) => set('brandId', v)} onCreated={(i) => onTaxonomyCreated('brands', i)} canCreate={canManageTaxonomy} />
        <Field label="Localização" htmlFor="product-location" hint="Só descritiva, ex.: Prateleira A3 (não separa saldos)">
          <Input id="product-location" value={form.location} maxLength={120} onChange={(e) => set('location', e.target.value)} />
        </Field>
        <Field label="Fornecedor principal" htmlFor="product-supplier" hint="Disponível quando o cadastro de fornecedores existir">
          <Input id="product-supplier" value="" disabled placeholder="Em breve" />
        </Field>
      </Section>

      <Section title="Valores" description="Alterar estes valores não muda o valor do estoque já registrado.">
        <Field label="Preço de venda" htmlFor="product-price" error={errors.salePrice}>
          <Input id="product-price" inputMode="decimal" placeholder="0,00" value={form.salePrice} onChange={(e) => set('salePrice', e.target.value)} invalid={!!errors.salePrice} />
        </Field>
        {canSeeCosts && (
          <Field label="Custo de referência" htmlFor="product-refcost" error={errors.referenceCost} hint="Sugerido nas próximas entradas">
            <Input id="product-refcost" inputMode="decimal" placeholder="0,00" value={form.referenceCost} onChange={(e) => set('referenceCost', e.target.value)} invalid={!!errors.referenceCost} />
          </Field>
        )}
      </Section>

      <Section title="Controle">
        <Field label={`Estoque mínimo (${form.unit})`} htmlFor="product-min" error={errors.minStock} hint="Vazio desliga o alerta de estoque baixo">
          <Input id="product-min" inputMode="decimal" value={form.minStock} onChange={(e) => set('minStock', e.target.value)} invalid={!!errors.minStock} />
        </Field>
        <Field label={`Estoque alvo (${form.unit})`} htmlFor="product-target" error={errors.targetStock} hint="Usado na reposição; não pode ser menor que o mínimo">
          <Input id="product-target" inputMode="decimal" value={form.targetStock} onChange={(e) => set('targetStock', e.target.value)} invalid={!!errors.targetStock} />
        </Field>
        {isCreate && canMove && (
          <>
            <Field label={`Quantidade inicial (${form.unit})`} htmlFor="product-initial" error={errors.initialQuantity} hint="Opcional. Gera a movimentação de saldo inicial.">
              <Input id="product-initial" inputMode="decimal" value={form.initialQuantity} onChange={(e) => set('initialQuantity', e.target.value)} invalid={!!errors.initialQuantity} />
            </Field>
            {parseLocal(form.initialQuantity) !== null && (parseLocal(form.initialQuantity) ?? 0) > 0 && (
              <Field label="Custo unitário do saldo inicial" required htmlFor="product-initial-cost" error={errors.initialUnitCost}>
                <Input id="product-initial-cost" inputMode="decimal" placeholder="0,00" value={form.initialUnitCost} onChange={(e) => set('initialUnitCost', e.target.value)} invalid={!!errors.initialUnitCost} />
              </Field>
            )}
          </>
        )}
      </Section>

      <CustomFieldsFormSection
        entity="product"
        values={customFields}
        onChange={setCustomFields}
        applyDefaults={isCreate}
        highlightMissing={product?.missingRequiredCustomFields.map((f) => f.columnName) ?? []}
      />
    </Modal>
  );
};

export default ProductFormModal;
