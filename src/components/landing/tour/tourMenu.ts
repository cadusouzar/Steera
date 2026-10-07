import { Clock3, HeartHandshake, KeyRound, LayoutGrid, ShieldCheck, SlidersHorizontal, Users, type LucideIcon } from 'lucide-react';

// Menu lateral da janela do tour: só módulos reais, na mesma ordem do AppSidebar (AppLayout).
// Os dois grupos (Recursos Humanos, Ponto) aparecem sempre abertos. Depois de "Administração de
// Ponto" vem a divisória da seção de administração, como no sistema.

export interface TourMenuItem {
  label: string;
  icon?: LucideIcon;
  /** Item de dentro de um grupo (recuado, sem ícone). */
  sub?: boolean;
  /** Índice do grupo a que o item pertence (o grupo fica em destaque quando um filho está ativo). */
  group?: number;
}

export const TOUR_MENU: TourMenuItem[] = [
  { label: 'Visão Geral', icon: LayoutGrid },
  { label: 'Clientes', icon: HeartHandshake },
  { label: 'Recursos Humanos', icon: Users },
  { label: 'Funcionários', sub: true, group: 2 },
  { label: 'Cargos', sub: true, group: 2 },
  { label: 'Ponto', icon: Clock3 },
  { label: 'Controle de Ponto', sub: true, group: 5 },
  { label: 'Administração de Ponto', sub: true, group: 5 },
  { label: 'Usuários e Acessos', icon: ShieldCheck },
  { label: 'Perfis de Acesso', icon: KeyRound },
  { label: 'Campos Personalizados', icon: SlidersHorizontal },
];

/** Primeiro item da seção de administração (depois da divisória). */
export const TOUR_MENU_ADMIN_START = 8;
export const TOUR_MENU_ITEM_H = 34;
const TOUR_MENU_TOP = 62;
const TOUR_MENU_STEP = 36;
const TOUR_MENU_SECTION_GAP = 17;

/** Topo do item `i` na janela (px). */
export const tourMenuTop = (i: number) =>
  TOUR_MENU_TOP + i * TOUR_MENU_STEP + (i >= TOUR_MENU_ADMIN_START ? TOUR_MENU_SECTION_GAP : 0);

/** Posição da divisória entre as seções. */
export const TOUR_MENU_DIVIDER_Y = tourMenuTop(TOUR_MENU_ADMIN_START - 1) + TOUR_MENU_ITEM_H + Math.round((TOUR_MENU_SECTION_GAP + 2) / 2);

/** Ponto onde o cursor clica no item `i` (sobre o texto do item), em coordenadas da janela. */
export const tourMenuPos = (i: number) => ({
  x: TOUR_MENU[i]?.sub ? 92 : 84,
  y: tourMenuTop(i) + Math.round(TOUR_MENU_ITEM_H / 2) - 3,
});
