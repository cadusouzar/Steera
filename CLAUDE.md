# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Sobre o projeto

QuickFlow (`package.json` name: `nexus-erp`) é um ERP com front-end em React + TypeScript e um backend real (NestJS + Prisma + PostgreSQL, ver seção "Backend" abaixo) para os módulos de Clientes/Financeiro e Recursos Humanos. O restante do app (Analytics, Estoque, Orçamentos, Compras, Usuários) ainda é mockado em memória (`useState` com arrays fixos) ou persistido no `localStorage` do navegador (só os módulos de Analytics fazem isso) — não assuma backend real fora de Clientes/Financeiro/RH.

**Stack:** React 18, TypeScript, Vite, React Router v6, Tailwind CSS, lucide-react (ícones), Recharts (gráficos), react-grid-layout (grid arrastável do dashboard builder), framer-motion, three.js/@react-three/fiber/drei (hero 3D da landing page), html2canvas + jspdf (exportação de relatórios em PDF).

**Gerenciador de pacotes:** npm (há `package-lock.json`; não há `yarn.lock`/`pnpm-lock.yaml`).

**Comandos principais:**
```
npm install       # instalar dependências
npm run dev       # servidor de dev (Vite)
npm run build     # tsc -b && vite build
npm run lint      # eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0
npm run preview   # preview do build de produção
```
Não há suíte de testes configurada no projeto (sem script `test`, sem Jest/Vitest instalado).

## Arquitetura

- `src/App.tsx` — única fonte de rotas do app, via `react-router-dom` (`BrowserRouter`/`Routes`/`Route`). Rotas públicas (`/`, `/login`, `/register`) e rotas logadas sob `/app`, todas aninhadas em `AppLayout`.
- `src/layouts/AppLayout.tsx` — shell do app logado: sidebar com submenus (RH, Comercial, Operações) + header com `ThemeToggle` e `UserProfileDropdown`/`UserProfileDrawer`. Todo conteúdo de página é renderizado via `<Outlet />`.
- `src/pages/app/*` — páginas do ERP logado (uma por rota em `/app/...`): `Overview`, `Roles`, `EmployeesList`/`EmployeeForm`, `ClientsList`, `InventoryList`, `QuotesList`, `PurchasingList`, `TimeTracking`/`TimeTrackingAdmin`, `FinancesSaaS`, `UsersManagement`.
- `src/pages/analytics/*` — módulo de dashboards customizáveis: `DashboardHub` (lista/gerencia dashboards salvos) e `DashboardBuilder` (editor de widgets, rota `/app/analytics/:id`).
- `src/pages/*.tsx` (raiz) — páginas públicas: `LandingPage`, `Login`, `Register`.
- `src/components/analytics/*` — peças do dashboard builder: `WidgetCanvas` (grid via react-grid-layout), `ChartRenderer` (Recharts), `DataSidebar` (painel de configuração de widgets).
- `src/components/*` — componentes compartilhados: modais/drawers de relatório (`ClientReportModal`, `PurchasingReportModal`, `InventoryReportModal`, `ClientFinanceDrawer`, `FinanceAndVacationModal`), navegação/tema (`Navbar`, `ThemeProvider`, `ThemeToggle`, `UserProfileDropdown`, `UserProfileDrawer`), landing page (`Hero3DProduct`, `Mascot`, `FlowBackground`, `PricingCard`), utilitário de UI (`CustomSelect`).
- `src/hooks/*` — `useDashboardState` (estado do dashboard builder, com persistência em `localStorage` sob a chave `saved_dashboards`) e `useEscapeKey`.
- Tema claro/escuro via `ThemeProvider` (`src/components/ThemeProvider.tsx`) + Tailwind `darkMode: 'class'`; as cores (`background`, `foreground`, `primary`, `secondary`, `accent`, `muted`, `border`, `panel`) são CSS vars mapeadas em `tailwind.config.js`, fontes `Inter` (sans) e `Outfit` (heading).
- Persistência real do navegador só existe em `DashboardHub`/`DashboardBuilder` (localStorage); todo o resto do app é mock em memória — não assuma nenhuma API/backend real ao editar essas páginas.

## Convenções

- Textos de UI, nomes de rota e comentários no código estão em **português** (ex.: `/app/funcionarios`, `/app/cargos`, `/app/orcamentos`). Mantenha esse padrão em novas páginas/rotas.
- Componentes de página/layout usam function component com `const Nome = () => { ... }; export default Nome;`.
- Estilização é feita inteiramente com classes utilitárias Tailwind inline (sem CSS Modules/styled-components); use os tokens de cor definidos em `tailwind.config.js` (`bg-panel`, `text-foreground`, `border-border`, `bg-primary`, etc.) em vez de cores hardcoded.
- Ícones sempre via `lucide-react`.
- Roteamento sempre via `react-router-dom` (`Link`, `useLocation`, `Outlet`), nunca `<a>` para navegação interna.
- Ao rodar `npm run lint`, `--max-warnings 0` significa que qualquer warning do ESLint quebra o lint — trate warnings como erros.

## Base de conhecimento (Obsidian)

- O vault deste projeto fica em `B:\Quickflow\Quickflow` (uma nota por página/rota, na raiz do vault).
- Antes de alterar qualquer página, procure no vault se já existe uma nota documentando aquela página específica (nome da nota = nome do componente, ex. `EmployeesList.md` para `src/pages/app/EmployeesList.tsx`) e leia essa nota antes de mexer no código.
- Sempre que criar uma página nova ou mudar o comportamento de uma existente, crie ou atualize a nota correspondente no vault.
- Ao escrever ou editar notas no vault, use a sintaxe do Obsidian Flavored Markdown corretamente (frontmatter com tags/aliases, `[[wikilinks]]` entre notas relacionadas, callouts quando fizer sentido) — use as skills `obsidian-markdown` e `obsidian-cli` para isso em vez de escrever markdown genérico.
- Índice do vault: @B:\Quickflow\Quickflow\Indice.md

## Backend

Backend em `backend/` (NestJS + Prisma + PostgreSQL local, sem Docker), cobrindo Clientes,
Lançamentos, Assinaturas e Relatórios. Ver spec em
`docs/superpowers/specs/2026-09-09-quickflow-backend-design.md` e plano em
`docs/superpowers/plans/2026-09-09-quickflow-backend.md`.

**Comandos (diretório `backend/`):**
```
npm install              # instalar dependências
npx prisma generate      # gerar o Prisma Client (não precisa de banco)
npx prisma migrate dev   # aplicar migrations (precisa de PostgreSQL local rodando)
npm run start:dev        # servidor de dev (porta 3001 por padrão)
npm run build            # build de produção
npm run lint              # eslint --max-warnings 0
npm run test              # testes unitários (Jest)
npm run test:e2e          # teste de integração (precisa de PostgreSQL local rodando)
```

**Variáveis de ambiente** (`backend/.env`, nunca versionado — ver `backend/.env.example`):
- `DATABASE_URL` — string de conexão do PostgreSQL local (`postgresql://USUARIO:SENHA@localhost:5432/quickflow?schema=public`)
- `PORT` — porta HTTP do backend (padrão 3001)

**Arquitetura:** 4 módulos financeiros (`ClientsModule`, `ReceivablesModule`, `SubscriptionsModule`,
`ReportsModule`) + `PrismaModule` global + 8 módulos de Recursos Humanos (`CompanyModule`,
`RolesModule`, `EmployeesModule`, `EmployeeWarningsModule`, `EmployeePaymentsModule`,
`EmployeeRecurringPaymentsModule`, `VacationsModule`, `LeavesModule`) + 9 módulos de Controle de
Ponto (`TimeClockModule`, `TimeAdjustmentsModule`, `TimeJustificationsModule`,
`WorkSchedulesModule`, `WorkLocationsModule`, `TimeTrackingSettingsModule`, `HolidaysModule`,
`FilesModule`, este último compartilhado com o resto do backend, e `AuditLogModule`) +
`TimeManagementAuthModule` (autorização compartilhada por hierarquia de superior). "Overdue" em
lançamentos/pagamentos é
sempre derivado em runtime (nunca persistido). Ver `[[ARQUITETURA]]`, `[[BANCO-DE-DADOS]]`,
`[[API]]`, `[[AMBIENTE-LOCAL]]` e `[[DECISOES-TECNICAS]]` no vault (`B:\Quickflow\Quickflow`) para
detalhes.

**Módulo de RH (`RolesModule`, `EmployeesModule`, `EmployeeWarningsModule`, `EmployeePaymentsModule`,
`EmployeeRecurringPaymentsModule`, `VacationsModule`, `LeavesModule`, `CompanyModule`):** cobre
Cargos, Funcionários (CPF único **por empresa**, mascarado/omitido de dados bancários na listagem
por LGPD — completo só em `GET /employees/:id`), Advertências (sempre aninhadas sob
`/employees/:employeeId/warnings`), Pagamentos avulsos e recorrentes (espelha o par
`Receivable`/`Subscription`, mesma regra de overdue derivado), Férias e Afastamento.

