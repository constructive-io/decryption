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
import { Separator } from '@constructive-io/ui/separator';
import { Copy, KeyRound, LogIn, LogOut, Plus, Trash2, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import type { AccountRecord, ApiKeyRecord } from '../../../shared/api';
import { copyWithTimeout, dcrypt } from '../lib/ipc';

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const expiry = (iso: string | null): string =>
  iso ? `expires ${new Date(iso).toLocaleString()}` : 'no expiry';

export const AccountsScreen = () => {
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [busy, setBusy] = useState(false);

  const [showAuth, setShowAuth] = useState<'signIn' | 'signUp' | null>(null);
  const [endpoint, setEndpoint] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [keyFor, setKeyFor] = useState<AccountRecord | null>(null);
  const [keyName, setKeyName] = useState('');
  const [keyDays, setKeyDays] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [nextAccounts, nextKeys] = await Promise.all([
        dcrypt.accounts.list(),
        dcrypt.accounts.keys(),
      ]);
      setAccounts(nextAccounts);
      setKeys(nextKeys);
    } catch {
      // vault locked mid-refresh
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (work: () => Promise<string>): Promise<void> => {
    setBusy(true);
    try {
      toast.success(await work());
      await refresh();
    } catch (error) {
      toast.error(message(error));
    } finally {
      setBusy(false);
    }
  };

  const authenticate = async (): Promise<void> => {
    const mode = showAuth;
    if (!mode) return;
    await run(async () => {
      const account = await dcrypt.accounts[mode]({
        endpoint: endpoint.trim(),
        email: email.trim(),
        password,
      });
      setPassword('');
      setShowAuth(null);
      return mode === 'signUp'
        ? `Created ${account.email}`
        : `Signed in as ${account.email}`;
    });
  };

  const createKey = async (): Promise<void> => {
    const account = keyFor;
    if (!account) return;
    const days = keyDays.trim() ? Number(keyDays) : undefined;
    if (days !== undefined && (!Number.isInteger(days) || days <= 0)) {
      toast.error('Expiry must be a whole number of days');
      return;
    }
    await run(async () => {
      const key = await dcrypt.accounts.createKey(account.itemId, {
        name: keyName.trim(),
        expiresDays: days,
      });
      setKeyName('');
      setKeyDays('');
      setKeyFor(null);
      return `Created "${key.name}" — the secret is in your vault`;
    });
  };

  const copyKey = async (key: ApiKeyRecord): Promise<void> => {
    try {
      copyWithTimeout(await dcrypt.accounts.revealKey(key.itemId));
      toast.success('Key copied — clipboard clears in 30s');
    } catch (error) {
      toast.error(message(error));
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Constructive accounts</h2>
          <p className="text-sm text-muted-foreground">
            Sessions and API keys are held in this vault, encrypted like everything
            else. Signing in is the only thing dcrypt sends over the network.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={busy} onClick={() => setShowAuth('signUp')}>
            <UserPlus className="size-4" /> Sign up
          </Button>
          <Button disabled={busy} onClick={() => setShowAuth('signIn')}>
            <LogIn className="size-4" /> Sign in
          </Button>
        </div>
      </div>

      {!accounts.length && (
        <Card className="border-dashed">
          <CardContent className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            <LogIn className="mr-1 size-4" /> Sign in to a Constructive endpoint to
            manage its API keys here
          </CardContent>
        </Card>
      )}

      {accounts.map((account) => {
        const accountKeys = keys.filter((key) => key.accountItemId === account.itemId);
        return (
          <Card key={account.itemId}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-base">
                <span>{account.email}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {account.signedIn ? 'signed in' : 'signed out'}
                </span>
              </CardTitle>
              <CardDescription className="font-mono text-xs">
                {account.endpoint}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setKeyFor(account)}
                >
                  <Plus className="size-4" /> New API key
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !account.signedIn}
                  onClick={() =>
                    run(async () => {
                      await dcrypt.accounts.signOut(account.itemId);
                      return `Signed out ${account.email}`;
                    })
                  }
                >
                  <LogOut className="size-4" /> Sign out
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await dcrypt.accounts.forget(account.itemId);
                      return `Removed ${account.email} from this vault`;
                    })
                  }
                >
                  <Trash2 className="size-4" /> Forget
                </Button>
              </div>

              {accountKeys.length > 0 && <Separator />}
              {accountKeys.map((key) => (
                <div key={key.itemId} className="flex items-center gap-2 text-sm">
                  <KeyRound className="size-4 text-muted-foreground" />
                  <span className="font-medium">{key.name}</span>
                  <span className="text-xs text-muted-foreground">{expiry(key.expiresAt)}</span>
                  <div className="ml-auto flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Copy ${key.name}`}
                      onClick={() => void copyKey(key)}
                    >
                      <Copy className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Revoke ${key.name}`}
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await dcrypt.accounts.revokeKey(key.itemId);
                          return `Revoked "${key.name}"`;
                        })
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}

      <Dialog open={showAuth !== null} onOpenChange={(open) => !open && setShowAuth(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {showAuth === 'signUp' ? 'Create an account' : 'Sign in'}
            </DialogTitle>
            <DialogDescription>
              dcrypt contacts the endpoint you name and stores the session in this
              vault. Your account password is used for this request and not kept.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="account-endpoint">Endpoint</Label>
              <Input
                id="account-endpoint"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="http://auth.localhost:3000/graphql"
                className="font-mono"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="account-email">Email</Label>
              <Input
                id="account-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="account-password">Password</Label>
              <Input
                id="account-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setShowAuth(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy || !endpoint.trim() || !email.trim() || !password}
              onClick={authenticate}
            >
              {busy ? 'Working…' : showAuth === 'signUp' ? 'Create account' : 'Sign in'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={keyFor !== null} onOpenChange={(open) => !open && setKeyFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New API key</DialogTitle>
            <DialogDescription>
              The server shows a key's secret once. dcrypt writes it straight into the
              vault, so you can copy it whenever you need it.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="key-name">Name</Label>
              <Input
                id="key-name"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                placeholder="ci"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="key-days">Expires in (days, optional)</Label>
              <Input
                id="key-days"
                type="number"
                min={1}
                value={keyDays}
                onChange={(e) => setKeyDays(e.target.value)}
                placeholder="30"
              />
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setKeyFor(null)}>
              Cancel
            </Button>
            <Button disabled={busy || !keyName.trim()} onClick={createKey}>
              {busy ? 'Creating…' : 'Create key'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
