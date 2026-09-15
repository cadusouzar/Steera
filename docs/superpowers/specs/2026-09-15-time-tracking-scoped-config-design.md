# Configuração de Ponto Escopada por Superior — Design

## Contexto e motivação

O módulo de Controle de Ponto (`docs/superpowers/specs/2026-09-13-time-tracking-design.md`) já
distingue "quem sou eu" (bater o próprio ponto) de "o que administro" (aprovar ajustes,
justificativas, ver inconsistências) via `TimeManagementAuthService.canManage()` — um `ADMIN` sempre
pode administrar qualquer funcionário da própria empresa; um login `EMPLOYEE` só administra quem
tem seu `Employee` como `managerId` **direto**.

Duas lacunas concretas motivaram este design, levantadas em conversa:

1. **Cadastro de jornada de trabalho não escala.** Hoje `WorkSchedule` é sempre por funcionário —
   uma empresa com 50 funcionários exige 50 cadastros manuais, mesmo quando a maioria compartilha o
   mesmo horário.
2. **`ADMIN` é um bypass absoluto, mesmo quando não deveria ser.** Em empresas pequenas/médias é
   comum múltiplos logins terem `role: ADMIN` por conveniência (ex.: gerentes de confiança), não só
   o dono/fundador. Hoje qualquer um desses logins pode alterar configuração da empresa **inteira**
   (jornadas de qualquer funcionário, regras globais de bater ponto, locais de trabalho) — não só do
   próprio time. Não existe hoje nenhuma forma de restringir um `ADMIN` específico a "administrar só
   quem eu comando", mesmo que seja essa a intenção de quem criou aquele login.

Este design resolve as duas coisas com o mesmo mecanismo: uma configuração em camadas (padrão da
empresa + sobrescrita por superior, com jornada de trabalho ganhando uma terceira camada individual
por funcionário), e uma forma explícita de dizer que um login `ADMIN` específico deve ser tratado,
dentro do Controle de Ponto, exatamente como um superior comum.

## Escopo

Este design cobre **só o módulo de Controle de Ponto** — nenhuma mudança em como `ADMIN`/`role`/
`modules` funcionam no resto do sistema (RH, Financeiro, Clientes, etc. continuam exatamente como
são hoje). Ver "Fora do escopo" para itens explicitamente adiados, incluindo uma ideia maior
(Departamentos como hierarquia de primeira classe) que **não** faz parte deste design.

## Modelo de tenant e hierarquia (o que já existe, não muda)

Sem mudança: `Employee.managerId` (auto-relação direta, sem propagação em cadeia) continua sendo a
única fonte de "quem é superior de quem" usada por este design. Um "superior do superior" nunca
ganha autoridade automática sobre o subordinado do subordinado — mesma limitação já documentada e
aceita no restante do módulo.

## Modelo de dados

### `User.hasFullPontoAccess` (novo campo)

```prisma
model User {
  // ... campos existentes inalterados ...
  hasFullPontoAccess Boolean @default(true)
}
```

- Só tem efeito para `role: ADMIN` — um login `EMPLOYEE` já é sempre escopado ao próprio time, este
  campo não muda nada pra ele.
- **Migração:** todo login `ADMIN` existente nasce com `true` — ninguém perde acesso sozinho quando
  esta feature for ao ar. A restrição só passa a valer quando alguém explicitamente desliga o campo
  de um login específico.
- Não afeta `modules`/leitura de outras telas do sistema — só a autorização dentro do Controle de
  Ponto (ver seção "Autorização" abaixo).

### `WorkSchedule` — três níveis (empresa + time + individual)

```prisma
model WorkSchedule {
  // ... campos existentes inalterados ...
  employeeId String?   // agora opcional
  employee   Employee? @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  managerId  String?   // novo — Employee.id de quem esta jornada é o "padrão do time"
  manager    Employee? @relation("WorkScheduleManager", fields: [managerId], references: [id], onDelete: Cascade)
}
```

- No máximo um dos dois (`employeeId`/`managerId`) é preenchido por linha — nunca os dois ao mesmo
  tempo. As três combinações válidas: só `employeeId` (individual), só `managerId` (padrão do
  time), nenhum dos dois (padrão da empresa inteira). Validado na aplicação (DTO com
  `@ValidateIf`/checagem cruzada), não como `CHECK` de banco — mesmo padrão de validação já usado
  no resto do backend pra invariantes deste tipo.
