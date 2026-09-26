import React from 'react';
import { Check } from 'lucide-react';
import { Link } from 'react-router-dom';

interface PricingCardProps {
  name: string;
  price: string;
  features: string[];
  isPopular?: boolean;
  // Texto do botão de ação — "Selecionar Plano" por padrão, "Comece agora" no plano Grátis.
  ctaLabel?: string;
}

const PricingCard: React.FC<PricingCardProps> = ({ name, price, features, isPopular, ctaLabel = 'Selecionar Plano' }) => {
  return (
    <div className={`relative glass-panel rounded-3xl p-8 flex flex-col ${isPopular ? 'border-primary shadow-xl shadow-primary/10 scale-105 z-10' : ''}`}>
      {isPopular && (
        <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-gradient-to-r from-primary to-accent text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
          Mais Escolhido
        </div>
      )}
      
      <div className="mb-8">
        <h3 className="text-xl font-heading font-semibold text-foreground mb-2">{name}</h3>
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-heading font-bold text-foreground">{price}</span>
          {price !== 'R$ 0' && price !== 'Sob consulta' && <span className="text-foreground/50 text-sm">/mês</span>}
        </div>
      </div>
      
      <ul className="space-y-4 mb-8 flex-1">
        {features.map((feature, idx) => (
          <li key={idx} className="flex items-start gap-3 text-sm text-foreground/80">
            <Check size={18} className="text-primary shrink-0 mt-0.5" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      
      <Link 
        to={`/register?plan=${name.toLowerCase()}`}
        className={`w-full py-3 rounded-xl font-medium text-center transition-colors ${
          isPopular 
            ? 'bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/25' 
            : 'bg-background hover:bg-secondary/50 text-foreground border border-border shadow-sm'
        }`}
      >
        {ctaLabel}
      </Link>
    </div>
  );
};

export default PricingCard;
