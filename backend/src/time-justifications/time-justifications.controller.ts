import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ModulesGuard } from '../auth/guards/modules.guard';
import { CreateJustificationDto } from './dto/create-justification.dto';
import { ReviewJustificationDto } from './dto/review-justification.dto';
import { TimeJustificationsService } from './time-justifications.service';

// `@types/multer` não instalado — mesmo shape mínimo já usado em TimeClockController/TimeAdjustmentsController.
interface UploadedAttachment {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

@Controller('time-justifications')
export class TimeJustificationsController {
  constructor(private readonly service: TimeJustificationsService) {}

  // Auto-atendimento: enviar justificativa/atestado próprio, mesmo espírito de TimeClockController
  // não exigir módulo pra bater o próprio ponto — mas, desde a auditoria de segurança de
  // 17/09/2026, exige o módulo `PONTO_REGISTRO` (antes disso não exigia módulo nenhum).
  @UseGuards(ModulesGuard, PermissionsGuard)
  @RequireModule('PONTO_REGISTRO')
  @RequirePermission('ponto.registrar')
  @Post()
  @UseInterceptors(FileInterceptor('attachment', { limits: { fileSize: 5 * 1024 * 1024 } }))
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateJustificationDto,
    @UploadedFile() attachment: UploadedAttachment | undefined,
  ) {
    return this.service.create(user, dto, attachment);
  }

  @UseGuards(ModulesGuard, PermissionsGuard)
  @RequireModule('PONTO_REGISTRO')
  @RequirePermission('ponto.registrar')
  @Get('me')
  listOwn(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listOwn(user);
  }

  // Administrativa — exige módulo `PONTO_ADMINISTRACAO` (Ponto virou um menu próprio, independente
  // de RH, desde 17/09/2026 — era RH até então), diferente de create/listOwn acima (auto-
  // atendimento, "quem sou eu").
  @UseGuards(ModulesGuard, PermissionsGuard)
  @RequireModule('PONTO_ADMINISTRACAO')
  @RequirePermission('ponto.administrar')
  @Get()
  listForAdmin(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.listForAdmin(user, status, page ? Number(page) : undefined, pageSize ? Number(pageSize) : undefined);
  }

  @UseGuards(ModulesGuard, PermissionsGuard)
  @RequireModule('PONTO_ADMINISTRACAO')
  @RequirePermission('ponto.administrar')
  @Patch(':id/approve')
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ReviewJustificationDto) {
    return this.service.approve(user, id, dto.reviewNote);
  }

  @UseGuards(ModulesGuard, PermissionsGuard)
  @RequireModule('PONTO_ADMINISTRACAO')
  @RequirePermission('ponto.administrar')
  @Patch(':id/reject')
  reject(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ReviewJustificationDto) {
    return this.service.reject(user, id, dto.reviewNote);
  }
}
