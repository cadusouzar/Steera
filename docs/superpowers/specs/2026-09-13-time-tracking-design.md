# Controle de Ponto — Design

## Contexto e motivação

`src/pages/app/TimeTracking.tsx` é hoje 100% mockado: sequência de batida fixa em 6 posições
(`Entrada`/`Saída Almoço`/`Volta Almoço`/`Saída`/`Entrada Extra`/`Saída Extra`), cálculo de horas por
posição no array (não por tipo — quebra silenciosamente se faltar uma batida), 8h esperadas fixas
por dia, e um fluxo de "Solicitar Ajuste" com um único campo de texto livre, sem tipo, sem horário
solicitado, sem anexo e sem aprovação de verdade. Não existe nenhuma visão administrativa.

Este documento propõe um backend real para Controle de Ponto, com um modelo flexível de eventos
de ponto (não colunas fixas), hierarquia de superior configurável por empresa, apuração de carga
horária isolada e testável, fluxo de solicitação/aprovação de ajuste com trilha de auditoria
completa, calendário de feriados nacional+estadual+customizado, e uma primeira infraestrutura de
upload de arquivo do projeto (para fotos de batida e anexos de justificativa/atestado).

## Escopo

**Dentro do escopo desta etapa:**
- Modelo de eventos de ponto flexível (`TimeEvent`), imutável por design de aplicação.
- Jornada de trabalho por funcionário (`WorkSchedule`), com vigência.
- Hierarquia de superior (`Employee.managerId`) e autorização baseada nela.
- Locais de trabalho autorizados / geofencing (`WorkLocation`), opcional por empresa.
- Solicitação de ajuste (`TimeAdjustmentRequest`) com fluxo de aprovação/rejeição transacional e
  trilha de auditoria (`TimeCorrection`).
- Justificativas e atestados (`TimeJustification`) com anexo.
- Infraestrutura de arquivo (`FileAsset`) — primeira do projeto, local (sem Docker/nuvem).
- Calendário de feriados nacional + estadual (semeado) + customizado por empresa (`Holiday`).
- Apuração diária/mensal de carga horária, isolada num serviço próprio.
- Endpoints de funcionário e administrador, com paginação/filtro/ordenação nas listagens.
- Integração do frontend de `TimeTracking.tsx` aos endpoints reais, preservando o layout atual.

**Fora do escopo desta etapa (pendência documentada, não esquecimento):**
- Qualquer regra específica da CLT sobre adicional noturno, banco de horas, multiplicador de hora
  extra — o mecanismo é configurável por empresa, nenhum valor-padrão é aplicado automaticamente.
- Reconhecimento facial, biometria, PIN, código temporário, identificação de dispositivo
  pré-autorizado — nenhum desses controles adicionais é implementado nesta etapa (listados no
  design como avaliados, não implementados).
- Notificações (e-mail/push/in-app) de aprovação/rejeição.
- Política de retenção/exclusão automática de fotos e atestados — fica documentada como pendência,
  sem exclusão automática.
- Hierarquia de superior com múltiplos níveis (skip-level) na autorização — só o superior **direto**
  tem permissão de administrar; um superior do superior não herda essa permissão automaticamente
  (mitigado por `ADMIN` continuar com visão total, sempre).
- Feriados municipais semeados (inviável manter uma base exaustiva) — a empresa pode cadastrar os
  seus próprios por cima da base nacional+estadual.

## Modelo de tenant e hierarquia

Nenhuma mudança na forma como empresa/login funcionam hoje. A mudança real é: **todo `Employee`
pode opcionalmdifftmente ter um superior** (`managerId`, auto-relação, nulo no topo da hierarquia).

**Quem pode administrar o ponto de quem** (usado por todos os endpoints administrativos desta
etapa):
1. `role === 'ADMIN'` → acesso total a qualquer funcionário da própria empresa (mesmo padrão já
   usado em todo o resto do sistema).
2. Um login `EMPLOYEE` cujo `Employee` correspondente é o `managerId` **direto** de um outro
   `Employee` → acesso administrativo (visualizar, aprovar/rejeitar solicitações e justificativas,
   corrigir) só sobre esse subordinado direto — nunca sobre a empresa inteira, nunca sobre
   subordinados de subordinados (sem propagação em cadeia nesta etapa).

