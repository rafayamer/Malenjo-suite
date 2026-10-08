import { describe, expect, it } from 'vitest';
import {
  AI_MODEL_MANIFEST,
  AI_MODEL_PROFILES,
  DEFAULT_AI_MODEL_PROFILE,
  aiModelProfileById,
  aiModelProfileByTag,
  preferredInstalledModel,
} from './modelProfiles';

describe('MALENJO AI model profiles',()=>{
  it('uses a reviewed installable MIT profile by default',()=>{
    expect(AI_MODEL_MANIFEST.schemaVersion).toBe(2);
    expect(DEFAULT_AI_MODEL_PROFILE.reviewState).toBe('reviewed');
    expect(DEFAULT_AI_MODEL_PROFILE.installable).toBe(true);
    expect(DEFAULT_AI_MODEL_PROFILE.license).toBe('MIT');
    expect(DEFAULT_AI_MODEL_PROFILE.resourceClass).toBe('lite');
  });

  it('keeps the smaller Apache fallback explicit instead of mislabeling it MIT',()=>{
    const qwen=aiModelProfileById('qwen3-0.6b-ultralite');
    expect(qwen?.license).toBe('Apache-2.0');
    expect(qwen?.resourceClass).toBe('ultralite');
  });

  it('supports profile replacement without changing the runtime adapter',()=>{
    expect(aiModelProfileByTag(DEFAULT_AI_MODEL_PROFILE.tag)?.id).toBe(DEFAULT_AI_MODEL_PROFILE.id);
    expect(AI_MODEL_PROFILES.every((profile)=>profile.expectedDigestPrefix.length>=12)).toBe(true);
  });

  it('prefers the higher-quality reviewed MIT model when it is already installed',()=>{
    const phi4=aiModelProfileById('phi4-mini-q4-mit')!;
    expect(preferredInstalledModel([
      {name:DEFAULT_AI_MODEL_PROFILE.tag},
      {name:phi4.tag},
    ],'ollama')).toBe(phi4.tag);
    expect(preferredInstalledModel([{name:'custom-local-model'}],'ollama')).toBe('custom-local-model');
  });
});
