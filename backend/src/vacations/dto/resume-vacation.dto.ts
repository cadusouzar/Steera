import { IsBoolean, IsOptional } from 'class-validator';

export class ResumeVacationDto {
  // Quando true, ignora o teto fixo de 30 dias somados de férias não-canceladas
  // (VacationSchedulesService.resume). Default falsy quando omitido.
  @IsOptional() @IsBoolean() exceptionAuthorized?: boolean;
}
