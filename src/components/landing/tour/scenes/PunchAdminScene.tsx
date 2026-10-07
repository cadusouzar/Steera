import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, Check, ClipboardList, FileText, Settings, Wrench, X } from 'lucide-react';
import { StatusBadge } from '../../../ui';
import type { TourViewProps } from '../tourTypes';
import { Backdrop, FakeButton, FakeField, FakeSegmented, FakeSwitch, FakeTabs, Screen, TourModal, type FakeTab } from './tourParts';
import { EASE } from './tourMotion';

// Cena "Administração de ponto" do tour (roteiro `admin` do esboço): a tela do gestor
// (pages/app/TimeTrackingAdmin) — aba Ajustes, "Aprovar" o pedido de Fernanda Rocha, "Rejeitar" o de
// Carla Mendes com o motivo (obrigatório, numa janela própria, como no sistema), depois a aba
// Configuração: liga "Exigir localização" e "Salvar regras".
// sub: 0 Inconsistências · 1 Ajustes · 2 Fernanda aprovada · 3 janela de rejeição · 4 Carla
// rejeitada · 5 Configuração · 6 localização ligada · 7 regras salvas.
// typed.typedA: 1 motivo da rejeição.
// Geometria (área de conteúdo 870 × 608; somar 230/52 para a janela): abas em y 96–140, a partir de
// x 32 — Ajustes x 178–274, Configuração x 580–712; tabela de ajustes com linhas de 72 px;
// "Aprovar"/"Rejeitar" da 1ª linha centrados em y 326 (x 671 e 771); janela de rejeição x 225–645 a partir de y 120; chaves das regras
// à direita (x 783–827), "Exigir localização" na 2ª linha.

const TABS: FakeTab[] = [
  { label: 'Inconsistências', icon: AlertTriangle, left: 0, width: 142 },
  { label: 'Ajustes', icon: ClipboardList, left: 146, width: 96 },
  { label: 'Justificativas', icon: FileText, left: 246, width: 136 },
  { label: 'Correção proativa', icon: Wrench, left: 386, width: 158 },
  { label: 'Configuração', icon: Settings, left: 548, width: 132 },
];

interface Request { name: string; date: string; type: string; detail?: string; reason: string }

const FERNANDA: Request = { name: 'Fernanda Rocha', date: '28/09/2026', type: 'Remover uma marcação errada', reason: 'Bati por engano quando passei na loja à noite; não houve hora extra.' };
const CARLA: Request = { name: 'Carla Mendes', date: '21/09/2026', type: 'Corrigir o horário de uma marcação', detail: 'Saída às 18:02', reason: 'Saí às 18:02; bati só quando lembrei, já em casa.' };
const DIEGO: Request = { name: 'Diego Araújo', date: '24/09/2026', type: 'Adicionar marcação esquecida', detail: 'Saída às 18:00', reason: 'O celular descarregou e não consegui bater o resto do dia.' };

const REJECT_REASON = 'Sem comprovante do horário. Envie o print do celular ou fale com o RH.';

const INCONSISTENCIES: Array<[string, string, string, string, 'danger' | 'warning']> = [
  ['Diego Araújo', 'Entrada', '06/10/2026, 09:06', 'Fora da área', 'danger'],
  ['Diego Araújo', 'Entrada', '05/10/2026, 08:56', 'Imprecisa', 'warning'],
  ['Bruno Lima', 'Saída', '02/10/2026, 18:07', 'Fora da área', 'danger'],
  ['Bruno Lima', 'Entrada', '02/10/2026, 08:53', 'Fora da área', 'danger'],
];

const RULES: Array<[string, string]> = [
  ['Exigir foto', 'O funcionário tira uma selfie ao bater o ponto.'],
  ['Exigir localização', 'A marcação só é enviada com a localização do aparelho.'],
  ['Aceitar sem localização, para análise', 'Em vez de bloquear, a marcação entra em Inconsistências.'],
  ['Permitir períodos extras', 'Libera Entrada extra e Saída extra depois da saída.'],
];

const Intro = ({ title, description, action }: { title: string; description: string; action?: ReactNode }) => (
  <div className="mb-4 flex items-end justify-between gap-6">
    <div className="max-w-[430px]">
      <p className="text-[15.5px] font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-[13px] leading-snug text-muted">{description}</p>
    </div>
    {action}
  </div>
);

const INC_COLS = 'grid grid-cols-[1.2fr_0.8fr_1.2fr_1fr] items-center gap-3';
const REQ_COLS = 'grid grid-cols-[0.85fr_1.2fr_1.3fr_80px_196px] items-start gap-3';

const InconsistenciesTab = () => (
  <>
    <Intro
      title="Marcações com inconsistência"
      description="Fora da área configurada ou com localização exigida e indisponível. A marcação nunca é rejeitada: fica registrada para análise."
    />
    <div className="overflow-hidden rounded-lg border border-border bg-panel shadow-sm">
      <div className={`${INC_COLS} h-10 border-b border-border px-5 text-[12.5px] font-medium text-muted`}>
        <span>Funcionário</span><span>Marcação</span><span>Data e hora</span><span>Localização</span>
      </div>
      {INCONSISTENCIES.map(([name, mark, when, loc, tone]) => (
        <div key={when} className={`${INC_COLS} h-[46px] border-b border-border px-5 text-[13px] last:border-b-0`}>
          <span className="text-foreground">{name}</span>
          <span className="text-muted">{mark}</span>
          <span className="tabular-nums text-muted">{when}</span>
          <span><StatusBadge tone={tone}>{loc}</StatusBadge></span>
        </div>
      ))}
    </div>
  </>
);

