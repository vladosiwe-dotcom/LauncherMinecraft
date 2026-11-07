import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { downloadFile, fetchWithTimeout, fileExists } from './http.js';

const run = promisify(execFile);
export const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';

export function neoforgeVersionId(version: string) { return `neoforge-${version}`; }

/** Installs the NeoForge client profile with the official installer (headless mode). Idempotent. */
export async function installNeoForge(root: string, version: string, javaExe: string, log?: (line: string) => void): Promise<string> {
  if (!/^21\.1\.\d+(-beta)?$/.test(version)) throw new Error(`Refusing NeoForge ${version}: only 21.1.x (Minecraft 1.21.1) is supported`);
  const id = neoforgeVersionId(version);
  const json = join(root, 'versions', id, `${id}.json`);
  if (await fileExists(json)) return id;

  const url = `${NEOFORGE_MAVEN}/${version}/neoforge-${version}-installer.jar`;
  const shaRes = await fetchWithTimeout(`${url}.sha256`).catch(() => undefined);
  const sha256 = shaRes?.ok ? (await shaRes.text()).trim().split(/\s+/)[0] : undefined;
  let sha1: string | undefined;
  if (!sha256) {
    const r = await fetchWithTimeout(`${url}.sha1`);
    if (!r.ok) throw new Error('NeoForge installer checksum is not available; refusing to run an unverified installer');
    sha1 = (await r.text()).trim().split(/\s+/)[0];
  }
  const installer = join(root, 'cache', `neoforge-${version}-installer.jar`);
  await downloadFile({ url, dest: installer, sha256, sha1 });

  // The installer requires a launcher profile file to exist in the target directory.
  const profiles = join(root, 'launcher_profiles.json');
  if (!(await fileExists(profiles))) await fs.writeFile(profiles, JSON.stringify({ profiles: {}, settings: {}, version: 3 }));

  const { stdout, stderr } = await run(javaExe.replace(/javaw\.exe$/, 'java.exe'), ['-jar', installer, '--install-client', root], { cwd: root, maxBuffer: 32 * 1024 * 1024, timeout: 20 * 60 * 1000 });
  stdout.split('\n').concat(stderr.split('\n')).filter(Boolean).forEach((l) => log?.(l));
  if (!(await fileExists(json))) throw new Error('NeoForge installer finished but did not create the version profile');
  return id;
}
