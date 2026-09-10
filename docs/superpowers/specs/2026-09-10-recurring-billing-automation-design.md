# Cobrança Automática Recorrente (Recurring Billing Automation) — Design

**Status:** aprovado pelo usuário em 2026-09-10, pronto para virar plano de implementação.

## Contexto

Hoje, tanto `SubscriptionsService.generateCharge()` (assinaturas de clientes)
quanto `EmployeeRecurringPaymentsService.generateCharge()` (recorrências de
funcionários, ver `docs/superpowers/plans/2026-09-10-quickflow-hr-backend.md`)
só geram a fatura/pagamento do mês quando alguém clica manualmente em "Gerar
Fatura do Mês" na UI. Não existe nenhum job que gere cobranças sozinho.

Esta spec nasceu de uma pergunta que surgiu durante o planejamento da
integração do frontend de RH: se o toggle "Recorrência Automática" do
funcionário deve, de fato, cobrar e lançar como despesa sozinho todo mês, sem
clique nenhum — e o usuário confirmou que quer isso **também** para
assinaturas de clientes, já que a mesma lacuna existe lá.

**Importante:** este projeto está rodando localmente hoje (ver
`[[AMBIENTE-LOCAL]]` no vault), mas o destino é um servidor rodando 24/7 (o
usuário pediu explicitamente para não desenhar isso em torno da premissa de
"app local que liga e desliga"). O design abaixo funciona igualmente bem nos
dois cenários — nada aqui assume ambiente local como caso principal.

## Regra central

1. **Nenhuma lógica de geração de cobrança é duplicada.** `generateCharge()`
   já existe, já é testado, e já resolve a parte difícil corretamente
   (constrói `dueDate` a partir do `dueDay` + mês corrente — não do momento em
   que foi chamado — e é protegido contra duplicidade por uma constraint
   única no banco, traduzida para `409 Conflict`). A automação só decide
   **quais recorrências chamar `generateCharge()` agora** — não recalcula
   nem reimplementa a criação da cobrança em si.
2. **Duas camadas de disparo**, cobrindo tanto "o processo ficou rodando o
   tempo todo" quanto "o processo acabou de subir depois de ficar parado":
   - Um cron diário que roda a mesma checagem todo dia (cobre o caso comum,
     seja em produção 24/7 ou localmente).
   - A mesma checagem executada uma vez quando a aplicação sobe
     (`OnApplicationBootstrap`) — garante que, se o processo ficou fora do
     ar quando o cron deveria ter rodado (queda, restart, deploy, ambiente
     local desligado), a cobrança pendente é gerada assim que ele volta,
     sem esperar o próximo horário do cron.
3. **O botão manual "Gerar Fatura do Mês" continua existindo** nas duas
   telas (Clientes e, quando a integração do frontend de RH acontecer,
   Funcionários) — a automação é aditiva, não substitui a ação manual.

## Backend

### `SubscriptionsService.generateDueCharges()` (novo método)

