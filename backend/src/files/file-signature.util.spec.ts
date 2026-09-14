import { detectRealMimeType } from './file-signature.util';

describe('detectRealMimeType', () => {
  it('identifies a real PDF from its magic bytes (%PDF)', () => {
    const buffer = Buffer.from('%PDF-1.4\n%mock pdf content padding padding padding');
    expect(detectRealMimeType(buffer)).toBe('application/pdf');
  });

  it('identifies a real JPEG from its magic bytes (FF D8 FF)', () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    expect(detectRealMimeType(buffer)).toBe('image/jpeg');
  });

  it('identifies a real PNG from its magic bytes (89 50 4E 47 0D 0A 1A 0A)', () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    expect(detectRealMimeType(buffer)).toBe('image/png');
  });

  it('returns undefined for plain text with no recognizable magic number', () => {
    const buffer = Buffer.from('isto e apenas texto puro, sem nenhum magic number reconhecivel');
    expect(detectRealMimeType(buffer)).toBeUndefined();
  });

  it('returns undefined for a buffer shorter than the signature it would otherwise match', () => {
    // Só os 3 primeiros bytes do magic number de PNG (que tem 8 bytes) — não deve dar falso positivo.
    const truncated = Buffer.from([0x89, 0x50, 0x4e]);
    expect(detectRealMimeType(truncated)).toBeUndefined();
  });

  it('returns undefined for an empty buffer', () => {
    expect(detectRealMimeType(Buffer.alloc(0))).toBeUndefined();
  });

  it('returns undefined for a different, plausible-looking binary format (GIF) that is not in the allow-list', () => {
    const gifBuffer = Buffer.from('GIF89a' + '\x00'.repeat(10));
    expect(detectRealMimeType(gifBuffer)).toBeUndefined();
  });
});
