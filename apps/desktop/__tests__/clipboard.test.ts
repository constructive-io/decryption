import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let board = '';

vi.mock('electron', () => ({
  clipboard: {
    writeText: (value: string) => {
      board = value;
    },
    readText: () => board,
    clear: () => {
      board = '';
    },
  },
}));

const { clearClipboardTimer, copyWithTimeout } = await import('../src/main/clipboard');

beforeEach(() => {
  board = '';
  vi.useFakeTimers();
});

afterEach(() => {
  clearClipboardTimer();
  vi.useRealTimers();
});

describe('copyWithTimeout', () => {
  it('copies, then takes the secret back off', () => {
    copyWithTimeout('cnc_live_sk_secret', 30);
    expect(board).toBe('cnc_live_sk_secret');
    vi.advanceTimersByTime(30_000);
    expect(board).toBe('');
  });

  it('leaves whatever the user copied since alone', () => {
    copyWithTimeout('cnc_live_sk_secret', 30);
    board = 'a shopping list';
    vi.advanceTimersByTime(30_000);
    expect(board).toBe('a shopping list');
  });

  it('clears only the newest secret when two are copied', () => {
    copyWithTimeout('first', 30);
    vi.advanceTimersByTime(20_000);
    copyWithTimeout('second', 30);
    vi.advanceTimersByTime(10_000);
    expect(board).toBe('second');
    vi.advanceTimersByTime(20_000);
    expect(board).toBe('');
  });
});
