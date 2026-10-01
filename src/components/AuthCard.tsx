import { ReactNode } from 'react';
import { motion } from 'framer-motion';
import Navbar from './Navbar';
import FlowBackground from './FlowBackground';

interface AuthCardProps {
  title: string;
  subtitle: string;
  children: ReactNode;
}

// Layout compartilhado das páginas públicas de acesso (esqueci senha, redefinir senha, confirmar
// e-mail, aceitar convite) — mesmo visual do cartão de Login.tsx (`glass-panel p-10 rounded-3xl`,
// mesma animação de entrada, mesma tipografia de título/subtítulo), classes extraídas de lá sem
// alterar Login.tsx. Diferente de Login/Register (que têm seu próprio link "Voltar para Home"),
// estas páginas podem ser abertas por alguém já logado (ex.: clicar no link de confirmação de
// e-mail com a sessão aberta em outra aba) — por isso usam a `Navbar` do site no topo, igual
// `Account.tsx`, que já reflete a sessão atual em vez de sempre assumir um visitante anônimo.
const AuthCard = ({ title, subtitle, children }: AuthCardProps) => (
  <div className="relative min-h-screen bg-background overflow-hidden transition-colors duration-300">
    <FlowBackground />
    <Navbar />

    <div className="relative z-10 min-h-screen flex items-center justify-center px-6 pt-24 pb-12">
      <div className="w-full max-w-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, type: 'spring', bounce: 0.4 }}
          className="glass-panel p-10 rounded-3xl"
        >
          <div className="text-center mb-8">
            <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center font-heading font-bold text-primary-foreground shadow-lg shadow-primary/20 mx-auto mb-4 text-xl">
              Q
            </div>
            <h1 className="text-2xl font-heading font-bold mb-2 text-foreground">{title}</h1>
            <p className="text-foreground/60 text-sm">{subtitle}</p>
          </div>

          {children}
        </motion.div>
      </div>
    </div>
  </div>
);

export default AuthCard;
