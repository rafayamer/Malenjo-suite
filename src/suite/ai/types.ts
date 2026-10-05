export type AiRuntimeKind = 'ollama' | 'llama.cpp';
export type AiMode = 'standard' | 'lite';

export interface AiSourceSegment {
  sourceId: string;
  sourceName: string;
  locator: string;
  text: string;
}

export interface RagChunk extends AiSourceSegment {
  id: string;
  index: number;
  tokens: string[];
}

export interface RankedChunk extends RagChunk {
  score: number;
  citation: string;
}

export interface AiIndex {
  chunks: RagChunk[];
  sourceCount: number;
  totalCharacters: number;
  truncated: boolean;
}

export interface RuntimeModel {
  name: string;
  sizeBytes?: number;
  parameterSize?: string;
  quantization?: string;
}

export interface RuntimeStatus {
  kind: AiRuntimeKind;
  baseUrl: string;
  reachable: boolean;
  version?: string;
  models: RuntimeModel[];
  error?: string;
}

export interface AiAnswer {
  text: string;
  latencyMs: number;
  model: string;
}
