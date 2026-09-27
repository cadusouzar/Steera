import { Link } from 'react-router-dom';
import { ArrowLeft, Lock } from 'lucide-react';

// Tela mostrada quando a pessoa chega numa rota de cadastro/edição (ex.: /app/clientes/novo, por um
// link salvo) sem a permissão de alterar daquela área no perfil. Só UX: o backend recusaria de
// qualquer forma com 403 PERMISSION_REQUIRED.
interface PermissionDeniedNoticeProps {
  message: string;
  backTo: string;
  backLabel: string;
}

const PermissionDeniedNotice = ({ message, backTo, backLabel }: PermissionDeniedNoticeProps) => (
  <div className="p-6 md:p-8">
    <div className="max-w-xl mx-auto glass-panel rounded-[2rem] border border-border/50 p-8 text-center">
      <div className="w-12 h-12 rounded-full bg-secondary/60 flex items-center justify-center mx-auto mb-4 text-muted">
        <Lock size={20} />
      </div>
      <p className="text-foreground font-medium">{message}</p>
      <p className="text-sm text-muted mt-2">Fale com quem administra os acessos da empresa.</p>
      <Link
        to={backTo}
        className="inline-flex items-center gap-2 mt-6 px-4 py-2 rounded-xl bg-secondary/60 text-foreground text-sm font-medium hover:bg-secondary transition-colors"
      >
        <ArrowLeft size={16} />
        {backLabel}
      </Link>
    </div>
  </div>
);

export default PermissionDeniedNotice;
