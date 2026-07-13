import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Save, User, MapPin, Briefcase, DollarSign, AlertTriangle, ChevronDown } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import CustomSelect from '../../components/CustomSelect';

const EmployeeForm = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('pessoal');

  // Form State
  const [status, setStatus] = useState('active');
  const [roleId, setRoleId] = useState('');
  const [contractType, setContractType] = useState('clt');
  const [paymentDay, setPaymentDay] = useState('5');
  const [salaryRecurrence, setSalaryRecurrence] = useState(true);

  const tabs = [
    { id: 'pessoal', label: 'Dados Pessoais', icon: <User size={16} /> },
    { id: 'vinculo', label: 'Cargo & Vínculo', icon: <Briefcase size={16} /> },
    { id: 'financeiro', label: 'Financeiro', icon: <DollarSign size={16} /> },
    { id: 'advertencias', label: 'Advertências', icon: <AlertTriangle size={16} /> },
  ];

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    // Simulate save
    navigate('/app/funcionarios');
  };

  return (
    <div className="p-6 md:p-8">
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-4xl mx-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link 
              to="/app/funcionarios"
              className="w-10 h-10 rounded-full bg-secondary/50 flex items-center justify-center text-muted hover:text-foreground transition-colors"
            >
              <ArrowLeft size={18} />
            </Link>
            <div>
              <h1 className="text-2xl font-heading font-bold text-foreground">Novo Funcionário</h1>
              <p className="text-muted text-sm mt-1">Preencha o dossiê do colaborador.</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <button 
              type="button"
              onClick={() => navigate('/app/funcionarios')}
              className="px-5 py-2.5 rounded-xl font-medium border border-border text-foreground hover:bg-secondary/50 transition-colors"
            >
              Cancelar
            </button>
            <button 
              onClick={handleSave}
              className="bg-primary hover:bg-primary/90 text-white px-5 py-2.5 rounded-xl font-medium transition-colors shadow-sm flex items-center gap-2"
            >
              <Save size={18} />
              Salvar Registro
            </button>
          </div>
        </div>

        {/* Content Area with Tabs */}
        <div className="glass-panel rounded-[2rem] border border-border/50">
          {/* Tab Navigation */}
          <div className="flex border-b border-border/50 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-6 py-4 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
                  activeTab === tab.id 
                    ? 'border-primary text-primary bg-primary/5' 
                    : 'border-transparent text-muted hover:text-foreground hover:bg-secondary/20'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Form Content */}
          <form className="p-6 md:p-8" onSubmit={handleSave}>
            {activeTab === 'pessoal' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-foreground/80 mb-2">Nome Completo</label>
                    <input type="text" className="w-full bg-background border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary/50" placeholder="Nome completo do funcionário" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground/80 mb-2">E-mail Pessoal</label>
                    <input type="email" className="w-full bg-background border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary/50" placeholder="email@exemplo.com" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground/80 mb-2">Telefone / WhatsApp</label>
                    <input type="text" className="w-full bg-background border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary/50" placeholder="(00) 00000-0000" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-foreground/80 mb-2">Endereço Completo</label>
                    <input type="text" className="w-full bg-background border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary/50" placeholder="Rua, Número, Bairro, Cidade - Estado" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground/80 mb-2">Status do Cadastro</label>
                    <CustomSelect
                      value={status}
                      onChange={setStatus}
                      options={[
                        { value: 'active', label: '🟢 Ativo' },
                        { value: 'inactive', label: '⚫ Inativo' }
                      ]}
                    />
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'vinculo' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-foreground/80 mb-2">Cargo</label>
                    <CustomSelect
                      value={roleId}
                      onChange={setRoleId}
                      options={[
                        { value: '1', label: 'Desenvolvedor Front-end (Tecnologia)' },
                        { value: '2', label: 'Analista de Recursos Humanos (RH)' },
                        { value: '3', label: 'Gerente de Vendas (Comercial)' }
                      ]}
                      placeholder="Selecione um cargo..."
                    />
                    <p className="text-xs text-muted mt-2">Os cargos devem ser cadastrados previamente na tela de Cargos.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground/80 mb-2">Data de Admissão</label>
                    <input type="date" className="w-full bg-background border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary/50 text-foreground" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground/80 mb-2">Tipo de Contrato</label>
                    <CustomSelect
                      value={contractType}
                      onChange={setContractType}
                      options={[
                        { value: 'clt', label: 'CLT' },
                        { value: 'pj', label: 'PJ' },
                        { value: 'estagio', label: 'Estágio' }
                      ]}
                    />
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'financeiro' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-foreground/80 mb-2">Salário Base (R$)</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted">R$</span>
                      <input type="text" className="w-full bg-background border border-border rounded-xl pl-10 pr-4 py-3 focus:ring-2 focus:ring-primary/50" placeholder="0,00" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground/80 mb-2">Dia de Pagamento</label>
                    <CustomSelect
                      value={paymentDay}
                      onChange={setPaymentDay}
                      options={[
                        { value: '5', label: 'Dia 5 útil' },
                        { value: '15', label: 'Dia 15' },
                        { value: '20', label: 'Dia 20' },
                        { value: 'last', label: 'Último dia útil' }
                      ]}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-foreground/80 mb-2">Dados Bancários (Opcional)</label>
                    <input type="text" className="w-full bg-background border border-border rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary/50" placeholder="Banco, Agência, Conta PIX..." />
                  </div>
                  <div className="md:col-span-2 flex items-center justify-between p-5 bg-primary/5 rounded-xl border border-primary/20 mt-2">
                    <div>
                      <h4 className="font-semibold text-primary mb-1">Recorrência de Salário</h4>
                      <p className="text-sm text-muted">Gerar despesa de salário automaticamente todo mês, para não precisar adicionar manualmente.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input type="checkbox" className="sr-only peer" checked={salaryRecurrence} onChange={(e) => setSalaryRecurrence(e.target.checked)} />
                      <div className="w-14 h-7 bg-secondary border-border border peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-primary shadow-inner"></div>
                    </label>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'advertencias' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                <div className="text-center py-10 bg-secondary/20 rounded-2xl border border-dashed border-border">
                  <AlertTriangle size={32} className="mx-auto text-muted mb-3" />
                  <h3 className="font-medium text-foreground mb-1">Nenhuma advertência</h3>
                  <p className="text-sm text-muted mb-4">Este funcionário tem o histórico limpo.</p>
                  <button type="button" className="text-sm font-medium text-primary hover:underline">
                    + Registrar nova advertência
                  </button>
                </div>
              </motion.div>
            )}
          </form>
        </div>
      </motion.div>
    </div>
  );
};

export default EmployeeForm;
