import type { StepUpProof } from './api';

/** The factor the auth server wants re-proved before it will run a mutation. */
export type StepUpKind = 'password' | 'mfa' | 'fresh_auth';

/**
 * An IPC rejection reaches the renderer as a string, so the only thing left to
 * key off is the server's own `STEP_UP_REQUIRED_*` code, which survives being
 * wrapped by Electron and by our own error types.
 */
export const stepUpKind = (message: string): StepUpKind | null => {
  const found = /STEP_UP_REQUIRED_(PASSWORD|MFA|FRESH_AUTH)/.exec(message);
  return found ? (found[1].toLowerCase() as StepUpKind) : null;
};

export const stepUpPrompt = (
  kind: StepUpKind
): { title: string; label: string; hint: string } =>
  kind === 'mfa'
    ? {
      title: 'One more step',
      label: 'One-time code',
      hint: 'This account needs a fresh one-time code before that change.',
    }
    : {
      title: 'Confirm it is you',
      label: 'Account password',
      hint: 'The server wants your password re-entered before that change. It is used for this request only.',
    };

/** Shape the typed value as the proof the requested factor expects. */
export const stepUpProof = (kind: StepUpKind, value: string): StepUpProof =>
  kind === 'mfa' ? { totpCode: value } : { password: value };
