// Detecção de tipo real por magic bytes, dependency-free, escopada de propósito só aos 3 formatos
// que este app aceita (PDF/JPEG/PNG) — nunca mais do que isso.
//
// Substitui o pacote `file-type` (usado numa versão anterior desta task) depois de uma revisão de
// segurança encontrar GHSA-5v7r-6r5c-r473 (loop infinito no parser de ASF do `file-type`, DoS via
// ~10 bytes) na única versão do pacote compatível com CommonJS (16.5.4 — a última já publicada da
// major 16.x, sem correção disponível dentro dela). `file-type` reconhece dezenas de formatos
// (ASF, ZIP e outros) que este app nunca precisou suportar — cada parser adicional é superfície de
// ataque grátis para um caso de uso que não existe aqui. Uma checagem manual dos 3 magic numbers
// que de fato importam elimina essa classe inteira de bug (parsers de formato complexos), não só a
// CVE pontual.
interface Signature {
  mime: string;
  bytes: number[];
}

const SIGNATURES: Signature[] = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

/**
 * Retorna o mimetype real do buffer, detectado pelos primeiros bytes (magic number), ou
 * `undefined` se não corresponder a nenhum dos formatos aceitos (PDF, JPEG, PNG) — nunca ao
 * `mimetype` declarado pelo cliente, que não é lido por esta função de propósito.
 */
export function detectRealMimeType(buffer: Buffer): string | undefined {
  for (const sig of SIGNATURES) {
    if (buffer.length >= sig.bytes.length && sig.bytes.every((b, i) => buffer[i] === b)) {
      return sig.mime;
    }
  }
  return undefined;
}
