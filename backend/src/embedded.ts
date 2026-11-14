import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { hashPassword, passwordProblems } from './auth.js';
import { loadConfig } from './config.js';
import { stores } from './db.js';
import { loadOrCreateKeys, loadOrCreateServerKey } from './keys.js';

export interface EmbeddedOptions {
  dataDir: string;
  port: number;
  /** Address players' launchers use for the build (e.g. the Cloudflare Tunnel URL); download links are built from it. */
  publicBaseUrl: string;
  mcHost: string;
  mcPort: number;
}

export interface EmbeddedBackend {
  url: string;
  keyId: string;
  publicPem: string;
  /** Shared secret the Minecraft server's guard mod uses to ask about players. */
  serverKey: string;
  hasOwner(): Promise<boolean>;
  createOwner(username: string, password: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * The build server and admin panel running inside the owner's launcher (home PC). Same app as on a VPS
 * (index.ts), but: it listens on 127.0.0.1 only, does not drive the Minecraft server process (the launcher's
 * "My server" does), and the admin panel answers only to this PC — friends reach the public API through a tunnel.
 */
export async function startEmbedded(o: EmbeddedOptions): Promise<EmbeddedBackend> {
  const config = {
    ...loadConfig({}),
    port: o.port, host: '127.0.0.1', dataDir: o.dataDir, serverDir: '',
    publicBaseUrl: o.publicBaseUrl.replace(/\/$/, ''), mcHost: o.mcHost, mcPort: o.mcPort, statusHost: '127.0.0.1',
    cookieSecure: false, trustProxy: false, adminLocalOnly: true,
  };
  const db = stores(config.dataDir);
  const keys = await loadOrCreateKeys(config.dataDir);
  const serverKey = await loadOrCreateServerKey(config.dataDir);
  const { app } = createApp({ config, db, keys, serverKey });
  const server: Server = await new Promise((resolve, reject) => {
    const s = app.listen(config.port, config.host, () => resolve(s));
    s.once('error', reject);
  });
  return {
    url: `http://127.0.0.1:${config.port}`,
    keyId: keys.keyId,
    publicPem: keys.publicPem,
    serverKey,
    hasOwner: async () => (await db.users.read()).users.some((u) => u.role === 'owner'),
    async createOwner(username, password) {
      if (!/^[\w.-]{3,32}$/.test(username)) throw Object.assign(new Error('bad username'), { code: 'owner_name' });
      const problems = passwordProblems(password);
      if (problems.length) throw Object.assign(new Error(problems.join(', ')), { code: 'owner_password' });
      await db.users.update(async (d) => {
        if (d.users.some((u) => u.role === 'owner')) throw Object.assign(new Error('owner exists'), { code: 'owner_exists' });
        d.users.push({ id: randomUUID(), username, role: 'owner', passwordHash: await hashPassword(password), createdAt: new Date().toISOString() });
      });
    },
    close: () => new Promise((resolve) => { server.close(() => resolve()); }),
  };
}
