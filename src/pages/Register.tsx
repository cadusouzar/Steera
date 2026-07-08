import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import Mascot from '../components/Mascot';
import FlowBackground from '../components/FlowBackground';

const Register = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [planName, setPlanName] = useState<string>('');

  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isCovering, setIsCovering] = useState(false);

  useEffect(() => {
    const plan = searchParams.get('plan');
    if (plan) {
      setPlanName(plan.charAt(0).toUpperCase() + plan.slice(1));
    }
  }, [searchParams]);

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    navigate('/app');
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

          <form className="space-y-4" onSubmit={handleRegister}>
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-2">Nome Completo</label>
              <input
                type="text"
                required
                className="w-full bg-background border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                placeholder="Seu nome"
                onFocus={() => setIsCovering(false)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-2">E-mail Corporativo</label>
              <input
                type="email"
                required
                className="w-full bg-background border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                placeholder="nome@empresa.com"
                onFocus={() => setIsCovering(false)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-2">Senha</label>
              <input
                type="password"
                required
                className="w-full bg-background border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                placeholder="Crie uma senha forte"
                onFocus={() => setIsCovering(true)}
                onBlur={() => setIsCovering(false)}
              />
            </div>

            <button className="w-full bg-primary hover:bg-primary/90 text-white font-medium py-3 rounded-xl transition-colors shadow-lg shadow-primary/20 mt-4">
              Criar Conta
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
