import { motion } from 'framer-motion';
import { Briefcase } from 'lucide-react';
import { Link } from 'react-router-dom';

const Overview = () => {
  return (
    <div className="p-6 md:p-8">
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-5xl mx-auto"
      >
        <h1 className="text-2xl font-heading font-bold text-foreground mb-2">Visão Geral</h1>
        <p className="text-muted mb-8">Bem-vindo ao QuickFlow. Aqui está o resumo da sua operação.</p>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="glass-panel p-6 rounded-2xl border border-border/50">
            <div className="text-muted text-sm mb-2">Funcionários Ativos</div>
            <div className="text-3xl font-heading font-bold text-foreground">0</div>
          </div>
          <div className="glass-panel p-6 rounded-2xl border border-border/50">
            <div className="text-muted text-sm mb-2">Cargos Registrados</div>
            <div className="text-3xl font-heading font-bold text-foreground">0</div>
          </div>
          <div className="glass-panel p-6 rounded-2xl border border-border/50">
            <div className="text-muted text-sm mb-2">Avisos Pendentes</div>
            <div className="text-3xl font-heading font-bold text-foreground">0</div>
          </div>
        </div>
        
        <div className="mt-8 glass-panel p-8 rounded-[2rem] border border-border/50 text-center py-16">
          <div className="w-16 h-16 bg-secondary/50 rounded-full flex items-center justify-center mx-auto mb-4 text-muted">
            <Briefcase size={32} />
          </div>
          <h3 className="text-xl font-heading font-semibold text-foreground mb-2">Configure sua estrutura</h3>
          <p className="text-muted mb-6 max-w-sm mx-auto">Comece cadastrando os cargos da sua empresa antes de adicionar os funcionários.</p>
          <div className="flex justify-center gap-4">
            <Link to="/app/cargos" className="bg-primary hover:bg-primary/90 text-white px-6 py-2.5 rounded-xl font-medium transition-colors">
              Ir para Cargos
            </Link>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default Overview;
