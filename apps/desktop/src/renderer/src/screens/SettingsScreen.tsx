import { Button } from '@constructive-io/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@constructive-io/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from '@constructive-io/ui/dialog';
import { Input } from '@constructive-io/ui/input';
import { Label } from '@constructive-io/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@constructive-io/ui/tabs';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { dcrypt } from '../lib/ipc';
import { ThemeMode } from '../lib/theme';
import { useThemeMode } from '../lib/theme-context';

/** Typed verbatim before anything is deleted. */
const ERASE_PHRASE = 'ERASE';

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
  const [eraseOpen, setEraseOpen] = useState(false);
  const [erasePhrase, setErasePhrase] = useState('');

  useEffect(() => {
    void dcrypt.vault.status().then((status) => setFile(status.file));
  }, []);

  const folderWord = navigator.userAgent.includes('Mac')
    ? 'Finder'
    : navigator.userAgent.includes('Windows')
      ? 'Explorer'
      : 'file manager';

  const backUp = async () => {
    setBusy(true);
    try {
      const { path } = await dcrypt.backup.create();
      if (path) toast.success(`Encrypted backup saved to ${path}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    setBusy(true);
    try {
      const { path } = await dcrypt.backup.restore();
      if (!path) return;
      toast.success('Vault restored. Unlock with that backup’s master password.');
      onLocked();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const rebuild = async () => {
    setBusy(true);
    try {
      const report = await dcrypt.vault.rebuild();
      const rows = Object.values(report.copied).reduce((sum, n) => sum + n, 0);
      toast.success(
        `Database rebuilt: ${report.tables} tables deployed, ${rows} rows carried over ` +
          `(${report.copied.items ?? 0} items).`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const eraseAll = async () => {
    setBusy(true);
    try {
      await dcrypt.vault.eraseAll();
      setEraseOpen(false);
      setErasePhrase('');
      onLocked();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

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
            cloud copy.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-3">
          <code className="text-sm break-all">{file}</code>
          <Button variant="outline" onClick={() => void dcrypt.backup.revealVault()}>
            Show in {folderWord}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Backup</CardTitle>
          <CardDescription>
            A backup is a copy of that same encrypted file. It stays sealed with your master password
            — nobody who holds the copy can read it without that password, so it is safe to keep in
            iCloud Drive, OneDrive, Dropbox, or on a USB stick.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Button onClick={backUp} disabled={busy}>
              Back up vault…
            </Button>
            <Button variant="outline" onClick={restore} disabled={busy}>
              Restore from backup…
            </Button>
          </div>
          <p className="text-muted-foreground text-sm">
            Restoring locks the vault and replaces it with the backup you choose; the file it replaces
            is kept alongside it. Unlock with the master password that backup was made with — changing
            your password later does not change older backups.
          </p>
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

      <Card>
        <CardHeader>
          <CardTitle>Database</CardTitle>
          <CardDescription>
            Your items live in a local Postgres database that is deployed the first time you create a
            vault. Rebuilding deploys it again from scratch and moves every item, folder, tag and code
            across — useful after an app update changes the schema. Values move without being
            decrypted, and your master password still opens the result.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={rebuild} disabled={busy}>
            {busy ? 'Working…' : 'Rebuild database'}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">Erase all data</CardTitle>
          <CardDescription>
            Deletes the vault, every stored password and code, the keychain and your identity file —
            everything dcrypt keeps on this device. There is no undo and no cloud copy to recover
            from; only a backup you made yourself can bring it back. dcrypt then starts fresh, as if
            newly installed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setEraseOpen(true)} disabled={busy}>
            Erase all data…
          </Button>
        </CardContent>
      </Card>

      <Dialog
        open={eraseOpen}
        onOpenChange={(open) => {
          setEraseOpen(open);
          if (!open) setErasePhrase('');
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Erase all data?</DialogTitle>
            <DialogDescription>
              This permanently deletes {file} and every other dcrypt file on this device. It cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-2">
            <Label htmlFor="erase-phrase">
              Type {ERASE_PHRASE} to confirm
            </Label>
            <Input
              id="erase-phrase"
              value={erasePhrase}
              onChange={(e) => setErasePhrase(e.target.value)}
              autoFocus
              autoComplete="off"
            />
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEraseOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={eraseAll}
              disabled={busy || erasePhrase !== ERASE_PHRASE}
            >
              {busy ? 'Erasing…' : 'Erase everything'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
