export interface MetadataRecord {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
  created: string;
  modified: string;
  format: 'pdf' | 'ooxml' | 'other';
  warnings: string[];
}

export interface RedactionRect {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AuditEvent {
  version: number;
  timestampMs: number;
  action: string;
  severity: string;
  target: string;
  detail: string;
}

export interface AdapterStatus {
  available: boolean;
  version: string;
  detail: string;
}

export interface MalwareScanResult {
  clean: boolean;
  infected: boolean;
  engine: string;
  output: string;
  elapsedMs: number;
}

export interface SignatureValidationResult {
  validCommand: boolean;
  output: string;
  elapsedMs: number;
}
