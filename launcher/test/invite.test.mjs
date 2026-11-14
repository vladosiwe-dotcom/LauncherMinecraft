import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeInvite, encodeInvite } from '../dist/core/invite.js';
import { cloudflaredAsset, parseQuickUrl } from '../dist/core/tunnel.js';

test('invite code round-trips and rejects junk', () => {
  const code = encodeInvite({ api: 'https://calm-river.trycloudflare.com', game: 'rift.joinmc.link', keyId: '5f7808b0f1c441a3' });
  assert.match(code, /^RIFT-/);
  assert.deepEqual(decodeInvite(code), { api: 'https://calm-river.trycloudflare.com', game: 'rift.joinmc.link', keyId: '5f7808b0f1c441a3' });
  const bad = ['', 'hello', 'RIFT-!!!',
    encodeInvite({ api: 'http://plain.example', game: '', keyId: '5f7808b0f1c441a3' }),
    encodeInvite({ api: 'https://x.example', game: 'bad host!', keyId: '5f7808b0f1c441a3' }),
    encodeInvite({ api: 'https://x.example', game: '', keyId: 'nothex' })];
  for (const b of bad) assert.throws(() => decodeInvite(b), (e) => e.code === 'invite_bad', b);
});

test('quick tunnel address is read from cloudflared output; binaries per system', () => {
  assert.equal(parseQuickUrl('2026-11-14T10:00:00Z INF |  https://calm-river-abc.trycloudflare.com  |'), 'https://calm-river-abc.trycloudflare.com');
  assert.equal(parseQuickUrl('INF Registered tunnel connection'), null);
  assert.equal(parseQuickUrl('ERR failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": dial tcp'), null);
  assert.equal(cloudflaredAsset('win32', 'x64'), 'cloudflared-windows-amd64.exe');
  assert.equal(cloudflaredAsset('linux', 'x64'), 'cloudflared-linux-amd64');
  assert.equal(cloudflaredAsset('darwin', 'arm64'), null);
});
