import type { ReactNode } from 'react';
import LandingSection from './LandingSection';
import { BRAND_NAME } from '../../lib/brand';

const frame = 'rounded-lg border border-border bg-panel p-4 text-[13px] text-foreground';

// Recortes desenhados com HTML/Tailwind, imitando as telas reais (decorativos).
// Perfil de exemplo montado só com permissões que existem (backend/src/permissions/permission-catalog.ts)
// e em alcances que cada uma aceita; os textos são os da tela Perfis (src/lib/profileEditorModel.ts,
// pages/app/Profiles.tsx). Códigos: funcionarios.ver + funcionarios.gerenciar (EQUIPE), ferias.gerenciar
// (EQUIPE), ponto.registrar (sem alcance), ponto.administrar (EQUIPE — só aceita Equipe ou Empresa),
// clientes.ver (só EMPRESA).
const PERMISSION_ROWS: Array<{ area: string; action: string; scope: string }> = [
  { area: 'Funcionários', action: 'Pode ver, cadastrar e alterar', scope: 'Da equipe que ela coordena' },
  { area: 'Funcionários', action: 'Marcar e cancelar férias e afastamentos', scope: 'Da equipe que ela coordena' },
  { area: 'Ponto', action: 'Bater o próprio ponto', scope: '—' },
  { area: 'Ponto', action: 'Cuidar do ponto de outras pessoas (aprovar ajustes e corrigir horários)', scope: 'Da equipe que ela coordena' },
  { area: 'Clientes', action: 'Pode ver, mas não alterar', scope: 'De todos da empresa' },
];

const PermissionsSketch = () => {
  const cols = 'grid grid-cols-[0.8fr_1.6fr_1.1fr] gap-3';
  return (
    <div className={frame} aria-hidden="true">
      <p className="border-b border-border pb-2 text-[11px] font-medium text-muted">Perfil: Gestor de equipe</p>
      <div className={`${cols} border-b border-border py-2 text-[11px] font-medium text-muted`}>
        <span>Área</span>
        <span>O que pode fazer</span>
        <span>Alcance</span>
      </div>
      {PERMISSION_ROWS.map((r) => (
        <div key={r.action} className={`${cols} border-b border-border py-2 last:border-b-0 last:pb-0`}>
          <span className="font-medium">{r.area}</span>
          <span>{r.action}</span>
          <span className="text-muted">{r.scope}</span>
        </div>
      ))}
    </div>
  );
};

const FieldsSketch = () => {
  const rows = [
    ['Aniversário da empresa', 'Data'],
    ['Limite de crédito', 'Valor'],
    ['CNPJ da matriz', 'CNPJ'],
    ['Tamanho do uniforme', 'Lista'],
  ];
  return (
    <div className={frame} aria-hidden="true">
      <p className="border-b border-border pb-2 text-[11px] font-medium text-muted">Campos de Clientes</p>
      {rows.map(([name, type]) => (
        <div key={name} className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-b-0 last:pb-0">
          <span className="font-medium">{name}</span>
          <span className="text-muted">{type}</span>
        </div>
      ))}
    </div>
  );
};

const InviteSketch = () => (
  <div className={frame} aria-hidden="true">
    <p className="text-[11px] text-muted">Assunto: Você foi convidado para Padaria Central na {BRAND_NAME}</p>
    <p className="mt-3 text-[16px] font-semibold">Você foi convidado</p>
    <p className="mt-2 text-muted">
      Você foi convidado para acessar a <strong className="text-foreground">Padaria Central</strong> na {BRAND_NAME}. Clique no
      botão abaixo para criar sua senha e acessar o sistema.
    </p>
    <p className="mt-2 text-muted">Este link expira em 72 horas.</p>
    <span className="mt-4 inline-flex h-9 items-center rounded-md bg-primary px-4 text-[13px] font-medium text-primary-foreground">
      Aceitar convite
    </span>
  </div>
);

const ROWS: Array<{ title: string; text: string; sketch: ReactNode }> = [
  {
    title: 'Cada pessoa vê só o que deve.',
    text: 'Perfis de acesso por ação — ver, gerenciar, aprovar — e por alcance: só a própria ficha, a equipe, o departamento ou a empresa toda.',
    sketch: <PermissionsSketch />,
  },
  {
    title: 'Campos que só a sua empresa usa.',
    text: 'Acrescente campos a clientes, cargos e funcionários: texto, número, valor, data, sim/não, lista, e-mail, telefone, CPF e CNPJ (com validação).',
    sketch: <FieldsSketch />,
  },
  {
    title: 'Convide a equipe por e-mail.',
    text: 'Cada funcionário recebe um convite e cria a própria senha; o ponto e os pedidos de ajuste ficam no login dele.',
    sketch: <InviteSketch />,
  },
];

const LandingCustomization = () => (
  <LandingSection id="personalizacao" label="Personalização" title="Do jeito que a sua empresa trabalha.">
    <div>
      {ROWS.map((r, i) => (
        <div
          key={r.title}
          className="border-t border-border py-8 grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-14 items-center first:border-t-0 first:pt-0"
        >
          <div className={i % 2 === 1 ? 'md:order-2' : ''}>
            <h3 className="text-[20px] font-semibold tracking-tight text-foreground">{r.title}</h3>
            <p className="mt-2 max-w-[50ch] text-muted">{r.text}</p>
          </div>
          <div className={`min-w-0 ${i % 2 === 1 ? 'md:order-1' : ''}`}>{r.sketch}</div>
        </div>
      ))}
    </div>
  </LandingSection>
);

export default LandingCustomization;
