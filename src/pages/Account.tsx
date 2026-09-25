import { Link, NavLink, useLocation } from 'react-router-dom';
import { CreditCard, LogIn, User } from 'lucide-react';
import Navbar from '../components/Navbar';
import AccountProfileDetails from '../components/account/AccountProfileDetails';
import AccountSubscriptionDetails from '../components/account/AccountSubscriptionDetails';
import { getCurrentUser } from '../lib/auth';

// Área "Minha conta" do site (fora do ERP): só leitura, com as mesmas informações do "Meu Perfil"
// de dentro do sistema. Protegida por RequireAuth em App.tsx — deslogado vai pro login e volta pra
// cá depois de entrar.
const Account = () => {
  const location = useLocation();
  const user = getCurrentUser();
  const isSubscriptionTab = location.pathname.startsWith('/conta/assinatura');

  const tabClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
      isActive ? 'bg-primary text-white shadow-md' : 'text-muted hover:text-foreground hover:bg-secondary/50'
    }`;

  return (
    <div className="relative min-h-screen bg-background transition-colors duration-300">
      <Navbar />

      <main className="container mx-auto max-w-3xl px-4 sm:px-6 pt-28 pb-16">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-heading font-bold text-foreground">Minha conta</h1>
            <p className="text-muted mt-1">Veja os dados da sua conta e do seu plano.</p>
          </div>
          <Link
            to="/app"
            className="inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-full text-sm font-medium transition-colors shadow-sm self-start sm:self-auto"
          >
            <LogIn size={16} aria-hidden="true" />
            Entrar no sistema
          </Link>
        </div>

        <nav className="flex items-center gap-2 mb-6" aria-label="Seções da conta">
          <NavLink to="/conta" end className={tabClass}>
            <User size={16} aria-hidden="true" /> Perfil
          </NavLink>
          <NavLink to="/conta/assinatura" className={tabClass}>
            <CreditCard size={16} aria-hidden="true" /> Assinatura
          </NavLink>
        </nav>

        <section className="bg-panel border border-border rounded-3xl p-6 md:p-8">
          {isSubscriptionTab ? (
            <AccountSubscriptionDetails user={user}>
              <Link
                to={{ pathname: '/', hash: '#pricing' }}
                className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-full text-sm font-medium transition-colors shadow-sm"
              >
                Ver planos
              </Link>
            </AccountSubscriptionDetails>
          ) : (
            <AccountProfileDetails user={user} />
          )}
        </section>
      </main>
    </div>
  );
};

export default Account;
