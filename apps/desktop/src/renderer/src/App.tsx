import { Button } from '@constructive-io/ui/button';
import { Separator } from '@constructive-io/ui/separator';
import { Toaster } from '@constructive-io/ui/sonner';
import { KeyRound, Lock, Settings, ShieldCheck, Timer, Wrench } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { dcrypt } from './lib/ipc';
import { ThemeProvider, useThemeMode } from './lib/theme-context';
import { SettingsScreen } from './screens/SettingsScreen';
import { ToolsScreen } from './screens/ToolsScreen';
import { TotpScreen } from './screens/TotpScreen';
import { UnlockScreen } from './screens/UnlockScreen';
import { VaultScreen } from './screens/VaultScreen';

type Tab = 'vault' | 'codes' | 'tools' | 'settings';

const NAV: { id: Tab; label: string; icon: typeof KeyRound }[] = [
  { id: 'vault', label: 'Vault', icon: KeyRound },
  { id: 'codes', label: 'Codes', icon: Timer },
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const AppContent = () => {
  const { dark } = useThemeMode();
  const [unlocked, setUnlocked] = useState(false);
  const [tab, setTab] = useState<Tab>('vault');

  useEffect(() => dcrypt.onLocked(() => setUnlocked(false)), []);

  useEffect(() => {
    void dcrypt.vault.status().then((s) => setUnlocked(s.unlocked));
  }, []);

  const lock = useCallback(async () => {
    await dcrypt.vault.lock();
    setUnlocked(false);
  }, []);

  if (!unlocked) {
    return (
      <>
        <UnlockScreen onUnlocked={() => setUnlocked(true)} />
        <Toaster theme={dark ? 'dark' : 'light'} position="bottom-right" />
      </>
    );
  }

  return (
    <div className="flex h-screen">
      <aside className="flex w-52 flex-col border-r bg-muted/40 p-3">
        <div className="mb-4 flex items-center gap-2 px-2 pt-1">
          <ShieldCheck className="size-5 text-primary" />
          <span className="text-lg font-semibold">dcrypt</span>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              variant={tab === id ? 'secondary' : 'ghost'}
              className="justify-start gap-2"
              onClick={() => setTab(id)}
            >
              <Icon className="size-4" />
              {label}
            </Button>
          ))}
        </nav>
        <div className="mt-auto">
          <Separator className="my-3" />
          <Button variant="outline" className="w-full justify-start gap-2" onClick={lock}>
            <Lock className="size-4" />
            Lock vault
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-hidden">
        {tab === 'vault' && <VaultScreen />}
        {tab === 'codes' && <TotpScreen />}
        {tab === 'tools' && <ToolsScreen />}
        {tab === 'settings' && <SettingsScreen onLocked={() => setUnlocked(false)} />}
      </main>
      <Toaster theme={dark ? 'dark' : 'light'} position="bottom-right" />
    </div>
  );
};

export const App = () => (
  <ThemeProvider>
    <AppContent />
  </ThemeProvider>
);
