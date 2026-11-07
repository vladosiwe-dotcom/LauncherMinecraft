import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { promisify } from 'node:util';
import type { HardwareInfo } from '@sir/shared';

const run = promisify(execFile);
async function tryRun(cmd: string, args: string[]): Promise<string> {
  try { return (await run(cmd, args, { timeout: 6000, windowsHide: true })).stdout; } catch { return ''; }
}

export interface GpuHint { vendorId?: number; renderer?: string; glVersion?: string }

function vendorOf(name: string, vendorId?: number): HardwareInfo['gpuVendor'] {
  const n = name.toLowerCase();
  if (vendorId === 0x10de || n.includes('nvidia') || n.includes('geforce') || n.includes('rtx')) return 'nvidia';
  if (vendorId === 0x1002 || n.includes('amd') || n.includes('radeon')) return 'amd';
  if (vendorId === 0x8086 || n.includes('intel')) return 'intel';
  if (n.includes('apple')) return 'apple';
  return 'other';
}

/** Best-effort VRAM detection per OS; returns undefined when unknown (we then avoid recommending shaders). */
async function detectVram(vendor: HardwareInfo['gpuVendor']): Promise<number | undefined> {
  if (vendor === 'nvidia') {
    const out = await tryRun('nvidia-smi', ['--query-gpu=memory.total', '--format=csv,noheader,nounits']);
    const mb = parseInt(out.trim().split('\n')[0] ?? '', 10);
    if (mb > 0) return mb;
  }
  if (process.platform === 'win32') {
    const ps = "Get-ItemProperty -Path 'HKLM:\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' -Name HardwareInformation.qwMemorySize -ErrorAction SilentlyContinue | ForEach-Object { $_.'HardwareInformation.qwMemorySize' }";
    const out = await tryRun('powershell.exe', ['-NoProfile', '-Command', ps]);
    const max = Math.max(0, ...out.split(/\s+/).map((x) => Number(x)).filter((x) => x > 0));
    if (max > 0) return Math.round(max / 1024 / 1024);
  }
  if (process.platform === 'linux') {
    try {
      for (const card of await fs.readdir('/sys/class/drm')) {
        const v = await fs.readFile(`/sys/class/drm/${card}/device/mem_info_vram_total`, 'utf8').catch(() => '');
        if (v) return Math.round(Number(v) / 1024 / 1024);
      }
    } catch { /* ignore */ }
  }
  if (process.platform === 'darwin') {
    const out = await tryRun('system_profiler', ['SPDisplaysDataType']);
    const m = out.match(/VRAM[^:]*:\s*(\d+)\s*(MB|GB)/i);
    if (m) return Number(m[1]) * (m[2]!.toUpperCase() === 'GB' ? 1024 : 1);
    if (/Apple M\d/.test(out)) return Math.round(os.totalmem() / 1024 / 1024 / 2); // unified memory
  }
  return undefined;
}

export async function detectHardware(gpu: GpuHint = {}): Promise<HardwareInfo> {
  const cpus = os.cpus();
  const name = gpu.renderer ?? '';
  const vendor = vendorOf(name, gpu.vendorId);
  const gl = gpu.glVersion?.match(/(\d+)\.(\d+)/);
  return {
    cpuModel: cpus[0]?.model?.trim() ?? 'unknown',
    cpuThreads: cpus.length,
    totalRamMb: Math.round(os.totalmem() / 1024 / 1024),
    gpuName: name || undefined,
    gpuVendor: vendor,
    vramMb: await detectVram(vendor),
    glVersion: gl ? Number(`${gl[1]}.${gl[2]}`) : undefined,
  };
}
