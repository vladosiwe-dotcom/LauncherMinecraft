import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../dist/app.js';
import { stores } from '../dist/db.js';
import { loadOrCreateKeys } from '../dist/keys.js';
import { hashPassword } from '../dist/auth.js';

// Fake Mojang session server: a player "joined" with a serverId if the test said so.
const joined = new Map(); // `${name}|${serverId}` -> { id, name }
const hasJoined = async (name, serverId) => joined.get(`${name}|${serverId}`) ?? null;
const MC = { steve: { id: '0f4e2b0a9f2c4f7f8b1d2a3c4d5e6f70', name: 'SteveMC' }, alex: { id: 'aa4e2b0a9f2c4f7f8b1d2a3c4d5e6f71', name: 'AlexMC' } };

let srv, base;
const SERVER_KEY = 'test-server-key-123';
before(async () => {
  const data = mkdtempSync(join(tmpdir(), 'rift-acc-'));
  const serverDir = join(data, 'server'); mkdirSync(serverDir, { recursive: true });
  const db = stores(join(data, 'data'));
  await db.users.update(async (d) => {
    d.users.push({ id: 'o', username: 'owner', role: 'owner', passwordHash: await hashPassword('correct horse 42'), createdAt: '' });
    d.users.push({ id: 'm', username: 'mod', role: 'moderator', passwordHash: await hashPassword('moderator pass 7'), createdAt: '' });
  });
  const keys = await loadOrCreateKeys(join(data, 'data'));
  const { app } = createApp({ config: { port: 0, host: '127.0.0.1', dataDir: join(data, 'data'), serverDir, publicBaseUrl: 'http://localhost:1', mcHost: 'x', mcPort: 1, statusHost: '127.0.0.1', cookieSecure: false, trustProxy: false, backupKeep: 3, sessionServer: '' }, db, keys, serverKey: SERVER_KEY, hasJoined });
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => srv?.close());

const post = async (path, body, token) => {
  const r = await fetch(`${base}/api/account${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body ?? {}) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const get = async (path, token) => { const r = await fetch(`${base}/api/account${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }); return { status: r.status, body: await r.json().catch(() => null) }; };
const server = async (uuid, key = SERVER_KEY) => { const r = await fetch(`${base}/api/server/players/${uuid}`, { headers: { 'x-rift-server-key': key } }); return { status: r.status, body: await r.json() }; };
async function staff(username, password) {
  const r = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const j = await r.json(); const cookie = r.headers.get('set-cookie').split(';')[0];
  return async (method, path, body) => { const x = await fetch(`${base}/api/admin${path}`, { method, headers: { cookie, 'x-rift-csrf': j.csrf, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: x.status, body: await x.json().catch(() => null) }; };
}
async function linkAs(token, mc) {
  const { body } = await post('/link/challenge', {}, token);
  joined.set(`${mc.name}|${body.serverId}`, mc); // the launcher joined Mojang's session server with this serverId
  return post('/link', { minecraftName: mc.name }, token);
}

test('register: permanent UUID, Argon2id-safe rules, unique case-insensitive nicknames', async () => {
  const r = await post('/register', { nick: 'Hunter', password: 'rift-pass-1' });
  assert.equal(r.status, 200);
  assert.match(r.body.account.id, /^[0-9a-f-]{36}$/);
  assert.equal(r.body.account.role, 'player');
  assert.equal((await post('/register', { nick: 'hunter', password: 'other-pass-2' })).body.error, 'nick_taken');
  assert.equal((await post('/register', { nick: 'Admin', password: 'rift-pass-1' })).body.error, 'nick_reserved');
  assert.equal((await post('/register', { nick: 'Имя', password: 'rift-pass-1' })).body.error, 'nick_format');
  assert.equal((await post('/register', { nick: 'Shorty', password: 'abc12' })).body.error, 'password_short');
  assert.equal((await post('/register', { nick: 'Lettery', password: 'onlyletters' })).body.error, 'password_letters_digits');
  assert.equal((await post('/register', { nick: 'Copycat', password: 'copycat123' })).body.error, 'password_contains_nick');
});

test('login, session, refresh rotation and logout', async () => {
  assert.equal((await post('/login', { nick: 'HUNTER', password: 'wrong-pass-1' })).status, 401);
  const l = await post('/login', { nick: 'HUNTER', password: 'rift-pass-1' });
  assert.equal(l.status, 200);
  assert.equal((await get('/me', l.body.token)).body.account.nick, 'Hunter');
  const r = await post('/refresh', {}, l.body.token);
  assert.equal(r.status, 200);
  assert.equal((await get('/me', l.body.token)).status, 401, 'old token is revoked after rotation');
  assert.equal((await get('/me', r.body.token)).status, 200);
  await post('/logout', {}, r.body.token);
  assert.equal((await get('/me', r.body.token)).status, 401);
});

test('linking proves the Minecraft profile through the session server; nobody can take it over', async () => {
  const a = (await post('/login', { nick: 'Hunter', password: 'rift-pass-1' })).body.token;
  // without a matching join on the session server the link is refused
  const { body } = await post('/link/challenge', {}, a);
  assert.match(body.serverId, /^[0-9a-f]{40}$/);
  assert.equal((await post('/link', { minecraftName: 'SteveMC' }, a)).body.error, 'link_not_verified');
  const ok = await linkAs(a, MC.steve);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.minecraft.uuid, '0f4e2b0a-9f2c-4f7f-8b1d-2a3c4d5e6f70');
  // a second project account cannot claim the same Minecraft UUID
  const b = (await post('/register', { nick: 'Intruder', password: 'rift-pass-2' })).body.token;
  assert.equal((await linkAs(b, MC.steve)).body.error, 'minecraft_linked_elsewhere');
});

test('game server API: key required, verified UUID → nickname and role; unknown UUID not allowed', async () => {
  assert.equal((await server(MC.steve.id, 'nope')).status, 401);
  const s = await server(MC.steve.id);
  assert.deepEqual([s.body.allowed, s.body.nick, s.body.role], [true, 'Hunter', 'player']);
  assert.deepEqual([(await server(MC.alex.id)).body.allowed, (await server(MC.alex.id)).body.reason], [false, 'not_registered']);
});

test('admin: roles, ban (kills sessions, blocks login and the game), unban, password reset, delete', async () => {
  const owner = await staff('owner', 'correct horse 42');
  const mod = await staff('mod', 'moderator pass 7');
  const list = (await owner('GET', '/accounts')).body;
  const hunter = list.find((a) => a.nick === 'Hunter');
  const token = (await post('/login', { nick: 'Hunter', password: 'rift-pass-1' })).body.token;

  assert.equal((await mod('POST', `/accounts/${hunter.id}/role`, { role: 'admin' })).status, 403, 'moderators cannot change roles');
  assert.equal((await owner('POST', `/accounts/${hunter.id}/role`, { role: 'moderator' })).body.role, 'moderator');
  assert.equal((await server(MC.steve.id)).body.role, 'moderator');

  assert.equal((await mod('POST', `/accounts/${hunter.id}/ban`, { reason: 'griefing' })).status, 200);
  assert.equal((await get('/me', token)).status, 401, 'sessions end on ban');
  const denied = await post('/login', { nick: 'Hunter', password: 'rift-pass-1' });
  assert.deepEqual([denied.status, denied.body.error, denied.body.reason], [403, 'account_banned', 'griefing']);
  assert.deepEqual([(await server(MC.steve.id)).body.allowed, (await server(MC.steve.id)).body.reason], [false, 'banned']);
  await mod('POST', `/accounts/${hunter.id}/unban`);
  assert.equal((await server(MC.steve.id)).body.allowed, true);

  const reset = await owner('POST', `/accounts/${hunter.id}/reset-password`);
  assert.equal((await post('/login', { nick: 'Hunter', password: 'rift-pass-1' })).status, 401, 'old password no longer works');
  const t = await post('/login', { nick: 'Hunter', password: reset.body.temporaryPassword });
  assert.equal(t.body.account.mustChangePassword, true);
  assert.equal((await post('/password', { current: reset.body.temporaryPassword, next: 'brand-new-9' }, t.body.token)).status, 200);
  assert.equal((await get('/me', t.body.token)).body.account.mustChangePassword, false);

  assert.equal((await mod('DELETE', `/accounts/${hunter.id}`)).status, 403);
  assert.equal((await owner('DELETE', `/accounts/${hunter.id}`)).status, 200);
  assert.equal((await post('/login', { nick: 'Hunter', password: 'brand-new-9' })).status, 401);
  assert.equal((await server(MC.steve.id)).body.reason, 'not_registered');
});

test('brute force is rate limited', async () => {
  await post('/register', { nick: 'Target', password: 'target-pass-1' });
  for (let i = 0; i < 8; i++) await post('/login', { nick: 'Target', password: `wrong-${i}a` });
  assert.equal((await post('/login', { nick: 'Target', password: 'target-pass-1' })).status, 429);
});
