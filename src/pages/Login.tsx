import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import Mascot from '../components/Mascot';
import SteeraLogo from '../components/brand/SteeraLogo';
import { forgotPassword, login } from '../lib/auth';
import { ApiError } from '../lib/apiError';
import { BRAND_NAME } from '../lib/brand';

// Login no modelo "Login v2" (02/10/2026): fundo pontilhado, cartão com o Stee numa faixa creme e um
// balão que responde ao que a pessoa está fazendo. Só tem versão clara (`theme-light`), como o modelo.
// Ficaram de fora do modelo, de propósito: "Manter conectado" (a sessão já dura 30 dias, a caixa não
// faria nada) e os links Termos/Privacidade/Suporte (as páginas ainda não existem).

// Depois de entrar, a pessoa vai pra página inicial do site (de lá entra no sistema pelo botão
// "Entrar no sistema") — decisão de produto de 25/09/2026. Exceção: se ela foi mandada pro login ao
// tentar abrir uma página protegida (RequireAuth guarda o caminho em `state.from`), volta pra ela.
// Só aceita um caminho interno (começa com "/" mas não "//", que seria outro host) — o valor vem do
// state de navegação, mas a checagem evita virar um redirecionamento aberto se algum dia vier de fora.
function safeRedirectPath(from: unknown): string {
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/';
}

type Focus = 'email' | 'password' | null;

const inputClass =
  'w-full h-[46px] rounded-[8px] border border-[#e1e1e1] bg-white px-3.5 text-[15px] text-[#111] placeholder:text-[#9a9a9a] outline-none transition-[border-color,box-shadow] duration-150 focus:border-[#111] focus:shadow-[0_0_0_3px_rgba(17,17,17,0.08)]';

