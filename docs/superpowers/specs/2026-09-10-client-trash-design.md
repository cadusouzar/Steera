# Lixeira de Clientes (Client Trash) — Design

**Status:** aprovado pelo usuário em 2026-09-10, pronto para virar plano de implementação.

## Contexto

Hoje (ver `docs/superpowers/specs/2026-09-09-quickflow-backend-design.md` e
`[[DECISOES-TECNICAS]]` no vault Obsidian) a desativação de um cliente
(`PATCH /clients/:id/deactivate`) é sempre lógica — o `Client` e seus
`Receivable`/`Subscription` nunca são apagados do banco — e a flag
`includeInRevenueReport` (independente de `status`) decide se o faturamento
histórico do cliente continua somando em `GET /reports/financial-summary`.

Esta spec adiciona uma "lixeira": para o grupo de clientes desativados que
**não** deve mais contar em relatórios, o usuário quer uma janela de 30 dias
para desfazer a exclusão antes que os dados sejam apagados de verdade. Esta é
a primeira vez que o projeto introduz exclusão física real de `Client`.

## Regra central (confirmada com o usuário)

A lixeira e a purga de 30 dias se aplicam **exclusivamente** ao grupo
`status=INACTIVE AND includeInRevenueReport=false`.

- **`includeInRevenueReport=true` na desativação:** cliente vira `INACTIVE`,
  some da listagem padrão, mas fica inativo **para sempre, sem prazo, sem
  entrar na lixeira**. Apagá-lo automaticamente destruiria justamente o
  histórico que o usuário pediu para preservar nos relatórios — por isso
  esse grupo é permanentemente isento de purga.
- **`includeInRevenueReport=false` na desativação:** cliente vira `INACTIVE`
  **e entra na lixeira**, com contagem de 30 dias a partir do momento da
  desativação. Pode ser restaurado a qualquer momento dentro da janela.
  Se ninguém restaurar, ao fim do prazo o cliente e todos os seus lançamentos
  e assinaturas são apagados fisicamente do banco (hard delete real, via
  cascade).

## Modelo de dados

Novo campo em `Client` (migration nova, hand-written, seguindo o processo
seguro já estabelecido no projeto — nunca `--shadow-database-url` apontado
para um banco real; ver o incidente documentado em `[[DECISOES-TECNICAS]]`):

```prisma
model Client {
  id                     String         @id @default(cuid())
  name                   String
  category               String?
  contact                String
  email                  String?
  status                 ClientStatus   @default(ACTIVE)
  includeInRevenueReport Boolean        @default(true)
  deactivatedAt          DateTime?      // novo — setado em /deactivate, limpo em /restore
  createdAt              DateTime       @default(now())
  updatedAt              DateTime       @updatedAt
  receivables            Receivable[]
  subscriptions          Subscription[]

  @@index([status])
  @@index([deactivatedAt])
}
```

`deactivatedAt`:
- `null` enquanto `status=ACTIVE`.
- Setado para `new Date()` dentro da mesma transação de `/deactivate`
  (independente do valor de `includeInRevenueReport` — o campo é sempre
  gravado; só a *purga* filtra por flag).
- Limpo (`null`) em `/restore`.
- Índice novo (`@@index([deactivatedAt])`) para a query de purga não fazer
  full table scan.

## Backend

### `POST /clients/:id/deactivate` (existente, ajustado)

Único ajuste: além de `status=INACTIVE` e `includeInRevenueReport`, grava
`deactivatedAt: new Date()` na mesma transação já existente (`$transaction`
com o update do cliente + `subscription.updateMany`). Nenhuma mudança de
contrato (body/response) — o campo novo só aparece no payload de resposta,
que já reflete o objeto `Client` inteiro.

### `PATCH /clients/:id/restore` (novo)

- Reativa qualquer cliente `INACTIVE`, dos dois grupos (com flag `true` ou
  `false`) — não é exclusivo da lixeira, é a via geral de "desfazer
  inativação".
- Sem body.
- Regras: 404 se o cliente não existe; 409 (`ConflictException`) se o
  cliente já está `ACTIVE`.
- Efeito: `status=ACTIVE`, `deactivatedAt=null`. **Não** mexe em
  `includeInRevenueReport` — mantém o valor como estava; a decisão sobre
  contar ou não em relatórios é ortogonal e só volta a ser perguntada numa
  futura desativação.
