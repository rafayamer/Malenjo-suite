import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => false,
  invoke: vi.fn(),
}));

import { getLocalAiStatus, runLocalAiChat } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Codespaces AI bridge', () => {
  it('discovers Ollama models through the constrained same-origin endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      models:[{ name:'local-model', size:123, details:{ parameter_size:'1B', quantization_level:'Q4' } }],
    }), { status:200, headers:{'Content-Type':'application/json'} }));
    vi.stubGlobal('fetch', fetchMock);

    const status = await getLocalAiStatus('ollama');
    expect(fetchMock).toHaveBeenCalledWith('/__malenjo_ai/ollama/api/tags', undefined);
    expect(status.available).toBe(true);
    expect(status.models[0]?.name).toBe('local-model');
  });

  it('sends browser chat only through the constrained Ollama chat endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message:{ content:'Grounded answer [S1]' },
    }), { status:200, headers:{'Content-Type':'application/json'} }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await runLocalAiChat('job-1','ollama','local-model','QUESTION',true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/__malenjo_ai/ollama/api/chat');
    expect(result.content).toContain('[S1]');
  });
});
