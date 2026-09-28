import { Lock } from 'lucide-react';
import { OWN_DATA_LOCKED_MESSAGE } from '../lib/grantCoverage';

// Aviso curto mostrado no lugar dos botões de escrita quando a ficha é a do próprio login e o perfil
// não concede "Pode alterar os próprios dados?" (funcionarios.proprios.gerenciar).
const OwnDataNote = ({ className = '' }: { className?: string }) => (
  <p role="note" className={`inline-flex items-center gap-1.5 text-xs text-muted ${className}`}>
    <Lock size={12} className="shrink-0" aria-hidden="true" />
    {OWN_DATA_LOCKED_MESSAGE}
  </p>
);

export default OwnDataNote;