- **Autenticação/multi-tenant real (implementada em 13/09/2026):** o stub de empresa única foi
  substituído por autenticação de verdade. `AuthModule` (`backend/src/auth/`) expõe
  `POST /auth/register` (cria `Company` + primeiro `User` com `role: ADMIN` e todos os módulos —
  ver pendência de cobrança logo abaixo), `POST /auth/login`, `POST /auth/refresh`,
  `POST /auth/logout`, `GET /auth/me` e `PATCH /auth/me/password`; `register`/`login`/`refresh`/
  `me/password` têm rate limiting (`ThrottlerGuard`) — `register` e `me/password` em 5 e 10
  requisições/15min por IP respectivamente, `refresh` em 60/15min por IP (mais generoso de
  propósito: é chamado a cada carregamento de página via `restoreSession()`, e um limite de 5
  derrubava sessões válidas de usuários legítimos — fix pós-revisão final, 13/09/2026), e `login` com
  **dois** throttlers em paralelo: o de sempre por IP (5/15min) e um novo por e-mail apenas
  (`login-email`, 5/15min, sem IP na chave — ver `backend/src/auth/login-throttle.util.ts`), pra
  fechar a lacuna de um atacante rotacionando IPs pra forçar a senha de UM e-mail conhecido sem
  nunca estourar o limite por IP. Sessão é access token JWT de vida curta (15min,
  devolvido no corpo da resposta, guardado só em memória no frontend — nunca `localStorage`/
  `sessionStorage`) + refresh token rotativo (30 dias, hash persistido em `RefreshToken`, valor
  puro só em cookie `HttpOnly; Secure; SameSite=Strict; Path=/auth`), com detecção de reuso: um
  refresh token já trocado (`replacedByTokenId` setado) sendo reapresentado revoga a família
  inteira de tokens daquele usuário. `UsersModule` (`backend/src/users/`) cobre os logins da
  empresa (`GET/POST /companies/me/users`, `PATCH .../block|unblock`) — cada `Company` tem
  `planTier` (`BASICO`/`PRO`/`EMPRESARIAL`) e `maxEmployeeLogins` (10/50/999999); criar um novo
  login com `role: EMPLOYEE` conta só logins `EMPLOYEE` ativos contra esse teto (logins `ADMIN` não
  contam) e rejeita com `403` ao estourar. **Não existe (nem deve existir) rota HTTP pra uma empresa
  mudar o próprio plano** — havia `PATCH /companies/me/plan` gated só por `@Roles('ADMIN')`, o que
  permitia o próprio admin da empresa subir seu teto de plano de graça; removido na rodada de fixes
  pós-revisão final (13/09/2026). Até existir cobrança/pagamento de verdade, mudar o plano de uma
  empresa é uma operação manual no banco (`UPDATE "Company" SET "planTier" = ..., "maxEmployeeLogins" = ...`).
  `User.employeeId` é `@unique` — um funcionário nunca pode ter dois logins. `CompanyContextService`
  (`backend/src/company/company-context.service.ts`) deixou de ser um stub fixo: agora é
  `@Injectable({ scope: Scope.REQUEST })` e lê `companyId` de `req.user` (populado pelo
  `JwtAuthGuard` a partir do JWT, nunca de um campo enviado pelo cliente) — toda rota de RH/
  Clientes/Financeiro continua chamando `getCurrentCompanyId()` sem saber que a implementação
  mudou. Essa mudança pra request-scoped teve uma consequência arquitetural: serviços chamados
  fora de uma requisição HTTP (o `BillingSchedulerService`, disparado por `@Cron`/
  `OnApplicationBootstrap`) não podem injetar um serviço request-scoped, então a lógica de geração
  de cobrança em lote foi extraída para singletons sem dependência de request (ver
  `SubscriptionsBillingService`/`EmployeeRecurringPaymentsBillingService`, que não injetam
  `CompanyContextService` — cobrem todas as empresas de uma vez em cada execução, ver seção de
  Cobrança automática abaixo).
  No frontend, `src/lib/auth.ts` guarda o access token em uma variável de módulo (nunca storage),
  `src/components/RequireAuth.tsx` protege todas as rotas sob `/app` (e força a troca de senha
  temporária antes de liberar o app — ver `mustChangePassword` abaixo), e a sidebar em
  `src/layouts/AppLayout.tsx` é module-gated: só mostra os links dos módulos presentes em
  `user.modules` (o mesmo array armazenado em `User.modules`). **`modules`/`role`/`email` são
  definidos uma única vez na criação do login e não são editáveis depois** — não existe rota
  `PATCH` para editar um login existente (`UsersController` só tem GET/POST/block/unblock) nem fluxo
  de edição em `src/pages/app/UsersManagement.tsx`; é uma limitação conhecida, não um bug (mudar
  módulos/papel de um login hoje exige bloqueá-lo e criar um novo).
  **Pendência explícita, com o mesmo destaque das outras pendências desta seção: `modules` é
  aplicado hoje só como filtro de UI (a sidebar não mostra o link) — nenhum guard no backend
  confere `modules` antes de servir dado nenhum** (a única exceção, adicionada na rodada de fixes
  pós-revisão final de 13/09/2026, é a checagem pontual em `GET /employees/:id` — ver
  `EmployeesController.findOne`). Um usuário autenticado que souber ou adivinhar a URL de um módulo
  que não tem consegue carregar aquela página e os dados reais dela, **desde que pertença à mesma
  empresa** — isso nunca é um vazamento cross-tenant, o isolamento por empresa do
  `CompanyContextService` é completamente independente dessa lacuna e não é afetado por ela. É uma
  limitação explícita e deliberadamente adiada, não um esquecimento silencioso.
  **Pendência explícita, com o mesmo destaque das outras pendências desta seção:
  `POST /auth/register` não tem nenhum gate de cobrança/pagamento atrás — qualquer pessoa pode criar
  uma empresa nova de graça hoje.** Isso é uma decisão deliberada da
  spec desta etapa (o objetivo era ter autenticação/multi-tenant reais primeiro), não um
  esquecimento — mas precisa ser endereçada antes de expor o registro publicamente em produção.
  Também fora do escopo, deliberadamente: recuperação de senha por e-mail e MFA.
  **Login criado pelo admin força troca de senha (`mustChangePassword`, fix pós-revisão final,
  13/09/2026):** `User.mustChangePassword` nasce `true` só quando `UsersService.create()` gera a
  senha temporária (nunca em `POST /auth/register`, onde o próprio usuário escolhe a senha);
  `AuthService.changePassword()` limpa a flag. `GET /auth/me` e o `user` devolvido por
  `login()`/`register()` incluem o campo; `RequireAuth.tsx` mostra
  `src/components/ForcedPasswordChange.tsx` no lugar do app inteiro enquanto ele for `true`.
  **Validação de boot de `JWT_ACCESS_SECRET` (fix pós-revisão final, 13/09/2026):**
  `backend/.env.example` sempre trouxe `JWT_ACCESS_SECRET=troque-por-um-valor-aleatorio-longo-em-producao`
  como valor literal, e nem `AuthService.signAccessToken` nem `JwtStrategy` validavam esse valor —
  se o placeholder chegasse a rodar em qualquer ambiente real (ex.: `cp .env.example .env` sem
  trocar essa linha), o backend subia normalmente com um segredo de assinatura HMAC-SHA256 público
  (está no repositório), permitindo forjar um JWT válido de `role: 'ADMIN'` de qualquer empresa —
  derrubando por completo o isolamento multi-tenant. Isso **agora tem checagem ativa**, não só
  documentação da lacuna: `validateJwtSecret()` (`backend/src/common/jwt-secret.util.ts`) roda no
  início de `bootstrap()` (`backend/src/main.ts`), antes de `app.listen()`, e lança (impedindo o
  boot) se `JWT_ACCESS_SECRET` estiver ausente/vazio, tiver menos de 32 caracteres, ou for igual a
  (ou começar com `troque-por-`) o placeholder — com mensagem explicando o que corrigir e como
  gerar um valor real (`openssl rand -hex 32`). Testado com unit tests
  (`backend/src/common/jwt-secret.util.spec.ts`) e verificação manual (placeholder → boot falha com
  a mensagem; segredo real → boot normal).
  Ver `[[DECISOES-TECNICAS]]`, seção "Autenticação real (auth-multitenant, Task 12, 13/09/2026)" e a
  seção de fixes pós-revisão final logo depois dela, para o detalhe completo (incluindo o histórico
  do stub de empresa única que essa implementação substituiu, antes descrito na seção 8).
- **Férias — sem cálculo de saldo, com teto flat de 30 dias (decisão revertida em 11/09/2026):** o
  projeto não tem, e nunca teve no escopo pretendido, o conceito de "saldo de férias". A calculadora
  de saldo/dias/adicional de 1/3 (`VacationCalculationService`, que existiu por um curto período)
  foi **removida por completo**, junto dos endpoints `GET .../vacation/status` e
  `POST .../vacation/simulate` e das colunas `VacationSchedule.acquisitivePeriodStart`/
  `acquisitivePeriodEnd` (dropadas via migration). Agendar férias hoje é: escolher um período
  (`POST /employees/:id/vacation/schedule`), o backend confirma que não sobrepõe outro período já
  agendado (férias **ou** afastamento, ver abaixo) do mesmo funcionário, confirma que a soma de
  `daysCount` de todos os períodos de férias não-cancelados do funcionário + o novo pedido não
  passa de **30 dias** (teto fixo, não é cálculo de acúmulo/proporcionalidade) e salva. O teto pode
  ser ignorado enviando `exceptionAuthorized: true` no corpo do pedido — sem persistir nada no
  funcionário, é uma autorização pontual por agendamento (frontend expõe isso como um checkbox que
  só aparece depois de um erro de limite excedido). A única regra que sobrevive da versão anterior é
  de elegibilidade, não de cálculo: só `contractType = CLT` pode agendar férias (outros vínculos
  recebem `422` explícito) — é uma regra trabalhista, independente de qualquer cálculo de dias. Ver
  `[[DECISOES-TECNICAS]]` seção 8 para o histórico completo da decisão original e da reversão.
