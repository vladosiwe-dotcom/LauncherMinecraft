/**
 * Build manifest: the single source of truth for what a Spell and Iron Rift
 * client installation must contain. Produced and signed by the backend,
 * verified and applied by the launcher.
 */

export const MINECRAFT_VERSION = '1.21.1' as const;
export const MANIFEST_SCHEMA = 1 as const;

export type FileCategory = 'mod' | 'config' | 'resourcepack' | 'shaderpack' | 'other';
export type Side = 'client' | 'server' | 'both';
/** replace: always enforce the published content. keep-user: install only when missing (user may edit). */
export type InstallMode = 'replace' | 'keep-user';
export type GraphicsPresetId = 'minimal' | 'balanced' | 'high' | 'ultra';

export interface ManifestFile {
  /** Path relative to the game directory, forward slashes, e.g. "mods/irons_spellbooks-1.21.1-3.x.jar". */
  path: string;
  name: string;
  version: string;
  size: number;
  url: string;
  sha256: string;
  category: FileCategory;
  required: boolean;
  side: Side;
  mode: InstallMode;
  /** Only install when the player's graphics preset is one of these (used for shaders / heavy visual mods). */
  presets?: GraphicsPresetId[];
}

export interface BuildManifest {
  schema: typeof MANIFEST_SCHEMA;
  project: 'spell-and-iron-rift';
  buildId: string;
  /** Human readable pack version, e.g. "0.3.0". */
  version: string;
  channel: 'stable' | 'testing';
  createdAt: string;
  minecraft: typeof MINECRAFT_VERSION;
  loader: { type: 'neoforge'; version: string };
  java: { majorVersion: number; mojangComponent: string };
  server: { host: string; port: number };
  /** Required resource pack ids in load order (file names under resourcepacks/). */
  resourcePacks: string[];
  changelog?: Record<string, string>;
  files: ManifestFile[];
}

export interface SignedManifest {
  manifest: BuildManifest;
  /** base64 Ed25519 signature over canonicalJson(manifest). */
  signature: string;
  keyId: string;
}

/** Top-level directories the manifest is allowed to write into. Everything else belongs to the player. */
export const MANAGED_ROOTS = ['mods', 'config', 'defaultconfigs', 'resourcepacks', 'shaderpacks', 'spellironrift'] as const;

/** Player data that an update must never touch, even if a manifest names it. */
export const PROTECTED_PATHS = [
  'options.txt',
  'optionsof.txt',
  'servers.dat',
  'screenshots/',
  'saves/',
  'logs/',
  'crash-reports/',
  'journeymap/data/',
  'config/iris.properties',
] as const;

const SHA256_RE = /^[a-f0-9]{64}$/;
const BUILD_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

export function normalizeRelPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** True if the path is relative, has no traversal and stays inside a managed root. */
export function isSafeManagedPath(p: string): boolean {
  const n = normalizeRelPath(p);
  if (!n || n.startsWith('/') || /^[A-Za-z]:/.test(n) || n.includes('\0')) return false;
  const parts = n.split('/');
  if (parts.some((s) => s === '' || s === '.' || s === '..')) return false;
  if (!(MANAGED_ROOTS as readonly string[]).includes(parts[0]!)) return false;
  return !isProtectedPath(n);
}

export function isProtectedPath(p: string): boolean {
  const n = normalizeRelPath(p);
  return PROTECTED_PATHS.some((pp) => (pp.endsWith('/') ? n.startsWith(pp) : n === pp));
}

export interface ValidationIssue { path: string; message: string }

