# Autenticação Multi-Tenant — Design

## Contexto e motivação

O projeto nunca teve autenticação real em lugar nenhum (frontend nem backend). Todo o backend
já foi construído desde o início assumindo multi-tenancy por `companyId` — toda tabela de RH e
Financeiro carrega `companyId` e todo service filtra por ele — mas o valor de `companyId` sempre
veio de um stub de empresa única, documentado explicitamente em
`backend/src/company/company-context.service.ts`:

> "Substituto temporário para autenticação real ... Quando a autenticação existir de verdade, só
> este método precisa mudar (ler `req.user.companyId`) — toda query/checagem de propriedade nos
> módulos de RH já está escrita como se a auth fosse real."

Este spec implementa exatamente essa promessa: autenticação real, multi-tenant, sem tocar na
lógica de negócio já existente (Clientes, RH, Férias, Afastamento, Pagamentos) além de trocar a
fonte do `companyId`.

## Escopo

**Dentro do escopo desta etapa:**
- Modelo de dados de usuários/sessões, multi-tenant.
- Login, logout, renovação de sessão (access + refresh token, com rotação e revogação).
- Papéis (`ADMIN`/`EMPLOYEE`) e controle de quais módulos cada login enxerga.
- Limite de logins `EMPLOYEE` por plano contratado.
- Vínculo obrigatório entre login `EMPLOYEE` e um `Employee` (RH) já cadastrado.
- Segurança do fluxo de auth em si (hash de senha, rate limiting, rotação de token, etc.).

**Fora do escopo, de propósito, para uma etapa futura separada:**
- Processamento de pagamento de verdade (Stripe ou equivalente) — o valor do plano
  (`planTier`/`maxEmployeeLogins`) é definido manualmente por enquanto, não por uma cobrança real.
- Fluxo de "esqueci minha senha" / recuperação por e-mail (precisa de um provedor de e-mail
  transacional, que não existe no projeto ainda) — pendência conhecida, endereçada depois.
- MFA (autenticação em duas etapas).

## Modelo de tenant

- `Company` (já existe) passa a ser o tenant de verdade. Ganha dois campos novos:
  - `planTier: CompanyPlanTier` (`BASICO` | `PRO` | `EMPRESARIAL`), default `BASICO`.
  - `maxEmployeeLogins: Int` — derivado do `planTier` no momento da criação/mudança de plano, não
    editável diretamente por nenhuma rota (evita alguém burlar o limite editando o número à mão
    sem mudar de plano):
    - `BASICO` → 10
    - `PRO` → 50
    - `EMPRESARIAL` → um valor alto o suficiente pra ser, na prática, ilimitado (ex.: `999999` —
      evita `NULL`/lógica condicional espalhada pelo código só pra representar "sem limite").
- O primeiro `User` de uma `Company` nasce com `role=ADMIN`, todos os módulos liberados, e não tem
  `employeeId` (o dono da assinatura não precisa ser um `Employee` de RH da própria empresa).
- Qualquer `User` adicional (`ADMIN` ou `EMPLOYEE`) só existe se um `ADMIN` já existente da mesma
  empresa criar — nunca um cadastro público de novo usuário fora desse fluxo.
- Isolamento de dados: todo o resto do backend já filtra por `companyId` em cada query — nenhuma
  mudança necessária ali além de `CompanyContextService.getCurrentCompanyId()` passar a ler o
  `companyId` do token verificado da requisição, em vez do stub de empresa única.

## Modelo de dados (novo)

```prisma
enum AppModule {
  DASHBOARD
  CLIENTES
  RH
  COMERCIAL
  OPERACOES
  FINANCAS
}

enum CompanyPlanTier {
  BASICO
  PRO
  EMPRESARIAL
}

enum UserRole {
  ADMIN
  EMPLOYEE
}

enum UserStatus {
  ACTIVE
  BLOCKED
}

model User {
  id           String     @id @default(cuid())
  companyId    String
  company      Company    @relation(fields: [companyId], references: [id], onDelete: Cascade)
  email        String     @unique
  passwordHash String
  role         UserRole
  // Obrigatório quando role=EMPLOYEE (o login "veste" um Employee de RH já
  // cadastrado); sempre null quando role=ADMIN.
  employeeId   String?    @unique
  employee     Employee?  @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  modules      AppModule[]
  status       UserStatus @default(ACTIVE)
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
  refreshTokens RefreshToken[]

  @@index([companyId])
}

model RefreshToken {
  id                String    @id @default(cuid())
  userId            String
  user              User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  // Nunca o token em texto puro — só o hash (mesmo motivo de senha: se o
  // banco vazar, os tokens não são diretamente utilizáveis).
  tokenHash         String    @unique
  expiresAt         DateTime
  revokedAt         DateTime?
  // Rastreia a cadeia de rotação — permite invalidar a família inteira se um
  // token já substituído for reapresentado (sinal de roubo/replay).
  replacedByTokenId String?
  createdAt         DateTime  @default(now())

  @@index([userId])
}
```

