import express, { type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Auth, COOKIE, hashPassword, passwordProblems, permissionsOf, requirePerm } from './auth.js';
import { Backups } from './backups.js';
import { Builds, analyzeBuild, syncServerFiles } from './builds.js';
import type { Config } from './config.js';
import type { Stores } from './db.js';
import { Library } from './library.js';
import { ServerProcess } from './serverproc.js';
import { ping, type PingResult } from './slp.js';
import type { Build, News, Role, User } from './types.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const LANGS = ['ru', 'uk', 'en'] as const;
const PLAYER_RE = /^[A-Za-z0-9_]{3,16}$/;

type Handler = (req: Request, res: Response) => Promise<unknown>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).then((r) => { if (!res.headersSent) res.json(r ?? { ok: true }); }).catch(next);
const httpError = (status: number, message: string, extra: object = {}) => Object.assign(new Error(message), { status, ...extra });

export interface AppDeps { config: Config; db: Stores; keys: { privatePem: string; publicPem: string; keyId: string } }

export function createApp({ config, db, keys }: AppDeps) {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  const auth = new Auth(db, config.cookieSecure);
  const library = new Library(config.dataDir, db);
  const builds = new Builds({ db, publicBaseUrl: config.publicBaseUrl, server: { host: config.mcHost, port: config.mcPort }, keys, dataDir: config.dataDir });
  const proc = new ServerProcess(config.serverDir);
  const backups = new Backups(config.serverDir, join(config.dataDir, 'backups'), proc, config.backupKeep);

  const audit = (user: User | undefined, action: string, detail?: string) =>
    db.audit.update((d) => { d.entries.unshift({ at: new Date().toISOString(), user: user?.username ?? 'system', action, detail }); d.entries.length = Math.min(d.entries.length, 5000); });

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  // ---------------- public API (launcher + website) ----------------
  let statusCache: { at: number; value: PingResult } | null = null;
  app.get('/api/public/status', wrap(async () => {
    if (!statusCache || Date.now() - statusCache.at > 15000) statusCache = { at: Date.now(), value: await ping(config.statusHost, config.mcPort) };
    return { ...statusCache.value, checkedAt: new Date(statusCache.at).toISOString() };
  }));
  app.get('/api/public/manifest', wrap(async (req, res) => {
    const channel = req.query.channel === 'testing' ? 'testing' : 'stable';
    const m = (await builds.signedManifest(channel)) ?? (channel === 'testing' ? await builds.signedManifest('stable') : null);
    if (!m) throw httpError(404, 'no_published_build');
    res.setHeader('Cache-Control', 'no-cache');
    return m;
  }));
  app.get('/api/public/news', wrap(async (req) => {
    const lang = LANGS.includes(req.query.lang as never) ? (req.query.lang as (typeof LANGS)[number]) : 'ru';
    const { items } = await db.news.read();
    return items.filter((n) => n.published).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30)
      .map((n) => ({ id: n.id, tag: n.tag, date: n.date, title: n.title[lang] || n.title.ru, body: n.body[lang] || n.body.ru }));
  }));
  app.get('/api/public/rules', wrap(async (req) => {
    const lang = LANGS.includes(req.query.lang as never) ? (req.query.lang as (typeof LANGS)[number]) : 'ru';
    const s = await db.site.read();
    return { text: s.rules[lang] || s.rules.ru };
  }));
  app.get('/files/:sha', (req, res) => {
    const sha = req.params.sha!;
    if (!/^[a-f0-9]{64}$/.test(sha)) return res.status(400).end();
    const p = library.objectPath(sha);
    if (!existsSync(p)) return res.status(404).end();
    res.sendFile(p, { immutable: true, maxAge: '365d', headers: { 'Content-Type': 'application/octet-stream' } });
  });

  // ---------------- admin API ----------------
  const admin = express.Router();
  admin.use(express.json({ limit: '1mb' }));

  admin.post('/login', wrap(async (req, res) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string') throw httpError(400, 'bad_request');
    const r = await auth.login(username, password, req.ip ?? '');
    if (r === 'blocked') throw httpError(429, 'too_many_attempts');
    if (r === 'invalid') throw httpError(401, 'invalid_credentials');
    res.setHeader('Set-Cookie', auth.cookie(r.token));
    await audit(r.user, 'login', req.ip);
    return { user: publicUser(r.user), csrf: r.csrf, permissions: permissionsOf(r.user.role) };
  }));

  admin.use(auth.middleware());
  const me = (res: Response) => res.locals.user as User;

  admin.get('/me', wrap(async (_req, res) => ({ user: publicUser(me(res)), csrf: res.locals.csrf, permissions: permissionsOf(me(res).role), serverConfigured: proc.configured, keyId: keys.keyId })));
  admin.post('/logout', wrap(async (_req, res) => {
    await auth.logout(res.locals.token);
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
  }));

  // overview & server control
  admin.get('/overview', requirePerm('server.view'), wrap(async () => {
    const { builds: all, published } = await db.builds.read();
    const lib = await db.library.read();
    const stable = all.find((b) => b.id === published.stable);
    const status = await ping(config.statusHost, config.mcPort, 1500);
    return {
      server: { configured: proc.configured, state: proc.state, startedAt: proc.startedAt, pid: proc.pid, usage: await proc.usage(), tps: proc.lastTps, players: proc.lastPlayers },
      status, stable: stable ? { id: stable.id, version: stable.version, publishedAt: stable.publishedAt } : null,
      testing: published.testing, drafts: all.filter((b) => b.status === 'draft').length,
      library: { mods: lib.items.filter((i) => i.category === 'mod').length, resourcepacks: lib.items.filter((i) => i.category === 'resourcepack').length, total: lib.items.length },
      backups: (await backups.list().catch(() => [])).slice(0, 3),
    };
  }));
  admin.post('/server/:action(start|stop|restart)', requirePerm('server.control'), wrap(async (req, res) => {
    const a = req.params.action as 'start' | 'stop' | 'restart';
    await audit(me(res), `server.${a}`);
    if (a === 'start') await proc.start(); else if (a === 'stop') await proc.stop(); else await proc.restart();
    return { state: proc.state };
  }));
  admin.get('/server/console', requirePerm('server.view'), wrap(async (req) => ({ state: proc.state, lines: proc.history(Number(req.query.after ?? 0)) })));
  admin.get('/server/console/stream', requirePerm('server.view'), (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const send = (ev: string, data: unknown) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
    for (const l of proc.history(Number(req.query.after ?? 0))) send('line', l);
    const onLine = (l: unknown) => send('line', l), onState = (s: unknown) => send('state', s);
    proc.on('line', onLine); proc.on('state', onState);
    const ka = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ka); proc.off('line', onLine); proc.off('state', onState); });
  });
  admin.post('/server/command', requirePerm('console.command'), wrap(async (req, res) => {
    const cmd = String(req.body?.command ?? '').slice(0, 500);
    if (!cmd.trim()) throw httpError(400, 'empty_command');
    proc.command(cmd); await audit(me(res), 'console.command', cmd);
  }));

  admin.get('/players', requirePerm('server.view'), wrap(async () => {
    await proc.query('list', /players online/);
    const read = async (f: string) => JSON.parse(await fs.readFile(join(config.serverDir, f), 'utf8').catch(() => '[]'));
    return { online: proc.lastPlayers, banned: config.serverDir ? await read('banned-players.json') : [], ops: config.serverDir ? await read('ops.json') : [] };
  }));
  admin.post('/players/:action(kick|ban|pardon)', requirePerm('players.moderate'), wrap(async (req, res) => {
    const name = String(req.body?.name ?? '');
    const reason = String(req.body?.reason ?? '').replace(/[\r\n]/g, ' ').slice(0, 200);
    if (!PLAYER_RE.test(name)) throw httpError(400, 'bad_player_name');
    proc.command(`${req.params.action} ${name}${reason && req.params.action !== 'pardon' ? ` ${reason}` : ''}`);
    await audit(me(res), `players.${req.params.action}`, `${name} ${reason}`);
  }));

  // content library
  admin.get('/library', requirePerm('server.view'), wrap(async () => (await db.library.read()).items));
  admin.post('/library/upload', requirePerm('content.manage'), wrap(async (req, res) => {
    const name = String(req.query.name ?? '');
    const cat = req.query.category ? String(req.query.category) : undefined;
    if (cat && !['mod', 'config', 'resourcepack', 'shaderpack', 'other'].includes(cat)) throw httpError(400, 'bad_category');
    const item = await library.ingest(req, name, me(res).username, cat as never);
    await audit(me(res), 'library.upload', `${item.fileName} ${item.sha256.slice(0, 12)}`);
    return item;
  }));
  admin.delete('/library/:id', requirePerm('content.manage'), wrap(async (req, res) => { await library.remove(req.params.id!); await audit(me(res), 'library.delete', req.params.id); }));

  // builds
  const buildView = async (b: Build) => ({ ...b, issues: analyzeBuild(b, (await db.library.read()).items) });
  admin.get('/builds', requirePerm('server.view'), wrap(async () => { const d = await db.builds.read(); return { builds: [...d.builds].reverse(), published: d.published }; }));
  admin.post('/builds', requirePerm('builds.manage'), wrap(async (req, res) => { const b = await builds.create(me(res).username, req.body?.from); await audit(me(res), 'build.create', b.version); return b; }));
  admin.get('/builds/:id', requirePerm('server.view'), wrap(async (req) => { const b = await builds.get(req.params.id!); if (!b) throw httpError(404, 'not_found'); return { ...b, issues: await builds.analyze(b.id) }; }));
  admin.patch('/builds/:id', requirePerm('builds.manage'), wrap(async (req) => {
    const p = req.body ?? {};
    const b = await builds.update(req.params.id!, (b) => {
      if (typeof p.version === 'string') b.version = p.version;
      if (typeof p.neoforgeVersion === 'string') b.neoforgeVersion = p.neoforgeVersion;
      if (p.changelog) for (const l of LANGS) if (typeof p.changelog[l] === 'string') b.changelog[l] = p.changelog[l].slice(0, 5000);
      if (Array.isArray(p.resourcePacks)) b.resourcePacks = p.resourcePacks.map(String);
    });
    return buildView(b);
  }));
  admin.post('/builds/:id/items', requirePerm('builds.manage'), wrap(async (req) => {
    const item = (await db.library.read()).items.find((i) => i.id === req.body?.itemId);
    if (!item) throw httpError(404, 'item_not_found');
    await builds.refreshLibrary();
    return buildView(await builds.addItem(req.params.id!, item, sanitizeEntry(req.body)));
  }));
  admin.patch('/builds/:id/items', requirePerm('builds.manage'), wrap(async (req) => {
    const path = String(req.body?.path ?? '');
    const patch = sanitizeEntry(req.body);
    return buildView(await builds.update(req.params.id!, (b) => { const e = b.entries.find((x) => x.path === path); if (!e) throw httpError(404, 'entry_not_found'); Object.assign(e, patch, { path }); }));
  }));
  admin.delete('/builds/:id/items', requirePerm('builds.manage'), wrap(async (req) => {
    const path = String(req.query.path ?? '');
    return buildView(await builds.update(req.params.id!, (b) => { b.entries = b.entries.filter((e) => e.path !== path); }));
  }));
  admin.post('/builds/:id/testing', requirePerm('builds.publish'), wrap(async (req, res) => { const b = await builds.toTesting(req.params.id!); await audit(me(res), 'build.testing', b.version); return b; }));

  const beforeSwitch = (restart: boolean, user: User) => async (b: Build) => {
    if (proc.configured) {
      const running = proc.state === 'running' || proc.state === 'starting';
      if (running && !restart) throw httpError(409, 'server_running_restart_required');
      await backups.create('pre-publish').catch(async (e) => { await audit(user, 'backup.skipped', (e as Error).message); });
      if (running) await proc.stop();
      const r = await syncServerFiles(b, (await db.library.read()).items, config.serverDir, config.dataDir, (s) => library.objectPath(s));
      await audit(user, 'server.sync', `${r.copied} copied, ${r.removed} removed`);
      if (running) await proc.start();
    }
  };
  admin.post('/builds/:id/publish', requirePerm('builds.publish'), wrap(async (req, res) => {
    const b = await builds.publish(req.params.id!, beforeSwitch(!!req.body?.restartServer, me(res)));
    await audit(me(res), 'build.publish', b.version); return b;
  }));
  admin.post('/builds/rollback', requirePerm('builds.publish'), wrap(async (req, res) => {
    const b = await builds.rollback(beforeSwitch(!!req.body?.restartServer, me(res)));
    await audit(me(res), 'build.rollback', b.version); return b;
  }));
  admin.delete('/builds/:id', requirePerm('builds.manage'), wrap(async (req, res) => { await builds.remove(req.params.id!); await audit(me(res), 'build.delete', req.params.id); }));

  // news
  admin.get('/news', requirePerm('news.manage'), wrap(async () => (await db.news.read()).items));
  const newsFrom = (p: any, base?: News): News => ({
    id: base?.id ?? randomUUID(),
    tag: ['update', 'event', 'maintenance', 'news'].includes(p.tag) ? p.tag : base?.tag ?? 'news',
    date: typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(p.date) ? p.date.slice(0, 10) : base?.date ?? new Date().toISOString().slice(0, 10),
    published: typeof p.published === 'boolean' ? p.published : base?.published ?? false,
    title: Object.fromEntries(LANGS.map((l) => [l, String(p.title?.[l] ?? base?.title[l] ?? '').slice(0, 200)])) as News['title'],
    body: Object.fromEntries(LANGS.map((l) => [l, String(p.body?.[l] ?? base?.body[l] ?? '').slice(0, 10000)])) as News['body'],
  });
  admin.post('/news', requirePerm('news.manage'), wrap(async (req, res) => { const n = newsFrom(req.body ?? {}); await db.news.update((d) => { d.items.push(n); }); await audit(me(res), 'news.create', n.title.ru); return n; }));
  admin.patch('/news/:id', requirePerm('news.manage'), wrap(async (req, res) => db.news.update((d) => {
    const i = d.items.findIndex((x) => x.id === req.params.id); if (i < 0) throw httpError(404, 'not_found');
    d.items[i] = newsFrom(req.body ?? {}, d.items[i]); void audit(me(res), 'news.update', d.items[i]!.title.ru); return d.items[i];
  })));
  admin.delete('/news/:id', requirePerm('news.manage'), wrap(async (req, res) => { await db.news.update((d) => { d.items = d.items.filter((x) => x.id !== req.params.id); }); await audit(me(res), 'news.delete', req.params.id); }));

  // site settings: MOTD, rules, limits (also written into server.properties)
  admin.get('/site', requirePerm('server.view'), wrap(async () => db.site.read()));
  admin.put('/site', requirePerm('site.manage'), wrap(async (req, res) => {
    const p = req.body ?? {};
    const s = await db.site.update((s) => {
      if (typeof p.motd === 'string') s.motd = p.motd.replace(/[\r\n]/g, ' ').slice(0, 120);
      if (p.rules) for (const l of LANGS) if (typeof p.rules[l] === 'string') s.rules[l] = p.rules[l].slice(0, 20000);
      if (Number.isInteger(p.maxPlayers) && p.maxPlayers > 0 && p.maxPlayers <= 1000) s.maxPlayers = p.maxPlayers;
      if (typeof p.whitelist === 'boolean') s.whitelist = p.whitelist;
      return s;
    });
    if (config.serverDir) await writeServerProperties(config.serverDir, { motd: s.motd, 'max-players': String(s.maxPlayers), 'white-list': String(s.whitelist), 'enforce-whitelist': String(s.whitelist) });
    await audit(me(res), 'site.update');
    return { ...s, restartRequired: proc.state === 'running' };
  }));

  // backups
  admin.get('/backups', requirePerm('backups.manage'), wrap(async () => backups.list()));
  admin.post('/backups', requirePerm('backups.manage'), wrap(async (_req, res) => { const b = await backups.create('manual'); await audit(me(res), 'backup.create', b.name); return b; }));
  admin.delete('/backups/:name', requirePerm('backups.manage'), wrap(async (req, res) => { await backups.remove(req.params.name!); await audit(me(res), 'backup.delete', req.params.name); }));
  admin.post('/backups/:name/restore', requirePerm('backups.restore'), wrap(async (req, res) => { await backups.restore(req.params.name!); await audit(me(res), 'backup.restore', req.params.name); }));

  // staff accounts
  admin.get('/users', requirePerm('users.manage'), wrap(async () => (await db.users.read()).users.map(publicUser)));
  admin.post('/users', requirePerm('users.manage'), wrap(async (req, res) => {
    const { username, password, role } = req.body ?? {};
    if (typeof username !== 'string' || !/^[\w.-]{3,32}$/.test(username)) throw httpError(400, 'bad_username');
    if (!['admin', 'moderator', 'owner'].includes(role)) throw httpError(400, 'bad_role');
    const probs = passwordProblems(String(password ?? ''));
    if (probs.length) throw httpError(400, 'weak_password', { details: probs });
    const user: User = { id: randomUUID(), username, role: role as Role, passwordHash: await hashPassword(password), createdAt: new Date().toISOString() };
    await db.users.update((d) => { if (d.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) throw httpError(409, 'username_taken'); d.users.push(user); });
    await audit(me(res), 'user.create', `${username} (${role})`);
    return publicUser(user);
  }));
  admin.patch('/users/:id', requirePerm('users.manage'), wrap(async (req, res) => {
    const { role, password, disabled } = req.body ?? {};
    const hash = password !== undefined ? (passwordProblems(String(password)).length ? (() => { throw httpError(400, 'weak_password'); })() : await hashPassword(String(password))) : undefined;
    const u = await db.users.update((d) => {
      const u = d.users.find((x) => x.id === req.params.id); if (!u) throw httpError(404, 'not_found');
      const owners = d.users.filter((x) => x.role === 'owner' && !x.disabled);
      if (u.role === 'owner' && owners.length === 1 && ((role && role !== 'owner') || disabled)) throw httpError(409, 'last_owner');
      if (role && ['admin', 'moderator', 'owner'].includes(role)) u.role = role;
      if (typeof disabled === 'boolean') u.disabled = disabled;
      if (hash) u.passwordHash = hash;
      return u;
    });
    if (hash || disabled) await auth.revokeUser(u.id);
    await audit(me(res), 'user.update', u.username);
    return publicUser(u);
  }));
  admin.delete('/users/:id', requirePerm('users.manage'), wrap(async (req, res) => {
    if (req.params.id === me(res).id) throw httpError(409, 'cannot_delete_self');
    await db.users.update((d) => {
      const u = d.users.find((x) => x.id === req.params.id);
      if (u?.role === 'owner' && d.users.filter((x) => x.role === 'owner').length === 1) throw httpError(409, 'last_owner');
      d.users = d.users.filter((x) => x.id !== req.params.id);
    });
    await auth.revokeUser(req.params.id!);
    await audit(me(res), 'user.delete', req.params.id);
  }));
  admin.get('/audit', requirePerm('audit.view'), wrap(async () => (await db.audit.read()).entries.slice(0, 500)));
  admin.get('/keys/public', requirePerm('builds.publish'), wrap(async () => ({ keyId: keys.keyId, publicPem: keys.publicPem })));

  app.use('/api/admin', admin);

  // admin panel static files
  const panelDir = resolve(here, '..', 'public', 'admin');
  app.use('/admin', (_req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
    next();
  }, express.static(panelDir, { index: 'index.html' }));
  app.get('/', (_req, res) => res.redirect('/admin/'));

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = Number(err.status) || (/^(not_running|already_running|server_dir_not_configured|eula_not_accepted|server_must_be_stopped|world_not_found)$/.test(err.message) ? 409 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'internal_error' : err.message, ...(err.issues ? { issues: err.issues } : {}), ...(err.details ? { details: err.details } : {}) });
  });

  return { app, proc, builds, library, backups, auth };
}

