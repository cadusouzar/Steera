import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { Pause, Play } from 'lucide-react';
import { TOUR_H, TOUR_MENU_CLICK_MS, TOUR_W } from './tourTypes';
import { TourPausedContext } from './tourPause';
import { TOUR_SCENES } from './tourScenes';
import { tourMenuPos } from './tourMenu';
import TourWindow from './TourWindow';
import TourCursor from './TourCursor';
import TourToast from './TourToast';

// Tour do sistema na página inicial (07/10/2026): executa as cenas de TOUR_SCENES (roteiro portado
// do esboço `ideia site/Site.dc.html`) numa janela de tamanho lógico fixo, reduzida para caber.
// Cada cena começa com o cursor indo até o item do menu e clicando (TOUR_MENU_CLICK_MS) — só então a
// tela troca, como no esboço. Avança sozinho; mouse (só mouse de verdade, não toque) ou foco em cima
// não deixa trocar de cena; botões e menu trocam a cena. Movimento reduzido: sem autoplay nem
// cursor — mostra o estado final da cena.
//
// Pausa de verdade ("Pausar", tour fora da tela ou aba escondida): limpa todos os timers e congela a
// tela como está; as cenas com relógio próprio (TourTyped, relógio do Bater ponto) param pelo
// TourPausedContext. Ao continuar, a cena atual recomeça do zero (a View ganha key nova no clique do
// menu). O "Pausar" da pessoa vence: voltar a ver o tour não retoma sozinho.
//
// O relógio do Bater ponto depende de TOUR_MENU_CLICK_MS (a tela monta nesse instante) — ver
// PUNCH_REGISTER_CLICK_MS em scenes/PunchScene.tsx.

// O cursor leva 450 ms até o menu (TourCursor); o clique vem depois que ele chega e para.
const MENU_CLICK_MS = TOUR_MENU_CLICK_MS;
const CLICK_MS = 450;
const TOAST_MS = 2600;

