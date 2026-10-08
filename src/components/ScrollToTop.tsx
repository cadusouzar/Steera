import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

// Leva a página ao topo a cada troca de rota (ex.: clicar em Termos no rodapé abria a página nova
// já lá embaixo). Fica de fora: link com seção (#modulos — a LandingPage rola até ela) e voltar/
// avançar do navegador (POP), que deve manter a posição em que a pessoa estava.
const ScrollToTop = () => {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if (hash || navigationType === 'POP') return;
    window.scrollTo(0, 0);
    // Só a troca de caminho conta; mudar só o hash (índice da página) não volta ao topo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return null;
};

export default ScrollToTop;
