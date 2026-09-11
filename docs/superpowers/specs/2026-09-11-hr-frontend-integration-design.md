# Integração do Frontend de RH com o Backend — Design

**Status:** aprovado pelo usuário em 2026-09-11, pronto para virar plano de implementação.

## Contexto

O backend de RH (`docs/superpowers/plans/2026-09-10-quickflow-hr-backend.md`) e a automação de
cobrança recorrente (`docs/superpowers/plans/2026-09-10-recurring-billing-automation.md`) já estão
prontos, testados e no `main`. As telas de RH (`src/pages/app/Roles.tsx`,
`src/pages/app/EmployeesList.tsx`, `src/pages/app/EmployeeForm.tsx`,
`src/components/FinanceAndVacationModal.tsx`) continuam 100% mockadas — todo dado é `useState` com
array fixo, nada persiste. Esta spec conecta essas telas ao backend real, seguindo exatamente o
padrão já estabelecido pela integração de Clientes (`src/pages/app/ClientsList.tsx`,
`src/components/ClientFinanceDrawer.tsx`, `src/lib/api.ts`).

**Escopo:** Cargos, Funcionários (dados pessoais/profissionais/financeiros), Advertências,
Pagamentos + Recorrência, Férias — tudo de uma vez, em um plano só (decisão do usuário). Não inclui
`TimeTracking.tsx` (Ponto) nem `UsersManagement.tsx` — fora do escopo do backend de RH construído.

## Decisões confirmadas com o usuário

1. **Recorrência de salário na criação:** se "Recorrência Automática" estiver marcada ao salvar um
   novo funcionário, o formulário cria a `EmployeeRecurringPayment` ("Salário", valor = `baseValue`,
   dia = `paymentDueDay`) numa segunda chamada, logo após criar o funcionário.
2. **Recorrência de salário na edição:** ligar o toggle num funcionário que não tem recorrência de
   salário ativa cria uma nova; desligar o toggle pausa (`status: INACTIVE`) a recorrência de
   salário existente. A tela identifica "a recorrência de salário" pela descrição exata `"Salário"`
   entre as recorrências do funcionário (criada sempre com esse texto fixo, nunca editável pelo
   usuário) — se houver mais de uma com essa descrição (não deveria acontecer neste fluxo), a mais
   recente é a considerada.

## Arquitetura e mapeamento de dados (`src/lib/api.ts`)

Mesmo padrão já usado para Clientes: tipos `Api*` (formato do backend) → tipos exportados que a UI
usa → funções `map*()` → funções `async` por recurso, todas usando o `request()` helper já
existente.

### Tipos e conversões

| Campo | Mock/UI | Backend | Conversão |
|---|---|---|---|
| CPF | `"111.222.333-44"` (formatado) | `"11122233344"` (só dígitos) | `formatCpf()`/`stripCpf()` novos em `api.ts` |
| `contractType` | `'clt'\|'pj'\|'estagio'` | `'CLT'\|'PJ'\|'ESTAGIO'` | `.toLowerCase()`/`.toUpperCase()` |
| Dia de pagamento | `'5'\|'15'\|'20'\|'last'` | `paymentDueDay: number` + `payOnLastBusinessDay: boolean` | `'last'` → `{ paymentDueDay: 31, payOnLastBusinessDay: true }`; demais → `{ paymentDueDay: Number(v), payOnLastBusinessDay: false }`. Inverso na leitura: `payOnLastBusinessDay ? 'last' : String(paymentDueDay)` |
| Salário | `"R$ 7.500"` (texto livre) | `baseValue: number` (Decimal) | Input numérico puro (`type="number" step="0.01"`), sem máscara de moeda — mesmo padrão de `amount` em `ClientFinanceDrawer`. Exibição via `formatCurrency()` (já existe, reaproveitar) |
| Cor do cargo | classe Tailwind (`bg-blue-500`) | `colorHex: string` (`#RRGGBB`) | Paleta de atalhos vira botões que preenchem um input de cor hex; input aceita qualquer hex válido |
| Status (cargo/funcionário) | dropdown editável | `active`/`status` só via `/deactivate`, `/reactivate` | Campo removido do formulário de edição; vira botão de ação dedicado |

### Novas interfaces exportadas de `api.ts`

