import { describe, expect, it } from 'vitest';
import {
  AI_MODEL_MANIFEST,
  AI_MODEL_PROFILES,
  DEFAULT_AI_MODEL_PROFILE,
  aiModelProfileById,
  aiModelProfileByTag,
  approvedInstalledModels,
  preferredInstalledModel,
} from './modelProfiles';

describe('MALENJO single-model policy',()=>{
  it('exposes exactly one reviewed MIT fine-tunable model',()=>{
    expect(AI_MODEL_MANIFEST.schemaVersion).toBe(2);
    expect(AI_MODEL_PROFILES).toHaveLength(1);
    expect(DEFAULT_AI_MODEL_PROFILE.id).toBe('phi4-mini-q4-mit');
    expect(DEFAULT_AI_MODEL_PROFILE.license).toBe('MIT');
    expect(DEFAULT_AI_MODEL_PROFILE.reviewState).toBe('reviewed');
    expect(DEFAULT_AI_MODEL_PROFILE.installable).toBe(true);
    expect(DEFAULT_AI_MODEL_PROFILE.fineTunable).toBe(true);
  });

  it('rejects old or unrelated local models from MALENJO selection',()=>{
    expect(approvedInstalledModels([
      {name:'phi3:3.8b-mini-4k-instruct-q2_K'},
      {name:'qwen3:0.6b'},
      {name:DEFAULT_AI_MODEL_PROFILE.tag},
      {name:'unrelated-user-model'},
    ])).toEqual([{name:DEFAULT_AI_MODEL_PROFILE.tag}]);
  });

  it('selects only the approved Phi-4 runtime tag',()=>{
    expect(preferredInstalledModel([{name:DEFAULT_AI_MODEL_PROFILE.tag}],'ollama')).toBe(DEFAULT_AI_MODEL_PROFILE.tag);
    expect(preferredInstalledModel([{name:'phi3:3.8b-mini-4k-instruct-q2_K'}],'ollama')).toBe('');
    expect(preferredInstalledModel([{name:DEFAULT_AI_MODEL_PROFILE.tag}],'llama-cpp')).toBe('');
    expect(aiModelProfileById('qwen3-0.6b-ultralite')).toBeUndefined();
    expect(aiModelProfileByTag('qwen3:0.6b')).toBeUndefined();
  });
});
