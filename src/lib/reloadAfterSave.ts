// Recarregar a lista depois de uma ação que JÁ deu certo (e já mostrou a notificação de sucesso):
// se só a recarga falhar, a tela não pode dizer "não foi possível salvar" — salvou. Mostra este
// aviso no mecanismo de erro da própria tela (06/10/2026).
export const RELOAD_AFTER_SAVE_FAILED = 'Alteração salva, mas não foi possível atualizar a lista. Recarregue a página.';

export async function reloadAfterSave(load: () => Promise<unknown>, onError: (message: string) => void): Promise<void> {
  try {
    await load();
  } catch {
    onError(RELOAD_AFTER_SAVE_FAILED);
  }
}
