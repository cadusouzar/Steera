import { ValidationError } from 'class-validator';

// Um único lugar entende os ~15 nomes de validador que este projeto usa hoje (auditados em
// backend/src/**/*.dto.ts) e devolve sempre uma frase em português — nunca mais um array cru de
// mensagens padrão do class-validator, sempre em inglês, que era o que o usuário via antes.
const FIELD_LABEL_OVERRIDES: Record<string, string> = {
  cpf: 'CPF',
  email: 'E-mail',
  password: 'Senha',
  currentPassword: 'Senha atual',
  newPassword: 'Nova senha',
  name: 'Nome',
  description: 'Descrição',
  reason: 'Motivo',
  notes: 'Observações',
  address: 'Endereço',
  contact: 'Contato',
  category: 'Categoria',
  department: 'Departamento',
  phone: 'Telefone',
  companyName: 'Nome da empresa',
  fullName: 'Nome completo',
  displayName: 'Nome de exibição',
  colorHex: 'Cor',
  roleId: 'Cargo',
  employeeId: 'Funcionário',
  managerId: 'Superior',
  admissionDate: 'Data de admissão',
  baseValue: 'Salário',
  paymentDueDay: 'Dia de vencimento do pagamento',
  bankDetails: 'Dados bancários',
  salaryRecurrenceEnabled: 'Recorrência de salário',
  daysCount: 'Quantidade de dias',
  dueDate: 'Data de vencimento',
  dueDay: 'Dia de vencimento',
  occurredAt: 'Data da ocorrência',
  radiusMeters: 'Raio (metros)',
  weekDays: 'Dias da semana',
  expectedStartTime: 'Horário de início esperado',
  expectedEndTime: 'Horário de fim esperado',
  dailyMinutes: 'Minutos diários',
  weeklyMinutes: 'Minutos semanais',
  breakMinutes: 'Minutos de intervalo',
  toleranceMinutes: 'Minutos de tolerância',
  maxOvertimeMinutesPerDay: 'Minutos máximos de hora extra por dia',
  validFrom: 'Válido a partir de',
  validTo: 'Válido até',
  reviewNote: 'Observação da análise',
  startDate: 'Data de início',
  endDate: 'Data de fim',
  exceptionAuthorized: 'Exceção autorizada',
  defaultValue: 'Valor padrão',
  displayOrder: 'Ordem de exibição',
};

function labelFor(property: string): string {
  const override = FIELD_LABEL_OVERRIDES[property];
  if (override) return override;
  const spaced = property.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Cada um destes NÃO depende de valor nenhum embutido na mensagem original — o nome da chave em
// `error.constraints` já identifica o validador de forma inequívoca.
const STATIC_TRANSLATIONS: Record<string, (field: string) => string> = {
  isNotEmpty: (f) => `${f} é obrigatório`,
  arrayNotEmpty: (f) => `${f} não pode ser uma lista vazia`,
  isString: (f) => `${f} deve ser um texto`,
  isEmail: (f) => `${f} deve ser um e-mail válido`,
  isInt: (f) => `${f} deve ser um número inteiro`,
  isNumber: (f) => `${f} deve ser um número`,
  isBoolean: (f) => `${f} deve ser verdadeiro ou falso`,
  isDateString: (f) => `${f} deve ser uma data válida`,
  isArray: (f) => `${f} deve ser uma lista`,
  arrayUnique: (f) => `${f} não pode ter itens repetidos`,
  isLatitude: (f) => `${f} deve ser uma latitude válida`,
  isLongitude: (f) => `${f} deve ser uma longitude válida`,
  isPositive: (f) => `${f} deve ser um número positivo`,
  isEnum: (f) => `${f} tem um valor inválido`,
};

// Estes precisam do número/limite embutido na mensagem padrão em inglês (o class-validator não
// expõe o argumento original do decorator separadamente em `ValidationError`, só a mensagem já
// renderizada) — o formato dessas mensagens é estável e público (parte da API do pacote).
const DYNAMIC_TRANSLATIONS: Record<string, (field: string, rawMessage: string) => string | undefined> = {
  minLength: (f, msg) => {
    const m = msg.match(/longer than or equal to (\d+) characters/);
    return m ? `${f} deve ter pelo menos ${m[1]} caracteres` : undefined;
  },
  maxLength: (f, msg) => {
    const m = msg.match(/shorter than or equal to (\d+) characters/);
    return m ? `${f} deve ter no máximo ${m[1]} caracteres` : undefined;
  },
  min: (f, msg) => {
    const m = msg.match(/must not be less than (-?[\d.]+)/);
    return m ? `${f} deve ser maior ou igual a ${m[1]}` : undefined;
  },
  max: (f, msg) => {
    const m = msg.match(/must not be greater than (-?[\d.]+)/);
    return m ? `${f} deve ser menor ou igual a ${m[1]}` : undefined;
  },
};

function translateConstraint(key: string, field: string, rawMessage: string): string {
  const staticFn = STATIC_TRANSLATIONS[key];
  if (staticFn) return staticFn(field);
  const dynamic = DYNAMIC_TRANSLATIONS[key]?.(field, rawMessage);
  // Mensagem desconhecida (ou já customizada em português, ex.: HEX_COLOR_REGEX) passa
  // inalterada — nunca quebra algo que já está certo.
  return dynamic ?? rawMessage;
}

function translateOne(error: ValidationError): string[] {
  const field = labelFor(error.property);
  const own = Object.entries(error.constraints ?? {}).map(([key, msg]) => translateConstraint(key, field, msg));
  const nested = (error.children ?? []).flatMap(translateOne);
  return [...own, ...nested];
}

export function translateValidationErrors(errors: ValidationError[]): string {
  const messages = errors.flatMap(translateOne);
  return messages.length > 0 ? messages.join('; ') : 'Dados inválidos';
}
