import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import net from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyManifest } from '@sir/shared';
import { parseToml, inRange, inspectArchive } from '../dist/modinspect.js';
import { analyzeBuild } from '../dist/builds.js';
import { createApp } from '../dist/app.js';
import { stores } from '../dist/db.js';
import { loadOrCreateKeys } from '../dist/keys.js';
import { hashPassword } from '../dist/auth.js';
import { ping } from '../dist/slp.js';

function jar({ modId, version = '1.0.0', deps = [], fabric = false, mc = '[1.21.1,1.22)' }) {
  const z = new AdmZip();
  if (fabric) { z.addFile('fabric.mod.json', Buffer.from('{}')); return z.toBuffer(); }
  const depToml = [`[[dependencies.${modId}]]\nmodId="minecraft"\ntype="required"\nversionRange="${mc}"\nordering="NONE"\nside="BOTH"`,
    `[[dependencies.${modId}]]\nmodId="neoforge"\ntype="required"\nversionRange="[21.1.0,)"\nside="BOTH"`,
    ...deps.map((d) => `[[dependencies.${modId}]]\nmodId="${d.id}"\ntype="${d.type ?? 'required'}"\nversionRange="${d.range ?? '*'}"\nside="${d.side ?? 'BOTH'}"`)].join('\n');
  z.addFile('META-INF/neoforge.mods.toml', Buffer.from(`modLoader="javafml"\nloaderVersion="[4,)"\nlicense="MIT"\n[[mods]]\nmodId="${modId}"\nversion="${version}"\ndisplayName="${modId} mod"\ndescription='''multi\nline'''\n${depToml}\n`));
  return z.toBuffer();
}

test('toml parser and version ranges', () => {
  const t = parseToml('a="x"\n[[mods]]\nmodId="m"\nversion="1"\n[[dependencies.m]]\nmodId="minecraft"\nversionRange="[1.21.1,1.22)"\n');
  assert.equal(t.mods[0].modId, 'm');
  assert.equal(t.dependencies.m[0].versionRange, '[1.21.1,1.22)');
  assert.ok(inRange('1.21.1', '[1.21.1,1.22)'));
  assert.ok(!inRange('1.21', '[1.21.1,1.22)'));
  assert.ok(!inRange('1.20.1', '[1.20.2,)'.replace('1.20.2', '1.21')));
  assert.ok(inRange('3.4.0', '[3.0,4.0)'));
  assert.ok(inRange('21.1.172', '[21.1.0,)'));
  assert.ok(inRange('1.0', '*'));
});

test('archive inspection rejects other loaders and wrong MC versions', () => {
  assert.deepEqual(inspectArchive(jar({ modId: 'a', fabric: true }), 'a.jar').errors, ['fabric_mod']);
  assert.ok(inspectArchive(jar({ modId: 'old', mc: '[1.20.1,1.20.2)' }), 'old.jar').errors[0].startsWith('minecraft_range'));
  const ok = inspectArchive(jar({ modId: 'irons_spellbooks', version: '3.9.2' }), 'isb.jar');
  assert.equal(ok.errors.length, 0);
  assert.equal(ok.mod.version, '3.9.2');
  const rp = new AdmZip(); rp.addFile('pack.mcmeta', Buffer.from(JSON.stringify({ pack: { pack_format: 15, description: 'old' } })));
  assert.deepEqual(inspectArchive(rp.toBuffer(), 'rp.zip').warnings, ['pack_format:15']);
});

test('dependency analysis', () => {
  const lib = [
    { id: '1', name: 'Spellbooks', category: 'mod', errors: [], warnings: [], mod: { modId: 'irons_spellbooks', version: '3.9.2', dependencies: [{ modId: 'geckolib', type: 'required', versionRange: '[4.4,)', side: 'BOTH' }, { modId: 'curios', type: 'required', versionRange: '[9,)', side: 'BOTH' }], clientOnlyHint: false } },
    { id: '2', name: 'GeckoLib', category: 'mod', errors: [], warnings: [], mod: { modId: 'geckolib', version: '4.3.0', dependencies: [], clientOnlyHint: false } },
    { id: '3', name: 'Shaders', category: 'mod', errors: [], warnings: [], mod: { modId: 'iris', version: '1.8', dependencies: [], clientOnlyHint: true } },
  ];
  const b = { neoforgeVersion: '21.1.172', resourcePacks: [], entries: [
    { itemId: '1', path: 'mods/a.jar', side: 'both' }, { itemId: '2', path: 'mods/g.jar', side: 'client' }, { itemId: '3', path: 'mods/i.jar', side: 'both' }] };
  const codes = analyzeBuild(b, lib).map((i) => i.code);
  assert.ok(codes.includes('missing_dependency'), 'curios missing');
  assert.ok(codes.includes('dependency_version'), 'geckolib too old');
  assert.ok(codes.includes('dependency_side'), 'geckolib must be on server too');
  assert.ok(codes.includes('client_only_on_server'));
});

