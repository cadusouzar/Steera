import {
  assertValidSchemaName,
  buildTenantSchemaName,
  generateCompanyId,
  slugifyForSchema,
} from './tenant-schema.util';

describe('slugifyForSchema', () => {
  it.each([
    ['Padaria Central', 'padaria_central'],
    ['Açougue do Zé Ltda.', 'acougue_do_ze_ltda'],
    ['  --Loja   & Cia--  ', 'loja_cia'],
    ['CAFÉ 24h', 'cafe_24h'],
    ['!!!', 'empresa'],
    ['', 'empresa'],
    ['PG Soluções', 'emp_pg_solucoes'],
    ['pg_admin', 'emp_pg_admin'],
    ['PG', 'emp_pg'],
    ['P.G', 'p_g'],
  ])('%j → %j', (input, expected) => {
    expect(slugifyForSchema(input)).toBe(expected);
  });

  it('trunca em 40 caracteres sem deixar _ no final', () => {
    const slug = slugifyForSchema('Empresa de Nome Absurdamente Grande Comercio e Servicos Ltda');
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('_')).toBe(false);
    expect(slug.startsWith('empresa_de_nome_absurdamente_grande')).toBe(true);
  });

  it('nunca passa de 44 caracteres mesmo com o prefixo emp_', () => {
    expect(slugifyForSchema('pg ' + 'x'.repeat(100)).length).toBeLessThanOrEqual(44);
  });
});

describe('generateCompanyId', () => {
  it('gera ids no formato do cuid() atual: c + 24 caracteres [a-z0-9]', () => {
    for (let i = 0; i < 200; i++) expect(generateCompanyId()).toMatch(/^c[a-z0-9]{24}$/);
  });

  it('não repete (aleatório de verdade)', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => generateCompanyId()));
    expect(seen.size).toBe(1000);
  });
});

describe('buildTenantSchemaName', () => {
  it('junta o slug com os 8 últimos caracteres do id da empresa', () => {
    expect(buildTenantSchemaName('Padaria Central', 'cm2x9f8j40000abcx7k2m9qa')).toBe('padaria_central_x7k2m9qa');
  });

  it('produz sempre um nome válido', () => {
    expect(() => assertValidSchemaName(buildTenantSchemaName('PG ' + 'y'.repeat(200), generateCompanyId()))).not.toThrow();
  });

  it('protege slug bare "pg" com prefixo emp_', () => {
    expect(buildTenantSchemaName('PG', 'c000000000000000000aaaaaaaa')).toBe('emp_pg_aaaaaaaa');
  });

  it('slug bare "pg" produz nome sempre válido', () => {
    expect(() => assertValidSchemaName(buildTenantSchemaName('PG', generateCompanyId()))).not.toThrow();
  });
});

describe('assertValidSchemaName', () => {
  it.each(['tenant_cm2x9f8j40000abc123defg', 'padaria_central_x7k2m9qa', 'empresa_abcdefgh'])(
    'aceita %s',
    (valid) => expect(() => assertValidSchemaName(valid)).not.toThrow(),
  );

  it.each([
    '',
    'Padaria_x7k2m9qa',
    'padaria-central',
    'padaria central',
    'pg_catalog',
    'pg_x7k2m9qa',
    'a"; DROP SCHEMA public CASCADE; --',
    'a'.repeat(64),
  ])('rejeita %j', (invalid) => {
    expect(() => assertValidSchemaName(invalid)).toThrow();
  });
});