Isso é uma autorização **por dado**, ortogonal a `role`/`modules` — não substitui nenhuma das duas,
soma-se a elas (o login também precisa do módulo `RH` para acessar as telas administrativas de
ponto, exatamente como já funciona pra qualquer outra tela de RH).

**Admin batendo o próprio ponto:** `POST /auth/register` continua exatamente como hoje (cria só
`Company` + `User` `ADMIN`, sem `Employee`, sem exigir CPF/salário no cadastro da conta). Um login
sem `employeeId` vinculado (seja `ADMIN` ou, em teoria, qualquer login futuro sem employee) **não
pode bater ponto** até se vincular a um cadastro de Funcionário — a tela de Controle de Ponto mostra
um estado claro pedindo esse vínculo, nunca falha silenciosamente. O vínculo acontece pela tela já
existente de "Novo Funcionário" (`EmployeeForm.tsx`), com uma ação nova "Vincular este cadastro ao
meu login" (endpoint `PATCH /auth/me/employee-link`, só permite vincular um `Employee` da própria
empresa que ainda não tenha nenhum `User` associado — mesma checagem de unicidade que
`UsersService.create()` já faz pra logins `EMPLOYEE`).

## Modelo de dados

```prisma
// --- Hierarquia (adição em Employee já existente) ---
model Employee {
  // ...campos já existentes, sem alteração...
  managerId String?
  manager   Employee?  @relation("EmployeeManager", fields: [managerId], references: [id], onDelete: SetNull)
  reports   Employee[] @relation("EmployeeManager")
  timeEvents            TimeEvent[]
  workSchedules         WorkSchedule[]
  timeAdjustmentRequests TimeAdjustmentRequest[]
  timeJustifications    TimeJustification[]

  @@index([managerId])
}

// --- Empresa (adições) ---
model Company {
  // ...campos já existentes, sem alteração...
  timezone String  @default("America/Sao_Paulo")
  state    String? @db.Char(2) // UF — define quais feriados estaduais se aplicam; nulo = só nacionais
  timeTrackingSettings   TimeTrackingSettings?
  workLocations          WorkLocation[]
  holidays               Holiday[] // só os de escopo COMPANY (customizados) pertencem de fato à empresa
  timeEvents             TimeEvent[]
  workSchedules          WorkSchedule[]
  timeAdjustmentRequests TimeAdjustmentRequest[]
  timeCorrections        TimeCorrection[]
  timeJustifications     TimeJustification[]
  fileAssets             FileAsset[]
}

model TimeTrackingSettings {
  id                       String  @id @default(cuid())
  companyId                String  @unique
  company                  Company @relation(fields: [companyId], references: [id], onDelete: Cascade)
  requirePhoto             Boolean @default(true)
  requireLocation          Boolean @default(true)
  allowLocationException   Boolean @default(false) // se true, localização ausente/imprecisa vira PENDING_REVIEW em vez de bloquear
  allowExtraPeriods        Boolean @default(true)
  maxAttachmentSizeBytes   Int     @default(5242880) // 5MB
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt
}

// --- Eventos de ponto (flexível, imutável por design de aplicação) ---
enum TimeEventType { CLOCK_IN BREAK_START BREAK_END CLOCK_OUT EXTRA_IN EXTRA_OUT }
enum TimeEventSource { WEB MOBILE ADMIN_MANUAL }
enum TimeEventValidationStatus { VALID PENDING_REVIEW CORRECTED }
enum LocationStatus { WITHIN_RANGE OUT_OF_RANGE IMPRECISE UNAVAILABLE NOT_REQUIRED }

model TimeEvent {
  id               String    @id @default(cuid())
  companyId        String
  company          Company   @relation(fields: [companyId], references: [id], onDelete: Cascade)
  employeeId       String
  employee         Employee  @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  type             TimeEventType
  source           TimeEventSource @default(WEB)
  serverRecordedAt DateTime  @default(now()) // horário oficial — nunca o do dispositivo
  deviceReportedAt DateTime? // só auditoria, nunca fonte de verdade
  latitude         Decimal?  @db.Decimal(9, 6)
  longitude        Decimal?  @db.Decimal(9, 6)
  accuracyMeters   Decimal?  @db.Decimal(8, 2)
  locationStatus   LocationStatus @default(NOT_REQUIRED)
  workLocationId   String?
  workLocation     WorkLocation? @relation(fields: [workLocationId], references: [id], onDelete: SetNull)
  photoAssetId     String?
  photoAsset       FileAsset? @relation(fields: [photoAssetId], references: [id], onDelete: SetNull)
  validationStatus TimeEventValidationStatus @default(VALID)
  notes            String?
  metadata         Json? // ex.: { isMobileUserAgent: true } — nunca dado sensível
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  correctionsAsOriginal  TimeCorrection[] @relation("OriginalEvent")
  correctionsAsCorrected TimeCorrection[] @relation("CorrectedEvent")

  @@index([companyId])
  @@index([employeeId])
  @@index([employeeId, serverRecordedAt])
  @@index([validationStatus])
}

// Nenhum endpoint de PATCH/DELETE é exposto para TimeEvent — imutabilidade garantida na
// camada de aplicação (mesmo espírito já usado no projeto para Receivable histórico).

// --- Jornada de trabalho ---
model WorkSchedule {
  id                       String   @id @default(cuid())
  companyId                String
  company                  Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  employeeId               String
  employee                 Employee @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  name                     String   // rótulo livre pro admin (ex.: "Comercial 8h-18h")
  weekDays                 Int[]    // 0=domingo..6=sábado
  expectedStartTime        String   // "HH:mm", hora local da empresa
  expectedEndTime          String   // "HH:mm" — se < expectedStartTime, jornada atravessa a meia-noite
  breakMinutes             Int      @default(0)
  dailyMinutes             Int      // carga diária esperada
  weeklyMinutes            Int      // carga semanal esperada
  toleranceMinutes         Int      @default(0)
  allowOvertime            Boolean  @default(false)
  maxOvertimeMinutesPerDay Int?
  nightShift               Boolean  @default(false) // sinalização informativa; sem cálculo de adicional
  validFrom                DateTime @db.Date
  validTo                  DateTime? @db.Date // nulo = vigente indefinidamente
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt

  @@index([companyId])
  @@index([employeeId])
  @@index([employeeId, validFrom])
}

// --- Locais de trabalho / geofencing (opcional por empresa) ---
model WorkLocation {
  id           String  @id @default(cuid())
  companyId    String
  company      Company @relation(fields: [companyId], references: [id], onDelete: Cascade)
  name         String
  latitude     Decimal @db.Decimal(9, 6)
  longitude    Decimal @db.Decimal(9, 6)
  radiusMeters Int
  active       Boolean @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  timeEvents   TimeEvent[]

  @@index([companyId])
}

// --- Solicitação de ajuste ---
enum TimeAdjustmentType { ADD_MISSING_PUNCH CORRECT_TIME REMOVE_PUNCH }
enum TimeAdjustmentStatus { PENDING APPROVED REJECTED CANCELLED }

model TimeAdjustmentRequest {
  id                 String    @id @default(cuid())
  companyId          String
  company            Company   @relation(fields: [companyId], references: [id], onDelete: Cascade)
  employeeId         String    // quem solicitou
  employee           Employee  @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  targetDate         DateTime  @db.Date
  relatedEventId     String?
  relatedEvent       TimeEvent? @relation(fields: [relatedEventId], references: [id], onDelete: SetNull)
  type               TimeAdjustmentType
  requestedEventType TimeEventType?
  requestedTime      DateTime?
  reason             String
  justification      String?
  attachmentAssetId  String?
  attachmentAsset    FileAsset? @relation(fields: [attachmentAssetId], references: [id], onDelete: SetNull)
  status             TimeAdjustmentStatus @default(PENDING)
  reviewedByUserId   String?
  reviewNote         String?
  reviewedAt         DateTime?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  correction TimeCorrection?

  @@index([companyId])
  @@index([employeeId])
  @@index([status])
}

// --- Trilha de auditoria da correção aprovada (nunca sobrescreve o TimeEvent original) ---
model TimeCorrection {
  id                    String   @id @default(cuid())
  companyId             String
  company               Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  adjustmentRequestId   String   @unique
  adjustmentRequest     TimeAdjustmentRequest @relation(fields: [adjustmentRequestId], references: [id], onDelete: Cascade)
  originalEventId       String?
  originalEvent         TimeEvent? @relation("OriginalEvent", fields: [originalEventId], references: [id], onDelete: SetNull)
  originalValue         Json?    // snapshot legível (tipo/horário antigo), pra histórico sem depender da relação
  correctedEventId      String
  correctedEvent        TimeEvent @relation("CorrectedEvent", fields: [correctedEventId], references: [id], onDelete: Cascade)
  correctedValue        Json
  requestedByEmployeeId String
  reviewedByUserId      String
  reason                String
  createdAt             DateTime @default(now())

  @@index([companyId])
}

// --- Justificativas e atestados ---
enum JustificationType { ABSENCE INCOMPLETE_DAY ADJUSTMENT_SUPPORT MEDICAL_CERTIFICATE OTHER }
enum JustificationStatus { PENDING APPROVED REJECTED }

model TimeJustification {
  id                String   @id @default(cuid())
  companyId         String
  company           Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  employeeId        String
  employee          Employee @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  relatedDate       DateTime? @db.Date
  periodStart       DateTime? @db.Date
  periodEnd         DateTime? @db.Date
  type              JustificationType
  description       String
  attachmentAssetId String?
  attachmentAsset   FileAsset? @relation(fields: [attachmentAssetId], references: [id], onDelete: SetNull)
  status            JustificationStatus @default(PENDING)
  reviewedByUserId  String?
  reviewNote        String?
  reviewedAt        DateTime?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([companyId])
  @@index([employeeId])
  @@index([status])
}

// --- Arquivos (primeira infra de upload do projeto) ---
enum FileAssetPurpose { TIME_PUNCH_PHOTO ADJUSTMENT_ATTACHMENT JUSTIFICATION_ATTACHMENT }

model FileAsset {
  id               String   @id @default(cuid())
  companyId        String
  company          Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  uploadedByUserId String
  originalFilename String   // sanitizado, só metadado — nunca usado como caminho em disco
  mimeType         String
  sizeBytes        Int
  storagePath      String   // caminho interno relativo — nunca exposto ao cliente
  purpose          FileAssetPurpose
  createdAt        DateTime @default(now())

  timeEventPhotos        TimeEvent[]
  adjustmentAttachments  TimeAdjustmentRequest[]
  justificationAttachments TimeJustification[]

  @@index([companyId])
}

// --- Feriados ---
enum HolidayScope { NATIONAL STATE COMPANY }

model Holiday {
  id        String       @id @default(cuid())
  scope     HolidayScope
  state     String?      @db.Char(2) // só quando scope=STATE
  companyId String?                   // só quando scope=COMPANY
  company   Company?     @relation(fields: [companyId], references: [id], onDelete: Cascade)
  date      DateTime     @db.Date
  name      String
  createdAt DateTime     @default(now())

  @@unique([scope, state, companyId, date])
  @@index([date])
  @@index([companyId])
}
```

