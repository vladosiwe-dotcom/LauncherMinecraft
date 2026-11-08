import { resolve } from 'node:path';

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  /** Directory of the NeoForge server (see /server in the repo). Empty disables process control. */
  serverDir: string;
  /** Public HTTPS origin players' launchers use, e.g. https://rift.example.org (used in manifest download URLs). */
  publicBaseUrl: string;
  mcHost: string;
  mcPort: number;
  /** Address the backend pings for status (usually 127.0.0.1 on the same machine). */
  statusHost: string;
  cookieSecure: boolean;
  trustProxy: boolean;
  backupKeep: number;
  /** Mojang session server (account linking); overridable for tests. */
  sessionServer: string;
}

export function loadConfig(env = process.env): Config {
  const publicBaseUrl = (env.RIFT_PUBLIC_URL ?? 'http://localhost:8080').replace(/\/$/, '');
  return {
    port: Number(env.RIFT_PORT ?? 8080),
    host: env.RIFT_BIND ?? '127.0.0.1',
    dataDir: resolve(env.RIFT_DATA_DIR ?? 'data'),
    serverDir: env.RIFT_SERVER_DIR ? resolve(env.RIFT_SERVER_DIR) : '',
    publicBaseUrl,
    mcHost: env.RIFT_MC_HOST ?? 'play.example.org',
    mcPort: Number(env.RIFT_MC_PORT ?? 25565),
    statusHost: env.RIFT_STATUS_HOST ?? '127.0.0.1',
    cookieSecure: (env.RIFT_COOKIE_SECURE ?? (publicBaseUrl.startsWith('https://') ? '1' : '0')) === '1',
    trustProxy: env.RIFT_TRUST_PROXY === '1',
    backupKeep: Number(env.RIFT_BACKUP_KEEP ?? 14),
    sessionServer: (env.RIFT_SESSION_SERVER ?? 'https://sessionserver.mojang.com').replace(/\/$/, ''),
  };
}
