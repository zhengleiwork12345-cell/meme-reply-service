import { createApp } from './app.js'; import { AuthService } from './auth.js'; import { loadConfig } from './config.js'; import { PgAuthStore } from './database.js'; import { JimengMemeGenerator } from './generator.js';
import { startupFailureCategory } from './startup.js';
async function start() {
  const config = loadConfig();
  const store = new PgAuthStore(config.databaseUrl, { ssl: config.databaseSsl, rejectUnauthorized: config.databaseSslRejectUnauthorized });
  await store.ensureSchema();
  const app = createApp({ auth: new AuthService(store, config.jwtSecret, config.registrationInviteCode), store, generator: new JimengMemeGenerator(config.arkApiKey, config.arkImageModel, fetch, config.arkBaseUrl), log: event => console.info(JSON.stringify(event)) });
  app.listen(config.port, () => console.info(`meme-reply-service listening on ${config.port}`));
}
void start().catch(error => { console.error(JSON.stringify({ status: 'startup_failed', category: startupFailureCategory(error) })); process.exitCode = 1; });
