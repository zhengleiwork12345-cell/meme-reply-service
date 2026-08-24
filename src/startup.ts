type ErrorShape = { code?: unknown; message?: unknown };

/** Maps startup failures to safe operational categories without logging secrets or provider text. */
export function startupFailureCategory(error: unknown): string {
  const detail = (error || {}) as ErrorShape;
  const code = typeof detail.code === 'string' ? detail.code : '';
  const message = typeof detail.message === 'string' ? detail.message.toLowerCase() : '';
  if (message.endsWith(' is required.')) return 'CONFIGURATION_FAILURE';
  if (code === 'ECONNREFUSED') return 'DATABASE_CONNECTION_REFUSED';
  if (code === 'ENOTFOUND') return 'DATABASE_HOST_NOT_FOUND';
  if (code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'DATABASE_NETWORK_UNREACHABLE';
  if (code === '28P01') return 'DATABASE_AUTHENTICATION_FAILED';
  if (code === '3D000') return 'DATABASE_NOT_FOUND';
  if (code === '42501') return 'DATABASE_PERMISSION_DENIED';
  if (message.includes('does not support ssl')) return 'DATABASE_SSL_UNSUPPORTED';
  if (message.includes('no pg_hba.conf entry')) return 'DATABASE_ACCESS_DENIED';
  if (message.includes('self-signed certificate') || message.includes('certificate')) return 'DATABASE_TLS_CERTIFICATE_FAILED';
  return 'DATABASE_SCHEMA_FAILURE';
}
