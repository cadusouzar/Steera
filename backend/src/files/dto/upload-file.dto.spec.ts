import { BadRequestException } from '@nestjs/common';
import { buildUploadFileValidationPipe } from './upload-file.dto';

// Não depende de @types/multer de propósito (o projeto ainda não tinha essa dependência de tipos
// antes desta task, e nada aqui precisa dela): `ParseFilePipe.transform(value: any)` e a interface
// interna `IFile` do Nest só exigem os campos abaixo em runtime.
function fakeMulterFile(overrides: Partial<{ mimetype: string; size: number; originalname: string }>) {
  return {
    fieldname: 'file',
    originalname: 'arquivo.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    size: 1024,
    buffer: Buffer.from('conteudo qualquer'),
    ...overrides,
  };
}

describe('buildUploadFileValidationPipe', () => {
  it('accepts a file whose declared mimetype is on the allow-list and within the size limit', async () => {
    const pipe = buildUploadFileValidationPipe(2048);
    await expect(pipe.transform(fakeMulterFile({}))).resolves.toBeDefined();
  });

  it('accepts image/jpeg and image/png declared mimetypes too', async () => {
    const pipe = buildUploadFileValidationPipe(2048);
    await expect(pipe.transform(fakeMulterFile({ mimetype: 'image/jpeg' }))).resolves.toBeDefined();
    await expect(pipe.transform(fakeMulterFile({ mimetype: 'image/png' }))).resolves.toBeDefined();
  });

  it('rejects a file above the configured max size', async () => {
    const pipe = buildUploadFileValidationPipe(10);
    await expect(pipe.transform(fakeMulterFile({ size: 2048 }))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a declared mimetype outside the allow-list', async () => {
    const pipe = buildUploadFileValidationPipe(2048);
    await expect(pipe.transform(fakeMulterFile({ mimetype: 'text/plain' }))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when no file is present', async () => {
    const pipe = buildUploadFileValidationPipe();
    await expect(pipe.transform(undefined)).rejects.toBeInstanceOf(BadRequestException);
  });

  // Este pipe deliberadamente NÃO faz sniff de magic bytes (ver comentário em upload-file.dto.ts) —
  // um cliente que mente sobre o mimetype passa por aqui despercebido. Este teste documenta esse
  // limite de propósito: a checagem real (que barra esse mesmo caso) é FilesService.upload, já
  // coberta em files.service.spec.ts ("rejects a MIME type not on the allow-list even when the
  // client-declared mimetype lies").
  it('does NOT catch a lying declared mimetype on its own — that is FilesService.upload’s job', async () => {
    const pipe = buildUploadFileValidationPipe(2048);
    const fakeTextDisguisedAsPdf = fakeMulterFile({ mimetype: 'application/pdf' });
    await expect(pipe.transform(fakeTextDisguisedAsPdf)).resolves.toBeDefined();
  });
});
