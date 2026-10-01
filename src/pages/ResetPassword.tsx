import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthCard from '../components/AuthCard';
import FormField from '../components/FormField';
import { useUrlToken } from '../hooks/useUrlToken';
import { inputBorderClass } from '../lib/validation';
import { resetPassword } from '../lib/auth';
import { ApiError } from '../lib/apiError';
import PasswordStrengthMeter from '../components/PasswordStrengthMeter';
import { usePasswordStrength } from '../hooks/usePasswordStrength';
import { isWeakPasswordError } from '../lib/passwordStrength';

// Rota pública só com o token: o login ainda não é conhecido aqui, então o medidor roda sem
// "palavras proibidas" — o backend confere de novo com o e-mail/nome reais antes de gastar o link.
const NO_USER_INPUTS: string[] = [];

interface Errors {
  newPassword?: string;
  confirmPassword?: string;
}

const ResetPassword = () => {
  const navigate = useNavigate();
  const token = useUrlToken();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  // Sem token na URL já nasce inválido; um 400 do backend (token expirado/usado) também cai aqui.
  const [invalid, setInvalid] = useState(!token);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { strength, isStrong, isChecking } = usePasswordStrength(newPassword, NO_USER_INPUTS);

  const validate = (): Errors => {
    const e: Errors = {};
    if (newPassword.length < 8) e.newPassword = 'Senha deve ter pelo menos 8 caracteres';
    else if (!isStrong) e.newPassword = isChecking ? 'Aguarde a verificação da força da senha.' : 'Escolha uma senha mais forte para continuar.';
    if (confirmPassword !== newPassword) e.confirmPassword = 'As senhas não coincidem';
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
      await resetPassword(token, newPassword);
      navigate('/login', { state: { notice: 'Senha redefinida. Entre com a nova senha.' } });
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && isWeakPasswordError(err.message)) {
        setErrors({ newPassword: err.message });
      } else if (err instanceof ApiError && err.status === 400) {
        setInvalid(true);
      } else {
        setError(err instanceof Error ? err.message : 'Não foi possível redefinir a senha. Tente novamente em instantes.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (invalid) {
    return (
      <AuthCard title="Link inválido" subtitle="Este link de redefinição é inválido ou expirou. Peça um novo.">
        <div className="text-center">
          <Link to="/esqueci-senha" className="text-primary hover:underline text-sm font-medium">
            Pedir um novo link
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Redefinir senha" subtitle="Escolha uma nova senha para sua conta.">
      <form className="space-y-6" onSubmit={handleSubmit}>
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        <FormField label="Nova senha" required error={errors.newPassword}>
          <input
            type="password"
            minLength={8}
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              setErrors((prev) => ({ ...prev, newPassword: undefined }));
            }}
            className={`w-full bg-background border ${inputBorderClass(!!errors.newPassword)} rounded-xl px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 transition-all`}
            placeholder="Crie uma senha forte"
            autoComplete="new-password"
          />
          <PasswordStrengthMeter strength={strength} isChecking={isChecking} />
        </FormField>

        <FormField label="Confirmar nova senha" required error={errors.confirmPassword}>
          <input
            type="password"
            minLength={8}
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              setErrors((prev) => ({ ...prev, confirmPassword: undefined }));
            }}
            className={`w-full bg-background border ${inputBorderClass(!!errors.confirmPassword)} rounded-xl px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 transition-all`}
            placeholder="Repita a nova senha"
          />
        </FormField>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium py-3 rounded-xl transition-colors shadow-lg shadow-primary/20 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Salvando...' : 'Redefinir senha'}
        </button>
      </form>
    </AuthCard>
  );
};

export default ResetPassword;
