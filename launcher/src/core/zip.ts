import { promises as fs } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { inflateRawSync } from 'node:zlib';

/**
 * Minimal ZIP reader for extracting LWJGL native libraries from the "natives-*" jars of older Minecraft versions.
 * Supports stored and deflated entries (all that Mojang's jars use). Entries starting with an excluded prefix
 * (META-INF/) are skipped; paths that would escape the destination are refused.
 */
export async function extractZip(file: string, dest: string, exclude: string[] = []): Promise<string[]> {
  const buf = await fs.readFile(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error(`not a zip file: ${file}`);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const written: string[] = [];
  const root = normalize(dest) + sep;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('broken zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || exclude.some((e) => name.startsWith(e))) continue;
    const out = normalize(join(dest, name));
    if (!out.startsWith(root)) throw new Error(`unsafe path in zip: ${name}`);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + csize);
    const data = method === 0 ? raw : method === 8 ? inflateRawSync(raw) : null;
    if (!data) throw new Error(`unsupported zip method ${method} for ${name}`);
    await fs.mkdir(dirname(out), { recursive: true });
    await fs.writeFile(out, data);
    written.push(out);
  }
  return written;
}
