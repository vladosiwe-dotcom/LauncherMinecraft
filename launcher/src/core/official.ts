import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { fileExists } from './http.js';

/**
 * Playing through the official Minecraft Launcher: our launcher keeps the build in sync and prepares an
 * installation ("profile") there; the player signs in to Microsoft in the official launcher, as anyone who owns
 * Minecraft already does. No application registration (Azure) is needed on our side, and the game server runs
 * in online mode, so every player is verified by Mojang.
 */
export const PROFILE_ID = 'spell-and-iron-rift';

/** The official launcher's data folder (.minecraft). */
export function officialDir(platform = process.platform, env = process.env, home = os.homedir()): string {
  if (platform === 'win32') return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), '.minecraft');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'minecraft');
  return join(home, '.minecraft');
}

export interface ProfileOptions { versionId: string; gameDir: string; memoryMb: number; jvmArgs: string; width: number; height: number; icon?: string }

/** Adds or updates our installation in launcher_profiles.json, keeping every other profile and setting as it was. */
export async function writeOfficialProfile(dir: string, o: ProfileOptions): Promise<void> {
  const file = join(dir, 'launcher_profiles.json');
  let data: { profiles?: Record<string, unknown>; [k: string]: unknown } = {};
  try { data = JSON.parse(await fs.readFile(file, 'utf8')); } catch { /* the official launcher has not run yet */ }
  const profiles = (data.profiles && typeof data.profiles === 'object' ? data.profiles : {}) as Record<string, Record<string, unknown>>;
  const now = new Date().toISOString();
  const prev = profiles[PROFILE_ID] ?? {};
  profiles[PROFILE_ID] = {
    ...prev,
    name: 'Spell and Iron Rift',
    type: 'custom',
    icon: o.icon ?? prev.icon ?? 'Enchanting_Table',
    created: prev.created ?? now,
    lastUsed: now, // shown first in the official launcher
    lastVersionId: o.versionId,
    gameDir: o.gameDir,
    javaArgs: [`-Xmx${o.memoryMb}M`, '-XX:+UseG1GC', '-XX:MaxGCPauseMillis=50', ...o.jvmArgs.split(/\s+/).filter(Boolean)].join(' '),
    resolution: { width: o.width, height: o.height },
  };
  data.profiles = profiles;
  if (!data.version) data.version = 3;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(`${file}.tmp`, JSON.stringify(data, null, 2));
  await fs.rename(`${file}.tmp`, file);
}

/** Places the official launcher is installed to (MSI and Microsoft Store builds on Windows). */
export function officialCandidates(platform = process.platform, env = process.env): { cmd: string; args: string[] }[] {
  if (platform === 'win32') {
    const pf86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', pf = env.ProgramFiles ?? 'C:\\Program Files';
    return [
      { cmd: join(pf86, 'Minecraft Launcher', 'MinecraftLauncher.exe'), args: [] },
      { cmd: join(pf, 'Minecraft Launcher', 'MinecraftLauncher.exe'), args: [] },
      { cmd: join(env.LOCALAPPDATA ?? '', 'Programs', 'Minecraft Launcher', 'MinecraftLauncher.exe'), args: [] },
      // Microsoft Store / Xbox app build
      { cmd: 'explorer.exe', args: ['shell:AppsFolder\\Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft'] },
    ];
  }
  if (platform === 'darwin') return [{ cmd: 'open', args: ['-a', 'Minecraft'] }];
  return [{ cmd: 'minecraft-launcher', args: [] }];
}

/** Opens the official launcher. 'not_found' when it does not seem to be installed. */
export async function openOfficial(): Promise<'opened' | 'not_found'> {
  for (const c of officialCandidates()) {
    const isPath = c.cmd.includes('\\') || c.cmd.includes('/');
    if (isPath && !(await fileExists(c.cmd))) continue;
    if (c.cmd === 'explorer.exe' && !(await storeInstalled())) continue;
    const ok = await new Promise<boolean>((resolve) => {
      try {
        const p = spawn(c.cmd, c.args, { detached: true, stdio: 'ignore', windowsHide: false });
        p.once('error', () => resolve(false));
        p.once('spawn', () => { p.unref(); resolve(true); });
      } catch { resolve(false); }
    });
    if (ok) return 'opened';
  }
  return 'not_found';
}

async function storeInstalled(): Promise<boolean> {
  const pkgs = join(process.env.LOCALAPPDATA ?? '', 'Packages');
  try { return (await fs.readdir(pkgs)).some((n) => n.startsWith('Microsoft.4297127D64EC6')); } catch { return false; }
}
