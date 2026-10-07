import LandingSection from './LandingSection';
import { ButtonLink } from '../ui';

// Valores conferidos com backend/src/plans/plan-catalog.ts (preço = priceLabel).
interface PlanRow {
  name: string;
  price: string;
  employees: string;
  roles: string;
  ponto: boolean;
  logins: string;
  cta: string;
}

const PLANS: PlanRow[] = [
  { name: 'Grátis', price: 'R$ 0', employees: 'até 10', roles: 'até 5', ponto: false, logins: '2', cta: 'Criar conta grátis' },
  { name: 'Básico', price: 'R$ 99/mês', employees: 'ilimitados', roles: 'ilimitados', ponto: true, logins: '10', cta: 'Começar grátis' },
  { name: 'Pro', price: 'R$ 299/mês', employees: 'ilimitados', roles: 'ilimitados', ponto: true, logins: '50', cta: 'Começar grátis' },
  { name: 'Empresarial', price: 'Sob consulta', employees: 'ilimitados', roles: 'ilimitados', ponto: true, logins: 'ilimitados', cta: 'Começar grátis' },
];

const ROWS: Array<{ label: string; get: (p: PlanRow) => string }> = [
  { label: 'Funcionários', get: (p) => p.employees },
  { label: 'Cargos', get: (p) => p.roles },
  { label: 'RH e clientes', get: () => '✓' },
  { label: 'Controle de ponto', get: (p) => (p.ponto ? '✓' : '—') },
  { label: 'Logins de funcionário', get: (p) => p.logins },
];

const LandingPlans = () => (
  <LandingSection id="planos" label="Planos" title="Grátis para começar.">
    <table className="hidden md:table w-full text-left">
      <thead>
        <tr>
          <th scope="col" className="w-[24%] border-t border-border py-4 pr-4">
            <span className="sr-only">Recurso</span>
          </th>
          {PLANS.map((p) => (
            <th key={p.name} scope="col" className="border-t border-border py-4 pr-4 align-top">
              <div className="font-semibold text-foreground">{p.name}</div>
              <div className="mt-1 text-[15px] font-normal text-muted">{p.price}</div>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ROWS.map((r) => (
          <tr key={r.label}>
            <th scope="row" className="border-t border-border py-3.5 pr-4 font-normal text-muted">{r.label}</th>
            {PLANS.map((p) => (
              <td key={p.name} className="border-t border-border py-3.5 pr-4 text-foreground">{r.get(p)}</td>
            ))}
          </tr>
        ))}
        <tr>
          <td className="border-t border-border py-5 pr-4" />
          {PLANS.map((p) => (
            <td key={p.name} className="border-t border-border py-5 pr-4">
              <ButtonLink to="/register" variant={p.name === 'Grátis' ? 'primary' : 'secondary'}>{p.cta}</ButtonLink>
            </td>
          ))}
        </tr>
      </tbody>
    </table>

    <div className="md:hidden">
      {PLANS.map((p) => (
        <div key={p.name} className="border-t border-border py-6">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-semibold text-foreground">{p.name}</h3>
            <span className="text-muted">{p.price}</span>
          </div>
          <dl className="mt-3 space-y-1.5">
            {ROWS.map((r) => (
              <div key={r.label} className="flex justify-between gap-4">
                <dt className="text-muted">{r.label}</dt>
                <dd className="text-foreground">{r.get(p)}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4">
            <ButtonLink to="/register" variant={p.name === 'Grátis' ? 'primary' : 'secondary'}>{p.cta}</ButtonLink>
          </div>
        </div>
      ))}
    </div>

    <p className="mt-6 max-w-[60ch] text-[14px] text-muted">
      Os planos pagos poderão ser contratados pelo sistema em breve. Comece grátis — seus dados continuam quando você
      mudar de plano.
    </p>
  </LandingSection>
);

export default LandingPlans;
