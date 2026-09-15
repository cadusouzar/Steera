import { Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { verifyDownloadToken } from './download-token.util';
import { FilesService } from './files.service';

@Controller('file-assets')
export class FilesController {
  constructor(
    private readonly filesService: FilesService,
    private readonly auditLog: AuditLogService,
  ) {}

  // Guard global (JwtAuthGuard) já exige um token de acesso válido pra chegar aqui — o `?token=`
  // na query é uma segunda camada (o token de download curto), não substitui a autenticação normal.
  @Get(':id')
  async download(
    @Param('id') id: string,
    @Query('token') token: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    if (!token || !verifyDownloadToken(id, token)) {
      throw new NotFoundException('Link de download inválido ou expirado');
    }
    const asset = await this.filesService.assertExistsForCompany(id, user.companyId);
    // Nunca registra conteúdo do arquivo, só metadados (LGPD) - ver AuditLog no schema.
    await this.auditLog.record({
      companyId: user.companyId,
      action: 'FILE_ACCESSED',
      performedByUserId: user.userId,
      metadata: { assetId: asset.id, purpose: asset.purpose },
    });
    const stream = await this.filesService.streamPath(asset.storagePath);
    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${asset.originalFilename}"`);
    stream.pipe(res);
  }
}
