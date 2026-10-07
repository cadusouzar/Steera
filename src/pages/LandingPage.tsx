import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import LandingHero from '../components/landing/LandingHero';
import LandingModules from '../components/landing/LandingModules';
import LandingCustomization from '../components/landing/LandingCustomization';
import LandingSecurity from '../components/landing/LandingSecurity';
import LandingPlans from '../components/landing/LandingPlans';
import LandingFaq from '../components/landing/LandingFaq';
import LandingFinalCta from '../components/landing/LandingFinalCta';
import LandingFooter from '../components/landing/LandingFooter';
import { CheckCircle2, X } from 'lucide-react';

const LandingPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [showRegisteredNotice, setShowRegisteredNotice] = useState(
    () => (location.state as { registered?: boolean } | null)?.registered === true,
  );

  // Limpa o state de navegação depois de copiar o valor pro state local — assim recarregar a
  // página não mostra o aviso de novo (o state não sobrevive a um F5, mas sobrevive a navegações
  // internas subsequentes até ser limpo explicitamente).
  useEffect(() => {
    if ((location.state as { registered?: boolean } | null)?.registered === true) {
      navigate('.', { replace: true, state: null });
    }
  }, [location.state, navigate]);

  // Links da barra são "/#secao" (funcionam de qualquer página do site); o React Router não rola
  // até o hash sozinho, então rola aqui quando o hash muda.
  useEffect(() => {
    if (!location.hash) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' });
  }, [location.hash]);

  return (
    <div className="relative min-h-screen bg-background transition-colors duration-300">
      <Navbar />

      {showRegisteredNotice && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-24 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-md rounded-xl border border-primary/30 bg-panel px-5 py-3 text-sm text-foreground shadow-lg flex items-start gap-3"
        >
          <CheckCircle2 size={18} className="text-primary shrink-0 mt-0.5" />
          <span className="flex-1 min-w-0">
            Conta criada! Use <strong>Entrar no sistema</strong> no topo da página para acessar.
          </span>
          <button
            type="button"
            onClick={() => setShowRegisteredNotice(false)}
            className="text-muted hover:text-foreground transition-colors shrink-0"
            aria-label="Fechar aviso"
          >
            <X size={16} />
          </button>
        </div>
      )}

      <main>
        <LandingHero
          tour={
            <div
              className="flex w-full items-center justify-center rounded-lg border border-border bg-panel text-[13px] text-muted"
              style={{ aspectRatio: '1100 / 660' }}
            >
              Tour do sistema
            </div>
          }
        />
        <LandingModules />
        <LandingCustomization />
        <LandingSecurity />
        <LandingPlans />
        <LandingFaq />
        <LandingFinalCta />
      </main>

      <LandingFooter />
    </div>
  );
};

export default LandingPage;
