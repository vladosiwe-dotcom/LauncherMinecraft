import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, generateSigningKeys, signLauncherRelease, verifyLauncherRelease, launcherPlatformOf, signManifest, verifyManifest } from '../dist/index.js';

const release = () => ({
  version: '0.2.0', publishedAt: '2026-11-08T00:00:00Z', notes: { ru: 'Новое меню', uk: 'Нове меню', en: 'New menu' },
  files: { win: { url: 'https://rift.example.org/files/' + 'a'.repeat(64), sha256: 'a'.repeat(64), size: 1234, fileName: 'Rift-Setup-0.2.0.exe' } },
});

test('versions compare numerically', () => {
  assert.ok(compareVersions('0.10.0', '0.9.9') > 0);
  assert.ok(compareVersions('1.0.0', '1.0.1') < 0);
  assert.equal(compareVersions('2.3.4', '2.3.4'), 0);
});

test('a signed launcher release verifies and any change breaks it', () => {
  const k = generateSigningKeys();
  const s = signLauncherRelease(release(), k.privatePem, k.publicPem);
  assert.equal(verifyLauncherRelease(s, [k.publicPem]), true);
  const tampered = structuredClone(s); tampered.release.files.win.sha256 = 'b'.repeat(64);
  assert.equal(verifyLauncherRelease(tampered, [k.publicPem]), false);
  assert.equal(verifyLauncherRelease(s, [generateSigningKeys().publicPem]), false);
});

test('a launcher release signature is not valid as a build manifest signature', () => {
  const k = generateSigningKeys();
  const s = signLauncherRelease(release(), k.privatePem, k.publicPem);
  assert.equal(verifyManifest({ manifest: s.release, signature: s.signature, keyId: s.keyId }, [k.publicPem]), false);
  const m = signManifest(release(), k.privatePem, k.publicPem);
  assert.equal(verifyLauncherRelease({ release: m.manifest, signature: m.signature, keyId: m.keyId }, [k.publicPem]), false);
});

test('platform names', () => {
  assert.equal(launcherPlatformOf('win32'), 'win');
  assert.equal(launcherPlatformOf('darwin'), 'mac');
  assert.equal(launcherPlatformOf('linux'), 'linux');
  assert.equal(launcherPlatformOf('aix'), null);
});
