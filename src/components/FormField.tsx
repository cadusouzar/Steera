import React from 'react';

interface FormFieldProps {
  label: string;
  error?: string;
  required?: boolean;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}

// Wrapper fino (rótulo + o input/textarea do chamador + mensagem de erro embaixo, em vermelho) —
// não existia NENHUM indicador visual por campo no projeto antes disso (só um banner único no topo
// do formulário inteiro). Reaproveita a mesma paleta de vermelho (`red-500`/`red-600`) já usada
// nesses banners, já que não existe uma cor "erro" dedicada no tailwind.config.js.
const FormField: React.FC<FormFieldProps> = ({ label, error, required, hint, htmlFor, children }) => (
  <div>
    <label htmlFor={htmlFor} className="block text-xs font-bold text-foreground/80 mb-1.5 uppercase tracking-wider">
      {label}{required && <span className="text-red-500"> *</span>}
    </label>
    {children}
    {error ? (
      <p className="text-xs text-red-600 dark:text-red-400 mt-1.5">{error}</p>
    ) : hint ? (
      <p className="text-xs text-muted mt-1.5">{hint}</p>
    ) : null}
  </div>
);

export default FormField;
