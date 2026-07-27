import { Alert, AlertDescription, AlertTitle } from '@constructive-io/ui/alert';
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
import { ShieldCheck } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';

import { Loader } from '../components/Loader';
import { dcrypt } from '../lib/ipc';

export const UnlockScreen = ({ onUnlocked }: { onUnlocked: () => void }) => {
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [exists, setExists] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void dcrypt.vault.status().then((status) => setExists(status.exists));
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!passphrase) return;
    if (exists === false) {
      if (passphrase.length < 8) {
        setError('Choose a master password of at least 8 characters.');
        return;
      }
      if (passphrase !== confirm) {
        setError('The passwords do not match.');
        return;
      }
    }
    setBusy(true);
    try {
      await dcrypt.vault.unlock(passphrase);
      setPassphrase('');
      setConfirm('');
      onUnlocked();
    } catch (err) {
      setError(
        err instanceof Error && /passphrase/i.test(err.message)
          ? 'Wrong master password.'
          : `Could not unlock: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setBusy(false);
    }
  };

  const creating = exists === false;

  if (busy) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-6 bg-muted/30">
        <Loader className="h-48" />
        <div className="flex flex-col items-center gap-1 text-center">
          <p className="font-medium">
            {creating ? 'Setting up your encrypted database…' : 'Unlocking your vault…'}
          </p>
          <p className="text-sm text-muted-foreground">
            {creating
              ? 'Deploying the local database and sealing it under your master password. This first run takes a little longer.'
              : 'Deriving your key and loading the encrypted database.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center bg-muted/30">
      <Card className="w-96">
        <CardHeader className="items-center text-center">
          <ShieldCheck className="mb-2 size-10 text-primary" />
          <CardTitle>{creating ? 'Create your vault' : 'Unlock dcrypt'}</CardTitle>
          <CardDescription>
            {creating
              ? 'Pick a master password. It never leaves this device and cannot be recovered.'
              : 'Everything stays on this device, sealed under your master password.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="master">Master password</Label>
              <Input
                id="master"
                type="password"
                autoFocus
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                disabled={busy || exists === null}
              />
            </div>
            {creating && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={busy}
                />
              </div>
            )}
            {error && (
              <Alert variant="destructive">
                <AlertTitle>{creating ? 'Cannot create vault' : 'Cannot unlock'}</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" disabled={busy || !passphrase}>
              {busy ? (creating ? 'Creating…' : 'Unlocking…') : creating ? 'Create vault' : 'Unlock'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};
