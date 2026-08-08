import { Button } from '@constructive-io/ui/button';
import { Separator } from '@constructive-io/ui/separator';
import { Toaster } from '@constructive-io/ui/sonner';
import {
  KeyRound,
  Lock,
  Settings,
  ShieldCheck,
  Timer,
  Wrench,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { DoorState, VaultDoors } from './components/VaultDoors';
import { dcrypt } from './lib/ipc';
import { ThemeProvider, useThemeMode } from './lib/theme-context';
import { SettingsScreen } from './screens/SettingsScreen';
import { ToolsScreen } from './screens/ToolsScreen';
import { TotpScreen } from './screens/TotpScreen';
import { UnlockScreen } from './screens/UnlockScreen';
import { VaultScreen } from './screens/VaultScreen';

type Tab = 'vault' | 'codes' | 'tools' | 'settings';

/** `opening`/`closing` are the door transitions; the vault is mounted for all but `locked`. */
type Phase = 'locked' | 'opening' | 'unlocked' | 'closing';

const NAV: { id: Tab; label: string; icon: typeof KeyRound }[] = [
  { id: 'vault', label: 'Vault', icon: KeyRound },
  { id: 'codes', label: 'Codes', icon: Timer },
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const AppContent = () => {
  const { dark } = useThemeMode();
  const [phase, setPhase] = useState<Phase>('locked');
  const [working, setWorking] = useState(false);
  const [tab, setTab] = useState<Tab>('vault');

  // the main process locks on its own for menu actions and after a restore
  useEffect(
    () =>
      dcrypt.onLocked(() =>
        setPhase((current) => (current === 'unlocked' ? 'closing' : current))
      ),
    []
  );

  useEffect(() => {
    void dcrypt.vault
      .status()
      .then((s) => setPhase(s.unlocked ? 'unlocked' : 'locked'));
  }, []);

  // close the doors and lock at the same time: the flush behind `vault.lock()`
  // is fast, so the animation covers it entirely
  const lock = useCallback(() => {
    setPhase('closing');
    void dcrypt.vault.lock();
  }, []);

  const doorState: DoorState =
    phase === 'opening'
      ? 'opening'
      : phase === 'closing'
        ? 'closing'
        : 'closed';
  const settled = useCallback(() => {
    setWorking(false);
    setPhase((current) => (current === 'opening' ? 'unlocked' : 'locked'));
  }, []);

  return (
    <div className="relative h-screen overflow-hidden">
      {phase !== 'locked' && (
        <div
          className={`flex h-full ${phase === 'opening' ? 'dcrypt-vault-settle' : ''}`}
        >
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
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={lock}
              >
                <Lock className="size-4" />
                Lock vault
              </Button>
            </div>
          </aside>
          <main className="min-w-0 flex-1 overflow-hidden">
            {tab === 'vault' && <VaultScreen />}
            {tab === 'codes' && <TotpScreen />}
            {tab === 'tools' && <ToolsScreen />}
            {tab === 'settings' && (
              <SettingsScreen onLocked={() => setPhase('closing')} />
            )}
          </main>
        </div>
      )}

      {phase !== 'unlocked' && (
        <VaultDoors state={doorState} working={working} onRest={settled}>
          <UnlockScreen
            onUnlocked={() => setPhase('opening')}
            onWorkingChange={setWorking}
          />
        </VaultDoors>
      )}

      <Toaster theme={dark ? 'dark' : 'light'} position="bottom-right" />
    </div>
  );
};

export const App = () => (
  <ThemeProvider>
    <AppContent />
  </ThemeProvider>
);
