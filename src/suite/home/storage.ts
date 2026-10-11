import { invoke, isTauri } from '@tauri-apps/api/core';
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


/** Desktop Home preferences belong to app-data and participate in backup.
 * Browser localStorage is retained as a migration/fallback cache only. */
export async function loadNativeHomeState():Promise<HomeStateV1>{
  const browser=loadHomeState();
  if(!isTauri())return browser;
  const native=await invoke<string|null>('read_native_home_state');
  if(native){
    const restored=sanitizeHomeState(JSON.parse(native));
    saveHomeState(restored);
    return restored;
  }
  await invoke<void>('write_native_home_state',{content:JSON.stringify(browser)});
  return browser;
}

export async function saveNativeHomeState(state:HomeStateV1):Promise<void>{
  if(!isTauri())return;
  await invoke<void>('write_native_home_state',{content:JSON.stringify(sanitizeHomeState(state))});
}
