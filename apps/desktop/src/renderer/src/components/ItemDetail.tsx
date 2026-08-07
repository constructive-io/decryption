import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@constructive-io/ui/alert-dialog';
import { Badge } from '@constructive-io/ui/badge';
import { Button } from '@constructive-io/ui/button';
import { Input } from '@constructive-io/ui/input';
import { Progress } from '@constructive-io/ui/progress';
import { Separator } from '@constructive-io/ui/separator';
import { Copy, Eye, EyeOff, Plus, Star, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import type { TotpEntry, VaultFieldMeta, VaultItem, VaultTag } from '../../../shared/api';
import { copyWithTimeout, dcrypt } from '../lib/ipc';
import { BrandGlyph, useBrandIcons } from './BrandGlyph';

const KIND_LABEL: Record<string, string> = {
  login: 'Login',
  note: 'Secure note',
  card: 'Card',
  identity: 'Identity',
  wallet: 'Wallet',
  totp: 'One-time code',
  ssh_key: 'SSH key',
};

export const ItemDetail = ({
  item,
  onChanged,
  onDeleted,
}: {
  item: VaultItem;
  onChanged: () => void;
  onDeleted: () => void;
}) => {
  const [fields, setFields] = useState<VaultFieldMeta[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [tags, setTags] = useState<VaultTag[]>([]);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldValue, setNewFieldValue] = useState('');
  const [newTag, setNewTag] = useState('');
  const [totp, setTotp] = useState<TotpEntry | null>(null);
  const icons = useBrandIcons([item.title]);

  const refresh = useCallback(async () => {
    setRevealed({});
    setFields(await dcrypt.fields.list(item.id));
    setUrls(await dcrypt.organize.urls(item.id));
    setTags(await dcrypt.organize.tags(item.id));
  }, [item.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hasTotpSeed = fields.some((field) => field.purpose === 'totp_seed');

  useEffect(() => {
    if (!hasTotpSeed) {
      setTotp(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const entry = await dcrypt.totp.code(item.id);
        if (!cancelled) setTotp(entry);
      } catch {
        // vault locked mid-refresh
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [hasTotpSeed, item.id]);

  const toggleReveal = async (name: string) => {
    if (revealed[name] !== undefined) {
      setRevealed((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      return;
    }
    const value = await dcrypt.fields.reveal(item.id, name);
    setRevealed((prev) => ({ ...prev, [name]: value }));
  };

  const copyField = async (name: string) => {
    const value = revealed[name] ?? (await dcrypt.fields.reveal(item.id, name));
    copyWithTimeout(value);
    toast.success(`Copied ${name} — clipboard clears in 30s`);
  };

  const addField = async () => {
    if (!newFieldName.trim() || !newFieldValue) return;
    await dcrypt.fields.set(item.id, newFieldName.trim(), 'text', newFieldValue);
    setNewFieldName('');
    setNewFieldValue('');
    await refresh();
  };

  const addTag = async () => {
    if (!newTag.trim()) return;
    await dcrypt.organize.tag(item.id, newTag.trim());
    setNewTag('');
    await refresh();
  };

  const toggleFavorite = async () => {
    await dcrypt.items.favorite(item.id, !item.favorite);
    onChanged();
  };

  const trash = async () => {
    await dcrypt.items.trash(item.id);
    toast.success(`Moved "${item.title}" to trash`);
    setConfirmDelete(false);
    onDeleted();
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <BrandGlyph name={item.title} icon={icons[item.title]} className="size-6" />
            {item.title}
          </h2>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant="secondary">{KIND_LABEL[item.kind] ?? item.kind}</Badge>
            {tags.map((tag) => (
              <Badge key={tag.id} variant="outline" className="gap-1">
                {tag.name}
                <button
                  onClick={() => void dcrypt.organize.untag(item.id, tag.name).then(refresh)}
                  aria-label={`Remove tag ${tag.name}`}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={toggleFavorite} aria-label="Favorite">
            <Star className={`size-4 ${item.favorite ? 'fill-yellow-400 text-yellow-400' : ''}`} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setConfirmDelete(true)}
            aria-label="Delete"
          >
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      </div>

      <Separator />

      {totp && (
        <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-4">
          <span className="text-sm font-medium">One-time code</span>
          <div className="flex items-center justify-between">
            <span className="font-mono text-3xl tracking-widest">
              {totp.code.slice(0, Math.ceil(totp.code.length / 2))}{' '}
              {totp.code.slice(Math.ceil(totp.code.length / 2))}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                copyWithTimeout(totp.code);
                toast.success('Code copied — clipboard clears in 30s');
              }}
              aria-label="Copy code"
            >
              <Copy className="size-4" />
            </Button>
          </div>
          <Progress value={(totp.remaining / totp.period) * 100} />
        </div>
      )}

      <div className="flex flex-col gap-3">
        {fields.map((field) => (
          <div key={field.id} className="flex items-center gap-2">
            <span className="w-32 shrink-0 text-sm text-muted-foreground">{field.name}</span>
            <Input
              readOnly
              type={field.concealed && revealed[field.name] === undefined ? 'password' : 'text'}
              value={
                revealed[field.name] !== undefined
                  ? revealed[field.name]
                  : field.concealed
                    ? '••••••••••••'
                    : (revealed[field.name] ?? '')
              }
              onFocus={() => {
                if (!field.concealed && revealed[field.name] === undefined) {
                  void toggleReveal(field.name);
                }
              }}
              className="font-mono"
            />
            {field.concealed && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void toggleReveal(field.name)}
                aria-label={revealed[field.name] !== undefined ? 'Hide' : 'Reveal'}
              >
                {revealed[field.name] !== undefined ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void copyField(field.name)}
              aria-label="Copy"
            >
              <Copy className="size-4" />
            </Button>
          </div>
        ))}
        {!fields.length && (
          <p className="text-sm text-muted-foreground">No fields yet.</p>
        )}
      </div>

      <div className="flex items-end gap-2">
        <Input
          placeholder="Field name"
          value={newFieldName}
          onChange={(e) => setNewFieldName(e.target.value)}
          className="w-40"
        />
        <Input
          placeholder="Value"
          type="password"
          value={newFieldValue}
          onChange={(e) => setNewFieldValue(e.target.value)}
        />
        <Button variant="outline" onClick={addField} disabled={!newFieldName.trim() || !newFieldValue}>
          <Plus className="size-4" /> Field
        </Button>
      </div>

      {urls.length > 0 && (
        <>
          <Separator />
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">Websites</span>
            {urls.map((url) => (
              <a key={url} href={url} target="_blank" rel="noreferrer" className="text-sm text-primary underline">
                {url}
              </a>
            ))}
          </div>
        </>
      )}

      <div className="flex items-end gap-2">
        <Input
          placeholder="Add tag"
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void addTag()}
          className="w-40"
        />
        <Button variant="outline" onClick={addTag} disabled={!newTag.trim()}>
          <Plus className="size-4" /> Tag
        </Button>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move to trash?</AlertDialogTitle>
            <AlertDialogDescription>
              "{item.title}" will move to the trash. You can restore it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void trash()}>Move to trash</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
