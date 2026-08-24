import { describe, expect, it, vi } from 'vitest';
import { ensureSchemaFor, schemaStatements } from './database.js';

describe('ensureSchemaFor', () => {
  it('creates each required table and index idempotently', async () => {
    const query = vi.fn(async () => undefined);
    await ensureSchemaFor({ query } as never);
    expect(query).toHaveBeenCalledTimes(schemaStatements.length);
    expect(schemaStatements.join('\n')).toContain('CREATE TABLE IF NOT EXISTS users');
    expect(schemaStatements.join('\n')).toContain('CREATE TABLE IF NOT EXISTS generation_logs');
    expect(schemaStatements.join('\n')).toContain('CREATE INDEX IF NOT EXISTS generation_logs_user_created_idx');
  });
});
