import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
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

  @Post()
  @UseInterceptors(FileInterceptor('attachment', { limits: { fileSize: 5 * 1024 * 1024 } }))
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateJustificationDto,
    @UploadedFile() attachment: UploadedAttachment | undefined,
  ) {
    return this.service.create(user, dto, attachment);
  }

  @Get('me')
  listOwn(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listOwn(user);
  }

  // Administrativa — exige módulo RH (mesmo padrão do resto do projeto e das rotas equivalentes de
  // TimeAdjustmentsController), diferente de create/listOwn acima (auto-atendimento, "quem sou eu").
  @UseGuards(ModulesGuard)
  @RequireModule('RH')
  @Get()
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
  @Patch(':id/approve')
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ReviewJustificationDto) {
    return this.service.approve(user, id, dto.reviewNote);
  }

  @UseGuards(ModulesGuard)
  @RequireModule('RH')
  @Patch(':id/reject')
  reject(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ReviewJustificationDto) {
    return this.service.reject(user, id, dto.reviewNote);
  }
}
