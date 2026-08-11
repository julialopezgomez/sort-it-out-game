export const THEMES = ['classic', 'berry', 'ocean'] as const;

export type Theme = (typeof THEMES)[number];

export const THEME_OPTIONS: ReadonlyArray<{
  id: Theme;
  swatches: readonly [string, string, string];
}> = [
  { id: 'classic', swatches: ['#0F766E', '#4A6E96', '#E0A32E'] },
  { id: 'berry', swatches: ['#A83E70', '#7E6AA8', '#D99A1E'] },
  { id: 'ocean', swatches: ['#176B87', '#5275B8', '#D3971F'] },
];

const THEME_KEY = 'sortitout.theme.v1';

function isTheme(value: string | null): value is Theme {
  return THEMES.some((theme) => theme === value);
}

export function readTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return isTheme(stored) ? stored : 'classic';
  } catch {
    return 'classic';
  }
}

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;

  if (theme === 'classic') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }

  const browserColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--browser-theme-color')
    .trim();
  if (browserColor) {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', browserColor);
  }
}

export function storeTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* not fatal: the theme simply is not remembered next visit */
  }
  applyTheme(theme);
}

export function initializeTheme(): Theme {
  const theme = readTheme();
  applyTheme(theme);
  return theme;
}
