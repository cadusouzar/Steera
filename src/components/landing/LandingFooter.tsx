import SteeraLogo from '../brand/SteeraLogo';
import { BRAND_NAME } from '../../lib/brand';

// Rodapé do site (07/10/2026, a partir do print do usuário): logo e ano à esquerda. Os links Termos,
// Privacidade e Contato entram junto com as páginas da adequação à LGPD — nenhum link para página que
// ainda não existe.
const LandingFooter = () => (
  <footer>
    <div className="max-w-[1180px] mx-auto px-4 sm:px-6 py-10 flex flex-wrap items-center gap-x-5 gap-y-2">
      <SteeraLogo size="text-[22px]" />
      <span className="text-[13px] text-muted">© 2026 {BRAND_NAME}</span>
    </div>
  </footer>
);

export default LandingFooter;
