import { FileValidator, MaxFileSizeValidator, ParseFilePipeBuilder } from '@nestjs/common';
import { ALLOWED_MIME, MAX_SIZE_BYTES } from '../files.service';

// Mesmo shape mínimo da interface interna `IFile` do Nest (pipes/file/interfaces) — reproduzida
// aqui em vez de importada de um caminho interno do pacote, que pode mudar entre versões sem aviso.
interface MinimalUploadedFile {
  mimetype: string;
  size: number;
  buffer?: Buffer;
}

// Validador manual (não o `FileTypeValidator` embutido do Nest) de propósito: a implementação do
// Nest importa dinamicamente o pacote `file-type` por baixo dos panos — pacote que este projeto
// não usa mais (ver file-signature.util.ts: removido depois de uma revisão de segurança encontrar
// uma CVE de DoS na única versão dele compatível com CommonJS, sem correção disponível dentro
// dessa major). Usar o validador embutido do Nest aqui reintroduziria exatamente essa dependência
// só para uma pré-checagem barata e não-autoritativa — sem necessidade, já que a checagem que
// importa de verdade (magic bytes reais) é `detectRealMimeType`, dependency-free, dentro de
// `FilesService.upload`.
class DeclaredMimeTypeValidator extends FileValidator<{ allowed: Set<string> }> {
  buildErrorMessage(): string {
    return 'Formato de arquivo não permitido (aceitos: PDF, JPG, PNG)';
  }

  isValid(file?: MinimalUploadedFile): boolean {
    return !!file?.mimetype && this.validationOptions.allowed.has(file.mimetype);
  }
}

// Pipe reutilizável para os controllers de upload das próximas tasks (batida com foto, anexo de
// ajuste, anexo de justificativa) — usada como `@UploadedFile(buildUploadFileValidationPipe())`.
//
// IMPORTANTE: isto só valida o `mimetype`/tamanho DECLARADOS pelo cliente no multipart — dado em
// que não se pode confiar (um atacante controla esses cabeçalhos livremente). É só uma rejeição
// antecipada e barata para o caso comum (evita ler/gravar um arquivo obviamente inválido antes de
// chegar em `FilesService.upload`). A checagem que de fato importa para segurança — sniff de magic
// bytes via `detectRealMimeType` sobre os bytes reais — acontece sempre dentro de `FilesService.upload`,
// mesmo que esta pré-checagem passe, e nunca deve ser enfraquecida assumindo que esta já basta:
// nada garante que todo chamador futuro de `FilesService.upload` passe por um controller que usa
// esta pipe.
export function buildUploadFileValidationPipe(maxSizeBytes: number = MAX_SIZE_BYTES) {
  return new ParseFilePipeBuilder()
    .addValidator(new MaxFileSizeValidator({ maxSize: maxSizeBytes }))
    .addValidator(new DeclaredMimeTypeValidator({ allowed: ALLOWED_MIME }))
    .build({ fileIsRequired: true });
}
