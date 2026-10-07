import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import LandingSection from './LandingSection';

const FAQ = [
  ['Preciso de cartão de crédito?', 'Não. O plano Grátis não pede cartão.'],
  [
    'Como os funcionários batem o ponto?',
    'Pelo navegador, no computador ou no celular. A empresa pode exigir foto e definir locais de trabalho; uma batida fora do local vai para análise.',
  ],
  [
    'Os dados da minha empresa ficam separados?',
    'Sim. Cada empresa tem um espaço próprio no banco de dados, e cada pessoa só vê o que o perfil dela permite.',
  ],
  ['Funciona no celular?', 'Sim, o sistema inteiro funciona no navegador do celular.'],
  ['Quanto tempo leva para começar?', 'O cadastro leva uns 2 minutos; depois é só cadastrar cargos e funcionários.'],
];

const LandingFaq = () => {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <LandingSection id="duvidas" label="Dúvidas" title="Perguntas frequentes.">
      <div className="max-w-[760px] border-b border-border">
        {FAQ.map(([q, a], i) => {
          const isOpen = open === i;
          return (
            <div key={q} className="border-t border-border">
              <h3>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={`faq-${i}`}
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between gap-4 py-4 text-left font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-foreground"
                >
                  {q}
                  <ChevronDown
                    size={18}
                    aria-hidden="true"
                    className={`shrink-0 text-muted transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>
              </h3>
              <div id={`faq-${i}`} role="region" aria-label={q} hidden={!isOpen} className="pb-5 pr-8 text-muted">
                {a}
              </div>
            </div>
          );
        })}
      </div>
    </LandingSection>
  );
};

export default LandingFaq;