- Implementação: método `restore(id)` em `ClientsService`, análogo a
  `deactivate` — reaproveita `assertExists`.

### `GET /clients/trash` (novo)

- Retorna só o grupo `status=INACTIVE AND includeInRevenueReport=false`,
  ordenado por `deactivatedAt` ascendente (quem está mais perto de expirar
  primeiro).
- Sem paginação — lista simples (`Client[]`), no mesmo padrão de
  `GET /clients/:clientId/subscriptions` (lista pequena, não passou pelo
  padrão `Paginated<T>` das listagens grandes).
- **Importante (ordem de rotas no NestJS):** `@Get('trash')` precisa ser
  declarado **antes** de `@Get(':id')` no `ClientsController`, senão o
  Nest interpreta `trash` como um `:id` e a rota nunca é alcançada.
- Antes de montar a query, chama `purgeExpiredTrash()` (ver abaixo) — purga
  defensiva, cobre o caso do backend ter ficado desligado e o cron não ter
  rodado no dia certo.
- Response: cada cliente inclui `deactivatedAt` (ISO string); o cálculo de
  "dias restantes" fica por conta do frontend (evita duplicar lógica de
  data entre camadas por um valor que é só de exibição).

### Purga (`purgeExpiredTrash`, novo método em `ClientsService`)

```ts
async purgeExpiredTrash(): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const result = await this.prisma.client.deleteMany({
    where: {
      status: ClientStatus.INACTIVE,
      includeInRevenueReport: false,
      deactivatedAt: { lt: cutoff },
    },
  });
  return result.count;
}
```

- O cascade de `Receivable`/`Subscription` (`onDelete: Cascade`, já existe
  no schema) cuida de apagar os lançamentos/assinaturas junto — nenhuma
  query adicional necessária.
- Chamada em dois lugares:
  1. No início de `GET /clients/trash` (purga defensiva síncrona, antes de
     responder).
  2. Num job agendado diário (`@nestjs/schedule`, novo pacote — dependência
     leve, padrão do ecossistema Nest): `@Cron(CronExpression.EVERY_DAY_AT_3AM)`
     num método da própria `ClientsService`, registrado via
     `ScheduleModule.forRoot()` no `AppModule`.
- Erros na execução do cron são só logados (`console.error`/logger do Nest),
  nunca derrubam o processo — consistente com o app não ter monitoramento
  externo nesta etapa.

### Fechando uma brecha existente

`UpdateClientDto` (`PATCH /clients/:id`) hoje ainda aceita `status`
livremente — isso permite inativar um cliente por fora do fluxo de
`/deactivate`, sem `deactivatedAt` setado e sem a decisão obrigatória sobre
`includeInRevenueReport`. Esse cliente nunca expiraria (a query de purga
exige `deactivatedAt` não nulo) e nunca apareceria corretamente na lixeira.

**Ajuste:** remover `status` de `UpdateClientDto`. Toda mudança de ciclo de
vida (ativar/desativar) passa a ser exclusivamente via `/deactivate` e
`/restore`. `PATCH /clients/:id` volta a ser só para editar
`name`/`category`/`contact`/`email` — que já é o único uso real hoje no
frontend (`ClientFinanceDrawer`, depois da tarefa anterior que já removeu o
select de status do formulário de edição).

## Frontend

- Botão **"Lixeira"** no header de `src/pages/app/ClientsList.tsx`, ao lado
  de "Relatórios"/"Novo Cliente" (mesmo estilo dos outros botões de ação do
  header).
- Novo componente `ClientTrashDrawer.tsx` (padrão visual de drawer lateral,
  igual `ClientFinanceDrawer`): lista os clientes retornados por
  `GET /clients/trash`, cada linha mostra nome + "Expira em N dias" (ou
  "Expira hoje" quando `N=0`) + botão "Restaurar".
- Cálculo de dias restantes no frontend, a partir de `deactivatedAt`:
  `Math.max(0, 30 - Math.floor((Date.now() - new Date(deactivatedAt).getTime()) / 86400000))`.
