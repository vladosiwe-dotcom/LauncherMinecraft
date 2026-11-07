import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { downloadFile, fetchJson, fileExists, runPool } from './http.js';

/** Mojang's own Java runtime index — the same builds the official launcher uses. */
export const JAVA_RUNTIME_INDEX = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';

export function mojangPlatform(): string {
  const arm = process.arch === 'arm64';
  if (process.platform === 'win32') return arm ? 'windows-arm64' : process.arch === 'ia32' ? 'windows-x86' : 'windows-x64';
  if (process.platform === 'darwin') return arm ? 'mac-os-arm64' : 'mac-os';
  return process.arch === 'ia32' ? 'linux-i386' : 'linux';
}

interface RuntimeFile { type: 'file' | 'directory' | 'link'; executable?: boolean; target?: string; downloads?: { raw: { sha1: string; size: number; url: string } } }

export function javaExecutable(home: string): string {
  if (process.platform === 'win32') return join(home, 'bin', 'javaw.exe');
  if (process.platform === 'darwin') return join(home, 'jre.bundle', 'Contents', 'Home', 'bin', 'java');
  return join(home, 'bin', 'java');
}

export async function installJavaRuntime(root: string, component: string, progress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<string> {
  const home = join(root, 'runtime', component);
  const exe = javaExecutable(home);
  const marker = join(home, '.sir-complete');
  if ((await fileExists(marker)) && (await fileExists(exe))) return exe;

  const index = await fetchJson<Record<string, Record<string, { manifest: { url: string; sha1: string } }[]>>>(JAVA_RUNTIME_INDEX);
  const entry = index[mojangPlatform()]?.[component]?.[0];
  if (!entry) throw new Error(`Java runtime ${component} is not available for ${mojangPlatform()}`);
  const manifest = await fetchJson<{ files: Record<string, RuntimeFile> }>(entry.manifest.url);
  const entries = Object.entries(manifest.files);
  for (const [p, f] of entries) if (f.type === 'directory') await fs.mkdir(join(home, p), { recursive: true });
  const files = entries.filter(([, f]) => f.type === 'file' && f.downloads);
  let done = 0;
  await runPool(files, 8, async ([p, f]) => {
    const raw = f.downloads!.raw;
    await downloadFile({ url: raw.url, dest: join(home, p), sha1: raw.sha1, size: raw.size, signal });
    if (f.executable && process.platform !== 'win32') await fs.chmod(join(home, p), 0o755);
    progress?.(++done, files.length);
  });
  if (process.platform !== 'win32') {
    for (const [p, f] of entries) if (f.type === 'link' && f.target) {
      await fs.rm(join(home, p), { force: true });
      await fs.symlink(f.target, join(home, p)).catch(() => undefined);
    }
  }
  await fs.writeFile(marker, new Date().toISOString());
  return exe;
}
