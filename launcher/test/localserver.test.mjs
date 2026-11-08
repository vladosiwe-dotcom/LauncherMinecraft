import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offlineUuid, isLocalHost, serverProperties, serverFiles, NICK_RE } from '../dist/core/localserver.js';

test('offline UUID matches Java UUID.nameUUIDFromBytes("OfflinePlayer:" + name)', () => {
  assert.equal(offlineUuid('Notch'), 'b50ad385-829d-3141-a216-7e7d7539ba7f');
  assert.equal(offlineUuid('Hunter_01'), '3d02b9e5-8d37-3f2a-8f43-dfa02a4dbf40');
});

test('test mode only reaches this PC and private networks', () => {
  for (const h of ['127.0.0.1', 'localhost', '192.168.1.20', '10.0.0.5', '172.20.3.4']) assert.ok(isLocalHost(h), h);
  for (const h of ['8.8.8.8', 'play.example.org', '172.32.0.1', '192.169.0.1', '']) assert.ok(!isLocalHost(h), h);
});

test('server.properties: test mode turns off Microsoft checks, normal mode keeps them, other keys stay', () => {
  const p = serverProperties('# kept\nlevel-name=world\nonline-mode=true\n', { port: 25570, memoryMb: 4096, testMode: true, motd: 'Rift\nTest' });
  assert.match(p, /# kept/); assert.match(p, /level-name=world/); assert.match(p, /online-mode=false/); assert.match(p, /server-port=25570/); assert.match(p, /motd=Rift Test/);
  assert.match(serverProperties(p, { port: 25565, memoryMb: 4096, testMode: false, motd: 'x' }), /online-mode=true/);
});

test('server gets server and both-side files only, never unsafe paths', () => {
  const f = (path, side) => ({ path, side, name: path, version: '1', size: 1, url: 'https://x/y', sha256: 'a'.repeat(64), category: 'mod', required: true, mode: 'replace' });
  const m = { files: [f('mods/a.jar', 'both'), f('mods/client.jar', 'client'), f('mods/srv.jar', 'server'), f('../evil.jar', 'both')] };
  assert.deepEqual(serverFiles(m).map((x) => x.path), ['mods/a.jar', 'mods/srv.jar']);
});

test('nicknames', () => {
  assert.ok(NICK_RE.test('Hunter_01'));
  assert.ok(!NICK_RE.test('ab')); assert.ok(!NICK_RE.test('Имя')); assert.ok(!NICK_RE.test('a'.repeat(17)));
});
