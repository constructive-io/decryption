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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@constructive-io/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@constructive-io/ui/tabs';
import { Textarea } from '@constructive-io/ui/textarea';
import { Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import type { WalletAccountInfo } from '../../../shared/api';
import { copyWithTimeout, dcrypt } from '../lib/ipc';

const NETWORKS = ['cosmoshub', 'osmosis', 'ethereum', 'bitcoin'];

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const WalletTool = () => {
  const [network, setNetwork] = useState('cosmoshub');
  const [words, setWords] = useState('24');
  const [mnemonic, setMnemonic] = useState('');
  const [accounts, setAccounts] = useState<WalletAccountInfo[]>([]);

  const create = async () => {
    try {
      const result = await dcrypt.workbench.createWallet([network], Number(words));
      setMnemonic(result.mnemonic);
      setAccounts(result.accounts);
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const derive = async () => {
    try {
      setAccounts(await dcrypt.workbench.deriveAccounts(mnemonic.trim(), [network]));
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Wallets</CardTitle>
        <CardDescription>
          Offline BIP39 mnemonic generation and address derivation. Nothing ever touches a network.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Network</Label>
            <Select value={network} onValueChange={setNetwork}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NETWORKS.map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Words</Label>
            <Select value={words} onValueChange={setWords}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['12', '15', '18', '21', '24'].map((w) => (
                  <SelectItem key={w} value={w}>
                    {w}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <Button onClick={create}>New wallet</Button>
            <Button variant="outline" onClick={derive} disabled={!mnemonic.trim()}>
              Derive from mnemonic
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tool-mnemonic">Mnemonic</Label>
          <Textarea
            id="tool-mnemonic"
            value={mnemonic}
            onChange={(e) => setMnemonic(e.target.value)}
            className="font-mono"
            rows={2}
          />
        </div>
        {accounts.map((account) => (
          <div key={`${account.network}-${account.path}`} className="flex items-center gap-2 text-sm">
            <span className="w-24 text-muted-foreground">{account.network}</span>
            <code className="flex-1 truncate">{account.address}</code>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                copyWithTimeout(account.address, 60);
                toast.success('Address copied');
              }}
              aria-label="Copy address"
            >
              <Copy className="size-4" />
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

const EncryptTool = () => {
  const [text, setText] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [output, setOutput] = useState('');

  const run = async (direction: 'encrypt' | 'decrypt') => {
    try {
      const result =
        direction === 'encrypt'
          ? await dcrypt.workbench.encryptText(text, passphrase)
          : await dcrypt.workbench.decryptText(text.trim(), passphrase);
      setOutput(result);
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Encrypt / decrypt</CardTitle>
        <CardDescription>
          Modern authenticated encryption (Argon2id + XChaCha20-Poly1305), armored as dcrypt.v1 text.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Plaintext or dcrypt.v1.… armored text"
          rows={4}
          className="font-mono"
        />
        <div className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="tool-pass">Passphrase</Label>
            <Input
              id="tool-pass"
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
          </div>
          <Button onClick={() => void run('encrypt')} disabled={!text || !passphrase}>
            Encrypt
          </Button>
          <Button variant="outline" onClick={() => void run('decrypt')} disabled={!text || !passphrase}>
            Decrypt
          </Button>
        </div>
        {output && (
          <div className="flex items-start gap-2">
            <Textarea readOnly value={output} rows={4} className="font-mono" />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                copyWithTimeout(output, 60);
                toast.success('Copied');
              }}
              aria-label="Copy output"
            >
              <Copy className="size-4" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const LegacyTool = () => {
  const [ciphertext, setCiphertext] = useState('');
  const [salt, setSalt] = useState('');
  const [output, setOutput] = useState('');

  const run = async () => {
    try {
      setOutput(await dcrypt.workbench.legacyDecrypt(ciphertext.trim(), salt));
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Legacy import</CardTitle>
        <CardDescription>
          Decrypt blobs produced by the old CryptoJS-based encryption demo, then re-encrypt them with
          the modern format.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Textarea
          value={ciphertext}
          onChange={(e) => setCiphertext(e.target.value)}
          placeholder="U2FsdGVkX1…"
          rows={3}
          className="font-mono"
        />
        <div className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="legacy-salt">Salt / password</Label>
            <Input
              id="legacy-salt"
              type="password"
              value={salt}
              onChange={(e) => setSalt(e.target.value)}
            />
          </div>
          <Button onClick={run} disabled={!ciphertext || !salt}>
            Decrypt
          </Button>
        </div>
        {output && <Textarea readOnly value={output} rows={3} className="font-mono" />}
      </CardContent>
    </Card>
  );
};

const ShamirTool = () => {
  const [secret, setSecret] = useState('');
  const [shares, setShares] = useState(5);
  const [threshold, setThreshold] = useState(3);
  const [output, setOutput] = useState<string[]>([]);
  const [combined, setCombined] = useState('');
  const [shareInput, setShareInput] = useState('');

  const split = async () => {
    try {
      setOutput(await dcrypt.workbench.shamirSplit(secret, shares, threshold));
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const combine = async () => {
    try {
      const parts = shareInput
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
      setCombined(await dcrypt.workbench.shamirCombine(parts));
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recovery shares</CardTitle>
        <CardDescription>
          Split a secret into authenticated shares; any {threshold} of {shares} reconstruct it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="shamir-secret">Secret</Label>
            <Input
              id="shamir-secret"
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="shamir-shares">Shares</Label>
            <Input
              id="shamir-shares"
              type="number"
              min={2}
              max={255}
              value={shares}
              onChange={(e) => setShares(Number(e.target.value))}
              className="w-20"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="shamir-threshold">Threshold</Label>
            <Input
              id="shamir-threshold"
              type="number"
              min={2}
              max={255}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="w-20"
            />
          </div>
          <Button onClick={split} disabled={!secret}>
            Split
          </Button>
        </div>
        {output.length > 0 && (
          <Textarea readOnly value={output.join('\n')} rows={5} className="font-mono text-xs" />
        )}
        <div className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="shamir-combine">Combine shares (one per line)</Label>
            <Textarea
              id="shamir-combine"
              value={shareInput}
              onChange={(e) => setShareInput(e.target.value)}
              rows={3}
              className="font-mono text-xs"
            />
          </div>
          <Button variant="outline" onClick={combine} disabled={!shareInput.trim()}>
            Combine
          </Button>
        </div>
        {combined && <Input readOnly value={combined} className="font-mono" />}
      </CardContent>
    </Card>
  );
};

export const ToolsScreen = () => (
  <div className="h-full overflow-y-auto p-6">
    <Tabs defaultValue="wallets">
      <TabsList>
        <TabsTrigger value="wallets">Wallets</TabsTrigger>
        <TabsTrigger value="encrypt">Encrypt</TabsTrigger>
        <TabsTrigger value="legacy">Legacy</TabsTrigger>
        <TabsTrigger value="shamir">Recovery</TabsTrigger>
      </TabsList>
      <TabsContent value="wallets">
        <WalletTool />
      </TabsContent>
      <TabsContent value="encrypt">
        <EncryptTool />
      </TabsContent>
      <TabsContent value="legacy">
        <LegacyTool />
      </TabsContent>
      <TabsContent value="shamir">
        <ShamirTool />
      </TabsContent>
    </Tabs>
  </div>
);