- Uma linha com `managerId` é o "padrão do time": aplica-se a **todos os subordinados diretos**
  daquele `Employee`, automaticamente — sem precisar criar uma linha por funcionário.
- Uma linha com `employeeId` continua sendo individual: sobrescreve o padrão do time (ou o padrão
  da empresa, se o time não tiver um) só pra aquela pessoa (ex.: alguém em meio período dentro de um
  time que por padrão é período integral).
- Uma linha sem `employeeId` nem `managerId` é o **padrão da empresa inteira** — cobre o caso de uma
  empresa nova onde ninguém ainda configurou nada por time/indivíduo, mas já tem gente batendo
  ponto. **Só quem tem `hasFullPontoAccess` pode criar/editar essa linha** (mesma checagem de
  `assertHasFullPontoAccess` usada pra `TimeTrackingSettings`/`WorkLocation`) — um superior comum ou
  ADMIN sem acesso total nunca mexe nela.
- Ordem de resolução em `getScheduleForDate` (ver "Fluxos" abaixo): individual → padrão do time do
  superior direto → padrão da empresa → nenhum (comportamento de hoje, `expectedMinutes = 0`, dia
  mostrado como "Folga").
- Sem checagem de sobreposição entre linhas do mesmo nível (ex.: dois padrões de empresa com
  `weekDays` conflitantes) — mesma limitação já existente hoje pra jornadas individuais (`
  getScheduleForDate` escolhe a de `validFrom` mais recente entre as candidatas), não uma lacuna
  nova introduzida por este design.

### `TimeTrackingSettings` — dois níveis (empresa + por time)

```prisma
model TimeTrackingSettings {
  // ... campos existentes inalterados ...
  companyId String            // deixa de ser @unique sozinho
  managerId String?           // novo — nulo = a linha "padrão da empresa"; preenchido = regra do time deste superior
}
```

- Constraint de unicidade muda de `companyId @unique` para dois índices únicos **parciais** via SQL
  bruto na migration (mesmo padrão já usado neste projeto pra políticas de RLS — ver
  `20260913140100_enable_row_level_security`) — um índice único comum `@@unique([companyId,
  managerId])` não bastaria, porque Postgres trata `NULL` como nunca igual a si mesmo, então
  múltiplas linhas com `managerId: NULL` não violariam essa constraint:
  ```sql
  CREATE UNIQUE INDEX "TimeTrackingSettings_company_default_key"
    ON "TimeTrackingSettings" ("companyId") WHERE "managerId" IS NULL;
  CREATE UNIQUE INDEX "TimeTrackingSettings_manager_override_key"
    ON "TimeTrackingSettings" ("companyId", "managerId") WHERE "managerId" IS NOT NULL;
  ```
  O primeiro garante no máximo uma linha "padrão da empresa" por empresa; o segundo garante no
  máximo uma sobrescrita por superior.
- Uma linha com `managerId: null` é a configuração hoje já existente (a única forma de configurar
  antes deste design) — editá-la exige `hasFullPontoAccess` (ver "Autorização").
- Uma linha com `managerId` preenchido é a sobrescrita daquele superior, valendo só pros seus
  subordinados diretos.

### `WorkLocation` — sem mudança de estrutura

Continua uma tabela só por empresa (geofencing é infraestrutura física, não faz sentido "pertencer"
a um time). Mutação passa a exigir `hasFullPontoAccess` explicitamente (ver "Autorização") em vez de
`@Roles('ADMIN')` puro.

## Autorização

### O bypass de `ADMIN` em `canManage()`/`getManageableEmployeeIds()` passa a checar o novo campo

```ts
// TimeManagementAuthService.canManage() — hoje:
if (currentUser.role === 'ADMIN') return true;

// Depois:
if (currentUser.role === 'ADMIN' && currentUser.hasFullPontoAccess) return true;
```

Mesma mudança em `getManageableEmployeeIds()` (o `'ALL'` só é devolvido se `hasFullPontoAccess`
também for `true`). Como as duas funções já são o único lugar do projeto que decide "quem administra
o ponto de quem" — usado em TODAS as 5 abas administrativas (Inconsistências, Solicitações de
Ajuste, Justificativas, Correção Proativa, Configuração) — esta é a única mudança necessária pra
propagar a restrição de forma consistente. Um `ADMIN` com `hasFullPontoAccess: false` passa a ser
tratado, em todo o Controle de Ponto, exatamente como um login `EMPLOYEE` que gerencia gente: só seus
subordinados diretos, nas 5 abas.

