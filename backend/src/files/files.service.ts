import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { mkdir, stat, writeFile } from 'fs/promises';
import { join } from 'path';
// Pinned to file-type@16.x (not the current v22 "latest") on purpose: v17+ dropped CommonJS
// entirely (ESM-only, no "main"/"types" field — package.json only exposes a conditional "exports"
// map TypeScript's classic Node resolution here can't see, so it fails to compile, and relying on
// Node's newer require(esm) interop would make this security-critical magic-byte check brittle
// across Node versions/deploy targets). v16.5.4 is the last CJS release and is kept alive
// specifically for this by upstream's own "version-16" dist-tag. Its export is named `fromBuffer`
// (renamed to `fileTypeFromBuffer` only in the ESM-only v17+ rewrite) — aliased on import so the
// rest of this file (and its tests) can use the same name the brief/spec use.
import { fromBuffer as fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { FileAssetPurpose } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
    // Nunca confiar só no mimetype declarado pelo cliente — confere a assinatura real do arquivo.
    //
    // DEVIATION FROM THE BRIEF, flagged explicitly (found + fixed during manual verification,
    // 14/09/2026): the brief's original code was `detected?.mime ?? file.mimetype` — falling back
    // to the CLIENT-DECLARED mimetype whenever `fileTypeFromBuffer` can't recognize the real bytes
    // (`detected` is `undefined`). Verified empirically that this happens for ordinary plain text
    // (no magic-byte signature at all, not just malformed variants of a known format) — so a
    // plain-text file declaring `mimetype: 'application/pdf'` sailed straight through the allow-list
    // check under the original code and was written to disk verbatim with a `.pdf` extension and a
    // `FileAsset` row claiming `mimeType: 'application/pdf'`, completely undetected. Images got
    // accidental protection only because `sharp()` below throws on non-image bytes — PDFs (never
    // passed through sharp) had zero protection. This defeats the exact security property this task
    // exists to guarantee. Fix: an unrecognized real type is now always rejected, full stop — never
    // falls back to the declared value for this decision.
    const detected = await fileTypeFromBuffer(file.buffer);
    const realMime = detected?.mime;
    if (!realMime || !ALLOWED_MIME.has(realMime)) {
      throw new BadRequestException('Formato de arquivo não permitido (aceitos: PDF, JPG, PNG)');
    }

    let bufferToStore = file.buffer;
    if (realMime === 'image/jpeg' || realMime === 'image/png') {
      // Remove EXIF (pode conter GPS/modelo do aparelho) re-codificando a imagem.
      bufferToStore = await sharp(file.buffer).rotate().toBuffer();
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
