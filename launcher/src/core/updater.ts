import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  clientFiles, planSync, isSafeManagedPath, normalizeRelPath, validateManifest, verifyManifest,
  type BuildManifest, type GraphicsPresetId, type InstalledFile, type SignedManifest, type SyncPlan,
} from '@sir/shared';
import { hashFile, runPool } from './http.js';
import { ObjectStore } from './objects.js';

interface TrackedFile extends InstalledFile { size: number; mtimeMs: number }

export interface PackState {
  buildId: string | null;
  version: string | null;
  preset: GraphicsPresetId | null;
  files: TrackedFile[];
  /** Applied build ids, newest last. Manifests are kept in <data>/builds/<id>.json. */
  history: string[];
}

export interface UpdateProgress {
  phase: 'verify' | 'download' | 'apply' | 'cleanup' | 'done';
  doneBytes: number;
  totalBytes: number;
  file?: string;
}

const EMPTY: PackState = { buildId: null, version: null, preset: null, files: [], history: [] };

export class ManifestRejectedError extends Error {}

/**
 * Applies signed build manifests to a game directory transactionally:
 *  1. every needed blob is downloaded and verified into the object store first (nothing in the game dir changes yet);
 *  2. a journal is written, then files are swapped in with write-to-temp + rename;
 *  3. state is committed and the journal removed.
 * An interrupted apply is finished on next start (recover()). Rollback re-applies a previous manifest from the store.
 */
export class PackUpdater {
  readonly store: ObjectStore;
  constructor(readonly gameDir: string, readonly dataDir: string) { this.store = new ObjectStore(dataDir); }

  private statePath() { return join(this.dataDir, 'pack-state.json'); }
  private journalPath() { return join(this.dataDir, 'apply.journal.json'); }
  private buildPath(id: string) { return join(this.dataDir, 'builds', `${id}.json`); }

  async loadState(): Promise<PackState> {
    try { return { ...EMPTY, ...JSON.parse(await fs.readFile(this.statePath(), 'utf8')) }; } catch { return { ...EMPTY }; }
  }

