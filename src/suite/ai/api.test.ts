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

  it('streams browser Ollama chat through the constrained endpoint', async () => {
    const body = [
      JSON.stringify({ message:{ content:'Grounded ' }, done:false }),
      JSON.stringify({ message:{ content:'answer [S1]' }, done:true }),
      '',
    ].join('\n');
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, {
      status:200,
      headers:{'Content-Type':'application/x-ndjson'},
    }));
    vi.stubGlobal('fetch', fetchMock);
    const streamed:string[]=[];

    const result = await runLocalAiChat(
      'job-1','ollama','local-model','QUESTION',true,
      (content)=>streamed.push(content),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/__malenjo_ai/ollama/api/chat');
    const request = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body));
    expect(request.stream).toBe(true);
    expect(request.keep_alive).toBe('2m');
    expect(request.options.num_predict).toBe(192);
    expect(streamed.at(-1)).toBe('Grounded answer [S1]');
    expect(result.content).toBe('Grounded answer [S1]');
  });
});
