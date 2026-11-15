import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../dist/app.js';
import { stores } from '../dist/db.js';
import { loadOrCreateKeys } from '../dist/keys.js';
import { hashPassword } from '../dist/auth.js';

let srv, base;
const SERVER_KEY = 'test-server-key-123';
before(async () => {
  const data = mkdtempSync(join(tmpdir(), 'rift-acc-'));
  const serverDir = join(data, 'server'); mkdirSync(serverDir, { recursive: true });
  const db = stores(join(data, 'data'));
  await db.users.update(async (d) => {
    d.users.push({ id: 'o', username: 'owner', role: 'owner', passwordHash: await hashPassword('correct horse 42'), createdAt: '' });
  });
  const keys = await loadOrCreateKeys(join(data, 'data'));
  const { app } = createApp({
    config: { port: 0, host: '127.0.0.1', dataDir: join(data, 'data'), serverDir, publicBaseUrl: 'http://localhost:1', mcHost: 'x', mcPort: 1, statusHost: '127.0.0.1', cookieSecure: false, trustProxy: false, backupKeep: 3 },
    db, keys, serverKey: SERVER_KEY,
  });
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => srv?.close());

const accountPost = async (path, body, token) => {
  const r = await fetch(`${base}/api/account${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body ?? {}) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const accountGet = async (path, token) => {
  const r = await fetch(`${base}/api/account${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const consume = async (ticket, serverId = 'main', nick = 'Hunter', key = SERVER_KEY) => {
  const r = await fetch(`${base}/api/server/auth/consume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-rift-server-key': key },
    body: JSON.stringify({ ticket, serverId, nick }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

test('register and login create Rift identity without a Minecraft/Mojang link', async () => {
  const r = await accountPost('/register', { nick: 'Hunter', password: 'rift-pass-1' });
  assert.equal(r.status, 200);
  assert.match(r.body.account.id, /^[0-9a-f-]{36}$/);
  assert.equal(r.body.account.nick, 'Hunter');
  assert.equal(r.body.account.role, 'player');
  assert.equal((await accountPost('/register', { nick: 'hunter', password: 'other-pass-2' })).body.error, 'nick_taken');
  assert.equal((await accountPost('/register', { nick: 'Admin', password: 'rift-pass-1' })).body.error, 'nick_reserved');
  assert.equal((await accountPost('/register', { nick: 'Имя', password: 'rift-pass-1' })).body.error, 'nick_format');
  assert.equal((await accountPost('/register', { nick: 'Shorty', password: 'abc12' })).body.error, 'password_short');

  const login = await accountPost('/login', { nick: 'HUNTER', password: 'rift-pass-1' });
  assert.equal(login.status, 200);
  assert.equal((await accountGet('/me', login.body.token)).body.account.nick, 'Hunter');
});

test('Rift game tickets require a valid account session and are single-use', async () => {
  const login = await accountPost('/login', { nick: 'Hunter', password: 'rift-pass-1' });
  const issued = await accountPost('/game-session', { serverId: 'main' }, login.body.token);
  assert.equal(issued.status, 200);
  assert.ok(issued.body.token);
  assert.equal(issued.body.serverId, 'main');

  assert.equal((await consume(issued.body.token, 'main', 'Hunter')).body.allowed, true);
  const replay = await consume(issued.body.token, 'main', 'Hunter');
  assert.deepEqual(replay.body, { allowed: false, reason: 'ticket_expired' });

  const wrongNickTicket = await accountPost('/game-session', { serverId: 'main' }, login.body.token);
  assert.equal((await consume(wrongNickTicket.body.token, 'main', 'SomeoneElse')).body.reason, 'ticket_mismatch');

  const wrongServerTicket = await accountPost('/game-session', { serverId: 'main' }, login.body.token);
  assert.equal((await consume(wrongServerTicket.body.token, 'other', 'Hunter')).body.reason, 'ticket_mismatch');
});

test('server API requires its private key; expired or malformed tickets are rejected', async () => {
  assert.equal((await consume('a'.repeat(40), 'main', 'Hunter', 'wrong-key')).status, 401);
  assert.deepEqual((await consume('short', 'main', 'Hunter')).body, { allowed: false, reason: 'invalid_ticket' });
  assert.deepEqual((await consume('a'.repeat(40), 'main', 'Hunter')).body, { allowed: false, reason: 'ticket_expired' });
});

test('ban revokes Rift sessions and prevents new game tickets', async () => {
  const login = await accountPost('/login', { nick: 'Hunter', password: 'rift-pass-1' });
  const issued = await accountPost('/game-session', { serverId: 'main' }, login.body.token);
  const admin = await fetch(`${base}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'owner', password: 'correct horse 42' }),
  });
  const adminBody = await admin.json();
  const cookie = admin.headers.get('set-cookie')?.split(';')[0];
  const list = await fetch(`${base}/api/admin/accounts`, { headers: { cookie } });
  const accounts = await list.json();
  const hunter = accounts.find((a) => a.nick === 'Hunter');
  const ban = await fetch(`${base}/api/admin/accounts/${hunter.id}/ban`, {
    method: 'POST',
    headers: { cookie, 'x-rift-csrf': adminBody.csrf, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'test ban' }),
  });
  assert.equal(ban.status, 200);
  assert.equal((await accountGet('/me', login.body.token)).status, 401);
  assert.equal((await accountPost('/game-session', { serverId: 'main' }, login.body.token)).status, 401);
  // Tickets already issued before the ban are rejected at consume time as well.
  assert.equal((await consume(issued.body.token, 'main', 'Hunter')).body.allowed, false);
});
