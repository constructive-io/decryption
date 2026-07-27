import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';

import { dcrypt } from './ipc';
import { applyDark, getThemeMode, persistThemeMode, resolveDark, ThemeMode } from './theme';

interface ThemeContextValue {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  dark: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => getThemeMode());
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    void dcrypt.theme.getSystemDark().then(setSystemDark);
    return dcrypt.onSystemThemeChange(setSystemDark);
  }, []);

  const dark = resolveDark(themeMode, systemDark);

  useEffect(() => {
    applyDark(dark);
  }, [dark]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      themeMode,
      dark,
      setThemeMode: (mode) => {
        persistThemeMode(mode);
        setThemeModeState(mode);
      },
    }),
    [themeMode, dark]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useThemeMode = (): ThemeContextValue => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeMode must be used inside <ThemeProvider>');
  return ctx;
};
