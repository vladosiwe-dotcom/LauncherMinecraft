import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import type { GraphicsPresetId } from '@sir/shared';

export type Language = 'ru' | 'uk' | 'en';

export interface LauncherSettings {
  installDir: string;
  memoryMb: number;
  /** null = use the Java runtime the launcher installs. */
  javaPath: string | null;
  jvmArgs: string;
  width: number;
  height: number;
  fullscreen: boolean;
  preset: GraphicsPresetId | null;
  presetIsManual: boolean;
  language: Language;
  channel: 'stable' | 'testing';
  closeOnLaunch: boolean;
  /** Test mode: play with a nickname on a server on this PC or local network (no Microsoft account). */
  testMode: boolean;
  testNick: string;
  serverPort: number;
  serverMemoryMb: number;
  eulaAccepted: boolean;
}

export function defaultSettings(baseDir: string, ramMb: number): LauncherSettings {
  return {
    installDir: join(baseDir, 'SpellAndIronRift'),
    memoryMb: ramMb >= 16000 ? 6144 : ramMb >= 8000 ? 4096 : 3072,
    javaPath: null, jvmArgs: '', width: 1600, height: 900, fullscreen: false,
    preset: null, presetIsManual: false, language: 'ru', channel: 'stable', closeOnLaunch: false,
    testMode: false, testNick: '', serverPort: 25565, serverMemoryMb: ramMb >= 16000 ? 6144 : 4096, eulaAccepted: false,
  };
}

export function validateSettings(s: Partial<LauncherSettings>, totalRamMb: number): string[] {
  const errs: string[] = [];
  if (s.memoryMb !== undefined && (s.memoryMb < 2048 || s.memoryMb > Math.max(2048, totalRamMb - 1536))) errs.push('memoryMb');
  if (s.width !== undefined && (s.width < 854 || s.width > 7680)) errs.push('width');
  if (s.height !== undefined && (s.height < 480 || s.height > 4320)) errs.push('height');
  if (s.language !== undefined && !['ru', 'uk', 'en'].includes(s.language)) errs.push('language');
  if (s.preset !== undefined && s.preset !== null && !['minimal', 'balanced', 'high', 'ultra'].includes(s.preset)) errs.push('preset');
  if (s.channel !== undefined && !['stable', 'testing'].includes(s.channel)) errs.push('channel');
  if (s.testNick !== undefined && s.testNick !== '' && !/^[A-Za-z0-9_]{3,16}$/.test(s.testNick)) errs.push('testNick');
  if (s.serverPort !== undefined && (!Number.isInteger(s.serverPort) || s.serverPort < 1024 || s.serverPort > 65535)) errs.push('serverPort');
  if (s.serverMemoryMb !== undefined && (s.serverMemoryMb < 2048 || s.serverMemoryMb > Math.max(2048, totalRamMb - 2048))) errs.push('serverMemoryMb');
  return errs;
}

export class SettingsStore {
  constructor(private readonly file: string, private readonly defaults: LauncherSettings) {}
  async load(): Promise<LauncherSettings> {
    try { return { ...this.defaults, ...JSON.parse(await fs.readFile(this.file, 'utf8')) }; } catch { return { ...this.defaults }; }
  }
  async save(s: LauncherSettings): Promise<void> {
    await fs.mkdir(dirname(this.file), { recursive: true });
    await fs.writeFile(`${this.file}.tmp`, JSON.stringify(s, null, 2));
    await fs.rename(`${this.file}.tmp`, this.file);
  }
}
