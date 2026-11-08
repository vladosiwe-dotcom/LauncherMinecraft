import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { canonicalJson } from './manifest.js';
import { keyIdOf } from './signing.js';

/**
 * Launcher self-update. The admin publishes a release (version, notes, one installer per platform) in Rift Control;
 * the backend signs it with the same Ed25519 key as build manifests. The launcher checks it on every start,
 * verifies the signature and the installer's SHA-256, and only then offers to update. Updating is optional:
 * the launcher keeps working (account, skin, server status, news, playing) on the old version.
 */
export type LauncherPlatform = 'win' | 'mac' | 'linux';
export const LAUNCHER_PLATFORMS: readonly LauncherPlatform[] = ['win', 'mac', 'linux'];

export interface LauncherFile { url: string; sha256: string; size: number; fileName: string }
export interface LauncherRelease {
  version: string;
  publishedAt: string;
  notes: { ru: string; uk: string; en: string };
  files: Partial<Record<LauncherPlatform, LauncherFile>>;
}
export interface SignedLauncherRelease { release: LauncherRelease; signature: string; keyId: string }

export const LAUNCHER_VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

/** Numeric comparison of x.y.z versions: negative if a < b, 0 if equal, positive if a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0), pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function launcherPlatformOf(nodePlatform: string): LauncherPlatform | null {
  return nodePlatform === 'win32' ? 'win' : nodePlatform === 'darwin' ? 'mac' : nodePlatform === 'linux' ? 'linux' : null;
}

// The signed payload is tagged so a release signature can never be mistaken for a build manifest signature.
const payload = (release: LauncherRelease) => Buffer.from(canonicalJson({ kind: 'launcher-release', release }));

export function signLauncherRelease(release: LauncherRelease, privatePem: string, publicPem: string): SignedLauncherRelease {
  return { release, signature: sign(null, payload(release), createPrivateKey(privatePem)).toString('base64'), keyId: keyIdOf(publicPem) };
}

export function verifyLauncherRelease(signed: SignedLauncherRelease, trustedPublicPems: string[]): boolean {
  for (const pem of trustedPublicPems) {
    if (keyIdOf(pem) !== signed.keyId) continue;
    try { return verify(null, payload(signed.release), createPublicKey(pem), Buffer.from(signed.signature, 'base64')); } catch { return false; }
  }
  return false;
}
