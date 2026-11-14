import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startEmbedded } from '../dist/embedded.js';

test('embedded build server: owner account, signing key, admin only from this PC', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'rift-emb-'));
  const b = await startEmbedded({ dataDir, port: 0 || 18080 + Math.floor(Math.random() * 1000), publicBaseUrl: 'https://build.example.test', mcHost: 'game.example.test', mcPort: 25565 });
  try {
    assert.equal(await b.hasOwner(), false);
    await assert.rejects(b.createOwner('Rutaku', 'short'), (e) => e.code === 'owner_password');
    await b.createOwner('Rutaku', 'TestOwnerPass2026');
    assert.equal(await b.hasOwner(), true);
    await assert.rejects(b.createOwner('Other', 'TestOwnerPass2026'), (e) => e.code === 'owner_exists');

    const key = await (await fetch(`${b.url}/api/public/key`)).json();
    assert.equal(key.keyId, b.keyId);
    assert.match(key.publicPem, /BEGIN PUBLIC KEY/);

    const login = (headers = {}) => fetch(`${b.url}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ username: 'Rutaku', password: 'TestOwnerPass2026' }) });
    assert.equal((await login()).status, 200, 'owner signs in on this PC');
    for (const h of [{ 'CF-Connecting-IP': '203.0.113.5' }, { 'X-Forwarded-For': '203.0.113.5' }, { Forwarded: 'for=203.0.113.5' }]) {
      assert.equal((await login(h)).status, 404, `admin API hidden behind a tunnel (${Object.keys(h)[0]})`);
      assert.equal((await fetch(`${b.url}/admin/`, { headers: h })).status, 404, 'admin page hidden behind a tunnel');
    }
    assert.equal((await fetch(`${b.url}/api/public/key`, { headers: { 'CF-Connecting-IP': '203.0.113.5' } })).status, 200, 'public API stays reachable through the tunnel');
  } finally { await b.close(); }
});
