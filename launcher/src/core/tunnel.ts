import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { downloadFile, fileExists } from './http.js';

export type TunnelMode = 'quick' | 'token';
export type TunnelState = 'off' | 'downloading' | 'starting' | 'running' | 'error';

/** cloudflared release asset for this system (Cloudflare's official builds on GitHub). */
export function cloudflaredAsset(platform = process.platform, arch = process.arch): string | null {
  if (platform === 'win32') return arch === 'ia32' ? 'cloudflared-windows-386.exe' : 'cloudflared-windows-amd64.exe';
  if (platform === 'linux') return arch === 'arm64' ? 'cloudflared-linux-arm64' : 'cloudflared-linux-amd64';
  return null; // macOS ships as an archive: install with Homebrew and set the path
}

/** The trycloudflare.com address cloudflared prints for a quick tunnel. */
export function parseQuickUrl(line: string): string | null {
  // quick tunnel names are several words joined by dashes; api.trycloudflare.com (in error lines) is not one
  return /https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com/.exec(line)?.[0] ?? null;
}

/**
 * Cloudflare Tunnel for the build server on this PC (variant B: no port forwarding, works behind CGNAT,
 * the home IP stays hidden). Two modes:
 *  - token: a named tunnel made in the Cloudflare dashboard with your own domain; the address never changes;
 *  - quick: no account, a random https://….trycloudflare.com address that changes on every start.
 * Only the build server's port is exposed; the admin panel refuses requests that arrive through the tunnel.
 */
export class Tunnel extends EventEmitter {
  private proc: ChildProcess | null = null;
  state: TunnelState = 'off';
  url: string | null = null;
  private log: string[] = [];

  constructor(private readonly binDir: string) { super(); }

  history() { return [...this.log]; }
  private set(s: TunnelState) { this.state = s; this.emit('state', s); }
  private line(l: string) {
    this.log.push(l); if (this.log.length > 300) this.log.shift();
    this.emit('line', l);
    const q = parseQuickUrl(l);
    if (q && !this.url) { this.url = q; this.emit('url', q); }
    if (/Registered tunnel connection|Connection [0-9a-f-]+ registered/i.test(l) && this.state === 'starting') this.set('running');
  }

  async binary(customPath?: string): Promise<string> {
    if (customPath) return customPath;
    const asset = cloudflaredAsset();
    if (!asset) throw Object.assign(new Error('install cloudflared and set its path'), { code: 'tunnel_platform' });
    const exe = join(this.binDir, asset);
    if (await fileExists(exe)) return exe;
    this.set('downloading');
    await downloadFile({ url: `https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`, dest: exe });
    if (process.platform !== 'win32') await fs.chmod(exe, 0o755);
    return exe;
  }

  async start(o: { mode: TunnelMode; localPort: number; token?: string; customPath?: string }) {
    if (this.proc) return;
    if (o.mode === 'token' && !o.token) throw Object.assign(new Error('tunnel token is not set'), { code: 'tunnel_token' });
    const exe = await this.binary(o.customPath);
    this.url = null;
    const args = o.mode === 'token'
      ? ['tunnel', '--no-autoupdate', 'run', '--token', o.token!]
      : ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${o.localPort}`];
    this.set('starting');
    this.proc = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const feed = (b: Buffer) => b.toString('utf8').split(/\r?\n/).filter(Boolean).forEach((l) => this.line(l.replace(/--token\s+\S+/, '--token ***')));
    this.proc.stdout?.on('data', feed);
    this.proc.stderr?.on('data', feed);
    this.proc.on('exit', (code) => { this.proc = null; this.line(`[launcher] tunnel exited (${code ?? 'signal'})`); this.set(code === 0 || code === null ? 'off' : 'error'); });
  }

  async stop() {
    const p = this.proc; if (!p) return;
    p.kill();
    await new Promise<void>((r) => { const t = setTimeout(r, 5000); p.once('exit', () => { clearTimeout(t); r(); }); });
  }
}
