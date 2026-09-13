import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

// Não existe (e não deve existir) nenhum controller de auto-atendimento pra
// mudar o próprio `planTier`/`maxEmployeeLogins` da empresa — havia um
// (`CompanyPlanController`, `PATCH /companies/me/plan`) gated só por
// `@Roles('ADMIN')`, o que permitia o próprio admin da empresa subir o
// próprio teto de plano de graça, esvaziando o propósito do limite (ver
// [[DECISOES-TECNICAS]], seção de fixes pós-revisão do auth-multitenant).
// Removido. Até existir cobrança/pagamento de verdade, mudar o plano de uma
// empresa é uma operação manual no banco, feita por quem opera o sistema:
//   UPDATE "Company" SET "planTier" = 'PRO', "maxEmployeeLogins" = 50 WHERE id = '<companyId>';
// `UsersService.updatePlan()` continua existindo como método de serviço puro
// (sem controller na frente) exatamente para esse futuro caminho
// manual/operador — não é dead code por descuido, é um ponto de extensão
// deliberadamente sem rota HTTP por enquanto.
@Module({
  imports: [PrismaModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
