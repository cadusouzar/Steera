import { ButtonLink } from '../ui';

const LandingFinalCta = () => (
  <section className="border-t border-border">
    <div className="max-w-[1180px] mx-auto px-4 sm:px-6 py-14 sm:py-16 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
      <p className="text-[24px] sm:text-[28px] font-semibold tracking-tight text-foreground">
        Comece agora — leva uns 2 minutos.
      </p>
      <ButtonLink to="/register">Criar conta grátis</ButtonLink>
    </div>
  </section>
);

export default LandingFinalCta;