- **Afastamento (`LeavesModule`, novo em 11/09/2026):** trilha separada de agendamento de período,
  mesma mecânica de férias (data início/fim, sem sobreposição), mas **sem** a regra de CLT e **sem**
  teto de dias — disponível para qualquer `contractType`. Tem um campo livre opcional `reason`
  (motivo, texto livre, sem lista fixa). A checagem de sobreposição é cruzada com férias nos dois
  sentidos: um funcionário não pode ter férias e afastamento em períodos que se sobrepõem, não
  importa qual dos dois foi agendado primeiro. Rotas: `POST/GET /employees/:id/leave/schedule(s)`,
  `PATCH /leave-schedules/:id/cancel`. Ver `[[DECISOES-TECNICAS]]` seção 8.6.
- **Frontend de RH integrado ao backend real:** `src/pages/app/Roles.tsx`, `EmployeesList.tsx`,
  `EmployeeForm.tsx` e `src/components/FinanceAndVacationModal.tsx` consomem o backend de verdade —
  mesmo padrão já usado em Clientes/`ClientsList.tsx`: tipos brutos `Api*` → funções `map*` →
  tipos de UI → funções assíncronas (`listRoles`, `createEmployee`, `getVacationStatus`, etc.) em
  `src/lib/api.ts`. Mudanças de comportamento notáveis: "excluir" cargo/funcionário virou
  inativação lógica (nunca `DELETE`); o cargo do funcionário deixou de ser texto livre e virou uma
  FK real (`roleId`) resolvida contra `GET /roles`/`GET /roles/active`. Ver `[[Roles]]`,
  `[[EmployeesList]]`, `[[EmployeeForm]]` e `[[FinanceAndVacationModal]]` no vault para o detalhe
  de cada tela.
- **Ações de reversão pela UI (11/09/2026):** "Desfazer" em pagamento marcado como pago
  (`PATCH .../unpay`, recarrega a lista em vez de adivinhar o novo status — pode voltar como
  "Atrasado", não só "Pendente"); "Excluir" numa recorrência de pagamento ativa
  (`DELETE /employee-recurring-payments/:id`, exclusão física real — segura porque
  `EmployeePayment.recurringPaymentId` é `onDelete: SetNull`, preservando o histórico de cobranças
  já geradas mesmo depois de excluir a recorrência; confirmação em duas etapas na UI, nunca
  `window.confirm()`); "Cancelar" num período de férias/afastamento agendado
  (`PATCH .../vacation-schedules|leave-schedules/:id/cancel`, exibido só quando o status permite —
  `scheduled`/`approved` — espelhando a própria regra do backend).
- Outras pendências conhecidas (ver `[[DECISOES-TECNICAS]]` seção 8): sem histórico de mudança de
  cargo (só o `roleId` atual é rastreado); checagem de CPF único é TOCTOU (não captura violação de
  constraint); `EmployeeRecurringPaymentsService.generateCharge` só verifica o status do
  funcionário, não o da própria recorrência.

**Exclusão de cliente é sempre lógica, nunca física:** `PATCH /clients/:id/deactivate` marca o
cliente como `INACTIVE` mas nunca apaga o registro nem seus lançamentos. O flag
`Client.includeInRevenueReport` (independente de `status`) decide se os lançamentos desse cliente
continuam somando no relatório financeiro (`GET /reports/financial-summary`) — é obrigatório no
body da desativação. Um cliente inativo mantido no relatório (`includeInRevenueReport=true`)
continua aparecendo na listagem padrão do frontend (`GET /clients?excludeTrashed=true`), com selo
"Inativo" e botão "Reativar Cliente" — só quem vai pra lixeira some da listagem. Detalhes
completos em `[[DECISOES-TECNICAS]]`, `[[BANCO-DE-DADOS]]` e `[[API]]` no vault.

**Lixeira de clientes:** clientes desativados com `includeInRevenueReport=false` entram numa
lixeira e são purgados fisicamente após 30 dias (`PATCH /clients/:id/restore`,
`GET /clients/trash`); detalhes completos em `[[DECISOES-TECNICAS]]` no vault.

**Cobrança automática recorrente (`BillingModule`):** assinaturas de clientes (`Subscription`,
status `ACTIVE`) e recorrências de pagamento de funcionário (`EmployeeRecurringPayment`, status
`ACTIVE`) agora geram sua cobrança do mês sozinhas, sem precisar de nenhum clique manual —
`SubscriptionsService.generateDueCharges()` e
`EmployeeRecurringPaymentsService.generateDueCharges()` buscam quem já venceu no mês corrente e
ainda não tem `Receivable`/`EmployeePayment` daquele `referenceYear`/`referenceMonth`, e chamam o
`generateCharge()` já existente (nenhuma lógica de criação de cobrança é duplicada).
`BillingSchedulerService` (`backend/src/billing/`) dispara as duas checagens via
`@Cron(CronExpression.EVERY_DAY_AT_3AM)` (mesmo horário do cron de purga da lixeira) **e** uma vez
via `OnApplicationBootstrap`, pra auto-curar uma janela de cron perdida assim que o processo sobe;
cada chamada é isolada em try/catch próprio (falha em uma nunca derruba a outra nem o processo). O
botão manual "Gerar Fatura do Mês" **continua existindo** como ação complementar (gera na hora, sem
esperar o cron/boot). Pendências conhecidas, a resolver antes/quando os itens abaixo se tornarem
relevantes:
- ~~`Employee.salaryRecurrenceEnabled` não era lido por essa automação~~ — **resolvido**:
  `generateDueCharges()` do lado de funcionário agora exige `salaryRecurrenceEnabled: true` além do
  `status: 'ACTIVE'` da recorrência.
- ~~O scheduler cobra só uma empresa por execução~~ — **resolvido em duas etapas**. Primeiro
  (13/09/2026, efeito colateral da autenticação real): `CompanyContextService` virou
  `@Injectable({ scope: Scope.REQUEST })` (ver seção de RH acima), e um provider request-scoped não
  pode ser injetado num serviço disparado por `@Cron`/`OnApplicationBootstrap` (não há requisição
  HTTP em voo). A lógica de geração em lote foi por isso extraída para `SubscriptionsBillingService`/
  `EmployeeRecurringPaymentsBillingService` (`backend/src/subscriptions/` e
  `backend/src/employee-recurring-payments/`), singletons sem nenhuma dependência de
  `CompanyContextService`/request. Naquela etapa elas buscavam `Subscription`/
  `EmployeeRecurringPayment` vencidos em todas as empresas **de uma vez só** (a FK até
  `Client`/`Employee` bastava pra isolar os dados certos por empresa na ausência de RLS).
  **Segundo (13/09/2026, backstop de RLS — ver `[[DECISOES-TECNICAS]]`):** com Row-Level Security
  habilitado a nível de banco em todas as tabelas de tenant (incluindo `Subscription`/`Receivable`/
  `EmployeeRecurringPayment`/`EmployeePayment`, todas agora com `FORCE ROW LEVEL SECURITY`), uma
  query sem nenhum contexto de tenant ativo passou a devolver **zero linhas silenciosamente** (nem
  erro, nem todas as linhas — esse é o comportamento seguro por padrão da política de RLS) em vez de
  "todas as empresas de uma vez". `BillingSchedulerService.runCatchUp` foi por isso reescrito pra
  buscar todas as `Company` (tabela sem RLS, é a raiz do isolamento — não uma tabela de tenant) e
  chamar as duas `generateDueCharges()` **uma vez por empresa**, cada chamada envolvida em
  `runWithTenant(company.id, ...)` (ver `backend/src/prisma/tenant-context.ts`), que estabelece o
  `set_config('app.current_company_id', ...)` transacional que a política de RLS exige. Isso não é
  uma regressão de performance sem motivo: é estritamente **mais correto** que a versão de uma
  query só — cada escrita gerada (`Receivable`/`EmployeePayment`) agora é validada pelo `WITH CHECK`
  da política de RLS sob o contexto da própria empresa, não só por um filtro de aplicação, fechando
  exatamente a classe de bug (query sem filtro de `companyId`) que motivou o backstop de RLS em
  primeiro lugar. Mesma correção replicada em `ClientTrashService.purgeExpiredTrashCron` (mesmo
  cron das 3h), que tinha o mesmo problema: rodava sem contexto de tenant algum e, pós-RLS, virou um
  no-op silencioso permanente (`deleteMany` retornando `count: 0` sem erro) — a purga de 30 dias da
  lixeira de clientes parou de rodar de verdade até esse fix, sem nenhum log de erro indicando isso
  (só loga quando `count > 0`). Corrigido com o mesmo padrão: itera todas as `Company` e chama
  `purgeExpiredTrash()` uma vez por empresa dentro de `runWithTenant(...)`.
