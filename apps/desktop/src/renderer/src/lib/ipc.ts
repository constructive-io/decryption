import type { DcryptApi } from '../../../shared/api';

export type RendererApi = DcryptApi & {
  onLocked(listener: () => void): () => void;
  onSystemThemeChange(listener: (dark: boolean) => void): () => void;
};

declare global {
  interface Window {
    dcrypt: RendererApi;
  }
}

export const dcrypt: RendererApi = window.dcrypt;

/**
 * Copy to clipboard and clear it after a timeout so secrets don't linger. The
 * main process does the work: `navigator.clipboard` needs a secure context and
 * a read permission, and a packaged build serves the UI from `file://`.
 */
export const copyWithTimeout = (value: string, seconds = 30): void => {
  void dcrypt.clipboard.copy(value, seconds);
};
