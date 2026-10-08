import { Link } from 'react-router-dom';
import SteeraLogo from '../brand/SteeraLogo';
import { BRAND_NAME } from '../../lib/brand';
import { LEGAL_CONTACT_EMAIL } from '../../lib/legal';

// Rodapé do site: logo e ano à esquerda; Termos, Privacidade e Contato à direita.
const linkClass = 'text-[13px] text-muted hover:text-foreground transition-colors';

const LandingFooter = () => (
  <footer>
    <div className="max-w-[1180px] mx-auto px-4 sm:px-6 py-10 flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <SteeraLogo size="text-[22px]" />
        <span className="text-[13px] text-muted">© 2026 {BRAND_NAME}</span>
      </div>
      <nav aria-label="Links legais e contato" className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Link to="/termos" className={linkClass}>Termos</Link>
        <Link to="/privacidade" className={linkClass}>Privacidade</Link>
        <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className={linkClass}>Contato</a>
      </nav>
    </div>
  </footer>
);

export default LandingFooter;