Mudanças em modelos existentes:
- `Company` ganha `planTier`/`maxEmployeeLogins` (acima) e a relação inversa `users User[]`.
- `Employee` ganha a relação inversa `user User?` (um `Employee` pode ou não ter um login
  associado — a maioria não terá, já que hoje `Employee` é só um registro de RH).

`employeeId` como `@unique` em `User` garante, no nível do banco, que um `Employee` nunca tenha
mais de um login — junto com a checagem de aplicação, não só uma das duas.

## Fluxo de autenticação

### Login — `POST /auth/login`
1. Recebe `email` + `senha`.
2. Busca o `User` por `email`; se não existir, ou `status !== ACTIVE`, ou a senha não bater
   (comparação via `argon2.verify`, nunca comparação direta de string) → `401` genérico ("e-mail
   ou senha inválidos") — nunca revelar qual dos dois campos errou, para não ajudar quem está
   tentando adivinhar contas válidas.
3. Sucesso: gera um access token (JWT, TTL 15 min, claims `sub` (userId), `companyId`, `role`,
   `modules`) e um refresh token novo (valor aleatório, alta entropia; só o hash dele é persistido
   em `RefreshToken`).
4. Resposta: access token no corpo (JSON); refresh token num cookie
   `Set-Cookie: rt=...; HttpOnly; Secure; SameSite=Strict; Path=/auth`.

### Uso normal
- Toda rota protegida exige `Authorization: Bearer <access token>`. Um guard NestJS
  (`AuthGuard`/`JwtStrategy` via Passport) valida assinatura + expiração e popula `req.user`
  (`{ userId, companyId, role, modules }`).
- `CompanyContextService.getCurrentCompanyId()` passa a ler `req.user.companyId` (via
  `REQUEST`-scoped injection, ou equivalente) — a única mudança que o resto do backend precisa.
- Nenhuma rota volta a aceitar `companyId` do corpo/query da requisição — o token é a única fonte.

### Renovação — `POST /auth/refresh`
1. Lê o refresh token do cookie `httpOnly` (o frontend não precisa mandar nada explícito).
2. Busca o `RefreshToken` pelo hash; se não existir, expirado, ou `revokedAt` preenchido → `401`,
   frontend força novo login.
3. **Se `replacedByTokenId` já estiver preenchido** (ou seja: esse token específico já foi trocado
   por um mais novo antes, e está sendo reapresentado agora) → sinal de reuso/roubo → revoga
   **todos** os `RefreshToken` daquele `userId` (não só este) → `401`, força novo login em todo
   dispositivo daquele usuário.
4. Sucesso: emite access token novo + refresh token novo; marca o antigo com `replacedByTokenId`
   apontando pro novo.

### Logout — `POST /auth/logout`
Revoga (`revokedAt = now()`) o refresh token atual daquele usuário. Cookie é limpo na resposta.

### Criar login — `POST /companies/me/users` (só `ADMIN`)
1. Confere que quem chama é `ADMIN` da empresa (via `req.user.role`).
2. Se `role: EMPLOYEE` no corpo: exige `employeeId` de um `Employee` que já existe **e** pertence
   à mesma empresa **e** ainda não tem `user` associado (o `@unique` no banco é a última barreira,
   mas a checagem de aplicação dá uma mensagem de erro legível em vez de estourar uma constraint
   crua). Conta quantos `User` com `role=EMPLOYEE` e `status=ACTIVE` a empresa já tem; se já bateu
   `maxEmployeeLogins`, rejeita com `403` explicando o limite do plano.
3. Se `role: ADMIN` no corpo: sem limite de quantidade (não conta pro teto de plano), sem exigir
   `employeeId`.
4. Gera uma senha temporária (aleatória, alta entropia) e retorna ela **uma única vez** na resposta
   da criação (o admin repassa manualmente pro funcionário — não há e-mail transacional nesta
   etapa, ver "fora do escopo" acima); o `passwordHash` salvo é o hash dessa senha temporária. O
   funcionário troca a senha no primeiro login (endpoint `PATCH /auth/me/password`, exige a senha
   atual).
5. `modules: AppModule[]` no corpo define o que aquele login enxerga — vale igual pra `ADMIN` e
   `EMPLOYEE` (gerenciar outros logins é uma capacidade do `role`, independente de quais módulos de
   dado aquele login específico vê).

### Bloquear/reativar um login — `PATCH /companies/me/users/:id/block` e `.../unblock` (só `ADMIN`)
Marca `status`. Um login `BLOCKED` falha no login E tem todos os `RefreshToken` ativos revogados
na mesma chamada (bloquear não pode deixar uma sessão já aberta continuar funcionando).

## Segurança

| Risco | Mitigação |
|---|---|
| Senha vazada do banco | `argon2` (nunca reversível); nunca logado, nunca retornado em resposta alguma. |
| Força bruta em login/refresh | Rate limiting por IP e por e-mail (`@nestjs/throttler` ou equivalente) — ex.: 5 tentativas/15 min, com backoff. |
| Roubo de access token (XSS) | Vive só em memória no frontend, nunca `localStorage`/`sessionStorage`; TTL curto (15 min) limita a janela de uso mesmo se vazar. |
| Roubo de refresh token | Cookie `HttpOnly` + `Secure` + `SameSite=Strict` — inacessível a JavaScript, mesmo com XSS. |
| Reuso de refresh token roubado | Detecção de reuso via `replacedByTokenId` (acima) — revoga a cadeia inteira, não só o token. |
| Chave de assinatura JWT exposta | Vive só em variável de ambiente do backend; nunca aparece em resposta de API, nunca no frontend, nunca em log. |
| `companyId` forjado pelo cliente | Nunca aceito do corpo/query — sempre derivado do token verificado (mesma regra já em uso no resto do backend). |
| Confusão de algoritmo JWT (ex.: aceitar `alg: none`) | Biblioteca de verificação configurada para aceitar só o algoritmo esperado (`HS256`), nunca decidir o algoritmo a partir do próprio token. |
| Criar login além do limite do plano via chamada direta à API (pulando a tela) | Checagem de limite roda no backend, na criação — não é validação só de UI. |
| CORS aberto demais | Backend só aceita origem do frontend real, não `*`. |
| SQL/NoSQL injection | Prisma parametriza toda query — já é assim em todo o projeto. |
| Payload malformado | `class-validator` em todo DTO novo — já é o padrão do projeto. |

## Fora do escopo desta etapa (pendências conhecidas, de propósito)

- Processamento de pagamento real / mudança de plano automatizada.
- Recuperação de senha por e-mail (precisa de provedor de e-mail transacional).
- MFA.
- Auditoria/log de quem criou/bloqueou qual login (fica pra uma iteração futura se o usuário
  quiser rastreabilidade completa).

## Testes

Mesma convenção já usada em todo o backend (Jest, mocks de Prisma/serviços) — sem infraestrutura
nova. Casos mínimos a cobrir na etapa de implementação:
- Login com senha certa/errada, usuário bloqueado, usuário inexistente.
- Emissão e verificação de access token (claims corretos, expiração respeitada).
- Rotação de refresh token: uso normal, uso de um token já substituído (deve revogar a cadeia).
- Limite de plano: criar `EMPLOYEE` até o teto passa, o próximo falha com `403`.
- Criar `EMPLOYEE` para um `Employee` que já tem login → falha.
- Criar `EMPLOYEE` para um `Employee` de outra empresa → falha (isolamento).
- `CompanyContextService.getCurrentCompanyId()` lendo do contexto de requisição em vez do stub.

Sem teste e2e contra Postgres real obrigatório nesta etapa (mesmo padrão já aceito no resto do
projeto), mas uma verificação manual ponta-a-ponta (login real pelo navegador, criar um funcionário
com login, checar que só aquele funcionário + o admin daquela empresa veem os dados dela) é
esperada antes de considerar a etapa concluída — mesmo padrão de QA manual já seguido o resto desta
sessão.
