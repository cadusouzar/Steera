import { useId } from 'react';
import { Check } from 'lucide-react';
import { Field, Input } from './ui';
import { ROLE_COLOR_SWATCHES, isValidRoleColor } from '../lib/roleFields';

// Cor de identificação do cargo (etapa 8 do polimento, 02/10/2026): bolinhas como rádios de verdade
// (anunciam a cor e se estão marcadas) + o código #RRGGBB validado aqui, antes de o servidor recusar.

interface RoleColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
}

const RoleColorPicker = ({ value, onChange, disabled }: RoleColorPickerProps) => {
  const groupName = useId();
  const codeId = useId();
  const invalid = !isValidRoleColor(value);
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-medium text-foreground">Cor de identificação</p>
      <div role="radiogroup" aria-label="Cor de identificação" className="flex flex-wrap gap-2.5">
        {ROLE_COLOR_SWATCHES.map(({ hex, name }) => {
          const checked = value.toUpperCase() === hex;
          return (
            <label
              key={hex}
              title={name}
              className={`relative h-8 w-8 rounded-full flex items-center justify-center ring-offset-2 ring-offset-panel transition-shadow focus-within:ring-2 focus-within:ring-foreground ${
                disabled ? 'opacity-60' : 'cursor-pointer'
              } ${checked ? 'ring-2 ring-foreground' : ''}`}
              style={{ backgroundColor: hex }}
            >
              <input
                type="radio"
                name={groupName}
                value={hex}
                checked={checked}
                disabled={disabled}
                onChange={() => onChange(hex)}
                aria-label={name}
                className="sr-only"
              />
              {checked && <Check size={15} strokeWidth={2.5} className="text-white" aria-hidden="true" />}
            </label>
          );
        })}
      </div>
      <Field label="Código da cor" htmlFor={codeId} error={invalid ? 'Use o formato #RRGGBB, por exemplo #2563EB' : undefined} className="mt-3 max-w-[180px]">
        <Input
          id={codeId}
          value={value}
          invalid={invalid}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.trim())}
          maxLength={7}
          className="font-mono"
          placeholder="#2563EB"
        />
      </Field>
    </div>
  );
};

export default RoleColorPicker;
