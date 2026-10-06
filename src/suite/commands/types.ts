export type DocumentCommandId =
  | 'save'
  | 'save-as'
  | 'export'
  | 'undo'
  | 'redo'
  | 'print'
  | 'share'
  | 'sign'
  | 'ocr'
  | 'ai'
  | 'automate'
  | 'version-history'
  | 'security'
  | 'properties'
  | 'attach'
  | 'add-form-field'
  | 'flatten-form'
  | 'header-footer'
  | 'bates'
  | 'page-box';

export interface DocumentCommandDescriptor {
  id: DocumentCommandId;
  label: string;
  keywords?: string;
  detail?: string;
  enabled: boolean;
  disabledReason?: string;
  run(): void | Promise<void>;
}

export interface DocumentCommandController {
  list(): DocumentCommandDescriptor[];
}

export type RegisterDocumentCommands = (controller: DocumentCommandController | null) => void;
