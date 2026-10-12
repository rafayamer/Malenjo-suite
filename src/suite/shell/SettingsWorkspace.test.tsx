import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SettingsWorkspace from './SettingsWorkspace';

describe('MALENJO Settings release-gate appearance controls', () => {
  it('renders precisely two accessible mode choices, not System or Auto', () => {
    const html = renderToStaticMarkup(
      <SettingsWorkspace theme="dark" onThemeChange={() => undefined} />,
    );
    expect(html).toContain('Appearance');
    expect(html).toContain('Select application appearance');
    expect((html.match(/type="radio"/g)??[])).toHaveLength(2);
    expect(html).toContain('value="light"');
    expect(html).toContain('value="dark"');
    expect(html).not.toContain('value="system"');
    expect(html).not.toContain('value="auto"');
    expect((html.match(/checked=""/g)??[])).toHaveLength(1);
  });
  it('shows the correct selected choice without a third preference', () => {
    const html = renderToStaticMarkup(
      <SettingsWorkspace theme="light" onThemeChange={() => undefined} />,
    );
    expect(html).toContain('Light appearance selected');
    expect((html.match(/class="appearance-choice selected"/g)??[])).toHaveLength(1);
    expect((html.match(/type="radio"/g)??[])).toHaveLength(2);
  });
});