const AdjustmentsTab = ({ sub }: { sub: number }) => {
  const reduceMotion = useReducedMotion();
  const rows = [...(sub < 2 ? [FERNANDA] : []), ...(sub < 4 ? [CARLA] : []), DIEGO];
  return (
    <>
      <Intro
        title="Solicitações de ajuste"
        description="Aprovar cria uma nova marcação com trilha de auditoria; a original nunca é alterada. Rejeitar exige um motivo, que o funcionário vê."
        action={<FakeSegmented options={['Pendente', 'Aprovada', 'Rejeitada', 'Cancelada', 'Todas']} active={0} />}
      />
      <div className="overflow-hidden rounded-lg border border-border bg-panel shadow-sm">
        <div className={`${REQ_COLS} h-10 items-center border-b border-border px-5 text-[12.5px] font-medium text-muted`}>
          <span className="self-center">Funcionário</span><span className="self-center">Pedido</span>
          <span className="self-center">Motivo do funcionário</span><span className="self-center">Situação</span><span />
        </div>
        <AnimatePresence initial={false}>
          {rows.map((r) => (
            <motion.div
              key={r.name}
              layout={!reduceMotion}
              className={`${REQ_COLS} h-[72px] overflow-hidden border-b border-border px-5 py-3 text-[13px] last:border-b-0`}
              exit={reduceMotion ? undefined : { opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0 }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              <span className="min-w-0">
                <span className="block truncate text-foreground">{r.name}</span>
                <span className="block text-[12px] tabular-nums text-muted">{r.date}</span>
              </span>
              <span className="min-w-0">
                <span className="block text-[12.5px] leading-snug text-foreground">{r.type}</span>
                {r.detail && <span className="block text-[11.5px] text-muted">{r.detail}</span>}
              </span>
              <span className="line-clamp-2 text-[12.5px] text-foreground">{r.reason}</span>
              <span><StatusBadge tone="warning">Pendente</StatusBadge></span>
              <span className="flex items-center justify-end gap-1.5">
                <FakeButton variant="secondary" size="sm" icon={Check}>Aprovar</FakeButton>
                <FakeButton variant="ghost" size="sm" icon={X}>Rejeitar</FakeButton>
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </>
  );
};

const SettingsTab = ({ sub }: { sub: number }) => (
  <div className="rounded-lg border border-border bg-panel shadow-sm">
    <div className="flex h-[58px] items-center justify-between px-5">
      <p className="text-[14.5px] font-semibold text-foreground">Regras para bater ponto</p>
      <FakeSegmented options={['Empresa', 'Minha equipe']} active={0} />
    </div>
    <div className="px-5 pb-5">
      <p className="mb-4 text-[13px] text-muted">Nenhuma regra vem pré-definida: ligue o que a empresa exige.</p>
      <div className="divide-y divide-border rounded-md border border-border">
        {RULES.map(([label, description], i) => (
          <div key={label} className="px-4 py-3">
            <FakeSwitch label={label} description={description} on={i === 3 || (i === 1 && sub >= 6)} />
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-end">
        <FakeButton>Salvar regras</FakeButton>
      </div>
    </div>
  </div>
);

const RejectModal = ({ t }: { t: number }) => (
  <TourModal left={225} top={120} width={420}>
    <div className="flex items-start justify-between gap-4 px-6 pb-4 pt-5">
      <div>
        <p className="text-[17px] font-semibold text-foreground">Rejeitar solicitação de ajuste</p>
        <p className="mt-1 text-[13px] leading-snug text-muted">Carla Mendes · 21/09/2026 · Corrigir o horário de uma marcação</p>
      </div>
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted"><X size={17} strokeWidth={1.8} /></span>
    </div>
    <div className="px-6 pb-5">
      <FakeField
        label="Motivo da rejeição" required rows={3} value={t >= 1 ? REJECT_REASON : ''} focused={t <= 1}
        hint="O funcionário vê este motivo no espelho de ponto dele."
      />
    </div>
    <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
      <FakeButton variant="secondary">Cancelar</FakeButton>
      <FakeButton variant="danger" dim={t < 1}>Rejeitar</FakeButton>
    </div>
  </TourModal>
);

const PunchAdminScene = ({ sub, typed }: TourViewProps) => {
  const t = typed.typedA ?? 0;
  const tab = sub === 0 ? 0 : sub <= 4 ? 1 : 4;
  return (
    <div className="absolute inset-0">
      <div className="absolute left-8 top-6">
        <p className="text-[28px] font-semibold leading-tight tracking-tight text-foreground">Administração de ponto</p>
        <p className="mt-1 text-[14px] text-muted">Analise inconsistências, aprove ou rejeite ajustes e justificativas, corrija marcações e configure as regras.</p>
      </div>
      <div className="absolute left-8 right-8 top-24"><FakeTabs tabs={TABS} active={tab} /></div>
      <div className="absolute inset-x-8 bottom-0 top-[160px]">
        <AnimatePresence initial={false}>
          <Screen key={tab}>
            {tab === 0 && <InconsistenciesTab />}
            {tab === 1 && <AdjustmentsTab sub={sub} />}
            {tab === 4 && <SettingsTab sub={sub} />}
          </Screen>
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {sub === 3 && <Backdrop key="backdrop" />}
        {sub === 3 && <RejectModal key="reject" t={t} />}
      </AnimatePresence>
    </div>
  );
};

export default PunchAdminScene;
