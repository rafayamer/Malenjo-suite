import {
  CircleHelp, FileText, FolderOpen, HeartPulse, Layers3, LockKeyhole,
  Receipt, Ruler, Settings2, ShieldCheck, type LucideIcon,
} from 'lucide-react';
import type { ModuleId } from '../core/types';

export type CapabilityModuleId = 'cad' | 'dicom' | 'invoice' | 'account';

interface CapabilityDefinition {
  id: CapabilityModuleId;
  name: string;
  eyebrow: string;
  description: string;
  limitation: string;
  icon: LucideIcon;
  tools: readonly string[];
  formats: readonly string[];
  checklist: readonly string[];
}

export const CAPABILITY_WORKSPACES: Record<CapabilityModuleId, CapabilityDefinition> = {
  cad: {
    id: 'cad', name: 'CAD', eyebrow: 'ENGINEERING DRAWINGS',
    description: 'Workspace for technical drawings, layers, measurements and geometry.',
    limitation: 'DWG and DXF rendering/editing are not verified yet. MALENJO will not display a fabricated drawing or claim an unsafe file export.',
    icon: Ruler,
    tools: ['Open drawing', 'Layers', 'Measure', 'Export drawing'],
    formats: ['DXF · adapter required', 'DWG · decoder required'],
    checklist: ['Geometry and units', 'Layer visibility', 'Measurement precision', 'Independent DXF/DWG round-trip'],
  },
  dicom: {
    id: 'dicom', name: 'DICOM', eyebrow: 'MEDICAL IMAGING',
    description: 'Local medical image viewer with privacy-first image inspection.',
    limitation: 'DICOM transfer syntax, pixel decoding and patient metadata have not passed medical imaging validation. Do not rely on this build for diagnosis.',
    icon: HeartPulse,
    tools: ['Open study', 'Window / level', 'Frames', 'Export image'],
    formats: ['DICOM (.dcm/.dicom) · decoder required'],
    checklist: ['Transfer syntaxes', 'Window / level', 'Multi-frame handling', 'Patient privacy and output validation'],
  },
  invoice: {
    id: 'invoice', name: 'Invoice Studio', eyebrow: 'BILLING DOCUMENTS',
    description: 'Create locally calculated invoices and export verifiable records.',
    limitation: 'Invoice calculations, taxes, numbering, templates and exports are not release-verified. No payable invoice can be generated from this interface yet.',
    icon: Receipt,
    tools: ['New invoice', 'Line items', 'Taxes', 'PDF invoice'],
    formats: ['Invoice templates · unavailable', 'PDF output · unavailable'],
    checklist: ['Tax and rounding accuracy', 'Unique invoice numbering', 'Template editing', 'Independent PDF output verification'],
  },
  account: {
    id: 'account', name: 'Account', eyebrow: 'LOCAL IDENTITY',
    description: 'Control local account identity and device-level workspace preferences.',
    limitation: 'Account identity, profile persistence and authorization have not passed the release contract. No cloud sign-in or personal identity is implied.',
    icon: LockKeyhole,
    tools: ['Edit local profile', 'Device identity', 'Permissions', 'Export profile'],
    formats: ['Local profile · unavailable', 'Cloud identity · not enabled'],
    checklist: ['Profile persistence', 'Identity boundaries', 'Device recovery', 'Authorization and privacy'],
  },
};

export function capabilityIds(): CapabilityModuleId[] {
  return Object.keys(CAPABILITY_WORKSPACES) as CapabilityModuleId[];
}

interface Props {
  module: CapabilityModuleId;
  onNavigate(module: ModuleId): void;
}

/** Honest, domain-specific single-window UI until the actual feature engines pass acceptance. */
export default function CapabilityWorkspace({ module, onNavigate }: Props) {
  const model = CAPABILITY_WORKSPACES[module];
  const Icon = model.icon;
  const guidance = module === 'account' ? 'settings' : 'files';
  return <section className="capability-workspace" aria-labelledby={'capability-heading-' + module} data-capability-module={module}>
    <header className="capability-header">
      <div className="capability-identity">
        <span className="capability-big-icon"><Icon size={28} aria-hidden="true"/></span>
        <div>
          <p className="eyebrow">{model.eyebrow}</p>
          <h1 id={'capability-heading-' + module}>{model.name}</h1>
          <p>{model.description}</p>
        </div>
      </div>
      <span className="capability-status" role="status"><ShieldCheck size={15} aria-hidden="true"/> NOT RELEASE-READY</span>
    </header>

    <section className="capability-command-strip" aria-label={model.name + ' command bar'}>
      {model.tools.map((tool) =>
        <button key={tool} type="button" disabled aria-describedby={'capability-reason-' + module}
          title={'Unavailable: ' + model.limitation}>
          <Layers3 size={18} aria-hidden="true"/><span>{tool}</span>
        </button>
      )}
      <button type="button" className="capability-live-command" onClick={() => onNavigate(guidance)}>
        {module === 'account' ? <Settings2 size={18} aria-hidden="true"/> : <FolderOpen size={18} aria-hidden="true"/>}
        {module === 'account' ? 'Appearance settings' : 'Files / Library'}
      </button>
      <button type="button" className="capability-live-command" onClick={() => onNavigate('help')}>
        <CircleHelp size={18} aria-hidden="true"/> Help
      </button>
    </section>

    <div className="capability-body">
      <section className="capability-canvas" aria-label={model.name + ' content area'}>
        <div className="capability-empty">
          <Icon size={46} strokeWidth={1.4} aria-hidden="true"/>
          <h2>{model.name} viewer/editor unavailable</h2>
          <p id={'capability-reason-' + module}>{model.limitation}</p>
          <div className="capability-canvas-actions">
            <button type="button" onClick={() => onNavigate(guidance)}>
              {module === 'account' ? 'Open settings' : 'Open Files / Library'}
            </button>
          </div>
        </div>
      </section>
      <aside className="capability-inspector" aria-label={model.name + ' capability inspector'}>
        <h2><FileText size={17} aria-hidden="true"/> Supported formats</h2>
        <ul>{model.formats.map((format) => <li key={format}>{format}</li>)}</ul>
        <h2>Required verification</h2>
        <ul className="capability-checks">{model.checklist.map((item) =>
          <li key={item}><span aria-hidden="true">○</span> {item}</li>
        )}</ul>
        <p className="capability-local-note">No user data is sent to an external service by this unavailable workspace.</p>
      </aside>
    </div>
  </section>;
}
