import { basename, join } from 'node:path';
import { compareVersions, launcherPlatformOf, verifyLauncherRelease, type LauncherFile, type SignedLauncherRelease } from '@sir/shared';
import { downloadFile } from './http.js';

/**
 * Launcher self-update: the newest release published in Rift Control, if it is newer than this launcher,
 * signed by a trusted key and has an installer for this system. Updating is always the player's choice;
 * an old launcher keeps working (account, skin, server status, news and playing).
 */
export interface LauncherUpdate { version: string; publishedAt: string; notes: string; file: LauncherFile }

export class LauncherReleaseRejectedError extends Error {}

export async function checkLauncherUpdate(
  api: { launcher(): Promise<SignedLauncherRelease> },
  current: string,
  trustedKeys: string[],
  lang: 'ru' | 'uk' | 'en',
  platform: string = process.platform,
): Promise<LauncherUpdate | null> {
  if (!trustedKeys.length) return null; // no trust anchor configured: never offer to run downloaded code
  let signed: SignedLauncherRelease;
  try { signed = await api.launcher(); } catch { return null; } // nothing published, or offline
  if (!verifyLauncherRelease(signed, trustedKeys)) throw new LauncherReleaseRejectedError('launcher release signature is invalid');
  const r = signed.release;
  if (compareVersions(r.version, current) <= 0) return null;
  const p = launcherPlatformOf(platform);
  const file = p ? r.files[p] : undefined;
  if (!file || !/^[a-f0-9]{64}$/.test(file.sha256)) return null;
  return { version: r.version, publishedAt: r.publishedAt, notes: r.notes[lang] || r.notes.ru || '', file };
}

/** Downloads the installer (resumable, SHA-256 checked before it is used). Returns its path. */
export async function downloadLauncherUpdate(u: LauncherUpdate, dir: string, onProgress: (done: number, total: number) => void, signal?: AbortSignal): Promise<string> {
  const safe = basename(u.file.fileName).replace(/[^\w.+\-]/g, '_') || 'launcher-update';
  const dest = join(dir, `${u.version}-${safe}`);
  let done = 0;
  await downloadFile({ url: u.file.url, dest, sha256: u.file.sha256, size: u.file.size, signal, onBytes: (d) => { done += d; onProgress(done, u.file.size); } });
  onProgress(u.file.size, u.file.size);
  return dest;
}
