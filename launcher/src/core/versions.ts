import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { installJavaRuntime } from './java.js';
import { launch, type LaunchProfile } from './launch.js';
import { VanillaInstaller, listVersions, resolveVersion, type VersionEntry } from './mojang.js';
import { fileExists } from './http.js';
import type { LauncherSettings } from './settings.js';

export interface InstalledVersion { id: string; type: string; sizeMb?: number }
export interface VersionProgress { stage: 'java' | 'minecraft' | 'launch'; done: number; total: number; detail?: string }

const ID_RE = /^[A-Za-z0-9._ -]{1,64}$/;
function checkId(id: string): string {
  if (!ID_RE.test(id) || id.includes('..')) throw new Error(`bad version id: ${id}`);
  return id;
}

/**
 * Any Minecraft version, straight from Mojang, next to the Spell and Iron Rift build: install, play, remove.
 * Versions share libraries and assets with the pack under the install folder; each version plays in its own
 * game folder (instances/<id>) so worlds and options do not mix.
 */
export class VersionLibrary {
  constructor(private readonly settings: LauncherSettings) {}

  get root() { return this.settings.installDir; }
  gameDir(id: string) { return join(this.root, 'instances', checkId(id)); }
  private inst() { return new VanillaInstaller(this.root); }

  available(): Promise<{ latest: { release: string; snapshot: string }; versions: VersionEntry[] }> {
    return listVersions();
  }

  /** Versions with a version file and a client jar, i.e. ready to play (NeoForge profiles of the pack excluded). */
  async installed(): Promise<InstalledVersion[]> {
    const dir = join(this.root, 'versions');
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    const out: InstalledVersion[] = [];
    for (const id of names) {
      try {
        const v = await this.inst().readVersion(id);
        if (v.inheritsFrom) continue;
        if (!(await fileExists(join(dir, id, `${id}.jar`)))) continue;
        out.push({ id, type: v.type ?? 'release' });
      } catch { /* not a version folder */ }
    }
    return out;
  }

  async install(id: string, onProgress?: (p: VersionProgress) => void, signal?: AbortSignal): Promise<void> {
    await this.inst().install(checkId(id), (stage, done, total) => onProgress?.({ stage: 'minecraft', done, total, detail: stage }), signal);
  }

  /** The Java runtime this version wants (Mojang's own builds), unless a Java path is set in settings. */
  async java(id: string, onProgress?: (p: VersionProgress) => void, signal?: AbortSignal): Promise<string> {
    if (this.settings.javaPath) {
      if (!(await fileExists(this.settings.javaPath))) throw new Error(`Java not found at ${this.settings.javaPath}`);
      return this.settings.javaPath;
    }
    const v = await this.inst().readVersion(checkId(id));
    return installJavaRuntime(this.root, v.javaVersion?.component ?? 'jre-legacy', (d, t) => onProgress?.({ stage: 'java', done: d, total: t }), signal);
  }

  async play(id: string, profile: LaunchProfile, onLog: (l: string) => void, launcherVersion: string, clientId: string,
             onProgress?: (p: VersionProgress) => void, signal?: AbortSignal) {
    checkId(id);
    if (!(await fileExists(join(this.root, 'versions', id, `${id}.jar`)))) await this.install(id, onProgress, signal);
    const javaExe = await this.java(id, onProgress, signal);
    onProgress?.({ stage: 'launch', done: 0, total: 1 });
    const version = await resolveVersion(this.inst(), id);
    return launch({
      root: this.root, gameDir: this.gameDir(id), javaExe, version, profile,
      memoryMb: this.settings.memoryMb, width: this.settings.width, height: this.settings.height, fullscreen: this.settings.fullscreen,
      extraJvmArgs: this.settings.jvmArgs.split(/\s+/).filter(Boolean), launcherVersion, clientId,
    }, onLog);
  }

  /** Removes the version file and jar (and its game folder only when asked). Shared libraries and assets stay. */
  async remove(id: string, withWorlds: boolean): Promise<void> {
    await fs.rm(join(this.root, 'versions', checkId(id)), { recursive: true, force: true });
    await fs.rm(join(this.root, 'natives', id), { recursive: true, force: true });
    if (withWorlds) await fs.rm(this.gameDir(id), { recursive: true, force: true });
  }
}
