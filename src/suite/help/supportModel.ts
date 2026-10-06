import type { SuiteModule } from '../core/types';

export interface HelpGuide {
  id: string;
  title: string;
  summary: string;
  keywords: string;
  steps: string[];
}

export interface ProviderDiagnostic {
  id: string;
  name: string;
  state: 'ready' | 'unavailable' | 'not-applicable' | 'checking';
  detail: string;
  version?: string;
}

export interface SupportBundleInput {
  version: string;
  build: string;
  runtime: 'desktop' | 'browser';
  userAgent: string;
  language: string;
  platform: string;
  online: boolean;
  openDocumentCount: number;
  modules: SuiteModule[];
  providers: ProviderDiagnostic[];
  systemStatus: Record<string, unknown>;
}

export interface SupportBundle {
  schemaVersion: 1;
  product: 'Malenjo Suite';
  publisher: 'Rafius Tech LLC';
  edition: 'Student / noncommercial';
  generatedAt: string;
  privacy: {
    documentNamesIncluded: false;
    documentContentsIncluded: false;
    ocrTextIncluded: false;
    secretsIncluded: false;
  };
  application: {
    version: string;
    build: string;
    runtime: 'desktop' | 'browser';
    openDocumentCount: number;
  };
  environment: {
    userAgent: string;
    language: string;
    platform: string;
    online: boolean;
  };
  moduleSummary: Record<'complete' | 'partial' | 'foundation' | 'adapter' | 'planned', number>;
  providers: ProviderDiagnostic[];
  systemStatus: Record<string, unknown>;
}

const SENSITIVE_KEY = /(password|passwd|passphrase|secret|token|api.?key|private.?key|authorization|cookie|credential|ocr.?text|document.?content|document.?name|file.?path|full.?path)/i;
const WINDOWS_PATH = /\b[A-Za-z]:\\(?:[^\s"'<>|]+\\)*[^\s"'<>|]*/g;
const POSIX_HOME_PATH = /(?:^|\s)(\/(?:home|Users)\/[^\s"'<>]+(?:\/[^\s"'<>]+)*)/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const KEY_VALUE_SECRET = /\b(password|passwd|passphrase|token|api[_-]?key|secret)\s*[:=]\s*[^\s,;]+/gi;

function redactString(value: string): string {
  return value
    .replace(BEARER, 'Bearer [REDACTED]')
    .replace(KEY_VALUE_SECRET, '$1=[REDACTED]')
    .replace(WINDOWS_PATH, '[LOCAL_PATH_REDACTED]')
    .replace(POSIX_HOME_PATH, ' [LOCAL_PATH_REDACTED]');
}

export function redactDiagnosticValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactDiagnosticValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactDiagnosticValue(nested),
      ]),
    );
  }
  return typeof value === 'string' ? redactString(value) : value;
}

export function buildSupportBundle(input: SupportBundleInput): SupportBundle {
  const counts: SupportBundle['moduleSummary'] = {
    complete: 0,
    partial: 0,
    foundation: 0,
    adapter: 0,
    planned: 0,
  };
  input.modules.forEach((module) => { counts[module.status] += 1; });

  const bundle: SupportBundle = {
    schemaVersion: 1,
    product: 'Malenjo Suite',
    publisher: 'Rafius Tech LLC',
    edition: 'Student / noncommercial',
    generatedAt: new Date().toISOString(),
    privacy: {
      documentNamesIncluded: false,
      documentContentsIncluded: false,
      ocrTextIncluded: false,
      secretsIncluded: false,
    },
    application: {
      version: input.version,
      build: input.build,
      runtime: input.runtime,
      openDocumentCount: Math.max(0, Math.trunc(input.openDocumentCount)),
    },
    environment: {
      userAgent: input.userAgent,
      language: input.language,
      platform: input.platform,
      online: input.online,
    },
    moduleSummary: counts,
    providers: input.providers,
    systemStatus: input.systemStatus,
  };

  return redactDiagnosticValue(bundle) as SupportBundle;
}

export function serializeSupportBundle(bundle: SupportBundle): string {
  return JSON.stringify(redactDiagnosticValue(bundle), null, 2);
}

