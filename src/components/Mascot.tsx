import React, { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import {
  Fit,
  Layout,
  RuntimeLoader,
  useRive,
  useViewModel,
  useViewModelInstance,
} from '@rive-app/react-canvas';
import riveWasm from '@rive-app/canvas/rive.wasm?url';
import steeRiv from '../assets/mascote/stee.riv?url';
import steePoster from '../assets/mascote/stee-poster.webp';

// Serve o runtime pelo próprio app em vez do unpkg.com (padrão do Rive). A versão de
// @rive-app/canvas fica fixada no package.json igual à usada por @rive-app/react-canvas.
RuntimeLoader.setWasmUrl(riveWasm);

// Começa a baixar/compilar o runtime e o .riv já ao carregar o módulo, em paralelo com o
// resto da página, em vez de só quando o componente monta.
RuntimeLoader.awaitInstance().catch(() => undefined);
fetch(steeRiv).catch(() => undefined);

interface MascotProps {
  mousePosition: { x: number; y: number };
  isCoveringEyes: boolean;
}

// Distância (px) a partir do centro do Stee em que o olhar chega ao máximo.
const ALCANCE_OLHAR = 420;
// Fração do caminho percorrida por quadro: deixa o olhar macio, sem tranco.
const SUAVIZACAO = 0.12;

const limitar = (valor: number) => Math.max(-1, Math.min(1, valor));

/**
 * Stee, o mascote feito no Rive. O .riv expõe o view model `Stee`: `olharX`/`olharY`
 * (-1 a 1) movem olhos e cabeça, e `tapandoOlhos` fecha os olhos (campo de senha).
 * Respirar, piscar e mexer a cauda rodam sozinhos na state machine.
 */
const Mascot: React.FC<MascotProps> = ({ mousePosition, isCoveringEyes }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const alvo = useRef({ x: 0, y: 0 });
  const atual = useRef({ x: 0, y: 0 });
  const reduzirMovimento = useReducedMotion();

  const { rive, RiveComponent } = useRive({
    src: steeRiv,
    stateMachine: 'State Machine 1',
    autoplay: true,
    autoBind: false,
    layout: new Layout({ fit: Fit.Contain }),
  });

  const viewModel = useViewModel(rive, { name: 'Stee' });
  const instancia = useViewModelInstance(viewModel, { rive });
  const [visivel, setVisivel] = useState(false);

  // O Rive fica "pronto" antes de terminar de decodificar as imagens do Stee e, nesse
  // intervalo, desenha um quadro preto "RIVE" de carregamento. No desenho real o ponto a 10%
  // do canto superior é transparente e o rosto é opaco: só mostramos o Stee aí.
  useEffect(() => {
    if (!rive || visivel) return;
    const amostra = document.createElement('canvas');
    amostra.width = 2;
    amostra.height = 1;
    const ctx = amostra.getContext('2d', { willReadFrequently: true });
    let frame = 0;
    const checar = () => {
      // Procurado a cada quadro: o canvas pode ainda não existir quando o Rive fica pronto.
      const canvas = containerRef.current?.querySelector('canvas');
      if (ctx && canvas && canvas.width > 0) {
        ctx.clearRect(0, 0, 2, 1);
        ctx.drawImage(canvas, canvas.width * 0.1, canvas.height * 0.1, 1, 1, 0, 0, 1, 1);
        ctx.drawImage(canvas, canvas.width / 2, canvas.height * 0.3, 1, 1, 1, 0, 1, 1);
        const [, , , alfaCanto, , , , alfaCentro] = ctx.getImageData(0, 0, 2, 1).data;
        if (alfaCanto === 0 && alfaCentro > 0) {
          setVisivel(true);
          return;
        }
      }
      frame = requestAnimationFrame(checar);
    };
    frame = requestAnimationFrame(checar);
    return () => cancelAnimationFrame(frame);
  }, [rive, visivel]);

  // Converte a posição do mouse na direção do olhar (-1 a 1 em cada eixo).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || isCoveringEyes || reduzirMovimento) {
      alvo.current = { x: 0, y: 0 };
      return;
    }
    const rect = el.getBoundingClientRect();
    const centroX = rect.left + rect.width / 2;
    const centroY = rect.top + rect.height * 0.35; // altura dos olhos
    alvo.current = {
      x: limitar((mousePosition.x - centroX) / ALCANCE_OLHAR),
      y: limitar((mousePosition.y - centroY) / ALCANCE_OLHAR),
    };
  }, [mousePosition, isCoveringEyes, reduzirMovimento]);

  useEffect(() => {
    const tapando = instancia?.boolean('tapandoOlhos');
    if (tapando) tapando.value = isCoveringEyes;
  }, [instancia, isCoveringEyes]);

  // Interpola o olhar a cada quadro fora do React (sem re-render por movimento do mouse).
  useEffect(() => {
    const olharX = instancia?.number('olharX');
    const olharY = instancia?.number('olharY');
    if (!olharX || !olharY) return;

    let frame = 0;
    const passo = () => {
      const a = atual.current;
      const t = alvo.current;
      a.x += (t.x - a.x) * SUAVIZACAO;
      a.y += (t.y - a.y) * SUAVIZACAO;
      if (Math.abs(olharX.value - a.x) > 0.001) olharX.value = a.x;
      if (Math.abs(olharY.value - a.y) > 0.001) olharY.value = a.y;
      frame = requestAnimationFrame(passo);
    };
    frame = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(frame);
  }, [instancia]);

  return (
    <div
      ref={containerRef}
      className="relative w-44 h-40 mx-auto mb-2"
      role="img"
      aria-label="Stee, o mascote leão"
    >
      {/* Imagem parada do Stee (mesma pose de repouso do .riv), visível desde o primeiro
          instante; a animação aparece por cima quando o Rive termina de carregar. */}
      <img
        src={steePoster}
        alt=""
        aria-hidden="true"
        decoding="async"
        className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-200 ${visivel ? 'opacity-0' : 'opacity-100'}`}
      />
      <RiveComponent
        className={`relative w-full h-full transition-opacity duration-200 ${visivel ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  );
};

export default Mascot;
