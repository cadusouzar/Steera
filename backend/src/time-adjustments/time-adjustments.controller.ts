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

  @Post('time-adjustment-requests')
  @UseInterceptors(FileInterceptor('attachment', { limits: { fileSize: 5 * 1024 * 1024 } }))
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAdjustmentRequestDto,
    @UploadedFile() attachment: UploadedAttachment | undefined,
  ) {
    return this.service.create(user, dto, attachment);
  }

  @Get('time-adjustment-requests/me')
  listOwn(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listOwn(user);
  }

  @Patch('time-adjustment-requests/:id/cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.cancel(user, id);
  }

  // Administrativa: ADMIN vê a empresa inteira, um superior direto vê só seus subordinados diretos
  // (TimeAdjustmentsService.listForAdmin resolve isso via TimeManagementAuthService — nunca filtra
  // aqui no controller). @RequireModule('RH') aqui (e nas outras rotas administrativas abaixo,
  // nunca nas de auto-atendimento acima) — mesma exigência de módulo RH que qualquer outra tela
  // administrativa de RH, conforme a spec ("o login também precisa do módulo RH para acessar as
  // telas administrativas de ponto"). Só nas rotas administrativas: criar/cancelar/ver a própria
  // solicitação é ação de "quem sou eu", mesmo espírito de TimeClockController não exigir módulo
  // pra bater o próprio ponto.
  @UseGuards(ModulesGuard)
  @RequireModule('RH')
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
  @RequireModule('RH')
  @Patch('time-adjustment-requests/:id/approve')
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ReviewAdjustmentRequestDto) {
    return this.service.approve(user, id, dto.reviewNote);
  }

  @UseGuards(ModulesGuard)
  @RequireModule('RH')
  @Patch('time-adjustment-requests/:id/reject')
  reject(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ReviewAdjustmentRequestDto) {
    return this.service.reject(user, id, dto.reviewNote);
  }

  @UseGuards(ModulesGuard)
  @RequireModule('RH')
  @Post('employees/:employeeId/time-events/correct')
  proactiveCorrect(
    @CurrentUser() user: AuthenticatedUser,
    @Param('employeeId') employeeId: string,
    @Body() dto: ProactiveCorrectionDto,
  ) {
    return this.service.proactiveCorrect(user, employeeId, dto);
  }
}
