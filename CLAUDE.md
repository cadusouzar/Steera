# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Sobre o projeto

QuickFlow (`package.json` name: `nexus-erp`) é um front-end de ERP em React + TypeScript, sem backend — todo o estado é mockado em memória (`useState` com arrays fixos) ou persistido no `localStorage` do navegador (só os módulos de Analytics fazem isso).

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
- `src/pages/app/*` — páginas do ERP logado (uma por rota em `/app/...`): `Overview`, `Roles`, `EmployeesList`/`EmployeeForm`, `ClientsList`, `InventoryList`, `QuotesList`, `PurchasingList`, `TimeTracking`, `FinancesSaaS`, `UsersManagement`.
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
`ReportsModule`) + `PrismaModule` global + 7 módulos de Recursos Humanos (`CompanyModule`,
`RolesModule`, `EmployeesModule`, `EmployeeWarningsModule`, `EmployeePaymentsModule`,
`EmployeeRecurringPaymentsModule`, `VacationsModule`). "Overdue" em lançamentos/pagamentos é sempre
derivado em runtime (nunca persistido). Ver `[[ARQUITETURA]]`, `[[BANCO-DE-DADOS]]`, `[[API]]`,
`[[AMBIENTE-LOCAL]]` e `[[DECISOES-TECNICAS]]` no vault (`B:\Quickflow\Quickflow`) para detalhes.

**Módulo de RH (`RolesModule`, `EmployeesModule`, `EmployeeWarningsModule`, `EmployeePaymentsModule`,
`EmployeeRecurringPaymentsModule`, `VacationsModule`, `CompanyModule`):** cobre Cargos, Funcionários
(CPF único **por empresa**, mascarado/omitido de dados bancários na listagem por LGPD — completo só
em `GET /employees/:id`), Advertências (sempre aninhadas sob `/employees/:employeeId/warnings`),
Pagamentos avulsos e recorrentes (espelha o par `Receivable`/`Subscription`, mesma regra de overdue
derivado) e Férias.

- **Stub de empresa única, não é autenticação real:** nenhuma rota de RH aceita `companyId` do
  cliente — todo service resolve a "empresa atual" via `CompanyContextService
  .getCurrentCompanyId()`, um stub documentado que sempre aponta para a única linha `Company` do
  banco (criada sob demanda). **Autenticação/multi-tenant real não está implementada em lugar
  nenhum do projeto** (frontend nem backend) — decisão explícita e pendência conhecida, não uma
  omissão. Ver `[[DECISOES-TECNICAS]]` seção 8.
- **Férias:** `VacationCalculationService` é uma calculadora pura (zero acesso a banco) que
  implementa só a regra básica CLT — 30 dias por período aquisitivo completo de 12 meses + dias
  proporcionais do período incompleto + adicional constitucional de 1/3 (CF/88 art. 7º XVII).
  **Fora de escopo, de propósito** (não aproximado): faltas injustificadas, abono pecuniário,
  adiantamento de 13º, INSS/IRRF, férias em dobro/vencidas, fracionamento em períodos. Disponível
  só para `contractType = CLT` — outros vínculos recebem `422` explícito.
- **Frontend de RH continua 100% mockado:** `src/pages/app/Roles.tsx`, `EmployeesList.tsx`,
  `EmployeeForm.tsx` e `src/components/FinanceAndVacationModal.tsx` **não foram tocados nem
  integrados** a este backend nesta etapa — só o backend foi construído. Essa integração é
  trabalho futuro.
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
- O scheduler cobra **só uma empresa por execução** — `CompanyContextService.getCurrentCompanyId()`
  é um stub de empresa única (ver seção de RH acima) e `BillingSchedulerService` não itera múltiplas
  empresas; sem problema hoje, mas precisa ser endereçado quando multi-tenant/autenticação real
  chegar.
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

**Regra permanente de skills:** Antes de realizar qualquer tarefa neste projeto, o Claude Code deve
verificar as skills disponíveis e utilizar todas aquelas que forem relevantes ao contexto, seguindo
integralmente suas instruções. Skills não relacionadas à tarefa não devem ser utilizadas.
