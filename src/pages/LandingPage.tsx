import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Hero3DProduct from '../components/Hero3DProduct';
import PricingCard from '../components/PricingCard';
import { Users, Briefcase, BarChart3, TrendingUp, ArrowRight, CheckCircle2, X } from 'lucide-react';

const LandingPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [showRegisteredNotice, setShowRegisteredNotice] = useState(
    () => (location.state as { registered?: boolean } | null)?.registered === true,
  );

  // Limpa o state de navegação depois de copiar o valor pro state local — assim recarregar a
  // página não mostra o aviso de novo (o state não sobrevive a um F5, mas sobrevive a navegações
  // internas subsequentes até ser limpo explicitamente).
  useEffect(() => {
    if ((location.state as { registered?: boolean } | null)?.registered === true) {
      navigate('.', { replace: true, state: null });
    }
  }, [location.state, navigate]);

  return (
    <div className="relative min-h-screen bg-background transition-colors duration-300">
      <Navbar />

      {showRegisteredNotice && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-24 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-md rounded-xl border border-primary/30 bg-panel px-5 py-3 text-sm text-foreground shadow-lg flex items-start gap-3"
        >
          <CheckCircle2 size={18} className="text-primary shrink-0 mt-0.5" />
          <span className="flex-1 min-w-0">
            Conta criada! Use <strong>Entrar no sistema</strong> no topo da página para acessar.
          </span>
          <button
            type="button"
            onClick={() => setShowRegisteredNotice(false)}
            className="text-muted hover:text-foreground transition-colors shrink-0"
            aria-label="Fechar aviso"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Asymmetric Split Hero */}
      <main className="container mx-auto px-4 md:px-6 pt-32 pb-16 lg:pt-40 lg:pb-24">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center max-w-7xl mx-auto">

          {/* Left Column: Copy & CTAs */}
          <div className="flex flex-col justify-center text-left">
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              className="text-5xl lg:text-7xl font-heading font-bold text-foreground leading-[1.1] mb-6"
            >
              A operação inteira em <span className="text-primary">um único núcleo</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
              className="text-lg lg:text-xl text-muted max-w-[50ch] mb-10 leading-relaxed"
            >
              Unifique RH, ponto, logística e inteligência financeira. Um ERP projetado para escalar operações corporativas sem atrito.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-wrap gap-4 pointer-events-auto"
            >
              <button className="bg-foreground hover:bg-foreground/90 text-background px-7 py-3.5 rounded-full font-medium transition-colors shadow-sm flex items-center gap-2">
                Começar Agora
                <ArrowRight size={18} />
              </button>
              <button className="bg-secondary/30 hover:bg-secondary/60 text-foreground px-7 py-3.5 rounded-full font-medium transition-colors border border-border">
                Agendar Demonstração
              </button>
            </motion.div>
          </div>

          {/* Right Column: 3D Product View */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="w-full relative"
          >
            <Hero3DProduct />
          </motion.div>

        </div>
      </main>

      {/* Bento Grid Features Section */}
      <section className="container mx-auto px-4 md:px-6 py-24 border-t border-border/50">
        <div className="max-w-7xl mx-auto">
          <div className="mb-16 max-w-2xl">
            <h2 className="text-3xl md:text-5xl font-heading font-bold text-foreground mb-4 tracking-tight">
              Módulos nativos
            </h2>
            <p className="text-lg text-muted">
              Esqueça integrações complexas. Todas as ferramentas da operação funcionam a partir da mesma base de dados.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 auto-rows-[280px]">
            {/* Large Feature 1 */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.6 }}
              className="md:col-span-2 glass-panel p-8 md:p-10 rounded-[2rem] flex flex-col justify-between overflow-hidden relative group"
            >
              <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 transition-transform duration-700 group-hover:scale-150" />
              <div className="w-14 h-14 bg-background border border-border rounded-2xl flex items-center justify-center text-primary mb-6 shadow-sm z-10">
                <Users size={28} />
              </div>
              <div className="z-10">
                <h3 className="text-2xl font-heading font-bold text-foreground mb-3">Gestão de Pessoas e Cargos</h3>
                <p className="text-muted text-base max-w-[40ch] leading-relaxed">
                  Controle salários, organograma e permissões granulares de acesso para cada nível da empresa.
                </p>
              </div>
            </motion.div>

            {/* Small Feature 1 */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="md:col-span-1 glass-panel p-8 rounded-[2rem] flex flex-col justify-between overflow-hidden relative"
            >
              <div className="w-14 h-14 bg-background border border-border rounded-2xl flex items-center justify-center text-accent mb-6 shadow-sm">
                <Briefcase size={28} />
              </div>
              <div>
                <h3 className="text-xl font-heading font-bold text-foreground mb-2">Ponto Online</h3>
                <p className="text-muted text-sm leading-relaxed">
                  Registro via geolocalização e foto instantânea do funcionário.
                </p>
              </div>
            </motion.div>

            {/* Small Feature 2 */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="md:col-span-1 glass-panel p-8 rounded-[2rem] flex flex-col justify-between overflow-hidden relative"
            >
              <div className="w-14 h-14 bg-background border border-border rounded-2xl flex items-center justify-center text-accent mb-6 shadow-sm">
                <TrendingUp size={28} />
              </div>
              <div>
                <h3 className="text-xl font-heading font-bold text-foreground mb-2">Logística</h3>
                <p className="text-muted text-sm leading-relaxed">
                  Gerenciamento preciso de EAN, estoque e fornecedores.
                </p>
              </div>
            </motion.div>

            {/* Large Feature 2 */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.2 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="md:col-span-2 glass-panel bg-secondary/20 p-8 md:p-10 rounded-[2rem] flex flex-col justify-between overflow-hidden relative"
            >
              <div className="w-14 h-14 bg-background border border-border rounded-2xl flex items-center justify-center text-primary mb-6 shadow-sm">
                <BarChart3 size={28} />
              </div>
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div>
                  <h3 className="text-2xl font-heading font-bold text-foreground mb-3">Inteligência Financeira</h3>
                  <p className="text-muted text-base max-w-[40ch] leading-relaxed">
                    Dashboards analíticos de faturamento e projeções temporais baseados no fluxo de caixa real.
                  </p>
                </div>
                <button className="text-sm font-medium text-foreground underline underline-offset-4 hover:text-primary transition-colors">
                  Explorar BI
                </button>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="container mx-auto px-4 md:px-6 py-24 border-t border-border/50">
        <div className="max-w-7xl mx-auto">
          <div className="mb-16 max-w-2xl">
            <h2 className="text-3xl md:text-5xl font-heading font-bold text-foreground mb-4 tracking-tight">
              Planos transparentes
            </h2>
            <p className="text-lg text-muted">
              Escolha o formato que atende ao tamanho atual da sua empresa.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <PricingCard
              name="Starter"
              price="R$ 99"
              features={["Até 10 funcionários", "Controle de Ponto", "Gestão de Cargos", "Suporte Email"]}
            />
            <PricingCard
              name="Pro"
              price="R$ 299"
              isPopular={true}
              features={["Até 50 funcionários", "Estoque e Fornecedores", "Dashboards Financeiros", "Suporte Prioritário"]}
            />
            <PricingCard
              name="Enterprise"
              price="Custom"
              features={["Funcionários Ilimitados", "Cursos Online LMS", "Acesso à API", "Gerente de Contas Dedicado"]}
            />
          </div>
        </div>
      </section>

      <footer className="border-t border-border py-12 text-center text-muted text-sm">
        <p>© 2026 QuickFlow. Todos os direitos reservados.</p>
      </footer>
    </div>
  );
};

export default LandingPage;
