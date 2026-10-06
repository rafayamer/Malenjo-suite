import {
  HOME_STORAGE_KEY,
  defaultHomeState,
  sanitizeHomeState,
  type HomeStateV1,
} from './model';

export interface HomeStateWriteResult {
  ok: boolean;
  error?: string;
}

function availableStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadHomeState(storage: Pick<Storage,'getItem'> | null = availableStorage()): HomeStateV1 {
  if (!storage) return defaultHomeState();
  try {
    const raw=storage.getItem(HOME_STORAGE_KEY);
    if (!raw) return defaultHomeState();
    return sanitizeHomeState(JSON.parse(raw));
  } catch {
    return defaultHomeState();
  }
}

export function saveHomeState(
  state: HomeStateV1,
  storage: Pick<Storage,'setItem'> | null = availableStorage(),
): HomeStateWriteResult {
  if (!storage) return { ok:false, error:'Persistent Home state is unavailable in this runtime.' };
  try {
    storage.setItem(HOME_STORAGE_KEY,JSON.stringify(sanitizeHomeState(state)));
    return { ok:true };
  } catch(reason) {
    return {
      ok:false,
      error:`Unable to persist Home state: ${reason instanceof Error ? reason.message : String(reason)}`,
    };
  }
}