Todas as tabelas com `companyId` (todas exceto `Holiday` de escopo `NATIONAL`/`STATE`, que são
globais/sem tenant) recebem a mesma política de RLS (`FORCE ROW LEVEL SECURITY` +
`tenant_isolation`) já usada em todo o resto do banco — sem exceção, seguindo o backstop de
segurança já estabelecido no projeto.

**Feriados nacionais/estaduais são semeados uma vez** (script de seed, não uma tabela por-empresa)
— datas fixas + móveis (Carnaval, Sexta-feira Santa, Corpus Christi, calculadas a partir do Domingo
de Páscoa pelo algoritmo de Gauss, não hardcoded ano a ano) para os próximos ~5 anos. **Isso é uma
base de referência que precisa revisão periódica** — feriados estaduais específicos que mudam por
lei ad-hoc não são acompanhados automaticamente. Documentado como limitação conhecida, não como
fonte oficial autoatualizável.

## Fluxo de batida

1. `GET /time-clock/status` → devolve o próximo tipo de evento permitido pro funcionário logado (ou
   `null` se a jornada está fechada), e se o login ainda não tem `Employee` vinculado, devolve esse
   estado explicitamente (frontend mostra "complete seu cadastro" em vez de qualquer erro genérico).
2. Frontend captura foto (câmera pontual, sem gravação contínua) + localização (uma única leitura,
   sem rastreamento contínuo) conforme `TimeTrackingSettings.requirePhoto`/`requireLocation`.
