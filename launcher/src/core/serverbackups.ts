import { execFile } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
export type BackupReason = 'manual' | 'pre-update' | 'pre-restore';
export interface BackupInfo { name: string; size: number; createdAt: string; reason: string }

/** What the backups need from the running server: send a command and wait for a log line. */
export interface ConsoleLink {
  running(): boolean;
  command(text: string): void;
  waitFor(match: RegExp, timeoutMs: number): Promise<boolean>;
}

/**
 * World backups of "My server" as .tar.gz in <server>/backups (tar ships with Windows 10+, macOS and Linux).
 * Same rules as the panel's backups (backend/src/backups.ts): while running, autosave is paused and the world
 * flushed for a consistent copy; restore needs a stopped server and keeps the current world as pre-restore.
 */
export class ServerBackups {
  constructor(private readonly serverDir: string, private readonly link: ConsoleLink, private readonly keep = 10) {}
  get dir() { return join(this.serverDir, 'backups'); }

  async levelName(): Promise<string> {
    const props = await fs.readFile(join(this.serverDir, 'server.properties'), 'utf8').catch(() => '');
    return /^level-name=(.+)$/m.exec(props)?.[1]?.trim() || 'world';
  }

  async list(): Promise<BackupInfo[]> {
    await fs.mkdir(this.dir, { recursive: true });
    const out: BackupInfo[] = [];
    for (const f of await fs.readdir(this.dir)) {
      if (!f.endsWith('.tar.gz')) continue;
      const st = await fs.stat(join(this.dir, f));
      out.push({ name: f, size: st.size, createdAt: st.mtime.toISOString(), reason: /__([a-z-]+)\.tar\.gz$/.exec(f)?.[1] ?? 'manual' });
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** null when there is no world yet (a fresh server has nothing to back up). */
  async create(reason: BackupReason = 'manual'): Promise<BackupInfo | null> {
    const level = await this.levelName();
    if (!existsSync(join(this.serverDir, level))) return null;
    await fs.mkdir(this.dir, { recursive: true });
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}__${reason}.tar.gz`;
    const running = this.link.running();
    try {
      if (running) {
        this.link.command('save-off');
        this.link.command('save-all flush');
        await this.link.waitFor(/Saved the game|Saved the world/i, 120_000);
      }
      const include = [level, 'config', 'server.properties', 'ops.json', 'whitelist.json', 'banned-players.json', 'banned-ips.json'].filter((p) => existsSync(join(this.serverDir, p)));
      await run('tar', ['-czf', join(this.dir, name), '-C', this.serverDir, ...include], { maxBuffer: 16 * 1024 * 1024, timeout: 60 * 60 * 1000 });
    } finally {
      if (running) this.link.command('save-on');
    }
    await this.prune();
    const st = await fs.stat(join(this.dir, name));
    return { name, size: st.size, createdAt: st.mtime.toISOString(), reason };
  }

  async prune() {
    const removable = (await this.list()).filter((b) => b.reason === 'manual').slice(this.keep);
    for (const b of removable) await fs.rm(join(this.dir, b.name), { force: true });
  }

  safeName(name: string) {
    if (!/^[\w.-]+__[a-z-]+\.tar\.gz$/.test(name)) throw new Error('bad backup name');
    return join(this.dir, name);
  }

  async remove(name: string) { await fs.rm(this.safeName(name), { force: true }); }

  async restore(name: string) {
    const file = this.safeName(name);
    if (this.link.running()) throw Object.assign(new Error('stop the server first'), { code: 'server_running' });
    await this.create('pre-restore');
    await fs.rm(join(this.serverDir, await this.levelName()), { recursive: true, force: true });
    await run('tar', ['-xzf', file, '-C', this.serverDir], { timeout: 60 * 60 * 1000 });
  }
}
