import { Button } from '@constructive-io/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@constructive-io/ui/card';
import { Input } from '@constructive-io/ui/input';
import { Label } from '@constructive-io/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@constructive-io/ui/tabs';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { dcrypt } from '../lib/ipc';
import { ThemeMode } from '../lib/theme';
import { useThemeMode } from '../lib/theme-context';

const THEME_MODES: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export const SettingsScreen = ({ onLocked }: { onLocked: () => void }) => {
  const { themeMode, setThemeMode } = useThemeMode();
  const [file, setFile] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void dcrypt.vault.status().then((status) => setFile(status.file));
  }, []);

  const changePassphrase = async () => {
    if (next.length < 8) {
      toast.error('Choose a master password of at least 8 characters.');
      return;
    }
    if (next !== confirm) {
      toast.error('The passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await dcrypt.vault.changePassphrase(next);
      toast.success('Master password changed. Unlock again with the new password.');
      setNext('');
      setConfirm('');
      await dcrypt.vault.lock();
      onLocked();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
      <h2 className="text-xl font-semibold">Settings</h2>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Match your system appearance or pick one.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={themeMode} onValueChange={(value) => setThemeMode(value as ThemeMode)}>
            <TabsList>
              {THEME_MODES.map(({ value, label }) => (
                <TabsTrigger key={value} value={value}>
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Storage</CardTitle>
          <CardDescription>
            The vault lives entirely on this device as one encrypted file. There is no account and no
            cloud copy — keep your own backups of this file.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <code className="text-sm">{file}</code>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Master password</CardTitle>
          <CardDescription>
            Changing it re-encrypts every stored value and the vault file itself.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex max-w-md flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="next-pass">New master password</Label>
            <Input
              id="next-pass"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm-pass">Confirm</Label>
            <Input
              id="confirm-pass"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <Button onClick={changePassphrase} disabled={busy || !next || !confirm}>
            {busy ? 'Re-encrypting…' : 'Change master password'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
