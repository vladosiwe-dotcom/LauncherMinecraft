import { Algorithm, hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Stores } from './db.js';
import { LoginLimiter, generatePassword } from './auth.js';

/**
 * Spell and Iron Rift player accounts: the project's own identity on top of the Minecraft licence.
 *
 * A player registers in the launcher with a nickname and password and gets a permanent account UUID,
 * a role (player / moderator / admin) and a session that survives launcher restarts. Playing still needs the
 * official Microsoft sign-in: the account is linked to the player's Minecraft profile through Mojang's
 * session server (join → hasJoined, the same check Minecraft servers use), so nobody can claim someone
 * else's Minecraft UUID or nickname. The game server asks this service whether a verified Minecraft UUID
 * belongs to an active account and which role it has.
 */

export type AccountRole = 'player' | 'moderator' | 'admin';
export const ACCOUNT_ROLES: readonly AccountRole[] = ['player', 'moderator', 'admin'];

export interface Account {
  id: string;            // permanent account UUID
  nick: string;
  nickLower: string;
  passwordHash: string;  // Argon2id
  role: AccountRole;
  status: 'active' | 'banned';
  banReason?: string;
  bannedAt?: string;
  bannedBy?: string;
  mustChangePassword?: boolean;
  createdAt: string;
  lastLoginAt?: string;
  minecraft?: { uuid: string; name: string; linkedAt: string };
}

export interface AccountSession { tokenHash: string; accountId: string; createdAt: number; expiresAt: number; lastUsedAt: number; ip: string }
export interface LinkChallenge { accountId: string; serverId: string; expiresAt: number }

export const NICK_RE = /^[A-Za-z0-9_]{3,16}$/;
const RESERVED = new Set(['admin', 'administrator', 'moderator', 'mod', 'owner', 'server', 'console', 'system', 'support', 'rift', 'staff', 'root']);
const SESSION_TTL = 30 * 24 * 3600 * 1000; // sliding: every refresh extends it
// OWASP-recommended Argon2id parameters (19 MiB, 2 iterations, 1 lane)
const ARGON = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const fail = (status: number, code: string) => Object.assign(new Error(code), { status });

export function nickProblem(nick: string): string | null {
  if (!NICK_RE.test(nick)) return 'nick_format';
  if (RESERVED.has(nick.toLowerCase())) return 'nick_reserved';
  return null;
}

export function passwordProblem(pw: string, nick: string): string | null {
  if (typeof pw !== 'string' || pw.length < 8) return 'password_short';
  if (pw.length > 128) return 'password_long';
  if (!/\p{L}/u.test(pw) || !/\d/.test(pw)) return 'password_letters_digits';
  if (nick && pw.toLowerCase().includes(nick.toLowerCase())) return 'password_contains_nick';
  return null;
}

/** Undashed Minecraft UUID → dashed form. */
export function dashUuid(u: string): string {
  const h = u.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(h)) throw fail(400, 'bad_uuid');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function publicAccount(a: Account) {
  return { id: a.id, nick: a.nick, role: a.role, status: a.status, banReason: a.banReason, mustChangePassword: !!a.mustChangePassword, createdAt: a.createdAt, lastLoginAt: a.lastLoginAt, minecraft: a.minecraft ?? null };
}

/** Mojang session server check used by Minecraft servers: did this player join with this serverId? */
export type HasJoined = (name: string, serverId: string) => Promise<{ id: string; name: string } | null>;
export function mojangHasJoined(base = 'https://sessionserver.mojang.com'): HasJoined {
  return async (name, serverId) => {
    const r = await fetch(`${base}/session/minecraft/hasJoined?username=${encodeURIComponent(name)}&serverId=${encodeURIComponent(serverId)}`, { signal: AbortSignal.timeout(10000) });
    if (r.status !== 200) return null;
    const j = (await r.json()) as { id?: string; name?: string };
    return j.id && j.name ? { id: j.id, name: j.name } : null;
  };
}

export class Accounts {
  readonly loginLimiter = new LoginLimiter(8, 15 * 60 * 1000);
  private readonly registerLimiter = new LoginLimiter(5, 60 * 60 * 1000);
  private challenges = new Map<string, LinkChallenge>();
  private readonly dummyHash: Promise<string>;

