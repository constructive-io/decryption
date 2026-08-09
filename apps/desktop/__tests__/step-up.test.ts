import { describe, expect, it } from 'vitest';

import { stepUpKind, stepUpPrompt,stepUpProof } from '../src/shared/step-up';

describe('stepUpKind', () => {
  it('reads the factor out of an error that crossed the IPC boundary', () => {
    expect(
      stepUpKind(
        "Error invoking remote method 'accounts:create-key': StepUpRequiredError: STEP_UP_REQUIRED_PASSWORD"
      )
    ).toBe('password');
    expect(stepUpKind('STEP_UP_REQUIRED_MFA')).toBe('mfa');
    expect(stepUpKind('STEP_UP_REQUIRED_FRESH_AUTH')).toBe('fresh_auth');
  });

  it('treats the bare code as a password demand', () => {
    expect(stepUpKind('GraphQL Error: STEP_UP_REQUIRED')).toBe('password');
  });

  it('does not fire on any other failure', () => {
    expect(stepUpKind('no GraphQL endpoint at http://x/graphql')).toBeNull();
    expect(stepUpKind('invalid email or password')).toBeNull();
    expect(stepUpKind('STEP_UP_INVALID_TYPE')).toBeNull();
  });
});

describe('stepUpProof', () => {
  it('sends a one-time code for MFA and a password otherwise', () => {
    expect(stepUpProof('mfa', '123456')).toEqual({ totpCode: '123456' });
    expect(stepUpProof('password', 'hunter22')).toEqual({ password: 'hunter22' });
    expect(stepUpProof('fresh_auth', 'hunter22')).toEqual({ password: 'hunter22' });
  });

  it('asks for the right thing in the dialog', () => {
    expect(stepUpPrompt('mfa').label).toBe('One-time code');
    expect(stepUpPrompt('password').label).toBe('Account password');
  });
});
