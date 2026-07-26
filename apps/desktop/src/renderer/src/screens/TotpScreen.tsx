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
  DialogTitle,
} from '@constructive-io/ui/dialog';
import { Input } from '@constructive-io/ui/input';
import { Label } from '@constructive-io/ui/label';
import { Progress } from '@constructive-io/ui/progress';
import { Copy, Import, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import type { TotpEntry } from '../../../shared/api';
import { copyWithTimeout, dcrypt } from '../lib/ipc';

export const TotpScreen = () => {
  const [entries, setEntries] = useState<TotpEntry[]>([]);
  const [showImport, setShowImport] = useState(false);
  const [uri, setUri] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setEntries(await dcrypt.totp.list());
    } catch {
      // vault locked mid-refresh
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    return () => clearInterval(timer);
  }, [refresh]);

  const importUri = async () => {
    setBusy(true);
    try {
      const item = await dcrypt.totp.importUri(uri.trim());
      toast.success(`Imported "${item.title}"`);
      setUri('');
      setShowImport(false);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">One-time codes</h2>
          <p className="text-sm text-muted-foreground">
            Codes are generated locally by the vault database.
          </p>
        </div>
        <Button variant="outline" onClick={() => setShowImport(true)}>
          <Import className="size-4" /> Import otpauth URI
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {entries.map((entry) => (
          <Card key={entry.item.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{entry.item.title}</CardTitle>
              <CardDescription>refreshes every {entry.period}s</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-3xl tracking-widest">
                  {entry.code.slice(0, 3)} {entry.code.slice(3)}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    copyWithTimeout(entry.code);
                    toast.success('Code copied — clipboard clears in 30s');
                  }}
                  aria-label="Copy code"
                >
                  <Copy className="size-4" />
                </Button>
              </div>
              <Progress value={(entry.remaining / entry.period) * 100} />
            </CardContent>
          </Card>
        ))}
        {!entries.length && (
          <Card className="border-dashed">
            <CardContent className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              <Plus className="mr-1 size-4" /> Add a "One-time code" item or import an otpauth URI
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={showImport} onOpenChange={setShowImport}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import one-time code</DialogTitle>
            <DialogDescription>
              Paste an otpauth:// URI from another authenticator's export.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="otpauth-uri">otpauth URI</Label>
            <Input
              id="otpauth-uri"
              value={uri}
              onChange={(e) => setUri(e.target.value)}
              placeholder="otpauth://totp/Example:me?secret=..."
              className="font-mono"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowImport(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={importUri} disabled={busy || !uri.trim()}>
              {busy ? 'Importing…' : 'Import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
