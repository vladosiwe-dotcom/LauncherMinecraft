import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateManifest, isSafeManagedPath, planSync, canonicalJson,
  generateSigningKeys, signManifest, verifyManifest,
  recommendPreset, applyOptions, clientFiles,
} from '../dist/index.js';

const sha = (c) => c.repeat(64);
export const sample = () => ({
  schema: 1, project: 'spell-and-iron-rift', buildId: 'b-0001', version: '0.1.0', channel: 'stable',
  createdAt: '2026-11-07T00:00:00Z', minecraft: '1.21.1',
  loader: { type: 'neoforge', version: '21.1.172' },
  java: { majorVersion: 21, mojangComponent: 'java-runtime-delta' },
  server: { host: 'play.example.org', port: 25565 }, resourcePacks: ['rift-ui.zip'],
  files: [
    { path: 'mods/a.jar', name: 'A', version: '1', size: 3, url: 'https://cdn.example.org/a', sha256: sha('a'), category: 'mod', required: true, side: 'both', mode: 'replace' },
    { path: 'mods/server-only.jar', name: 'S', version: '1', size: 3, url: 'https://cdn.example.org/s', sha256: sha('b'), category: 'mod', required: true, side: 'server', mode: 'replace' },
    { path: 'shaderpacks/x.zip', name: 'X', version: '1', size: 3, url: 'https://cdn.example.org/x', sha256: sha('c'), category: 'shaderpack', required: false, side: 'client', mode: 'replace', presets: ['high', 'ultra'] },
    { path: 'config/keys.toml', name: 'K', version: '1', size: 3, url: 'https://cdn.example.org/k', sha256: sha('d'), category: 'config', required: true, side: 'client', mode: 'keep-user' },
  ],
});

test('valid manifest has no issues', () => assert.deepEqual(validateManifest(sample()), []));

test('rejects other loaders, versions, http and traversal', () => {
  const m = sample();
  m.loader.type = 'fabric'; m.minecraft = '1.20.1';
  m.files[0].url = 'http://cdn.example.org/a';
  m.files[1].path = 'mods/../../evil.jar';
  const paths = validateManifest(m).map((i) => i.path);
  for (const p of ['loader.type', 'minecraft', 'files[0].url', 'files[1].path']) assert.ok(paths.includes(p), p);
});

test('managed path rules protect player data', () => {
  assert.ok(isSafeManagedPath('mods/x.jar'));
  assert.ok(!isSafeManagedPath('saves/world/level.dat'));
  assert.ok(!isSafeManagedPath('options.txt'));
  assert.ok(!isSafeManagedPath('C:/Windows/x'));
  assert.ok(!isSafeManagedPath('/etc/passwd'));
  assert.ok(!isSafeManagedPath('config/iris.properties'));
});

test('planSync downloads only what changed, keeps user configs, removes stale managed files', () => {
  const m = sample();
  const target = clientFiles(m, 'balanced');
  assert.equal(target.length, 2); // no server-only, no shader on balanced
  const disk = { 'mods/a.jar': sha('a'), 'config/keys.toml': sha('9') };
  const plan = planSync(target, [{ path: 'mods/old.jar', sha256: sha('e'), mode: 'replace' }, { path: 'saves/x', sha256: sha('f'), mode: 'replace' }], (p) => disk[p], () => false);
  assert.equal(plan.download.length, 0);
  assert.equal(plan.unchanged.length, 2);
  assert.deepEqual(plan.remove, ['mods/old.jar']);
});

test('signature round trip and tamper detection', () => {
  const { privatePem, publicPem } = generateSigningKeys();
  const s = signManifest(sample(), privatePem, publicPem);
  assert.ok(verifyManifest(s, [publicPem]));
  s.manifest.files[0].url = 'https://evil.example/a';
  assert.ok(!verifyManifest(s, [publicPem]));
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: 0 }] }), '{"a":[2,{"c":0,"d":1}],"b":1}');
});

test('preset recommendation is conservative', () => {
  assert.equal(recommendPreset({ cpuModel: '', cpuThreads: 4, totalRamMb: 6000 }).preset, 'minimal');
  assert.equal(recommendPreset({ cpuModel: '', cpuThreads: 8, totalRamMb: 16000, gpuVendor: 'intel' }).preset, 'balanced');
  assert.equal(recommendPreset({ cpuModel: '', cpuThreads: 12, totalRamMb: 16000, gpuVendor: 'nvidia', vramMb: 6000 }).preset, 'high');
  assert.equal(recommendPreset({ cpuModel: '', cpuThreads: 16, totalRamMb: 32000, gpuVendor: 'nvidia', vramMb: 12000 }).preset, 'ultra');
});

test('applyOptions keeps keybinds', () => {
  const out = applyOptions('key_key.jump:key.keyboard.space\nrenderDistance:32\n', { renderDistance: '12', particles: '1' });
  assert.equal(out, 'key_key.jump:key.keyboard.space\nrenderDistance:12\nparticles:1\n');
});