**Decisão explícita:** esta restrição vale pras 5 abas inteiras, não só Configuração — decidido em
conversa, pela simplicidade de usar a mesma checagem em vez de inventar uma regra separada só pra
configuração.

### Nova checagem: `assertHasFullPontoAccess(user)`

Ações que não têm "um funcionário-alvo" pra checar via `canManage()` — editar a linha "padrão da
empresa" de `TimeTrackingSettings`, criar/editar/desativar `WorkLocation`, e o endpoint de ligar/
desligar `hasFullPontoAccess` de outro login — usam uma checagem direta e nova:

```ts
assertHasFullPontoAccess(user: AuthenticatedUser): void {
  if (user.role !== 'ADMIN' || !user.hasFullPontoAccess) {
    throw new NotFoundException('Recurso não encontrado'); // 404, nunca 403 — mesmo padrão do resto do backend
  }
}
```

### Quem pode criar cada nível de `WorkSchedule`/`TimeTrackingSettings`

Ao criar uma linha:
- **Sem `employeeId` nem `managerId`** (padrão da empresa, só existe pra `WorkSchedule`/
  `TimeTrackingSettings`) → sempre exige `assertHasFullPontoAccess(user)`.
- **Com `managerId` preenchido** (padrão de time): se `managerId` corresponde ao próprio `Employee`
  vinculado do chamador → sempre permitido (autoatendimento, "estou configurando meu próprio
  time"); caso contrário → exige `assertHasFullPontoAccess(user)` (só quem tem acesso total pode
  montar o padrão de time de OUTRO superior em nome dele — ex.: RH ajudando a configurar).
- **Com `employeeId` preenchido** (individual, só existe pra `WorkSchedule`): mesma checagem já
  existente, `assertCanManage(user, employeeId)`.

### Novo endpoint: `PATCH /companies/me/users/:id/ponto-access`

```ts
class UpdatePontoAccessDto {
  @IsBoolean() hasFullPontoAccess!: boolean;
}
```

- Guardado por `assertHasFullPontoAccess(currentUser)` — só quem já tem acesso total pode ligar/
  desligar o de outro login.
- `:id` precisa ser um login `role: ADMIN` desta mesma empresa (senão `404`) — o campo não tem
  efeito nenhum em logins `EMPLOYEE`, então tentar setá-lo neles é rejeitado como um pedido sem
  sentido, não silenciosamente ignorado.
- **Trava de segurança:** antes de desligar, conta quantos logins `ADMIN` desta empresa têm
  `hasFullPontoAccess: true` — se for o último, rejeita com `400` explicando que a empresa precisa
  manter pelo menos um. Sem essa trava, uma empresa poderia acidentalmente ficar sem ninguém capaz
  de editar o padrão global de novo (só recuperável por edição direta no banco).

## Fluxos

### Resolver a configuração "efetiva" de um funcionário (uso operacional, não administrativo)

Novo método em `TimeTrackingSettingsService`, substituindo o uso direto de `getOrCreateDefault()`
dentro de `TimeClockService.getStatus()`/`createPunch()`:

```ts
async getEffectiveSettingsForEmployee(employeeId: string, companyId: string): Promise<TimeTrackingSettings> {
  const employee = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { managerId: true } });
  if (employee?.managerId) {
    const managerOverride = await this.prisma.timeTrackingSettings.findFirst({
      where: { companyId, managerId: employee.managerId },
    });
    if (managerOverride) return managerOverride;
  }
  return this.getOrCreateDefault(companyId); // linha managerId:null — cria se ainda não existir
}
```

Lógica de fallback equivalente, com um nível a mais, se aplica a
`TimeAttendanceCalculationService.getScheduleForDate()` pra `WorkSchedule` (sem propagação em cadeia
em nenhum dos passos — sempre o superior **direto**, nunca um nível acima): procura primeiro uma
linha `employeeId` correspondente; sem achar, procura uma linha `managerId` igual ao
`Employee.managerId` do funcionário; sem achar nenhuma das duas, procura a linha "padrão da empresa"
(sem `employeeId` nem `managerId`); sem nenhuma das três, `expectedMinutes = 0` (comportamento de
hoje, inalterado).

### Tela de Configuração — o que cada tipo de login vê

