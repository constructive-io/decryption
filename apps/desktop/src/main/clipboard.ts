import { clipboard } from 'electron';

/**
 * Copying happens in the main process because the renderer's async clipboard
 * needs a secure context and a read permission it is never granted: a packaged
 * build loads over `file://`, where `navigator.clipboard` is not there at all.
 */
let pending: NodeJS.Timeout | null = null;

/** Put a secret on the clipboard, and take it back off after a while. */
export const copyWithTimeout = (value: string, seconds: number): void => {
  if (pending) clearTimeout(pending);
  clipboard.writeText(value);
  pending = setTimeout(() => {
    pending = null;
    // only if it is still ours — clearing what the user copied since would be rude
    if (clipboard.readText() === value) clipboard.clear();
  }, seconds * 1000);
  pending.unref();
};

/** Wipe a copied secret now, e.g. when the vault locks. */
export const clearClipboardTimer = (): void => {
  if (!pending) return;
  clearTimeout(pending);
  pending = null;
};
