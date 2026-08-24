import { describe, expect, it } from 'vitest';
import { startupFailureCategory } from './startup.js';

const failure = (message: string, code?: string) => Object.assign(new Error(message), code ? { code } : {});

describe('startupFailureCategory', () => {
  it('classifies database failures without including provider details', () => {
    expect(startupFailureCategory(failure('connect failed', 'ECONNREFUSED'))).toBe('DATABASE_CONNECTION_REFUSED');
    expect(startupFailureCategory(failure('server does not support SSL'))).toBe('DATABASE_SSL_UNSUPPORTED');
    expect(startupFailureCategory(failure('password authentication failed', '28P01'))).toBe('DATABASE_AUTHENTICATION_FAILED');
    expect(startupFailureCategory(failure('relation failed', '3D000'))).toBe('DATABASE_NOT_FOUND');
  });

  it('identifies required runtime configuration', () => {
    expect(startupFailureCategory(failure('DATABASE_URL is required.'))).toBe('CONFIGURATION_FAILURE');
  });
});
