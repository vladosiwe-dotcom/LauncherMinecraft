import { fetchWithTimeout } from './http.js';

/**
 * Client for Spell and Iron Rift accounts (the project's own nickname + password accounts on the backend).
 * The account is the player's identity in the project: nickname, permanent UUID, role, bans. Playing still
 * uses the official Microsoft sign-in; the account is linked to that Minecraft profile through Mojang's
 * session server, so the game server can trust which account a connecting player belongs to.
 */
export interface RiftAccount {
  id: string;
  nick: string;
  role: 'player' | 'moderator' | 'admin';
  status: 'active' | 'banned';
  mustChangePassword: boolean;
  minecraft: { uuid: string; name: string; linkedAt: string } | null;
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
  linkChallenge(token: string) { return this.call<{ serverId: string }>('POST', '/link/challenge', {}, token); }
  link(token: string, minecraftName: string) { return this.call<{ minecraft: { uuid: string; name: string } }>('POST', '/link', { minecraftName }, token); }
}

/**
 * Tells Mojang's session server that this Minecraft session "joins" serverId — the same call the game makes
 * when it connects to an online-mode server. The backend then checks it with hasJoined. The Minecraft access
 * token goes only to Mojang, never to the project's backend.
 */
export async function joinMojangSession(accessToken: string, uuid: string, serverId: string, base = 'https://sessionserver.mojang.com'): Promise<void> {
  const r = await fetchWithTimeout(`${base}/session/minecraft/join`, {
    method: 'POST', timeoutMs: 15000, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken, selectedProfile: uuid.replace(/-/g, ''), serverId }),
  });
  if (r.status !== 204 && r.status !== 200) throw new RiftAccountError('mojang_join_failed', r.status);
}

/** Links the Rift account to the signed-in Minecraft profile if it is not linked to it yet. */
export async function ensureLinked(api: RiftAccountApi, token: string, account: RiftAccount, mc: { name: string; uuid: string; accessToken: string }, join = joinMojangSession): Promise<RiftAccount> {
  const want = mc.uuid.replace(/-/g, '').toLowerCase();
  if (account.minecraft && account.minecraft.uuid.replace(/-/g, '') === want) return account;
  const { serverId } = await api.linkChallenge(token);
  await join(mc.accessToken, mc.uuid, serverId);
  await api.link(token, mc.name);
  return (await api.me(token)).account;
}
