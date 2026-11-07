import { execFile } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ServerProcess } from './serverproc.js';

const run = promisify(execFile);
export interface BackupInfo { name: string; size: number; createdAt: string; reason: string }

/**
 * World backups as tar.gz archives. While the server runs we pause autosave and flush
 * (save-off / save-all flush) so the archive is consistent, then re-enable saving.
 */
export class Backups {
  constructor(private readonly serverDir: string, private readonly backupDir: string, private readonly proc: ServerProcess, private readonly keep: number) {}

  private async levelName(): Promise<string> {
    const props = await fs.readFile(join(this.serverDir, 'server.properties'), 'utf8').catch(() => '');
    return /^level-name=(.+)$/m.exec(props)?.[1]?.trim() || 'world';
  }

  async list(): Promise<BackupInfo[]> {
    await fs.mkdir(this.backupDir, { recursive: true });
    const out: BackupInfo[] = [];
    for (const f of await fs.readdir(this.backupDir)) {
      if (!f.endsWith('.tar.gz')) continue;
      const st = await fs.stat(join(this.backupDir, f));
      const reason = /__([a-z-]+)\.tar\.gz$/.exec(f)?.[1] ?? 'manual';
      out.push({ name: f, size: st.size, createdAt: st.mtime.toISOString(), reason });
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async create(reason: 'manual' | 'scheduled' | 'pre-publish' | 'pre-restore' = 'manual'): Promise<BackupInfo> {
    if (!this.serverDir) throw new Error('server_dir_not_configured');
    const level = await this.levelName();
    if (!existsSync(join(this.serverDir, level))) throw new Error('world_not_found');
    await fs.mkdir(this.backupDir, { recursive: true });
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}__${reason}.tar.gz`;
    const running = this.proc.state === 'running';
    try {
      if (running) {
        this.proc.command('save-off');
        await this.proc.query('save-all flush', /Saved the game|Saved the world/i, 120000);
      }
      const include = [level, 'config', 'defaultconfigs', 'server.properties', 'ops.json', 'whitelist.json', 'banned-players.json', 'banned-ips.json'].filter((p) => existsSync(join(this.serverDir, p)));
      await run('tar', ['-czf', join(this.backupDir, name), '-C', this.serverDir, ...include], { maxBuffer: 16 * 1024 * 1024, timeout: 60 * 60 * 1000 });
    } finally {
      if (running) this.proc.command('save-on');
    }
    await this.prune();
    const st = await fs.stat(join(this.backupDir, name));
    return { name, size: st.size, createdAt: st.mtime.toISOString(), reason };
  }

  async prune() {
    const all = await this.list();
    const removable = all.filter((b) => b.reason !== 'pre-publish' && b.reason !== 'pre-restore').slice(this.keep);
    for (const b of removable) await fs.rm(join(this.backupDir, b.name), { force: true });
  }

  safeName(name: string) {
    if (!/^[\w.-]+__[a-z-]+\.tar\.gz$/.test(name)) throw new Error('bad_backup_name');
    return join(this.backupDir, name);
  }

  async remove(name: string) { await fs.rm(this.safeName(name), { force: true }); }

  /** Restore requires a stopped server. The current world is kept as a pre-restore backup first. */
  async restore(name: string) {
    const file = this.safeName(name);
    if (this.proc.state !== 'stopped' && this.proc.state !== 'crashed') throw new Error('server_must_be_stopped');
    await this.create('pre-restore').catch(() => undefined);
    const level = await this.levelName();
    await fs.rm(join(this.serverDir, level), { recursive: true, force: true });
    await run('tar', ['-xzf', file, '-C', this.serverDir], { timeout: 60 * 60 * 1000 });
  }
}
