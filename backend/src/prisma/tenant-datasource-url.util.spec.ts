import { buildTenantDatasourceUrl } from './tenant-datasource-url.util';

describe('buildTenantDatasourceUrl', () => {
  it('substitui o parâmetro schema pelo schema do tenant', () => {
    const result = buildTenantDatasourceUrl(
      'postgresql://user:pass@localhost:5432/quickflow?schema=public',
      'tenant_companyabc123456789012345',
      2,
    );
    const url = new URL(result);
    expect(url.searchParams.get('schema')).toBe('tenant_companyabc123456789012345');
  });

  it('adiciona pgbouncer=true e connection_limit, preservando usuário/senha/host/porta/banco', () => {
    const result = buildTenantDatasourceUrl(
      'postgresql://user:pass@localhost:5432/quickflow?schema=public',
      'tenant_companyabc123456789012345',
      2,
    );
    const url = new URL(result);
    expect(url.username).toBe('user');
    expect(url.password).toBe('pass');
    expect(url.hostname).toBe('localhost');
    expect(url.port).toBe('5432');
    expect(url.pathname).toBe('/quickflow');
    expect(url.searchParams.get('pgbouncer')).toBe('true');
    expect(url.searchParams.get('connection_limit')).toBe('2');
  });

  it('funciona mesmo se a URL base não tiver nenhum parâmetro de query', () => {
    const result = buildTenantDatasourceUrl(
      'postgresql://user:pass@localhost:5432/quickflow',
      'tenant_companyabc123456789012345',
      3,
    );
    const url = new URL(result);
    expect(url.searchParams.get('schema')).toBe('tenant_companyabc123456789012345');
    expect(url.searchParams.get('connection_limit')).toBe('3');
  });
});
