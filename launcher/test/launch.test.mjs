import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { buildCommand, sanitizeJvmArgs, redactArgs } from '../dist/core/launch.js';
import { rulesAllow, mavenPath, resolveVersion, VanillaInstaller } from '../dist/core/mojang.js';
import { applyProperties } from '../dist/core/game.js';

test('maven paths and OS rules', () => {
  assert.equal(mavenPath('net.neoforged:neoforge:21.1.172:universal'), 'net/neoforged/neoforge/21.1.172/neoforge-21.1.172-universal.jar');
  assert.equal(mavenPath('a.b:c:1@zip'), 'a/b/c/1/c-1.zip');
  assert.equal(rulesAllow([{ action: 'allow', os: { name: 'osx' } }], {}, 'linux'), false);
  assert.equal(rulesAllow([{ action: 'allow' }, { action: 'disallow', os: { name: 'osx' } }], {}, 'osx'), false);
  assert.equal(rulesAllow([{ action: 'allow', features: { is_demo_user: true } }], {}), false);
});

test('inheritsFrom merge and argument building (NeoForge-shaped profile)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sir-l-'));
  const vjson = (id, v) => { mkdirSync(join(root, 'versions', id), { recursive: true }); writeFileSync(join(root, 'versions', id, `${id}.json`), JSON.stringify(v)); };
  vjson('1.21.1', {
    id: '1.21.1', mainClass: 'net.minecraft.client.main.Main', assetIndex: { id: '17' },
    libraries: [{ name: 'org.lwjgl:lwjgl:3.3.3', downloads: { artifact: { path: 'org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3.jar' } } }, { name: 'org.ow2.asm:asm:9.6' }],
    arguments: { game: ['--username', '${auth_player_name}', '--accessToken', '${auth_access_token}', '--assetIndex', '${assets_index_name}', { rules: [{ action: 'allow', features: { has_custom_resolution: true } }], value: ['--width', '${resolution_width}', '--height', '${resolution_height}'] }], jvm: ['-cp', '${classpath}'] },
  });
  writeFileSync(join(root, 'versions/1.21.1/1.21.1.jar'), '');
  vjson('neoforge-21.1.172', {
    id: 'neoforge-21.1.172', inheritsFrom: '1.21.1', mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher',
    libraries: [{ name: 'org.ow2.asm:asm:9.7' }, { name: 'net.neoforged.fancymodloader:loader:4.0.0' }],
    arguments: { game: ['--fml.neoForgeVersion', '21.1.172'], jvm: ['-DlibraryDirectory=${library_directory}'] },
  });
  const v = await resolveVersion(new VanillaInstaller(root), 'neoforge-21.1.172');
  assert.equal(v.mainClass, 'cpw.mods.bootstraplauncher.BootstrapLauncher');
  assert.equal(v.libraries.filter((l) => l.name.startsWith('org.ow2.asm:asm')).length, 1);
  assert.equal(v.libraries.find((l) => l.name.startsWith('org.ow2.asm:asm')).name, 'org.ow2.asm:asm:9.7', 'loader library wins');
  const { args, classpath } = buildCommand({ root, gameDir: join(root, 'game'), javaExe: 'java', version: v, memoryMb: 6144, width: 1600, height: 900,
    profile: { name: 'Steve', uuid: 'u', accessToken: 'SECRET', xuid: 'x' }, launcherVersion: '0.1.0', extraJvmArgs: ['-XX:+UseZGC', '-javaagent:evil.jar', '-Xmx99G'] });
  assert.ok(args.includes('-Xmx6144M'));
  assert.ok(!args.includes('-javaagent:evil.jar') && !args.includes('-Xmx99G'));
  assert.ok(args.includes('-XX:+UseZGC'));
  assert.ok(args.includes(`-DlibraryDirectory=${join(root, 'libraries')}`));
  assert.ok(args.includes('--width') && args.includes('1600'));
  assert.equal(args[args.indexOf('--fml.neoForgeVersion') + 1], '21.1.172');
  assert.ok(classpath.at(-1).endsWith('1.21.1.jar'));
  assert.ok(args[args.indexOf('-cp') + 1].split(delimiter).length === classpath.length);
  assert.equal(redactArgs(args)[args.indexOf('--accessToken') + 1], '********');
});

test('jvm arg sanitizer and properties merge', () => {
  assert.deepEqual(sanitizeJvmArgs(['-cp', 'x', '-Dfoo=1', '  ']), ['x', '-Dfoo=1']);
  assert.equal(applyProperties('# iris\nshaderPack=old.zip\nmaxShadowRenderDistance=32\n', { shaderPack: 'new.zip', enableShaders: 'true' }),
    '# iris\nshaderPack=new.zip\nmaxShadowRenderDistance=32\nenableShaders=true\n');
});
