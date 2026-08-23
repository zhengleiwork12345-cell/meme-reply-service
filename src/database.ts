import { Pool } from 'pg';

export type UserRecord = { id: string; email: string; passwordHash: string };
export type GenerationLog = { requestId: string; userId: string; deviceId: string; status: 'success' | 'failed'; elapsedMs: number; model: string };
export interface AuthStore {
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  createUser(user: UserRecord): Promise<void>;
  touchDevice(userId: string, deviceId: string): Promise<void>;
  createRefreshToken(id: string, userId: string, deviceId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  consumeRefreshToken(tokenHash: string): Promise<{ userId: string; deviceId: string } | null>;
  logGeneration(entry: GenerationLog): Promise<void>;
}
export class PgAuthStore implements AuthStore {
  private readonly pool: Pool;
  constructor(databaseUrl: string) { this.pool = new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' } }); }
  async findUserByEmail(email: string) { const r = await this.pool.query('SELECT id, email, password_hash FROM users WHERE email=$1', [email]); return r.rowCount ? rowUser(r.rows[0]) : null; }
  async findUserById(id: string) { const r = await this.pool.query('SELECT id, email, password_hash FROM users WHERE id=$1', [id]); return r.rowCount ? rowUser(r.rows[0]) : null; }
  async createUser(user: UserRecord) { await this.pool.query('INSERT INTO users (id,email,password_hash) VALUES ($1,$2,$3)', [user.id, user.email, user.passwordHash]); }
  async touchDevice(userId: string, deviceId: string) { await this.pool.query('INSERT INTO devices (id,user_id,last_seen_at) VALUES ($1,$2,NOW()) ON CONFLICT (id) DO UPDATE SET user_id=EXCLUDED.user_id,last_seen_at=NOW()', [deviceId, userId]); }
  async createRefreshToken(id: string, userId: string, deviceId: string, tokenHash: string, expiresAt: Date) { await this.pool.query('INSERT INTO refresh_tokens (id,user_id,device_id,token_hash,expires_at) VALUES ($1,$2,$3,$4,$5)', [id, userId, deviceId, tokenHash, expiresAt]); }
  async consumeRefreshToken(tokenHash: string) { const r = await this.pool.query('UPDATE refresh_tokens SET revoked_at=NOW() WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>NOW() RETURNING user_id,device_id', [tokenHash]); return r.rowCount ? { userId: r.rows[0].user_id, deviceId: r.rows[0].device_id } : null; }
  async logGeneration(entry: GenerationLog) { await this.pool.query('INSERT INTO generation_logs (request_id,user_id,device_id,status,elapsed_ms,model) VALUES ($1,$2,$3,$4,$5,$6)', [entry.requestId, entry.userId, entry.deviceId, entry.status, entry.elapsedMs, entry.model]); }
}
function rowUser(row: { id: string; email: string; password_hash: string }): UserRecord { return { id: row.id, email: row.email, passwordHash: row.password_hash }; }
