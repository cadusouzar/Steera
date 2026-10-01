import { useId, type ReactNode } from 'react';

// Interruptor liga/desliga do kit (role="switch"). `label` e `description` ficam ao lado, clicáveis.
interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

const Switch = ({ checked, onChange, label, description, disabled }: SwitchProps) => {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-[14px] font-medium text-foreground">{label}</span>
        {description && <span className="mt-0.5 block text-[13px] text-muted">{description}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 ${
          checked ? 'bg-primary' : 'bg-foreground/20'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-panel shadow-sm transition-transform duration-200 ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'}`}
          aria-hidden="true"
        />
      </button>
    </div>
  );
};

export default Switch;
