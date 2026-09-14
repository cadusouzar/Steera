import { Body, Controller, Get, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators/current-user.decorator';
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

// Sem @RequireModule aqui de propósito: bater o próprio ponto não depende de módulo — é uma ação
// de "quem sou eu", não de "o que meu login pode administrar" (mesmo espírito de /auth/me).
// JwtAuthGuard já é global (APP_GUARD em app.module.ts) — todo endpoint aqui exige login válido.
@Controller('time-clock')
export class TimeClockController {
  constructor(private readonly timeClock: TimeClockService) {}

  @Get('status')
  getStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.timeClock.getStatus(user);
  }

  @Post('punches')
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
}