let srv, base, data, mcServer;
before(async () => {
  data = mkdtempSync(join(tmpdir(), 'rift-be-'));
  const serverDir = join(data, 'server'); mkdirSync(join(serverDir, 'world'), { recursive: true });
  writeFileSync(join(serverDir, 'server.properties'), 'motd=old\nlevel-name=world\n');
  const db = stores(join(data, 'data'));
  await db.users.update(async (d) => {
    d.users.push({ id: 'o', username: 'owner', role: 'owner', passwordHash: await hashPassword('correct horse 42'), createdAt: '' });
    d.users.push({ id: 'm', username: 'mod', role: 'moderator', passwordHash: await hashPassword('moderator pass 7'), createdAt: '' });
  });
  const keys = await loadOrCreateKeys(join(data, 'data'));
  // fake Minecraft server for the status endpoint
  mcServer = net.createServer((s) => s.once('data', () => {
    const json = Buffer.from(JSON.stringify({ version: { name: 'NeoForge 1.21.1' }, players: { online: 42, max: 300 }, description: { text: 'Rift ', extra: [{ text: 'online' }] } }));
    const v = (n) => { const o = []; do { let b = n & 127; n >>>= 7; if (n) b |= 128; o.push(b); } while (n); return Buffer.from(o); };
    const body = Buffer.concat([v(0), v(json.length), json]);
    s.end(Buffer.concat([v(body.length), body]));
  }));
  await new Promise((r) => mcServer.listen(0, '127.0.0.1', r));
  const { app } = createApp({ config: { port: 0, host: '127.0.0.1', dataDir: join(data, 'data'), serverDir, publicBaseUrl: 'http://localhost:1', mcHost: 'play.test', mcPort: mcServer.address().port, statusHost: '127.0.0.1', cookieSecure: false, trustProxy: false, backupKeep: 3 }, db, keys });
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  global.__keys = keys;
});
after(() => { srv?.close(); mcServer?.close(); });