- A checagem de bootstrap roda **de forma síncrona antes do app aceitar tráfego HTTP** (é
  `await`ada, não fire-and-forget); com uma base muito grande de recorrências isso pode atrasar o
  boot — tradeoff aceito por ora (mantém os testes simples), fica como otimização futura.
- **Não há catch-up retroativo de múltiplos meses**: se o backend ficar fora do ar tempo suficiente
  pra um mês inteiro passar sem checagem, aquela cobrança daquele mês nunca é gerada
  automaticamente (mesma situação de um humano esquecer de clicar no botão manual, antes desta
  feature existir) — só o mês corrente é checado em cada execução.
- O fix de `dueDay` 29-31 (tratar o último dia do mês como se fosse dia 31) é um **alargamento
  deliberado**, não só correção de bug: no último dia de fevereiro sem dia 29, uma recorrência com
  `dueDay: 29` é cobrada um dia "adiantada" em relação ao dia configurado, porque não existe
  catch-up retroativo pra compensar depois — tradeoff correto dado o design sem catch-up, mas vale
  registrar como decisão, não acidente.
- Nenhum teste **automatizado** de ponta a ponta exercita os novos formatos de query Prisma contra
  um PostgreSQL real (todos os testes usam mocks) — mas uma verificação manual pontual foi feita em
  11/09/2026 (reiniciar o backend de verdade com uma assinatura vencida gerou a fatura corretamente,
  sem duplicar num segundo restart); ver o incidente abaixo.

**Incidente descoberto durante essa verificação manual (11/09/2026):** o banco real estava com
`Client.includeInRevenueReport`/`deactivatedAt` e `Receivable.subscriptionId`/`referenceYear`/
`referenceMonth` apagados silenciosamente por um `db push --accept-data-loss` do início do módulo
de RH (só a tabela `Company` daquele incidente tinha sido corrigida na hora — o resto ficou
invisível pra `prisma migrate status`, que só confere a tabela de controle de migrations, não a
estrutura real). Sem perda de dado real (verificado, não presumido); corrigido com duas migrations
novas. Também foi encontrado e corrigido um bug pré-existente em `common/date.util.ts`
(`startOfToday()` usava hora local em vez de UTC). **Pendência que ficou de propósito sem mexer:**
`generateCharge()` (em `SubscriptionsService`/`EmployeeRecurringPaymentsService`) tem o mesmo padrão
de bug de hora local — não foi tocado por estar fora do escopo desta etapa e já ser código
financeiro em uso; precisa de revisão dedicada. Detalhes completos em `[[DECISOES-TECNICAS]]`.

Detalhes completos (decisão de duas camadas cron+bootstrap, motivo de não ter catch-up retroativo,
raciocínio de "uma empresa por execução") em `[[DECISOES-TECNICAS]]`; mapa de módulos em
`[[ARQUITETURA]]`; nota sobre o comportamento (sem endpoint novo) em `[[API]]`.

**Controle de Ponto (`TimeClockModule`/`TimeAdjustmentsModule`/`TimeJustificationsModule`/
`WorkSchedulesModule`/`WorkLocationsModule`/`TimeTrackingSettingsModule`/`HolidaysModule`/
`FilesModule`, implementado em 14/09/2026):** módulo novo, cobrindo batida de ponto, apuração,
solicitações de ajuste, justificativas/atestados e configuração administrativa. Spec em
`docs/superpowers/specs/2026-09-13-time-tracking-design.md`, plano em
`docs/superpowers/plans/2026-09-13-time-tracking.md`.
- **Modelo de evento flexível, nunca posicional:** `TimeEvent` tem um `type`
  (`CLOCK_IN`/`BREAK_START`/`BREAK_END`/`CLOCK_OUT`/`EXTRA_IN`/`EXTRA_OUT`) em vez de colunas fixas
  — a "próxima marcação permitida" é decidida por uma máquina de estado real
  (`time-sequence.util.ts`: `computeOpenState`/`getNextAllowedType`/`validateTransition`, andando
  por todo o histórico de eventos em ordem) que corrige o bug do mock antigo do frontend
  (`punchSequence[array.length]`, um índice posicional que quebrava silenciosamente com qualquer
  marcação faltando). `TimeEvent` é imutável por design de aplicação — nenhuma rota
  `PATCH`/`DELETE` existe pra ele em lugar nenhum; toda correção passa pelo fluxo de
  `TimeAdjustmentRequest` (ver abaixo), que sempre CRIA um novo evento, nunca altera o original.
  Hora sempre `serverRecordedAt` (server-authoritative); `deviceReportedAt` existe só pra
  auditoria, nunca é fonte de verdade.
- **Hierarquia de superior:** `Employee.managerId` (auto-relação, `onDelete: SetNull`) — uma
  autorização por dado, ortogonal a `role`/`modules`, resolvida por
  `TimeManagementAuthService` (`backend/src/time-management/`), o único lugar do projeto que
  decide "quem pode administrar o ponto de quem": `role === 'ADMIN'` da mesma empresa sempre pode;
  um login `EMPLOYEE` cujo `Employee` é o `managerId` **direto** de outro pode administrar só esse
  subordinado (sem propagação em cadeia — gerente do gerente não herda automaticamente). Todo
  módulo administrativo injeta este serviço em vez de reimplementar a checagem; 404 (nunca 403)
  quando nega, mesmo padrão já usado no resto do backend. Rotas administrativas exigem o módulo
  `RH` além de `canManage` — as de auto-atendimento (bater o próprio ponto, ver/cancelar a própria
  solicitação) não exigem módulo nenhum, mesmo espírito de `/auth/me`.
  **Incidente encontrado e corrigido durante a implementação:** `canManage()`'s bypass de ADMIN
  originalmente checava só `role`, nunca se o funcionário-alvo pertencia à MESMA empresa do ADMIN —
  todo outro chamador (`approve`/`reject`) já filtrava o alvo por `companyId` numa consulta
  anterior, então a lacuna nunca tinha sido exercitada até a correção proativa
  (`POST /employees/:employeeId/time-events/correct`), que passa um `employeeId` cru direto pra
  `assertCanManage`. Reproduzido ao vivo: um ADMIN de qualquer empresa conseguia criar
  `TimeEvent`/`TimeCorrection` reais contra um funcionário de OUTRA empresa. Corrigido buscando o
  alvo escopado por empresa ANTES de checar o role — fecha a lacuna pra todo chamador atual e
  futuro, não só esse. Ver `[[DECISOES-TECNICAS]]` seção "Controle de Ponto" para o detalhe
  completo (evidência, chamadas antes/depois do fix).
- **Admin sem `Employee` (fundador via `POST /auth/register`, que nunca cria um `Employee`):**
  `PATCH /auth/me/employee-link` deixa o próprio login se vincular a um `Employee` já existente
  (criado normalmente via "Novo Funcionário"), uma única vez — login que já tem `employeeId` é
  rejeitado. Até se vincular, o login simplesmente não bate ponto (frontend mostra um estado vazio
  explicando isso, nunca um erro genérico).
- **Geofencing opcional:** `WorkLocation` (nome, lat/lng, raio) por empresa — distância sempre
  calculada no servidor (Haversine, `geo-distance.util.ts`), nunca confiando num "dentro da área"
  vindo do cliente. Sem nenhum `WorkLocation` configurado, localização nunca bloqueia nem valida
  nada. Fora da área nunca rejeita a marcação — grava como `PENDING_REVIEW`, pra análise humana.
- **Upload de arquivo — primeira infra do projeto** (`FilesModule`, local em
  `backend/storage/attachments/`, gitignored, sem Docker/nuvem): arquivo salvo com nome UUID
  aleatório (nunca o nome original), metadados de imagem removidos (`sharp`), MIME real conferido
  por assinatura binária — `detectRealMimeType()` (`files/file-signature.util.ts`), um checker
  dependency-free escopado só a PDF/JPEG/PNG. **Não usa o pacote `file-type`**: a única versão
  compatível com CJS (`16.5.4`) carrega uma DoS não corrigida
  (`GHSA-5v7r-6r5c-r473`, parser ASF) sem fix disponível em toda a linha 16.x — descoberto e
  substituído durante a própria implementação, antes de qualquer rota de rede expor o caminho.
  Download via `GET /file-assets/:id?token=` exige um token HMAC-SHA256 curto (5min, reaproveita
  `JWT_ACCESS_SECRET`) — toda resposta que referencia um anexo/foto já devolve um campo
  `downloadUrl` pronto (path relativo com o token embutido, `buildFileDownloadPath()`), o frontend
  nunca constrói um token sozinho (`getFileDownloadUrl()` em `src/lib/api.ts` só prefixa a origem
  da API). **Pendência documentada:** essa geração de `downloadUrl` só foi cabeada pra
  `TimeJustification` e (depois) `TimeEvent`/`TimeAdjustmentRequest` — nenhuma delas ficou sem, mas
  vale conferir de novo se um endpoint novo passar a devolver um asset sem esse campo.
- **Calendário de feriados** (`HolidaysModule`) — nacional + móvel via algoritmo de Páscoa (Gauss),
  estadual (`STATE_HOLIDAYS`, todas as 27 UFs, cada uma com fonte/confiança documentada no próprio
  código) e customizado por empresa. **Mesmo aviso já usado noutras pendências do projeto: é uma
  base de referência, pesquisada e citada, não uma fonte oficial autoatualizável** — precisa de
  revisão periódica, e feriados municipais não são semeados (empresa cadastra por cima). Um dia
  feriado zera `expectedMinutes` na apuração, nunca conta falta.
