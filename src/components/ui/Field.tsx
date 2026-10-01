import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { controlClass } from './fieldStyles';

// Campo de formulário do kit (01/10/2026): rótulo + controle + mensagem de erro/dica. Mesma API do
// antigo FormField (que agora só reexporta este) — `label`, `error`, `hint`, `required`, `htmlFor`.

interface FieldProps {
  label: string;
  error?: string;
  required?: boolean;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}

export const Field = ({ label, error, required, hint, htmlFor, children, className = '' }: FieldProps) => (
  <div className={className}>
    <label htmlFor={htmlFor} className="block text-[13px] font-medium text-foreground mb-1.5">
      {label}
      {required && <span className="text-danger" aria-hidden="true"> *</span>}
    </label>
    {children}
    {error ? (
      <p className="text-[12px] text-danger mt-1.5" role="alert">{error}</p>
    ) : hint ? (
      <p className="text-[12px] text-muted mt-1.5">{hint}</p>
    ) : null}
  </div>
);

type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ invalid, className = '', ...rest }, ref) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={controlClass(invalid, `h-10 ${className}`)} {...rest} />;
});

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean };

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ invalid, className = '', children, ...rest }, ref) {
  return (
    <div className="relative">
      <select ref={ref} aria-invalid={invalid || undefined} className={controlClass(invalid, `h-10 appearance-none pr-9 ${className}`)} {...rest}>
        {children}
      </select>
      <ChevronDown size={16} strokeWidth={1.8} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
    </div>
  );
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ invalid, className = '', rows = 4, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} aria-invalid={invalid || undefined} className={controlClass(invalid, `py-2.5 resize-y ${className}`)} {...rest} />;
});
