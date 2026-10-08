import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto';

// Campos obrigatórios só com espaços precisam falhar AQUI, no DTO: o service faz trim depois da
// validação, então "   " passava pelo @MinLength(1) e virava '' (ou null, no caso da fantasia) no
// banco — driblando "fantasia obrigatória para PJ", gerando Company.name vazio etc.
describe('RegisterDto', () => {
  const base = {
    personType: 'PJ',
    document: '11.222.333/0001-81',
    legalName: 'Padaria Central Comércio de Alimentos Ltda',
    tradeName: 'Padaria Central',
    phone: '(11) 98765-4321',
    zipCode: '01310-100',
    street: 'Avenida Paulista',
    number: '1000',
    district: 'Bela Vista',
    city: 'São Paulo',
    state: 'SP',
    name: 'Carlos Eduardo',
    email: 'a@b.com',
    password: 'senha12345678',
    acceptLegal: true,
  };

  const errorsFor = async (overrides: Record<string, unknown>) =>
    validate(plainToInstance(RegisterDto, { ...base, ...overrides }));

  it('aceita o cadastro válido e remove espaços das pontas', async () => {
    const dto = plainToInstance(RegisterDto, { ...base, legalName: '  Padaria Ltda  ', city: ' São Paulo ' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.legalName).toBe('Padaria Ltda');
    expect(dto.city).toBe('São Paulo');
  });

  it('PJ com nome fantasia só com espaços é recusado', async () => {
    const errors = await errorsFor({ tradeName: '   ' });
    expect(errors.some((e) => e.property === 'tradeName')).toBe(true);
  });

  it('razão social só com espaços é recusada', async () => {
    const errors = await errorsFor({ legalName: '  ' });
    expect(errors.some((e) => e.property === 'legalName')).toBe(true);
  });

  it.each(['street', 'number', 'district', 'city', 'name'])('%s só com espaços é recusado', async (field) => {
    const errors = await errorsFor({ [field]: '   ' });
    expect(errors.some((e) => e.property === field)).toBe(true);
  });

  it('PF com nome fantasia só com espaços é válido (fantasia é opcional para PF)', async () => {
    const dto = plainToInstance(RegisterDto, {
      ...base, personType: 'PF', document: '529.982.247-25', legalName: 'Ana Souza', tradeName: '  ',
    });
    expect(await validate(dto)).toHaveLength(0);
  });
});
