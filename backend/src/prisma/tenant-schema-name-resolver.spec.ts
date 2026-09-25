import { TenantSchemaNameResolver } from './tenant-schema-name-resolver';

describe('TenantSchemaNameResolver', () => {
  it('consulta uma vez e depois responde do cache', async () => {
    const lookup = jest.fn().mockResolvedValue('padaria_central_x7k2m9qa');
    const resolver = new TenantSchemaNameResolver(lookup);
    expect(await resolver.resolve('c1')).toBe('padaria_central_x7k2m9qa');
    expect(await resolver.resolve('c1')).toBe('padaria_central_x7k2m9qa');
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('deduplica misses concorrentes da mesma empresa', async () => {
    let release!: (v: string) => void;
    const lookup = jest.fn(() => new Promise<string>((r) => { release = r; }));
    const resolver = new TenantSchemaNameResolver(lookup);
    const a = resolver.resolve('c1');
    const b = resolver.resolve('c1');
    release('tenant_cm2x9f8j40000abc123defg');
    expect(await a).toBe('tenant_cm2x9f8j40000abc123defg');
    expect(await b).toBe('tenant_cm2x9f8j40000abc123defg');
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('lança (sem fallback) quando a empresa não existe, e não cacheia a falha', async () => {
    const lookup = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('empresa_abcdefgh');
    const resolver = new TenantSchemaNameResolver(lookup);
    await expect(resolver.resolve('c1')).rejects.toThrow(/c1/);
    expect(await resolver.resolve('c1')).toBe('empresa_abcdefgh');
  });

  it('rejeita um nome inválido vindo do banco', async () => {
    const resolver = new TenantSchemaNameResolver(async () => 'x"; DROP SCHEMA public; --');
    await expect(resolver.resolve('c1')).rejects.toThrow(/inválido/);
  });
});