- Estado vazio: "Lixeira vazia" quando não há nenhum cliente no grupo.
- Ao clicar "Restaurar": desabilita o botão daquela linha, mostra loading,
  chama `PATCH /clients/:id/restore`; em caso de sucesso remove a linha da
  lixeira local e recarrega a listagem padrão de clientes (`listClients()`)
  para já trazer o cliente restaurado com seus totais corretos, sem precisar
  reconstruir esse estado manualmente a partir do payload parcial da
  lixeira.
- Erro ao restaurar: mostra banner de erro na própria lixeira (mesmo padrão
  de `actionError` já usado em `ClientFinanceDrawer`), mantém a linha na
  lista (nunca remove otimisticamente sem confirmação do backend, mesma
  regra já aplicada à exclusão).
- `src/lib/api.ts`: novas funções `listTrashedClients()` e
  `restoreClient(id)`; `updateClient()` perde o parâmetro `status` do tipo
  do DTO (acompanhando a remoção no backend).

## Erros e casos de borda

| Caso | Comportamento |
|---|---|
| Restaurar cliente inexistente | 404 |
| Restaurar cliente já ativo | 409 |
| Restaurar cliente que já foi purgado (passou dos 30 dias) | 404 — o registro simplesmente não existe mais no banco, não há distinção especial |
| Cron falha por erro transitório (ex.: banco fora do ar no momento exato) | Logado, não derruba o processo; a purga defensiva ao abrir a lixeira cobre a maior parte dos casos de atraso |
| Cliente com `includeInRevenueReport=true` cujo `deactivatedAt` é antigo | Nunca purgado — a query de purga sempre filtra `includeInRevenueReport=false` |
| Duas purgas rodando "ao mesmo tempo" (cron + purga defensiva) | `deleteMany` é idempotente por natureza (segunda chamada só encontra 0 linhas elegíveis) — sem necessidade de lock adicional |

## Testes planejados

**Backend — unitários (`clients.service.spec.ts`):**
1. `deactivate` com `includeInRevenueReport=false` grava `deactivatedAt`.
2. `restore`: sucesso limpa `deactivatedAt` e volta `status=ACTIVE`.
3. `restore`: 404 se cliente não existe.
4. `restore`: 409 se cliente já está `ACTIVE`.
5. `restore`: não altera `includeInRevenueReport`.
6. `findTrash`: retorna só clientes `INACTIVE` com flag `false`; exclui
   ativos e exclui `INACTIVE` com flag `true`.
7. `purgeExpiredTrash`: apaga só quem passou dos 30 dias **e** tem flag
   `false`; não apaga flag `true` mesmo com `deactivatedAt` antigo; não
   apaga quem ainda está dentro do prazo; não apaga clientes `ACTIVE`.

**Backend — e2e (`app.e2e-spec.ts`):**
1. Fluxo completo: cria cliente → desativa com flag `false` → aparece em
   `GET /clients/trash` → restaura → some da lixeira → reaparece em
   `GET /clients?status=ACTIVE`.
2. Cliente desativado com flag `false` e `deactivatedAt` forçado (via
   Prisma direto no teste) para 31 dias atrás → chamar `GET /clients/trash`
   (dispara purga defensiva) → cliente e seus lançamentos somem de verdade
   do banco (`findUnique` retorna `null`).
3. Cliente desativado com flag `true` e `deactivatedAt` igualmente forçado
   para 31 dias atrás → purga não o remove (continua existindo, `INACTIVE`).
4. `PATCH /clients/:id` com `status` no body → rejeitado pelo
   `ValidationPipe` (`forbidNonWhitelisted`), confirmando que a brecha foi
   fechada.

## Documentação a atualizar (depois da implementação)

- `[[BANCO-DE-DADOS]]`: campo `deactivatedAt` no schema do `Client`.
- `[[API]]`: novas rotas `/clients/:id/restore` e `/clients/trash`, e a
  remoção de `status` de `PATCH /clients/:id`.
- `[[DECISOES-TECNICAS]]`: nova entrada explicando a regra de que só o
  grupo `includeInRevenueReport=false` entra na lixeira/purga, e por quê
  (evitar apagar dados que o usuário pediu para preservar).
- `CLAUDE.md`: uma linha curta apontando a existência da lixeira, com
  remissão ao vault para detalhes (mesmo padrão já usado para a regra de
  exclusão lógica).
