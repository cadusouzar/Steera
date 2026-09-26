import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AuthCard from '../components/AuthCard';
import FormField from '../components/FormField';
import { inputBorderClass, isValidEmail } from '../lib/validation';
import { forgotPassword } from '../lib/auth';

const ForgotPassword = () => {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState(searchParams.get('email') ?? '');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sentMessage, setSentMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setFieldError('E-mail é obrigatório');
      return;
    }
    if (!isValidEmail(email)) {
      setFieldError('E-mail inválido');
      return;
    }
    setFieldError(undefined);
    setError(null);
    setIsSubmitting(true);
    try {
      const message = await forgotPassword(email.trim());
      setSentMessage(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível enviar o link. Tente novamente em instantes.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthCard
      title="Esqueci minha senha"
      subtitle="Informe seu e-mail cadastrado e enviaremos um link para redefinir sua senha."
    >
      {sentMessage ? (
        <div className="text-center">
          <div role="status" className="rounded-xl border border-primary/30 bg-primary/5 p-4 mb-6 text-sm text-foreground">
            {sentMessage}
          </div>
          <Link to="/login" className="text-primary hover:underline text-sm font-medium">
            Voltar para o login
          </Link>
        </div>
      ) : (
        <form className="space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <FormField label="E-mail" required error={fieldError}>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setFieldError(undefined);
              }}
              className={`w-full bg-background border ${inputBorderClass(!!fieldError)} rounded-xl px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 transition-all`}
              placeholder="nome@empresa.com"
            />
          </FormField>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-primary hover:bg-primary/90 text-white font-medium py-3 rounded-xl transition-colors shadow-lg shadow-primary/20 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Enviando...' : 'Enviar link de redefinição'}
          </button>

          <div className="text-center text-sm text-foreground/60">
            <Link to="/login" className="text-primary hover:underline">
              Voltar para o login
            </Link>
          </div>
        </form>
      )}
    </AuthCard>
  );
};

export default ForgotPassword;
