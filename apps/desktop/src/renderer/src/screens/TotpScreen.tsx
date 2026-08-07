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
import { Progress } from '@constructive-io/ui/progress';
import { Copy, FileUp, Import, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import type { TotpEntry } from '../../../shared/api';
import { formatOtpauthUri } from '../../../shared/otpauth';
import { parseTotpJsonExport } from '../../../shared/totp-import';
import { copyWithTimeout, dcrypt } from '../lib/ipc';

export const TotpScreen = () => {
  const [entries, setEntries] = useState<TotpEntry[]>([]);
  const [showImport, setShowImport] = useState(false);
  const [uri, setUri] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [digits, setDigits] = useState('6');
  const [period, setPeriod] = useState('30');

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

  const addCode = async () => {
    setBusy(true);
    try {
      await dcrypt.totp.importUri(
        formatOtpauthUri({
          label: name.trim(),
          secret: secret.toUpperCase().replace(/\s+/g, ''),
          digits: Number(digits),
          period: Number(period),
          algorithm: 'SHA1',
        })
      );
      toast.success(`Added "${name.trim()}"`);
      setName('');
      setSecret('');
      setDigits('6');
      setPeriod('30');
      setShowAdd(false);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const importJsonFile = async (file: File) => {
    setBusy(true);
    try {
      const parsed = parseTotpJsonExport(await file.text());
      let imported = 0;
      const failures: string[] = [];
      for (const entry of parsed) {
        try {
          await dcrypt.totp.importUri(entry.uri);
          imported += 1;
        } catch (err) {
          failures.push(`${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (imported) toast.success(`Imported ${imported} code${imported === 1 ? '' : 's'}`);
      for (const failure of failures) toast.error(failure);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
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
        <div className="flex gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importJsonFile(file);
            }}
          />
          <Button variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>
            <FileUp className="size-4" /> {busy ? 'Importing…' : 'Import JSON file'}
          </Button>
          <Button variant="outline" onClick={() => setShowImport(true)}>
            <Import className="size-4" /> Import otpauth URI
          </Button>
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="size-4" /> Add code
          </Button>
        </div>
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
              <Plus className="mr-1 size-4" /> Add a code, or import an otpauth URI or JSON export
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a one-time code</DialogTitle>
            <DialogDescription>
              Enter the base32 secret a site shows next to its QR code.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="totp-name">Name</Label>
              <Input
                id="totp-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="GitHub"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="totp-secret">Secret</Label>
              <Input
                id="totp-secret"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="JBSWY3DPEHPK3PXP"
                className="font-mono"
              />
            </div>
            <div className="flex gap-3">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="totp-digits">Digits</Label>
                <Input
                  id="totp-digits"
                  type="number"
                  min={6}
                  max={8}
                  value={digits}
                  onChange={(e) => setDigits(e.target.value)}
                />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="totp-period">Period (seconds)</Label>
                <Input
                  id="totp-period"
                  type="number"
                  min={1}
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                />
              </div>
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={addCode} disabled={busy || !name.trim() || !secret.trim()}>
              {busy ? 'Adding…' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showImport} onOpenChange={setShowImport}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import one-time code</DialogTitle>
            <DialogDescription>
              Paste an otpauth:// URI from another authenticator's export.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-1.5">
            <Label htmlFor="otpauth-uri">otpauth URI</Label>
            <Input
              id="otpauth-uri"
              value={uri}
              onChange={(e) => setUri(e.target.value)}
              placeholder="otpauth://totp/Example:me?secret=..."
              className="font-mono"
            />
          </DialogPanel>
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