async function login(username, password) {
  const r = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const j = await r.json();
  return { status: r.status, cookie: r.headers.get('set-cookie')?.split(';')[0], csrf: j.csrf, body: j };
}
const api = (s) => async (method, path, body, raw) => {
  const r = await fetch(`${base}/api/admin${path}`, { method, headers: { cookie: s.cookie, 'x-rift-csrf': s.csrf, ...(raw ? {} : { 'Content-Type': 'application/json' }) }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

test('server list ping', async () => {
  const r = await ping('127.0.0.1', mcServer.address().port);
  assert.deepEqual([r.online, r.players, r.maxPlayers, r.motd], [true, 42, 300, 'Rift online']);
  const s = await (await fetch(`${base}/api/public/status`)).json();
  assert.equal(s.players, 42);
});

test('auth: bad password, CSRF, roles', async () => {
  assert.equal((await login('owner', 'nope')).status, 401);
  const s = await login('owner', 'correct horse 42');
  assert.equal(s.status, 200);
  assert.match(s.cookie, /^rift_admin=/);
  const noCsrf = await fetch(`${base}/api/admin/builds`, { method: 'POST', headers: { cookie: s.cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(noCsrf.status, 403);
  const anon = await fetch(`${base}/api/admin/overview`);
  assert.equal(anon.status, 401);
  const m = await login('mod', 'moderator pass 7');
  assert.equal((await api(m)('POST', '/builds', {})).status, 403, 'moderator cannot create builds');
  assert.equal((await api(m)('GET', '/users')).status, 403);
  assert.equal((await api(m)('POST', '/news', { title: { ru: 'Тест' }, body: { ru: 'x' }, published: true })).status, 200, 'moderator can post news');
});

test('library → build → testing → publish → signed manifest → file download', async () => {
  const s = await login('owner', 'correct horse 42');
  const call = api(s);
  const up = async (name, buf) => call('POST', `/library/upload?name=${encodeURIComponent(name)}`, null, buf);
  const isb = await up('irons_spellbooks-3.9.2.jar', jar({ modId: 'irons_spellbooks', version: '3.9.2', deps: [{ id: 'geckolib', range: '[4.4,)' }] }));
  assert.equal(isb.status, 200);
  assert.equal(isb.body.mod.modId, 'irons_spellbooks');
  const fab = await up('fabric-thing.jar', jar({ modId: 'x', fabric: true }));
  assert.deepEqual(fab.body.errors, ['fabric_mod']);
  assert.equal((await up('../evil.jar', Buffer.from('x'))).status, 400);

  const b = (await call('POST', '/builds', {})).body;
  assert.equal(b.status, 'draft');
  assert.equal((await call('POST', `/builds/${b.id}/items`, { itemId: fab.body.id })).status, 400, 'fabric mod refused');
  let r = await call('POST', `/builds/${b.id}/items`, { itemId: isb.body.id });
  assert.ok(r.body.issues.some((i) => i.code === 'missing_dependency'));
  assert.equal((await call('POST', `/builds/${b.id}/publish`, {})).status, 422, 'cannot publish with errors');

  const gecko = await up('geckolib-4.4.9.jar', jar({ modId: 'geckolib', version: '4.4.9' }));
  r = await call('POST', `/builds/${b.id}/items`, { itemId: gecko.body.id });
  assert.equal(r.body.issues.filter((i) => i.level === 'error').length, 0, JSON.stringify(r.body.issues));
  assert.equal((await call('POST', `/builds/${b.id}/testing`)).status, 200);
  const pub = await call('POST', `/builds/${b.id}/publish`, { restartServer: false });
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  assert.equal(pub.body.status, 'published');
  assert.ok(existsSync(join(data, 'server/mods/irons_spellbooks-3.9.2.jar')), 'server mods synced');

  const signed = await (await fetch(`${base}/api/public/manifest`)).json();
  assert.ok(verifyManifest(signed, [global.__keys.publicPem]), 'manifest signature valid');
  assert.equal(signed.manifest.files.length, 2);
  const f = signed.manifest.files[0];
  const res = await fetch(`${base}/files/${f.sha256}`, { headers: { Range: 'bytes=10-' } });
  assert.equal(res.status, 206);
  assert.equal((await res.arrayBuffer()).byteLength, f.size - 10);

  // second build, publish, then roll back to the first
  const b2 = (await call('POST', '/builds', {})).body;
  assert.equal(b2.version, '0.1.1');
  await call('DELETE', `/builds/${b2.id}/items?path=${encodeURIComponent('mods/geckolib-4.4.9.jar')}`);
  await call('DELETE', `/builds/${b2.id}/items?path=${encodeURIComponent('mods/irons_spellbooks-3.9.2.jar')}`);
  assert.equal((await call('POST', `/builds/${b2.id}/publish`, {})).status, 200);
  assert.equal((await (await fetch(`${base}/api/public/manifest`)).json()).manifest.files.length, 0);
  const rb = await call('POST', '/builds/rollback', {});
  assert.equal(rb.body.id, b.id);
  assert.equal((await (await fetch(`${base}/api/public/manifest`)).json()).manifest.buildId, b.id);
  assert.equal((await call('DELETE', `/library/${isb.body.id}`)).status, 409, 'item in published build cannot be deleted');
});

test('site settings write server.properties, news is localized', async () => {
  const s = await login('owner', 'correct horse 42');
  await api(s)('PUT', '/site', { motd: 'Разлом открыт\nx', maxPlayers: 250 });
  const props = readFileSync(join(data, 'server/server.properties'), 'utf8');
  assert.match(props, /motd=Разлом открыт x/);
  assert.match(props, /max-players=250/);
  await api(s)('POST', '/news', { tag: 'event', title: { ru: 'Ночь Разлома', uk: 'Ніч Розлому' }, body: { ru: 'а', uk: 'б' }, published: true });
  const uk = await (await fetch(`${base}/api/public/news?lang=uk`)).json();
  assert.ok(uk.some((n) => n.title === 'Ніч Розлому'));
  const en = await (await fetch(`${base}/api/public/news?lang=en`)).json();
  assert.ok(en.some((n) => n.title === 'Ночь Разлома'), 'falls back to Russian');
});

test('login rate limit', async () => {
  for (let i = 0; i < 8; i++) await login('ghost', 'x');
  assert.equal((await login('ghost', 'x')).status, 429);
});
