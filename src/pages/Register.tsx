import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import Mascot from '../components/Mascot';
import FlowBackground from '../components/FlowBackground';
import FormField from '../components/FormField';
import { register } from '../lib/auth';
import { inputBorderClass, isValidEmail, NAME_MAX_LENGTH } from '../lib/validation';

const Register = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [planName, setPlanName] = useState<string>('');

  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isCovering, setIsCovering] = useState(false);

  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [companyNameError, setCompanyNameError] = useState<string>();
  const [emailError, setEmailError] = useState<string>();
  const [passwordError, setPasswordError] = useState<string>();

  useEffect(() => {
    const plan = searchParams.get('plan');
    if (plan) {
      setPlanName(plan.charAt(0).toUpperCase() + plan.slice(1));
    }
  }, [searchParams]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const companyNameErr = companyName.length > NAME_MAX_LENGTH ? `Nome deve ter no máximo ${NAME_MAX_LENGTH} caracteres` : undefined;
    const emailErr = email && !isValidEmail(email) ? 'E-mail inválido' : undefined;
    const passwordErr = password.length > 0 && password.length < 8 ? 'Senha deve ter pelo menos 8 caracteres' : undefined;
    setCompanyNameError(companyNameErr);
    setEmailError(emailErr);
    setPasswordError(passwordErr);
    if (companyNameErr || emailErr || passwordErr) return;

    setError(null);
    setIsSubmitting(true);
    try {
      await register(companyName, email, password);
      navigate('/app');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar a conta.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    setMousePos({ x: e.clientX, y: e.clientY });
  };

  return (
    <div
      className="relative min-h-screen bg-background overflow-hidden flex items-center justify-center transition-colors duration-300 py-12"
      onMouseMove={handleMouseMove}
    >
      <FlowBackground />

      <div className="relative z-10 w-full max-w-md px-6 pointer-events-auto">
        <Link to="/" className="inline-flex items-center text-foreground/60 hover:text-foreground mb-8 transition-colors">
          <ArrowLeft size={16} className="mr-2" />
          Voltar para Home
        </Link>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, type: "spring", bounce: 0.4 }}
          className="glass-panel p-10 rounded-3xl"
        >
          <Mascot mousePosition={mousePos} isCoveringEyes={isCovering} />

          <div className="text-center mb-6 mt-8">
            <h1 className="text-3xl font-heading font-bold mb-2 text-foreground">QuickFlow</h1>
            <p className="text-foreground/60">Crie sua conta para começar.</p>

            {planName && (
              <div className="mt-4 bg-primary/10 border border-primary/20 text-primary text-sm font-medium py-2 px-4 rounded-lg inline-block">
                Plano selecionado: {planName}
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 mb-6 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <form className="space-y-4" onSubmit={handleRegister}>
            <FormField label="Nome da Empresa" required error={companyNameError}>
              <input
                type="text"
                required
                maxLength={NAME_MAX_LENGTH}
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                onBlur={() => setCompanyNameError(companyName.length > NAME_MAX_LENGTH ? `Nome deve ter no máximo ${NAME_MAX_LENGTH} caracteres` : undefined)}
                className={`w-full bg-background border ${inputBorderClass(!!companyNameError)} rounded-xl px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 transition-all`}
                placeholder="Nome da sua empresa"
                onFocus={() => setIsCovering(false)}
              />
            </FormField>

            <FormField label="E-mail Corporativo" required error={emailError}>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setEmailError(email && !isValidEmail(email) ? 'E-mail inválido' : undefined)}
                className={`w-full bg-background border ${inputBorderClass(!!emailError)} rounded-xl px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 transition-all`}
                placeholder="nome@empresa.com"
                onFocus={() => setIsCovering(false)}
              />
            </FormField>

            <FormField label="Senha" required error={passwordError}>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => setPasswordError(password.length > 0 && password.length < 8 ? 'Senha deve ter pelo menos 8 caracteres' : undefined)}
                className={`w-full bg-background border ${inputBorderClass(!!passwordError)} rounded-xl px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 transition-all`}
                placeholder="Crie uma senha forte (mín. 8 caracteres)"
                onFocus={() => setIsCovering(true)}
                onBlurCapture={() => setIsCovering(false)}
              />
            </FormField>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-primary hover:bg-primary/90 text-white font-medium py-3 rounded-xl transition-colors shadow-lg shadow-primary/20 mt-4 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Criando conta...' : 'Criar Conta'}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-foreground/60">
            Já tem uma conta? <Link to="/login" className="text-primary hover:underline">Faça login</Link>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default Register;