const linkClass = 'rounded outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#111]';

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [focus, setFocus] = useState<Focus>(null);
  const [showPassword, setShowPassword] = useState(false);
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

  const isCoveringEyes = focus === 'password' && !showPassword;

  const bubble = isSubmitting ? 'Abrindo seu painel…'
    : error ? 'Opa, algo não bateu. Tenta de novo?'
    : isCoveringEyes ? 'Pode digitar, não estou olhando!'
    : focus === 'password' ? 'Hmm… prometo esquecer.'
    : focus === 'email' ? 'Qual é o seu e-mail?'
    : 'Oi! Bom te ver de novo.';

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResetSentMessage(null);
    setFocus(null);
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

  const clearError = () => {
    if (error) setError(null);
  };

  return (
    <div
      className="theme-light min-h-screen flex flex-col overflow-x-hidden bg-[#f4f4f3] bg-[radial-gradient(#dcdcda_1px,transparent_1px)] bg-[length:22px_22px] px-4 py-7 sm:px-10 font-sans text-[#111]"
      onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
    >
      <header className="flex items-center justify-between gap-4">
        <Link to="/" aria-label={`${BRAND_NAME} — página inicial`} className={linkClass}>
          <SteeraLogo size="text-[26px]" className="text-[#111]" />
        </Link>
        <Link to="/" className={`${linkClass} inline-flex items-center gap-1.5 text-[13px] font-medium text-[#666] hover:text-[#111]`}>
          <ArrowLeft size={14} strokeWidth={2} aria-hidden="true" />
          Voltar para o site
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center py-8">
        <div className="w-full max-w-[420px]">
          <h1 className="sr-only">Entrar no {BRAND_NAME}</h1>
          <form
            onSubmit={handleLogin}
            className="flex flex-col gap-[26px] overflow-hidden rounded-[16px] border border-[#e4e4e2] bg-white px-6 pb-8 sm:px-9 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_40px_rgba(0,0,0,0.06)]"
          >
            {/* Faixa do Stee: ocupa a largura toda do cartão, por cima do padding. */}
            <div className="relative -mx-6 sm:-mx-9 h-[220px] flex items-end justify-center border-b border-[#EFE4D2] bg-[#FDF8F0] bg-[radial-gradient(ellipse_60%_18%_at_50%_100%,rgba(62,39,34,0.07),transparent_70%)]">
              {/* O componente do Stee tem tamanho fixo; aqui ele cresce para a área do modelo. */}
              <div className="[&>div]:mb-0 [&>div]:h-[220px] [&>div]:w-[260px]">
                <Mascot mousePosition={mousePos} isCoveringEyes={isCoveringEyes} />
              </div>
              <p
                aria-hidden="true"
                className="absolute top-[22px] left-[calc(50%+66px)] w-fit max-w-[calc(50%-80px)] rounded-[14px] rounded-bl-[4px] bg-white px-3 py-[9px] font-brand text-[13px] font-semibold leading-[1.3] text-[#3E2722] shadow-[0_4px_14px_rgba(62,39,34,0.1)]"
              >
                {bubble}
              </p>
            </div>

            <div className="flex flex-col gap-[18px]">
              <label className="flex flex-col gap-[7px]">
                <span className="text-[13px] font-medium">E-mail</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); clearError(); }}
                  onFocus={() => setFocus('email')}
                  onBlur={() => setFocus(null)}
                  placeholder="voce@empresa.com.br"
                  className={inputClass}
                />
              </label>

              <div className="flex flex-col gap-[7px]">
                <div className="flex items-baseline justify-between">
                  <label htmlFor="login-password" className="text-[13px] font-medium">Senha</label>
                  <Link
                    to={{ pathname: '/esqueci-senha', search: email.trim() ? `?email=${encodeURIComponent(email.trim())}` : '' }}
                    className={`${linkClass} text-[13px] font-medium text-[#666] hover:text-[#111]`}
                  >
                    Esqueci minha senha
                  </Link>
                </div>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); clearError(); }}
                    onFocus={() => setFocus('password')}
                    onBlur={() => setFocus(null)}
                    placeholder="••••••••"
                    className={`${inputClass} pr-[46px]`}
                  />
                  <button
                    type="button"
                    // Mantém o foco no campo ao clicar (senão o Stee "piscaria" ao perder o foco).
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                    aria-pressed={showPassword}
                    className="absolute right-1 top-1 flex h-[38px] w-[38px] items-center justify-center rounded-md text-[#777] outline-none transition-colors hover:bg-[#f4f4f4] hover:text-[#111] focus-visible:ring-2 focus-visible:ring-[#111]"
                  >
                    {showPassword ? <EyeOff size={18} strokeWidth={1.8} /> : <Eye size={18} strokeWidth={1.8} />}
                  </button>
                </div>
              </div>
            </div>

            {notice && !error && (
              <p role="status" className="rounded-lg bg-[#F4F4F3] px-3.5 py-[11px] text-[13px] font-medium leading-[1.4] text-[#333]">{notice}</p>
            )}

            {error && (
              <div role="alert" className="rounded-lg bg-[#FBEDE8] px-3.5 py-[11px] text-[13px] font-medium leading-[1.4] text-[#8A3220]">
                {error}
                {lockedOut && (
                  <button
                    type="button"
                    onClick={handleSendResetLink}
                    disabled={isSendingReset}
                    className="mt-2.5 block font-semibold underline underline-offset-4 outline-none hover:text-[#5f2116] focus-visible:ring-2 focus-visible:ring-[#8A3220] rounded disabled:opacity-60"
                  >
                    {isSendingReset ? 'Enviando…' : 'Enviar link de redefinição'}
                  </button>
                )}
              </div>
            )}

            {resetSentMessage && (
              <p role="status" className="rounded-lg bg-[#F4F4F3] px-3.5 py-[11px] text-[13px] font-medium leading-[1.4] text-[#333]">{resetSentMessage}</p>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              aria-busy={isSubmitting || undefined}
              className="flex h-12 items-center justify-center gap-2.5 rounded-[8px] bg-[#111] text-[15px] font-semibold text-white outline-none transition-colors hover:bg-[#2a2a2a] active:bg-black focus-visible:ring-2 focus-visible:ring-[#111] focus-visible:ring-offset-2 disabled:opacity-70"
            >
              {isSubmitting ? 'Entrando…' : 'Entrar'}
            </button>

            <p className="text-center text-[14px] text-[#666]">
              Ainda não tem conta?{' '}
              <Link to="/register" className={`${linkClass} font-semibold text-[#111] hover:text-brand`}>Criar conta grátis</Link>
            </p>
          </form>
        </div>
      </main>

      <footer className="text-[12px] text-[#666]">© 2026 {BRAND_NAME}</footer>
    </div>
  );
};

export default Login;
