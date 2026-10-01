import { useEffect, useState } from 'react';
import { checkPasswordStrength, MIN_PASSWORD_SCORE, PasswordStrength } from '../lib/passwordStrength';

// Força da senha recalculada enquanto a pessoa digita (com um pequeno atraso — o zxcvbn leva até
// algumas centenas de ms numa senha longa). `strength` é null com o campo vazio ou enquanto a
// primeira checagem não terminou; `isStrong` só é true com uma nota já calculada para o valor ATUAL.
export function usePasswordStrength(password: string, userInputs: string[]) {
  const [result, setResult] = useState<{ password: string; strength: PasswordStrength } | null>(null);
  const inputsKey = userInputs.join('\u0000');

  useEffect(() => {
    if (!password) {
      setResult(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      checkPasswordStrength(password, inputsKey ? inputsKey.split('\u0000') : [])
        .then((strength) => {
          if (!cancelled) setResult({ password, strength });
        })
        .catch(() => {
          // Falha ao carregar o medidor (rede): não trava o formulário — o backend confere de novo.
          if (!cancelled) setResult({ password, strength: { score: 4, hint: null } });
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [password, inputsKey]);

  const strength = result && result.password === password ? result.strength : null;
  return {
    strength,
    isStrong: strength !== null && strength.score >= MIN_PASSWORD_SCORE,
    isChecking: password.length > 0 && strength === null,
  };
}
