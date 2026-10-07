import type { ReactNode } from 'react';
import { ButtonLink, buttonClass } from '../ui';

interface LandingHeroProps {
  tour?: ReactNode;
}

// Topo da página inicial (07/10/2026, versão centralizada escolhida pelo usuário): texto centralizado com
// bastante respiro e o tour do sistema largo logo abaixo, quase no tamanho real do desenho.
const LandingHero = ({ tour }: LandingHeroProps) => (
  <section className="max-w-[1180px] mx-auto px-4 sm:px-6 pt-32 pb-16 sm:pb-24 lg:pt-40">
    <div className="mx-auto max-w-[760px] text-center">
      <h1 className="text-[36px] sm:text-[52px] font-semibold leading-[1.05] tracking-tight text-foreground">
        Gestão de pessoas, ponto e clientes em um só sistema.
      </h1>
      <p className="mx-auto mt-6 max-w-[56ch] text-[17px] leading-relaxed text-muted">
        Para empresas de qualquer tamanho: funcionários, férias, ponto com aprovação de ajustes e cobrança de
        clientes no mesmo lugar.
      </p>
      <div className="mt-9 flex flex-wrap justify-center gap-3">
        <ButtonLink to="/register">Criar conta grátis</ButtonLink>
        <a href="#planos" className={buttonClass('secondary')}>Ver planos</a>
      </div>
      <p className="mt-4 text-[13px] text-muted">Grátis para até 10 funcionários. Sem cartão de crédito.</p>
    </div>
    {tour && <div className="mt-14 sm:mt-20 min-w-0">{tour}</div>}
  </section>
);

export default LandingHero;
