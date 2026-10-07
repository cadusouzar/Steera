import type { TourSceneDef } from './tourTypes';
import OverviewScene from './scenes/OverviewScene';
import EmployeesScene from './scenes/EmployeesScene';
import VacationScene from './scenes/VacationScene';
import RolesScene from './scenes/RolesScene';
import PunchScene, { PUNCH_REGISTER_CLICK_MS } from './scenes/PunchScene';
import PunchAdminScene from './scenes/PunchAdminScene';
import ClientsScene from './scenes/ClientsScene';

// Roteiro do tour da página inicial (07/10/2026), portado do `STEPS` do esboço
// (`ideia site/Site.dc.html`). Tempos em ms desde o início da cena; o clique no menu acontece em
// 800 ms (TourPlayer) e só então a tela da cena aparece. Coordenadas (x, y) na janela inteira
// (TOUR_W × TOUR_H): área de conteúdo começa em (230, 52) — cada cena documenta onde ficam os
// elementos que o cursor procura. Notificações usam as mensagens reais do sistema.

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
    caption: 'Férias e afastamentos: na ficha de Diego Araújo, um período de férias e um afastamento são agendados sem conflito de datas.',
    menu: 3,
    end: 16000,
    acts: [
      { x: 965, y: 402, move: 1500, click: 2100 }, // "Pagamentos e férias" de Diego Araújo
      { x: 538, y: 195, move: 3000, click: 3600 }, // aba "Férias"
      { x: 891, y: 253, move: 4400, click: 5000 }, // "Agendar férias"
      { x: 878, y: 405, move: 6400, click: 7000, toast: 'Férias agendadas: Diego Araújo' }, // "Agendar férias" (enviar)
      { x: 650, y: 195, move: 8400, click: 9000 }, // aba "Afastamento"
      { x: 869, y: 253, move: 9800, click: 10400 }, // "Agendar afastamento"
      { x: 855, y: 499, move: 12500, click: 13100, toast: 'Afastamento agendado: Diego Araújo' }, // "Agendar afastamento" (enviar)
    ],
    typing: [[5500, 1, 'typedV'], [6000, 2, 'typedV'], [10900, 3, 'typedV'], [11400, 4, 'typedV'], [11900, 5, 'typedV']],
    View: VacationScene,
  },
  {
    key: 'cargos',
    label: 'Cargos',
    caption: 'Cargos: o cargo Coordenador é cadastrado com departamento, cor e atribuições; depois o cargo Gerente é atualizado.',
    menu: 4,
    end: 13000,
    acts: [
      { x: 998, y: 99, move: 1500, click: 2100 }, // "Novo cargo"
      { x: 686, y: 318, move: 3300, click: 3900 }, // cor verde-água
      { x: 920, y: 123, move: 5000, click: 5600, toast: 'Cargo cadastrado: Coordenador' }, // "Salvar cargo"
      { x: 330, y: 310, move: 6800, click: 7400 }, // linha "Gerente"
      { x: 707, y: 428, move: 8300, click: 8900 }, // cor vermelha
      { x: 1002, y: 624, move: 9700, click: 10300, toast: 'Cargo atualizado: Gerente' }, // "Salvar alterações"
    ],
    typing: [[2500, 1, 'typedK'], [3000, 2, 'typedK'], [4300, 3, 'typedK'], [7900, 4, 'typedK']],
    View: RolesScene,
  },
  {
    key: 'ponto',
    label: 'Bater ponto',
    caption: 'Bater ponto: a entrada é registrada às 08:02 e, no espelho do dia, um ajuste de horário é solicitado com a explicação.',
    menu: 6,
    end: 13000,
    acts: [
      { x: 397, y: 285, move: 1500, click: 2100 }, // "Registrar entrada"
      { x: 784, y: 397, move: PUNCH_REGISTER_CLICK_MS - 600, click: PUNCH_REGISTER_CLICK_MS, toast: 'Entrada registrada às 08:02' }, // "Registrar"
      { x: 1035, y: 571, move: 4900, click: 5500 }, // ajuste do dia de hoje
      { x: 880, y: 196, move: 6200, click: 6800 }, // "O que precisa ser ajustado"
      { x: 880, y: 276, move: 7400, click: 8000 }, // "Corrigir o horário de uma marcação"
      { x: 1001, y: 633, move: 9800, click: 10400, toast: 'Solicitação de ajuste enviada' }, // "Enviar solicitação"
    ],
    typing: [[8400, 1, 'typedP'], [9000, 2, 'typedP']],
    View: PunchScene,
  },
  {
    key: 'admin',
    label: 'Administração de ponto',
    caption: 'Administração de ponto: o gestor aprova o ajuste de Fernanda Rocha, rejeita o de Carla Mendes informando o motivo e liga uma regra do ponto.',
    menu: 7,
    end: 15000,
    acts: [
      { x: 456, y: 170, move: 1500, click: 2100 }, // aba "Ajustes"
      { x: 901, y: 378, move: 3000, click: 3600, toast: 'Ajuste aprovado: Fernanda Rocha' }, // "Aprovar" (Fernanda)
      { x: 1001, y: 378, move: 4800, click: 5400 }, // "Rejeitar" (Carla)
      { x: 809, y: 447, move: 7000, click: 7600, toast: 'Ajuste rejeitado: Carla Mendes' }, // "Rejeitar" (janela)
      { x: 876, y: 170, move: 8800, click: 9400 }, // aba "Configuração"
      { x: 1008, y: 399, move: 10300, click: 10900 }, // chave "Exigir localização"
      { x: 987, y: 608, move: 11800, click: 12400, toast: 'Regras do ponto salvas' }, // "Salvar regras"
    ],
    typing: [[5900, 1, 'typedA']],
    View: PunchAdminScene,
  },
  {
    key: 'clientes',
    label: 'Clientes e cobrança',
    caption: 'Clientes e cobrança: um cliente novo é cadastrado e, na ficha do Mercado São Jorge, o lançamento atrasado é marcado como pago.',
    menu: 1,
    end: 13500,
    acts: [
      { x: 1002, y: 99, move: 1500, click: 2100 }, // "Novo cliente"
      { x: 913, y: 123, move: 4200, click: 4800, toast: 'Cliente cadastrado: Restaurante Sabor da Casa' }, // "Salvar cliente"
      { x: 330, y: 410, move: 6200, click: 6800 }, // linha "Mercado São Jorge"
      { x: 977, y: 556, move: 8000, click: 8600, toast: 'Lançamento marcado como pago' }, // "Marcar como pago"
      { x: 1060, y: 84, move: 10200, click: 10800 }, // fechar a ficha
    ],
    typing: [[2500, 1, 'typedC'], [2900, 2, 'typedC'], [3300, 3, 'typedC'], [3700, 4, 'typedC']],
    View: ClientsScene,
  },
];
