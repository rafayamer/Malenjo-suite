import { open } from '@tauri-apps/plugin-dialog';
import { addLibraryDocumentsByPaths, isDesktopRuntime } from '../files/api';
import type { ImportResult } from '../files/types';
import { locationLabelFromPath, type HomePinnedLocation } from './model';

function pinId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `location-${crypto.randomUUID()}`;
  return `location-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export async function choosePinnedFolder(): Promise<HomePinnedLocation | null> {
  if (!isDesktopRuntime()) return null;
  const selected=await open({
    title:'Pin a folder to MALENJO Home',
    directory:true,
    multiple:false,
  });
  if (!selected || Array.isArray(selected)) return null;
  return {
    id:pinId(),
    label:locationLabelFromPath(selected),
    path:selected,
    addedAt:Date.now(),
  };
}

export async function browsePinnedFolder(location: HomePinnedLocation): Promise<ImportResult | null> {
  if (!isDesktopRuntime()) return null;
  const selected=await open({
    title:`Open documents from ${location.label}`,
    directory:false,
    multiple:true,
    defaultPath:location.path,
  });
  if (selected===null) return null;
  const paths=Array.isArray(selected) ? selected : [selected];
  return addLibraryDocumentsByPaths(paths);
}
