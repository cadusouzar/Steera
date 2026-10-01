import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, type LucideIcon } from 'lucide-react';
import { buttonClass, type ButtonSize, type ButtonVariant } from './buttonStyles';

// Botão único do sistema (kit de peças, 01/10/2026) — substitui as ~54 variações feitas à mão.
// `primary` é a ação principal da tela (preto no claro, branco no escuro); `secondary` é a
// alternativa com borda; `ghost` é ação discreta (só texto); `danger` é a ação destrutiva.

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  /** Ícone depois do texto (ex.: seta "continuar"). */
  trailingIcon?: LucideIcon;
  /** Troca o ícone por um spinner e desabilita, sem mudar a largura do botão. */
  loading?: boolean;
  children?: ReactNode;
  className?: string;
}

const Content = ({ icon: Icon, trailingIcon: Trailing, loading, size = 'md', children }: CommonProps) => {
  const iconSize = size === 'sm' ? 14 : 16;
  return (
    <>
      {loading ? (
        <Loader2 size={iconSize} strokeWidth={1.8} className="animate-spin" aria-hidden="true" />
      ) : (
        Icon && <Icon size={iconSize} strokeWidth={1.8} aria-hidden="true" />
      )}
      {children}
      {Trailing && <Trailing size={iconSize} strokeWidth={1.8} aria-hidden="true" />}
    </>
  );
};

type ButtonProps = CommonProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'>;

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon, trailingIcon, loading = false, children, className = '', disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, className)}
      {...rest}
    >
      <Content icon={icon} trailingIcon={trailingIcon} loading={loading} size={size}>
        {children}
      </Content>
    </button>
  );
});

// Mesmo visual, navegando pelo react-router (nunca <a> para rota interna — convenção do projeto).
export const ButtonLink = ({
  to, variant = 'primary', size = 'md', icon, trailingIcon, children, className = '',
}: CommonProps & { to: string }) => (
  <Link to={to} className={buttonClass(variant, size, className)}>
    <Content icon={icon} trailingIcon={trailingIcon} size={size}>{children}</Content>
  </Link>
);

export default Button;
