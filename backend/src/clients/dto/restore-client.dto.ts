import { IsBoolean, IsOptional } from 'class-validator';

// Opcional: quem restaura da lixeira decide se o cliente volta a contar nos relatórios.
// Sem o campo, a flag fica como estava (reativar um inativo mantido no relatório não precisa perguntar).
export class RestoreClientDto {
  @IsOptional()
  @IsBoolean()
  includeInRevenueReport?: boolean;
}