- **Apuração** (`TimeAttendanceCalculationService`) — pareia eventos por TIPO em sequência (nunca
  posição), sem nenhuma regra de CLT embutida (sem multiplicador de hora extra, sem adicional
  noturno automático — mecanismo configurável, nenhum valor aplicado por padrão). Janela do dia
  civil é **consciente do fuso da empresa** (`Company.timezone`, `localMidnightUtc()` via
  `Intl.DateTimeFormat`), não UTC bruto — sem isso, batidas entre 21h-23h59 (horário de Brasília)
  cairiam no dia civil errado. Turno atravessando a meia-noite usa um buffer técnico de busca de
  +48h (não uma regra trabalhista) que credita cada par ao dia em que ABRIU, não em que fechou —
  corrige um bug real da versão inicial do plano, que não conseguia estruturalmente encontrar o
  fechamento de um turno noturno. `WorkSchedule.weekDays` filtra o dia da semana esperado (sem
  isso, um fim de semana dentro do período de vigência de uma escala seria contado como esperado).
- **Ajustes** (`TimeAdjustmentRequest`/`TimeCorrection`) — aprovar sempre cria um `TimeEvent` NOVO
  (`source: ADMIN_MANUAL`) numa transação (`runTenantInteractiveTransaction`) junto com um
  `TimeCorrection` auditável (valor original + corrigido, quem pediu, quem revisou, motivo) — o
  registro original nunca é alterado/apagado. Uma solicitação já processada nunca é reprocessada
  (guard de status). Correção proativa (sem pedido prévio) reaproveita o MESMO `approve()`, criando
  a solicitação já `PENDING` e aprovando na sequência — nunca uma escrita "silenciosa" separada.
- **Justificativas e atestados** (`TimeJustification`) — `MEDICAL_CERTIFICATE` exige anexo; demais
  tipos, opcional. Aprovar/rejeitar só muda status/revisão — **nunca** cria/altera um `TimeEvent`
  (diferente de ajuste, de propósito: uma justificativa aprovada é só um registro analisado, não
  corrige nada automaticamente). Atestado tratado como dado sensível de saúde (LGPD) — sem nenhum
  campo de CID/diagnóstico no modelo, `description` é sempre texto livre não-estruturado.
- **Frontend:** `[[TimeTracking]]` (`/app/ponto`, visão do funcionário) e `[[TimeTrackingAdmin]]`
  (`/app/ponto-administracao`, nova, gated por módulo `RH` sem bypass de `ADMIN`) consomem o
  backend real — ver as notas do vault pra detalhe de cada tela.
- **Pendências documentadas** (mesmo destaque das outras pendências desta seção):
  reconhecimento facial/biometria/PIN/dispositivo pré-autorizado — avaliados, não implementados;
  política de retenção/exclusão automática de fotos e atestados — sem prazo definido; hierarquia de
  superior com múltiplos níveis (skip-level) — só o superior direto administra, mitigado por
  `ADMIN` sempre ter visão total.
- **Corrigidos numa revisão de pendências pós-final (14/09/2026), a pedido do usuário — nenhum
  destes segue em aberto:**
  1. `FilesService.upload()` deixava vazar um `500` bruto quando `sharp` não conseguia decodificar
     um buffer que tinha passado pela checagem de assinatura mas não era uma imagem válida de
     verdade — agora um `400` limpo (`try/catch` em volta da chamada ao `sharp`).
  2. A aba de Correção Proativa da tela administrativa listava todo funcionário da empresa no
     seletor, mesmo pra um superior que só consegue corrigir seus subordinados diretos (o backend
     já bloqueava com `404`, mas o seletor confundia). Nova
     `TimeManagementAuthService.listManageableEmployees()` (reaproveita
     `getManageableEmployeeIds()`) + `GET /time-management/manageable-employees` — o seletor agora
     mostra só quem o login atual de fato consegue corrigir.
  3. O bloqueio de marcação duplicada (`time-clock.service.ts`, janela de 10s) era
     `findFirst`-então-`create` sem nenhuma trava real — uma corrida de milissegundos entre duas
     requisições quase simultâneas do mesmo funcionário podia deixar passar as duas. Corrigido com
     um `pg_advisory_xact_lock` do Postgres escopado por funcionário, dentro de
     `runTenantInteractiveTransaction`. Verificado ao vivo: 5 requisições verdadeiramente
     simultâneas (disparadas em paralelo) contra o mesmo funcionário — exatamente 1 criou o evento,
     confirmado direto no banco.
  4. `npm run test:e2e` não rodava por falta de configuração (o banco `quickflow_test` já existia
     localmente, mas estava com migrations atrasadas e nada apontava o comando pra ele). Aplicadas
     as migrations faltantes, criado `backend/.env.test` (gitignored, mesmo padrão de `.env`) +
     `.env.test.example`, e o script `test:e2e` agora usa `node --env-file=.env.test` (sem
     dependência nova). Verificado rodando duas vezes seguidas sem colisão: 9/9 testes, 2 suites.
  **Verificação interativa em navegador real: feita (14/09/2026), depois de reconectar a ferramenta
  de automação de navegador nesta sessão.** Todo o ciclo do funcionário (`[[TimeTracking]]`: status
  → confirmação → localização → marcação → detalhe de marcação → solicitação de ajuste → cancelar) e
  da administração (`[[TimeTrackingAdmin]]`: todas as 5 abas, aprovar/rejeitar justificativa e
  solicitação de ajuste com motivo obrigatório, correção proativa completa, salvar configurações)
  foi clicado de verdade, não apenas testado por API. Essa verificação encontrou e corrigiu **dois
  bugs reais que toda a bateria anterior de testes via `curl`/Postman nunca teria pego**, porque
  ambos só se manifestam quando o próprio navegador monta a requisição:
  1. Todo link de anexo/foto (`downloadUrl`) era renderizado como `<a href>`/`<img src>` simples —
     mas `GET /file-assets/:id?token=` exige um Bearer JWT normal **além** do token HMAC (design
     deliberado da Task 2), e o navegador nunca anexa `Authorization` numa navegação por elemento.
     Todo clique real em "Ver" ou toda foto de marcação dava `401`. Corrigido com
     `fetchProtectedFileObjectUrl()` (fetch autenticado + `URL.createObjectURL`) em `src/lib/api.ts`.
  2. Salvar as configurações da empresa (aba Configuração, botão "Salvar") sempre falhava com `400`
     — `mapTimeTrackingSettings()` espalhava (`{ ...s }`) a resposta bruta do backend, que carrega
     `id`/`companyId`/`createdAt`/`updatedAt` em tempo de execução mesmo sem esses campos nas
     interfaces TypeScript, e esse mesmo objeto era reenviado no `PATCH`, rejeitado pela validação
     de whitelist do Nest. Corrigido construindo o objeto explicitamente com só os 5 campos.
  Ambos reproduzidos ao vivo, corrigidos, e re-verificados ao vivo (200 em vez de 401/400) antes de
  seguir. Um terceiro bug menor, também encontrado nessa verificação e corrigido a pedido do
  usuário: o `useEffect` que carrega as marcações existentes na aba de Correção Proativa não
  reexecutava após um envio bem-sucedido para o mesmo funcionário/data, mostrando "nenhuma marcação
  encontrada" de forma obsoleta até a página ser recarregada (o dado em si sempre esteve correto) —
  corrigido com um `refreshKey` incluído na dependência do efeito.
- **Revisão final do módulo inteiro (14/09/2026):** feita diretamente (não por um agente separado,
  indisponível por limite de uso na semana), relendo a spec inteira ("Autorização e isolamento" e
  "Segurança e LGPD") palavra por palavra contra o código já mesclado — não só contra o texto de
  cada task individual, que é exatamente o tipo de lacuna que só aparece numa revisão de ponta a
  ponta. Encontrou:
  1. **`POST /time-clock/punches` não tinha NENHUM rate limit**, apesar da spec exigir isso
     explicitamente ("aplicado ao endpoint de criação de evento"). `ThrottlerGuard` neste projeto
     nunca é global — cada rota que precisa dele se registra explicitamente (mesmo padrão do
     `AuthController`) — e o plano de implementação, ao ser redigido a partir da spec, simplesmente
     nunca mencionou "rate limit" em lugar nenhum, então nenhuma task chegou a receber essa
     instrução. **Corrigido**: `@UseGuards(ThrottlerGuard)` + `@Throttle({default: {limit: 30, ttl:
     900_000}})` em `time-clock.controller.ts`. Verificado ao vivo: 33 requisições rápidas contra
     uma empresa de teste real — as primeiras 30 retornam `400` (bloqueadas pela regra de negócio de
     10s entre marcações, não pelo rate limit), a partir da 31ª retornam `429`.
  2. **Log de auditoria ausente — implementado a pedido do usuário, mesma revisão.** A spec também
     exige uma auditoria de ações relevantes (marcação criada, tentativa duplicada rejeitada, fora
     de área, falha de foto/localização exigida, solicitação/aprovação/rejeição/correção, envio/
     acesso a atestado) "registrando só metadados, nunca conteúdo de imagem/atestado no log."
     Confirmado por inspeção direta: não existia nenhum modelo `AuditLog` em lugar nenhum do
     backend. Vários itens já são cobertos implicitamente pelos próprios registros existentes (um
     `TimeEvent`/`TimeAdjustmentRequest` criado já É seu próprio registro de "criado"), então o novo
     modelo `AuditLog` (`backend/src/audit-log/`, RLS igual às outras tabelas do módulo) cobre
     deliberadamente só os 3 pontos que não deixavam rastro nenhum: tentativa de marcação duplicada
     rejeitada (`PUNCH_DUPLICATE_REJECTED`), marcação rejeitada por falta de foto/localização
     exigida (`PUNCH_VALIDATION_REJECTED`), e acesso a um anexo/atestado via
     `GET /file-assets/:id` (`FILE_ACCESSED`, nunca registra conteúdo do arquivo). Não duplica log
     das ações que já têm seu próprio registro durável, pra nunca manter dois registros divergentes
     do mesmo evento. `AuditLogService.record()` nunca lança — uma falha ao gravar o log nunca pode
     derrubar a ação de negócio que está sendo registrada. Verificado ao vivo contra o banco real:
     uma tentativa duplicada, uma marcação sem foto obrigatória, e um download real de anexo cada um
     gerou a linha `AuditLog` esperada.
  Ver `[[DECISOES-TECNICAS]]` seção "Controle de Ponto" para o detalhe completo (incluindo
  todas as decisões, o incidente de segurança do `canManage()`, e os quatro achados acima).

