import { Link } from 'react-router-dom';
import LegalPage from '../../components/legal/LegalPage';
import { LEGAL_VERSIONS, formatLegalDate } from '../../lib/legal';

// Texto literal de docs/superpowers/specs/2026-10-07-lgpd-termos.md (gerado a partir dele).
const Terms = () => (
  <LegalPage
    title="Termos de uso — Steera"
    version={LEGAL_VERSIONS.TERMS.version}
    effectiveDate={formatLegalDate(LEGAL_VERSIONS.TERMS.effectiveDate)}
    intro={
      <>
        <p>Estes termos regem o uso do Steera, sistema de gestão de pessoas, ponto e clientes (contato: <strong><a href="mailto:carlos@steera.com.br" className="underline underline-offset-2 hover:text-primary">carlos@steera.com.br</a></strong>). Ao criar uma conta, aceitar um convite ou usar o sistema, você concorda com estes termos e com a <Link to="/privacidade" className="underline underline-offset-2 hover:text-primary">Política de Privacidade</Link>.</p>
      </>
    }
    sections={[
      {
        id: 'secao-1',
        title: '1. O que é o Steera',
        content: (
          <>
            <p>O Steera reúne, num só lugar, o cadastro de funcionários e cargos, férias e afastamentos, pagamentos, controle de ponto com aprovação de ajustes e justificativas, cadastro de clientes, lançamentos e assinaturas. O serviço está em <strong>fase inicial</strong>: recursos podem ser acrescentados, alterados ou retirados, e avisaremos com antecedência quando uma mudança afetar o que você já usa.</p>
          </>
        ),
      },
      {
        id: 'secao-2',
        title: '2. Conta e acesso',
        content: (
          <>
            <ul className="list-disc pl-5 space-y-1.5"><li>Quem cria a conta o faz em nome de uma empresa (pessoa jurídica ou física) e declara ter poderes para isso.</li><li>Os dados informados no cadastro devem ser verdadeiros e mantidos atualizados.</li><li>A empresa é responsável pelos logins que criar: quem recebe acesso, com qual perfil de permissões, e por bloquear quem não deve mais acessar.</li><li>Cada pessoa deve guardar a própria senha e não compartilhá-la. Avise-nos em <strong><a href="mailto:carlos@steera.com.br" className="underline underline-offset-2 hover:text-primary">carlos@steera.com.br</a></strong> se suspeitar de uso indevido.</li><li>O Steera é destinado a maiores de 18 anos.</li></ul>
          </>
        ),
      },
      {
        id: 'secao-3',
        title: '3. Planos e preços',
        content: (
          <>
            <ul className="list-disc pl-5 space-y-1.5"><li>O plano <strong>Grátis</strong> não tem custo e tem os limites indicados na página de planos.</li><li>Os planos pagos ainda não podem ser contratados pelo sistema. Quando puderem, os preços, a forma de pagamento e as condições serão informados antes da contratação, e nenhum valor será cobrado sem o seu aceite.</li><li>Os limites e recursos de cada plano podem mudar; mudanças que reduzam o que você já usa serão avisadas com antecedência.</li></ul>
          </>
        ),
      },
      {
        id: 'secao-4',
        title: '4. Uso permitido',
        content: (
          <>
            <p>Você concorda em não:</p>
            <ul className="list-disc pl-5 space-y-1.5"><li>usar o Steera para fins ilegais ou para tratar dados pessoais sem base legal;</li><li>tentar acessar dados de outras empresas, burlar permissões, testar vulnerabilidades sem autorização ou sobrecarregar o sistema;</li><li>copiar, revender ou explorar comercialmente o sistema sem autorização;</li><li>inserir conteúdo que viole direitos de terceiros.</li></ul>
            <p>O descumprimento pode levar à suspensão ou ao encerramento da conta.</p>
          </>
        ),
      },
      {
        id: 'secao-5',
        title: '5. Dados que a empresa coloca no Steera',
        content: (
          <>
            <ul className="list-disc pl-5 space-y-1.5"><li>Os dados de funcionários, clientes e demais pessoas que a empresa cadastra pertencem à empresa, que é a <strong>controladora</strong> desses dados nos termos da LGPD. O Steera atua como <strong>operador</strong>: guarda e processa esses dados apenas para prestar o serviço e conforme as instruções da empresa.</li><li>A empresa garante que tem base legal para tratar esses dados — inclusive <strong>dados sensíveis</strong>, como atestados médicos — e que informa as pessoas envolvidas (por exemplo, seus funcionários) sobre esse tratamento, inclusive sobre localização e foto no registro de ponto, quando exigidas.</li><li>O Steera não usa esses dados para nenhuma outra finalidade, não os vende e só os compartilha com os fornecedores necessários para o serviço funcionar, listados na Política de Privacidade.</li><li>Se ocorrer um incidente de segurança envolvendo esses dados, a empresa será avisada sem demora.</li><li>Pedidos de titulares (funcionários, clientes) feitos diretamente ao Steera serão encaminhados à empresa.</li><li>Ao encerrar a conta da empresa, esses dados serão apagados em até 30 dias. A empresa é responsável por guardar antes, pelo prazo exigido pela legislação (por exemplo, a trabalhista), os registros de que precisar.</li></ul>
          </>
        ),
      },
      {
        id: 'secao-6',
        title: '6. Disponibilidade e suporte',
        content: (
          <>
            <ul className="list-disc pl-5 space-y-1.5"><li>Buscamos manter o Steera disponível e funcionando bem, mas, por estar em fase inicial, <strong>não garantimos funcionamento ininterrupto ou livre de erros</strong>, nem cópias de segurança dos dados nesta fase.</li><li>Pode haver interrupções para manutenção ou por falhas de fornecedores.</li><li>O suporte é feito por e-mail, em <strong><a href="mailto:carlos@steera.com.br" className="underline underline-offset-2 hover:text-primary">carlos@steera.com.br</a></strong>.</li></ul>
          </>
        ),
      },
      {
        id: 'secao-7',
        title: '7. Propriedade intelectual',
        content: (
          <>
            <p>O sistema, a marca Steera, o mascote Stee e o conteúdo do site pertencem ao operador. O uso do Steera não transfere nenhum desses direitos. Os dados que a empresa coloca no sistema continuam sendo dela.</p>
          </>
        ),
      },
      {
        id: 'secao-8',
        title: '8. Limitação de responsabilidade',
        content: (
          <>
            <ul className="list-disc pl-5 space-y-1.5"><li>O Steera é uma ferramenta de apoio à gestão. As decisões tomadas com base nele — sobre pagamentos, ponto, férias, cobranças e obrigações legais — são de responsabilidade da empresa.</li><li>Na extensão permitida pela lei, o operador não responde por lucros cessantes, perda de receita ou danos indiretos decorrentes do uso ou da indisponibilidade do serviço.</li><li>Nada nestes termos afasta direitos que a lei garanta e que não possam ser renunciados.</li></ul>
          </>
        ),
      },
      {
        id: 'secao-9',
        title: '9. Encerramento e exclusão de logins',
        content: (
          <>
            <ul className="list-disc pl-5 space-y-1.5"><li><strong>Conta da empresa:</strong> quem administra a empresa pode pedir o encerramento da conta a qualquer momento por <strong><a href="mailto:carlos@steera.com.br" className="underline underline-offset-2 hover:text-primary">carlos@steera.com.br</a></strong>. Todos os logins perdem o acesso e todos os dados da empresa são apagados conforme a seção 5 e a Política de Privacidade.</li><li><strong>Logins:</strong> um login pertence à empresa. Quem administra a empresa pode excluir logins em Usuários e Acessos; quem quiser excluir o próprio login deve pedir a um administrador. A exclusão de um login não apaga o que a empresa guarda sobre a pessoa (como a ficha de funcionário e o ponto). A empresa nunca pode ficar sem alguém que a administre: se a única pessoa administradora quiser sair, deve antes passar a administração a outra pessoa ou pedir o encerramento da conta da empresa.</li><li>O operador pode suspender ou encerrar contas que descumpram estes termos ou a lei, avisando sempre que possível.</li></ul>
          </>
        ),
      },
      {
        id: 'secao-10',
        title: '10. Mudanças nestes termos',
        content: (
          <>
            <p>Quando estes termos mudarem de forma relevante, a versão e a data no topo serão atualizadas e, no próximo acesso, será preciso ler e aceitar a nova versão para continuar usando o sistema.</p>
          </>
        ),
      },
      {
        id: 'secao-11',
        title: '11. Lei aplicável e foro',
        content: (
          <>
            <p>Estes termos seguem as leis do Brasil. O consumidor pode propor ação no foro do seu domicílio, quando aplicável.</p>
          </>
        ),
      },
      {
        id: 'secao-12',
        title: '12. Contato',
        content: (
          <>
            <p><strong><a href="mailto:carlos@steera.com.br" className="underline underline-offset-2 hover:text-primary">carlos@steera.com.br</a></strong></p>
          </>
        ),
      },
    ]}
  />
);

export default Terms;
