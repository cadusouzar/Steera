import { useId } from 'react';

interface LegalConsentCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string;
  // Classes de cor: o cadastro usa a paleta `.auth-page` (--a-*); as demais telas usam os tokens do app.
  textClassName?: string;
  linkClassName?: string;
  errorClassName?: string;
}

// Caixa "Li e aceito os Termos de uso e a Política de Privacidade" — compartilhada pelo cadastro, pelo
// aceite de convite e pela tela de reaceite (LegalAcceptanceRequired). Os links abrem em nova aba para
// a pessoa não perder o que já preencheu.
const LegalConsentCheckbox = ({
  checked,
  onChange,
  error,
  textClassName = 'text-foreground/80',
  linkClassName = 'text-primary',
  errorClassName = 'text-danger',
}: LegalConsentCheckboxProps) => {
  const id = useId();
  const link = `font-medium underline underline-offset-2 ${linkClassName}`;
  return (
    <div>
      <div className="flex items-start gap-2.5">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="mt-px h-[18px] w-[18px] shrink-0 cursor-pointer accent-primary"
        />
        <label htmlFor={id} className={`text-[13px] leading-[1.45] ${textClassName}`}>
          Li e aceito os{' '}
          <a href="/termos" target="_blank" rel="noopener noreferrer" className={link}>Termos de uso</a>
          {' '}e a{' '}
          <a href="/privacidade" target="_blank" rel="noopener noreferrer" className={link}>Política de Privacidade</a>
        </label>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className={`mt-1.5 text-[12px] font-medium ${errorClassName}`}>{error}</p>
      )}
    </div>
  );
};

export default LegalConsentCheckbox;
