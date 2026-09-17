import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { CreateAdjustmentRequestDto } from './dto/create-adjustment-request.dto';
import { ProactiveCorrectionDto } from './dto/proactive-correction.dto';
import { ReviewAdjustmentRequestDto } from './dto/review-adjustment-request.dto';
import { TimeAdjustmentsService } from './time-adjustments.service';

// `@types/multer` não instalado — mesmo shape mínimo já usado em TimeClockController.
interface UploadedAttachment {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

// Sem prefixo de classe: as rotas administrativas vivem sob /time-adjustment-requests, mas a
// correção proativa (Passo 3 do brief) é aninhada sob /employees/:employeeId/time-events/correct —
// dois prefixos diferentes na mesma feature, então cada rota declara seu path completo.
@Controller()
export class TimeAdjustmentsController {
  constructor(private readonly service: TimeAdjustmentsService) {}

  // Auto-atendimento: pedir ajuste/justificativa pra si mesmo é ação de "quem sou eu", mesmo
  // espírito de TimeClockController não exigir módulo RH pra bater o próprio ponto — mas, desde a
  // auditoria de segurança de 17/09/2026, exige o módulo `PONTO_REGISTRO` (antes disso não exigia
  // módulo nenhum; ver o comentário completo em TimeClockController). Nunca `PONTO_ADMINISTRACAO`.
  @UseGuards(ModulesGuard)
  @RequireModule('PONTO_REGISTRO')
  @Post('time-adjustment-requests')
  @UseInterceptors(FileInterceptor('attachment', { limits: { fileSize: 5 * 1024 * 1024 } }))
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAdjustmentRequestDto,
    @UploadedFile() attachment: UploadedAttachment | undefined,
  ) {
    return this.service.create(user, dto, attachment);
  }

  @UseGuards(ModulesGuard)
  @RequireModule('PONTO_REGISTRO')
  @Get('time-adjustment-requests/me')
  listOwn(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listOwn(user);
  }

  @UseGuards(ModulesGuard)
  @RequireModule('PONTO_REGISTRO')
  @Patch('time-adjustment-requests/:id/cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.cancel(user, id);
  }

  // Administrativa: ADMIN vê a empresa inteira, um superior direto vê só seus subordinados diretos
  // (TimeAdjustmentsService.listForAdmin resolve isso via TimeManagementAuthService — nunca filtra
  // aqui no controller). @RequireModule('PONTO_ADMINISTRACAO') aqui (e nas outras rotas
  // administrativas abaixo, nunca nas de auto-atendimento acima) — Ponto virou um menu próprio,
  // independente de RH, desde 17/09/2026 (era RH até então).
  @UseGuards(ModulesGuard)
  @RequireModule('PONTO_ADMINISTRACAO')
  @Get('time-adjustment-requests')
  listForAdmin(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.listForAdmin(user, status, page ? Number(page) : undefined, pageSize ? Number(pageSize) : undefined);
  }

  @UseGuards(ModulesGuard)
  @RequireModule('PONTO_ADMINISTRACAO')
  @Patch('time-adjustment-requests/:id/approve')
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ReviewAdjustmentRequestDto) {
    return this.service.approve(user, id, dto.reviewNote);
  }

  @UseGuards(ModulesGuard)
  @RequireModule('PONTO_ADMINISTRACAO')
  @Patch('time-adjustment-requests/:id/reject')
  reject(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ReviewAdjustmentRequestDto) {
    return this.service.reject(user, id, dto.reviewNote);
  }

  @UseGuards(ModulesGuard)
  @RequireModule('PONTO_ADMINISTRACAO')
  @Post('employees/:employeeId/time-events/correct')
  proactiveCorrect(
    @CurrentUser() user: AuthenticatedUser,
    @Param('employeeId') employeeId: string,
    @Body() dto: ProactiveCorrectionDto,
  ) {
    return this.service.proactiveCorrect(user, employeeId, dto);
  }
}
