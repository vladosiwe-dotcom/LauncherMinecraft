import { randomUUID } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { MINECRAFT_VERSION, signManifest, validateManifest, type BuildManifest, type SignedManifest } from '@sir/shared';
import type { Stores } from './db.js';
import { compareVersions, inRange } from './modinspect.js';
import type { Build, BuildEntry, LibraryItem } from './types.js';

export interface Issue { level: 'error' | 'warning'; code: string; item?: string; detail?: string }

const BUILT_IN = new Set(['minecraft', 'neoforge', 'java', 'forge']);

export function pathFor(item: LibraryItem): string {
  switch (item.category) {
    case 'mod': return `mods/${item.fileName}`;
    case 'resourcepack': return `resourcepacks/${item.fileName}`;
    case 'shaderpack': return `shaderpacks/${item.fileName}`;
    case 'config': return `config/${item.fileName}`;
    default: return `spellironrift/${item.fileName}`;
  }
}

/** Dependency, version and side checks across all mods of a build. */
export function analyzeBuild(build: Build, library: LibraryItem[]): Issue[] {
  const issues: Issue[] = [];
  const byId = new Map(library.map((i) => [i.id, i]));
  const entries = build.entries.map((e) => ({ e, item: byId.get(e.itemId) }));
  for (const { e, item } of entries) if (!item) issues.push({ level: 'error', code: 'missing_library_item', detail: e.path });
  const mods = entries.filter((x) => x.item?.mod && x.item.category === 'mod') as { e: BuildEntry; item: LibraryItem & { mod: NonNullable<LibraryItem['mod']> } }[];

  for (const { item } of entries.filter((x) => x.item)) for (const err of item!.errors) issues.push({ level: 'error', code: err, item: item!.name });

  const seen = new Map<string, string>();
  for (const { item } of mods) {
    if (seen.has(item.mod.modId)) issues.push({ level: 'error', code: 'duplicate_mod', item: item.name, detail: `${item.mod.modId} (${seen.get(item.mod.modId)})` });
    seen.set(item.mod.modId, item.name);
  }

  const sideOf = (modId: string) => mods.find((m) => m.item.mod.modId === modId)?.e.side;
  for (const { e, item } of mods) {
    const m = item.mod;
    if (m.neoforgeRange && !inRange(build.neoforgeVersion, m.neoforgeRange)) issues.push({ level: 'error', code: 'neoforge_range', item: item.name, detail: `${m.neoforgeRange} ≠ ${build.neoforgeVersion}` });
    for (const d of m.dependencies) {
      if (BUILT_IN.has(d.modId)) continue;
      const dep = mods.find((x) => x.item.mod.modId === d.modId);
      if (d.type === 'incompatible' && dep) issues.push({ level: 'error', code: 'incompatible', item: item.name, detail: dep.item.name });
      if (d.type === 'discouraged' && dep) issues.push({ level: 'warning', code: 'discouraged', item: item.name, detail: dep.item.name });
      if (d.type !== 'required') continue;
      if (!dep) { issues.push({ level: 'error', code: 'missing_dependency', item: item.name, detail: `${d.modId} ${d.versionRange}` }); continue; }
      if (!inRange(dep.item.mod.version, d.versionRange)) issues.push({ level: 'error', code: 'dependency_version', item: item.name, detail: `${d.modId} ${dep.item.mod.version} ∉ ${d.versionRange}` });
      // A dependency needed on both sides must be installed on both sides.
      const depSide = sideOf(d.modId);
      const needClient = e.side !== 'server' && (d.side === 'BOTH' || d.side === 'CLIENT');
      const needServer = e.side !== 'client' && (d.side === 'BOTH' || d.side === 'SERVER');
      if ((needClient && depSide === 'server') || (needServer && depSide === 'client')) issues.push({ level: 'error', code: 'dependency_side', item: item.name, detail: `${d.modId} → ${depSide}` });
    }
    if (m.clientOnlyHint && e.side !== 'client') issues.push({ level: 'warning', code: 'client_only_on_server', item: item.name });
  }
  for (const rp of build.resourcePacks) if (!entries.some((x) => x.item?.category === 'resourcepack' && x.item.fileName === rp)) issues.push({ level: 'error', code: 'resourcepack_not_in_build', detail: rp });
  for (const { item } of entries) for (const w of item?.warnings ?? []) issues.push({ level: 'warning', code: w, item: item!.name });
  if (!/^21\.1\.\d+/.test(build.neoforgeVersion)) issues.push({ level: 'error', code: 'neoforge_version', detail: build.neoforgeVersion });
  return issues;
}

export interface BuildContext {
  db: Stores;
  publicBaseUrl: string;
  server: { host: string; port: number };
  keys: { privatePem: string; publicPem: string };
  dataDir: string;
}

