import { LANDING_LABEL_CLASS } from './LandingSection';
import { BRAND_NAME } from '../../lib/brand';

const MODULES = [
  {
    name: 'Recursos humanos',
    items: [
      'Cadastro de funcionários e cargos',
      'Férias e afastamentos sem conflito de datas',
      'Pagamentos recorrentes e advertências',
    ],
  },
  {
    name: 'Controle de ponto',
    items: [
      'Batida pelo navegador ou pelo celular, com local de trabalho opcional',
      'Ajustes e atestados com aprovação do gestor',
      'Jornadas para a empresa, uma equipe ou uma pessoa',
    ],
  },
  {
    name: 'Clientes e cobrança',
    items: [
      'Lançamentos e assinaturas mensais',
      'Fatura do mês gerada automaticamente',
      'Relatório por período, que serve de fechamento do dia',
    ],
  },
];

const LandingModules = () => (
  <section id="modulos" className="scroll-mt-20 border-t border-border">
    <div className="max-w-[1180px] mx-auto px-4 sm:px-6 py-16 sm:py-24 grid grid-cols-1 lg:grid-cols-[4fr_8fr] gap-10 lg:gap-14">
      <div>
        <p className={LANDING_LABEL_CLASS}>Módulos</p>
        <h2 className="mt-3 text-[28px] sm:text-[34px] font-semibold tracking-tight text-foreground">O que o {BRAND_NAME} faz hoje.</h2>
        <p className="mt-3 max-w-[40ch] text-muted">Comece com o essencial e ative o resto quando a empresa crescer.</p>
      </div>
      <div>
        {MODULES.map((m) => (
          <div key={m.name} className="border-t border-border py-6 grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-3 sm:gap-6">
            <h3 className="font-semibold text-foreground">{m.name}</h3>
            <ul className="space-y-1.5 text-muted">
              {m.items.map((i) => <li key={i}>{i}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </div>
  </section>
);

export default LandingModules;
