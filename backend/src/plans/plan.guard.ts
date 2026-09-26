import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppModule } from '@prisma/client';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { REQUIRED_MODULES_KEY } from '../auth/decorators/require-module.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { FEATURE_LABELS, minimumPlanFor, planAllowsModule } from './plan-catalog';

// Teto de PLANO da empresa (o `ModulesGuard` continua sendo a permissão da PESSOA — os dois precisam
// passar). Lê `Company.planTier` a cada requisição, SEM cache, de propósito: mudar o plano (hoje no
// banco, no futuro pelo checkout) vale na próxima ação de todos os logins da empresa, sem atraso.
// `Company` é central e sem RLS; esta leitura roda antes do TenantContextInterceptor.
@Injectable()
export class PlanGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    const required = this.reflector.getAllAndOverride<AppModule[]>(REQUIRED_MODULES_KEY, targets);
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user?.companyId) return true; // JwtAuthGuard já barrou quem não tem sessão
    const company = await this.prisma.company.findUnique({ where: { id: user.companyId }, select: { planTier: true } });
    if (!company) throw new ForbiddenException('Empresa não encontrada');
    if (required.some((m) => planAllowsModule(company.planTier, m))) return true;

    const minimum = minimumPlanFor(required[0]);
    throw new ForbiddenException({
      statusCode: 403,
      code: 'PLAN_UPGRADE_REQUIRED',
      requiredPlan: minimum.tier,
      message: `${FEATURE_LABELS[required[0]] ?? required[0]} está disponível a partir do plano ${minimum.label}. Veja os planos em Minha conta → Assinatura.`,
    });
  }
}
