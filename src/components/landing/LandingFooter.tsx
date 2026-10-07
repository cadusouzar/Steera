import { Link } from 'react-router-dom';
import SteeraLogo from '../brand/SteeraLogo';
import { BRAND_NAME } from '../../lib/brand';

const LINKS = [
  ['Módulos', '#modulos'],
  ['Personalização', '#personalizacao'],
  ['Segurança', '#seguranca'],
  ['Planos', '#planos'],
  ['Dúvidas', '#duvidas'],
];

const LandingFooter = () => (
  <footer className="border-t border-border">
    <div className="max-w-[1180px] mx-auto px-4 sm:px-6 py-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <SteeraLogo size="text-[24px]" />
        <span className="text-[13px] text-muted">© 2026 {BRAND_NAME}</span>
      </div>
      <nav aria-label="Rodapé" className="flex flex-wrap gap-x-6 gap-y-2 text-[14px] text-muted">
        {LINKS.map(([l, h]) => (
          <a key={h} href={h} className="hover:text-foreground transition-colors">{l}</a>
        ))}
        <Link to="/login" className="hover:text-foreground transition-colors">Entrar</Link>
      </nav>
    </div>
  </footer>
);

export default LandingFooter;
