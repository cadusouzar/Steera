import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScrollText } from 'lucide-react';
import FlowBackground from './FlowBackground';
import LegalConsentCheckbox from './LegalConsentCheckbox';
import { Button } from './ui';
import { acceptLegalTerms, logout } from '../lib/auth';
import { BRAND_NAME } from '../lib/brand';

// Tela cheia (mesmo estilo de ForcedPasswordChange/EmailVerificationRequired) mostrada por RequireAuth
// no lugar do app enquanto `currentUser.legalAcceptancePending` for true — toda conta existente na
// publicação dos Termos, e qualquer conta quando sai uma versão nova. Só dá pra aceitar ou sair.
// acceptLegalTerms() atualiza o usuário global; o RequireAuth reavalia e abre o app sozinho.
const LegalAcceptanceRequired = () => {
  const navigate = useNavigate();
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Trava síncrona: dois cliques no mesmo quadro não podem gravar o aceite duas vezes (o backend não
  // tem constraint única).
  const inFlight = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  // Quem navega por teclado/leitor de tela cai direto no título da tela.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // Falha ao enviar: foco no erro, para ser anunciado e lido.
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const handleAccept = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setIsSubmitting(true);
    try {
      await acceptLegalTerms();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível registrar o aceite.');
      inFlight.current = false;
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="relative min-h-screen bg-background overflow-hidden flex items-center justify-center transition-colors duration-300">
      <FlowBackground />

      <div className="relative z-10 w-full max-w-md px-6 pointer-events-auto">
        <div className="glass-panel p-10 rounded-3xl text-center">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mx-auto mb-6">
            <ScrollText size={28} aria-hidden="true" />
          </div>
          <h1 ref={headingRef} tabIndex={-1} className="outline-none text-2xl font-heading font-bold mb-2 text-foreground">Atualizamos nossos Termos e Política</h1>
          <p className="text-foreground/60 text-sm mb-6">
            Para continuar usando o {BRAND_NAME}, leia e aceite os Termos de uso e a Política de Privacidade.
          </p>

          {error && (
            <div ref={errorRef} tabIndex={-1} role="alert" className="rounded-xl border border-danger/30 bg-danger/[0.06] p-3 mb-4 text-sm text-danger outline-none">
              {error}
            </div>
          )}

          <div className="text-left mb-6">
            <LegalConsentCheckbox checked={accepted} onChange={setAccepted} />
          </div>

          <div className="space-y-3">
            <Button className="w-full" disabled={!accepted} loading={isSubmitting} onClick={handleAccept}>
              Aceitar e continuar
            </Button>
            <Button variant="ghost" className="w-full" disabled={isSubmitting} onClick={handleLogout}>
              Sair
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LegalAcceptanceRequired;
