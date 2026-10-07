import type { ReactNode } from 'react';

interface LandingSectionProps {
  id: string;
  label: string;
  title: string;
  intro?: string;
  children?: ReactNode;
}

// Rótulo pequeno de seção: terracota com contraste AA (versão mais escura no claro, mais clara no escuro).
export const LANDING_LABEL_CLASS =
  'text-[12px] font-semibold uppercase tracking-[0.08em] text-[#9E3F28] dark:text-[#E08A6F]';

// Contêiner comum das seções do site: rótulo, título e (opcional) texto de apoio.
const LandingSection = ({ id, label, title, intro, children }: LandingSectionProps) => (
  <section id={id} className="scroll-mt-20 border-t border-border">
    <div className="max-w-[1180px] mx-auto px-4 sm:px-6 py-16 sm:py-24">
      <p className={LANDING_LABEL_CLASS}>{label}</p>
      <h2 className="mt-3 text-[28px] sm:text-[34px] font-semibold tracking-tight text-foreground">{title}</h2>
      {intro && <p className="mt-3 max-w-[60ch] text-muted">{intro}</p>}
      {children && <div className="mt-10 sm:mt-12">{children}</div>}
    </div>
  </section>
);

export default LandingSection;
