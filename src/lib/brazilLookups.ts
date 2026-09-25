// Consultas públicas feitas DIRETO do navegador (nunca pelo nosso backend — não vira proxy aberto).
// São só atalho de preenchimento: qualquer falha/timeout devolve null e o usuário preenche à mão;
// o backend valida tudo de novo. Se um dia o frontend tiver CSP, liberar connect-src pra
// brasilapi.com.br e viacep.com.br.

export interface AddressLookupResult {
  zipCode: string;
  street: string;
  district: string;
  city: string;
  state: string;
}

export interface CnpjLookupResult {
  legalName: string;
  tradeName: string;
  phone: string;
  // Texto da Receita (ex.: "ATIVA", "BAIXADA") — só pra aviso, nunca bloqueia.
  registrationStatus: string;
  address: AddressLookupResult & { number: string; complement: string };
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function fetchAddressByCep(cep: string): Promise<AddressLookupResult | null> {
  const digits = cep.replace(/\D/g, '');
  if (digits.length !== 8) return null;
  const data = (await fetchJsonWithTimeout(`https://viacep.com.br/ws/${digits}/json/`, 3000)) as Record<string, unknown> | null;
  if (!data || data.erro) return null;
  return { zipCode: digits, street: str(data.logradouro), district: str(data.bairro), city: str(data.localidade), state: str(data.uf) };
}

export async function fetchCnpjData(cnpj: string): Promise<CnpjLookupResult | null> {
  const value = cnpj.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  if (value.length !== 14) return null;
  const data = (await fetchJsonWithTimeout(`https://brasilapi.com.br/api/cnpj/v1/${value}`, 5000)) as Record<string, unknown> | null;
  if (!data || !str(data.razao_social)) return null;
  const streetType = str(data.descricao_tipo_de_logradouro);
  const street = str(data.logradouro);
  return {
    legalName: str(data.razao_social),
    tradeName: str(data.nome_fantasia),
    phone: str(data.ddd_telefone_1).replace(/\D/g, ''),
    registrationStatus: str(data.descricao_situacao_cadastral).toUpperCase(),
    address: {
      zipCode: str(data.cep).replace(/\D/g, ''),
      street: streetType && !street.toUpperCase().startsWith(streetType.toUpperCase()) ? `${streetType} ${street}` : street,
      number: str(data.numero),
      complement: str(data.complemento),
      district: str(data.bairro),
      city: str(data.municipio),
      state: str(data.uf),
    },
  };
}
