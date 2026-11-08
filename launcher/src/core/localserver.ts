import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { isSafeManagedPath, serverFiles as sharedServerFiles, type BuildManifest, type ManifestFile } from '@sir/shared';
import { applyProperties } from './game.js';
import { downloadFile, fileExists, runPool } from './http.js';
import { installNeoForgeServer } from './neoforge.js';

/**
 * "My server": a NeoForge server on this PC with the same build as the players, run from the launcher.
 * One button installs it (NeoForge server + the build's server-side files), Start/Stop run it, the console
 * shows its log and sends commands. In test mode the server runs without Microsoft checks (online-mode=false)
 * so testers on this PC or local network can join with a nickname.
 */
export type ServerState = 'not_installed' | 'stopped' | 'installing' | 'starting' | 'running' | 'stopping';

export interface LocalServerOptions { port: number; memoryMb: number; testMode: boolean; motd: string }

/** Files of the build that belong on a server (not client-only), with safe relative paths. */
export function serverFiles(m: BuildManifest): ManifestFile[] {
  return sharedServerFiles(m).filter((f) => isSafeManagedPath(f.path));
}

/** Minecraft's offline-mode UUID for a nickname: UUID v3 of "OfflinePlayer:<name>". */
export function offlineUuid(name: string): string {
  const b = createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
  b[6] = (b[6]! & 0x0f) | 0x30;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const NICK_RE = /^[A-Za-z0-9_]{3,16}$/;

/** Hosts the test mode may connect to: this PC and private local networks only. */
export function isLocalHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (h === 'localhost' || h === '::1') return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export function serverProperties(current: string, o: LocalServerOptions): string {
  return applyProperties(current, {
    'server-port': String(o.port),
    'online-mode': String(!o.testMode),
    'enforce-secure-profile': String(!o.testMode),
    motd: o.motd.replace(/[\r\n]/g, ' ').slice(0, 59),
    'resource-pack': '',
    'enable-status': 'true',
  });
}

export class LocalServer extends EventEmitter {
  private proc: ChildProcess | null = null;
  private log: string[] = [];
  state: ServerState = 'not_installed';

  constructor(private readonly root: string, readonly dir: string) { super(); }

  private setState(s: ServerState) { this.state = s; this.emit('state', s); }
  private line(l: string) {
    this.log.push(l);
    if (this.log.length > 2000) this.log.splice(0, this.log.length - 2000);
    this.emit('line', l);
    if (this.state === 'starting' && /Done \(\d/.test(l)) this.setState('running');
  }
  history() { return [...this.log]; }

  private stampFile() { return join(this.dir, '.sir-server.json'); }

  async refreshState(): Promise<ServerState> {
    if (this.proc) return this.state;
    const installed = await fileExists(this.stampFile());
    this.state = installed ? 'stopped' : 'not_installed';
    return this.state;
  }

  async installedBuild(): Promise<string | null> {
    try { return (JSON.parse(await fs.readFile(this.stampFile(), 'utf8')) as { buildId: string }).buildId; } catch { return null; }
  }

  /** Installs or updates the server for this build. eulaAccepted must come from the player ticking the box. */
  async install(m: BuildManifest, javaExe: string, o: LocalServerOptions, eulaAccepted: boolean, onProgress: (done: number, total: number, detail: string) => void, signal?: AbortSignal) {
    if (!eulaAccepted) throw Object.assign(new Error('Minecraft EULA not accepted'), { code: 'eula' });
    if (this.proc) throw Object.assign(new Error('stop the server first'), { code: 'server_running' });
    this.setState('installing');
    try {
      onProgress(0, 1, 'neoforge');
      await installNeoForgeServer(this.root, this.dir, m.loader.version, javaExe, (l) => this.line(l));
      const files = serverFiles(m);
      const total = files.reduce((s, f) => s + f.size, 0);
      let done = 0;
      await runPool(files, 4, async (f) => {
        const dest = join(this.dir, f.path);
        if (f.mode === 'keep-user' && (await fileExists(dest))) return;
        await downloadFile({ url: f.url, dest, sha256: f.sha256, size: f.size, signal, onBytes: (d) => { done += d; onProgress(done, total, f.path); } });
      });
      // remove files this launcher installed for an older build and the new build no longer has
      const keep = new Set(files.map((f) => f.path));
      let previous: string[] = [];
      try { previous = (JSON.parse(await fs.readFile(this.stampFile(), 'utf8')) as { files: string[] }).files; } catch { /* first install */ }
      for (const p of previous) if (!keep.has(p) && isSafeManagedPath(p)) await fs.rm(join(this.dir, p), { force: true });

      await fs.writeFile(join(this.dir, 'eula.txt'), '# Accepted by the server owner in the Spell and Iron Rift launcher\neula=true\n');
      const propsPath = join(this.dir, 'server.properties');
      await fs.writeFile(propsPath, serverProperties(await fs.readFile(propsPath, 'utf8').catch(() => ''), o));
      await fs.writeFile(join(this.dir, 'user_jvm_args.txt'), `-Xmx${o.memoryMb}M\n`);
      await fs.mkdir(dirname(this.stampFile()), { recursive: true });
      await fs.writeFile(this.stampFile(), JSON.stringify({ buildId: m.buildId, version: m.version, neoforge: m.loader.version, files: [...keep] }, null, 2));
      this.setState('stopped');
    } catch (e) {
      this.setState((await fileExists(this.stampFile())) ? 'stopped' : 'not_installed');
      throw e;
    }
  }

  async start(javaExe: string, o: LocalServerOptions) {
    if (this.proc) return;
    const stamp = JSON.parse(await fs.readFile(this.stampFile(), 'utf8')) as { neoforge: string };
    const propsPath = join(this.dir, 'server.properties');
    await fs.writeFile(propsPath, serverProperties(await fs.readFile(propsPath, 'utf8').catch(() => ''), o));
    await fs.writeFile(join(this.dir, 'user_jvm_args.txt'), `-Xmx${o.memoryMb}M\n`);
    const argsFile = `libraries/net/neoforged/neoforge/${stamp.neoforge}/${process.platform === 'win32' ? 'win' : 'unix'}_args.txt`;
    this.setState('starting');
    this.proc = spawn(javaExe.replace(/javaw\.exe$/, 'java.exe'), ['@user_jvm_args.txt', `@${argsFile}`, 'nogui'], { cwd: this.dir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const feed = (buf: Buffer) => buf.toString('utf8').split(/\r?\n/).filter(Boolean).forEach((l) => this.line(l));
    this.proc.stdout?.on('data', feed);
    this.proc.stderr?.on('data', feed);
    this.proc.on('exit', (code) => {
      this.proc = null;
      this.line(`[launcher] server exited (${code ?? 'signal'})`);
      this.setState('stopped');
    });
  }

  command(text: string) {
    const t = text.replace(/[\r\n]/g, ' ').trim().slice(0, 256);
    if (this.proc && t) { this.line(`> ${t}`); this.proc.stdin?.write(`${t}\n`); }
  }

  /** Saves the world and stops; kills the process if it does not exit in 60 seconds. */
  async stop(): Promise<void> {
    const p = this.proc;
    if (!p) return;
    this.setState('stopping');
    this.command('stop');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { p.kill(); resolve(); }, 60_000);
      p.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}
