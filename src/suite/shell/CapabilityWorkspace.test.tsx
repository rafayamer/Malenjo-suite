import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import CapabilityWorkspace, { CAPABILITY_WORKSPACES, capabilityIds } from './CapabilityWorkspace';

describe('Phase 1 domain-specific desktop interface contracts', () => {
  it('has four distinct source-honest domain workspaces', () => {
    expect(capabilityIds().sort()).toEqual(['account','cad','dicom','invoice']);
    for (const id of capabilityIds()) {
      const model = CAPABILITY_WORKSPACES[id];
      expect(model.id).toBe(id);
      expect(model.tools.length).toBe(4);
      expect(model.formats.length).toBeGreaterThan(0);
      expect(model.checklist.length).toBe(4);
      expect(model.limitation).not.toBe('');
      expect(new Set(model.tools).size).toBe(model.tools.length);
    }
  });

  it.each(capabilityIds())('%s retains real focusable navigation but no fabricated editing', (module) => {
    const html = renderToStaticMarkup(
      <CapabilityWorkspace module={module} onNavigate={() => undefined} />,
    );
    expect(html).toContain('data-capability-module="' + module + '"');
    expect(html).toContain('aria-label="' + CAPABILITY_WORKSPACES[module].name + ' content area"');
    expect(html).toContain('NOT RELEASE-READY');
    expect(html).toContain('capability-inspector');
    expect((html.match(/disabled=""/g)??[]).length).toBe(4);
    expect(html).toContain('Help');
    expect(html).not.toContain('feature-complete yet');
    expect(html).not.toContain('class="empty-icon">M');
  });

  it('discloses staged CAD/DICOM filenames without claiming to decode pixels', () => {
    const html = renderToStaticMarkup(
      <CapabilityWorkspace module="dicom" documentName="patient.dcm" onNavigate={() => undefined}/>,
    );
    expect(html).toContain('File staged: patient.dcm');
    expect(html).toContain('Do not rely on this build for diagnosis');
    expect(html).not.toContain('Patient Name:');
  });
});
