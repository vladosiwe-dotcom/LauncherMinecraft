import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import type { Stores } from './db.js';
import type { Role, User } from './types.js';

const scrypt = promisify(scryptCb) as (p: string, s: Buffer, k: number, o: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSION_TTL = 12 * 3600 * 1000;
export const COOKIE = 'rift_admin';

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 32, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, s, k] = stored.split('$');
  if (alg !== 'scrypt' || !s || !k) return false;
  const key = await scrypt(pw, Buffer.from(s, 'base64'), 32, SCRYPT);
  const want = Buffer.from(k, 'base64');
  return want.length === key.length && timingSafeEqual(want, key);
}
export function passwordProblems(pw: string): string[] {
  const p: string[] = [];
  if (pw.length < 12) p.push('min_length_12');
  if (!/[a-zа-яё]/i.test(pw) || !/\d/.test(pw)) p.push('letters_and_digits');
  return p;
}
export function generatePassword(): string {
  return randomBytes(18).toString('base64url');
}

/** Role → permissions. Owner can do everything. */
export const PERMISSIONS = {
  'server.view': ['moderator', 'admin', 'owner'],
  'server.control': ['admin', 'owner'],
  'console.command': ['admin', 'owner'],
  'players.moderate': ['moderator', 'admin', 'owner'],
  'content.manage': ['admin', 'owner'],
  'builds.manage': ['admin', 'owner'],
  'builds.publish': ['admin', 'owner'],
  'news.manage': ['moderator', 'admin', 'owner'],
  'site.manage': ['admin', 'owner'],
  'backups.manage': ['admin', 'owner'],
  'backups.restore': ['owner'],
  'users.manage': ['owner'],
  'audit.view': ['admin', 'owner'],
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof PERMISSIONS;
export const can = (role: Role, perm: Permission) => (PERMISSIONS[perm] as readonly Role[]).includes(role);
export const permissionsOf = (role: Role) => (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p));

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Simple fixed-window limiter for login attempts per IP and per username. */
export class LoginLimiter {
  private hits = new Map<string, { n: number; until: number }>();
  constructor(private readonly max = 8, private readonly windowMs = 15 * 60 * 1000) {}
  blocked(key: string): boolean { const h = this.hits.get(key); return !!h && h.until > Date.now() && h.n >= this.max; }
  fail(key: string) { const h = this.hits.get(key); if (!h || h.until < Date.now()) this.hits.set(key, { n: 1, until: Date.now() + this.windowMs }); else h.n++; }
  reset(key: string) { this.hits.delete(key); }
}

export class Auth {
  limiter = new LoginLimiter();
  constructor(private readonly db: Stores, private readonly cookieSecure: boolean) {}

  async login(username: string, password: string, ip: string): Promise<{ token: string; csrf: string; user: User } | 'blocked' | 'invalid'> {
    const keys = [`ip:${ip}`, `u:${username.toLowerCase()}`];
    if (keys.some((k) => this.limiter.blocked(k))) return 'blocked';
    const { users } = await this.db.users.read();
    const user = users.find((u) => u.username.toLowerCase() === username.toLowerCase() && !u.disabled);
    // Always run scrypt so timing does not reveal whether the user exists.
    const ok = await verifyPassword(password, user?.passwordHash ?? 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    if (!user || !ok) { keys.forEach((k) => this.limiter.fail(k)); return 'invalid'; }
    keys.forEach((k) => this.limiter.reset(k));
    const token = randomBytes(32).toString('base64url');
    const csrf = randomBytes(24).toString('base64url');
    const now = Date.now();
    await this.db.sessions.update((d) => {
      d.sessions = d.sessions.filter((s) => s.expiresAt > now);
      d.sessions.push({ tokenHash: sha(token), userId: user.id, csrf, createdAt: now, expiresAt: now + SESSION_TTL, ip });
    });
    await this.db.users.update((d) => { const u = d.users.find((x) => x.id === user.id); if (u) u.lastLoginAt = new Date().toISOString(); });
    return { token, csrf, user };
  }

  async logout(token: string) { await this.db.sessions.update((d) => { d.sessions = d.sessions.filter((s) => s.tokenHash !== sha(token)); }); }

  async revokeUser(userId: string) { await this.db.sessions.update((d) => { d.sessions = d.sessions.filter((s) => s.userId !== userId); }); }

  cookie(token: string) {
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}${this.cookieSecure ? '; Secure' : ''}`;
  }

  /** Express middleware: resolves the session, enforces CSRF on mutating requests. */
  middleware() {
    return async (req: Request, res: Response, next: NextFunction) => {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      if (!token) return res.status(401).json({ error: 'unauthenticated' });
      const { sessions } = await this.db.sessions.read();
      const s = sessions.find((x) => x.tokenHash === sha(token) && x.expiresAt > Date.now());
      if (!s) return res.status(401).json({ error: 'unauthenticated' });
      const { users } = await this.db.users.read();
      const user = users.find((u) => u.id === s.userId && !u.disabled);
      if (!user) return res.status(401).json({ error: 'unauthenticated' });
      if (!['GET', 'HEAD'].includes(req.method)) {
        const h = req.header('x-rift-csrf') ?? '';
        if (h.length !== s.csrf.length || !timingSafeEqual(Buffer.from(h), Buffer.from(s.csrf))) return res.status(403).json({ error: 'csrf' });
      }
      res.locals.user = user;
      res.locals.token = token;
      res.locals.csrf = s.csrf;
      next();
    };
  }
}

export function requirePerm(perm: Permission) {
  return (_req: Request, res: Response, next: NextFunction) => {
    const u = res.locals.user as User | undefined;
    if (!u || !can(u.role, perm)) return res.status(403).json({ error: 'forbidden', permission: perm });
    next();
  };
}

export function parseCookies(h: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (h ?? '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}
