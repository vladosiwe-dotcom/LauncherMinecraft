import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSigningKeys, signLauncherRelease } from '@sir/shared';
import { checkLauncherUpdate, LauncherReleaseRejectedError } from '../dist/core/selfupdate.js';

const keys = generateSigningKeys();
const release = (version, files = { win: { url: 'https://rift.example.org/files/x', sha256: 'c'.repeat(64), size: 10, fileName: 'Setup.exe' } }) =>
  ({ version, publishedAt: '2026-11-08T00:00:00Z', notes: { ru: 'Новое', uk: 'Нове', en: 'New' }, files });
const apiOf = (signed) => ({ launcher: async () => signed });
const offline = { launcher: async () => { throw new Error('fetch failed'); } };

test('offers a newer signed release with an installer for this system', async () => {
  const u = await checkLauncherUpdate(apiOf(signLauncherRelease(release('0.2.0'), keys.privatePem, keys.publicPem)), '0.1.0', [keys.publicPem], 'en', 'win32');
  assert.equal(u.version, '0.2.0');
  assert.equal(u.notes, 'New');
});

test('nothing to offer: same or older version, other platform, offline, no trusted keys', async () => {
  const s = (v) => apiOf(signLauncherRelease(release(v), keys.privatePem, keys.publicPem));
  assert.equal(await checkLauncherUpdate(s('0.1.0'), '0.1.0', [keys.publicPem], 'ru', 'win32'), null);
  assert.equal(await checkLauncherUpdate(s('0.0.9'), '0.1.0', [keys.publicPem], 'ru', 'win32'), null);
  assert.equal(await checkLauncherUpdate(s('0.2.0'), '0.1.0', [keys.publicPem], 'ru', 'linux'), null);
  assert.equal(await checkLauncherUpdate(offline, '0.1.0', [keys.publicPem], 'ru', 'win32'), null);
  assert.equal(await checkLauncherUpdate(s('0.2.0'), '0.1.0', [], 'ru', 'win32'), null);
});

test('a release signed by an unknown key or tampered with is rejected', async () => {
  const other = generateSigningKeys();
  const forged = signLauncherRelease(release('9.9.9'), other.privatePem, other.publicPem);
  forged.keyId = signLauncherRelease(release('9.9.9'), keys.privatePem, keys.publicPem).keyId; // pretend to be ours
  await assert.rejects(checkLauncherUpdate(apiOf(forged), '0.1.0', [keys.publicPem], 'ru', 'win32'), LauncherReleaseRejectedError);
  const signed = signLauncherRelease(release('0.2.0'), keys.privatePem, keys.publicPem);
  signed.release.files.win.url = 'https://evil.example.org/x';
  await assert.rejects(checkLauncherUpdate(apiOf(signed), '0.1.0', [keys.publicPem], 'ru', 'win32'), LauncherReleaseRejectedError);
});
