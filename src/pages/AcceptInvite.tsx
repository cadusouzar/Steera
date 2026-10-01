import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthCard from '../components/AuthCard';
import FormField from '../components/FormField';
import { useUrlToken } from '../hooks/useUrlToken';
import { inputBorderClass } from '../lib/validation';
import { acceptInvite } from '../lib/auth';
import { ApiError } from '../lib/apiError';
import PasswordStrengthMeter from '../components/PasswordStrengthMeter';
import { usePasswordStrength } from '../hooks/usePasswordStrength';
import { isWeakPasswordError } from '../lib/passwordStrength';

// Rota pública só com o token: o login ainda não é conhecido aqui, então o medidor roda sem
// "palavras proibidas" — o backend confere de novo com o e-mail/nome reais antes de gastar o link.
const NO_USER_INPUTS: string[] = [];

interface Errors {
  password?: string;
  confirmPassword?: string;
}

// Igual a ResetPassword.tsx (mesma mecânica de token + senha + confirmação), mas pro login criado
// por um admin (INVITED) que ainda não tem senha nenhuma — daí o título "Crie sua senha" em vez de
// "Redefinir senha", e não loga automaticamente ao terminar (mesmo comportamento do backend).
const AcceptInvite = () => {
  const navigate = useNavigate();
  const token = useUrlToken();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(!token);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { strength, isStrong, isChecking } = usePasswordStrength(password, NO_USER_INPUTS);

  const validate = (): Errors => {
    const e: Errors = {};
    if (password.length < 8) e.password = 'Senha deve ter pelo menos 8 caracteres';
    else if (!isStrong) e.password = isChecking ? 'Aguarde a verificação da força da senha.' : 'Escolha uma senha mais forte para continuar.';
    if (confirmPassword !== password) e.confirmPassword = 'As senhas não coincidem';
    return e;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const stepErrors = validate();
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length > 0) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await acceptInvite(token, password);
      navigate('/login', { state: { notice: 'Senha criada. Entre para começar.' } });
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && isWeakPasswordError(err.message)) {
        setErrors({ password: err.message });
      } else if (err instanceof ApiError && err.status === 400) {
        setInvalid(true);
      } else {
        setError(err instanceof Error ? err.message : 'Não foi possível criar a senha. Tente novamente em instantes.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (invalid) {
    return (
      <AuthCard title="Link inválido" subtitle="Este link de convite é inválido ou expirou. Peça um novo ao administrador da sua empresa.">
        <div className="text-center">
          <Link to="/login" className="text-primary hover:underline text-sm font-medium">
            Voltar para o login
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Crie sua senha" subtitle="Defina uma senha para acessar sua conta.">
      <form className="space-y-6" onSubmit={handleSubmit}>
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        <FormField label="Senha" required error={errors.password}>
          <input
            type="password"
            minLength={8}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setErrors((prev) => ({ ...prev, password: undefined }));
            }}
            className={`w-full bg-background border ${inputBorderClass(!!errors.password)} rounded-xl px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 transition-all`}
            placeholder="Crie uma senha forte"
            autoComplete="new-password"
          />
          <PasswordStrengthMeter strength={strength} isChecking={isChecking} />
        </FormField>

        <FormField label="Confirmar senha" required error={errors.confirmPassword}>
          <input
            type="password"
            minLength={8}
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              setErrors((prev) => ({ ...prev, confirmPassword: undefined }));
            }}
            className={`w-full bg-background border ${inputBorderClass(!!errors.confirmPassword)} rounded-xl px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 transition-all`}
            placeholder="Repita a senha"
          />
        </FormField>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-primary hover:bg-primary/90 text-white font-medium py-3 rounded-xl transition-colors shadow-lg shadow-primary/20 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Salvando...' : 'Criar senha'}
        </button>
      </form>
    </AuthCard>
  );
};

export default AcceptInvite;
