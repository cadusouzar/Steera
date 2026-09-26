import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import Mascot from '../components/Mascot';
import FlowBackground from '../components/FlowBackground';
import { forgotPassword, login } from '../lib/auth';
import { ApiError } from '../lib/apiError';

// Depois de entrar, a pessoa vai pra página inicial do site (de lá entra no sistema pelo botão
// "Entrar no sistema") — decisão de produto de 25/09/2026. Exceção: se ela foi mandada pro login ao
// tentar abrir uma página protegida (RequireAuth guarda o caminho em `state.from`), volta pra ela.
// Só aceita um caminho interno (começa com "/" mas não "//", que seria outro host) — o valor vem do
// state de navegação, mas a checagem evita virar um redirecionamento aberto se algum dia vier de fora.
function safeRedirectPath(from: unknown): string {
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/';
}

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isCovering, setIsCovering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Bloqueio temporário de conta (5 senhas erradas seguidas, ver ACCOUNT_TEMPORARILY_LOCKED) —
  // oferece um atalho pra pedir o link de redefinição sem sair da tela de login.
  const [lockedOut, setLockedOut] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [resetSentMessage, setResetSentMessage] = useState<string | null>(null);
  // Aviso de sucesso vindo de outra tela (ex.: "Senha redefinida." de ResetPassword.tsx, "Senha
  // criada." de AcceptInvite.tsx) — só lido uma vez, do state de navegação.
  const [notice] = useState<string | null>((location.state as { notice?: string } | null)?.notice ?? null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResetSentMessage(null);
    setIsSubmitting(true);
    try {
      await login(email, password);
      navigate(safeRedirectPath((location.state as { from?: unknown } | null)?.from), { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ACCOUNT_TEMPORARILY_LOCKED') {
        setLockedOut(true);
        setError(err.message);
      } else {
        setLockedOut(false);
        setError(err instanceof Error ? err.message : 'Não foi possível entrar.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendResetLink = async () => {
    setIsSendingReset(true);
    try {
      const message = await forgotPassword(email);
      setResetSentMessage(message);
    } catch {
      setResetSentMessage('Se existir uma conta com esse e-mail, enviamos um link para redefinir a senha.');
    } finally {
      setIsSendingReset(false);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    setMousePos({ x: e.clientX, y: e.clientY });
  };

  return (
    <div
      className="relative min-h-screen bg-background overflow-hidden flex items-center justify-center transition-colors duration-300"
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

          <div className="text-center mb-8 mt-8">
            <h1 className="text-3xl font-heading font-bold mb-2 text-foreground">QuickFlow</h1>
            <p className="text-foreground/60">Acesse sua conta para continuar.</p>
          </div>

          {notice && !error && (
            <div role="status" className="rounded-xl border border-primary/30 bg-primary/5 p-4 mb-6 text-sm text-foreground">
              {notice}
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 mb-6 text-red-600 dark:text-red-400 text-sm">
              {error}
              {lockedOut && (
                <button
                  type="button"
                  onClick={handleSendResetLink}
                  disabled={isSendingReset}
                  className="mt-3 w-full bg-red-600 hover:bg-red-600/90 text-white font-medium py-2 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed text-sm"
                >
                  {isSendingReset ? 'Enviando...' : 'Enviar link de redefinição'}
                </button>
              )}
            </div>
          )}

          {resetSentMessage && (
            <div role="status" className="rounded-xl border border-primary/30 bg-primary/5 p-4 mb-6 text-sm text-foreground">
              {resetSentMessage}
            </div>
          )}

          <form className="space-y-6" onSubmit={handleLogin}>
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-2">E-mail Corporativo</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-background border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                placeholder="nome@empresa.com"
                onFocus={() => setIsCovering(false)}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-foreground/80">Senha</label>
                <Link
                  to={{ pathname: '/esqueci-senha', search: email.trim() ? `?email=${encodeURIComponent(email.trim())}` : '' }}
                  className="text-xs text-primary hover:underline"
                >
                  Esqueci minha senha
                </Link>
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-background border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                placeholder="••••••••"
                onFocus={() => setIsCovering(true)}
                onBlur={() => setIsCovering(false)}
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-primary hover:bg-primary/90 text-white font-medium py-3 rounded-xl transition-colors shadow-lg shadow-primary/20 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Entrando...' : 'Entrar'}
            </button>
          </form>

          <div className="mt-8 text-center text-sm text-foreground/60">
            Ainda não tem uma conta? <Link to="/register" className="text-primary hover:underline">Criar conta</Link>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default Login;