export function validateManifest(m: unknown, opts: { allowHttp?: boolean } = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  if (!m || typeof m !== 'object') return [{ path: '', message: 'manifest must be an object' }];
  const x = m as Partial<BuildManifest>;
  if (x.schema !== MANIFEST_SCHEMA) add('schema', `unsupported schema ${String(x.schema)}`);
  if (x.project !== 'spell-and-iron-rift') add('project', 'wrong project id');
  if (!x.buildId || !BUILD_ID_RE.test(x.buildId)) add('buildId', 'invalid build id');
  if (!x.version) add('version', 'missing pack version');
  if (x.minecraft !== MINECRAFT_VERSION) add('minecraft', `only Minecraft ${MINECRAFT_VERSION} is supported`);
  if (x.loader?.type !== 'neoforge') add('loader.type', 'only NeoForge is supported');
  if (!x.loader?.version || !/^21\.1\.\d+/.test(x.loader.version)) add('loader.version', 'NeoForge for 1.21.1 must be 21.1.x');
  if (!x.java || x.java.majorVersion < 21) add('java', 'Java 21+ is required');
  if (!x.server?.host || !x.server.port || x.server.port < 1 || x.server.port > 65535) add('server', 'invalid server address');
  if (!Array.isArray(x.files)) { add('files', 'files must be an array'); return issues; }
  const seen = new Set<string>();
  x.files.forEach((f, i) => {
    const at = `files[${i}]`;
    if (!f || typeof f !== 'object') return add(at, 'not an object');
    const p = normalizeRelPath(f.path ?? '');
    if (!isSafeManagedPath(p)) add(`${at}.path`, `unsafe or unmanaged path "${f.path}"`);
    if (seen.has(p.toLowerCase())) add(`${at}.path`, `duplicate path "${p}"`);
    seen.add(p.toLowerCase());
    if (!SHA256_RE.test(f.sha256 ?? '')) add(`${at}.sha256`, 'sha256 must be 64 lowercase hex chars');
    if (!Number.isInteger(f.size) || f.size < 0) add(`${at}.size`, 'invalid size');
    if (!f.name) add(`${at}.name`, 'missing name');
    if (!f.version) add(`${at}.version`, 'missing version');
    if (!['mod', 'config', 'resourcepack', 'shaderpack', 'other'].includes(f.category)) add(`${at}.category`, 'invalid category');
    if (!['client', 'server', 'both'].includes(f.side)) add(`${at}.side`, 'invalid side');
    if (!['replace', 'keep-user'].includes(f.mode)) add(`${at}.mode`, 'invalid mode');
    try {
      const u = new URL(f.url);
      const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      if (u.protocol !== 'https:' && !(opts.allowHttp && u.protocol === 'http:' && local)) add(`${at}.url`, 'downloads must use HTTPS');
    } catch { add(`${at}.url`, 'invalid url'); }
  });
  return issues;
}

/** Files of a manifest that a client installation should contain for a given preset. */
export function clientFiles(m: BuildManifest, preset: GraphicsPresetId): ManifestFile[] {
  return m.files.filter((f) => f.side !== 'server' && (!f.presets || f.presets.includes(preset)));
}

export function serverFiles(m: BuildManifest): ManifestFile[] {
  return m.files.filter((f) => f.side !== 'client');
}

export interface InstalledFile { path: string; sha256: string; mode: InstallMode }

export interface SyncPlan {
  download: ManifestFile[];
  /** Files to (re)write from the local object store into the game directory. */
  write: ManifestFile[];
  /** Previously managed files that are no longer part of the build. */
  remove: string[];
  unchanged: ManifestFile[];
}

/**
 * Compute what must change to move an installation to `target`.
 * @param installed files the launcher wrote previously (from its state file)
 * @param onDisk sha256 of what is currently on disk per path (undefined = missing)
 * @param haveObject whether the object store already holds a blob
 */
export function planSync(
  target: ManifestFile[],
  installed: InstalledFile[],
  onDisk: (path: string) => string | undefined,
  haveObject: (sha256: string) => boolean,
): SyncPlan {
  const plan: SyncPlan = { download: [], write: [], remove: [], unchanged: [] };
  const targetPaths = new Set(target.map((f) => normalizeRelPath(f.path).toLowerCase()));
  for (const f of target) {
    const disk = onDisk(f.path);
    const ok = disk === f.sha256 || (f.mode === 'keep-user' && disk !== undefined);
    if (ok) { plan.unchanged.push(f); continue; }
    if (!haveObject(f.sha256)) plan.download.push(f);
    plan.write.push(f);
  }
  for (const i of installed) {
    if (!targetPaths.has(normalizeRelPath(i.path).toLowerCase()) && isSafeManagedPath(i.path)) plan.remove.push(i.path);
  }
  return plan;
}

/** Deterministic JSON (sorted keys) used for signing. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}
