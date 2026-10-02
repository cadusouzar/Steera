import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

// "Voltar para o site" das telas de entrada (login e cadastro): pílula bem visível logo acima do
// cartão (pedido do usuário, 02/10/2026). Usa a paleta `.auth-page` (clara e escura).
const AuthBackLink = () => (
  <Link
    to="/"
    className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--a-border)] bg-[var(--a-card)] px-4 py-2 text-[14px] font-medium text-[var(--a-ink)] shadow-[0_1px_2px_rgba(0,0,0,0.04)] outline-none transition-colors hover:border-[var(--a-border-strong)] hover:bg-[var(--a-hover)] focus-visible:ring-2 focus-visible:ring-[var(--a-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--a-bg)]"
  >
    <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
    Voltar para o site
  </Link>
);

export default AuthBackLink;