3. `POST /time-clock/punches` (multipart), servidor:
   - Resolve `employeeId`/`companyId` só de `req.user` — nunca aceita esses campos no corpo.
   - Confirma `Employee.status === 'ACTIVE'`.
   - Bloqueio de curto prazo (ex.: rejeita uma segunda batida do mesmo funcionário em menos de N
     segundos da última — cobre duplo clique e requisição repetida, incluindo de dois dispositivos
     simultâneos).
   - Valida a sequência via máquina de estados (não posição fixa): tipo pedido precisa ser uma
     transição válida a partir do último evento aberto daquele funcionário (ex.: `BREAK_END` só é
     válido se existir um `BREAK_START` sem par; `CLOCK_OUT` só é válido se existir uma jornada
     aberta). Transição genuinamente impossível → `400`. Transição ambígua mas registrável (ex.:
     gap muito longo entre eventos) → grava normalmente com `validationStatus: PENDING_REVIEW`.
   - Calcula distância até `WorkLocation`(s) ativos da empresa, se houver, definindo `locationStatus`.
     Sem `WorkLocation` configurado → `NOT_REQUIRED`. Localização obrigatória e ausente/imprecisa →
     `400` claro, a menos que `allowLocationException: true`, caso em que grava como
     `PENDING_REVIEW` em vez de bloquear.
   - Grava a foto via `FileAsset` (remove EXIF antes de persistir).
   - Insere o `TimeEvent` — tudo em uma transação.
