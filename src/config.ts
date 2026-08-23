export type RuntimeConfig = { arkApiKey: string; arkImageModel: string; arkBaseUrl: string; databaseUrl: string; jwtSecret: string; registrationInviteCode: string; port: number };
export function loadConfig(env = process.env): RuntimeConfig {
  const required = ['ARK_API_KEY', 'ARK_IMAGE_MODEL', 'DATABASE_URL', 'AUTH_JWT_SECRET', 'REGISTRATION_INVITE_CODE'] as const;
  for (const key of required) if (!env[key]) throw new Error(`${key} is required.`);
  return { arkApiKey: env.ARK_API_KEY!, arkImageModel: env.ARK_IMAGE_MODEL!, arkBaseUrl: env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3', databaseUrl: env.DATABASE_URL!, jwtSecret: env.AUTH_JWT_SECRET!, registrationInviteCode: env.REGISTRATION_INVITE_CODE!, port: Number(env.PORT || 8080) };
}