| Situação do login | Regras da empresa | Jornadas de trabalho | Locais de trabalho |
|---|---|---|---|
| `ADMIN` com `hasFullPontoAccess`, sem `Employee` vinculado ou sem subordinados | Só "padrão da empresa" | Edita o "padrão da empresa"; sem seção "meu time" (não tem time); pode criar/editar jornada individual ou de time de **qualquer** funcionário/superior da empresa, por ter acesso total | Vê/edita todos |
| `ADMIN` com `hasFullPontoAccess`, **com** subordinados diretos | Alterna entre "Padrão da empresa" e "Minha equipe" (as duas editáveis) | Edita o "padrão da empresa" e tem uma seção "meu time" pra si mesmo, além de poder configurar qualquer outro funcionário/superior | Vê/edita todos |
| `ADMIN` sem `hasFullPontoAccess`, OU `EMPLOYEE` com subordinados | Só "Minha equipe" (sem visibilidade da linha da empresa) | Só cria/edita jornada (time ou individual) dos próprios subordinados diretos — nunca vê nem edita o "padrão da empresa" | Só visualiza a lista (pra escolher um local ao configurar um subordinado) — não cria/edita |
| Sem subordinados e sem `hasFullPontoAccess` | Nada pra configurar (estado vazio) | Nada pra configurar (estado vazio) | Só visualiza |

## Segurança e LGPD

Nada novo além do que o módulo já cobre — `hasFullPontoAccess` é metadado de autorização, nunca
exposto em log/auditoria além do necessário para a ação de `AuditLog` já existente (`FILE_ACCESSED`
etc. não mudam). A trava do "último admin de acesso total" (acima) é a única regra de segurança
nova, evitando um lockout operacional.

## Fora do escopo / pendências documentadas

- **Departamentos como hierarquia de primeira classe** (`Funcionário → Cargo → Departamento →
  Superior`) — ideia maior, levantada na mesma conversa, que mudaria como "quem é meu superior" é
  derivado (hoje é só `Employee.managerId` direto) e se espalharia por permissões do sistema inteiro
  (não só Ponto). Decisão explícita: fica como uma iniciativa futura separada, com sua própria
  conversa de design — nada neste design é incompatível com ela (quando existir, Departamentos pode
  virar só mais uma forma de alimentar a mesma checagem de `canManage()`).
- `WorkLocation` por time/superior — avaliado, descartado por não fazer sentido conceitual (local é
  infraestrutura física da empresa, não do time).
- Hierarquia de superior com múltiplos níveis (skip-level) para as sobrescritas de configuração —
  mesma limitação já aceita no resto do módulo: só o superior **direto** tem efeito, nunca superior
  do superior.
- Editar `modules`/`role`/`email` de um login existente continua não existindo (limitação já
  documentada, ortogonal a este design) — `hasFullPontoAccess` ganha sua própria rota dedicada
  (`PATCH .../ponto-access`) em vez de abrir uma edição geral de login.

## Testes

- `canManage()`/`getManageableEmployeeIds()`: casos novos cobrindo `ADMIN` com `hasFullPontoAccess:
  false` (deve se comportar identicamente a um `EMPLOYEE` que gerencia as mesmas pessoas).
- `assertHasFullPontoAccess()`: `ADMIN` com acesso total passa; `ADMIN` sem acesso total e qualquer
  `EMPLOYEE` recebem `404`.
- Endpoint de toggle: rejeita desligar o último `hasFullPontoAccess: true` da empresa; rejeita alvo
  que não é `ADMIN`; rejeita alvo de outra empresa (`404`).
- `getEffectiveSettingsForEmployee`: funcionário com superior que tem sobrescrita própria usa a
  sobrescrita; funcionário cujo superior não tem sobrescrita cai no padrão da empresa; funcionário
  sem superior nenhum sempre cai no padrão da empresa.
- `getScheduleForDate`: cobre os três níveis explicitamente — jornada individual tem prioridade
  sobre a de time, que tem prioridade sobre a da empresa; sem nenhuma das três, `expectedMinutes:
  0`; um funcionário sem superior nenhum pula direto pro padrão da empresa (nunca "acha" um padrão
  de time por engano).
- Índice único parcial de `TimeTrackingSettings`: teste de integração confirmando que duas linhas
  `managerId: null` da mesma empresa são rejeitadas, mas duas linhas com `managerId` diferentes
  (dois superiores diferentes) convivem sem conflito.
- Criar `WorkSchedule`/`TimeTrackingSettings` sem `employeeId` nem `managerId` (padrão da empresa):
  rejeitado sem `hasFullPontoAccess`; permitido com.
- Criar `WorkSchedule`/`TimeTrackingSettings` com `managerId` de outro superior: rejeitado sem
  `hasFullPontoAccess`; permitido com.
