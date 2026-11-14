// The owner → friends path on real components: the embedded build server (admin API) publishes builds,
// the launcher's updater syncs them. Covers upload, publish, update with only changed files, removal of old
// mods, config sync, player files left alone, rollback, and the signing key check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { startEmbedded } from '../../backend/dist/embedded.js';
import { PackUpdater } from '../dist/core/updater.js';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');
const sha = (b) => createHash('sha256').update(b).digest('hex');

function modJar(modId, version, filler) {
  const z = new AdmZip();
  z.addFile('META-INF/neoforge.mods.toml', Buffer.from(`modLoader="javafml"\nloaderVersion="[4,)"\nlicense="MIT"\n[[mods]]\nmodId="${modId}"\nversion="${version}"\ndisplayName="${modId}"\n`));
  z.addFile(`${modId}/Main.class`, Buffer.from(filler));
  return z.toBuffer();
}

test('owner publishes, friends sync only changes, old mods go, player files stay, rollback works', async (t) => {
  const port = 19000 + Math.floor(Math.random() * 900);
  const base = `http://127.0.0.1:${port}`;
  const owner = await startEmbedded({ dataDir: mkdtempSync(join(tmpdir(), 'rift-own-')), port, publicBaseUrl: base, mcHost: 'game.example.test', mcPort: 25565 });
  t.after(() => owner.close());
  await owner.createOwner('Rutaku', 'TestOwnerPass2026');

  // ---- admin session (on this PC)
  const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'Rutaku', password: 'TestOwnerPass2026' }) });
  assert.equal(login.status, 200);
  const { csrf } = await login.json();
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const admin = async (method, path, body, raw) => {
    const r = await fetch(`${base}/api/admin${path}`, { method, headers: { cookie, 'x-rift-csrf': csrf, ...(raw ? { 'Content-Type': 'application/octet-stream' } : { 'Content-Type': 'application/json' }) }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
    const j = await r.json().catch(() => null);
    assert.ok(r.ok, `${method} ${path} → ${r.status} ${JSON.stringify(j)}`);
    return j;
  };
  const upload = (name, buf, category) => admin('POST', `/library/upload?name=${encodeURIComponent(name)}${category ? `&category=${category}` : ''}`, null, buf);

  const alpha1 = modJar('alpha', '1.0.0', 'alpha-one'), beta1 = modJar('beta', '1.0.0', 'beta-one'), cfg = Buffer.from('difficulty = "hard"\n');
  const a1 = await upload('alpha-1.0.0.jar', alpha1), b1 = await upload('beta-1.0.0.jar', beta1), c1 = await upload('alpha.toml', cfg, 'config');

  // ---- draft 1: players see nothing until it is published
  const d1 = await admin('POST', '/builds');
  await admin('POST', `/builds/${d1.id}/items`, { itemId: a1.id, side: 'both' });
  await admin('POST', `/builds/${d1.id}/items`, { itemId: b1.id, side: 'both' });
  await admin('POST', `/builds/${d1.id}/items`, { itemId: c1.id, side: 'both', path: 'config/alpha.toml' });
  assert.equal((await fetch(`${base}/api/public/manifest`)).status, 404, 'a draft is not visible to players');
  await admin('POST', `/builds/${d1.id}/publish`, {});

  // ---- a friend's launcher: pins the key, syncs
  const key = await (await fetch(`${base}/api/public/key`)).json();
  const root = mkdtempSync(join(tmpdir(), 'rift-friend-'));
  const game = join(root, 'game');
  const up = new PackUpdater(game, join(root, '.sir'));
  const sync = async () => {
    const signed = await (await fetch(`${base}/api/public/manifest`)).json();
    const m = up.accept(signed, [key.publicPem], { allowHttp: true });
    const plan = await up.plan(m, 'balanced');
    await up.apply(m, 'balanced');
    return { m, plan };
  };
  const first = await sync();
  assert.equal(first.plan.write.length, 3);
  assert.deepEqual(readFileSync(join(game, 'mods', 'alpha-1.0.0.jar')), alpha1);
  assert.equal(readFileSync(join(game, 'config', 'alpha.toml'), 'utf8'), cfg.toString());

  // the player's own things
  mkdirSync(join(game, 'saves', 'World'), { recursive: true });
  writeFileSync(join(game, 'saves', 'World', 'level.dat'), 'my world');
  writeFileSync(join(game, 'options.txt'), 'fov:90\n');
  mkdirSync(join(game, 'mods'), { recursive: true });

  // ---- draft 2: alpha updated, beta removed, gamma added
  const alpha2 = modJar('alpha', '1.1.0', 'alpha-two'), gamma1 = modJar('gamma', '1.0.0', 'gamma-one');
  const a2 = await upload('alpha-1.1.0.jar', alpha2), g1 = await upload('gamma-1.0.0.jar', gamma1);
  const d2 = await admin('POST', '/builds');
  await admin('DELETE', `/builds/${d2.id}/items?path=${encodeURIComponent('mods/alpha-1.0.0.jar')}`);
  await admin('DELETE', `/builds/${d2.id}/items?path=${encodeURIComponent('mods/beta-1.0.0.jar')}`);
  await admin('POST', `/builds/${d2.id}/items`, { itemId: a2.id, side: 'both' });
  await admin('POST', `/builds/${d2.id}/items`, { itemId: g1.id, side: 'both' });
  await admin('POST', `/builds/${d2.id}/publish`, {});

  const second = await sync();
  assert.deepEqual(second.plan.write.map((f) => f.path ?? f).sort(), ['mods/alpha-1.1.0.jar', 'mods/gamma-1.0.0.jar'], 'only the changed files are downloaded (config untouched)');
  assert.ok(!existsSync(join(game, 'mods', 'alpha-1.0.0.jar')), 'old version removed');
  assert.ok(!existsSync(join(game, 'mods', 'beta-1.0.0.jar')), 'removed mod deleted');
  assert.equal(sha(readFileSync(join(game, 'mods', 'alpha-1.1.0.jar'))), sha(alpha2));
  assert.equal(readFileSync(join(game, 'saves', 'World', 'level.dat'), 'utf8'), 'my world', 'worlds are never touched');
  assert.equal(readFileSync(join(game, 'options.txt'), 'utf8'), 'fov:90\n', 'personal options kept');

  // ---- nothing changed → nothing to download
  assert.equal((await sync()).plan.write.length, 0);

  // ---- rollback to the previous build
  await admin('POST', '/builds/rollback', {});
  await sync();
  assert.ok(existsSync(join(game, 'mods', 'beta-1.0.0.jar')) && existsSync(join(game, 'mods', 'alpha-1.0.0.jar')), 'rollback restores the old set');
  assert.ok(!existsSync(join(game, 'mods', 'gamma-1.0.0.jar')));

  // ---- a manifest signed by someone else is refused
  const signed = await (await fetch(`${base}/api/public/manifest`)).json();
  const { generateKeyPairSync } = await import('node:crypto');
  const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
  assert.throws(() => up.accept(signed, [other], { allowHttp: true }), /signature/);
  const tampered = structuredClone(signed); tampered.manifest.files[0].sha256 = '0'.repeat(64);
  assert.throws(() => up.accept(tampered, [key.publicPem], { allowHttp: true }), /signature/);
});