const TourPlayer = () => {
  const reduceMotion = useReducedMotion();
  /** Cena escolhida (botões, legenda, roteiro em execução). */
  const [step, setStep] = useState(0);
  /** Cena cuja tela está desenhada — troca no clique do menu, um pouco depois de `step`. */
  const [shown, setShown] = useState(0);
  /** Conta as vezes que uma tela de cena aparece: vira a `key` da View, então toda execução começa do zero. */
  const [run, setRun] = useState(0);
  const [sub, setSub] = useState(0);
  const [typed, setTyped] = useState<Record<string, number>>({});
  const [cursor, setCursor] = useState({ x: 520, y: 330, clicking: false });
  const [toast, setToast] = useState('');
  const [scale, setScale] = useState(1);
  /** Texto anunciado ao leitor de tela — só quando a pessoa troca a cena (botão ou menu), nunca no autoplay. */
  const [announce, setAnnounce] = useState('');
  /** "Pausar" apertado pela pessoa. */
  const [userPaused, setUserPaused] = useState(false);
  /** Menos de 20% do tour visível na tela. */
  const [offscreen, setOffscreen] = useState(false);
  /** Aba do navegador escondida. */
  const [tabHidden, setTabHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  const frozen = !reduceMotion && (userPaused || offscreen || tabHidden);
  const rootRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  /** Mouse/foco em cima: a cena continua, mas não troca para a seguinte. */
  const held = useRef(false);
  const pendingNext = useRef(false);
  const frozenRef = useRef(false);
  /** Congelou e ainda não recomeçou a cena atual. */
  const needsRestart = useRef(false);
  /**
   * A View montada ainda não foi usada (primeira carga): o clique do menu da primeira execução não
   * troca a key, senão a Visão geral montaria duas vezes (entrada e números animados em dobro).
   * Repetir a mesma cena (ou recomeçar depois de pausar) precisa da key nova para zerar o estado.
   */
  const freshView = useRef(true);
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

  const runStep = useCallback((i: number, byUser = false) => {
    clear();
    if (byUser) {
      setAnnounce(TOUR_SCENES[i].caption);
      // Escolher uma cena com o tour pausado volta a tocar.
      setUserPaused(false);
    }
    needsRestart.current = false;
    pendingNext.current = false;
    const scene = TOUR_SCENES[i];
    stepRef.current = i;
    setStep(i);
    setToast('');
    if (reduceMotion) {
      setShown(i);
      setRun((r) => r + 1);
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
      if (freshView.current) freshView.current = false;
      else setRun((r) => r + 1);
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
      if (held.current) { pendingNext.current = true; return; }
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

  // Congela/descongela quando qualquer motivo de pausa muda.
  useEffect(() => {
    frozenRef.current = frozen;
    if (frozen) {
      clear();
      pendingNext.current = false;
      needsRestart.current = true;
      freshView.current = false;
      setCursor((c) => (c.clicking ? { ...c, clicking: false } : c));
    } else if (needsRestart.current) {
      runStepRef.current(stepRef.current);
    }
  }, [frozen, clear]);

  // Fora da tela (menos de 20% visível) ou aba escondida: pausa sozinho.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setOffscreen(entry.intersectionRatio < 0.2), { threshold: [0, 0.2] });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const onVisibility = () => setTabHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const hold = () => { held.current = true; };
  const release = () => {
    held.current = false;
    if (pendingNext.current && !frozenRef.current) {
      pendingNext.current = false;
      runStep((stepRef.current + 1) % TOUR_SCENES.length);
    }
  };

  const clickableMenus = useMemo(() => new Set(TOUR_SCENES.map((s) => s.menu)), []);
  const onMenu = (m: number) => {
    // Item já ativo: nada a fazer (Funcionários e Férias dividem o mesmo item do menu).
    if (TOUR_SCENES[stepRef.current].menu === m) return;
    const i = TOUR_SCENES.findIndex((s) => s.menu === m);
    if (i >= 0) runStep(i, true);
  };

  // Celular: a barra de cenas rola sozinha até a aba ativa (só a barra, nunca a página).
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = tabsRef.current;
    const tab = strip?.children[step] as HTMLElement | undefined;
    if (!strip || !tab) return;
    const left = tab.offsetLeft - strip.offsetLeft;
    if (left < strip.scrollLeft || left + tab.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollTo({ left: Math.max(0, left - 12), behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  }, [step, reduceMotion]);

  const View = TOUR_SCENES[shown].View;
  return (
    <div
      ref={rootRef}
      // Só mouse: um toque no celular dispara pointerenter sem pointerleave e prenderia o tour.
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') hold(); }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') release(); }}
      onFocus={hold}
      // onBlur do React borbulha: andar com Tab entre os botões não pode retomar (e avançar) no meio.
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) release(); }}
    >
      <div className="mx-auto max-w-[1100px] overflow-hidden rounded-xl border border-border bg-background shadow-[0_24px_60px_-28px_rgba(0,0,0,0.35)]">
        {/* Cenas como abas na moldura da janela (07/10/2026): substituem a fileira de botões que ficava embaixo. */}
        <div className="flex items-stretch border-b border-border bg-panel">
          <div ref={tabsRef} className="flex min-w-0 flex-1 gap-1 overflow-x-auto scrollbar-none px-3" role="group" aria-label="Cenas do tour do sistema">
            {TOUR_SCENES.map((s, i) => (
              <button
                key={s.key}
                type="button"
                aria-pressed={i === step}
                onClick={() => runStep(i, true)}
                className={`relative h-11 shrink-0 whitespace-nowrap px-3 text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground ${
                  i === step ? 'font-medium text-foreground' : 'text-muted hover:text-foreground'
                }`}
              >
                {s.label}
                {i === step && <span aria-hidden="true" className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-foreground" />}
              </button>
            ))}
          </div>
          {!reduceMotion && (
            <button
              type="button"
              onClick={() => setUserPaused((p) => !p)}
              aria-label={userPaused ? 'Continuar o tour' : 'Pausar o tour'}
              className="inline-flex h-11 shrink-0 items-center gap-1.5 border-l border-border px-3.5 sm:px-4 text-[13px] text-muted transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground"
            >
              {userPaused ? <Play size={14} strokeWidth={1.8} aria-hidden="true" /> : <Pause size={14} strokeWidth={1.8} aria-hidden="true" />}
              <span className="hidden sm:inline">{userPaused ? 'Continuar' : 'Pausar'}</span>
            </button>
          )}
        </div>
        <div ref={wrapRef} className="relative w-full" style={{ height: TOUR_H * scale }}>
          {/* Reduz com `zoom`, não com `transform: scale`: o texto é desenhado já no tamanho final, como numa página
              normal. Com scale, o Chrome redesenhava o conteúdo reduzido sempre que um modal/gaveta animava por cima
              (fundo e textos piscavam) e, preso numa camada, trocava a suavização e deixava as letras "em negrito". */}
          <div aria-hidden="true" className="absolute left-0 top-0" style={{ width: TOUR_W, height: TOUR_H, zoom: scale }}>
            <TourWindow
              menu={TOUR_SCENES[shown].menu}
              clickable={clickableMenus}
              onMenu={onMenu}
              toast={<TourToast message={toast} />}
              cursor={reduceMotion ? null : <TourCursor x={cursor.x} y={cursor.y} clicking={cursor.clicking} />}
            >
              <TourPausedContext.Provider value={frozen}>
                <View key={run} sub={sub} typed={typed} />
              </TourPausedContext.Provider>
            </TourWindow>
          </div>
        </div>
      </div>
      <p className="sr-only">{TOUR_SCENES[step].caption}</p>
      <p className="sr-only" aria-live="polite">{announce}</p>
    </div>
  );
};

export default TourPlayer;
