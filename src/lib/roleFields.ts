import { NAME_MAX_LENGTH, TEXT_MAX_LENGTH } from './validation';

// Regras compartilhadas entre o cadastro (RoleForm) e a ficha (Roles) de cargos — etapa 8 do
// polimento, 02/10/2026. O backend continua sendo a fronteira de verdade.

export const ROLE_COLOR_SWATCHES: Array<{ hex: string; name: string }> = [
  { hex: '#3B82F6', name: 'Azul' },
  { hex: '#A855F7', name: 'Roxo' },
  { hex: '#EC4899', name: 'Rosa' },
  { hex: '#EF4444', name: 'Vermelho' },
  { hex: '#F97316', name: 'Laranja' },
  { hex: '#EAB308', name: 'Amarelo' },
  { hex: '#22C55E', name: 'Verde' },
  { hex: '#14B8A6', name: 'Verde-água' },
  { hex: '#2563EB', name: 'Azul escuro' },
];

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
export const isValidRoleColor = (hex: string) => HEX_COLOR.test(hex);

export type RoleFieldErrors = { name?: string; department?: string; description?: string };

export function validateRoleFields(f: { name: string; department: string; description: string }): RoleFieldErrors {
  const errors: RoleFieldErrors = {};
  if (!f.name.trim()) errors.name = 'Informe o nome do cargo';
  else if (f.name.length > NAME_MAX_LENGTH) errors.name = `Nome deve ter no máximo ${NAME_MAX_LENGTH} caracteres`;
  if (!f.department.trim()) errors.department = 'Informe o departamento';
  else if (f.department.length > NAME_MAX_LENGTH) errors.department = `Departamento deve ter no máximo ${NAME_MAX_LENGTH} caracteres`;
  if (f.description.length > TEXT_MAX_LENGTH) errors.description = `Descrição deve ter no máximo ${TEXT_MAX_LENGTH} caracteres`;
  return errors;
}
