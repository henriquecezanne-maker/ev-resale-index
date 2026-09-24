import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env, validateEnv } from './env.js';

describe('validateEnv', () => {
  beforeEach(() => {
    vi.stubEnv('AAMPERE_TEST_VAR', 'set-value');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('passes when all required variables are set', () => {
    expect(() => {
      validateEnv(['AAMPERE_TEST_VAR']);
    }).not.toThrow();
  });

  it('exits with a plain-English message naming the missing variable', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => {
      validateEnv(['AAMPERE_MISSING_VAR']);
    }).toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);
    const message = errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(message).toContain('AAMPERE_MISSING_VAR');
    expect(message).toContain('.env');
    expect(message).toContain('README.md');
  });
});

describe('env', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the value when set', () => {
    vi.stubEnv('AAMPERE_TEST_VAR', 'hello');
    expect(env('AAMPERE_TEST_VAR')).toBe('hello');
  });

  it('throws a helpful error when unset', () => {
    expect(() => env('AAMPERE_NOT_SET')).toThrow('.env');
  });
});