4. Resposta inclui o evento criado + o próximo tipo de ação permitido.

## Fluxo de solicitação de ajuste

1. Funcionário cria `TimeAdjustmentRequest` (`PENDING`) — nunca edita uma batida diretamente (não
   existe endpoint de escrita em `TimeEvent` acessível a um funcionário).
2. Superior direto (via `Employee.managerId`) ou qualquer `ADMIN` da empresa lista pendentes.
3. Aprovação (transação única):
   - Confirma `status === PENDING` (uma solicitação já processada nunca é reprocessada).
   - Cria um novo `TimeEvent` (`source: ADMIN_MANUAL`) representando a batida corrigida/adicionada.
   - Cria o `TimeCorrection` (snapshot do valor original quando existir, valor corrigido, quem
     solicitou, quem aprovou, motivo).
   - Atualiza `TimeAdjustmentRequest.status = APPROVED`.
4. Rejeição: exige `reviewNote` (motivo), atualiza status, nenhuma alteração em `TimeEvent`.
5. **Correção administrativa proativa** (sem solicitação prévia, conforme aprovado): mesmo
   mecanismo — um `ADMIN` ou o superior direto pode iniciar uma correção diretamente
   (`POST /employees/:employeeId/time-events/correct`), que internamente cria uma
   `TimeAdjustmentRequest` já com `status: APPROVED` e o `TimeCorrection` correspondente, na mesma
   transação — preserva a mesma trilha de auditoria completa (motivo obrigatório, sem exceção) em
   vez de ser um caminho "silencioso" separado.

## Autorização e isolamento (resumo)

- Todo endpoint de escrita valida `employeeId`/`companyId` só a partir de `req.user` — nunca do
  corpo da requisição.
- Um funcionário nunca acessa dado de outro funcionário que não seja seu subordinado direto (se for
  superior de alguém) — reforçado pelo RLS a nível de `companyId` e por uma checagem de aplicação
  a nível de `managerId`/`ADMIN` para o restante.
