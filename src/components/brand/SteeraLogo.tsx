// Marca Steera (02/10/2026): a palavra "steera" em Outfit SemiBold (espaçamento −4,5%) + o símbolo
// "juba" (8 pétalas terracota em volta do miolo mel). Versões do guia da marca:
// - `color` (padrão): fundos claros e o site;
// - `mono`: painel do ERP — pétalas na cor do texto e miolo na cor do fundo, segue o tema.

const PETALS: Array<[number, number]> = [
  [50, 32], [44.73, 44.73], [32, 50], [19.27, 44.73], [14, 32], [19.27, 19.27], [32, 14], [44.73, 19.27],
];

interface MarkProps {
  variant?: 'color' | 'mono';
  className?: string;
  /** Só no `mono`: classe de preenchimento do miolo (a cor do fundo onde o símbolo está). */
  centerClassName?: string;
}

export const SteeraMark = ({ variant = 'color', className = '', centerClassName = 'fill-panel' }: MarkProps) => (
  <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
    <g className={variant === 'color' ? 'fill-brand' : 'fill-current'}>
      {PETALS.map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={10} />)}
    </g>
    <circle cx={32} cy={32} r={13} className={variant === 'color' ? 'fill-brand-honey' : centerClassName} />
  </svg>
);

interface LogoProps extends MarkProps {
  /** Tamanho da palavra; o símbolo acompanha (0,46 em). */
  size?: string;
}

/** Logo completo. O nome acessível fica para quem envolve (ex.: o link "Steera — página inicial"). */
const SteeraLogo = ({ variant = 'color', className = '', centerClassName, size = 'text-[24px]' }: LogoProps) => (
  <span className={`inline-flex items-baseline gap-[0.12em] font-brand font-semibold tracking-[-0.045em] leading-none text-foreground ${size} ${className}`}>
    <span aria-hidden="true">steera</span>
    <SteeraMark variant={variant} centerClassName={centerClassName} className="h-[0.46em] w-[0.46em] shrink-0" />
  </span>
);

export default SteeraLogo;
