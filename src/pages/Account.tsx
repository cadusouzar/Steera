import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { CheckCircle2, CreditCard, Info, LogIn, Pencil, Shield, User } from 'lucide-react';
import Navbar from '../components/Navbar';
import AccountProfileDetails from '../components/account/AccountProfileDetails';
import AccountProfileEditForm from '../components/account/AccountProfileEditForm';
import AccountPasswordForm from '../components/account/AccountPasswordForm';
import AccountSubscriptionDetails from '../components/account/AccountSubscriptionDetails';
import { getCurrentUser, subscribeCurrentUser, type CurrentUser } from '../lib/auth';

type Tab = 'perfil' | 'seguranca' | 'assinatura';

function tabFromPath(pathname: string): Tab {
  if (pathname.startsWith('/conta/assinatura')) return 'assinatura';
  if (pathname.startsWith('/conta/seguranca')) return 'seguranca';
  return 'perfil';
}

// Área "Minha conta" do site (fora do ERP). Perfil: dados da conta, com edição do próprio nome e —
// só para ADMIN — dos dados da empresa. Segurança: troca de senha. Assinatura: plano (sem
// pagamento). Protegida por RequireAuth em App.tsx — deslogado vai pro login e volta pra cá.
const Account = () => {
  const location = useLocation();
  const tab = tabFromPath(location.pathname);
  const [user, setUser] = useState<CurrentUser | null>(() => getCurrentUser());
  const [isEditing, setIsEditing] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => subscribeCurrentUser(setUser), []);

  // Trocar de aba sai do modo de edição (sem salvar) e esconde o aviso de "salvo".
  useEffect(() => {
    setIsEditing(false);
    setSavedNotice(false);
  }, [tab]);

  const tabClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all whitespace-nowrap ${
      isActive ? 'bg-primary text-white shadow-md' : 'text-muted hover:text-foreground hover:bg-secondary/50'
    }`;

  return (
    <div className="relative min-h-screen bg-background transition-colors duration-300">
      <Navbar />

      <main className="container mx-auto max-w-3xl px-4 sm:px-6 pt-28 pb-16">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-heading font-bold text-foreground">Minha conta</h1>
            <p className="text-muted mt-1">Veja e atualize os dados da sua conta e do seu plano.</p>
          </div>
          <Link
            to="/app"
            className="inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-full text-sm font-medium transition-colors shadow-sm self-start sm:self-auto"
          >
            <LogIn size={16} aria-hidden="true" />
            Entrar no sistema
          </Link>
        </div>

        <nav className="flex items-center gap-2 mb-6 overflow-x-auto" aria-label="Seções da conta">
          <NavLink to="/conta" end className={tabClass}>
            <User size={16} aria-hidden="true" /> Perfil
          </NavLink>
          <NavLink to="/conta/seguranca" className={tabClass}>
            <Shield size={16} aria-hidden="true" /> Segurança
          </NavLink>
          <NavLink to="/conta/assinatura" className={tabClass}>
            <CreditCard size={16} aria-hidden="true" /> Assinatura
          </NavLink>
        </nav>

        {savedNotice && (
          <div role="status" className="mb-4 flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-foreground">
            <CheckCircle2 size={18} className="text-primary shrink-0" aria-hidden="true" />
            Alterações salvas.
          </div>
        )}

        <section className="bg-panel border border-border rounded-3xl p-6 md:p-8">
          {tab === 'assinatura' && (
            <AccountSubscriptionDetails user={user}>
              <Link
                to={{ pathname: '/', hash: '#pricing' }}
                className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-full text-sm font-medium transition-colors shadow-sm"
              >
                Ver planos
              </Link>
            </AccountSubscriptionDetails>
          )}

          {tab === 'seguranca' && <AccountPasswordForm />}

          {tab === 'perfil' &&
            (isEditing && user ? (
              <AccountProfileEditForm
                user={user}
                onCancel={() => setIsEditing(false)}
                onSaved={(updated) => {
                  setUser(updated);
                  setIsEditing(false);
                  setSavedNotice(true);
                }}
              />
            ) : (
              <>
                <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                  <p className="flex items-start gap-2 text-sm text-muted">
                    <Info size={16} className="shrink-0 mt-0.5 text-primary" aria-hidden="true" />
                    {user?.role === 'admin'
                      ? 'A edição dos dados da empresa é liberada apenas para administradores — como administrador, você pode alterá-los.'
                      : 'A edição dos dados da empresa é liberada apenas para administradores. Você pode alterar só o seu nome.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSavedNotice(false);
                      setIsEditing(true);
                    }}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-foreground border border-border hover:bg-secondary/50 transition-colors self-end sm:self-auto shrink-0"
                  >
                    <Pencil size={16} aria-hidden="true" /> Editar
                  </button>
                </div>
                <AccountProfileDetails user={user} />
              </>
            ))}
        </section>
      </main>
    </div>
  );
};

export default Account;