  private async writeJsonAtomic(p: string, v: unknown) {
    await fs.mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(v, null, 2));
    await fs.rename(tmp, p);
  }

  /** Verify signature and content rules. Throws ManifestRejectedError. */
  accept(signed: SignedManifest, trustedKeys: string[], opts: { allowHttp?: boolean } = {}): BuildManifest {
    if (trustedKeys.length > 0 && !verifyManifest(signed, trustedKeys)) throw new ManifestRejectedError('signature');
    const issues = validateManifest(signed.manifest, opts);
    if (issues.length) throw new ManifestRejectedError(issues.map((i) => `${i.path}: ${i.message}`).join('; '));
    return signed.manifest;
  }

  private async diskHash(state: PackState, rel: string): Promise<string | undefined> {
    const abs = join(this.gameDir, rel);
    let st;
    try { st = await fs.stat(abs); } catch { return undefined; }
    const tracked = state.files.find((f) => f.path === rel);
    if (tracked && tracked.size === st.size && tracked.mtimeMs === st.mtimeMs) return tracked.sha256;
    return hashFile(abs);
  }

  async plan(manifest: BuildManifest, preset: GraphicsPresetId): Promise<SyncPlan & { downloadBytes: number }> {
    const state = await this.loadState();
    const target = clientFiles(manifest, preset);
    const disk = new Map<string, string | undefined>();
    const objects = new Set<string>();
    for (const f of target) {
      disk.set(f.path, await this.diskHash(state, f.path));
      if (await this.store.has(f.sha256)) objects.add(f.sha256);
    }
    const p = planSync(target, state.files, (x) => disk.get(x), (s) => objects.has(s));
    return { ...p, downloadBytes: p.download.reduce((a, f) => a + f.size, 0) };
  }

  async needsUpdate(manifest: BuildManifest, preset: GraphicsPresetId): Promise<boolean> {
    const p = await this.plan(manifest, preset);
    return p.write.length > 0 || p.remove.length > 0;
  }

  async apply(manifest: BuildManifest, preset: GraphicsPresetId, onProgress?: (p: UpdateProgress) => void, signal?: AbortSignal): Promise<void> {
    const plan = await this.plan(manifest, preset);
    const total = plan.downloadBytes;
    let done = 0;
    onProgress?.({ phase: 'download', doneBytes: 0, totalBytes: total });
    await runPool(plan.download, 4, async (f) => {
      await this.store.fetch(f.url, f.sha256, f.size, (n) => { done += n; onProgress?.({ phase: 'download', doneBytes: done, totalBytes: total, file: f.name }); }, signal);
    });

    await this.writeJsonAtomic(this.buildPath(manifest.buildId), manifest);
    await this.writeJsonAtomic(this.journalPath(), { buildId: manifest.buildId, preset, startedAt: new Date().toISOString() });
    onProgress?.({ phase: 'apply', doneBytes: total, totalBytes: total });
    await this.swapIn(manifest, preset, plan);
    await fs.rm(this.journalPath(), { force: true });
    onProgress?.({ phase: 'cleanup', doneBytes: total, totalBytes: total });
    await this.gc();
    onProgress?.({ phase: 'done', doneBytes: total, totalBytes: total });
  }

  private async swapIn(manifest: BuildManifest, preset: GraphicsPresetId, plan: SyncPlan) {
    const state = await this.loadState();
    for (const f of plan.write) {
      const rel = normalizeRelPath(f.path);
      if (!isSafeManagedPath(rel)) continue; // defence in depth; validateManifest already rejects these
      const abs = join(this.gameDir, rel);
      await fs.mkdir(dirname(abs), { recursive: true });
      const tmp = `${abs}.sir-tmp`;
      await fs.copyFile(this.store.pathOf(f.sha256), tmp);
      await fs.rename(tmp, abs);
    }
    for (const rel of plan.remove) {
      if (isSafeManagedPath(rel)) await fs.rm(join(this.gameDir, rel), { force: true });
    }
    const files: TrackedFile[] = [];
    for (const f of [...plan.unchanged, ...plan.write]) {
      try {
        const st = await fs.stat(join(this.gameDir, f.path));
        const sha = f.mode === 'keep-user' && plan.unchanged.includes(f) ? await hashFile(join(this.gameDir, f.path)) : f.sha256;
        files.push({ path: normalizeRelPath(f.path), sha256: sha, mode: f.mode, size: st.size, mtimeMs: st.mtimeMs });
      } catch { /* missing optional file */ }
    }
    const history = state.history.filter((h) => h !== manifest.buildId);
    history.push(manifest.buildId);
    await this.writeJsonAtomic(this.statePath(), {
      buildId: manifest.buildId, version: manifest.version, preset, files, history: history.slice(-10),
    } satisfies PackState);
  }

  /** Finish an apply that was interrupted (power loss, crash) — called on launcher start. */
  async recover(): Promise<boolean> {
    let j: { buildId: string; preset: GraphicsPresetId };
    try { j = JSON.parse(await fs.readFile(this.journalPath(), 'utf8')); } catch { return false; }
    const manifest = await this.loadBuild(j.buildId);
    if (!manifest) { await fs.rm(this.journalPath(), { force: true }); return false; }
    const plan = await this.plan(manifest, j.preset);
    if (plan.download.length) return false; // blobs missing: a normal update will redo it
    await this.swapIn(manifest, j.preset, plan);
    await fs.rm(this.journalPath(), { force: true });
    return true;
  }

  async loadBuild(id: string): Promise<BuildManifest | null> {
    try { return JSON.parse(await fs.readFile(this.buildPath(id), 'utf8')); } catch { return null; }
  }

  /** Re-apply the build before the current one. Returns the build id rolled back to, or null. */
  async rollback(onProgress?: (p: UpdateProgress) => void): Promise<string | null> {
    const state = await this.loadState();
    const prevId = state.history.at(-2);
    if (!prevId) return null;
    const prev = await this.loadBuild(prevId);
    if (!prev) return null;
    await this.apply(prev, state.preset ?? 'balanced', onProgress);
    return prevId;
  }

  /** Re-verify every managed file and restore anything damaged. */
  async repair(onProgress?: (p: UpdateProgress) => void): Promise<number> {
    const state = await this.loadState();
    if (!state.buildId) return 0;
    const m = await this.loadBuild(state.buildId);
    if (!m) return 0;
    // Drop the size/mtime cache so every file is hashed.
    await this.writeJsonAtomic(this.statePath(), { ...state, files: state.files.map((f) => ({ ...f, mtimeMs: -1 })) });
    const plan = await this.plan(m, state.preset ?? 'balanced');
    await this.apply(m, state.preset ?? 'balanced', onProgress);
    return plan.write.length;
  }

  /** Keep blobs for the last three builds so rollback works offline. */
  async gc(): Promise<number> {
    const state = await this.loadState();
    const keep = new Set<string>();
    for (const id of state.history.slice(-3)) {
      const m = await this.loadBuild(id);
      m?.files.forEach((f) => keep.add(f.sha256));
    }
    return this.store.gc(keep);
  }
}