export const HELP_GUIDES: HelpGuide[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    summary: 'Open local files, switch workspaces and use the global command palette.',
    keywords: 'open file library workspace ctrl k command palette tabs',
    steps: [
      'Use Open or Ctrl/Cmd+O to add one or more local documents.',
      'MALENJO routes supported files to the appropriate workspace automatically.',
      'Use the persistent document tabs to switch between open files.',
      'Press Ctrl/Cmd+K to search actions, documents, settings and workspaces.',
    ],
  },
  {
    id: 'saving-recovery',
    title: 'Saving and recovery',
    summary: 'Understand dirty/saving indicators and avoid accidental data loss.',
    keywords: 'save dirty saving recovery close tab copy export',
    steps: [
      'A tab marks unsaved edits independently from other documents.',
      'Wait for the Saving indicator to clear before closing or replacing a document.',
      'MALENJO asks before closing tabs with unsaved edits.',
      'Use workspace Export/Save Copy commands when the active editor exposes them.',
    ],
  },
  {
    id: 'scanner-ocr',
    title: 'Scanner and OCR',
    summary: 'Capture or import pages, correct them, then run local OCR where available.',
    keywords: 'scanner camera ocr paddle searchable pdf image capture',
    steps: [
      'Open Scan for capture/import and page cleanup.',
      'Open OCR for text recognition and searchable-document workflows.',
      'Provider availability is shown in Diagnostics; missing optional engines are reported rather than silently simulated.',
      'OCR errors or unsupported inputs do not imply the source document was modified.',
    ],
  },
  {
    id: 'local-ai',
    title: 'Malenjo AI',
    summary: 'Use the local-first AI workspace and verify which local provider is available.',
    keywords: 'ai ollama llama local offline rag model',
    steps: [
      'Open Malenjo AI from navigation or Ctrl/Cmd+K.',
      'The provider status identifies whether Ollama or llama.cpp is reachable.',
      'Local AI is optional; document workspaces must remain usable without a running model.',
      'Generated answers should be treated separately from retrieved document evidence.',
    ],
  },
  {
    id: 'sign-security',
    title: 'Signing and security',
    summary: 'Locate signature validation, malware scanning, metadata and protection tools.',
    keywords: 'sign signature certificate pyhanko security clamav metadata sanitize',
    steps: [
      'Use Sign for supported PDF certificate/signature workflows.',
      'Use Security Center for implemented sanitization, malware and audit controls.',
      'Use Metadata Studio for supported metadata inspection and sanitization.',
      'Unavailable external tools are shown explicitly in Diagnostics.',
    ],
  },
  {
    id: 'codespaces',
    title: 'Codespaces / browser differences',
    summary: 'Know which capabilities are session-only outside the Tauri desktop runtime.',
    keywords: 'codespaces browser desktop tauri session files temporary',
    steps: [
      'Browser/Codespaces files are session-only and are not a persistent desktop library.',
      'Native-only integrations such as local OS utilities may be marked not applicable.',
      'The constrained local-AI development bridge can reach supported loopback AI providers when they are running inside the Codespace.',
      'Use the desktop build for Windows-specific hardware, filesystem and packaging validation.',
    ],
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    summary: 'Refresh diagnostics, inspect provider state and export a privacy-redacted support bundle.',
    keywords: 'troubleshoot diagnostic error provider bundle export support',
    steps: [
      'Open Help / Support and choose Refresh diagnostics.',
      'Check whether the affected optional provider is ready or unavailable.',
      'Copy or export the diagnostic bundle when you need reproducible technical context.',
      'The support bundle intentionally excludes document names, document contents, OCR text and secrets.',
    ],
  },
  {
    id: 'keyboard',
    title: 'Keyboard reference',
    summary: 'Core shell shortcuts that work across supported workspaces.',
    keywords: 'keyboard shortcuts ctrl k ctrl o ctrl w ctrl tab escape',
    steps: [
      'Ctrl/Cmd+K — open global command palette.',
      'Ctrl/Cmd+O — open document(s).',
      'Ctrl+Tab / Ctrl+Shift+Tab — cycle open document tabs.',
      'Ctrl/Cmd+W — close active document; Ctrl/Cmd+Shift+W — close all tabs.',
      'Escape — close transient command surfaces where supported.',
    ],
  },
];

export function filterHelpGuides(query: string): HelpGuide[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return HELP_GUIDES;
  return HELP_GUIDES.filter((guide) => {
    const haystack = [guide.title, guide.summary, guide.keywords, ...guide.steps].join(' ').toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export const THIRD_PARTY_NOTICE_SUMMARY = [
  'MALENJO uses third-party open-source libraries and optional external engines behind product-owned adapters.',
  'Exact versions, direct/material transitive licenses, models, fonts, codecs and binaries must be re-verified for each release.',
  'The repository policy requires SBOM/provenance generation and forbids casually vendoring proprietary or unclear-license components.',
];