```ts
export interface Role {
  id: string; name: string; department: string; colorHex: string;
  description?: string; active: boolean;
}
export interface EmployeeListItem {
  id: string; fullName: string; roleId: string; department: string;
  contractType: 'clt' | 'pj' | 'estagio'; status: 'active' | 'inactive';
  cpfMasked: string; baseValue: number;
}
export interface EmployeeDetail {
  id: string; fullName: string; cpf: string; roleId: string;
  email?: string; phone?: string; address?: string;
  contractType: 'clt' | 'pj' | 'estagio'; admissionDate: string;
  terminationDate?: string | null; status: 'active' | 'inactive'; department: string;
  baseValue: number; paymentDay: '5' | '15' | '20' | 'last'; bankDetails?: string;
  salaryRecurrenceEnabled: boolean;
}
export interface EmployeeWarning { id: string; occurredAt: string; reason: string; }
export interface EmployeePaymentRecord {
  id: string; description: string; amount: number; dueDate: string;
  status: 'pending' | 'paid' | 'overdue';
  recurringPaymentId?: string | null; referenceYear?: number | null; referenceMonth?: number | null;
}
export interface EmployeeRecurringPaymentRecord {
  id: string; description: string; amount: number; dueDay: number; status: 'active' | 'inactive';
}
export interface VacationStatus {
  monthsWorked: number; acquisitionComplete: boolean; totalAcquiredDays: number;
  proportionalDays: number; balanceDays: number; oneThirdBonus: number;
}
export interface VacationScheduleRecord {
  id: string; startDate: string; endDate: string; daysCount: number;
  status: 'scheduled' | 'approved' | 'in_progress' | 'completed' | 'cancelled';
}
```

### Funções novas em `api.ts` (assinatura, sem corpo — mapeiam 1:1 para as rotas já existentes)

```ts
// Cargos
listRoles(): Promise<Role[]>                          // GET /roles?pageSize=100
listActiveRoles(): Promise<Role[]>                     // GET /roles/active
createRole(dto): Promise<Role>                         // POST /roles
updateRole(id, dto): Promise<Role>                     // PATCH /roles/:id
deactivateRole(id): Promise<Role>                      // PATCH /roles/:id/deactivate
reactivateRole(id): Promise<Role>                      // PATCH /roles/:id/reactivate

// Funcionários
listEmployees(): Promise<EmployeeListItem[]>           // GET /employees?pageSize=100
getEmployee(id): Promise<EmployeeDetail>               // GET /employees/:id
createEmployee(dto): Promise<EmployeeDetail>           // POST /employees
updateEmployee(id, dto): Promise<EmployeeDetail>       // PATCH /employees/:id
deactivateEmployee(id): Promise<EmployeeDetail>        // PATCH /employees/:id/deactivate
reactivateEmployee(id): Promise<EmployeeDetail>        // PATCH /employees/:id/reactivate

// Advertências
listWarnings(employeeId): Promise<EmployeeWarning[]>   // GET /employees/:id/warnings
createWarning(employeeId, dto): Promise<EmployeeWarning> // POST /employees/:id/warnings

// Pagamentos avulsos
listEmployeePayments(employeeId): Promise<EmployeePaymentRecord[]> // GET /employees/:id/payments
payEmployeePayment(id): Promise<void>                  // PATCH /employee-payments/:id/pay

// Recorrência
listEmployeeRecurringPayments(employeeId): Promise<EmployeeRecurringPaymentRecord[]> // GET /employees/:id/recurring-payments
createEmployeeRecurringPayment(employeeId, dto): Promise<EmployeeRecurringPaymentRecord> // POST /employees/:id/recurring-payments
deactivateEmployeeRecurringPayment(id): Promise<void>  // PATCH /employee-recurring-payments/:id { status: 'INACTIVE' }
generateEmployeeCharge(recurringPaymentId): Promise<void> // POST /employee-recurring-payments/:id/generate-charge

// Férias
getVacationStatus(employeeId): Promise<VacationStatus> // GET /employees/:id/vacation/status
simulateVacation(employeeId, dto): Promise<VacationStatus & { sufficientBalance: boolean }> // POST .../vacation/simulate
scheduleVacation(employeeId, dto): Promise<VacationScheduleRecord> // POST .../vacation/schedule
listVacationSchedules(employeeId): Promise<VacationScheduleRecord[]> // GET .../vacation/schedules
```

## Por tela

### `Roles.tsx`

- `useEffect` chama `listRoles()` ao montar; estado de loading enquanto carrega.
- Tabela ganha uma coluna/selo de status (Ativo/Inativo).
- "Novo Cargo": formulário atual (nome, departamento) + campo de cor hex (input `type="color"` ou
  texto com paleta de atalhos) + campo de descrição — chama `createRole()`.
- Drawer de detalhes: edição de nome/departamento/cor/descrição via `updateRole()`. Rodapé:
  cargo ativo mostra "Inativar Cargo" (era "Excluir Cargo", mesma confirmação em duas etapas);
  cargo inativo mostra "Reativar Cargo".
- Erro de nome duplicado (409) exibido como mensagem de erro no formulário/drawer.

### `EmployeesList.tsx`

- `useEffect` chama `listEmployees()` e `listActiveRoles()` (para exibir o nome do cargo — a
  listagem só devolve `roleId`, então mapeia `roleId → nome do cargo ativo` localmente; cargo
  inativo referenciado por um funcionário aparece como "(cargo inativo)" com o id, já que
  `listActiveRoles()` não o retorna — aceitável, é só exibição).
- Duplo clique / botão "Detalhes" chama `getEmployee(id)` para carregar os dados completos no
  drawer (a listagem tem CPF mascarado e sem dados bancários).
- Edição: mesmo formulário atual, agora com select de cargo carregado de `listActiveRoles()`
  (auto-preenche departamento ao escolher, campo continua editável) — chama `updateEmployee()`.
