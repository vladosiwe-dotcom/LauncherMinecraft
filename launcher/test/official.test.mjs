import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROFILE_ID, officialDir, writeOfficialProfile } from '../dist/core/official.js';

test('official launcher folder per system', () => {
  assert.equal(officialDir('win32', { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'C:\\Users\\a'), join('C:\\Users\\a\\AppData\\Roaming', '.minecraft'));
  assert.equal(officialDir('linux', {}, '/home/a'), '/home/a/.minecraft');
});

test('our installation is added without touching the player\'s other profiles and settings', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mc-'));
  writeFileSync(join(dir, 'launcher_profiles.json'), JSON.stringify({ profiles: { mine: { name: 'Vanilla', type: 'latest-release' } }, settings: { keepLauncherOpen: true }, version: 3 }));
  await writeOfficialProfile(dir, { versionId: 'neoforge-21.1.228', gameDir: '/games/rift', memoryMb: 6144, jvmArgs: '-XX:+AlwaysPreTouch', width: 1600, height: 900 });
  await writeOfficialProfile(dir, { versionId: 'neoforge-21.1.230', gameDir: '/games/rift', memoryMb: 4096, jvmArgs: '', width: 1600, height: 900 });
  const d = JSON.parse(readFileSync(join(dir, 'launcher_profiles.json'), 'utf8'));
  assert.deepEqual(d.profiles.mine, { name: 'Vanilla', type: 'latest-release' });
  assert.equal(d.settings.keepLauncherOpen, true);
  const p = d.profiles[PROFILE_ID];
  assert.equal(p.lastVersionId, 'neoforge-21.1.230');
  assert.equal(p.gameDir, '/games/rift');
  assert.match(p.javaArgs, /^-Xmx4096M /);
  assert.equal(p.type, 'custom');
  // works when the official launcher never ran
  const fresh = mkdtempSync(join(tmpdir(), 'mc-'));
  await writeOfficialProfile(fresh, { versionId: 'neoforge-21.1.228', gameDir: '/g', memoryMb: 4096, jvmArgs: '', width: 854, height: 480 });
  assert.ok(JSON.parse(readFileSync(join(fresh, 'launcher_profiles.json'), 'utf8')).profiles[PROFILE_ID]);
});
