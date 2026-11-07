import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { downloadFile, fileExists } from './http.js';

/** Content-addressed blob store: <root>/objects/ab/abcdef... (sha256). Lets us roll back without re-downloading. */
export class ObjectStore {
  constructor(readonly root: string) {}
  pathOf(sha256: string): string { return join(this.root, 'objects', sha256.slice(0, 2), sha256); }
  has(sha256: string): Promise<boolean> { return fileExists(this.pathOf(sha256)); }
  async fetch(url: string, sha256: string, size: number, onBytes?: (n: number) => void, signal?: AbortSignal): Promise<string> {
    const dest = this.pathOf(sha256);
    await downloadFile({ url, dest, sha256, size, onBytes, signal });
    return dest;
  }
  /** Remove every blob not in `keep`. Returns freed bytes. */
  async gc(keep: Set<string>): Promise<number> {
    const base = join(this.root, 'objects');
    let freed = 0;
    let dirs: string[] = [];
    try { dirs = await fs.readdir(base); } catch { return 0; }
    for (const d of dirs) {
      for (const f of await fs.readdir(join(base, d))) {
        if (keep.has(f) || f.endsWith('.part')) continue;
        const p = join(base, d, f);
        freed += (await fs.stat(p)).size;
        await fs.rm(p, { force: true });
      }
    }
    return freed;
  }
}
