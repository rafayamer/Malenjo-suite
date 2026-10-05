import type { AiAnswer, AiMode, AiRuntimeKind, RuntimeModel, RuntimeStatus } from './types';

const DEFAULTS: Record<AiRuntimeKind, string> = {
  ollama: 'http://127.0.0.1:11434',
  'llama.cpp': 'http://127.0.0.1:8080',
};

function safeBaseUrl(kind: AiRuntimeKind, value?: string): string {
  const fallback = DEFAULTS[kind];
  const candidate = (value || fallback).replace(/\/+$/, '');
  const parsed = new URL(candidate);

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('AI runtime URL must use http or https.');
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
    throw new Error('Phase 5 only permits loopback AI runtimes.');
  }
  return parsed.toString().replace(/\/$/, '');
}

async function fetchJson(url: string, init: RequestInit, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`Runtime returned HTTP ${response.status}.`);
    return await response.json();
  } finally {
    window.clearTimeout(timer);
  }
}

export async function inspectRuntime(kind: AiRuntimeKind, customUrl?: string): Promise<RuntimeStatus> {
  const baseUrl = safeBaseUrl(kind, customUrl);
  try {
    if (kind === 'ollama') {
      const [versionResult, tagsResult] = await Promise.all([
        fetchJson(`${baseUrl}/api/version`, { method:'GET' }).catch(() => ({})),
        fetchJson(`${baseUrl}/api/tags`, { method:'GET' }),
      ]);
      const models: RuntimeModel[] = Array.isArray(tagsResult.models)
        ? tagsResult.models.map((model: Record<string, unknown>) => ({
            name: String(model.name ?? model.model ?? ''),
            sizeBytes: typeof model.size === 'number' ? model.size : undefined,
            parameterSize: String((model.details as Record<string, unknown> | undefined)?.parameter_size ?? ''),
            quantization: String((model.details as Record<string, unknown> | undefined)?.quantization_level ?? ''),
          })).filter((model: RuntimeModel) => model.name)
        : [];
      return { kind, baseUrl, reachable:true, version:String(versionResult.version ?? ''), models };
    }

    const result = await fetchJson(`${baseUrl}/v1/models`, { method:'GET' });
    const models: RuntimeModel[] = Array.isArray(result.data)
      ? result.data.map((model: Record<string, unknown>) => ({ name:String(model.id ?? '') })).filter((model:RuntimeModel)=>model.name)
      : [];
    return { kind, baseUrl, reachable:true, models };
  } catch (error) {
    return {
      kind,
      baseUrl,
      reachable:false,
      models:[],
      error:error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildRuntimeRequest(
  kind: AiRuntimeKind,
  model: string,
  messages: Array<{role:string;content:string}>,
  mode: AiMode,
) {
  if (kind === 'ollama') {
    return {
      path:'/api/chat',
      body:{
        model,
        messages,
        stream:false,
        keep_alive: mode === 'lite' ? 0 : '2m',
        options:{
          temperature:0.2,
          num_ctx: mode === 'lite' ? 2048 : 4096,
          num_predict: mode === 'lite' ? 256 : 640,
        },
      },
    };
  }

  return {
    path:'/v1/chat/completions',
    body:{
      model,
      messages,
      stream:false,
      temperature:0.2,
      max_tokens: mode === 'lite' ? 256 : 640,
    },
  };
}

export async function askRuntime(
  status: RuntimeStatus,
  model: string,
  messages: Array<{role:string;content:string}>,
  mode: AiMode,
  signal: AbortSignal,
): Promise<AiAnswer> {
  if (!status.reachable) throw new Error('Local AI runtime is not reachable.');
  if (!model) throw new Error('Select an installed local model.');

  const request = buildRuntimeRequest(status.kind, model, messages, mode);
  const started = performance.now();
  const response = await fetch(`${status.baseUrl}${request.path}`, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(request.body),
    signal,
  });

  if (!response.ok) throw new Error(`AI runtime returned HTTP ${response.status}.`);
  const result = await response.json();

  const text = status.kind === 'ollama'
    ? String(result.message?.content ?? '')
    : String(result.choices?.[0]?.message?.content ?? '');

  if (!text.trim()) throw new Error('The local model returned an empty answer.');

  return {
    text,
    model,
    latencyMs:Math.round(performance.now() - started),
  };
}
