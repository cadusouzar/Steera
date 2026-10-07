import type { ReactNode } from 'react';
import { ButtonLink, buttonClass } from '../ui';

interface LandingHeroProps {
  tour?: ReactNode;
}

const LandingHero = ({ tour }: LandingHeroProps) => (
  <section className="max-w-[1180px] mx-auto px-4 sm:px-6 pt-32 pb-16 sm:pb-24 lg:pt-40">
    <div className="grid grid-cols-1 lg:grid-cols-[5fr_7fr] gap-12 lg:gap-14 items-center">
      <div className="min-w-0">
        <h1 className="text-[36px] sm:text-[44px] font-semibold leading-[1.08] tracking-tight text-foreground">
          Gestão de pessoas, ponto e clientes em um só sistema.
        </h1>
        <p className="mt-5 max-w-[48ch] text-[17px] leading-relaxed text-muted">
          Para pequenas e médias empresas: funcionários, férias, ponto com aprovação de ajustes e cobrança de
          clientes no mesmo lugar.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink to="/register">Criar conta grátis</ButtonLink>
          <a href="#planos" className={buttonClass('secondary')}>Ver planos</a>
        </div>
        <p className="mt-4 text-[13px] text-muted">Grátis para até 10 funcionários. Sem cartão de crédito.</p>
      </div>
      <div className="min-w-0">{tour}</div>
    </div>
  </section>
);

export default LandingHero;
