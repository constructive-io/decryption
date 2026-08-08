import { Alert, AlertDescription, AlertTitle } from '@constructive-io/ui/alert';
import { Button } from '@constructive-io/ui/button';
import { Input } from '@constructive-io/ui/input';
import { Label } from '@constructive-io/ui/label';
import { FormEvent, useEffect, useState } from 'react';

import { dcrypt } from '../lib/ipc';

/**
 * The unlock controls that sit on the vault doors. The dcrypt mark behind them
 * belongs to the doors, and doubles as the loader while the key is derived.
 */
export const UnlockScreen = ({
  onUnlocked,
  onWorkingChange,
}: {
  onUnlocked: () => void;
  /** Lets the doors animate their mark while we are busy. */
  onWorkingChange?: (working: boolean) => void;
}) => {
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [exists, setExists] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void dcrypt.vault.status().then((status) => setExists(status.exists));
  }, []);

  useEffect(() => onWorkingChange?.(busy), [busy, onWorkingChange]);

  const creating = exists === false;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!passphrase) return;
    if (creating) {
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
      setBusy(false);
    }
  };

  if (busy) {
    return (
      <div className="flex max-w-md flex-col items-center gap-1 text-center">
        <p className="font-medium">
          {creating
            ? 'Setting up your encrypted database…'
            : 'Unlocking your vault…'}
        </p>
        <p className="text-sm text-muted-foreground">
          {creating
            ? 'Deploying the local database and sealing it under your master password. This first run takes a little longer.'
            : 'Deriving your key and loading the encrypted database.'}
        </p>
      </div>
    );
  }

  return (
    <form className="flex w-80 flex-col gap-3" onSubmit={submit}>
      <div className="text-center">
        <p className="font-medium">
          {creating ? 'Create your vault' : 'Unlock dcrypt'}
        </p>
        <p className="text-sm text-muted-foreground">
          {creating
            ? 'Pick a master password. It never leaves this device and cannot be recovered.'
            : 'Everything stays on this device, sealed under your master password.'}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="master" className="sr-only">
          Master password
        </Label>
        <Input
          id="master"
          type="password"
          placeholder="Master password"
          autoFocus
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          disabled={exists === null}
        />
      </div>
      {creating && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm" className="sr-only">
            Confirm password
          </Label>
          <Input
            id="confirm"
            type="password"
            placeholder="Confirm password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>
            {creating ? 'Cannot create vault' : 'Cannot unlock'}
          </AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={!passphrase}>
        {creating ? 'Create vault' : 'Unlock'}
      </Button>
    </form>
  );
};
