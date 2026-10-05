export type LibraryDocumentKind =
  | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'image' | 'cad' | 'dicom' | 'other';

export interface LibraryDocument {
  id: string;
  name: string;
  extension: string;
  kind: LibraryDocumentKind;
  sizeBytes: number;
  modifiedMs: number;
  addedMs: number;
  lastOpenedMs: number | null;
  available: boolean;
  locationLabel: string;
  /**
   * Browser/Codespaces-only ephemeral source.
   * Native library documents never receive this field over IPC.
   */
  browserFile?: File;
  ephemeral?: boolean;
}

export interface ImportFailure {
  path: string;
  message: string;
}

export interface ImportResult {
  documents: LibraryDocument[];
  errors: ImportFailure[];
}

export interface StagedDocument {
  token: string;
  documentId: string;
  name: string;
  extension: string;
}
