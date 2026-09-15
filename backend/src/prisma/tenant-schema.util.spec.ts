import { assertValidSchemaName, tenantSchemaName } from './tenant-schema.util';

describe('tenantSchemaName', () => {
  it('deriva o nome do schema como tenant_<companyId>', () => {
    expect(tenantSchemaName('cm2x9f8j40000abc123defg')).toBe('tenant_cm2x9f8j40000abc123defg');
  });
});

describe('assertValidSchemaName', () => {
  it('não lança para um nome de schema válido', () => {
    expect(() => assertValidSchemaName('tenant_cm2x9f8j40000abc123defg')).not.toThrow();
  });

  it.each([
    'tenant_',
    'tenant_ABC123',
    'tenant_abc-123',
    'tenant_abc 123',
    'tenant_abc"; DROP SCHEMA public CASCADE; --',
    'outraCoisa_abc123',
    '',
  ])('lança para um nome de schema inválido: %s', (invalid) => {
    expect(() => assertValidSchemaName(invalid)).toThrow();
  });
});