```ts
async generateDueCharges(): Promise<{ checked: number; generated: number }> {
  const today = startOfToday();
  const currentDay = today.getUTCDate();
  const referenceYear = today.getUTCFullYear();
  const referenceMonth = today.getUTCMonth() + 1;

  const dueSubscriptions = await this.prisma.subscription.findMany({
    where: {
      status: SubscriptionStatus.ACTIVE,
      dueDay: { lte: currentDay },
      client: { status: { not: ClientStatus.INACTIVE } },
      receivables: { none: { referenceYear, referenceMonth } },
    },
  });

  let generated = 0;
  for (const subscription of dueSubscriptions) {
    try {
      await this.generateCharge(subscription.id);
      generated++;
    } catch (err) {
      // 409 (já existe — corrida com outra chamada) é esperado e ignorado;
      // qualquer outro erro é logado mas não interrompe as próximas.
      if (!(err instanceof ConflictException)) {
        this.logger.error(
          `Falha ao gerar cobrança da assinatura ${subscription.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }
  return { checked: dueSubscriptions.length, generated };
}
```

- Reaproveita o `generateCharge(id)` já existente e já testado — nenhuma
  duplicação da lógica de criação/idempotência.
- `dueDay: { lte: currentDay }` — só gera a partir do dia de vencimento
  informado, nunca antes (mesma semântica de "vencimento", não "início do
  mês").
- `receivables: { none: { referenceYear, referenceMonth } }` filtra no banco
  quem já tem cobrança deste mês, evitando até tentar gerar duplicata (a
  constraint única no banco continua como rede de segurança final contra
  corrida entre duas execuções simultâneas).
- Clientes inativos não geram cobrança nova — mesma regra que já existe em
  `generateCharge()` para chamada manual; replicada aqui na query para não
  nem tentar.

### `EmployeeRecurringPaymentsService.generateDueCharges()` (novo método)

Mesmo formato, mesma estrutura, adaptado para `EmployeeRecurringPayment` /
`EmployeePayment` / `Employee.status`. Não introduz nenhuma regra nova além
das já existentes em `generateCharge()`.

### `BillingSchedulerService` (novo, módulo novo `backend/src/billing/`)

```ts
@Injectable()
export class BillingSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BillingSchedulerService.name);

  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly employeeRecurringPaymentsService: EmployeeRecurringPaymentsService,
  ) {}

  async onApplicationBootstrap() {
    await this.runCatchUp('inicialização');
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runDailyCron() {
    await this.runCatchUp('cron diário');
  }

  private async runCatchUp(trigger: string) {
    try {
      const subs = await this.subscriptionsService.generateDueCharges();
      const emp = await this.employeeRecurringPaymentsService.generateDueCharges();
      if (subs.generated || emp.generated) {
        this.logger.log(`Cobrança automática (${trigger}): ${subs.generated} assinatura(s), ${emp.generated} recorrência(s) de funcionário geradas.`);
      }
    } catch (err) {
      // Nunca derruba o processo — mesmo padrão do cron de purga da lixeira.
      this.logger.error(`Falha na cobrança automática (${trigger})`, err instanceof Error ? err.stack : String(err));
    }
  }
}
```

- `BillingModule` importa `SubscriptionsModule` e `EmployeeRecurringPaymentsModule`
  (ambos já exportam seus services), registra `BillingSchedulerService`.
- Registrado em `AppModule` junto dos demais módulos. `ScheduleModule.forRoot()`
  já está registrado no projeto (usado pela purga da lixeira) — nenhuma
  dependência nova.
- Erros de uma chamada nunca impedem a outra (try/catch por serviço, não um
  único try/catch envolvendo os dois).

## Frontend

Nenhuma mudança nesta etapa — o botão manual continua existindo tal como
está hoje em Clientes; a integração do frontend de RH (etapa seguinte) já
nasce sabendo que a cobrança pode aparecer sozinha, sem precisar de nenhum
tratamento especial além de recarregar a lista de pagamentos normalmente.

## Erros e casos de borda

| Caso | Comportamento |
|---|---|
| Duas execuções simultâneas (cron + bootstrap, ou dois restarts próximos) tentam gerar a mesma cobrança | A query já filtra quem tem cobrança este mês, e a constraint única no banco é a rede de segurança final — a segunda tentativa recebe 409, capturado e ignorado silenciosamente pelo catch-up |
| Assinatura/recorrência com `dueDay` 29-31 num mês mais curto | Mesmo comportamento (e mesma limitação conhecida, documentada em `[[DECISOES-TECNICAS]]`) que a geração manual já tem — `generateCharge()` não muda |
| Cliente ou funcionário fica inativo entre uma verificação e a próxima | A query já exclui inativos; nenhuma cobrança nova é gerada para eles a partir do momento da inativação |
| Erro de conexão com o banco durante o catch-up | Logado, não derruba o processo; a próxima execução (cron do dia seguinte, ou próximo restart) tenta de novo |
| App fica dias fora do ar e perde vários meses de vencimento de uma recorrência | Só o mês corrente é verificado — meses anteriores não gerados ficam sem cobrança retroativa automática (mesmo como seria se alguém tivesse esquecido de clicar o botão manual naqueles meses; gerar cobranças retroativas de vários meses de uma vez não está no escopo desta spec) |

## Testes planejados

**Backend — unitários (`subscriptions.service.spec.ts`, novo describe):**
1. Gera cobrança para assinatura ativa com `dueDay` já alcançado e sem
   cobrança este mês.
2. Não gera para `dueDay` ainda não alcançado.
3. Não gera para assinatura já com cobrança este mês (nem tenta chamar
   `generateCharge`).
4. Não gera para cliente inativo.
5. Um 409 de uma tentativa não impede a geração das demais no mesmo lote.

**Backend — unitários (`employee-recurring-payments.service.spec.ts`, novo describe):**
Mesmos 5 casos, adaptados para `EmployeeRecurringPayment`/`Employee`.

**Backend — unitário (`billing-scheduler.service.spec.ts`, novo):**
1. `onApplicationBootstrap` chama os dois `generateDueCharges()`.
2. Um erro lançado por um dos serviços não impede a chamada do outro nem
   propaga (processo não cai).

## Documentação a atualizar (depois da implementação)

- `[[ARQUITETURA]]`: novo módulo `BillingModule`/`BillingSchedulerService`.
- `[[API]]`: nenhuma rota nova (é só automação de fundo) — uma nota
  explicando que faturas podem aparecer sem ação manual.
- `[[DECISOES-TECNICAS]]`: nova entrada explicando a decisão de duas camadas
  (cron + bootstrap) e por que não há catch-up retroativo de múltiplos
  meses.
- `CLAUDE.md`: uma linha no `## Backend` apontando a automação.
