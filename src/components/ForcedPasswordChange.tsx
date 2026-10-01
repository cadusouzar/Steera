import React, { useMemo, useState } from 'react';
import FlowBackground from './FlowBackground';
import { changePassword, useCurrentUser } from '../lib/auth';
import { buildPasswordUserInputs } from '../lib/passwordStrength';
import { usePasswordStrength } from '../hooks/usePasswordStrength';
import PasswordStrengthMeter from './PasswordStrengthMeter';

// Tela mínima, reaproveitando os estilos de Login.tsx, mostrada por
// RequireAuth no lugar do app quando `currentUser.mustChangePassword` é
// true (login criado por um admin via UsersService.create(), ainda com a
// senha temporária gerada pelo sistema). Sem navegação pra fora daqui de
// propósito — só sair trocando a senha ou deslogando.
interface ForcedPasswordChangeProps {
  onDone: () => void;
}

const ForcedPasswordChange = ({ onDone }: ForcedPasswordChangeProps) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const user = useCurrentUser();
  const userInputs = useMemo(
    () => buildPasswordUserInputs([user?.email, user?.name, user?.companyName]),
    [user?.email, user?.name, user?.companyName],
  );
  const { strength, isStrong, isChecking } = usePasswordStrength(newPassword, userInputs);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isStrong) {
      setError(isChecking ? 'Aguarde a verificação da força da senha.' : 'Escolha uma senha mais forte para continuar.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('As senhas novas não coincidem.');
      return;
    }
    setIsSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível trocar a senha.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-background overflow-hidden flex items-center justify-center transition-colors duration-300">
      <FlowBackground />

      <div className="relative z-10 w-full max-w-md px-6 pointer-events-auto">
        <div className="glass-panel p-10 rounded-3xl">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-heading font-bold mb-2 text-foreground">Troque sua senha</h1>
            <p className="text-foreground/60 text-sm">
              Este login foi criado com uma senha temporária. Defina uma senha nova para continuar.
            </p>
          </div>

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 mb-6 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-2">Senha temporária atual</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full bg-background border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                placeholder="••••••••"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-2">Nova senha</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full bg-background border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                placeholder="••••••••"
                autoComplete="new-password"
                minLength={8}
                required
              />
              <PasswordStrengthMeter strength={strength} isChecking={isChecking} />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-2">Confirmar nova senha</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-background border border-border rounded-xl px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                placeholder="••••••••"
                minLength={8}
                required
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium py-3 rounded-xl transition-colors shadow-lg shadow-primary/20 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Salvando...' : 'Salvar nova senha'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ForcedPasswordChange;