**Configuração de Ponto Escopada por Superior (`hasFullPontoAccess`, `WorkSchedule`/
`TimeTrackingSettings` em camadas, 15/09/2026):** duas lacunas do desenho original motivaram este
refinamento — cadastro de jornada não escalava (sempre um `WorkSchedule` por funcionário, mesmo
quando um time inteiro compartilha o mesmo horário) e `role: ADMIN` era um bypass absoluto dentro do
Controle de Ponto, mesmo em empresas pequenas/médias onde múltiplos logins têm `ADMIN` por
conveniência (gerentes de confiança, não só o dono). Spec completa em
`docs/superpowers/specs/2026-09-15-time-tracking-scoped-config-design.md`, plano em
`docs/superpowers/plans/2026-09-15-time-tracking-scoped-config.md` (12 tasks, todas implementadas e
revisadas individualmente).
- **`User.hasFullPontoAccess` (novo campo, `@default(true)`):** só tem efeito para `role: ADMIN` —
  não muda nada para um login `EMPLOYEE`, que já era sempre escopado ao próprio time. O bypass
  absoluto em `TimeManagementAuthService.canManage()`/`getManageableEmployeeIds()` passou de
  `if (currentUser.role === 'ADMIN') return true` para
  `if (currentUser.role === 'ADMIN' && currentUser.hasFullPontoAccess) return true` — como essas duas
  funções já eram o único lugar do projeto que decide "quem administra o ponto de quem", usado pelas
  5 abas administrativas (Inconsistências, Solicitações de Ajuste, Justificativas, Correção Proativa,
  Configuração), essa foi a única mudança necessária para propagar a restrição de forma consistente.
  Um `ADMIN` com `hasFullPontoAccess: false` passa a ser tratado, em todo o módulo, exatamente como um
  `EMPLOYEE` que gerencia gente — só seus subordinados diretos, sem nenhuma exceção por tela. Ações
  sem um funcionário-alvo para checar via `canManage()` (editar o padrão da empresa de
  `TimeTrackingSettings`/`WorkSchedule`, mutar `WorkLocation`, o próprio endpoint de toggle) usam o
  novo `assertHasFullPontoAccess(user)`, síncrono (sem consulta ao banco — o dado já vem inteiro no
  JWT) e sempre `404`, nunca `403`, mesmo padrão do resto do backend.
- **`WorkSchedule` em três camadas (empresa → time → individual):** `employeeId` virou opcional e
  ganhou um `managerId` irmão (nunca os dois preenchidos ao mesmo tempo — validado na aplicação, não
  como `CHECK` de banco). Só `employeeId`: jornada individual, sobrescreve tudo (mesmo comportamento
  de sempre). Só `managerId`: "padrão do time" daquele superior, aplica-se automaticamente a todos os
  subordinados diretos sem precisar de um cadastro por pessoa. Nenhum dos dois: padrão da empresa
  inteira, cobre quem ainda não tem nada configurado por time/indivíduo. Resolução em
  `getScheduleForDate` é sempre individual → time do superior direto → empresa → nenhum
  (`expectedMinutes: 0`, "Folga", comportamento de sempre) — sem propagação em cadeia em nenhum
  passo, sempre o superior **direto**, nunca um nível acima (mesma limitação já aceita no resto do
  módulo). Criar uma linha sem `employeeId`/`managerId` sempre exige `assertHasFullPontoAccess`;
  criar com `managerId` é autoatendimento livre se for o próprio `Employee` vinculado do chamador
  configurando o próprio time, senão também exige `assertHasFullPontoAccess` (só quem tem acesso
  total monta o padrão de time de OUTRO superior em nome dele, ex.: RH ajudando a configurar).
- **`TimeTrackingSettings` em duas camadas (empresa → time), com um detalhe de índice não-óbvio:** a
  constraint de unicidade deixou de ser `companyId @unique` sozinho e virou dois **índices únicos
  parciais** feitos à mão na migration (`CREATE UNIQUE INDEX ... WHERE "managerId" IS NULL` /
  `... WHERE "managerId" IS NOT NULL`) — um `@@unique([companyId, managerId])` comum não bastaria,
  porque o Postgres trata `NULL` como nunca igual a si mesmo, então múltiplas linhas
  `managerId: NULL` da mesma empresa não violariam essa constraint. `getEffectiveSettingsForEmployee`
  espelha a mesma lógica de fallback do `WorkSchedule`, com um nível a menos (sem individual — regras
  de bater ponto nunca foram por pessoa, só por time/empresa).
- **`WorkLocation` continua só por empresa, de propósito** — geofencing é infraestrutura física, não
  faz sentido "pertencer" a um time; mutação passou de `@Roles('ADMIN')` puro para exigir
  `assertHasFullPontoAccess` explicitamente, leitura continua liberada para qualquer superior (só
  visualiza, para escolher um local ao configurar um subordinado).
- **`PATCH /companies/me/users/:id/ponto-access`** — `{ hasFullPontoAccess: boolean }`, guardado por
  `assertHasFullPontoAccess(currentUser)` (só quem já tem acesso total liga/desliga o de outro
  login), alvo precisa ser `role: ADMIN` da mesma empresa (`404`/`400` caso contrário — setar o campo
  num `EMPLOYEE` é rejeitado como pedido sem sentido, não ignorado em silêncio). **Trava do último
  admin:** antes de desligar, conta quantos logins `ADMIN` da empresa têm `hasFullPontoAccess: true`
  dentro de uma transação com `pg_advisory_xact_lock(hashtext(companyId))` — travando por EMPRESA, não
  por login-alvo, porque o invariante protegido ("pelo menos um full-access admin") é da empresa como
  um todo. Achado e corrigido ainda durante a implementação (revisão do Task 4): a versão original
  fazia `count()` e `update()` como duas queries soltas, sem trava nenhuma — duas requisições
  concorrentes desligando DOIS admins diferentes, com exatamente 2 restantes, podiam ambas ler
  `count === 2`, ambas passar o guard, e ambas escrever `false`, zerando os admins de acesso total da
  empresa (estado só recuperável editando o banco direto). Consequência não-óbvia, confirmada na
  validação final (Task 12): a checagem é sobre o total de full-access admins da empresa, não sobre
  "o alvo estava em `true` antes desta chamada" — então desligar um admin que **já está** desligado
  também recebe `400` sempre que só restar um full-access admin na empresa (mesmo que esse alvo
  específico não fosse contado); não é um bug, é o mesmo invariante sendo aplicado de forma
  consistente independente de por onde a requisição chegou.
- **Decisão explícita: flag configurável por login, não "só o fundador"** — discutida em conversa
  antes deste design: travar acesso total só ao primeiro `ADMIN` criado via `/auth/register` seria
  mais simples de implementar, mas não resolveria o caso real (empresas onde o próprio fundador quer
  restringir um gerente de confiança promovido a `ADMIN` por conveniência, sem rebaixá-lo de papel em
  nenhum outro módulo). `hasFullPontoAccess` é ortogonal a `role`/`modules` — muda só a autorização
  dentro do Controle de Ponto, nada mais.
- **Frontend:** `src/pages/app/UsersManagement.tsx` (`/app/usuarios`) ganhou o botão de toggle em
  cada linha de login `ADMIN` (`"Acesso total ao Ponto — clique para restringir ao próprio time"` /
  `"Restrito ao próprio time no Ponto — clique para dar acesso total"`), com o erro do último-admin
  surfaced no banner de erro já existente da tela, nunca engolido em silêncio.
  `src/pages/app/TimeTrackingAdmin.tsx` (Configuração) ganhou o seletor de escopo "Padrão da
  empresa"/"Minha equipe" em Regras da empresa (só aparece para quem tem `hasFullPontoAccess` **e**
  tem subordinados diretos — `hasOwnTeam`) e o seletor de nível "Empresa"/"Meu time"/"Individual" ao
  criar uma Jornada de trabalho, cada opção gated pela mesma regra do backend. Achado e corrigido
  durante a própria implementação (Task 11, review): o botão "Meu time" estava gated em
  `hasFullPontoAccess || hasOwnTeam` (deveria ser só `hasOwnTeam`) — um `ADMIN` de acesso total sem
  `Employee` vinculado (o estado comum de um fundador recém-registrado) via a opção "Meu time" mesmo
  sem ter time nenhum, e submeter criava silenciosamente um padrão de EMPRESA em vez de um padrão de
  time, contrariando o que a UI dava a entender.
  Ver `[[TimeTrackingAdmin]]`/`[[UsersManagement]]` no vault.
