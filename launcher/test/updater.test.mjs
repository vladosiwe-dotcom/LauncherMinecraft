import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSigningKeys, signManifest } from '@sir/shared';
import { PackUpdater, ManifestRejectedError } from '../dist/core/updater.js';
import { downloadFile } from '../dist/core/http.js';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const blobs = new Map();
let server, base, dropFirstConnection = new Set(), requests = [];

before(async () => {
  server = http.createServer((req, res) => {
    requests.push({ url: req.url, range: req.headers.range });
    const body = blobs.get(req.url);
    if (!body) { res.writeHead(404).end(); return; }
    const m = /bytes=(\d+)-/.exec(req.headers.range ?? '');
    const start = m ? Number(m[1]) : 0;
    if (start >= body.length && m) { res.writeHead(416).end(); return; }
    const chunk = body.subarray(start);
    res.writeHead(m ? 206 : 200, { 'Content-Length': chunk.length, ...(m ? { 'Content-Range': `bytes ${start}-${body.length - 1}/${body.length}` } : {}) });
    if (dropFirstConnection.has(req.url)) {
      dropFirstConnection.delete(req.url);
      res.write(chunk.subarray(0, Math.floor(chunk.length / 2)), () => res.destroy());
      return;
    }
    res.end(chunk);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

function file(path, content, extra = {}) {
  const b = Buffer.from(content);
  const url = `/blob/${sha(b)}`;
  blobs.set(url, b);
  return { path, name: path.split('/').pop(), version: '1', size: b.length, url: base + url, sha256: sha(b), category: path.startsWith('mods') ? 'mod' : 'config', required: true, side: 'client', mode: 'replace', ...extra };
}
function manifest(buildId, files) {
  return { schema: 1, project: 'spell-and-iron-rift', buildId, version: buildId, channel: 'stable', createdAt: new Date().toISOString(), minecraft: '1.21.1', loader: { type: 'neoforge', version: '21.1.172' }, java: { majorVersion: 21, mojangComponent: 'java-runtime-delta' }, server: { host: 'localhost', port: 25565 }, resourcePacks: [], files };
}
function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'sir-'));
  return { dir, up: new PackUpdater(join(dir, 'game'), join(dir, '.sir')) };
}

test('download resumes after a dropped connection and verifies hash', async () => {
  const big = Buffer.alloc(300_000, 7);
  blobs.set('/big', big);
  dropFirstConnection.add('/big');
  requests = [];
  const { dir } = fresh();
  const dest = join(dir, 'big.bin');
  await downloadFile({ url: base + '/big', dest, sha256: sha(big), size: big.length });
  assert.deepEqual(readFileSync(dest), big);
  assert.ok(requests.some((r) => r.range?.startsWith('bytes=') && r.range !== 'bytes=0-'), 'second request used Range');
});

test('corrupted download is rejected', async () => {
  blobs.set('/bad', Buffer.from('evil'));
  const { dir } = fresh();
  await assert.rejects(downloadFile({ url: base + '/bad', dest: join(dir, 'x'), sha256: sha(Buffer.from('good')), retries: 1 }), /checksum|size/);
  assert.ok(!existsSync(join(dir, 'x')));
});

test('apply, incremental update, player data safety, rollback', async () => {
  const { dir, up } = fresh();
  const game = join(dir, 'game');
  mkdirSync(join(game, 'screenshots'), { recursive: true });
  writeFileSync(join(game, 'screenshots', 'me.png'), 'photo');
  writeFileSync(join(game, 'options.txt'), 'key_key.jump:key.keyboard.space\n');
  mkdirSync(join(game, 'mods'), { recursive: true });
  writeFileSync(join(game, 'mods', 'player-added.jar'), 'x'); // not managed by us: must survive

  const a = file('mods/a.jar', 'A1'), b = file('mods/b.jar', 'B1'), cfg = file('config/client.toml', 'default', { mode: 'keep-user' });
  const m1 = manifest('b1', [a, b, cfg]);
  await up.apply(up.accept({ manifest: m1, signature: '', keyId: '' }, [], { allowHttp: true }), 'balanced');
  assert.equal(readFileSync(join(game, 'mods/a.jar'), 'utf8'), 'A1');
  writeFileSync(join(game, 'config/client.toml'), 'player tuned'); // player edits a keep-user config

  requests = [];
  const a2 = file('mods/a.jar', 'A2'), c = file('mods/c.jar', 'C1');
  const m2 = manifest('b2', [a2, c, cfg]); // b.jar removed
  const plan = await up.plan(m2, 'balanced');
  assert.equal(plan.download.length, 2, 'only changed files are downloaded');
  await up.apply(m2, 'balanced');
  assert.equal(readFileSync(join(game, 'mods/a.jar'), 'utf8'), 'A2');
  assert.ok(!existsSync(join(game, 'mods/b.jar')), 'stale managed mod removed');
  assert.ok(existsSync(join(game, 'mods/player-added.jar')), 'unmanaged file kept');
  assert.equal(readFileSync(join(game, 'config/client.toml'), 'utf8'), 'player tuned');
  assert.equal(readFileSync(join(game, 'screenshots/me.png'), 'utf8'), 'photo');
  assert.equal(readFileSync(join(game, 'options.txt'), 'utf8'), 'key_key.jump:key.keyboard.space\n');

  requests = [];
  assert.equal(await up.rollback(), 'b1');
  assert.equal(requests.length, 0, 'rollback works offline from the object store');
  assert.equal(readFileSync(join(game, 'mods/a.jar'), 'utf8'), 'A1');
  assert.ok(existsSync(join(game, 'mods/b.jar')));
  assert.ok(!existsSync(join(game, 'mods/c.jar')));
  assert.equal((await up.loadState()).buildId, 'b1');
});

test('repair restores a damaged file', async () => {
  const { dir, up } = fresh();
  const a = file('mods/a.jar', 'AAAA');
  await up.apply(manifest('r1', [a]), 'balanced');
  writeFileSync(join(dir, 'game/mods/a.jar'), 'AAAB'); // same size, different content
  assert.equal(await up.repair(), 1);
  assert.equal(readFileSync(join(dir, 'game/mods/a.jar'), 'utf8'), 'AAAA');
});

test('interrupted apply is completed by recover()', async () => {
  const { dir, up } = fresh();
  const a = file('mods/a.jar', 'R1');
  const m = manifest('j1', [a]);
  await up.store.fetch(a.url, a.sha256, a.size);
  mkdirSync(join(dir, '.sir/builds'), { recursive: true });
  writeFileSync(join(dir, '.sir/builds/j1.json'), JSON.stringify(m));
  writeFileSync(join(dir, '.sir/apply.journal.json'), JSON.stringify({ buildId: 'j1', preset: 'balanced' }));
  assert.equal(await up.recover(), true);
  assert.equal(readFileSync(join(dir, 'game/mods/a.jar'), 'utf8'), 'R1');
});

test('signature is enforced when keys are configured', () => {
  const { up } = fresh();
  const keys = generateSigningKeys();
  const other = generateSigningKeys();
  const m = manifest('s1', [file('mods/a.jar', 'S')]);
  const signed = signManifest(m, keys.privatePem, keys.publicPem);
  assert.equal(up.accept(signed, [keys.publicPem], { allowHttp: true }).buildId, 's1');
  assert.throws(() => up.accept(signed, [other.publicPem], { allowHttp: true }), ManifestRejectedError);
  const evil = structuredClone(signed); evil.manifest.files[0].path = '../../.bashrc';
  assert.throws(() => up.accept(evil, [keys.publicPem], { allowHttp: true }), ManifestRejectedError);
});