  constructor(private readonly db: Stores, private readonly hasJoined: HasJoined) {
    this.dummyHash = argonHash('timing-equaliser-not-a-password', ARGON);
  }

  private async newSession(accountId: string, ip: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    await this.db.accountSessions.update((d) => {
      d.sessions = d.sessions.filter((s) => s.expiresAt > now);
      d.sessions.push({ tokenHash: sha(token), accountId, createdAt: now, expiresAt: now + SESSION_TTL, lastUsedAt: now, ip });
    });
    return token;
  }

  async register(nick: string, password: string, ip: string) {
    if (this.registerLimiter.blocked(`ip:${ip}`)) throw fail(429, 'too_many_registrations');
    const np = nickProblem(String(nick ?? '')); if (np) throw fail(400, np);
    const pp = passwordProblem(password, nick); if (pp) throw fail(400, pp);
    const passwordHash = await argonHash(password, ARGON);
    const account: Account = { id: randomUUID(), nick, nickLower: nick.toLowerCase(), passwordHash, role: 'player', status: 'active', createdAt: new Date().toISOString(), lastLoginAt: new Date().toISOString() };
    await this.db.accounts.update((d) => {
      if (d.accounts.some((a) => a.nickLower === account.nickLower)) throw fail(409, 'nick_taken');
      d.accounts.push(account);
    });
    this.registerLimiter.fail(`ip:${ip}`); // counts successful registrations per IP
    return { account, token: await this.newSession(account.id, ip) };
  }

  async login(nick: string, password: string, ip: string) {
    const keys = [`ip:${ip}`, `n:${String(nick).toLowerCase()}`];
    if (keys.some((k) => this.loginLimiter.blocked(k))) throw fail(429, 'too_many_attempts');
    const account = (await this.db.accounts.read()).accounts.find((a) => a.nickLower === String(nick).toLowerCase());
    // always verify a hash so the response time does not reveal whether the nickname exists
    const ok = await argonVerify(account?.passwordHash ?? (await this.dummyHash), String(password ?? '')).catch(() => false);
    if (!account || !ok) { keys.forEach((k) => this.loginLimiter.fail(k)); throw fail(401, 'invalid_credentials'); }
    keys.forEach((k) => this.loginLimiter.reset(k));
    if (account.status === 'banned') throw Object.assign(fail(403, 'account_banned'), { reason: account.banReason ?? '' });
    await this.db.accounts.update((d) => { const a = d.accounts.find((x) => x.id === account.id); if (a) a.lastLoginAt = new Date().toISOString(); });
    return { account, token: await this.newSession(account.id, ip) };
  }

  /** Resolves a bearer token. Banned or deleted accounts lose their sessions immediately. */
  async session(token: string | undefined): Promise<Account | null> {
    if (!token) return null;
    const h = sha(token);
    const s = (await this.db.accountSessions.read()).sessions.find((x) => x.tokenHash === h && x.expiresAt > Date.now());
    if (!s) return null;
    const a = (await this.db.accounts.read()).accounts.find((x) => x.id === s.accountId);
    if (!a || a.status !== 'active') return null;
    return a;
  }

  /** Swaps the session token for a new one (rotation) and extends it. */
  async refresh(token: string, ip: string): Promise<{ account: Account; token: string }> {
    const a = await this.session(token);
    if (!a) throw fail(401, 'session_expired');
    await this.logout(token);
    return { account: a, token: await this.newSession(a.id, ip) };
  }

  async logout(token: string) {
    const h = sha(token);
    await this.db.accountSessions.update((d) => { d.sessions = d.sessions.filter((s) => s.tokenHash !== h); });
  }

  private async revokeAll(accountId: string, except?: string) {
    const keep = except ? sha(except) : '';
    await this.db.accountSessions.update((d) => { d.sessions = d.sessions.filter((s) => s.accountId !== accountId || s.tokenHash === keep); });
  }

  async changePassword(a: Account, current: string, next: string, token: string) {
    if (!(await argonVerify(a.passwordHash, String(current ?? '')).catch(() => false))) throw fail(401, 'invalid_credentials');
    const pp = passwordProblem(next, a.nick); if (pp) throw fail(400, pp);
    const passwordHash = await argonHash(next, ARGON);
    await this.db.accounts.update((d) => { const x = d.accounts.find((y) => y.id === a.id); if (x) { x.passwordHash = passwordHash; x.mustChangePassword = false; } });
    await this.revokeAll(a.id, token); // other devices sign in again
  }

