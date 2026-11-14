import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { delimiter, join } from 'node:path';
import { currentOs, mavenPath, nativeArtifact, rulesAllow, type Argument, type VersionJson } from './mojang.js';
import { extractZip } from './zip.js';

export interface LaunchProfile {
  name: string;
  uuid: string;
  accessToken: string;
  xuid: string;
  /** 'msa' for a Microsoft account; 'legacy' when playing offline. */
  userType?: 'msa' | 'legacy';
}

export interface LaunchOptions {
  root: string;        // shared: versions/, libraries/, assets/
  gameDir: string;     // per-pack: mods/, config/, saves/ ...
  javaExe: string;
  version: VersionJson; // resolved (inheritsFrom merged)
  profile: LaunchProfile;
  memoryMb: number;
  width?: number;
  height?: number;
  fullscreen?: boolean;
  extraJvmArgs?: string[];
  launcherVersion: string;
  clientId?: string;
}

/** JVM arguments of versions before 1.13, whose version file does not list them. */
function legacyJvm(): string[] {
  const a = ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'];
  if (currentOs() === 'osx') a.unshift('-XstartOnFirstThread');
  if (currentOs() === 'windows') a.unshift('-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump');
  return a;
}

/** Unpack the native libraries of older versions (LWJGL 2/3 "natives-*" jars) into the natives folder. */
export async function extractNatives(o: { root: string; version: VersionJson }): Promise<number> {
  const dir = join(o.root, 'natives', o.version.id);
  let n = 0;
  for (const lib of o.version.libraries) {
    if (!rulesAllow(lib.rules)) continue;
    const a = nativeArtifact(lib);
    if (!a) continue;
    const jar = join(o.root, 'libraries', a.path);
    if (!existsSync(jar)) throw new Error(`Missing native library ${a.path}. Run repair.`);
    n += (await extractZip(jar, dir, lib.extract?.exclude ?? ['META-INF/'])).length;
  }
  return n;
}

function expand(args: Argument[] | undefined, features: Record<string, boolean>): string[] {
  const out: string[] = [];
  for (const a of args ?? []) {
    if (typeof a === 'string') out.push(a);
    else if (rulesAllow(a.rules, features)) out.push(...(Array.isArray(a.value) ? a.value : [a.value]));
  }
  return out;
}

/** JVM flags users may not override from settings (they would break or weaken the launch). */
const FORBIDDEN_USER_JVM = /^-(cp|classpath|p|-module-path|javaagent|agentlib|Djava\.library\.path|Dminecraft\.launcher|Djava\.security\.manager)/;

export function sanitizeJvmArgs(args: string[]): string[] {
  return args.map((a) => a.trim()).filter((a) => a && !FORBIDDEN_USER_JVM.test(a) && !/^-Xm[sx]/.test(a));
}

export function buildCommand(o: LaunchOptions): { args: string[]; classpath: string[] } {
  const v = o.version;
  const libDir = join(o.root, 'libraries');
  const cp: string[] = [];
  for (const lib of v.libraries) {
    if (!rulesAllow(lib.rules)) continue;
    // a library that only ships native jars (older LWJGL) is extracted, not put on the class path
    if (!lib.downloads?.artifact && lib.natives) continue;
    const rel = lib.downloads?.artifact?.path ?? mavenPath(lib.name);
    const p = join(libDir, rel);
    if (!cp.includes(p)) cp.push(p);
  }
  const jarId = v.jar ?? v.id;
  const clientJar = join(o.root, 'versions', jarId, `${jarId}.jar`);
  if (existsSync(clientJar)) cp.push(clientJar);

  const customRes = !!(o.width && o.height) && !o.fullscreen;
  const features = { has_custom_resolution: customRes };
  const vars: Record<string, string> = {
    auth_player_name: o.profile.name,
    version_name: v.id,
    game_directory: o.gameDir,
    assets_root: join(o.root, 'assets'),
    assets_index_name: v.assetIndex?.id ?? v.assets ?? '',
    auth_uuid: o.profile.uuid,
    auth_access_token: o.profile.accessToken,
    clientid: o.clientId ?? '',
    auth_xuid: o.profile.xuid,
    user_type: o.profile.userType ?? 'msa',
    version_type: v.type ?? 'release',
    auth_session: `token:${o.profile.accessToken}:${o.profile.uuid}`,
    user_properties: '{}',
    game_assets: join(o.root, 'assets', 'virtual', v.assetIndex?.id ?? v.assets ?? 'legacy'),
    natives_directory: join(o.root, 'natives', v.id),
    launcher_name: 'spell-and-iron-rift',
    launcher_version: o.launcherVersion,
    classpath: cp.join(delimiter),
    classpath_separator: delimiter,
    library_directory: libDir,
    resolution_width: String(o.width ?? 1280),
    resolution_height: String(o.height ?? 720),
  };
  const sub = (s: string) => s.replace(/\$\{([a-z_]+)\}/g, (m, k: string) => vars[k] ?? m);

  const jvm = [
    `-Xmx${o.memoryMb}M`, `-Xms${Math.min(o.memoryMb, 1024)}M`,
    '-XX:+UseG1GC', '-XX:MaxGCPauseMillis=50', '-XX:+UnlockExperimentalVMOptions', '-XX:G1NewSizePercent=20', '-XX:G1ReservePercent=20',
    ...sanitizeJvmArgs(o.extraJvmArgs ?? []),
    ...(v.arguments?.jvm ? expand(v.arguments.jvm, features) : legacyJvm()).map(sub),
  ];
  if (v.logging?.client) jvm.push(sub(v.logging.client.argument.replace('${path}', join(o.root, 'assets', 'log_configs', v.logging.client.file.id))));
  const game = (v.arguments?.game?.length ? expand(v.arguments.game, features) : (v.minecraftArguments ?? '').split(/\s+/).filter(Boolean)).map(sub);
  if (!v.arguments?.game?.length && customRes) game.push('--width', vars.resolution_width!, '--height', vars.resolution_height!);
  if (o.fullscreen) game.push('--fullscreen');
  return { args: [...jvm, v.mainClass, ...game], classpath: cp };
}

export async function launch(o: LaunchOptions, onLog: (line: string) => void): Promise<ChildProcess> {
  await fs.mkdir(join(o.root, 'natives', o.version.id), { recursive: true });
  await extractNatives(o);
  await fs.mkdir(o.gameDir, { recursive: true });
  const missing = buildCommand(o).classpath.filter((p) => !existsSync(p));
  if (missing.length) throw new Error(`Missing ${missing.length} libraries (first: ${missing[0]}). Run repair.`);
  const { args } = buildCommand(o);
  const child = spawn(o.javaExe, args, { cwd: o.gameDir, env: { ...process.env, _JAVA_OPTIONS: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const pipe = (s: NodeJS.ReadableStream | null) => s?.on('data', (b: Buffer) => b.toString().split(/\r?\n/).filter(Boolean).forEach(onLog));
  pipe(child.stdout); pipe(child.stderr);
  return child;
}

/** Hide the access token in anything we log or show. */
export function redactArgs(args: string[]): string[] {
  return args.map((a, i) => (args[i - 1] === '--accessToken' ? '********' : a));
}
