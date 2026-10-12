import { MonitorCog, Moon, Sun } from 'lucide-react';
import type { SuiteTheme } from './appearance';

interface Props {
  theme: SuiteTheme;
  onThemeChange(theme: SuiteTheme): void;
}

/** Same-window appearance controls; theme persistence belongs to the shell. */
export default function SettingsWorkspace({ theme, onThemeChange }: Props) {
  return <section className="appearance-workspace" aria-labelledby="appearance-page-title">
    <header className="appearance-heading">
      <span className="eyebrow">MALENJO SUITE / SETTINGS</span>
      <h1 id="appearance-page-title">Appearance</h1>
      <p>Choose a comfortable working view. All MALENJO workspaces use the same
        brand colors, document tabs, and commands in both modes.</p>
    </header>
    <section className="appearance-panel" aria-labelledby="appearance-themes-heading">
      <div className="appearance-panel-heading">
        <MonitorCog size={21} aria-hidden="true"/>
        <div>
          <h2 id="appearance-themes-heading">Theme</h2>
          <p>Only two appearance choices are available: Light and Dark.</p>
        </div>
      </div>
      <fieldset className="appearance-options" aria-label="MALENJO appearance">
        <legend>Select application appearance</legend>
        {(['light','dark'] as const).map((option) => {
          const selected = theme === option;
          return <label key={option} className={'appearance-choice'+(selected?' selected':'')}>
            <span className={'appearance-preview '+option} aria-hidden="true">
              <span className="appearance-preview-title"/>
              <span className="appearance-preview-ribbon"><i/><i/><i/></span>
              <span className="appearance-preview-content"><i/><i/></span>
            </span>
            <span className="appearance-choice-label">
              {option === 'light' ? <Sun size={18} aria-hidden="true"/> : <Moon size={18} aria-hidden="true"/>}
              <span>{option === 'light' ? 'Light' : 'Dark'}</span>
              <input type="radio" name="malenjo-appearance" value={option}
                checked={selected} onChange={() => onThemeChange(option)}/>
            </span>
          </label>;
        })}
      </fieldset>
      <p className="appearance-save-state" role="status" aria-live="polite">
        {theme === 'light' ? 'Light' : 'Dark'} appearance selected. The preference is saved on this device
        when local storage is available.
      </p>
    </section>
    <section className="appearance-panel" aria-labelledby="appearance-shortcuts-heading">
      <h2 id="appearance-shortcuts-heading">Keyboard and navigation</h2>
      <p>The ribbon supports Left/Right arrow keys to select categories, Down to
        enter commands, and Escape to return focus. Document tabs support
        arrow-key switching. Use Ctrl+K to search commands and documents.</p>
      <p className="appearance-note">MALENJO preserves the document's own colors;
        changing application appearance does not recolor PDF pages or exported files.</p>
    </section>
  </section>;
}
