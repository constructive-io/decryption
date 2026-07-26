import { Button } from '@constructive-io/ui/button';
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
import { useState } from 'react';
import { toast } from 'sonner';

import type { ItemKind, VaultItem } from '../../../shared/api';
import { dcrypt } from '../lib/ipc';
import { PasswordGenerator } from './PasswordGenerator';

const KINDS: { value: ItemKind; label: string }[] = [
  { value: 'login', label: 'Login' },
  { value: 'note', label: 'Secure note' },
  { value: 'card', label: 'Card' },
  { value: 'identity', label: 'Identity' },
  { value: 'wallet', label: 'Wallet' },
  { value: 'totp', label: 'One-time code' },
  { value: 'ssh_key', label: 'SSH key' },
];

export const NewItemDialog = ({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (item: VaultItem) => void;
}) => {
  const [kind, setKind] = useState<ItemKind>('login');
  const [title, setTitle] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [seed, setSeed] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setTitle('');
    setUsername('');
    setPassword('');
    setUrl('');
    setNote('');
    setSeed('');
  };

  const create = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const item = await dcrypt.items.create(kind, title.trim());
      if (kind === 'login') {
        if (username) await dcrypt.fields.set(item.id, 'username', 'username', username, false);
        if (password) await dcrypt.fields.set(item.id, 'password', 'password', password);
        if (url) await dcrypt.organize.addUrl(item.id, url);
      } else if (kind === 'totp') {
        if (seed) {
          await dcrypt.fields.set(item.id, 'seed', 'totp_seed', seed.replace(/\s+/g, '').toUpperCase());
        }
      } else if (note) {
        await dcrypt.fields.set(item.id, 'note', 'text', note);
      }
      toast.success(`Added "${item.title}"`);
      reset();
      onOpenChange(false);
      onCreated(item);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New item</DialogTitle>
          <DialogDescription>Everything is encrypted before it is stored.</DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-4">
          <div className="flex gap-3">
            <div className="flex w-44 flex-col gap-1.5">
              <Label>Type</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as ItemKind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="new-title">Title</Label>
              <Input id="new-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            </div>
          </div>

          {kind === 'login' && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-username">Username</Label>
                <Input id="new-username" value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-password">Password</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <PasswordGenerator onGenerated={setPassword} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-url">Website</Label>
                <Input
                  id="new-url"
                  placeholder="https://example.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>
            </>
          )}

          {kind === 'totp' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-seed">Secret (base32)</Label>
              <Input
                id="new-seed"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                placeholder="JBSWY3DPEHPK3PXP"
                className="font-mono"
              />
            </div>
          )}

          {kind !== 'login' && kind !== 'totp' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-note">Secret value</Label>
              <Input id="new-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={create} disabled={busy || !title.trim()}>
            {busy ? 'Adding…' : 'Add item'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
