import LegalPage from '../../components/legal/LegalPage';
import { LEGAL_VERSIONS, formatLegalDate } from '../../lib/legal';

// Texto literal de docs/superpowers/specs/2026-10-07-lgpd-privacidade.md (gerado a partir dele).
const Privacy = () => (
  <LegalPage
    title="Política de Privacidade — Steera"
    version={LEGAL_VERSIONS.PRIVACY.version}
    effectiveDate={formatLegalDate(LEGAL_VERSIONS.PRIVACY.effectiveDate)}
    intro={
      <>
        <p>Esta política explica, em linguagem direta, quais dados o Steera trata, para quê, com quem compartilha, por quanto tempo guarda e como você exerce seus direitos, conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD).</p>
      </>
    }
    sections={[
      {
        id: 'secao-1',
        title: '1. Quem é o responsável',
        content: (
          <>
            <p>O Steera é um sistema de gestão. Para qualquer assunto sobre privacidade e dados pessoais, inclusive como encarregado, o contato é <strong><a href="mailto:carlos@steera.com.br" className="underline underline-offset-2 hover:text-primary">carlos@steera.com.br</a></strong>.</p>
          </>
        ),
      },
      {
        id: 'secao-2',
        title: '2. Dois tipos de dados, dois papéis',
        content: (
          <>
            <ul className="list-disc pl-5 space-y-1.5"><li><strong>Dados da sua conta</strong> — quem cria a conta da empresa e quem recebe um login. Para esses dados, o Steera decide como e por que tratá-los: é o <strong>controlador</strong>.</li><li><strong>Dados que a empresa coloca no sistema</strong> — funcionários, registros de ponto, atestados, clientes e lançamentos. Esses dados pertencem à empresa que usa o Steera, que é a <strong>controladora</strong>; o Steera apenas os guarda e processa para prestar o serviço, seguindo as instruções da empresa: é o <strong>operador</strong>. Se você é funcionário ou cliente de uma empresa que usa o Steera, pedidos sobre esses dados devem ser feitos primeiro à própria empresa (veja a seção 11).</li></ul>
          </>
        ),
      },
      {
        id: 'secao-3',
        title: '3. Quais dados tratamos',
        content: (
          <>
            <p><strong>Dados da conta e da empresa (cadastro)</strong></p>
            <ul className="list-disc pl-5 space-y-1.5"><li>Nome, e-mail e senha (a senha é guardada apenas como <em>hash</em> com o algoritmo argon2 — nunca em texto puro).</li><li>Dados da empresa: tipo (pessoa jurídica ou física), CNPJ ou CPF, razão social ou nome completo, nome fantasia, telefone e endereço, e o nome do responsável.</li><li>Registro do aceite destes documentos: versão aceita, data e hora, endereço IP e navegador usado.</li></ul>
            <p><strong>Dados que a empresa coloca no sistema</strong></p>
            <ul className="list-disc pl-5 space-y-1.5"><li>Funcionários: nome, CPF, e-mail, telefone, endereço, cargo, departamento, superior, tipo de contrato, data de admissão, salário, dados bancários, férias, afastamentos (com motivo, se informado), advertências e pagamentos.</li><li>Controle de ponto: horários das marcações e, se a empresa exigir, a localização no momento da marcação e uma foto; pedidos de ajuste, justificativas e atestados médicos com o arquivo anexado. <strong>Atestados são dados de saúde (dado sensível)</strong>: o sistema não tem campo de diagnóstico ou CID, e o arquivo só é acessado por quem tem permissão na empresa.</li><li>Clientes da empresa: nome, contato, e-mail, lançamentos e assinaturas.</li><li>Campos personalizados que a própria empresa criar.</li></ul>
            <p><strong>Dados técnicos</strong></p>
            <ul className="list-disc pl-5 space-y-1.5"><li>Para manter você conectado, um cookie de sessão (veja a seção 7).</li><li>O endereço IP é usado no momento de cada acesso para limitar tentativas de login e proteger as contas; ele não é gravado, exceto no registro de aceite destes documentos.</li><li>O Steera <strong>não</strong> usa ferramentas de análise de navegação, rastreamento ou publicidade.</li></ul>
          </>
        ),
      },
      {
        id: 'secao-4',
        title: '4. Para que usamos e com qual base legal',
        content: (
          <>
            <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full text-left text-sm"><caption className="sr-only">Usos dos dados e base legal de cada um</caption><thead className="bg-panel"><tr><th scope="col" className="px-3 py-2 font-semibold">Uso</th><th scope="col" className="px-3 py-2 font-semibold">Base legal (LGPD, art. 7º)</th></tr></thead><tbody><tr className="border-t border-border align-top"><td className="px-3 py-2">Criar e manter a conta, permitir o login, prestar o serviço contratado</td><td className="px-3 py-2">Execução de contrato</td></tr><tr className="border-t border-border align-top"><td className="px-3 py-2">Enviar e-mails do serviço (confirmação de e-mail, convites, redefinição de senha, aviso de bloqueio)</td><td className="px-3 py-2">Execução de contrato</td></tr><tr className="border-t border-border align-top"><td className="px-3 py-2">Proteger as contas (limite de tentativas, bloqueio temporário, senha forte)</td><td className="px-3 py-2">Legítimo interesse (segurança)</td></tr><tr className="border-t border-border align-top"><td className="px-3 py-2">Registrar o aceite destes documentos</td><td className="px-3 py-2">Legítimo interesse e exercício regular de direitos</td></tr><tr className="border-t border-border align-top"><td className="px-3 py-2">Guardar e processar os dados que a empresa coloca no sistema</td><td className="px-3 py-2">Definida pela empresa (controladora); o Steera atua como operador</td></tr><tr className="border-t border-border align-top"><td className="px-3 py-2">Atender a obrigações legais ou ordens de autoridades</td><td className="px-3 py-2">Cumprimento de obrigação legal</td></tr></tbody></table></div>
            <p>O Steera não vende dados pessoais e não os usa para nenhuma outra finalidade.</p>
          </>
        ),
      },
      {
        id: 'secao-5',
        title: '5. Com quem compartilhamos',
        content: (
          <>
            <ul className="list-disc pl-5 space-y-1.5"><li><strong>Amazon Web Services (Amazon SES)</strong> — envio dos e-mails do serviço. Recebe o endereço de e-mail e o conteúdo da mensagem.</li><li><strong>BrasilAPI e ViaCEP</strong> — durante o cadastro, o seu navegador consulta esses serviços públicos com o CNPJ e o CEP digitados, para preencher o endereço automaticamente. O Steera não envia outros dados a eles.</li><li><strong>Provedores de infraestrutura em nuvem</strong> — servidores e banco de dados onde o sistema funciona.</li><li><strong>Autoridades</strong>, quando houver obrigação legal ou ordem judicial.</li></ul>
          </>
        ),
      },
      {
        id: 'secao-6',
        title: '6. Transferência internacional',
        content: (
          <>
            <p>Os e-mails do serviço são enviados pela Amazon SES a partir de servidores nos <strong>Estados Unidos</strong>. Essa transferência é feita para executar o serviço que você contratou e com um provedor que adota medidas de segurança compatíveis com as exigidas pela LGPD. Os provedores de infraestrutura também podem estar fora do Brasil; quando estiverem, esta política será atualizada para informar onde.</p>
          </>
        ),
      },
      {
        id: 'secao-7',
        title: '7. Cookies e armazenamento no navegador',
        content: (
          <>
            <ul className="list-disc pl-5 space-y-1.5"><li><strong>Cookie de sessão (essencial)</strong> — mantém você conectado por até 30 dias. É protegido (HttpOnly, Secure, SameSite=Strict) e usado só pelo próprio Steera. Sem ele, não é possível entrar no sistema.</li><li><strong>Armazenamento local do navegador</strong> — guarda apenas a sua escolha de tema (claro ou escuro) e, na área de painéis, os painéis que você montar. Fica só no seu navegador.</li><li>Não usamos cookies de análise, rastreamento ou publicidade, então não há nada a aceitar ou recusar além do essencial.</li></ul>
          </>
        ),
      },
      {
        id: 'secao-8',
        title: '8. Por quanto tempo guardamos',
        content: (
          <>
            <ul className="list-disc pl-5 space-y-1.5"><li>Dados da conta e dados que a empresa coloca no sistema: <strong>enquanto a conta da empresa existir</strong>. A própria empresa pode apagar ou inativar registros a qualquer momento.</li><li><strong>Encerramento da conta da empresa:</strong> todos os dados dela — inclusive todos os logins — são apagados em até <strong>30 dias</strong>, exceto o que a lei obrigar a manter.</li><li><strong>Exclusão de um login:</strong> os dados pessoais daquele login (nome, e-mail, senha e registros de aceite) são apagados. O que a empresa guarda sobre a pessoa — como a ficha de funcionário, o ponto e os atestados — continua com a empresa, que é a controladora desses dados.</li><li>A empresa é responsável por guardar, pelo prazo exigido pela legislação trabalhista, os registros de ponto e demais documentos de que precise — inclusive antes de encerrar a conta.</li><li>Prazos que o sistema já aplica: sessão de até 30 dias; link de convite válido por 72 horas; link de confirmação de e-mail válido por 24 horas; link de redefinição de senha válido por 30 minutos; clientes enviados para a lixeira são apagados em 30 dias.</li></ul>
          </>
        ),
      },
      {
        id: 'secao-9',
        title: '9. Como protegemos os dados',
        content: (
          <>
            <ul className="list-disc pl-5 space-y-1.5"><li>Cada empresa tem um espaço próprio e separado no banco de dados, com uma camada adicional de isolamento.</li><li>Cada pessoa só vê e altera o que o perfil de acesso dela permite.</li><li>CPF e dados bancários aparecem ocultos nas listagens.</li><li>Senhas guardadas com argon2; senhas fracas são recusadas; após 5 tentativas erradas a conta fica travada por 15 minutos e a pessoa é avisada por e-mail.</li><li>Os registros de ponto usam o horário do servidor; correções ficam registradas e a marcação original nunca é apagada.</li><li>Arquivos (fotos e atestados) só são baixados por quem tem permissão, com um link temporário.</li></ul>
            <p>Nenhum sistema é totalmente imune a falhas. Se ocorrer um incidente de segurança que possa trazer risco ou dano relevante, avisaremos as pessoas afetadas e a Autoridade Nacional de Proteção de Dados (ANPD), como a lei determina.</p>
          </>
        ),
      },
      {
        id: 'secao-10',
        title: '10. Seus direitos',
        content: (
          <>
            <p>Pela LGPD (art. 18), você pode pedir: confirmação de que tratamos seus dados; acesso a eles; correção de dados incompletos, inexatos ou desatualizados; anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desacordo com a lei; portabilidade; eliminação dos dados tratados com seu consentimento; informação sobre com quem compartilhamos; e revisão de decisões automatizadas (o Steera não toma decisões automatizadas sobre pessoas).</p>
            <p>Para exercer qualquer direito, escreva para <strong><a href="mailto:carlos@steera.com.br" className="underline underline-offset-2 hover:text-primary">carlos@steera.com.br</a></strong>. Responderemos em até 15 dias. Parte dos dados da conta você mesmo pode ver e corrigir em <strong>Minha conta</strong>. Você também pode reclamar à ANPD.</p>
            <p>Para <strong>excluir o seu login</strong>, peça a um administrador da sua empresa (ele faz isso em Usuários e Acessos) ou escreva para o e-mail acima, e encaminharemos o pedido à empresa. Se você for a única pessoa que administra a empresa, é preciso antes passar a administração a outra pessoa ou pedir o <strong>encerramento da conta da empresa</strong>.</p>
          </>
        ),
      },
      {
        id: 'secao-11',
        title: '11. Se você é funcionário ou cliente de uma empresa que usa o Steera',
        content: (
          <>
            <p>Seus dados foram colocados no Steera pela empresa, que decide sobre eles. Pedidos de acesso, correção ou exclusão devem ser feitos à empresa. Se você nos procurar, encaminharemos o pedido a ela.</p>
          </>
        ),
      },
      {
        id: 'secao-12',
        title: '12. Crianças e adolescentes',
        content: (
          <>
            <p>O Steera é um serviço para empresas e não é destinado a menores de 18 anos.</p>
          </>
        ),
      },
      {
        id: 'secao-13',
        title: '13. Mudanças nesta política',
        content: (
          <>
            <p>Quando esta política mudar de forma relevante, a versão e a data no topo serão atualizadas e, no próximo acesso, você precisará ler e aceitar a nova versão para continuar usando o sistema.</p>
          </>
        ),
      },
      {
        id: 'secao-14',
        title: '14. Contato',
        content: (
          <>
            <p><strong><a href="mailto:carlos@steera.com.br" className="underline underline-offset-2 hover:text-primary">carlos@steera.com.br</a></strong></p>
          </>
        ),
      },
    ]}
  />
);

export default Privacy;
