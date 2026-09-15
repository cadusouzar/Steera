import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { mkdir, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import sharp from 'sharp';
import { FileAssetPurpose } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { detectRealMimeType } from './file-signature.util';

const STORAGE_ROOT = join(process.cwd(), 'storage', 'attachments');
// Exportados para reuso em dto/upload-file.dto.ts (pré-checagem barata no nível do multer/pipe,
// antes de o buffer inteiro ser lido) — a checagem que de fato importa pra segurança continua
// sendo a sniff de magic bytes feita abaixo em `upload()`, nunca o mimetype/tamanho declarado.
export const MAX_SIZE_BYTES = 5 * 1024 * 1024; // default; TimeTrackingSettings pode sobrepor por empresa
export const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const ALLOWED_EXT: Record<string, string> = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };

@Injectable()
export class FilesService {
  constructor(private readonly prisma: PrismaService) {}

  private sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
  }

  async upload(
    companyId: string,
    uploadedByUserId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    purpose: FileAssetPurpose,
    maxSizeBytes: number = MAX_SIZE_BYTES,
  ) {
    if (file.size > maxSizeBytes) {
      throw new BadRequestException(`Arquivo excede o tamanho máximo permitido (${maxSizeBytes} bytes)`);
    }
    // Nunca confiar só no mimetype declarado pelo cliente — confere a assinatura real do arquivo
    // (magic bytes) via `detectRealMimeType` (ver file-signature.util.ts — checagem manual,
    // dependency-free, escopada só aos 3 formatos aceitos; ver o comentário lá para o histórico de
    // por que não usamos mais o pacote `file-type`, incluindo uma CVE de DoS encontrada na única
    // versão dele compatível com CJS).
    //
    // Um arquivo cuja assinatura não é reconhecida é SEMPRE rejeitado — nunca cai de volta para o
    // `file.mimetype` declarado (bug real encontrado e corrigido durante a verificação manual desta
    // task, 14/09/2026: a versão anterior deste código fazia isso, e um arquivo de texto puro
    // declarando `application/pdf` passava pelo allow-list sem nenhuma detecção real).
    const realMime = detectRealMimeType(file.buffer);
    if (!realMime || !ALLOWED_MIME.has(realMime)) {
      throw new BadRequestException('Formato de arquivo não permitido (aceitos: PDF, JPG, PNG)');
    }

    let bufferToStore = file.buffer;
    if (realMime === 'image/jpeg' || realMime === 'image/png') {
      // Remove EXIF (pode conter GPS/modelo do aparelho) re-codificando a imagem. Um buffer pode
      // passar na checagem de assinatura (magic bytes corretos) e ainda assim não ser uma imagem
      // válida de verdade (truncada/corrompida) — sharp lança nesse caso, e sem o try/catch isso
      // vazava como um 500 bruto pro cliente em vez de um 400 limpo (achado ao vivo, corrigido na
      // revisão final de 14/09/2026).
      try {
        bufferToStore = await sharp(file.buffer).rotate().toBuffer();
      } catch {
        throw new BadRequestException('Não foi possível processar a imagem enviada — o arquivo pode estar corrompido');
      }
    }

    await mkdir(STORAGE_ROOT, { recursive: true });
    const storedName = `${randomUUID()}${ALLOWED_EXT[realMime]}`;
    const storagePath = join('attachments', storedName); // relativo — nunca exposto ao cliente
    await writeFile(join(STORAGE_ROOT, storedName), bufferToStore);

    return this.prisma.fileAsset.create({
      data: {
        companyId,
        uploadedByUserId,
        originalFilename: this.sanitizeFilename(file.originalname),
        mimeType: realMime,
        sizeBytes: bufferToStore.length,
        storagePath,
        purpose,
      },
    });
  }

  // Autorização (dono OU ADMIN OU superior direto) é checada pelo chamador (FilesController),
  // que já tem acesso ao TimeManagementAuthService (Task 4) — este método só resolve o arquivo em
  // si depois que a autorização já passou, e sempre escopado por empresa via RLS (a query abaixo
  // roda dentro do contexto de tenant já estabelecido pelo interceptor global).
  async assertExistsForCompany(id: string, companyId: string) {
    const asset = await this.prisma.fileAsset.findFirst({ where: { id, companyId } });
    if (!asset) throw new NotFoundException(`Arquivo ${id} não encontrado`);
    return asset;
  }

  async streamPath(storagePath: string) {
    const fullPath = join(STORAGE_ROOT, storagePath.replace(/^attachments[\\/]/, ''));
    await stat(fullPath); // lança se não existir
    return createReadStream(fullPath);
  }
}
