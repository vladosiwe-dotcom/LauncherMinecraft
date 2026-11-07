import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

export class DownloadError extends Error {
  constructor(message: string, readonly code: 'http' | 'hash' | 'size' | 'network' | 'aborted', readonly url: string) { super(message); }
}

const UA = 'SpellAndIronRiftLauncher/0.1';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 20000);
  const outer = init.signal;
  outer?.addEventListener('abort', () => ctrl.abort(), { once: true });
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, headers: { 'User-Agent': UA, ...(init.headers ?? {}) } });
  } finally { clearTimeout(t); }
}

export async function fetchJson<T>(url: string, opts: { retries?: number; timeoutMs?: number; init?: RequestInit } = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, { ...opts.init, timeoutMs: opts.timeoutMs });
      if (!res.ok) throw new DownloadError(`HTTP ${res.status} for ${url}`, 'http', url);
      return (await res.json()) as T;
    } catch (e) {
      last = e;
      if (e instanceof DownloadError && e.code === 'http') {
        const status = Number(e.message.split(' ')[1]);
        if (status >= 400 && status < 500 && status !== 429) break;
      }
      if (attempt < retries) await sleep(500 * 2 ** attempt);
    }
  }
  throw last;
}

export async function hashFile(path: string, algo: 'sha256' | 'sha1' = 'sha256'): Promise<string> {
  const h = createHash(algo);
  await pipeline(createReadStream(path), h);
  return h.digest('hex');
}

export async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

export interface DownloadSpec {
  url: string;
  dest: string;
  sha256?: string;
  sha1?: string;
  size?: number;
  onBytes?: (delta: number) => void;
  signal?: AbortSignal;
  retries?: number;
}

/**
 * Download to `dest` atomically. Partial data is kept in `dest.part` and resumed
 * with an HTTP Range request. The result is hash-verified before it is moved in place.
 */
export async function downloadFile(spec: DownloadSpec): Promise<void> {
  const algo = spec.sha256 ? 'sha256' : spec.sha1 ? 'sha1' : undefined;
  const expected = spec.sha256 ?? spec.sha1;
  if (algo && expected && (await fileExists(spec.dest)) && (await hashFile(spec.dest, algo)) === expected) return;
  await fs.mkdir(dirname(spec.dest), { recursive: true });
  const part = `${spec.dest}.part`;
  const retries = spec.retries ?? 4;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (spec.signal?.aborted) throw new DownloadError('aborted', 'aborted', spec.url);
    try {
      await downloadOnce(spec, part, algo, expected);
      await fs.rename(part, spec.dest);
      return;
    } catch (e) {
      lastErr = e;
      if (e instanceof DownloadError && (e.code === 'hash' || e.code === 'size')) await fs.rm(part, { force: true });
      if (e instanceof DownloadError && e.code === 'aborted') throw e;
      if (e instanceof DownloadError && e.code === 'http' && /HTTP 4(0[0-9]|1[0-9])/.test(e.message) && !/HTTP 416/.test(e.message)) throw e;
      if (attempt < retries) await sleep(700 * 2 ** attempt);
    }
  }
  throw lastErr;
}

async function downloadOnce(spec: DownloadSpec, part: string, algo: 'sha256' | 'sha1' | undefined, expected: string | undefined) {
  let offset = 0;
  try { offset = (await fs.stat(part)).size; } catch { /* none */ }
  if (spec.size !== undefined && offset > spec.size) { await fs.rm(part, { force: true }); offset = 0; }
  const hash = algo ? createHash(algo) : undefined;
  if (offset > 0 && hash) await pipeline(createReadStream(part), new Transform({ transform(c, _e, cb) { hash.update(c); cb(); } }));

  let res: Response;
  try {
    res = await fetchWithTimeout(spec.url, { headers: offset > 0 ? { Range: `bytes=${offset}-` } : {}, signal: spec.signal, timeoutMs: 60000 });
  } catch (e) {
    throw new DownloadError(`network error: ${(e as Error).message}`, spec.signal?.aborted ? 'aborted' : 'network', spec.url);
  }
  if (res.status === 416 && offset > 0) {
    // Server says we already have everything; verify below.
  } else if (!res.ok) {
    throw new DownloadError(`HTTP ${res.status} for ${spec.url}`, 'http', spec.url);
  }
  const append = res.status === 206;
  // 206: continue the hash seeded with the existing part. 200: server ignored Range, start over.
  const h = append || res.status === 416 ? hash : algo ? createHash(algo) : undefined;
  if (res.status !== 416 && res.body) {
    const out = createWriteStream(part, { flags: append ? 'a' : 'w' });
    const tap = new Transform({
      transform(chunk: Buffer, _enc, cb) { h?.update(chunk); spec.onBytes?.(chunk.length); cb(null, chunk); },
    });
    try {
      await pipeline(Readable.fromWeb(res.body as never), tap, out);
    } catch (e) {
      throw new DownloadError(`transfer interrupted: ${(e as Error).message}`, spec.signal?.aborted ? 'aborted' : 'network', spec.url);
    }
  }
  const size = (await fs.stat(part)).size;
  if (spec.size !== undefined && size !== spec.size) throw new DownloadError(`size mismatch ${size} != ${spec.size}`, 'size', spec.url);
  if (h && expected) {
    const got = h.digest('hex');
    if (got !== expected) throw new DownloadError(`checksum mismatch for ${spec.url}`, 'hash', spec.url);
  }
}

/** Run async jobs with bounded concurrency; first error rejects after in-flight jobs settle. */
export async function runPool<T>(items: T[], limit: number, job: (item: T) => Promise<void>): Promise<void> {
  let i = 0; let failed: unknown;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length && failed === undefined) {
      const item = items[i++]!;
      try { await job(item); } catch (e) { failed ??= e; }
    }
  });
  await Promise.all(workers);
  if (failed !== undefined) throw failed;
}
