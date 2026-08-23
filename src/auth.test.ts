import { describe, expect, it } from 'vitest';
import { AuthService } from './auth.js';
import type { AuthStore, GenerationLog, UserRecord } from './database.js';

class MemoryStore implements AuthStore {
  users = new Map<string, UserRecord>(); refresh = new Map<string, { userId: string; deviceId: string }>();
  async findUserByEmail(email: string) { return [...this.users.values()].find(user => user.email === email) || null; }
  async findUserById(id: string) { return this.users.get(id) || null; }
  async createUser(user: UserRecord) { this.users.set(user.id, user); }
  async touchDevice() { }
  async createRefreshToken(_id: string, userId: string, deviceId: string, tokenHash: string) { this.refresh.set(tokenHash, { userId, deviceId }); }
  async consumeRefreshToken(tokenHash: string) { const item = this.refresh.get(tokenHash) || null; this.refresh.delete(tokenHash); return item; }
  async logGeneration(_entry: GenerationLog) { }
}
const request = { email: 'owner@example.com', password: 'long-enough-password', deviceId: '22222222-2222-4222-8222-222222222222' };
describe('自有认证', () => {
  it('注册、登录和刷新令牌都可获得短期访问令牌', async () => { const service = new AuthService(new MemoryStore(), 'a-long-test-secret', 'invite'); const registered = await service.register({ ...request, inviteCode: 'invite' }); expect(registered.accessToken).toBeTruthy(); const refreshed = await service.refresh({ refreshToken: registered.refreshToken }); expect(refreshed.user.email).toBe(request.email); await expect(service.refresh({ refreshToken: registered.refreshToken })).rejects.toMatchObject({ status: 401 }); });
  it('拒绝错误邀请码', async () => { const service = new AuthService(new MemoryStore(), 'a-long-test-secret', 'invite'); await expect(service.register({ ...request, inviteCode: 'wrong' })).rejects.toMatchObject({ status: 401 }); });
});
