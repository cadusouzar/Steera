import { BadRequestException, Body, Controller, Get, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { TimeManagementAuthService } from '../time-management/time-management-auth.service';
import { TimeAttendanceCalculationService } from './time-attendance-calculation.service';
import { CreatePunchDto } from './dto/create-punch.dto';
import { TimeClockService } from './time-clock.service';

// `@types/multer` não está instalado neste projeto (só o pacote `multer` em si, via
// `@nestjs/platform-express`) — então em vez de depender do namespace global `Express.Multer.File`
// (que não resolveria), declaramos aqui só o shape que de fato usamos, idêntico ao que
// `TimeClockService.createPunch` já espera.
interface UploadedPhoto {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

// Exige o módulo `PONTO_REGISTRO` (desde a auditoria de segurança de 17/09/2026 — antes disso,
// bater o próprio ponto não dependia de módulo nenhum, era liberado pra qualquer login
// autenticado). Continua sendo uma ação de "quem sou eu" (não passa por PONTO_ADMINISTRACAO), só
// que agora precisa ser concedida explicitamente pra cada login — Ponto virou um menu próprio,
// independente de RH. JwtAuthGuard já é global (APP_GUARD em app.module.ts) — todo endpoint aqui
// também exige login válido, além do módulo.
@UseGuards(ModulesGuard)
@RequireModule('PONTO_REGISTRO')
@Controller('time-clock')
export class TimeClockController {
  constructor(
    private readonly timeClock: TimeClockService,
    private readonly timeManagementAuth: TimeManagementAuthService,
    private readonly calculation: TimeAttendanceCalculationService,
  ) {}

  @Get('status')
  getStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.timeClock.getStatus(user);
  }

  // Rate limit exigido explicitamente pela spec ("aplicado ao endpoint de criação de evento, não
  // uma solução global nova") — reaproveita o ThrottlerGuard já existente no projeto, mesmo padrão
  // de auth.controller.ts. 30/15min (mais generoso que o "default" de 5/15min usado em login) por
  // ser IP-based: várias marcações legítimas de funcionários diferentes atrás do mesmo NAT de
  // escritório podem cair na mesma janela num início de turno. @SkipThrottle({'login-email': true})
  // porque ThrottlerModule.forRoot registra esse throttler nomeado globalmente e ele sempre teria
  // que ser explicitamente pulado ou explicitamente configurado em toda rota que usa ThrottlerGuard
  // — aqui não faz sentido nenhum (não é uma ação de login).
  @Post('punches')
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({ 'login-email': true })
  @Throttle({ default: { limit: 30, ttl: 900_000 } })
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 8 * 1024 * 1024 } }))
  createPunch(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePunchDto,
    @UploadedFile() photo: UploadedPhoto | undefined,
  ) {
    return this.timeClock.createPunch(user, dto, photo);
  }

  @Get('punches')
  listOwnPunches(@CurrentUser() user: AuthenticatedUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.timeClock.listOwnPunches(user, from, to);
  }

  @Get('summary')
  async getSummary(@CurrentUser() user: AuthenticatedUser, @Query('year') year: string, @Query('month') month: string) {
    const numericYear = Number(year);
    const numericMonth = Number(month);
    if (!Number.isInteger(numericYear) || !Number.isInteger(numericMonth) || numericMonth < 1 || numericMonth > 12) {
      throw new BadRequestException('Parâmetros year/month inválidos');
    }
    const employee = await this.timeManagementAuth.resolveOwnEmployee(user);
    return this.calculation.calculateMonthlySummary(employee.id, numericYear, numericMonth);
  }
}
