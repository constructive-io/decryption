import { Badge } from '@constructive-io/ui/badge';
import { Button } from '@constructive-io/ui/button';
import { Input } from '@constructive-io/ui/input';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@constructive-io/ui/resizable';
import { ScrollArea } from '@constructive-io/ui/scroll-area';
import { Plus, Search, Star, Trash2, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import type { VaultItem } from '../../../shared/api';
import { ItemDetail } from '../components/ItemDetail';
import { NewItemDialog } from '../components/NewItemDialog';
import { dcrypt } from '../lib/ipc';

type Filter = 'all' | 'favorites' | 'trash';

export const VaultScreen = () => {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [selected, setSelected] = useState<VaultItem | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [showNew, setShowNew] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    let list: VaultItem[];
    if (query.trim() && filter !== 'trash') {
      list = await dcrypt.items.search(query.trim());
    } else {
      list = await dcrypt.items.list({ trashed: filter === 'trash' });
    }
    if (filter === 'favorites') list = list.filter((item) => item.favorite);
    setItems(list);
    setSelected((current) => list.find((item) => item.id === current?.id) ?? null);
  }, [query, filter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchInput.current?.focus();
        searchInput.current?.select();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const restore = async (item: VaultItem) => {
    await dcrypt.items.restore(item.id);
    toast.success(`Restored "${item.title}"`);
    await refresh();
  };

  const destroy = async (item: VaultItem) => {
    await dcrypt.items.destroy(item.id);
    toast.success(`Deleted "${item.title}" permanently`);
    await refresh();
  };

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full">
      <ResizablePanel defaultSize={35} minSize={25}>
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-2 border-b p-3">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                ref={searchInput}
                placeholder="Search titles, sites, tags…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && items.length) {
                    setSelected(items[0]);
                  } else if (e.key === 'ArrowDown' && items.length) {
                    e.preventDefault();
                    const index = items.findIndex((item) => item.id === selected?.id);
                    setSelected(items[Math.min(index + 1, items.length - 1)]);
                  } else if (e.key === 'ArrowUp' && items.length) {
                    e.preventDefault();
                    const index = items.findIndex((item) => item.id === selected?.id);
                    setSelected(items[Math.max(index - 1, 0)]);
                  } else if (e.key === 'Escape') {
                    setQuery('');
                    searchInput.current?.blur();
                  }
                }}
                className="pl-8"
              />
            </div>
            <Button size="icon" onClick={() => setShowNew(true)} aria-label="New item">
              <Plus className="size-4" />
            </Button>
          </div>
          <div className="flex gap-1 border-b p-2">
            {(['all', 'favorites', 'trash'] as Filter[]).map((f) => (
              <Button
                key={f}
                variant={filter === f ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setFilter(f)}
                className="capitalize"
              >
                {f}
              </Button>
            ))}
          </div>
          <ScrollArea className="flex-1">
            <div className="flex flex-col p-2">
              {items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelected(item)}
                  className={`flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent ${
                    selected?.id === item.id ? 'bg-accent' : ''
                  }`}
                >
                  <span className="flex-1 truncate">{item.title}</span>
                  {item.favorite && <Star className="size-3.5 fill-yellow-400 text-yellow-400" />}
                  <Badge variant="outline" className="text-xs capitalize">
                    {item.kind.replace('_', ' ')}
                  </Badge>
                  {filter === 'trash' && (
                    <span className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          void restore(item);
                        }}
                        aria-label="Restore"
                      >
                        <Undo2 className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          void destroy(item);
                        }}
                        aria-label="Delete forever"
                      >
                        <Trash2 className="size-3.5 text-destructive" />
                      </Button>
                    </span>
                  )}
                </button>
              ))}
              {!items.length && (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  {filter === 'trash' ? 'Trash is empty.' : 'No items yet — add your first one.'}
                </p>
              )}
            </div>
          </ScrollArea>
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={65}>
        {selected ? (
          <ItemDetail
            item={selected}
            onChanged={() => void refresh()}
            onDeleted={() => void refresh()}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Select an item to view its details
          </div>
        )}
      </ResizablePanel>
      <NewItemDialog open={showNew} onOpenChange={setShowNew} onCreated={() => void refresh()} />
    </ResizablePanelGroup>
  );
};
