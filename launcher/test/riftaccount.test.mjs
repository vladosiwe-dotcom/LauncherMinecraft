import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RiftAccountApi } from '../dist/core/riftaccount.js';

test('Rift account API only accepts HTTPS except explicitly allowed localhost', () => {
  assert.throws(() => new RiftAccountApi('http://rift.example.org'));
  assert.throws(() => new RiftAccountApi('http://127.0.0.1:8080'));
  assert.doesNotThrow(() => new RiftAccountApi('http://127.0.0.1:8080', true));
  assert.doesNotThrow(() => new RiftAccountApi('https://rift.example.org'));
});

test('gameSession requests a one-use ticket using the Rift bearer session', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({ token: 'one-use-ticket', serverId: 'main', expiresAt: 123456 }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const api = new RiftAccountApi('https://rift.example.org');
    const result = await api.gameSession('rift-session-token', 'main');
    assert.deepEqual(result, { token: 'one-use-ticket', serverId: 'main', expiresAt: 123456 });
    assert.equal(request.url, 'https://rift.example.org/api/account/game-session');
    assert.equal(request.init.method, 'POST');
    assert.equal(request.init.headers.Authorization, 'Bearer rift-session-token');
    assert.deepEqual(JSON.parse(request.init.body), { serverId: 'main' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
