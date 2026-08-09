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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@constructive-io/ui/select';
import { Separator } from '@constructive-io/ui/separator';
import {
  Copy,
  Database,
  KeyRound,
  LogIn,
  LogOut,
  Plus,
  ShieldUser,
  Timer,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import type {
  AccountRecord,
  ApiKeyRecord,
  PrincipalRecord,
  StepUpProof,
  TotpEntry,
} from '../../../shared/api';
import { knownOrgIds, principalReach } from '../../../shared/principal';
import {
  StepUpKind,
  stepUpKind,
  stepUpPrompt,
  stepUpProof,
} from '../../../shared/step-up';
import { copyWithTimeout, dcrypt } from '../lib/ipc';

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const expiry = (iso: string | null): string =>
  iso ? `expires ${new Date(iso).toLocaleString()}` : 'no expiry';

/**
 * Personal reaches wherever its owner does; organization narrows it to one org.
 * A third choice — "another organization" — only picks the id, not the scope.
 */
type PrincipalScope = 'personal' | 'organization';

const OTHER_ORG = 'other';

/** A request the server refused until a factor is re-proved, kept to replay. */
interface HeldRequest {
  kind: StepUpKind;
  work: (proof?: StepUpProof) => Promise<string>;
}

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
  const [keyPrincipal, setKeyPrincipal] = useState<PrincipalRecord | null>(null);
  const [keyDatabase, setKeyDatabase] = useState('');

  const [tagFor, setTagFor] = useState<ApiKeyRecord | null>(null);
  const [tagValue, setTagValue] = useState('');

  const [principals, setPrincipals] = useState<Record<string, PrincipalRecord[]>>({});
  const [principalFor, setPrincipalFor] = useState<AccountRecord | null>(null);
  const [principalName, setPrincipalName] = useState('');
  const [principalScope, setPrincipalScope] = useState<PrincipalScope>('personal');
  const [principalOrgChoice, setPrincipalOrgChoice] = useState('');
  const [principalOrg, setPrincipalOrg] = useState('');
  const [principalReadOnly, setPrincipalReadOnly] = useState(true);
  const [principalBypass, setPrincipalBypass] = useState(false);

  const [held, setHeld] = useState<HeldRequest | null>(null);
  const [proofValue, setProofValue] = useState('');

  const [codes, setCodes] = useState<TotpEntry[]>([]);
  const [linkFor, setLinkFor] = useState<AccountRecord | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextAccounts, nextKeys, nextCodes] = await Promise.all([
        dcrypt.accounts.list(),
        dcrypt.accounts.keys(),
        dcrypt.totp.list(),
      ]);
      setAccounts(nextAccounts);
      setKeys(nextKeys);
      setCodes(nextCodes);

      // principals live on the server; a signed-out account simply has none to show
      const signedIn = nextAccounts.filter((account) => account.signedIn);
      const fetched = await Promise.all(
        signedIn.map(async (account) => {
          try {
            return [account.itemId, await dcrypt.accounts.principals(account.itemId)] as const;
          } catch {
            return [account.itemId, []] as const;
          }
        })
      );
      setPrincipals(Object.fromEntries(fetched));
    } catch {
      // vault locked mid-refresh
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Run an operation and, if the server asks for a fresh factor, keep the very
   * same closure so the dialog can replay it once a proof has been collected —
   * the request is held, never rebuilt from state that may have moved on.
   */
  const run = async (
    work: (proof?: StepUpProof) => Promise<string>,
    proof?: StepUpProof
  ): Promise<void> => {
    setBusy(true);
    try {
      const result = await work(proof);
      setHeld(null);
      setProofValue('');
      toast.success(result);
      await refresh();
    } catch (error) {
      const kind = stepUpKind(message(error));
      if (kind) {
        setHeld({ kind, work });
        setProofValue('');
      } else {
        toast.error(message(error));
      }
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
    const request = {
      name: keyName.trim(),
      expiresDays: days,
      principalId: keyPrincipal?.principalId,
      orgId: keyPrincipal?.entityIds[0],
      databaseId: keyDatabase.trim() || undefined,
    };
    await run(async (proof) => {
      const key = await dcrypt.accounts.createKey(account.itemId, request, proof);
      setKeyName('');
      setKeyDays('');
      setKeyPrincipal(null);
      setKeyDatabase('');
      setKeyFor(null);
      return keyPrincipal
        ? `Created "${key.name}" as ${keyPrincipal.name} — the secret is in your vault`
        : `Created "${key.name}" — the secret is in your vault`;
    });
  };

  const orgOptions = principalFor
    ? knownOrgIds(
      principals[principalFor.itemId] ?? [],
      keys.filter((key) => key.accountItemId === principalFor.itemId)
    )
    : [];
  const chosenOrgId =
    principalOrgChoice === OTHER_ORG ? principalOrg.trim() : principalOrgChoice;

  const createPrincipal = async (): Promise<void> => {
    const account = principalFor;
    if (!account) return;
    const request = {
      name: principalName.trim(),
      // a personal principal carries no org at all, rather than an empty one
      ...(principalScope === 'organization' ? { orgId: chosenOrgId } : {}),
      isReadOnly: principalReadOnly,
      bypassStepUp: principalBypass,
    };
    await run(async (proof) => {
      await dcrypt.accounts.createPrincipal(account.itemId, request, proof);
      setPrincipalName('');
      setPrincipalScope('personal');
      setPrincipalOrgChoice('');
      setPrincipalOrg('');
      setPrincipalFor(null);
      return `Created ${request.name} — mint a key as it to give it credentials`;
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
        const accountPrincipals = principals[account.itemId] ?? [];
        const mintedAs = (key: ApiKeyRecord): string =>
          accountPrincipals.find(
            (principal) => principal.principalId === key.principalId
          )?.name ?? 'a principal';
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
                  onClick={() => setPrincipalFor(account)}
                >
                  <ShieldUser className="size-4" /> New principal
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
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    account.totpItemId
                      ? run(async () => {
                        await dcrypt.accounts.unlinkTotp(account.itemId);
                        return 'Code unlinked';
                      })
                      : setLinkFor(account)
                  }
                >
                  <Timer className="size-4" />
                  {account.totpItemId ? 'Unlink code' : 'Link a code'}
                </Button>
              </div>

              {account.totpItemId && (
                <p className="text-xs text-muted-foreground">
                  MFA challenges are answered with{' '}
                  {codes.find((entry) => entry.item.id === account.totpItemId)?.item
                    .title ?? 'a code in this vault'}
                  , so you are not asked for one.
                </p>
              )}

              {accountPrincipals.length > 0 && <Separator />}
              {accountPrincipals.map((principal) => (
                <div key={principal.principalId} className="flex items-start gap-2 text-sm">
                  <ShieldUser className="mt-0.5 size-4 text-muted-foreground" />
                  <div className="flex flex-col">
                    <span className="font-medium">{principal.name}</span>
                    <span className="text-xs text-muted-foreground">{principalReach(principal)}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto"
                    aria-label={`Delete ${principal.name}`}
                    disabled={busy}
                    onClick={() =>
                      run(async (proof) => {
                        await dcrypt.accounts.deletePrincipal(
                          account.itemId,
                          principal.principalId,
                          proof
                        );
                        return `Removed ${principal.name}`;
                      })
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}

              {accountKeys.length > 0 && <Separator />}
              {accountKeys.map((key) => (
                <div key={key.itemId} className="flex items-center gap-2 text-sm">
                  <KeyRound className="size-4 text-muted-foreground" />
                  <span className="font-medium">{key.name}</span>
                  <span className="text-xs text-muted-foreground">{expiry(key.expiresAt)}</span>
                  {key.principalId && (
                    <span className="text-xs text-muted-foreground">
                      as {mintedAs(key)}
                    </span>
                  )}
                  {key.databaseId && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Database className="size-3" /> {key.databaseId}
                    </span>
                  )}
                  <div className="ml-auto flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Tag ${key.name} with a database`}
                      disabled={busy}
                      onClick={() => {
                        setTagValue(key.databaseId ?? '');
                        setTagFor(key);
                      }}
                    >
                      <Database className="size-4" />
                    </Button>
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
                        run(async (proof) => {
                          await dcrypt.accounts.revokeKey(key.itemId, proof);
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
              <p className="text-xs text-muted-foreground">
                The auth plane&apos;s GraphQL URL. A bare host gets{' '}
                <code>/graphql</code> appended.
              </p>
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
            {keyFor && (principals[keyFor.itemId] ?? []).length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label>Mint as</Label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={keyPrincipal ? 'outline' : 'default'}
                    onClick={() => setKeyPrincipal(null)}
                  >
                    Yourself
                  </Button>
                  {(principals[keyFor.itemId] ?? []).map((principal) => (
                    <Button
                      key={principal.principalId}
                      type="button"
                      size="sm"
                      variant={
                        keyPrincipal?.principalId === principal.principalId
                          ? 'default'
                          : 'outline'
                      }
                      onClick={() => setKeyPrincipal(principal)}
                    >
                      <ShieldUser className="size-4" /> {principal.name}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  A key minted as a principal carries that principal&apos;s scope, not a
                  copy of your own access.
                </p>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="key-database">Database (optional)</Label>
              <Input
                id="key-database"
                value={keyDatabase}
                onChange={(e) => setKeyDatabase(e.target.value)}
                placeholder="database id"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Tag the key as that database&apos;s data-plane token, and dcrypt will serve
                it to a harness asking for one.
              </p>
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

      <Dialog open={tagFor !== null} onOpenChange={(open) => !open && setTagFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Which database is this key for?</DialogTitle>
            <DialogDescription>
              dcrypt serves a tagged key to a harness asking for that database&apos;s data
              token. Only one key may claim a database — with two, it refuses rather than
              picks.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-1.5">
            <Label htmlFor="tag-database">Database</Label>
            <Input
              id="tag-database"
              value={tagValue}
              onChange={(e) => setTagValue(e.target.value)}
              placeholder="database id"
              className="font-mono"
            />
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setTagFor(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy || !tagValue.trim()}
              onClick={() => {
                const key = tagFor;
                if (!key) return;
                void run(async () => {
                  await dcrypt.accounts.assignKeyToDatabase(key.itemId, tagValue.trim());
                  setTagFor(null);
                  return `"${key.name}" now answers for ${tagValue.trim()}`;
                });
              }}
            >
              {busy ? 'Saving…' : 'Tag key'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={principalFor !== null}
        onOpenChange={(open) => !open && setPrincipalFor(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New principal</DialogTitle>
            <DialogDescription>
              A principal is a scoped sub-identity for keys and agents. It is owned by
              this account and can only ever narrow it — never reach further than you do.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="principal-name">Name</Label>
              <Input
                id="principal-name"
                value={principalName}
                onChange={(e) => setPrincipalName(e.target.value)}
                placeholder="ci-deploy"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="principal-scope">Scope</Label>
              <Select
                value={principalScope}
                onValueChange={(value) => setPrincipalScope(value as PrincipalScope)}
              >
                <SelectTrigger id="principal-scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">Personal</SelectItem>
                  <SelectItem value="organization">Organization</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {principalScope === 'personal'
                  ? 'Owned by you, reaching wherever you do — the shape an unattended job of your own wants.'
                  : 'Narrowed to one organization you work in.'}
              </p>
            </div>
            {principalScope === 'organization' && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="principal-org">Organization</Label>
                <Select
                  value={principalOrgChoice}
                  onValueChange={setPrincipalOrgChoice}
                >
                  <SelectTrigger id="principal-org">
                    <SelectValue placeholder="Choose an organization" />
                  </SelectTrigger>
                  <SelectContent>
                    {orgOptions.map((orgId) => (
                      <SelectItem key={orgId} value={orgId} className="font-mono">
                        {orgId}
                      </SelectItem>
                    ))}
                    <SelectItem value={OTHER_ORG}>Another organization…</SelectItem>
                  </SelectContent>
                </Select>
                {principalOrgChoice === OTHER_ORG && (
                  <Input
                    value={principalOrg}
                    onChange={(e) => setPrincipalOrg(e.target.value)}
                    placeholder="org id"
                    className="font-mono"
                  />
                )}
                <p className="text-xs text-muted-foreground">
                  {orgOptions.length
                    ? 'Organizations this account has already scoped a principal or key to.'
                    : 'Nothing scoped yet from this account, so the id has to be typed once.'}
                </p>
              </div>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={principalReadOnly ? 'default' : 'outline'}
                onClick={() => setPrincipalReadOnly(!principalReadOnly)}
              >
                Read-only
              </Button>
              <Button
                type="button"
                size="sm"
                variant={principalBypass ? 'default' : 'outline'}
                onClick={() => setPrincipalBypass(!principalBypass)}
              >
                Skips step-up
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Skipping step-up is what lets an unattended job use its key without a
              one-time code, so pair it with read-only unless the job needs to write.
            </p>
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setPrincipalFor(null)}>
              Cancel
            </Button>
            <Button
              disabled={
                busy ||
                !principalName.trim() ||
                (principalScope === 'organization' && !chosenOrgId)
              }
              onClick={createPrincipal}
            >
              {busy ? 'Creating…' : 'Create principal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={linkFor !== null} onOpenChange={(open) => !open && setLinkFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link a one-time code</DialogTitle>
            <DialogDescription>
              When the server asks this account for MFA, dcrypt answers with the code
              you pick here. Only the item is remembered — the seed stays where it is.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-2">
            {codes.length === 0 && (
              <p className="text-sm text-muted-foreground">
                This vault holds no one-time codes yet.
              </p>
            )}
            {codes.map((entry) => (
              <Button
                key={entry.item.id}
                variant="outline"
                className="justify-between"
                disabled={busy}
                onClick={() => {
                  const account = linkFor;
                  if (!account) return;
                  setLinkFor(null);
                  void run(async () => {
                    await dcrypt.accounts.linkTotp(account.itemId, entry.item.id);
                    return `${entry.item.title} will answer MFA for ${account.email}`;
                  });
                }}
              >
                <span>{entry.item.title}</span>
                <Timer className="size-4 text-muted-foreground" />
              </Button>
            ))}
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setLinkFor(null)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={held !== null} onOpenChange={(open) => !open && setHeld(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{held ? stepUpPrompt(held.kind).title : ''}</DialogTitle>
            <DialogDescription>
              {held ? stepUpPrompt(held.kind).hint : ''} Your request is waiting and
              will be sent again as soon as this is accepted.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-1.5">
            <Label htmlFor="step-up-value">
              {held ? stepUpPrompt(held.kind).label : ''}
            </Label>
            <Input
              id="step-up-value"
              type={held?.kind === 'mfa' ? 'text' : 'password'}
              inputMode={held?.kind === 'mfa' ? 'numeric' : undefined}
              autoFocus
              value={proofValue}
              onChange={(e) => setProofValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && held && proofValue) {
                  void run(held.work, stepUpProof(held.kind, proofValue));
                }
              }}
            />
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setHeld(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy || !held || !proofValue}
              onClick={() => held && run(held.work, stepUpProof(held.kind, proofValue))}
            >
              {busy ? 'Verifying…' : 'Confirm and continue'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
