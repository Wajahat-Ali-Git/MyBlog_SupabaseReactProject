import { describe, expect, it } from 'vitest';
import { getErrorMessage } from './errors';

describe('getErrorMessage', () => {
  it('extracts .message from a plain PostgrestError-shaped object (supabase-js default, not instanceof Error)', () => {
    const pgError = { message: 'Insufficient balance', details: '', hint: '', code: 'P0001' };
    expect(pgError instanceof Error).toBe(false); // the exact bug this helper exists to work around
    expect(getErrorMessage(pgError, 'fallback')).toBe('Insufficient balance');
  });

  it('extracts .message from a real Error instance too', () => {
    expect(getErrorMessage(new Error('Network failure'), 'fallback')).toBe('Network failure');
  });

  it('falls back when err has no usable message', () => {
    expect(getErrorMessage(null, 'fallback')).toBe('fallback');
    expect(getErrorMessage(undefined, 'fallback')).toBe('fallback');
    expect(getErrorMessage('a raw string', 'fallback')).toBe('fallback');
    expect(getErrorMessage({}, 'fallback')).toBe('fallback');
    expect(getErrorMessage({ message: '' }, 'fallback')).toBe('fallback');
    expect(getErrorMessage({ message: 123 }, 'fallback')).toBe('fallback');
  });
});