export function toManifest(build: Build, library: LibraryItem[], ctx: BuildContext, channel: 'stable' | 'testing'): BuildManifest {
  const byId = new Map(library.map((i) => [i.id, i]));
  return {
    schema: 1, project: 'spell-and-iron-rift', buildId: build.id, version: build.version, channel,
    createdAt: build.publishedAt ?? build.updatedAt, minecraft: MINECRAFT_VERSION,
    loader: { type: 'neoforge', version: build.neoforgeVersion },
    java: { majorVersion: 21, mojangComponent: 'java-runtime-delta' },
    server: ctx.server, resourcePacks: build.resourcePacks, changelog: build.changelog,
    files: build.entries.map((e) => {
      const item = byId.get(e.itemId)!;
      return {
        path: e.path, name: item.name, version: item.version, size: item.size, url: `${ctx.publicBaseUrl}/files/${item.sha256}`,
        sha256: item.sha256, category: item.category, required: e.required, side: e.side, mode: e.mode, ...(e.presets?.length ? { presets: e.presets } : {}),
      };
    }),
  };
}

export class Builds {
  constructor(private readonly ctx: BuildContext) {}
  private get db() { return this.ctx.db; }

  async create(user: string, from?: string): Promise<Build> {
    const { builds } = await this.db.builds.read();
    const base = from ? builds.find((b) => b.id === from) : builds.filter((b) => b.publishedAt).sort((a, b) => b.publishedAt!.localeCompare(a.publishedAt!))[0];
    const now = new Date().toISOString();
    const next = base ? bumpPatch(base.version) : '0.1.0';
    const b: Build = {
      id: `b-${Date.now().toString(36)}-${randomUUID().slice(0, 4)}`, version: next, status: 'draft',
      neoforgeVersion: base?.neoforgeVersion ?? '21.1.228', entries: structuredClone(base?.entries ?? []), resourcePacks: [...(base?.resourcePacks ?? [])],
      changelog: { ru: '', uk: '', en: '' }, createdAt: now, createdBy: user, updatedAt: now, basedOn: base?.id,
    };
    await this.db.builds.update((d) => { d.builds.push(b); });
    return b;
  }

  async get(id: string) { return (await this.db.builds.read()).builds.find((b) => b.id === id); }

  async update(id: string, fn: (b: Build) => void): Promise<Build> {
    return this.db.builds.update((d) => {
      const b = d.builds.find((x) => x.id === id);
      if (!b) throw Object.assign(new Error('not_found'), { status: 404 });
      if (b.status !== 'draft' && b.status !== 'testing') throw Object.assign(new Error('build_locked'), { status: 409 });
      fn(b);
      if (!/^\d+\.\d+\.\d+$/.test(b.version)) throw Object.assign(new Error('bad_version'), { status: 400 });
      b.updatedAt = new Date().toISOString();
      return b;
    });
  }

  async addItem(id: string, item: LibraryItem, opts: Partial<BuildEntry> = {}) {
    if (item.errors.length) throw Object.assign(new Error(`item_has_errors:${item.errors.join(',')}`), { status: 400 });
    return this.update(id, (b) => {
      const path = opts.path ?? pathFor(item);
      b.entries = b.entries.filter((e) => e.path !== path);
      // Replacing a mod with a newer version: drop the old file of the same modId.
      if (item.mod) b.entries = b.entries.filter((e) => e.itemId === item.id || !this.sameMod(e.itemId, item.mod!.modId));
      b.entries.push({
        itemId: item.id, path, side: opts.side ?? (item.category === 'mod' ? (item.mod?.clientOnlyHint ? 'client' : 'both') : 'client'),
        required: opts.required ?? item.category !== 'shaderpack', mode: opts.mode ?? (item.category === 'config' ? 'keep-user' : 'replace'),
        presets: opts.presets ?? (item.category === 'shaderpack' ? ['high', 'ultra'] : undefined),
      });
    });
  }
  private libCache: LibraryItem[] = [];
  private sameMod(itemId: string, modId: string) { return this.libCache.find((i) => i.id === itemId)?.mod?.modId === modId; }
  async refreshLibrary() { this.libCache = (await this.db.library.read()).items; }

  async analyze(id: string): Promise<Issue[]> {
    const b = await this.get(id);
    if (!b) throw Object.assign(new Error('not_found'), { status: 404 });
    const lib = (await this.db.library.read()).items;
    const issues = analyzeBuild(b, lib);
    for (const i of validateManifest(toManifest(b, lib, this.ctx, 'stable'), { allowHttp: true })) issues.push({ level: 'error', code: 'manifest', detail: `${i.path}: ${i.message}` });
    return issues;
  }

  private manifestPath(channel: 'stable' | 'testing') { return join(this.ctx.dataDir, 'manifests', `${channel}.json`); }

  private async writeSigned(build: Build, channel: 'stable' | 'testing') {
    const lib = (await this.db.library.read()).items;
    const signed = signManifest(toManifest(build, lib, this.ctx, channel), this.ctx.keys.privatePem, this.ctx.keys.publicPem);
    await fs.mkdir(join(this.ctx.dataDir, 'manifests'), { recursive: true });
    await fs.writeFile(`${this.manifestPath(channel)}.tmp`, JSON.stringify(signed));
    await fs.rename(`${this.manifestPath(channel)}.tmp`, this.manifestPath(channel));
  }

