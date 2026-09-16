// Nota: esta classe NÃO importa `buildTenantDatasourceUrl` diretamente — quem constrói a URL de
// cada client de tenant é a função `createClient` injetada via `TenantPrismaClientRegistryOptions`
// (a implementação real fica em `prisma.module.ts`, Task 3). Essa separação é deliberada: o
// registry só sabe cachear/expulsar/coordenar concorrência, nunca como construir um client de
// verdade — mais fácil de testar isoladamente (Step 1 abaixo nunca precisa de uma URL real).
import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { assertValidSchemaName, tenantSchemaName } from './tenant-schema.util';

interface TenantClientEntry {
  client: PrismaClient;
  // Ordem lógica de uso (contador monotônico), não `Date.now()`: timestamps de relógio de parede
  // têm resolução de 1ms, e chamadas sequenciais em teste (ou sob carga real) rotineiramente caem
  // no mesmo milissegundo — um empate faria a expulsão LRU escolher a entrada errada (a primeira
  // encontrada na ordem de iteração do Map, não a de fato menos recentemente usada). Um contador
  // incrementado a cada uso garante ordem estrita sempre, sem depender da resolução do relógio.
  lastUsedSeq: number;
  inFlightOperations: number;
  pendingEviction: boolean;
}

export interface TenantPrismaClientRegistryOptions {
  maxSize: number;
  evictionTimeoutMs: number;
  // Injetável pra testes (Task 2 nunca cria um PrismaClient de verdade) — em produção, a Task 3
  // passa uma factory que constrói um PrismaClient real com a extensão de RLS aplicada.
  createClient: (companyId: string, schemaName: string) => Promise<{ $disconnect(): Promise<void> }>;
}

/**
 * Cache LRU de instâncias de PrismaClient — uma por empresa ATIVA, nunca uma por request e nunca
 * uma por empresa cadastrada (essa alternativa mais simples foi descartada por não escalar: cada
 * PrismaClient abre seu próprio pool de conexões reais com o Postgres). Só empresas genuinamente
 * ativas agora ocupam uma vaga; uma empresa sem atividade recente perde a vaga de forma
 * transparente (sem erro pro usuário) e ganha uma nova na próxima ação.
 */
@Injectable()
export class TenantPrismaClientRegistry implements OnApplicationShutdown {
  private readonly cache = new Map<string, TenantClientEntry>();
  private readonly inFlightCreation = new Map<string, Promise<PrismaClient>>();
  private readonly opts: TenantPrismaClientRegistryOptions;
  private useSeq = 0;

  constructor(opts: TenantPrismaClientRegistryOptions) {
    this.opts = opts;
  }

  async getClient(companyId: string): Promise<PrismaClient> {
    const existing = this.cache.get(companyId);
    if (existing) {
      existing.lastUsedSeq = ++this.useSeq;
      existing.inFlightOperations++;
      return existing.client;
    }

    const inFlight = this.inFlightCreation.get(companyId);
    if (inFlight) {
      const client = await inFlight;
      const entry = this.cache.get(companyId)!;
      entry.lastUsedSeq = ++this.useSeq;
      entry.inFlightOperations++;
      return client;
    }

    const creationPromise = this.createAndRegister(companyId);
    this.inFlightCreation.set(companyId, creationPromise);
    try {
      return await creationPromise;
    } finally {
      this.inFlightCreation.delete(companyId);
    }
  }

  release(companyId: string): void {
    const entry = this.cache.get(companyId);
    if (!entry) return;
    entry.inFlightOperations--;
    if (entry.pendingEviction && entry.inFlightOperations === 0) {
      this.cache.delete(companyId);
      void entry.client.$disconnect();
    }
  }

  async withClient<T>(companyId: string, fn: (client: PrismaClient) => Promise<T>): Promise<T> {
    const client = await this.getClient(companyId);
    try {
      return await fn(client);
    } finally {
      this.release(companyId);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([...this.cache.values()].map((entry) => entry.client.$disconnect()));
    this.cache.clear();
  }

  private async createAndRegister(companyId: string): Promise<PrismaClient> {
    // Só entra no caminho assíncrono de expulsão quando o cache está de fato cheio — um
    // `await` incondicional aqui (mesmo quando a expulsão é um no-op) adiaria a chamada de
    // `createClient` por um microtask-tick sempre, o que quebra a deduplicação de criação
    // concorrente: duas chamadas de `getClient` feitas de volta a volta (sem `await` entre elas)
    // deixariam de compartilhar a MESMA `creationPromise` no instante certo se `createClient` não
    // fosse invocado de forma síncrona dentro da própria chamada síncrona a `createAndRegister`.
    // Conta `inFlightCreation.size` além de `cache.size` (mesma fórmula usada dentro de
    // `evictLeastRecentlyUsedIfNeeded`, ver o comentário lá para o cenário de corrida que isso
    // fecha): sem isso, esta checagem síncrona ficaria sistematicamente desatualizada durante uma
    // rajada de empresas novas e diferentes pedindo client ao mesmo tempo, e nunca chegaria a
    // chamar `evictLeastRecentlyUsedIfNeeded` (que tem a checagem corrigida) justamente no caso em
    // que ela é necessária.
    if (this.cache.size + this.inFlightCreation.size >= this.opts.maxSize) {
      await this.evictLeastRecentlyUsedIfNeeded();
    }

    const schemaName = tenantSchemaName(companyId);
    assertValidSchemaName(schemaName);
    const client = (await this.opts.createClient(companyId, schemaName)) as PrismaClient;

    this.cache.set(companyId, {
      client,
      lastUsedSeq: ++this.useSeq,
      inFlightOperations: 1,
      pendingEviction: false,
    });
    return client;
  }

  private async evictLeastRecentlyUsedIfNeeded(): Promise<void> {
    // `cache.size` sozinho subestima a ocupação real: uma criação em andamento (registrada em
    // `inFlightCreation`, mas ainda não inserida em `cache` — isso só acontece depois que
    // `createClient(...)` resolve) também reserva uma vaga de fato. Sem somar
    // `inFlightCreation.size` aqui, várias empresas DIFERENTES e nunca vistas antes pedindo
    // client ao mesmo tempo (requisições HTTP concorrentes reais, não uma única chamada de
    // `Promise.all`) veriam todas o mesmo `cache.size` antigo — nenhuma delas ainda terminou sua
    // própria criação — e todas passariam pela checagem de capacidade, deixando o cache acabar
    // com mais entradas do que `maxSize` (cada uma um pool de conexões real com o Postgres).
    if (this.cache.size + this.inFlightCreation.size < this.opts.maxSize) return;

    const deadline = Date.now() + this.opts.evictionTimeoutMs;
    for (;;) {
      let oldestKey: string | undefined;
      let oldestEntry: TenantClientEntry | undefined;
      for (const [key, entry] of this.cache.entries()) {
        if (entry.inFlightOperations > 0) continue;
        if (!oldestEntry || entry.lastUsedSeq < oldestEntry.lastUsedSeq) {
          oldestKey = key;
          oldestEntry = entry;
        }
      }

      if (oldestKey && oldestEntry) {
        this.cache.delete(oldestKey);
        void oldestEntry.client.$disconnect();
        return;
      }

      if (Date.now() >= deadline) {
        throw new Error(
          `Nenhuma vaga de conexão de tenant liberou a tempo (timeout de ${this.opts.evictionTimeoutMs}ms) — ` +
            `cache no tamanho máximo (${this.opts.maxSize}) com todas as entradas em uso.`,
        );
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  }
}
