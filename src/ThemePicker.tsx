import type { ThemeId } from '../shared/domain';

export const THEMES: { id: ThemeId; label: string; subtitle: string }[] = [
  { id: 'retro', label: 'Rétro SF', subtitle: 'Terminaux, phosphore et écrans CRT' },
  { id: 'imperium', label: 'Imperium', subtitle: 'Gothique impérial, rouge, or et parchemin' },
  { id: 'fantasy', label: 'Fantasy', subtitle: 'Bois, cuir, pierre et parchemin' },
];

export function themeLabel(theme: ThemeId): string {
  return THEMES.find((item) => item.id === theme)?.label ?? theme;
}

interface ThemePickerProps {
  /** Names the group for assistive technology: whose theme this is. */
  label: string;
  theme: ThemeId;
  /** Called on click: the theme applies at once, no confirmation. */
  onChange: (theme: ThemeId) => void;
}

/**
 * The theme choice, on the home page and inside a Campaign (spec #58, story 50): one card per
 * Theme, each showing a small sample panel dressed in that Theme. The sample carries
 * data-theme, so it shows the Theme's own tokens whatever the window's current Theme.
 */
export function ThemePicker({ label, theme, onChange }: ThemePickerProps) {
  return (
    <div className="theme-options" role="group" aria-label={label}>
      {THEMES.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`theme-option${theme === item.id ? ' selected' : ''}`}
          aria-pressed={theme === item.id}
          onClick={() => onChange(item.id)}
        >
          <ThemeSample theme={item.id} />
          <span className="theme-option-text">
            <strong>{item.label}</strong>
            <small>{item.subtitle}</small>
          </span>
          <span className="radio-indicator" />
        </button>
      ))}
    </div>
  );
}

/** A miniature window in `theme`: title bar, a panel with a heading, a line and a button. */
function ThemeSample({ theme }: { theme: ThemeId }) {
  return (
    <span className="theme-sample" data-theme={theme} aria-hidden="true">
      <span className="theme-sample-bar" />
      <span className="theme-sample-panel">
        <span className="theme-sample-heading">Scène</span>
        <span className="theme-sample-line">Notes du MJ</span>
        <span className="theme-sample-button">Diffuser</span>
      </span>
    </span>
  );
}
