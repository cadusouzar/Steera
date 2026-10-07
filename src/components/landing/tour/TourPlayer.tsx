import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { TOUR_H, TOUR_W } from './tourTypes';
import { TOUR_SCENES } from './tourScenes';
import { tourMenuPos } from './tourMenu';
import TourWindow from './TourWindow';
import TourCursor from './TourCursor';
import TourToast from './TourToast';

// Tour do sistema na página inicial (07/10/2026): executa as cenas de TOUR_SCENES (roteiro portado
// do esboço `ideia site/Site.dc.html`) numa janela de tamanho lógico fixo, reduzida para caber.
// Cada cena começa com o cursor indo até o item do menu e clicando (700 ms) — só então a tela troca,
// como no esboço. Avança sozinho; mouse/foco em cima não deixa trocar de cena; botões e menu trocam
// a cena. Movimento reduzido: sem autoplay nem cursor — mostra o estado final da cena.

const MENU_CLICK_MS = 700;
const CLICK_MS = 450;
const TOAST_MS = 2600;

const TourPlayer = () => {
  const reduceMotion = useReducedMotion();
  /** Cena escolhida (botões, legenda, roteiro em execução). */
  const [step, setStep] = useState(0);
  /** Cena cuja tela está desenhada — troca no clique do menu, um pouco depois de `step`. */
  const [shown, setShown] = useState(0);
  const [sub, setSub] = useState(0);
  const [typed, setTyped] = useState<Record<string, number>>({});
  const [cursor, setCursor] = useState({ x: 520, y: 330, clicking: false });
  const [toast, setToast] = useState('');
  const [scale, setScale] = useState(1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const paused = useRef(false);
  const pendingNext = useRef(false);
  const stepRef = useRef(0);
  // A cena seguinte é chamada pelo timer da anterior: o ref evita a recursão dentro do useCallback.
  const runStepRef = useRef<(i: number) => void>(() => {});

  const clear = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);
  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  const runStep = useCallback((i: number) => {
    clear();
    pendingNext.current = false;
    const scene = TOUR_SCENES[i];
    stepRef.current = i;
    setStep(i);
    setToast('');
    if (reduceMotion) {
      setShown(i);
      setSub(scene.acts.filter((a) => a.click !== undefined).length);
      const finalTyped: Record<string, number> = {};
      (scene.typing ?? []).forEach(([, v, k]) => { finalTyped[k ?? 'typed'] = Math.max(finalTyped[k ?? 'typed'] ?? 0, v); });
      setTyped(finalTyped);
      return;
    }
    const menu = tourMenuPos(scene.menu);
    setCursor((c) => ({ ...c, x: menu.x, y: menu.y, clicking: false }));
    const click = () => {
      setCursor((c) => ({ ...c, clicking: true }));
      later(CLICK_MS, () => setCursor((c) => ({ ...c, clicking: false })));
    };
    later(MENU_CLICK_MS, () => {
      click();
      setShown(i);
      setSub(0);
      setTyped({});
    });
    let clicks = 0;
    scene.acts.forEach((a) => {
      later(a.move, () => setCursor((c) => ({ ...c, x: a.x, y: a.y })));
      if (a.click === undefined) return;
      const n = ++clicks;
      later(a.click, () => {
        click();
        setSub(n);
        if (a.toast) {
          setToast(a.toast);
          later(TOAST_MS, () => setToast((t) => (t === a.toast ? '' : t)));
        }
      });
    });
    (scene.typing ?? []).forEach(([t, v, key]) => later(t, () => setTyped((p) => ({ ...p, [key ?? 'typed']: v }))));
    later(scene.end, () => {
      if (paused.current) { pendingNext.current = true; return; }
      runStepRef.current((i + 1) % TOUR_SCENES.length);
    });
  }, [reduceMotion, clear, later]);

  useEffect(() => {
    runStepRef.current = runStep;
    runStep(0);
    return clear;
  }, [runStep, clear]);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / TOUR_W)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pause = () => { paused.current = true; };
  const resume = () => {
    paused.current = false;
    if (pendingNext.current) {
      pendingNext.current = false;
      runStep((stepRef.current + 1) % TOUR_SCENES.length);
    }
  };

  const clickableMenus = useMemo(() => new Set(TOUR_SCENES.map((s) => s.menu)), []);
  const onMenu = (m: number) => {
    const i = TOUR_SCENES.findIndex((s) => s.menu === m);
    if (i >= 0) runStep(i);
  };

  const View = TOUR_SCENES[shown].View;
  return (
    <div onMouseEnter={pause} onMouseLeave={resume} onFocus={pause} onBlur={resume}>
      <div className="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
        <div ref={wrapRef} className="relative w-full" style={{ height: TOUR_H * scale }}>
          <div aria-hidden="true" className="absolute left-0 top-0 origin-top-left" style={{ width: TOUR_W, height: TOUR_H, transform: `scale(${scale})` }}>
            <TourWindow
              menu={TOUR_SCENES[shown].menu}
              clickable={clickableMenus}
              onMenu={onMenu}
              toast={<TourToast message={toast} />}
              cursor={reduceMotion ? null : <TourCursor x={cursor.x} y={cursor.y} clicking={cursor.clicking} />}
            >
              <View sub={sub} typed={typed} />
            </TourWindow>
          </div>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">{TOUR_SCENES[step].caption}</p>
      <div className="mt-3 flex gap-1.5 overflow-x-auto scrollbar-none sm:flex-wrap" role="group" aria-label="Cenas do tour do sistema">
        {TOUR_SCENES.map((s, i) => (
          <button
            key={s.key}
            type="button"
            aria-pressed={i === step}
            onClick={() => runStep(i)}
            className={`inline-flex h-9 shrink-0 items-center rounded-full border px-3.5 text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
              i === step ? 'border-foreground bg-foreground text-background' : 'border-border bg-panel text-muted hover:text-foreground'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default TourPlayer;
