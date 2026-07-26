import { Button } from '@constructive-io/ui/button';
import { Input } from '@constructive-io/ui/input';
import { Label } from '@constructive-io/ui/label';
import { Switch } from '@constructive-io/ui/switch';
import { Dices } from 'lucide-react';
import { useCallback, useState } from 'react';

import { estimateEntropyBits, generatePassword } from '../../../shared/password';

const random = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));

export const PasswordGenerator = ({ onGenerated }: { onGenerated: (value: string) => void }) => {
  const [length, setLength] = useState(24);
  const [symbols, setSymbols] = useState(true);
  const [digits, setDigits] = useState(true);
  const [preview, setPreview] = useState('');

  const generate = useCallback(() => {
    const value = generatePassword({ length, symbols, digits }, random);
    setPreview(value);
    onGenerated(value);
  }, [length, symbols, digits, onGenerated]);

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <Input readOnly value={preview} placeholder="Generated password" className="font-mono" />
        <Button type="button" variant="outline" size="icon" onClick={generate} aria-label="Generate">
          <Dices className="size-4" />
        </Button>
      </div>
      <div className="flex items-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <Label htmlFor="gen-length">Length</Label>
          <Input
            id="gen-length"
            type="number"
            min={8}
            max={128}
            value={length}
            onChange={(e) => setLength(Number(e.target.value))}
            className="w-20"
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="gen-digits" checked={digits} onCheckedChange={setDigits} />
          <Label htmlFor="gen-digits">Digits</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="gen-symbols" checked={symbols} onCheckedChange={setSymbols} />
          <Label htmlFor="gen-symbols">Symbols</Label>
        </div>
        <span className="ml-auto text-muted-foreground">
          ~{estimateEntropyBits({ length, symbols, digits })} bits
        </span>
      </div>
    </div>
  );
};
