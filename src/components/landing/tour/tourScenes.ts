import { createElement } from 'react';
import type { TourSceneDef, TourViewProps } from './tourTypes';
import OverviewScene from './scenes/OverviewScene';
import EmployeesScene from './scenes/EmployeesScene';
import PlaceholderScene from './scenes/PlaceholderScene';

// Roteiro do tour da página inicial (07/10/2026), portado do `STEPS` do esboço
// (`ideia site/Site.dc.html`). Tempos em ms desde o início da cena; o clique no menu acontece em
// 700 ms (TourPlayer) e só então a tela da cena aparece. Coordenadas (x, y) na janela inteira
// (TOUR_W × TOUR_H): área de conteúdo começa em (230, 52) — cada cena documenta onde ficam os
// elementos que o cursor procura. Notificações usam as mensagens reais do sistema.

const placeholder = (title: string, description: string) => {
  const View = (props: TourViewProps) => createElement(PlaceholderScene, { ...props, title, description });
  View.displayName = `TourPlaceholder(${title})`;
  return View;
};

export const TOUR_SCENES: TourSceneDef[] = [
  {
    key: 'overview',
    label: 'Visão geral',
    caption: 'Visão geral: o painel mostra funcionários ativos, clientes, valores recebidos e a receber e as pendências de ponto.',
    menu: 0,
    end: 6000,
    // Só aponta: o card "Pendências de ponto" e a fila "Aguardando análise".
    acts: [
      { x: 972, y: 201, move: 1500 },
      { x: 798, y: 486, move: 3300 },
    ],
    View: OverviewScene,
  },
  {
    key: 'func',
    label: 'Funcionários',
    caption: 'Funcionários: cadastro de Marina Alves com nome, CPF, cargo, superior e salário; ela aparece na lista em seguida.',
    menu: 3,
    end: 10500,
    acts: [
      { x: 980, y: 99, move: 1700, click: 2300 }, // "Novo funcionário"
      { x: 565, y: 198, move: 4000, click: 4500 }, // aba "Cargo e vínculo"
      { x: 691, y: 198, move: 6200, click: 6700 }, // aba "Financeiro"
      { x: 905, y: 123, move: 7700, click: 8300, toast: 'Funcionário cadastrado: Marina Alves' }, // "Salvar funcionário"
    ],
    typing: [[2700, 1, 'typedF'], [3100, 2, 'typedF'], [3500, 3, 'typedF'], [4900, 4, 'typedF'], [5300, 5, 'typedF'], [5700, 6, 'typedF'], [7100, 7, 'typedF']],
    View: EmployeesScene,
  },
  {
    key: 'ferias',
    label: 'Férias e afastamentos',
    caption: 'Férias e afastamentos: na ficha do funcionário, um período de férias é agendado sem conflito de datas.',
    menu: 3,
    end: 6000,
    acts: [],
    View: placeholder('Funcionários', 'Pagamentos, férias e afastamentos de cada pessoa.'),
  },
  {
    key: 'cargos',
    label: 'Cargos',
    caption: 'Cargos: um novo cargo é cadastrado com departamento e cor.',
    menu: 4,
    end: 6000,
    acts: [],
    View: placeholder('Cargos', 'Os cargos da empresa. Eles aparecem no cadastro de funcionários.'),
  },
  {
    key: 'ponto',
    label: 'Bater ponto',
    caption: 'Bater ponto: o funcionário registra a entrada pelo navegador.',
    menu: 6,
    end: 6000,
    acts: [],
    View: placeholder('Controle de Ponto', 'Registre suas marcações e acompanhe o espelho do mês.'),
  },
  {
    key: 'admin',
    label: 'Administração de ponto',
    caption: 'Administração de ponto: o gestor aprova um ajuste e rejeita outro informando o motivo.',
    menu: 7,
    end: 6000,
    acts: [],
    View: placeholder('Administração de Ponto', 'Ajustes, justificativas e configuração do ponto da equipe.'),
  },
  {
    key: 'clientes',
    label: 'Clientes e cobrança',
    caption: 'Clientes e cobrança: na ficha do cliente, um lançamento é marcado como pago.',
    menu: 1,
    end: 6000,
    acts: [],
    View: placeholder('Clientes', 'Clientes, assinaturas e lançamentos da empresa.'),
  },
];
