import type { SignedManifest } from '@sir/shared';
import { fetchJson } from './http.js';

export interface ServerStatus { online: boolean; players: number; maxPlayers: number; motd: string; version?: string; latencyMs?: number; checkedAt: string }
export interface NewsItem { id: string; title: string; body: string; date: string; tag: 'update' | 'event' | 'maintenance' | 'news'; image?: string }

/** Public, read-only endpoints of the Spell and Iron Rift backend. No credentials are ever sent here. */
export class RiftApi {
  constructor(private readonly base: string) {
    const u = new URL(base);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !local) throw new Error('The launcher only talks to the backend over HTTPS');
  }
  manifest(channel: 'stable' | 'testing') { return fetchJson<SignedManifest>(`${this.base}/api/public/manifest?channel=${channel}`); }
  status() { return fetchJson<ServerStatus>(`${this.base}/api/public/status`, { retries: 0, timeoutMs: 8000 }); }
  news(lang: string) { return fetchJson<NewsItem[]>(`${this.base}/api/public/news?lang=${encodeURIComponent(lang)}`, { retries: 1 }); }
}