  async signedManifest(channel: 'stable' | 'testing'): Promise<SignedManifest | null> {
    try { return JSON.parse(await fs.readFile(this.manifestPath(channel), 'utf8')); } catch { return null; }
  }

  async toTesting(id: string) {
    const issues = (await this.analyze(id)).filter((i) => i.level === 'error');
    if (issues.length) throw Object.assign(new Error('build_has_errors'), { status: 422, issues });
    const b = await this.db.builds.update((d) => {
      const b = d.builds.find((x) => x.id === id)!;
      for (const o of d.builds) if (o.status === 'testing' && o.id !== id) o.status = 'draft';
      b.status = 'testing'; d.published.testing = id; return b;
    });
    await this.writeSigned(b, 'testing');
    return b;
  }

  /** Publish to all players. `beforeSwitch` runs after validation (world backup, server mod sync). */
  async publish(id: string, beforeSwitch?: (b: Build) => Promise<void>) {
    const issues = (await this.analyze(id)).filter((i) => i.level === 'error');
    if (issues.length) throw Object.assign(new Error('build_has_errors'), { status: 422, issues });
    const b = await this.get(id);
    if (!b) throw Object.assign(new Error('not_found'), { status: 404 });
    await beforeSwitch?.(b);
    const published = await this.db.builds.update((d) => {
      const x = d.builds.find((y) => y.id === id)!;
      for (const o of d.builds) if (o.status === 'published' && o.id !== id) o.status = 'archived';
      x.status = 'published'; x.publishedAt = new Date().toISOString();
      d.published.stable = id; if (d.published.testing === id) d.published.testing = null;
      return x;
    });
    await this.writeSigned(published, 'stable');
    return published;
  }

  /** Re-publish the most recent previously published build. */
  async rollback(beforeSwitch?: (b: Build) => Promise<void>) {
    const { builds, published } = await this.db.builds.read();
    const prev = builds.filter((b) => b.publishedAt && b.id !== published.stable).sort((a, b) => b.publishedAt!.localeCompare(a.publishedAt!))[0];
    if (!prev) throw Object.assign(new Error('nothing_to_roll_back'), { status: 409 });
    await this.db.builds.update((d) => { const x = d.builds.find((y) => y.id === prev.id)!; x.status = 'testing'; });
    return this.publish(prev.id, beforeSwitch);
  }

  async remove(id: string) {
    await this.db.builds.update((d) => {
      const b = d.builds.find((x) => x.id === id);
      if (!b) return;
      if (b.status !== 'draft') throw Object.assign(new Error('only_drafts_can_be_deleted'), { status: 409 });
      d.builds = d.builds.filter((x) => x.id !== id);
    });
  }
}

export function bumpPatch(v: string) { const [a, b, c] = v.split('.').map(Number); return `${a ?? 0}.${b ?? 1}.${(c ?? 0) + 1}`; }
export { compareVersions };

/** Copy server-side files of a build into the server directory. Previous managed mods are moved to a dated backup folder. */
export async function syncServerFiles(build: Build, library: LibraryItem[], serverDir: string, dataDir: string, objectPath: (sha: string) => string) {
  if (!serverDir || !existsSync(serverDir)) return { copied: 0, removed: 0 };
  const statePath = join(dataDir, 'server-sync.json');
  const prev: string[] = JSON.parse(await fs.readFile(statePath, 'utf8').catch(() => '[]'));
  const byId = new Map(library.map((i) => [i.id, i]));
  const wanted = build.entries.filter((e) => e.side !== 'client' && (e.path.startsWith('mods/') || e.path.startsWith('config/') || e.path.startsWith('defaultconfigs/')));
  const backupDir = join(dataDir, 'server-files-backup', new Date().toISOString().replace(/[:.]/g, '-'));
  let removed = 0, copied = 0;
  for (const rel of prev) {
    if (wanted.some((w) => w.path === rel)) continue;
    const abs = join(serverDir, rel);
    if (existsSync(abs)) { await fs.mkdir(join(backupDir, rel, '..'), { recursive: true }); await fs.rename(abs, join(backupDir, rel)); removed++; }
  }
  for (const e of wanted) {
    const item = byId.get(e.itemId)!;
    const abs = join(serverDir, e.path);
    if (e.mode === 'keep-user' && existsSync(abs)) continue;
    await fs.mkdir(join(abs, '..'), { recursive: true });
    if (existsSync(abs)) { await fs.mkdir(join(backupDir, e.path, '..'), { recursive: true }); await fs.copyFile(abs, join(backupDir, e.path)); }
    await fs.copyFile(objectPath(item.sha256), `${abs}.tmp`);
    await fs.rename(`${abs}.tmp`, abs);
    copied++;
  }
  await fs.writeFile(statePath, JSON.stringify(wanted.map((w) => w.path)));
  return { copied, removed };
}