- `GET /file-assets/:id` exige: mesma empresa **e** (dono do arquivo **ou** `ADMIN` **ou** superior
  direto do dono) — nunca uma URL pública.
- Rate limit na batida: reaproveita a infraestrutura de `ThrottlerGuard` já existente no projeto —
  aplicado ao endpoint de criação de evento, não uma solução global nova.

## Estratégia de câmera, localização e anexos

Ver diagnóstico já apresentado e aprovado na conversa — sem mudanças: câmera e GPS só no momento da
batida (sem gravação/rastreamento contínuo, sem biometria/reconhecimento facial), distância
calculada no servidor, `FileAsset` local (fora do Postgres, fora da pasta pública, nome em disco
aleatório, acesso só autenticado, sem URL pública permanente), EXIF removido de fotos via `sharp`,
validação de extensão/MIME/assinatura real do arquivo (`file-type`) — formatos aceitos: PDF, JPG,
JPEG, PNG; tamanho máximo configurável por empresa (`TimeTrackingSettings.maxAttachmentSizeBytes`,
padrão 5MB).

**Nota de segurança:** a auditoria de segurança recém-concluída encontrou vulnerabilidades
conhecidas em `multer` (DoS via upload malformado), mas decidiu não corrigi-las porque não existia
nenhuma rota de upload no projeto até agora. Esta feature introduz a primeira. Vou aplicar limites
estritos de tamanho/contagem na configuração do `multer` como mitigação própria, e reavaliar
separadamente se vale atualizar a dependência agora que ela passa a ser exercitada de verdade.

## Apuração de carga horária

Serviço isolado e testável (`TimeAttendanceCalculationService`, nome sujeito a ajuste no plano),
sem nenhuma regra de CLT embutida como padrão. Pareia eventos por **tipo em sequência** (não
posição), trata jornada atravessando a meia-noite como uma única jornada lógica (do `CLOCK_IN` ao
`CLOCK_OUT` correspondente, independente da data civil), desconta intervalos reais batidos,
compara contra `WorkSchedule` vigente na data, e exclui do cálculo de "falta" qualquer dia coberto
por `VacationSchedule`/`LeaveSchedule`/`Holiday` aprovado (consultados, nunca duplicados).

## Segurança e LGPD

Já coberto em detalhe na conversa: foto/localização/atestado tratados como dado pessoal (atestado
como dado sensível de saúde), acesso restrito a dono + `ADMIN`/superior direto, sem diagnóstico/CID
solicitado ou exposto, sem URL pública, metadados de imagem removidos, auditoria de ações
relevantes (batida criada, tentativa duplicada, fora de área, falha de câmera/localização,
solicitação/aprovação/rejeição/correção, envio/acesso a atestado) registrando só metadados —
nunca conteúdo de imagem/atestado no log.

## Fora do escopo / pendências documentadas

- Política de retenção/exclusão automática de fotos e atestados — pendência documentada, sem prazo
  definido pelo usuário nesta etapa.
- Feriados municipais — só nacional + estadual semeados; empresa complementa manualmente.
- Hierarquia de aprovação além do superior direto (sem skip-level).
- Qualquer multiplicador/regra automática de hora extra ou adicional noturno — mecanismo
  configurável, nenhum valor aplicado por padrão.
- Reconhecimento facial, biometria, PIN, dispositivo pré-autorizado, detecção de fraude avançada —
  avaliados, não implementados.
- Notificações de aprovação/rejeição.

## Testes

Cobertura obrigatória conforme já detalhado no pedido original: sequência válida/inválida de
eventos, jornada com intervalo, jornada atravessando a meia-noite, localização dentro/fora/imprecisa,
funcionário inativo, acesso entre empresas, duplicidade de batida, solicitação de ajuste (criação,
aprovação por superior direto, rejeição por superior de outra empresa negada, reprocessamento
bloqueado, preservação do original), apuração (períodos, intervalos, jornada incompleta, hora
extra, turno noturno, fuso horário), upload (válido, formato/tamanho inválido, acesso de terceiro
bloqueado, envio não aprova automaticamente).
