import { describe, expect, it } from 'vitest';
import { decodeSessionManifest, encodeSessionManifest, type ShellSessionManifest } from './recovery';

describe('shell session recovery manifest', () => {
  it('round-trips bounded tab descriptors', () => {
    const manifest: ShellSessionManifest = {
      version: 1,
      activeDocumentId: 'doc-b',
      documents: [
        { documentId:'doc-a', openedAt:10, runtime:'native-library' },
        { documentId:'doc-b', openedAt:20, runtime:'browser-session' },
      ],
    };
    expect(decodeSessionManifest(encodeSessionManifest(manifest))).toEqual(manifest);
  });

  it('fails closed on malformed data', () => {
    expect(decodeSessionManifest('not json')).toEqual({ version:1, activeDocumentId:null, documents:[] });
    expect(decodeSessionManifest(JSON.stringify({ version:999, documents:[] }))).toEqual({ version:1, activeDocumentId:null, documents:[] });
  });

  it('drops invalid runtime entries', () => {
    const decoded = decodeSessionManifest(JSON.stringify({
      version:1,
      activeDocumentId:'x',
      documents:[
        { documentId:'good', openedAt:1, runtime:'native-library' },
        { documentId:'bad', openedAt:2, runtime:'cloud' },
      ],
    }));
    expect(decoded.documents).toEqual([{ documentId:'good', openedAt:1, runtime:'native-library' }]);
  });
});
