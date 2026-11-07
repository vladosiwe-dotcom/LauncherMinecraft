import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import type { FileCategory } from '@sir/shared';
import type { Stores } from './db.js';
import { inspectArchive } from './modinspect.js';
import type { LibraryItem } from './types.js';

export const MAX_UPLOAD = 512 * 1024 * 1024;
const NAME_RE = /^[\w.+\-() \[\]]{1,160}$/;

/** Content-addressed storage of uploaded files: data/content/<sha256>. */
export class Library {
  constructor(private readonly dataDir: string, private readonly db: Stores) {}
  objectPath(sha256: string) { return join(this.dataDir, 'content', sha256); }

  async ingest(stream: Readable, fileName: string, user: string, categoryHint?: FileCategory): Promise<LibraryItem> {
    if (!NAME_RE.test(fileName) || fileName.includes('..')) throw Object.assign(new Error('bad_file_name'), { status: 400 });
    const tmpDir = join(this.dataDir, 'content', 'tmp');
    await fs.mkdir(tmpDir, { recursive: true });
    const tmp = join(tmpDir, randomUUID());
    const hash = createHash('sha256');
    let size = 0;
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(tmp);
      stream.on('data', (c: Buffer) => {
        size += c.length; hash.update(c);
        if (size > MAX_UPLOAD) { stream.destroy(); out.destroy(); reject(Object.assign(new Error('file_too_large'), { status: 413 })); }
      });
      stream.on('error', reject); out.on('error', reject); out.on('finish', resolve);
      stream.pipe(out);
    }).catch(async (e) => { await fs.rm(tmp, { force: true }); throw e; });

    const sha256 = hash.digest('hex');
    const buf = await fs.readFile(tmp);
    const info = inspectArchive(buf, fileName);
    const dest = this.objectPath(sha256);
    if (existsSync(dest)) await fs.rm(tmp, { force: true }); else await fs.rename(tmp, dest);

    const category: FileCategory = categoryHint ?? (info.kind === 'unknown' ? 'other' : info.kind);
    const existing = (await this.db.library.read()).items.find((i) => i.sha256 === sha256 && i.fileName === fileName);
    if (existing) return existing;
    const item: LibraryItem = {
      id: randomUUID(), sha256, size, fileName, category,
      name: info.mod?.displayName ?? fileName.replace(/\.(jar|zip)$/i, ''),
      version: info.mod?.version ?? info.pack?.format?.toString() ?? '1',
      uploadedAt: new Date().toISOString(), uploadedBy: user, mod: info.mod, pack: info.pack,
      errors: info.errors, warnings: info.warnings,
    };
    if (categoryHint && categoryHint !== info.kind && !(categoryHint === 'other' || categoryHint === 'config')) item.warnings.push(`category_mismatch:${info.kind}`);
    await this.db.library.update((d) => { d.items.push(item); });
    return item;
  }

  /** Delete a library item unless a non-archived build still uses it. */
  async remove(id: string) {
    const { builds } = await this.db.builds.read();
    const users = builds.filter((b) => b.status !== 'archived' && b.entries.some((e) => e.itemId === id));
    if (users.length) throw Object.assign(new Error(`in_use:${users.map((b) => b.version).join(',')}`), { status: 409 });
    let sha = '';
    await this.db.library.update((d) => { const i = d.items.findIndex((x) => x.id === id); if (i >= 0) { sha = d.items[i]!.sha256; d.items.splice(i, 1); } });
    const still = (await this.db.library.read()).items.some((i) => i.sha256 === sha);
    const archived = builds.some((b) => b.entries.some((e) => e.itemId === id));
    if (sha && !still && !archived) await fs.rm(this.objectPath(sha), { force: true });
  }
}
