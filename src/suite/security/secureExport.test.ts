import { describe, expect, it } from 'vitest';
import { decryptMalenjoEnvelope, encryptMalenjoEnvelope, validateRedaction } from './secureExport';

describe('Phase 6 secure export', () => {
  it('accepts bounded normalized redaction rectangles', () => {
    expect(validateRedaction({ page:1, x:0.1, y:0.2, width:0.3, height:0.2 })).toBe(true);
    expect(validateRedaction({ page:0, x:0, y:0, width:1, height:1 })).toBe(false);
    expect(validateRedaction({ page:1, x:0.9, y:0, width:0.2, height:1 })).toBe(false);
  });

  it('round-trips a MALENJO AES-GCM envelope', async () => {
    const source = new TextEncoder().encode('confidential document bytes');
    const encrypted = await encryptMalenjoEnvelope(source, 'strong-passphrase');
    expect(encrypted).not.toEqual(source);
    const decrypted = await decryptMalenjoEnvelope(encrypted, 'strong-passphrase');
    expect(new TextDecoder().decode(decrypted)).toBe('confidential document bytes');
  });

  it('rejects a wrong secure-envelope password', async () => {
    const source = new TextEncoder().encode('classified');
    const encrypted = await encryptMalenjoEnvelope(source, 'correct-password');
    await expect(decryptMalenjoEnvelope(encrypted, 'wrong-password')).rejects.toThrow();
  });
});
