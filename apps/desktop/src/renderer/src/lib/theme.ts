export type ThemeMode = 'system' | 'light' | 'dark';

const THEME_KEY = 'theme';

export function getThemeMode(): ThemeMode {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return 'system';
}

export function persistThemeMode(mode: ThemeMode) {
  if (mode === 'system') {
    localStorage.removeItem(THEME_KEY);
  } else {
    localStorage.setItem(THEME_KEY, mode);
  }
}

export function resolveDark(mode: ThemeMode, systemDark: boolean): boolean {
  return mode === 'dark' || (mode === 'system' && systemDark);
}

export function applyDark(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark);
}
