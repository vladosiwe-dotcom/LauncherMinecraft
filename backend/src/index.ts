import { loadConfig } from './config.js';
import { stores } from './db.js';
import { loadOrCreateKeys } from './keys.js';
import { createApp } from './app.js';

const config = loadConfig();
const db = stores(config.dataDir);
const keys = await loadOrCreateKeys(config.dataDir);
const { app, proc } = createApp({ config, db, keys });

if (!(await db.users.read()).users.length) console.warn('[rift] No staff accounts yet. Create the owner: npm run create-owner -w backend -- <username>');
console.log(`[rift] manifest signing key id ${keys.keyId}. Put data/keys/manifest-ed25519.pub.pem into launcher/config/app.json → trustedManifestKeys.`);
const server = app.listen(config.port, config.host, () => console.log(`[rift] listening on http://${config.host}:${config.port} (public ${config.publicBaseUrl})`));

const shutdown = async () => { console.log('[rift] shutting down'); server.close(); await proc.stop().catch(() => undefined); process.exit(0); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
