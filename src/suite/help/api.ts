import { getVersion } from '@tauri-apps/api/app';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { getLocalAiStatus } from '../ai/api';
import { getPaddleStatus } from '../scanner/ocr';
import type { ProviderDiagnostic, SupportBundle } from './supportModel';
import { serializeSupportBundle } from './supportModel';

interface AdapterStatus {
  available: boolean;
  version?: string;
  detail?: string;
}

interface ServiceDescriptor {
  id?: string;
  name?: string;
  command?: string;
  description?: string;
}

export interface SupportRuntimeSnapshot {
  version: string;
  build: string;
  systemStatus: Record<string, unknown>;
  providers: ProviderDiagnostic[];
}

const WEB_VERSION = '0.1.0';
const BUILD_ID = 'student-noncommercial';

function normalizedError(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function adapterDiagnostic(id: string, name: string, status: AdapterStatus): ProviderDiagnostic {
  return {
    id,
    name,
    state: status.available ? 'ready' : 'unavailable',
    version: status.version?.trim() || undefined,
    detail: status.detail?.trim() || (status.available ? 'Available.' : 'Not available in the current runtime.'),
  };
}

async function nativeAdapter(command: string, id: string, name: string): Promise<ProviderDiagnostic> {
  try {
    return adapterDiagnostic(id, name, await invoke<AdapterStatus>(command));
  } catch (reason) {
    return {
      id,
      name,
      state: 'unavailable',
      detail: normalizedError(reason),
    };
  }
}

async function aiDiagnostic(provider: 'ollama' | 'llama-cpp'): Promise<ProviderDiagnostic> {
  try {
    const status = await getLocalAiStatus(provider);
    return {
      id: `ai-${provider}`,
      name: provider === 'ollama' ? 'Malenjo AI — Ollama' : 'Malenjo AI — llama.cpp',
      state: status.available ? 'ready' : 'unavailable',
      detail: status.message,
      version: status.models.length ? `${status.models.length} model(s) detected` : undefined,
    };
  } catch (reason) {
    return {
      id: `ai-${provider}`,
      name: provider === 'ollama' ? 'Malenjo AI — Ollama' : 'Malenjo AI — llama.cpp',
      state: 'unavailable',
      detail: normalizedError(reason),
    };
  }
}

async function localServiceDiagnostic(): Promise<ProviderDiagnostic> {
  if (!isTauri()) {
    return {
      id: 'local-services',
      name: 'Native local-service manager',
      state: 'not-applicable',
      detail: 'Native process supervision is available only in the Tauri desktop runtime.',
    };
  }
  try {
    const catalog = await invoke<ServiceDescriptor[]>('local_service_catalog');
    return {
      id: 'local-services',
      name: 'Native local-service manager',
      state: 'ready',
      detail: `${catalog.length} supervised service descriptor(s) registered; services are not launched automatically by Help.`,
    };
  } catch (reason) {
    return {
      id: 'local-services',
      name: 'Native local-service manager',
      state: 'unavailable',
      detail: normalizedError(reason),
    };
  }
}

export async function collectSupportRuntime(): Promise<SupportRuntimeSnapshot> {
  const desktop = isTauri();
  const version = desktop ? await getVersion().catch(() => WEB_VERSION) : WEB_VERSION;
  const systemStatus = desktop
    ? await invoke<Record<string, unknown>>('system_status').catch((reason) => ({
        product:'Malenjo Suite',
        diagnosticError:normalizedError(reason),
      }))
    : {
        product:'Malenjo Suite',
        mode:'student-noncommercial',
        localFirst:true,
        runtime:'browser/Codespaces',
        networkRequiredAtStartup:false,
      };

  const common = await Promise.all([
    aiDiagnostic('ollama'),
    aiDiagnostic('llama-cpp'),
    localServiceDiagnostic(),
  ]);

  if (!desktop) {
    return {
      version,
      build:BUILD_ID,
      systemStatus,
      providers:[
        ...common,
        {
          id:'paddle-ocr',
          name:'PaddleOCR native pack',
          state:'not-applicable',
          detail:'The native PaddleOCR pack is checked only in the Tauri desktop runtime.',
        },
        {
          id:'clamav',
          name:'ClamAV',
          state:'not-applicable',
          detail:'ClamAV command integration is desktop-only.',
        },
        {
          id:'pyhanko',
          name:'pyHanko',
          state:'not-applicable',
          detail:'pyHanko command integration is desktop-only.',
        },
        {
          id:'temporal',
          name:'Temporal',
          state:'not-applicable',
          detail:'Temporal adapter diagnostics are desktop-only.',
        },
        {
          id:'kopia',
          name:'Kopia',
          state:'not-applicable',
          detail:'Kopia adapter diagnostics are desktop-only.',
        },
      ],
    };
  }

  const [paddle, clamav, pyhanko, temporal, kopia] = await Promise.all([
    getPaddleStatus()
      .then((status): ProviderDiagnostic => ({
        id:'paddle-ocr',
        name:'PaddleOCR native pack',
        state:status.available ? 'ready' : 'unavailable',
        detail:status.message,
        version:status.python ?? undefined,
      }))
      .catch((reason): ProviderDiagnostic => ({
        id:'paddle-ocr',
        name:'PaddleOCR native pack',
        state:'unavailable',
        detail:normalizedError(reason),
      })),
    nativeAdapter('clamav_status','clamav','ClamAV'),
    nativeAdapter('pyhanko_status','pyhanko','pyHanko'),
    nativeAdapter('temporal_status','temporal','Temporal'),
    nativeAdapter('kopia_status','kopia','Kopia'),
  ]);

  return {
    version,
    build:BUILD_ID,
    systemStatus,
    providers:[...common,paddle,clamav,pyhanko,temporal,kopia],
  };
}

function browserDownload(filename: string, contents: string): void {
  const blob = new Blob([contents], { type:'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function exportSupportBundle(bundle: SupportBundle): Promise<string | null> {
  const contents = serializeSupportBundle(bundle);
  const filename = `malenjo-diagnostics-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;

  if (!isTauri()) {
    browserDownload(filename, contents);
    return filename;
  }

  const destination = await save({
    title:'Export MALENJO diagnostic bundle',
    defaultPath:filename,
    filters:[{ name:'JSON diagnostic bundle', extensions:['json'] }],
  });
  if (!destination) return null;
  await invoke<boolean>('write_support_bundle', { destination, contents });
  return destination;
}

export async function copySupportBundle(bundle: SupportBundle): Promise<boolean> {
  const contents = serializeSupportBundle(bundle);
  if (!navigator.clipboard?.writeText) return false;
  await navigator.clipboard.writeText(contents);
  return true;
}
