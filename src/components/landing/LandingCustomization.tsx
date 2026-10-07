import type { ReactNode } from 'react';
import LandingSection from './LandingSection';

const frame = 'rounded-lg border border-border bg-panel p-4 text-[13px] text-foreground';
const mark = (v: boolean) => (v ? '✓' : '—');

// Recortes desenhados com HTML/Tailwind, imitando as telas reais (decorativos).
const PermissionsSketch = () => {
  const rows = [
    { name: 'Funcionários', ver: true, ger: true, apr: false, scope: 'Equipe' },
    { name: 'Ponto', ver: true, ger: true, apr: true, scope: 'Departamento' },
    { name: 'Clientes', ver: true, ger: false, apr: false, scope: 'Empresa' },
  ];
  const cols = 'grid grid-cols-[1.3fr_0.6fr_0.9fr_0.7fr_1.2fr] gap-2';
  return (
    <div className={frame} aria-hidden="true">
      <div className={`${cols} border-b border-border pb-2 text-[11px] font-medium text-muted`}>
        <span>Perfil: Gestor</span>
        <span className="text-center">Ver</span>
        <span className="text-center">Gerenciar</span>
        <span className="text-center">Aprovar</span>
        <span>Alcance</span>
      </div>
      {rows.map((r) => (
        <div key={r.name} className={`${cols} border-b border-border py-2 last:border-b-0 last:pb-0`}>
          <span className="font-medium">{r.name}</span>
          <span className="text-center">{mark(r.ver)}</span>
          <span className="text-center">{mark(r.ger)}</span>
          <span className="text-center">{mark(r.apr)}</span>
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
    <p className="text-[11px] text-muted">Assunto: Você foi convidado para Padaria Central na Steera</p>
    <p className="mt-3 text-[16px] font-semibold">Você foi convidado</p>
    <p className="mt-2 text-muted">
      Você foi convidado para acessar a <strong className="text-foreground">Padaria Central</strong> na Steera. Clique no
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
