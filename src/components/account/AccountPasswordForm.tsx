import React, { useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Shield } from 'lucide-react';
import { changePassword, useCurrentUser } from '../../lib/auth';
import { buildPasswordUserInputs } from '../../lib/passwordStrength';
import { usePasswordStrength } from '../../hooks/usePasswordStrength';
import PasswordStrengthMeter from '../PasswordStrengthMeter';
import FormField from '../FormField';
import { inputBorderClass } from '../../lib/validation';

// Troca de senha real (PATCH /auth/me/password via changePassword() em lib/auth.ts) — compartilhada
// entre a aba Segurança do "Meu Perfil" do ERP (UserProfileDrawer) e a de "Minha conta" do site.
const AccountPasswordForm: React.FC = () => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const user = useCurrentUser();
  const userInputs = useMemo(
    () => buildPasswordUserInputs([user?.email, user?.name, user?.companyName]),
    [user?.email, user?.name, user?.companyName],
  );
  const { strength, isStrong, isChecking } = usePasswordStrength(newPassword, userInputs);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setConfirmError('');
    if (newPassword.length < 8) {
      setPasswordError('A nova senha precisa ter pelo menos 8 caracteres.');
      return;
    }
    if (!isStrong) {
      setPasswordError(isChecking ? 'Aguarde a verificação da força da senha.' : 'Escolha uma senha mais forte para continuar.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setConfirmError('As senhas não coincidem.');
      return;
    }
    setIsSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Não foi possível trocar a senha');
    } finally {
      setIsSaving(false);
    }
  };

  const inputClass =
    'w-full bg-background border border-border/80 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow';

  return (
    <div className="bg-secondary/20 border border-border/60 p-6 rounded-2xl">
      <h3 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
        <Shield size={20} className="text-primary" aria-hidden="true" /> Alterar Senha
      </h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        {passwordError && (
          <p className="text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5">
            {passwordError}
          </p>
        )}
        <FormField label="Senha Atual" htmlFor="current-password">
          <input
            id="current-password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            required
            className={inputClass}
          />
        </FormField>
        <FormField label="Nova Senha" htmlFor="new-password">
          <input
            id="new-password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            required
            className={inputClass}
          />
          <PasswordStrengthMeter strength={strength} isChecking={isChecking} />
        </FormField>
        <FormField label="Confirmar Nova Senha" htmlFor="confirm-password" error={confirmError}>
          <input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            required
            className={`w-full bg-background border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 transition-shadow ${inputBorderClass(!!confirmError)}`}
          />
        </FormField>
        <div className="pt-2 flex items-center justify-end gap-3">
          {saved && (
            <span className="text-green-500 text-sm font-bold flex items-center gap-1">
              <CheckCircle2 size={16} aria-hidden="true" /> Senha atualizada!
            </span>
          )}
          <button
            type="submit"
            disabled={isSaving}
            className="px-5 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed text-primary-foreground rounded-xl text-sm font-bold transition-colors shadow-lg shadow-primary/20 flex items-center gap-2"
          >
            {isSaving && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
            Atualizar Senha
          </button>
        </div>
      </form>
    </div>
  );
};

export default AccountPasswordForm;
