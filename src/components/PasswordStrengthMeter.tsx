import React from 'react';
import { MIN_PASSWORD_SCORE, PasswordStrength } from '../lib/passwordStrength';

interface PasswordStrengthMeterProps {
  strength: PasswordStrength | null;
  isChecking: boolean;
}

// Nota do zxcvbn (0-4) → rótulo + cor. Só "Forte" (>= MIN_PASSWORD_SCORE) libera o envio.
const LEVELS = [
  { label: 'Muito fraca', bar: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
  { label: 'Fraca', bar: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
  { label: 'Média', bar: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
  { label: 'Forte', bar: 'bg-green-500', text: 'text-green-600 dark:text-green-400' },
  { label: 'Muito forte', bar: 'bg-green-500', text: 'text-green-600 dark:text-green-400' },
] as const;

const PasswordStrengthMeter: React.FC<PasswordStrengthMeterProps> = ({ strength, isChecking }) => {
  if (!strength && !isChecking) {
    return <p className="text-xs text-muted mt-1.5">Use uma senha forte: frases longas e palavras pouco comuns funcionam bem.</p>;
  }
  const level = strength ? LEVELS[strength.score] : null;
  // 4 segmentos: nota 0 pinta 1 (pra "Muito fraca" ainda aparecer), nota 4 pinta todos.
  const filled = strength ? Math.max(1, strength.score) : 0;

  return (
    <div className="mt-2" aria-live="polite">
      <div className="flex gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${level && i <= filled ? level.bar : 'bg-border'}`} />
        ))}
      </div>
      {level ? (
        <p className="text-xs mt-1.5">
          <span className={`font-bold ${level.text}`}>Senha {level.label.toLowerCase()}</span>
          {strength && strength.score < MIN_PASSWORD_SCORE && (
            <span className="text-muted"> — {strength.hint ?? 'use uma senha mais longa e menos previsível.'}</span>
          )}
        </p>
      ) : (
        <p className="text-xs text-muted mt-1.5">Verificando a força da senha…</p>
      )}
    </div>
  );
};

export default PasswordStrengthMeter;