- **Validação de ponta a ponta (Task 12, 15/09/2026):** suíte de backend com 458 testes/49 suites
  (acima da baseline de 423 anterior a este plano — toda task acrescentou casos novos), e2e 9/9 (a
  base `quickflow_test` estava com a migration deste plano pendente — aplicada via
  `migrate deploy` antes de rodar, sem o que os 9 testes falhavam com "coluna hasFullPontoAccess não
  existe"), lint e build de backend e frontend limpos. Seguindo a recomendação da revisão do Task 8
  (uma falha real de wiring de módulo do NestJS — `WorkLocationsModule` faltando um import — havia
  sobrevivido tanto ao `nest build` quanto à suíte Jest inteira, só aparecendo num boot real), esta
  validação final incluiu um boot limpo explícito de `npm run start:dev`: grafo de módulos resolvido
  por completo, todas as rotas novas mapeadas (`/companies/me/users/:id/ponto-access`,
  `/work-schedules`, etc.), "Nest application successfully started" sem nenhum erro. Passeio manual
  de 8 passos pelo navegador de verdade (chrome-devtools), com dado real criado nesta sessão (empresa
  nova, fundador, segundo `ADMIN`, dois funcionários com hierarquia direta, um terceiro sem
  gerente) — não apenas chamadas de API cruas: criação do segundo `ADMIN` por `/app/usuarios`
  confirmando a nova coluna de toggle na tabela; desligar `hasFullPontoAccess` daquele login e
  confirmar visualmente que Correção Proativa (seletor de funcionário) e Configuração (Regras da
  empresa/Jornadas) passam a mostrar só o time restrito, sem nenhum acesso ao padrão da empresa;
  criar um padrão de time como esse admin restrito e confirmar que o "Espelho de Ponto" do
  subordinado direto (login próprio, `/app/ponto`) passou a refletir as horas esperadas da nova
  jornada num dia da semana correspondente; tentar desligar de novo o mesmo login (no-op) e desligar
  o próprio fundador (único full-access restante) e confirmar o `400` do guard aparecendo no banner de
  erro da tela, sem crash; e criar um padrão de empresa como fundador, confirmando que um terceiro
  funcionário sem gerente e sem jornada própria também passou a mostrar horas esperadas. Todos os 8
  passos confirmados com resultado real observado na tela, nenhum assumido.
- **Revogar `hasFullPontoAccess` não invalida na hora um JWT já emitido:** como `role`/`modules`, o
  flag viaja como claim do access token, então um login que acabou de ser restringido continua com
  acesso total por até 15min (até o token expirar ou o próximo `/auth/refresh`) — mesmo tradeoff de
  defasagem já documentado para os outros claims, registrado explicitamente aqui porque este campo
  existe justamente para ser desligado como restrição ao vivo; revogação imediata de verdade exigiria
  uma blocklist de tokens, deliberadamente fora de escopo.
- **Revisão final da branch inteira (15/09/2026) — achados corrigidos numa única onda:**
  (C1) `GET /time-tracking-settings?managerId=` criava a sobrescrita do time só por ser LIDO (o
  frontend chama isso ao abrir a aba), fixando o time inteiro nos defaults do *schema* em vez do
  padrão da empresa: leitura virou somente-leitura com fallback para o padrão da empresa (campo novo
  `inherited` na resposta diz ao frontend que o valor é herdado) e a primeira ESCRITA de um superior
  agora semeia a linha nova como cópia dos valores atuais da empresa.
  (C2) Frontend e backend discordavam do significado de `hasFullPontoAccess` — a coluna nasce `true`
  para toda linha, `EMPLOYEE` inclusive, e o frontend lia o booleano cru sem checar `role`, então um
  gerente `EMPLOYEE` (a persona deste plano) entrava na tela administrativa achando ter acesso total e
  tomava `404` em toda mutação; o backend passou a expor sempre o valor EFETIVO
  (`role === 'ADMIN' && flag`, ver `backend/src/auth/ponto-access.util.ts`) no JWT, em todo objeto
  `user` e na listagem de logins — a semântica da coluna no banco e a trava do último admin seguem
  inalteradas.
  (I1) `WorkSchedulesService.update()` autorizava só o tier NOVO: agora autoriza o atual **e** o
  novo, fechando o "roubo" de uma jornada que o chamador nem consegue listar.
  (I2) "tenho time próprio" no frontend vinha de `listManageableEmployees().length > 0`, que para um
  admin de acesso total é a empresa inteira — novo `GET /time-management/has-direct-reports`
  (`TimeManagementAuthService.hasDirectReports`, sempre a consulta por `managerId`, sem o bypass
  `'ALL'`).
  (I4) nenhum teste ou passeio de navegador tinha usado um login `role: EMPLOYEE` — daí o C2 ter
  passado por 12 revisões de task; a suíte ganhou um bloco dedicado a essa persona.
  Menores da mesma onda: `@Max(20MB)` em `maxAttachmentSizeBytes` (configurável por time desde este
  plano), `companyId` explícito nas três consultas de `getScheduleForDate` (defesa em profundidade
  junto do RLS) e tratamento de `P2002` no find-then-create de `TimeTrackingSettings` (os índices
  únicos são parciais, então não há `upsert` possível — a corrida relê em vez de vazar um 500).

**Isolamento Físico por Schema PostgreSQL (schema-per-tenant, Fase 1, 15-16/09/2026) — infraestrutura
pronta, mas ACHADO CRÍTICO NA VALIDAÇÃO FINAL: o roteamento de dados de verdade não funciona.** Spec em
`docs/superpowers/specs/2026-09-15-schema-per-tenant-design.md`, plano em
`docs/superpowers/plans/2026-09-15-schema-per-tenant.md` (11 tasks). Objetivo original: sair de
"isolamento só por RLS + coluna `companyId`" para "um schema PostgreSQL físico por empresa como
camada primária, com RLS mantida como backstop" — ver `[[DECISOES-TECNICAS]]` no vault pro raciocínio
completo (incluindo o trade-off de segurança de manter `Company`/`User`/`RefreshToken` centrais em vez
de resolver o tenant por subdomínio/slug antes da senha) e o achado crítico abaixo em detalhe.
- **Fase 1 vs. Fase 2:** Fase 1 (este plano) é só aditiva — toda empresa **nova** nasceria no modelo
  físico novo, nenhuma empresa/dado já existente é tocado (permanecem no modelo compartilhado de
  sempre). Fase 2 (futura, spec separada, só depois da Fase 1 estar de fato validada) migraria os
  dados das empresas já existentes para seus próprios schemas.
- **O que FOI implementado e funciona corretamente, verificado nesta validação final:**
  `AuthService.register()` provisiona um schema físico `tenant_<companyId>` (nome derivado por função
  pura, `tenantSchemaName()` em `backend/src/prisma/tenant-schema.util.ts` — nunca persistido, nunca
  aceito de requisição, validado por regex antes de qualquer SQL bruto) numa única transação
  (`pg_advisory_xact_lock(hashtext('tenant_provisioning'))` → `Company.create` → `CREATE SCHEMA` →
  replay de todas as migrations de tenant → `User.create`), com rollback atômico completo em qualquer
  falha (Postgres DDL é transacional). Confirmado via `psql` real nesta validação: duas empresas novas
  registradas via `POST /auth/register` ganharam `tenant_<idA>`/`tenant_<idB>` reais em
  `information_schema.schemata`, cada um com exatamente as 19 tabelas de tenant esperadas e SEM
  `Company`/`User`/`RefreshToken` (`\dt tenant_<id>.*` não lista nenhuma das três).
  `TenantMigrationManagerService` (`backend/src/tenant-migration/`, `@Cron(EVERY_DAY_AT_3AM)` +
  `OnApplicationBootstrap`, mesmo padrão de `BillingSchedulerService`) aplica migrations de tenant
  pendentes em empresas que já têm schema, registrando cada uma em `TenantMigration` (central, sem
  RLS — bookkeeping de qual migration já foi aplicada a qual empresa).
- **O novo passo no fluxo de migration:** depois de `npx prisma migrate dev` criar uma migration
  tocando qualquer tabela de tenant, rodar `npm run generate:tenant-migrations`
  (`backend/scripts/generate-tenant-migrations.ts`) e revisar o `git diff` do arquivo gerado em
  `backend/prisma/tenant-migrations/` antes de commitar — o gerador filtra o `migration.sql` de cada
  migration histórica statement-a-statement, mantendo só o que toca uma tabela em
  `TENANT_TABLE_NAMES` (`backend/src/prisma/tenant-table-names.ts`); se a migration toca só tabelas
  centrais (`Company`/`User`/`RefreshToken`/`TenantMigration`), o gerador simplesmente não produz
  nada pra ela — **comportamento esperado, não um erro**.
- **`TENANT_TABLE_NAMES` (19 modelos) e a decisão de manter `Holiday` inteiramente central nesta
  fase:** `Client`, `Receivable`, `Subscription`, `Role`, `Employee`, `EmployeeWarning`,
  `EmployeeRecurringPayment`, `EmployeePayment`, `VacationSchedule`, `LeaveSchedule`,
  `TimeTrackingSettings`, `TimeEvent`, `WorkSchedule`, `WorkLocation`, `TimeAdjustmentRequest`,
  `TimeCorrection`, `TimeJustification`, `FileAsset`, `AuditLog`. `Holiday` fica de fora de propósito:
  seus escopos `NATIONAL`/`STATE` são catálogo compartilhado por todo o sistema, e o volume/risco do
  escopo `COMPANY` (feriado customizado) é baixo o suficiente pra não justificar isolamento físico
  nesta fase — o `companyId`+RLS que já existe hoje já cobre esse caso.
- **Pré-requisito de privilégio `CREATE SCHEMA`:** satisfeito automaticamente neste ambiente porque
  `quickflow_app` já é OWNER dos bancos `quickflow`/`quickflow_test` (ver `[[AMBIENTE-LOCAL]]`, seção
  5) — ownership de banco já inclui o privilégio de criar schemas nele, sem GRANT adicional. Só
  precisa de atenção explícita se algum dia a aplicação rodar contra um usuário de banco que NÃO seja
  o dono (ex.: um usuário de aplicação com privilégios restritos por política de infra).
- **Bug encontrado e corrigido durante o PLANEJAMENTO (antes de qualquer código):** replayar o
  histórico principal de migrations (`prisma/migrations/`) inteiro dentro de um schema de tenant novo
  recriaria `Company`/`User`/`RefreshToken` lá dentro — várias migrations reais deste projeto
  misturam DDL central e de tenant no mesmo arquivo. Resolvido com o segundo histórico filtrado
  (`prisma/tenant-migrations/`, gerado por `npm run generate:tenant-migrations`) descrito acima —
  nunca replaya o histórico principal bruto contra um schema de tenant.
- **Bugs encontrados e corrigidos durante a EXECUÇÃO (Tasks 3-4):** o classificador tinha um regex
  guloso (`\w+`) em `DROP INDEX` que fazia backtrack pro underscore errado num nome de índice real —
  trocado por não-guloso (`\w+?`); duas migrations históricas de remediação
  (`20260911003303_restore_client_trash_columns`, `20260911003700_restore_receivable_subscription_link`,
  artefatos de um incidente real de `db push --accept-data-loss` antigo) são 100% redundantes quando
  replayadas a partir de um schema vazio — excluídas via a lista `NOOP_WHEN_REPLAYED_FROM_EMPTY`
  (hand-maintained) no gerador. Robustez do classificador NÃO é garantida contra SQL futuro arbitrário
  (`DROP`/`TRUNCATE` não classificados merecem escrutínio manual, o splitter de `;` não foi testado
  contra corpo de função plpgsql/escape de barra invertida) — caveat honesto, não bloqueante hoje.

> [!danger] ACHADO CRÍTICO na validação final (Task 11, 16/09/2026) — mecanismo primário de
> isolamento NÃO está ativo para tráfego real da aplicação
> Tudo acima (criação de schema, réplica de migrations, bookkeeping em `TenantMigration`) funciona
> exatamente como projetado. O que NÃO funciona: **o Prisma Client (engine padrão, `@prisma/client
> ^5.20`/instalado `5.22.0`, sem driver adapters) ignora completamente o `SET LOCAL search_path`
> emitido pela extensão (`tenant-rls.extension.ts`) para toda query gerada via a API de modelo
> (`prisma.<model>.*`)** — ou seja, para 100% das leituras/escritas reais de todo service do backend.
> O engine do Prisma resolve cada tabela contra o schema fixado em `DATABASE_URL` (`?schema=public`)
> no momento da conexão, não contra o `search_path` corrente da transação — mesmo quando o `SET
> LOCAL search_path` roda como primeira instrução da MESMA transação array-form
> (`prisma.$transaction([...])`) que a extensão usa.
>
> **Evidência reproduzida nesta validação** (registrando 2 empresas novas via `/auth/register` e
> testando ao vivo): `POST /clients` como Empresa A criou um cliente que a API lista corretamente só
> pra Empresa A — mas uma consulta `psql` direta em `tenant_<idA>."Client"` mostra **zero linhas**; o
> registro está inteiro em `public."Client"` (confirmado via `SELECT ... FROM public."Client" WHERE
> email = ...`, com `app.rls_bypass` ligado). Um diagnóstico isolado (fora do NestJS, sem DI, só
> `new PrismaClient()` + o exato padrão `$transaction([SET LOCAL search_path, query])` da extensão)
> confirma a causa raiz sem ambiguidade: `SELECT current_schema()` na MESMA transação retorna
> corretamente `tenant_<idA>` (o `SET LOCAL` funcionou no Postgres), mas
> `prisma.client.findMany({})` naquela mesma transação devolveu as 15 linhas de `public."Client"` de
> **várias empresas diferentes** — nunca a linha de teste inserida via SQL bruto só em
> `tenant_<idA>."Client"`, que ficou invisível pra API do Prisma.
>
> **Consequência prática:** todo schema `tenant_<companyId>` criado por este plano existe, tem as 19
> tabelas certas, mas fica **permanentemente vazio** — nenhum código da aplicação escreve nele de
> verdade. O único mecanismo que hoje efetivamente isola dado entre empresas continua sendo a RLS
> (`companyId` + policy) que já existia ANTES deste plano começar — exatamente a camada que o design
> pretendia rebaixar a backstop, não a única linha de defesa real. O critério de conclusão "uma
> requisição de A estruturalmente não consegue ler/escrever dado de B" NÃO é verdade hoje — só é
> verdade porque a RLS antiga continua fazendo esse trabalho sozinha.
>
> **Por que nenhuma das 10 tasks/revisões nem o e2e novo pegou isso:** o teste unitário da extensão
> (`tenant-rls.extension.spec.ts`) usa um Prisma mockado (nunca toca Postgres de verdade, não pode
> detectar uma limitação do engine real). O e2e
> `backend/test/schema-tenant-isolation.e2e-spec.ts` só confirma (a) que o NOME do schema existe em
> `information_schema.schemata` e (b) que a listagem/acesso por id da API isola corretamente entre
> empresas — (b) é verdade, mas pela RLS, não pelo roteamento físico; o teste nunca consulta
> `tenant_<id>."Client"` diretamente pra confirmar que a linha criada está fisicamente lá. É uma
> lacuna real de cobertura, não um acaso de ambiente — reproduzida de forma determinística com um
> script isolado que nem passa pelo NestJS.
>
> **Achado relacionado (secundário, mesma raiz):** `TenantMigrationManagerService`, ao iterar TODA
> `Company` no boot/cron, tenta reaplicar o histórico de tenant-migrations inteiro contra empresas que
> nunca tiveram um schema físico criado (todas as ~50 empresas de teste deste ambiente de dev,
> anteriores a este plano) — o `SET LOCAL search_path` pra um schema inexistente não dá erro no
> Postgres, só faz a resolução cair pro próximo item do path (`public`, que já tem os mesmos objetos),
> gerando um erro de objeto duplicado (`42710`, etc.) capturado e logado por empresa, sem derrubar o
> boot nem corromper `public` (a transação inteira sofre rollback no primeiro conflito — DDL
> transacional do Postgres). Ainda assim, isso enche o log de um bloco `ERROR` por empresa legada a
> cada boot/cron das 3h, sem nenhuma forma de silenciar exceto dando a elas um schema físico (fora do
> escopo da Fase 1) ou ajustando o serviço pra pular empresas sem schema.
>
> **Não corrigido nesta task (Task 11 é só validação + documentação, sem código novo).** Corrigir de
> verdade exige uma mudança de arquitetura na camada de acesso a dado — candidatos a avaliar em uma
> spec própria: (a) Prisma Driver Adapters (`@prisma/adapter-pg`) com um `Pool`/`PoolClient`
> customizado que aplique `SET search_path` por conexão emprestada (precisa verificação própria se o
> engine realmente delega pro driver nesse modo); (b) uma instância de `PrismaClient` por tenant, cada
> uma com sua própria `DATABASE_URL?schema=tenant_<id>` (custo de conexões/memória por tenant); (c)
> reescrever o acesso a dado de tabelas de tenant pra SQL bruto parametrizado (perde a API tipada do
> Prisma); (d) fallback explícito pra manter RLS como camada primária de fato (não só de nome) até uma
> dessas opções ser implementada e validada com um teste que compare os dados fisicamente, não só via
> API. **Recomendação: não tratar a Fase 1 como concluída/pronta pra produção até um teste automatizado
> novo confirmar, com uma leitura direta em `tenant_<id>."ModelName"`, que a aplicação real grava e lê
> fisicamente do schema do tenant — não só que o schema existe e que a API filtra certo.**

**Regra permanente de skills:** Antes de realizar qualquer tarefa neste projeto, o Claude Code deve
verificar as skills disponíveis e utilizar todas aquelas que forem relevantes ao contexto, seguindo
integralmente suas instruções. Skills não relacionadas à tarefa não devem ser utilizadas.
