import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { GRAPHICS_PRESETS, applyOptions, type BuildManifest, type GraphicsPresetId, type SignedManifest } from '@sir/shared';
import { installJavaRuntime } from './java.js';
import { VanillaInstaller, resolveVersion } from './mojang.js';
import { installNeoForge, neoforgeVersionId } from './neoforge.js';
import { PackUpdater, type UpdateProgress } from './updater.js';
import { launch, type LaunchProfile } from './launch.js';
import type { LauncherSettings } from './settings.js';
import { fileExists } from './http.js';

export type Stage = 'java' | 'minecraft' | 'neoforge' | 'pack' | 'launch';
export interface StageProgress { stage: Stage; done: number; total: number; detail?: string }

const MC = '1.21.1';
const LANG_CODE = { ru: 'ru_ru', uk: 'uk_ua', en: 'en_us' } as const;

/** Orchestrates the full "first run → update → play" pipeline for the single Spell and Iron Rift build. */
export class GameManager {
  constructor(private readonly settings: LauncherSettings, private readonly trustedKeys: string[], private readonly allowHttp = false, private readonly apiBase = '') {}

  get root() { return this.settings.installDir; }
  get gameDir() { return join(this.root, 'game'); }
  get updater() { return new PackUpdater(this.gameDir, join(this.root, '.sir')); }

  async javaExe(component: string, onProgress?: (p: StageProgress) => void, signal?: AbortSignal): Promise<string> {
    if (this.settings.javaPath) {
      if (!(await fileExists(this.settings.javaPath))) throw new Error(`Java not found at ${this.settings.javaPath}`);
      return this.settings.javaPath;
    }
    return installJavaRuntime(this.root, component, (d, t) => onProgress?.({ stage: 'java', done: d, total: t }), signal);
  }

  /** Ensure Java, Minecraft 1.21.1, NeoForge and the pack are installed and current. Returns the version id to launch. */
  async prepare(signed: SignedManifest, preset: GraphicsPresetId, onProgress?: (p: StageProgress) => void, signal?: AbortSignal): Promise<{ versionId: string; javaExe: string; manifest: BuildManifest }> {
    const up = this.updater;
    await up.recover();
    const manifest = up.accept(signed, this.trustedKeys, { allowHttp: this.allowHttp });
    const javaExe = await this.javaExe(manifest.java.mojangComponent, onProgress, signal);

    const vanilla = new VanillaInstaller(this.root);
    if (!(await fileExists(join(this.root, 'versions', MC, `${MC}.jar`))) || !(await fileExists(join(this.root, 'assets', 'indexes')))) {
      await vanilla.install(MC, (s, d, t) => onProgress?.({ stage: 'minecraft', done: d, total: t, detail: s }), signal);
    }
    onProgress?.({ stage: 'neoforge', done: 0, total: 1 });
    const versionId = await installNeoForge(this.root, manifest.loader.version, javaExe);
    onProgress?.({ stage: 'neoforge', done: 1, total: 1 });

    await up.apply(manifest, preset, (p: UpdateProgress) => onProgress?.({ stage: 'pack', done: p.doneBytes, total: p.totalBytes, detail: p.file ?? p.phase }), signal);
    await this.writeClientConfig(manifest, preset);
    return { versionId, javaExe, manifest };
  }

  /** Preset the player picked in the in-game settings screen (written by the mod), if any. */
  async inGamePresetRequest(): Promise<GraphicsPresetId | null> {
    try {
      const j = JSON.parse(await fs.readFile(join(this.gameDir, 'spellironrift', 'client-prefs.json'), 'utf8')) as { preset?: string };
      return (['minimal', 'balanced', 'high', 'ultra'] as const).find((p) => p === j.preset) ?? null;
    } catch { return null; }
  }

  /** Settings the in-game mod reads (server address, language, preset). Contains no secrets. */
  private async writeClientConfig(m: BuildManifest, preset: GraphicsPresetId) {
    const server = this.settings.testMode ? { host: '127.0.0.1', port: this.settings.serverPort } : m.server;
    const dir = join(this.gameDir, 'spellironrift');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, 'launcher.json'), JSON.stringify({
      server, offline: this.settings.testMode, apiBase: this.apiBase, language: this.settings.language, preset, buildVersion: m.version, buildId: m.buildId,
    }, null, 2));
    const optPath = join(this.gameDir, 'options.txt');
    const current = await fs.readFile(optPath, 'utf8').catch(() => '');
    const values: Record<string, string> = { lang: LANG_CODE[this.settings.language] };
    if (!current || this.settings.preset !== null) Object.assign(values, GRAPHICS_PRESETS[preset].options);
    if (m.resourcePacks.length) values.resourcePacks = JSON.stringify(['vanilla', 'mod_resources', ...m.resourcePacks.map((p) => `file/${p}`)]);
    await fs.writeFile(optPath, applyOptions(current, values));
    const p = GRAPHICS_PRESETS[preset];
    const irisPath = join(this.gameDir, 'config', 'iris.properties');
    const shader = m.files.find((f) => f.category === 'shaderpack' && (!f.presets || f.presets.includes(preset)));
    await fs.mkdir(join(this.gameDir, 'config'), { recursive: true });
    const iris = await fs.readFile(irisPath, 'utf8').catch(() => '');
    await fs.writeFile(irisPath, applyProperties(iris, {
      enableShaders: String(p.shaders && !!shader), shaderPack: shader ? shader.path.split('/').pop()! : '',
    }));
  }

  async launch(versionId: string, javaExe: string, profile: LaunchProfile, onLog: (l: string) => void, launcherVersion: string, clientId: string) {
    const version = await resolveVersion(new VanillaInstaller(this.root), versionId);
    return launch({
      root: this.root, gameDir: this.gameDir, javaExe, version, profile,
      memoryMb: this.settings.memoryMb, width: this.settings.width, height: this.settings.height, fullscreen: this.settings.fullscreen,
      extraJvmArgs: this.settings.jvmArgs.split(/\s+/).filter(Boolean), launcherVersion, clientId,
    }, onLog);
  }

  static neoforgeId = neoforgeVersionId;
}

/** Merge key=value pairs into a .properties body, keeping comments and other keys. */
export function applyProperties(body: string, values: Record<string, string>): string {
  const seen = new Set<string>();
  const lines = body.split(/\r?\n/).filter((l) => l !== '').map((l) => {
    const i = l.indexOf('=');
    if (l.startsWith('#') || i < 0) return l;
    const k = l.slice(0, i).trim();
    if (k in values) { seen.add(k); return `${k}=${values[k]}`; }
    return l;
  });
  for (const [k, v] of Object.entries(values)) if (!seen.has(k)) lines.push(`${k}=${v}`);
  return lines.join('\n') + '\n';
}
