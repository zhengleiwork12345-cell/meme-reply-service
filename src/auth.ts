import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import type { AuthStore, UserRecord } from './database.js';
import { ServiceError } from './errors.js';

const credentials = z.object({ email: z.string().email().max(254).transform(value => value.toLowerCase()), password: z.string().min(10).max(128), deviceId: z.string().uuid(), inviteCode: z.string().min(1).max(256).optional() });
type Session = { accessToken: string; refreshToken: string; user: { id: string; email: string } };
export class AuthService {
  private readonly secret: Uint8Array;
  constructor(private readonly store: AuthStore, jwtSecret: string, private readonly inviteCode: string) { this.secret = new TextEncoder().encode(jwtSecret); }
  async register(body: unknown): Promise<Session> { const input = parseCredentials(body, true); if (!safeEquals(input.inviteCode!, this.inviteCode)) throw new ServiceError(401, 'INVALID_INVITE', '注册邀请码无效。'); if (await this.store.findUserByEmail(input.email)) throw new ServiceError(409, 'EMAIL_EXISTS', '该邮箱已经注册。'); const user: UserRecord = { id: randomUUID(), email: input.email, passwordHash: await bcrypt.hash(input.password, 12) }; await this.store.createUser(user); await this.store.touchDevice(user.id, input.deviceId); return this.issue(user, input.deviceId); }
  async login(body: unknown): Promise<Session> { const input = parseCredentials(body, false); const user = await this.store.findUserByEmail(input.email); if (!user || !await bcrypt.compare(input.password, user.passwordHash)) throw new ServiceError(401, 'INVALID_CREDENTIALS', '邮箱或密码错误。'); await this.store.touchDevice(user.id, input.deviceId); return this.issue(user, input.deviceId); }
  async refresh(body: unknown): Promise<Session> { const token = z.object({ refreshToken: z.string().min(32).max(1024) }).safeParse(body); if (!token.success) throw new ServiceError(401, 'INVALID_REFRESH_TOKEN', '刷新令牌无效。'); const saved = await this.store.consumeRefreshToken(hash(token.data.refreshToken)); if (!saved) throw new ServiceError(401, 'INVALID_REFRESH_TOKEN', '刷新令牌无效或已过期。'); const user = await this.store.findUserById(saved.userId); if (!user) throw new ServiceError(401, 'INVALID_REFRESH_TOKEN', '用户不存在。'); return this.issue(user, saved.deviceId); }
  async verifyBearer(header: string | undefined): Promise<{ userId: string; deviceId: string }> { const token = header?.match(/^Bearer (.+)$/)?.[1]; if (!token) throw new ServiceError(401, 'UNAUTHORIZED', '缺少身份验证。'); try { const verified = await jwtVerify(token, this.secret); const deviceId = z.string().uuid().parse(verified.payload.deviceId); if (!verified.payload.sub) throw new Error('no subject'); return { userId: verified.payload.sub, deviceId }; } catch { throw new ServiceError(401, 'UNAUTHORIZED', '身份验证无效或已过期。'); } }
  private async issue(user: UserRecord, deviceId: string): Promise<Session> { const accessToken = await new SignJWT({ email: user.email, deviceId }).setProtectedHeader({ alg: 'HS256' }).setSubject(user.id).setIssuedAt().setExpirationTime('15m').sign(this.secret); const refreshToken = randomBytes(48).toString('base64url'); await this.store.createRefreshToken(randomUUID(), user.id, deviceId, hash(refreshToken), new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)); return { accessToken, refreshToken, user: { id: user.id, email: user.email } }; }
}
function parseCredentials(body: unknown, inviteRequired: boolean) { const parsed = credentials.safeParse(body); if (!parsed.success || (inviteRequired && !parsed.data.inviteCode)) throw new ServiceError(400, 'INVALID_CREDENTIALS', '请填写有效邮箱、至少 10 位密码和设备标识。'); return parsed.data; }
function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
function safeEquals(a: string, b: string) { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