- Status deixa de ser dropdown: rodapé do drawer ganha botão "Inativar/Reativar Funcionário"
  (mesmo padrão do `ClientFinanceDrawer`), chamando `deactivateEmployee()`/`reactivateEmployee()`.
- Advertências: `listWarnings(id)` ao abrir o drawer; modal "Nova Advertência" chama
  `createWarning()`.
- Clique simples continua abrindo o `FinanceAndVacationModal` (ver abaixo).

### `EmployeeForm.tsx`

- Todos os inputs viram controlados (`useState` por campo — hoje vários não são).
- Aba "Cargo & Vínculo": select carregado de `listActiveRoles()`.
- "Salvar Registro": `createEmployee()`; se `salaryRecurrenceEnabled`, em seguida
  `createEmployeeRecurringPayment(id, { description: 'Salário', amount: baseValue, dueDay: paymentDueDay })`.
  Se a segunda chamada falhar, mostra aviso mas mantém o funcionário criado (não desfaz).
- Erro de CPF duplicado (409) ou campo obrigatório faltando exibido no formulário, sem navegar.
- Aba "Advertências" continua desabilitada nesta tela (funcionário ainda não existe até salvar).

### `FinanceAndVacationModal.tsx` — aba Pagamentos

- `useEffect` (ao trocar de aba ou abrir o modal) chama `listEmployeePayments(id)` e
  `listEmployeeRecurringPayments(id)`.
- "Marcar Pago" chama `payEmployeePayment(id)`.
- "Gerar Fatura do Mês" (hoje sem `onClick`) passa a chamar `generateEmployeeCharge(recurringPaymentId)`.
- O toggle de recorrência automática do funcionário (editado em `EmployeesList.tsx`) já cuida de
  criar/pausar a recorrência — esta aba só exibe o estado atual, não duplica esse controle.

### `FinanceAndVacationModal.tsx` — aba Férias

- Substitui o cálculo local (`calculateVacation()`) por `getVacationStatus(id)`.
- Não-CLT: a tela já trata isso hoje (mensagem "Férias Indisponíveis") — mantém, só troca a
  condição de `contractType !== 'clt'` local para o erro 422 que o backend devolve nesse caso
  (tratado como "não aplicável", mesma mensagem).
- **Peça nova:** botão "Agendar Férias" abre um pequeno formulário inline (data de início, data de
  fim) em vez de chamar `onScheduleVacation(10)` fixo. Ao preencher, chama `simulateVacation()` e
  mostra o resultado (dias, bônus de 1/3, se o saldo é suficiente) antes de um botão "Confirmar
  Agendamento" que chama `scheduleVacation()`.
- Histórico de períodos: `listVacationSchedules(id)`.

## Erros e casos de borda

| Caso | Comportamento |
|---|---|
| CPF duplicado ao criar/editar funcionário (409) | Mensagem de erro no formulário, não navega/fecha |
| Nome de cargo duplicado (ativo) ao criar/editar (409) | Mensagem de erro no formulário/drawer |
| Cargo inativo referenciado por um funcionário existente | Exibido como "(cargo inativo)" na listagem/drawer — nunca oferecido no select de novos vínculos |
| Falha ao criar a recorrência de salário logo após criar o funcionário | Funcionário permanece criado; aviso indica que a recorrência não foi criada e pode ser configurada depois |
| Agendar férias com saldo insuficiente ou datas sobrepostas (400) | Mensagem de erro no formulário de agendamento, sem fechar |
| Vínculo não-CLT tentando calcular férias (422) | Tela mostra a mensagem já existente "Férias Indisponíveis" |
| Qualquer chamada de rede falha | Banner de erro reutilizável (`actionError`), nunca remoção otimista de dado antes da confirmação do backend |

## Testes planejados

Este projeto não tem suíte de testes automatizados de frontend configurada (`CLAUDE.md`: "Não há
suíte de testes configurada no projeto"). Validação é manual, via dev server, cobrindo o caminho
feliz e os casos de borda acima, por tela:

1. Cargos: criar, editar, inativar, reativar, tentar nome duplicado.
2. Funcionários: criar (com e sem recorrência automática), listar (CPF mascarado), abrir detalhes
   (CPF completo), editar, inativar, reativar, tentar CPF duplicado, tentar cargo inativo.
3. Advertências: listar, criar.
4. Pagamentos: listar, marcar como pago, gerar fatura manualmente, confirmar que ligar/desligar a
   recorrência na edição do funcionário cria/pausa a `EmployeeRecurringPayment` correta.
5. Férias: consultar status (CLT e não-CLT), simular, agendar, tentar saldo insuficiente/datas
   sobrepostas, consultar histórico.

## Documentação a atualizar (depois da implementação)

- Notas do vault por página (`Roles.md`, `EmployeesList.md`, `EmployeeForm.md`) — atualizar a seção
  "Observações" removendo a nota de "ainda mockado" e descrevendo a integração real.
- `CLAUDE.md`: remover/ajustar a frase que hoje diz que o frontend de RH continua mockado.
