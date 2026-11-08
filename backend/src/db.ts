import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Small JSON document store with atomic writes and a per-file write queue.
 * Data volume is tiny (dozens of builds, hundreds of library items), so this is
 * simpler and more robust to operate than a database server.
 */
export class JsonStore<T> {
  private cache: T | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string, private readonly initial: () => T) {}

  async read(): Promise<T> {
    if (this.cache !== undefined) return this.cache;
    try { this.cache = JSON.parse(await fs.readFile(this.file, 'utf8')) as T; }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      this.cache = this.initial();
    }
    return this.cache;
  }

  /** Serialised read-modify-write. The mutator may return a value. */
  update<R>(fn: (data: T) => R | Promise<R>): Promise<R> {
    const run = this.queue.then(async () => {
      const data = structuredClone(await this.read());
      const result = await fn(data);
      await fs.mkdir(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(data, null, 2));
      await fs.rename(tmp, this.file);
      this.cache = data;
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}

export function stores(dataDir: string) {
  return {
    users: new JsonStore<{ users: import('./types.js').User[] }>(join(dataDir, 'users.json'), () => ({ users: [] })),
    sessions: new JsonStore<{ sessions: import('./types.js').Session[] }>(join(dataDir, 'sessions.json'), () => ({ sessions: [] })),
    library: new JsonStore<{ items: import('./types.js').LibraryItem[] }>(join(dataDir, 'library.json'), () => ({ items: [] })),
    builds: new JsonStore<{ builds: import('./types.js').Build[]; published: { stable: string | null; testing: string | null } }>(join(dataDir, 'builds.json'), () => ({ builds: [], published: { stable: null, testing: null } })),
    news: new JsonStore<{ items: import('./types.js').News[] }>(join(dataDir, 'news.json'), () => ({ items: [] })),
    site: new JsonStore<import('./types.js').SiteSettings>(join(dataDir, 'site.json'), () => ({ motd: 'Spell and Iron Rift', rules: { ru: '', uk: '', en: '' }, maxPlayers: 100, whitelist: false })),
    launcher: new JsonStore<{ releases: import('./types.js').LauncherReleaseRecord[]; published: string | null; signed: import('@sir/shared').SignedLauncherRelease | null }>(join(dataDir, 'launcher.json'), () => ({ releases: [], published: null, signed: null })),
    audit: new JsonStore<{ entries: import('./types.js').AuditEntry[] }>(join(dataDir, 'audit.json'), () => ({ entries: [] })),
  };
}
export type Stores = ReturnType<typeof stores>;
