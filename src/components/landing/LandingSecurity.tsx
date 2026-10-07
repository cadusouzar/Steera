import LandingSection from './LandingSection';

const ITEMS = [
  ['Dados de cada empresa separados', 'Cada empresa tem um espaço próprio no banco de dados.'],
  ['Dados sensíveis protegidos', 'CPF e dados bancários aparecem ocultos nas listagens.'],
  [
    'Senha forte e bloqueio temporário',
    'Senhas fracas são recusadas; depois de 5 tentativas erradas a conta fica travada por 15 minutos e a pessoa recebe um e-mail.',
  ],
  [
    'Ponto que não se apaga',
    'O horário vem do servidor; correções ficam registradas e a marcação original nunca é apagada.',
  ],
];

const LandingSecurity = () => (
  <LandingSection id="seguranca" label="Segurança" title="Proteção que já vem ligada.">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-14 gap-y-8">
      {ITEMS.map(([t, d]) => (
        <div key={t} className="border-t border-border pt-4">
          <h3 className="font-semibold text-foreground">{t}</h3>
          <p className="mt-1.5 text-muted">{d}</p>
        </div>
      ))}
    </div>
  </LandingSection>
);

export default LandingSecurity;
