import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, Ban, Check, ChevronRight, Plus, Search } from 'lucide-react';
import { StatusBadge } from '../../../ui';
import { ROLE_COLOR_SWATCHES } from '../../../../lib/roleFields';
import type { TourViewProps } from '../tourTypes';
import { Backdrop, FakeButton, FakeField, FakeSegmented, RowFlash, Screen, TourDrawer } from './tourParts';
import { EASE } from './tourMotion';

// Cena "Cargos" do tour (roteiro `cargos` do esboço): lista de cargos (pages/app/Roles) → "Novo
// cargo" → formulário (pages/app/RoleForm) com nome, departamento, cor e atribuições → "Salvar
// cargo" → Coordenador aparece no topo; depois a linha "Gerente" abre a ficha na gaveta lateral, as
// atribuições e a cor mudam e "Salvar alterações" grava.
// sub: 0 lista · 1 formulário · 2 cor escolhida · 3 lista com Coordenador · 4 gaveta do Gerente ·
// 5 cor nova · 6 lista com o Gerente atualizado.
// typed.typedK: 1 nome · 2 departamento · 3 atribuições do Coordenador · 4 atribuições do Gerente.
// Geometria (área de conteúdo 870 × 608; somar 230/52 para a janela): "Novo cargo" x 698–838,
// y 28–66; linhas da tabela a partir de y 189, 46 px cada; formulário: "Salvar cargo" x 635–745,
// y 54–88; bolinhas de cor de 32 px, a 1ª centrada em x 162 e as outras a cada 42 px.

const COORD_COLOR = '#14B8A6';
const MANAGER_NEW_COLOR = '#EF4444';
const DEFAULT_COLOR = '#2563EB';

interface RoleRow { name: string; dept: string; color: string; active: boolean }

const ROLES: RoleRow[] = [
  { name: 'Gerente', dept: 'Loja Centro', color: '#2563EB', active: true },
  { name: 'Confeiteira', dept: 'Produção', color: '#EC4899', active: true },
  { name: 'Padeiro', dept: 'Produção', color: '#F97316', active: true },
  { name: 'Atendente', dept: 'Loja Centro', color: '#22C55E', active: true },
  { name: 'Caixa', dept: 'Loja Centro', color: '#EAB308', active: true },
  { name: 'Analista', dept: 'Financeiro', color: '#A855F7', active: true },
  { name: 'Entregador', dept: 'Logística', color: '#3B82F6', active: false },
];
const COORD: RoleRow = { name: 'Coordenador', dept: 'Produção', color: COORD_COLOR, active: true };

const COORD_TEXT = 'Organiza as escalas da produção e acompanha a rotina da equipe.';
const MANAGER_TEXT = 'Lidera a equipe da loja e acompanha as metas do mês.';
const MANAGER_TEXT_NEW = 'Lidera a equipe da loja, aprova as escalas e acompanha as metas do mês.';

const COLS = 'grid grid-cols-[1.6fr_1.2fr_1fr_32px] items-center gap-3';

const ColorPicker = ({ value }: { value: string }) => (
  <div>
    <p className="mb-1.5 text-[12.5px] font-medium text-foreground">Cor de identificação</p>
    <div className="flex gap-2.5">
      {ROLE_COLOR_SWATCHES.map(({ hex }) => {
        const on = hex === value;
        return (
          <span
            key={hex}
            className={`flex h-8 w-8 items-center justify-center rounded-full ring-offset-2 ring-offset-panel transition-shadow duration-200 ${on ? 'ring-2 ring-foreground' : ''}`}
            style={{ backgroundColor: hex }}
          >
            {on && <Check size={15} strokeWidth={2.5} className="text-white" />}
          </span>
        );
      })}
    </div>
    <div className="mt-3 w-[180px]">
      <FakeField label="Código da cor" value={value} />
    </div>
  </div>
);

const ListView = ({ sub }: { sub: number }) => {
  const reduceMotion = useReducedMotion();
  const rows = sub >= 3 ? [COORD, ...ROLES] : ROLES;
  const active = rows.filter((r) => r.active).length;
  return (
    <>
      <div className="absolute left-8 top-6">
        <p className="text-[28px] font-semibold leading-tight tracking-tight text-foreground">Cargos</p>
        <p className="mt-1 text-[14px] text-muted">Os cargos da empresa. Eles aparecem no cadastro de funcionários.</p>
      </div>
      <FakeButton icon={Plus} className="absolute right-8 top-7 h-[38px] w-[140px]">Novo cargo</FakeButton>

      <div className="absolute left-8 right-8 top-24 flex gap-3">
        <div className="flex h-[38px] flex-1 items-center gap-2 rounded-md border border-border bg-panel px-3 text-[13px] text-muted/80">
          <Search size={15} strokeWidth={1.8} className="text-muted" /> Buscar por nome ou departamento
        </div>
        <FakeSegmented options={[`Todos ${rows.length}`, `Ativos ${active}`, `Inativos ${rows.length - active}`]} active={0} />
      </div>

      <div className="absolute left-8 right-8 top-[148px] overflow-hidden rounded-lg border border-border bg-panel shadow-sm">
        <div className={`${COLS} h-10 border-b border-border px-5 text-[12.5px] font-medium text-muted`}>
          <span>Cargo</span>
          <span>Departamento</span>
          <span>Situação</span>
          <span />
        </div>
        {rows.map((r, i) => {
          const isNew = sub === 3 && r === COORD;
          const isEdited = sub >= 6 && r.name === 'Gerente';
          const color = r.name === 'Gerente' && sub >= 6 ? MANAGER_NEW_COLOR : r.color;
          return (
            <motion.div
              key={r.name}
              className={`${COLS} relative h-[46px] border-b border-border px-5 text-[13px] last:border-b-0 ${sub === 4 || sub === 5 ? (r.name === 'Gerente' ? 'bg-secondary/70' : '') : ''}`}
              initial={reduceMotion ? false : isNew ? { opacity: 0, scale: 0.97 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.4, delay: isNew ? 0 : 0.1 + i * 0.05, ease: EASE }}
            >
              {(isNew || isEdited) && <RowFlash />}
              <span className="relative flex min-w-0 items-center gap-2.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full transition-colors duration-300" style={{ backgroundColor: color }} />
                <span className="truncate font-medium text-foreground">{r.name}</span>
              </span>
              <span className="relative truncate text-muted">{r.dept}</span>
              <span className="relative">
                <StatusBadge tone={r.active ? 'success' : 'neutral'}>{r.active ? 'Ativo' : 'Inativo'}</StatusBadge>
              </span>
              <ChevronRight size={16} strokeWidth={1.6} className="relative justify-self-end text-muted" />
            </motion.div>
          );
        })}
      </div>
    </>
  );
};