function publicUser(u: User) { return { id: u.id, username: u.username, role: u.role, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt, disabled: !!u.disabled }; }

function sanitizeEntry(p: any) {
  const out: Record<string, unknown> = {};
  if (['client', 'server', 'both'].includes(p?.side)) out.side = p.side;
  if (typeof p?.required === 'boolean') out.required = p.required;
  if (['replace', 'keep-user'].includes(p?.mode)) out.mode = p.mode;
  if (Array.isArray(p?.presets)) out.presets = p.presets.filter((x: string) => ['minimal', 'balanced', 'high', 'ultra'].includes(x));
  if (typeof p?.path === 'string' && /^(config|defaultconfigs)\/[\w./-]+$/.test(p.path) && !p.path.includes('..')) out.path = p.path;
  return out;
}

export async function writeServerProperties(dir: string, values: Record<string, string>) {
  const file = join(dir, 'server.properties');
  const body = await fs.readFile(file, 'utf8').catch(() => '');
  const seen = new Set<string>();
  const lines = body.split(/\r?\n/).filter((l, i, a) => l !== '' || i < a.length - 1).map((l) => {
    const i = l.indexOf('='); if (l.startsWith('#') || i < 0) return l;
    const k = l.slice(0, i); if (k in values) { seen.add(k); return `${k}=${values[k]!.replace(/\\/g, '\\\\')}`; } return l;
  });
  for (const [k, v] of Object.entries(values)) if (!seen.has(k)) lines.push(`${k}=${v}`);
  await fs.writeFile(file, lines.join('\n') + '\n');
}
