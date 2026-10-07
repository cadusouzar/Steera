import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Mascot from '../Mascot';
import { buttonClass } from '../ui';

// Chamada final da página inicial (07/10/2026, a partir do print do usuário): cartão creme com o Stee à
// esquerda. Usa a paleta quente das telas de entrada (`.auth-page`, `--a-*`), que tem versão clara e escura.
// O Stee só aparece no login e no cadastro, então o texto promete exatamente isso.
const LandingFinalCta = () => {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // O olhar do Stee acompanha o cursor, como no login (o próprio componente suaviza o movimento).
  useEffect(() => {
    let frame = 0;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setMousePos({ x: e.clientX, y: e.clientY }));
    };
    window.addEventListener('mousemove', onMove);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('mousemove', onMove);
    };
  }, []);

  return (
    <section className="max-w-[1180px] mx-auto px-4 sm:px-6 py-16 sm:py-24">
      <div className="auth-page grid items-center gap-6 rounded-2xl border border-[var(--a-cream-border)] bg-[var(--a-cream)] px-6 py-10 sm:px-12 md:grid-cols-[5fr_7fr] md:gap-10 md:py-12">
        <div className="flex justify-center [&>div]:mb-0 [&>div]:h-[180px] [&>div]:w-[200px] md:[&>div]:h-[240px] md:[&>div]:w-[240px]">
          <Mascot mousePosition={mousePos} isCoveringEyes={false} />
        </div>
        <div className="text-center md:text-left">
          <h2 className="font-brand text-[30px] sm:text-[38px] font-semibold leading-[1.1] tracking-tight text-[var(--a-bubble-ink)]">
            Pronto para organizar a casa?
          </h2>
          <p className="mt-3 max-w-[46ch] text-[16px] leading-relaxed text-[var(--a-warm-muted)] md:mx-0 mx-auto">
            Crie sua conta em menos de dois minutos. O Stee te acompanha no cadastro.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3 md:justify-start">
            <Link to="/register" className={buttonClass('primary')}>Criar conta grátis</Link>
            <Link
              to="/login"
              className={buttonClass('secondary', 'md', 'border-[var(--a-cream-border-2)] bg-transparent hover:bg-[var(--a-card)]')}
            >
              Já tenho conta
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
};

export default LandingFinalCta;