const FormView = ({ sub, t }: { sub: number; t: number }) => {
  const reduceMotion = useReducedMotion();
  return (
    <>
      <p className="absolute left-[125px] top-5 inline-flex items-center gap-1.5 text-[12.5px] text-muted">
        <ArrowLeft size={14} strokeWidth={1.8} /> Cargos
      </p>
      <p className="absolute left-[125px] top-[42px] text-[26px] font-semibold leading-tight tracking-tight text-foreground">Novo cargo</p>
      <p className="absolute left-[125px] top-[78px] w-[380px] text-[12.5px] leading-snug text-muted">
        Os campos com * são obrigatórios. Os cargos aparecem no cadastro de funcionários.
      </p>
      <FakeButton variant="secondary" size="sm" className="absolute left-[541px] top-[54px] h-[34px] w-[86px]">Cancelar</FakeButton>
      <FakeButton size="sm" className="absolute left-[635px] top-[54px] h-[34px] w-[110px]">Salvar cargo</FakeButton>

      <motion.div
        className="absolute left-[125px] top-[124px] w-[620px] space-y-5 rounded-lg border border-border bg-panel p-5 shadow-sm"
        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.06, ease: EASE }}
      >
        <div className="grid grid-cols-2 gap-4">
          <FakeField label="Nome do cargo" required value={t >= 1 ? 'Coordenador' : ''} placeholder="Ex.: Diretor de arte" focused={t === 1} />
          <FakeField label="Departamento" required value={t >= 2 ? 'Produção' : ''} placeholder="Ex.: Criação" focused={t === 2} />
        </div>
        <ColorPicker value={sub >= 2 ? COORD_COLOR : DEFAULT_COLOR} />
        <FakeField label="Atribuições" rows={3} value={t >= 3 ? COORD_TEXT : ''} focused={t === 3} hint="O que esta pessoa faz no dia a dia." />
      </motion.div>
    </>
  );
};

const ManagerDrawer = ({ sub, t }: { sub: number; t: number }) => (
  <TourDrawer width={560}>
    <div className="border-b border-border px-6 py-4">
      <p className="text-[17px] font-semibold text-foreground">Gerente</p>
      <p className="mt-0.5 text-[13.5px] text-muted">Loja Centro</p>
    </div>
    <div className="flex-1 space-y-5 px-6 py-5">
      <div className="grid grid-cols-2 gap-4">
        <FakeField label="Nome do cargo" required value="Gerente" />
        <FakeField label="Departamento" required value="Loja Centro" />
      </div>
      <FakeField
        label="Atribuições" rows={4} value={t >= 4 ? MANAGER_TEXT_NEW : MANAGER_TEXT} focused={t === 4}
        hint="O que esta pessoa faz no dia a dia."
      />
      <ColorPicker value={sub >= 5 ? MANAGER_NEW_COLOR : '#2563EB'} />
    </div>
    <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
      <FakeButton variant="ghost" icon={Ban} className="mr-auto">Inativar</FakeButton>
      <FakeButton variant="secondary">Cancelar</FakeButton>
      <FakeButton>Salvar alterações</FakeButton>
    </div>
  </TourDrawer>
);

const RolesScene = ({ sub, typed }: TourViewProps) => {
  const t = typed.typedK ?? 0;
  const formOpen = sub === 1 || sub === 2;
  const drawerOpen = sub === 4 || sub === 5;
  return (
    <div className="absolute inset-0">
      <AnimatePresence initial={false}>
        {formOpen ? (
          <Screen key="form"><FormView sub={sub} t={t} /></Screen>
        ) : (
          <Screen key={sub >= 3 ? 'list-added' : 'list'}><ListView sub={sub} /></Screen>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {drawerOpen && <Backdrop key="backdrop" />}
        {drawerOpen && <ManagerDrawer key="drawer" sub={sub} t={t} />}
      </AnimatePresence>
    </div>
  );
};

export default RolesScene;
