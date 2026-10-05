import { invoke, isTauri } from '@tauri-apps/api/core';

export type AiProvider = 'ollama' | 'llama-cpp';

export interface AiModel {
  name: string;
  sizeBytes: number | null;
  parameterSize: string | null;
  quantization: string | null;
}

export interface AiProviderStatus {
  provider: AiProvider;
  available: boolean;
  baseUrl: string;
  models: AiModel[];
  message: string;
}

export interface AiChatResult {
  provider: AiProvider;
  model: string;
  content: string;
  latencyMs: number;
}

export async function getLocalAiStatus(provider: AiProvider): Promise<AiProviderStatus> {
  if (!isTauri()) {
    return {
      provider,
      available: false,
      baseUrl: provider === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:8080',
      models: [],
      message: 'Local model runtime status is available in the desktop app. Codespaces can still build and test retrieval locally.',
    };
  }
  return invoke<AiProviderStatus>('local_ai_status', { provider });
}

export async function runLocalAiChat(
  jobId: string,
  provider: AiProvider,
  model: string,
  prompt: string,
  liteMode: boolean,
): Promise<AiChatResult> {
  if (!isTauri()) throw new Error('Local model inference requires the MALENJO desktop runtime.');
  return invoke<AiChatResult>('local_ai_chat', { jobId, provider, model, prompt, liteMode });
}

export async function cancelLocalAi(jobId: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('cancel_local_ai', { jobId });
}