  // ------------------------------------------------------------ linking to the Minecraft profile

  /** A one-time serverId the launcher "joins" on Mojang's session server with the player's Minecraft session. */
  linkChallenge(a: Account): string {
    for (const [k, c] of this.challenges) if (c.expiresAt < Date.now()) this.challenges.delete(k);
    const serverId = randomBytes(20).toString('hex');
    this.challenges.set(a.id, { accountId: a.id, serverId, expiresAt: Date.now() + 2 * 60 * 1000 });
    return serverId;
  }

  async link(a: Account, minecraftName: string) {
    const c = this.challenges.get(a.id);
    this.challenges.delete(a.id);
    if (!c || c.expiresAt < Date.now()) throw fail(400, 'link_expired');
    const profile = await this.hasJoined(String(minecraftName ?? ''), c.serverId);
    if (!profile) throw fail(403, 'link_not_verified');
    const uuid = dashUuid(profile.id);
    await this.db.accounts.update((d) => {
      const other = d.accounts.find((x) => x.minecraft?.uuid === uuid && x.id !== a.id);
      if (other) throw fail(409, 'minecraft_linked_elsewhere');
      const x = d.accounts.find((y) => y.id === a.id);
      if (x) x.minecraft = { uuid, name: profile.name, linkedAt: new Date().toISOString() };
    });
    return { uuid, name: profile.name };
  }

  // ------------------------------------------------------------ game server

  /** What the game server needs to know about a Mojang-verified player UUID. */
  async lookupMinecraft(mcUuid: string) {
    const uuid = dashUuid(mcUuid);
    const a = (await this.db.accounts.read()).accounts.find((x) => x.minecraft?.uuid === uuid);
    if (!a) return { allowed: false, reason: 'not_registered' as const };
    if (a.status === 'banned') return { allowed: false, reason: 'banned' as const, banReason: a.banReason ?? '', nick: a.nick, accountId: a.id };
    return { allowed: true, nick: a.nick, role: a.role, accountId: a.id };
  }

  // ------------------------------------------------------------ administration

  async list() { return (await this.db.accounts.read()).accounts.map(publicAccount); }

  private async edit(id: string, fn: (a: Account) => void): Promise<Account> {
    let out: Account | undefined;
    await this.db.accounts.update((d) => { const a = d.accounts.find((x) => x.id === id); if (!a) throw fail(404, 'not_found'); fn(a); out = a; });
    return out!;
  }

  async setRole(id: string, role: AccountRole) {
    if (!ACCOUNT_ROLES.includes(role)) throw fail(400, 'bad_role');
    return this.edit(id, (a) => { a.role = role; });
  }

  async ban(id: string, reason: string, by: string) {
    const a = await this.edit(id, (x) => { x.status = 'banned'; x.banReason = String(reason ?? '').slice(0, 300); x.bannedAt = new Date().toISOString(); x.bannedBy = by; });
    await this.revokeAll(id);
    return a;
  }

  async unban(id: string) {
    return this.edit(id, (a) => { a.status = 'active'; delete a.banReason; delete a.bannedAt; delete a.bannedBy; });
  }

  /** Password recovery by an administrator: a temporary password the player must change at the next sign-in. */
  async resetPassword(id: string): Promise<{ account: Account; temporaryPassword: string }> {
    const temporaryPassword = generatePassword();
    const passwordHash = await argonHash(temporaryPassword, ARGON);
    const account = await this.edit(id, (a) => { a.passwordHash = passwordHash; a.mustChangePassword = true; });
    await this.revokeAll(id);
    return { account, temporaryPassword };
  }

  async remove(id: string) {
    await this.db.accounts.update((d) => {
      const i = d.accounts.findIndex((x) => x.id === id);
      if (i < 0) throw fail(404, 'not_found');
      d.accounts.splice(i, 1);
    });
    await this.revokeAll(id);
  }
}

/** Constant-time check of the game server's API key. */
export function serverKeyMatches(given: string | undefined, expected: string): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(sha(given)), b = Buffer.from(sha(expected));
  return timingSafeEqual(a, b);
}
