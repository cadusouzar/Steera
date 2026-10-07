import type { ComponentType } from 'react';

/**
 * Um passo do roteiro: em `move` ms o cursor vai até (x, y); em `click` ms ele clica (sub += 1).
 * Sem `click`, o cursor só passa por cima (aponta algo na tela) e `sub` não muda.
 * Coordenadas na janela inteira (TOUR_W × TOUR_H), não na área de conteúdo.
 */
export interface TourAct { x: number; y: number; move: number; click?: number; toast?: string }

/** Estado que a cena recebe para se desenhar: quantos cliques já aconteceram e o que já foi "digitado". */
export interface TourViewProps { sub: number; typed: Record<string, number> }

export interface TourSceneDef {
  key: string;
  /** Texto do botão da cena. */
  label: string;
  /** Uma frase do que a cena mostra (leitor de tela). */
  caption: string;
  /** Item do menu lateral que fica ativo (índice em TOUR_MENU). */
  menu: number;
  /** Duração total da cena em ms (depois disso avança). */
  end: number;
  acts: TourAct[];
  /** [ms, valor, chave] — em `ms`, typed[chave ?? 'typed'] = valor. */
  typing?: Array<[number, number, string?]>;
  View: ComponentType<TourViewProps>;
}

/** Tamanho lógico da janela (coordenadas do roteiro). */
export const TOUR_W = 1100;
export const TOUR_H = 660;

/** Geometria da janela: barra lateral à esquerda e topo; o resto é a área de conteúdo da cena. */
export const TOUR_SIDEBAR_W = 230;
export const TOUR_HEADER_H = 52;

/** Em quantos ms, desde o início de uma cena, o cursor clica no menu e a tela da cena aparece. */
export const TOUR_MENU_CLICK_MS = 800;
