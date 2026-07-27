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

/** Copy to clipboard and clear it after a timeout so secrets don't linger. */
export const copyWithTimeout = (value: string, seconds = 30): void => {
  void navigator.clipboard.writeText(value);
  setTimeout(() => {
    void navigator.clipboard.readText().then((current) => {
      if (current === value) void navigator.clipboard.writeText('');
    });
  }, seconds * 1000);
};
