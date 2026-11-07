import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';

export type ServerState = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed';
export interface ConsoleLine { seq: number; at: number; text: string; source: 'out' | 'err' | 'panel' }

/**
 * Supervises the NeoForge server process: start/stop/restart, console ring buffer,
 * commands over stdin, and simple parsing of "list" and "neoforge tps" output.
 */
export class ServerProcess extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private lines: ConsoleLine[] = [];
  private seq = 0;
  state: ServerState = 'stopped';
  startedAt: number | null = null;
  lastTps: { tps: number; mspt: number; at: number } | null = null;
  lastPlayers: { names: string[]; max: number; at: number } | null = null;

  constructor(readonly dir: string, private readonly maxLines = 2000) { super(); }

  get configured() { return !!this.dir && existsSync(this.dir); }
  get pid() { return this.child?.pid ?? null; }

  private push(text: string, source: ConsoleLine['source']) {
    const line = { seq: ++this.seq, at: Date.now(), text, source };
    this.lines.push(line);
    if (this.lines.length > this.maxLines) this.lines.splice(0, this.lines.length - this.maxLines);
    this.emit('line', line);
    this.parse(text);
  }
  history(after = 0) { return this.lines.filter((l) => l.seq > after); }

  private setState(s: ServerState) { this.state = s; this.emit('state', s); }

  private parse(text: string) {
    if (/Done \([\d.]+s\)! For help/.test(text)) this.setState('running');
    let m = /There are (\d+) of a max of (\d+) players online:?\s*(.*)$/.exec(text);
    if (m) this.lastPlayers = { names: m[3] ? m[3].split(',').map((s) => s.trim()).filter(Boolean) : [], max: Number(m[2]), at: Date.now() };
    m = /Overall\s*:\s*Mean tick time:\s*([\d.]+)\s*ms\.?\s*Mean TPS:\s*([\d.]+)/i.exec(text);
    if (m) this.lastTps = { mspt: Number(m[1]), tps: Number(m[2]), at: Date.now() };
  }

  /** The start script created by /server/install.sh (NeoForge's run.sh wrapper with our JVM args). */
  private launchCommand(): [string, string[]] {
    if (process.platform === 'win32') return ['cmd.exe', ['/c', 'run.bat', 'nogui']];
    return ['bash', [join(this.dir, 'run.sh'), 'nogui']];
  }

  async start() {
    if (!this.configured) throw new Error('server_dir_not_configured');
    if (this.child) throw new Error('already_running');
    const eula = await fs.readFile(join(this.dir, 'eula.txt'), 'utf8').catch(() => '');
    if (!/eula=true/.test(eula)) throw new Error('eula_not_accepted');
    const [cmd, args] = this.launchCommand();
    this.setState('starting');
    this.startedAt = Date.now();
    this.push('[panel] starting server', 'panel');
    const child = spawn(cmd, args, { cwd: this.dir, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    const pipe = (s: NodeJS.ReadableStream, src: 'out' | 'err') => {
      let rest = '';
      s.on('data', (b: Buffer) => { const parts = (rest + b.toString()).split(/\r?\n/); rest = parts.pop() ?? ''; parts.forEach((p) => this.push(p, src)); });
    };
    pipe(child.stdout, 'out'); pipe(child.stderr, 'err');
    child.on('exit', (code) => {
      this.push(`[panel] server exited with code ${code}`, 'panel');
      this.child = null; this.startedAt = null;
      this.setState(this.state === 'stopping' || code === 0 ? 'stopped' : 'crashed');
    });
  }

  command(cmd: string) {
    if (!this.child) throw new Error('not_running');
    const clean = cmd.replace(/[\r\n]/g, ' ').trim().replace(/^\//, '');
    if (!clean) return;
    this.push(`> ${clean}`, 'panel');
    this.child.stdin.write(`${clean}\n`);
  }

  async stop(timeoutMs = 60000): Promise<void> {
    if (!this.child) return;
    this.setState('stopping');
    const exited = new Promise<void>((r) => this.child?.once('exit', () => r()));
    this.command('stop');
    const t = setTimeout(() => { this.push('[panel] stop timed out, killing process', 'panel'); this.child?.kill('SIGKILL'); }, timeoutMs);
    await exited; clearTimeout(t);
  }

  async restart() { await this.stop(); await this.start(); }

  /** Run a command and wait for a matching console line (used for list/tps refresh). */
  async query(cmd: string, match: RegExp, timeoutMs = 3000): Promise<string | null> {
    if (!this.child || this.state !== 'running') return null;
    return new Promise((resolve) => {
      const on = (l: ConsoleLine) => { if (match.test(l.text)) { this.off('line', on); clearTimeout(t); resolve(l.text); } };
      const t = setTimeout(() => { this.off('line', on); resolve(null); }, timeoutMs);
      this.on('line', on);
      this.child!.stdin.write(`${cmd}\n`);
    });
  }

  /** CPU % and RSS of the server process (Linux /proc; other OS: undefined). */
  async usage(): Promise<{ cpu?: number; rssMb?: number }> {
    const pid = this.pid;
    if (!pid || process.platform !== 'linux') return {};
    try {
      // Sum over the process tree: run.sh spawns java as a child.
      const pids = [pid, ...(await fs.readFile(`/proc/${pid}/task/${pid}/children`, 'utf8')).trim().split(/\s+/).filter(Boolean).map(Number)];
      let rss = 0, ticks = 0;
      for (const p of pids) {
        const status = await fs.readFile(`/proc/${p}/status`, 'utf8');
        rss += Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0) / 1024;
        const stat = (await fs.readFile(`/proc/${p}/stat`, 'utf8')).split(') ')[1]!.split(' ');
        ticks += Number(stat[11]) + Number(stat[12]);
      }
      const now = Date.now();
      const prev = this.prevCpu;
      this.prevCpu = { ticks, at: now };
      const cpu = prev ? ((ticks - prev.ticks) / 100) / ((now - prev.at) / 1000) * 100 : undefined;
      return { cpu: cpu !== undefined ? Math.round(cpu) : undefined, rssMb: Math.round(rss) };
    } catch { return {}; }
  }
  private prevCpu: { ticks: number; at: number } | null = null;
}
