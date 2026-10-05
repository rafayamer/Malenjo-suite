export type ModuleId =
  | 'home' | 'files' | 'dms' | 'pdf' | 'word' | 'spreadsheet' | 'presentation'
  | 'scanner' | 'ocr' | 'ai' | 'sign' | 'invoice' | 'metadata' | 'automation'
  | 'security' | 'cad' | 'dicom' | 'admin' | 'backup' | 'settings' | 'account' | 'help';

export interface SuiteModule {
  id: ModuleId;
  name: string;
  description: string;
  status: 'ready' | 'adapter' | 'planned';
  featureFlag: string;
  engine: string;
  group: 'Core' | 'Create' | 'Intelligence' | 'Enterprise' | 'System';
}

export interface SuiteDocument {
  id: string;
  name: string;
  kind: 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'image' | 'cad' | 'dicom' | 'other';
  path?: string;
  dirty: boolean;
  fidelity: 'native' | 'compatible' | 'warning';
}
