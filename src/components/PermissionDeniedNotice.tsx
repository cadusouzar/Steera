import { Link } from 'react-router-dom';
import { ArrowLeft, Lock } from 'lucide-react';
import { buttonClass } from './ui/buttonStyles';

// Tela mostrada quando a pessoa chega numa rota de cadastro/edição (ex.: /app/clientes/novo, por um
// link salvo) sem a permissão de alterar daquela área no perfil. Só UX: o backend recusaria de
// qualquer forma com 403 PERMISSION_REQUIRED.
interface PermissionDeniedNoticeProps {
  message: string;
  backTo: string;
  backLabel: string;
}

const PermissionDeniedNotice = ({ message, backTo, backLabel }: PermissionDeniedNoticeProps) => (
  <div className="px-4 py-6 md:px-8 md:py-8">
    <div className="max-w-xl mx-auto bg-panel border border-border rounded-lg shadow-sm px-6 py-10 text-center">
      <Lock size={20} strokeWidth={1.7} className="mx-auto mb-3 text-muted" aria-hidden="true" />
      <p className="text-[15px] font-semibold text-foreground">{message}</p>
      <p className="text-[14px] text-muted mt-1">Fale com quem administra os acessos da empresa.</p>
      <Link to={backTo} className={buttonClass('secondary', 'md', 'mt-6')}>
        <ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true" />
        {backLabel}
      </Link>
    </div>
  </div>
);

export default PermissionDeniedNotice;
