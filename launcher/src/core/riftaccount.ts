import { fetchWithTimeout } from './http.js';

/**
 * Client for Spell and Iron Rift accounts (the project's own nickname + password accounts on the backend).
 * The Rift account is the player's identity: nickname, permanent UUID, role and ban state. Game access
 * uses short-lived one-time tickets verified by the dedicated server.
 */
export interface RiftAccount {
  id: string;
  nick: string;
  role: 'player' | 'moderator' | 'admin';
  status: 'active' | 'banned';
  mustChangePassword: boolean;
  minecraft?: null;
}

export class RiftAccountError extends Error {
  constructor(readonly code: string, readonly status: number, readonly reason?: string) { super(code); }
}

export const NICK_RE = /^[A-Za-z0-9_]{3,16}$/;

export class RiftAccountApi {
  private readonly base: string;
  constructor(apiBase: string, allowInsecureLocal = false) {
    const u = new URL(apiBase);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !(local && allowInsecureLocal)) throw new Error('Accounts are only used over HTTPS');
    this.base = `${apiBase.replace(/\/$/, '')}/api/account`;
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown, token?: string): Promise<T> {
    const r = await fetchWithTimeout(`${this.base}${path}`, {
      method, timeoutMs: 15000,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const j = (await r.json().catch(() => ({}))) as { error?: string; reason?: string };
    if (!r.ok) throw new RiftAccountError(j.error ?? `http_${r.status}`, r.status, j.reason);
    return j as T;
  }

  register(nick: string, password: string) { return this.call<{ token: string; account: RiftAccount }>('POST', '/register', { nick, password }); }
  login(nick: string, password: string) { return this.call<{ token: string; account: RiftAccount }>('POST', '/login', { nick, password }); }
  refresh(token: string) { return this.call<{ token: string; account: RiftAccount }>('POST', '/refresh', undefined, token); }
  me(token: string) { return this.call<{ account: RiftAccount }>('GET', '/me', undefined, token); }
  logout(token: string) { return this.call<unknown>('POST', '/logout', {}, token); }
  changePassword(token: string, current: string, next: string) { return this.call<unknown>('POST', '/password', { current, next }, token); }
  gameSession(token: string, serverId = 'main') { return this.call<{ token: string; serverId: string; expiresAt: number }>('POST', '/game-session', { serverId }, token); }
}

