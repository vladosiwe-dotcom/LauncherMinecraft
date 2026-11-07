import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { downloadFile, fetchJson, runPool } from './http.js';

export const VERSION_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
export const RESOURCES_URL = 'https://resources.download.minecraft.net';

export type OsName = 'windows' | 'osx' | 'linux';
export function currentOs(): OsName {
  return process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
}

export interface Rule { action: 'allow' | 'disallow'; os?: { name?: string; arch?: string; version?: string }; features?: Record<string, boolean> }
export interface Artifact { path: string; sha1: string; size: number; url: string }
export interface Library { name: string; downloads?: { artifact?: Artifact }; url?: string; rules?: Rule[] }
export type Argument = string | { rules: Rule[]; value: string | string[] };

export interface VersionJson {
  id: string;
  inheritsFrom?: string;
  jar?: string;
  type?: string;
  mainClass: string;
  arguments?: { game?: Argument[]; jvm?: Argument[] };
  libraries: Library[];
  assetIndex?: { id: string; sha1: string; size: number; url: string };
  assets?: string;
  downloads?: { client?: Artifact & { path?: string } };
  javaVersion?: { component: string; majorVersion: number };
  logging?: { client?: { argument: string; file: { id: string; sha1: string; size: number; url: string } } };
}

export function rulesAllow(rules: Rule[] | undefined, features: Record<string, boolean> = {}, os: OsName = currentOs()): boolean {
  if (!rules || rules.length === 0) return true;
  let allowed = false;
  for (const r of rules) {
    let match = true;
    if (r.os?.name && r.os.name !== os) match = false;
    if (r.os?.arch && r.os.arch === 'x86' && process.arch !== 'ia32') match = false;
    if (r.features) for (const [k, v] of Object.entries(r.features)) if ((features[k] ?? false) !== v) match = false;
    if (match) allowed = r.action === 'allow';
  }
  return allowed;
}

/** Maven coordinate "g:a:v[:classifier][@ext]" -> relative repository path. */
export function mavenPath(name: string): string {
  const [coords, ext = 'jar'] = name.split('@') as [string, string?];
  const [g, a, v, c] = coords.split(':');
  return `${g!.replace(/\./g, '/')}/${a}/${v}/${a}-${v}${c ? `-${c}` : ''}.${ext}`;
}

export interface Progress { (stage: string, done: number, total: number): void }

export class VanillaInstaller {
  constructor(readonly root: string) {}
  versionDir(id: string) { return join(this.root, 'versions', id); }
  versionJsonPath(id: string) { return join(this.versionDir(id), `${id}.json`); }
  librariesDir() { return join(this.root, 'libraries'); }
  assetsDir() { return join(this.root, 'assets'); }

  async readVersion(id: string): Promise<VersionJson> {
    return JSON.parse(await fs.readFile(this.versionJsonPath(id), 'utf8'));
  }

  async install(id: string, progress?: Progress, signal?: AbortSignal): Promise<VersionJson> {
    const list = await fetchJson<{ versions: { id: string; url: string; sha1: string }[] }>(VERSION_MANIFEST_URL);
    const entry = list.versions.find((v) => v.id === id);
    if (!entry) throw new Error(`Minecraft ${id} not found in Mojang manifest`);
    await downloadFile({ url: entry.url, dest: this.versionJsonPath(id), sha1: entry.sha1, signal });
    const v = await this.readVersion(id);

    const jobs: { url: string; dest: string; sha1: string; size: number }[] = [];
    const client = v.downloads?.client;
    if (client) jobs.push({ url: client.url, dest: join(this.versionDir(id), `${id}.jar`), sha1: client.sha1, size: client.size });
    for (const lib of v.libraries) {
      const a = lib.downloads?.artifact;
      if (a && rulesAllow(lib.rules)) jobs.push({ url: a.url, dest: join(this.librariesDir(), a.path), sha1: a.sha1, size: a.size });
    }
    if (v.logging?.client) {
      const f = v.logging.client.file;
      jobs.push({ url: f.url, dest: join(this.assetsDir(), 'log_configs', f.id), sha1: f.sha1, size: f.size });
    }
    let done = 0;
    await runPool(jobs, 6, async (j) => { await downloadFile({ ...j, signal }); progress?.('libraries', ++done, jobs.length); });

    if (v.assetIndex) {
      const idxPath = join(this.assetsDir(), 'indexes', `${v.assetIndex.id}.json`);
      await downloadFile({ url: v.assetIndex.url, dest: idxPath, sha1: v.assetIndex.sha1, signal });
      const idx = JSON.parse(await fs.readFile(idxPath, 'utf8')) as { objects: Record<string, { hash: string; size: number }> };
      const objs = [...new Map(Object.values(idx.objects).map((o) => [o.hash, o])).values()];
      let n = 0;
      await runPool(objs, 12, async (o) => {
        const sub = `${o.hash.slice(0, 2)}/${o.hash}`;
        await downloadFile({ url: `${RESOURCES_URL}/${sub}`, dest: join(this.assetsDir(), 'objects', sub), sha1: o.hash, size: o.size, signal });
        if (++n % 25 === 0 || n === objs.length) progress?.('assets', n, objs.length);
      });
    }
    return v;
  }
}

/** Resolve inheritsFrom chain (NeoForge -> vanilla) into one version description. */
export async function resolveVersion(inst: VanillaInstaller, id: string): Promise<VersionJson> {
  const child = await inst.readVersion(id);
  if (!child.inheritsFrom) return child;
  const parent = await resolveVersion(inst, child.inheritsFrom);
  const seen = new Set<string>();
  const key = (l: Library) => { const p = l.name.split(':'); return `${p[0]}:${p[1]}${p[3] ? `:${p[3]}` : ''}`; };
  const libs = [...child.libraries, ...parent.libraries].filter((l) => { const k = key(l); if (seen.has(k)) return false; seen.add(k); return true; });
  return {
    ...parent,
    ...child,
    jar: child.jar ?? parent.jar ?? parent.id,
    libraries: libs,
    arguments: {
      game: [...(parent.arguments?.game ?? []), ...(child.arguments?.game ?? [])],
      jvm: [...(parent.arguments?.jvm ?? []), ...(child.arguments?.jvm ?? [])],
    },
    assetIndex: child.assetIndex ?? parent.assetIndex,
    assets: child.assets ?? parent.assets,
    javaVersion: child.javaVersion ?? parent.javaVersion,
    logging: child.logging ?? parent.logging,
  };
}
