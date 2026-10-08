export type DocumentCommandId =
  | 'save'
  | 'save-as'
  | 'export'
  | 'export-text'
  | 'images-to-pdf'
  | 'export-page-images'
  | 'compare-pdf-text'
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
  | 'fill-form'
  | 'flatten-form'
  | 'header-footer'
  | 'bates'
  | 'pdf-page-label'
  | 'page-box'
  | 'toggle-inspector'
  | 'pdf-text-place'
  | 'pdf-rectangle-add'
  | 'pdf-pages-remove'
  | 'pdf-page-copy'
  | 'pdf-pages-turn'
  | 'pdf-pages-extract'
  | 'pdf-document-split'
  | 'pdf-bookmark-create'
  | 'pdf-link-add'
  | 'pdf-comments-open'
  | 'pdf-comment-create'
  | 'pdf-signatures-open';

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
