import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureLinked, RiftAccountApi } from '../dist/core/riftaccount.js';

const account = (minecraft = null) => ({ id: 'a', nick: 'Hunter', role: 'player', status: 'active', mustChangePassword: false, minecraft });
const mc = { name: 'SteveMC', uuid: '0f4e2b0a9f2c4f7f8b1d2a3c4d5e6f70', accessToken: 'mc-token' };

test('already linked to this Minecraft profile: nothing is sent anywhere', async () => {
  const api = { linkChallenge: () => assert.fail('no challenge'), link: () => assert.fail('no link'), me: () => assert.fail('no me') };
  const a = account({ uuid: '0f4e2b0a-9f2c-4f7f-8b1d-2a3c4d5e6f70', name: 'SteveMC', linkedAt: '' });
  assert.equal(await ensureLinked(api, 't', a, mc, () => assert.fail('no join')), a);
});

test('not linked: challenge → Mojang join with the Minecraft token → link; the token never goes to the project API', async () => {
  const calls = [];
  const api = {
    linkChallenge: async (t) => { calls.push(['challenge', t]); return { serverId: 'abc' }; },
    link: async (t, name) => { calls.push(['link', t, name]); return { minecraft: { uuid: 'x', name } }; },
    me: async () => ({ account: account({ uuid: '0f4e2b0a-9f2c-4f7f-8b1d-2a3c4d5e6f70', name: 'SteveMC', linkedAt: '' }) }),
  };
  const joins = [];
  const r = await ensureLinked(api, 'rift-token', account(), mc, async (token, uuid, serverId) => { joins.push([token, uuid, serverId]); });
  assert.deepEqual(joins, [['mc-token', mc.uuid, 'abc']]);
  assert.deepEqual(calls, [['challenge', 'rift-token'], ['link', 'rift-token', 'SteveMC']]);
  assert.equal(r.minecraft.name, 'SteveMC');
});

test('accounts are only used over HTTPS (plain HTTP only for a local backend when allowed)', () => {
  assert.throws(() => new RiftAccountApi('http://rift.example.org'));
  assert.throws(() => new RiftAccountApi('http://127.0.0.1:8080'));
  assert.doesNotThrow(() => new RiftAccountApi('http://127.0.0.1:8080', true));
  assert.doesNotThrow(() => new RiftAccountApi('https://rift.example.org'));
});
