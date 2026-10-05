import { describe, expect, it } from 'vitest';
import { buildRuntimeRequest } from './runtime';

const messages = [
  { role:'system', content:'system' },
  { role:'user', content:'question' },
];

describe('local AI runtime requests', () => {
  it('keeps Ollama Lite Mode bounded and unloadable', () => {
    const request = buildRuntimeRequest('ollama', 'model-a', messages, 'lite');
    expect(request.path).toBe('/api/chat');
    expect(request.body.keep_alive).toBe(0);
    expect(request.body.options.num_ctx).toBe(2048);
    expect(request.body.options.num_predict).toBe(256);
  });

  it('keeps model download out of the chat adapter', () => {
    const request = buildRuntimeRequest('ollama', 'model-a', messages, 'standard');
    expect(request.path).not.toContain('pull');
  });

  it('supports the llama.cpp OpenAI-compatible chat boundary', () => {
    const request = buildRuntimeRequest('llama.cpp', 'local-model', messages, 'standard');
    expect(request.path).toBe('/v1/chat/completions');
    expect(request.body.max_tokens).toBe(640);
  });
});
