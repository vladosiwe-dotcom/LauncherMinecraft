import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, safeStorage, shell, Tray } from 'electron';
import { promises as fs, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRAPHICS_PRESETS, recommendPreset, recommendHeapMb, type GraphicsPresetId, type HardwareInfo, type SignedManifest } from '@sir/shared';
import { RiftApi } from '../core/api.js';
import { AuthError, MicrosoftAuth, type MinecraftSession } from '../core/auth.js';
import { GameManager } from '../core/game.js';
import { fetchJson } from '../core/http.js';
import { VersionLibrary } from '../core/versions.js';
import { startEmbedded, type EmbeddedBackend } from '@sir/backend/embedded';
import { Tunnel } from '../core/tunnel.js';
import { decodeInvite, encodeInvite } from '../core/invite.js';
import { ping as slpPing } from '../core/slp.js';
import { SettingsStore, defaultSettings, validateSettings, type LauncherSettings } from '../core/settings.js';
import { detectHardware } from '../core/sysinfo.js';
import { LocalServer, NICK_RE, offlineUuid } from '../core/localserver.js';
import { RiftAccountError } from '../core/riftaccount.js';
import { AccountService } from './accounts.js';
import { checkLauncherUpdate, downloadLauncherUpdate, type LauncherUpdate } from '../core/selfupdate.js';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

// Players behind a proxy (HTTPS_PROXY / HTTP_PROXY / NO_PROXY): downloads and sign-in go through it.
if (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy) setGlobalDispatcher(new EnvHttpProxyAgent());

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..', '..');
const config = JSON.parse(readFileSync(join(appRoot, 'config', 'app.json'), 'utf8')) as {
  apiBase: string; azureClientId: string; trustedManifestKeys: string[]; allowInsecureLocalApi: boolean;
};
const VERSION = app.getVersion();

let win: BrowserWindow | null = null;
let settingsStore: SettingsStore;
let settings: LauncherSettings;
let session: MinecraftSession | null = null;
let hardware: HardwareInfo | null = null;
let busy: AbortController | null = null;
let gameRunning = false;
let launcherUpdate: LauncherUpdate | null = null;
let localServer: LocalServer | null = null;
let accounts: AccountService;
function myServer(): LocalServer {
  if (!localServer || localServer.dir !== join(settings.installDir, 'server')) {
    localServer = new LocalServer(settings.installDir, join(settings.installDir, 'server'));
    localServer.on('line', (l: string) => send('server:line', l));
    localServer.on('state', (st: string) => send('server:state', st));
  }
  return localServer;
}
const serverOptions = () => ({ port: settings.serverPort, memoryMb: settings.serverMemoryMb, testMode: settings.testMode, motd: 'Spell and Iron Rift' });
let launcherDownload: AbortController | null = null;

const send = (ch: string, payload: unknown) => win?.webContents.send(ch, payload);
const logFile = () => join(app.getPath('userData'), 'logs', 'launcher.log');
async function log(line: string) {
  await fs.mkdir(dirname(logFile()), { recursive: true });
  await fs.appendFile(logFile(), `[${new Date().toISOString()}] ${line.replace(/accessToken\S*\s+\S+/g, 'accessToken ***')}\n`);
}

/** Microsoft refresh token, encrypted with the OS keychain (DPAPI / Keychain / libsecret). */
const vaultPath = () => join(app.getPath('userData'), 'account.bin');
async function saveRefreshToken(token: string | null) {
  if (!token) { await fs.rm(vaultPath(), { force: true }); return; }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS secure storage is unavailable; refusing to store the account token in plain text');
  await fs.writeFile(vaultPath(), safeStorage.encryptString(token));
}
async function loadRefreshToken(): Promise<string | null> {
  try { return safeStorage.decryptString(await fs.readFile(vaultPath())); } catch { return null; }
}

/** Values from Settings → Connection win over the built-in launcher/config/app.json. */
const clientId = () => settings.azureClientId || config.azureClientId;
let owner: EmbeddedBackend | null = null;
/** Owner mode: this launcher talks to the build server it runs itself; others use the address from settings. */
const apiBase = () => (owner ? owner.url : settings.apiBase || config.apiBase);
const isLoopback = (u: string) => { try { return ['127.0.0.1', 'localhost'].includes(new URL(u).hostname); } catch { return false; } };
/** Plain http is allowed only to this PC (the embedded build server). */
const insecureLocal = () => config.allowInsecureLocalApi || (!!owner && isLoopback(apiBase()));
/** Built-in keys, our own key in owner mode, and the key pinned on first contact with the configured server. */
function trustedKeys(): string[] {
  const pinned = settings.pinnedKeys?.[apiBase()];
  return [...config.trustedManifestKeys, ...(owner ? [owner.publicPem] : []), ...(pinned ? [pinned] : [])];
}
/** Trust on first use: the first manifest key a server shows is remembered; a later change is refused. */
async function ensurePinned() {
  if (owner || !backendConfigured() || settings.pinnedKeys?.[apiBase()] || config.trustedManifestKeys.length) return;
  const k = await fetchJson<{ publicPem: string; keyId: string }>(`${apiBase()}/api/public/key`, { retries: 1, timeoutMs: 10000 });
  if (!/^-----BEGIN PUBLIC KEY-----/.test(k.publicPem)) throw new Error('server returned no signing key');
  const expected = settings.expectedKeyIds?.[apiBase()];
  if (expected && expected !== k.keyId) throw Object.assign(new Error(`server key ${k.keyId} does not match the invite (${expected})`), { code: 'invite_key_mismatch' });
  settings.pinnedKeys = { ...(settings.pinnedKeys ?? {}), [apiBase()]: k.publicPem };
  await settingsStore.save(settings);
}
async function signedManifest() {
  await ensurePinned();
  return api().manifest(settings.channel);
}

async function startOwner() {
  if (owner) return owner;
  owner = await startEmbedded({
    dataDir: join(app.getPath('userData'), 'build-server'), port: settings.ownerPort,
    publicBaseUrl: settings.ownerPublicUrl || `http://127.0.0.1:${settings.ownerPort}`,
    mcHost: (settings.gameAddress || '127.0.0.1').split(':')[0]!, mcPort: Number((settings.gameAddress || '').split(':')[1] || settings.serverPort),
  });
  await log(`owner mode: build server on ${owner.url}, key ${owner.keyId}`);
  return owner;
}
/** In owner mode the server's guard mod asks this PC's build server who may play (key shared locally). */
async function writeGuardConfig() {
  if (!owner) return;
  const f = join(myServer().dir, 'config', 'spellironrift-guard.json');
  let cur: Record<string, unknown> = {};
  try { cur = JSON.parse(await fs.readFile(f, 'utf8')); } catch { /* first time */ }
  await fs.mkdir(dirname(f), { recursive: true });
  await fs.writeFile(f, JSON.stringify({ ...cur, apiBase: owner.url, serverKey: owner.serverKey }, null, 2));
}
async function stopOwner() { const o = owner; owner = null; await o?.close(); }

// ---- Cloudflare Tunnel: makes the build server reachable for friends (variant B)
const tunnel = new Tunnel(join(app.getPath('userData'), 'bin'));
tunnel.on('state', (st: string) => send('tunnel:state', st));
tunnel.on('url', async (url: string) => {
  // quick tunnels get a new address each start: download links in the manifest must follow it
  if (settings.tunnelMode !== 'quick' || settings.ownerPublicUrl === url) return;
  settings.ownerPublicUrl = url; await settingsStore.save(settings);
  if (owner) { await stopOwner(); await startOwner(); }
  send('tunnel:url', url);
});
const tokenPath = () => join(app.getPath('userData'), 'tunnel-token.bin');
async function loadTunnelToken(): Promise<string | null> {
  try { return safeStorage.decryptString(await fs.readFile(tokenPath())); } catch { return null; }
}
async function startTunnel() {
  await tunnel.start({ mode: settings.tunnelMode, localPort: settings.ownerPort, token: (await loadTunnelToken()) ?? undefined });
}
function tunnelState() {
  return { state: tunnel.state, url: settings.tunnelMode === 'quick' ? tunnel.url : settings.ownerPublicUrl || null, mode: settings.tunnelMode, auto: settings.tunnelAuto, log: tunnel.history().slice(-30) };
}
function inviteCode(): string | null {
  if (!owner || !settings.ownerPublicUrl.startsWith('https://')) return null;
  if (settings.tunnelMode === 'quick' && (tunnel.state !== 'running' || tunnel.url !== settings.ownerPublicUrl)) return null; // the address changes
  return encodeInvite({ api: settings.ownerPublicUrl, game: settings.gameAddress, keyId: owner.keyId });
}
async function ownerState() {
  return { enabled: settings.ownerMode, running: !!owner, url: owner?.url ?? null, panel: owner ? `${owner.url}/admin/` : null,
    keyId: owner?.keyId ?? null, hasOwner: owner ? await owner.hasOwner() : false, publicUrl: settings.ownerPublicUrl, gameAddress: settings.gameAddress, port: settings.ownerPort };
}
/** The built-in address is a placeholder until the project server is deployed. */
function backendConfigured(): boolean {
  if (owner) return true;
  try { const h = new URL(apiBase()).hostname; return !!h && !/(^|\.)example\.(org|com|net)$/.test(h); } catch { return false; }
}
function auth() { return new MicrosoftAuth(clientId()); }
function api() {
  if (!backendConfigured()) throw Object.assign(new Error('project server address is not set'), { code: 'no_backend' });
  return new RiftApi(apiBase());
}

/** The Minecraft profile last verified through Microsoft (the game is owned): allows offline play of versions. */
const ownerPath = () => join(app.getPath('userData'), 'owner.json');
async function rememberOwner(s: MinecraftSession) {
  await fs.writeFile(ownerPath(), JSON.stringify({ name: s.name, uuid: s.uuid, verifiedAt: new Date().toISOString() }));
}
async function loadOwner(): Promise<{ name: string; uuid: string; verifiedAt: string } | null> {
  try { const o = JSON.parse(await fs.readFile(ownerPath(), 'utf8')); return o?.name && o?.uuid ? o : null; } catch { return null; }
}

async function restoreSession(): Promise<void> {
  const rt = await loadRefreshToken();
  if (!rt) return;
  try {
    const t = await auth().refresh(rt);
    await saveRefreshToken(t.refreshToken);
    session = await auth().minecraftLogin(t.accessToken);
    await rememberOwner(session);
  } catch (e) {
    await log(`session restore failed: ${(e as Error).message}`);
    if (e instanceof AuthError && e.code === 'expired') await saveRefreshToken(null);
  }
}

async function ensureFreshSession(): Promise<MinecraftSession> {
  if (session && session.expiresAt > Date.now()) return session;
  await restoreSession();
  if (!session) throw new AuthError('expired');
  return session;
}

function publicSession() {
  return session ? { name: session.name, uuid: session.uuid, skin: session.skin ?? null } : null;
}

function errorPayload(e: unknown) {
  if (e instanceof RiftAccountError) return { code: `account.${e.code}`, message: e.reason ?? e.message };
  if (e instanceof AuthError) return { code: /client id is not configured/.test(e.message) ? 'auth.no_client' : `auth.${e.code}`, message: e.message };
  for (const c of ['owner_name', 'owner_password', 'owner_exists', 'invite_bad', 'invite_key_mismatch', 'tunnel_token', 'tunnel_platform']) if ((e as { code?: string })?.code === c) return { code: c, message: (e as Error).message };
  if ((e as { code?: string })?.code === 'no_backend') return { code: 'no_backend', message: (e as Error).message };
  if ((e as { code?: string })?.code === 'need_account') return { code: 'versions.need_account', message: (e as Error).message };
  const msg = (e as Error)?.message ?? String(e);
  if ((e as { code?: string })?.code === 'hash') return { code: 'download.hash', message: msg };
  if ((e as { code?: string })?.code === 'game_running') return { code: 'game.running', message: msg };
  for (const c of ['eula', 'server_running', 'server_missing', 'test_nick', 'no_world']) if ((e as { code?: string })?.code === c) return { code: `myserver.${c}`, message: msg };
  if (/ENOSPC/.test(msg)) return { code: 'disk.full', message: msg };
  if (/secure storage is unavailable/.test(msg)) return { code: 'secure_storage', message: msg };
  if (/fetch failed|network|ENOTFOUND|ECONNRE|timed? ?out/i.test(msg)) return { code: 'network', message: msg };
  if (/signature/.test(msg)) return { code: 'manifest.signature', message: msg };
  return { code: 'unknown', message: msg };
}

function handle<T>(channel: string, fn: (...args: any[]) => Promise<T>) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; } catch (e) { await log(`${channel}: ${(e as Error).stack ?? e}`); return { ok: false, error: errorPayload(e) }; }
  });
}

/** Starts the downloaded installer. Windows: the NSIS installer replaces the app; Linux AppImage: swap the file and restart. */
async function installLauncher(file: string): Promise<'restarting' | 'opened'> {
  if (process.platform === 'win32') {
    spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.quit(), 400);
    return 'restarting';
  }
  const appImage = process.env.APPIMAGE;
  if (process.platform === 'linux' && appImage) {
    const tmp = `${appImage}.new`;
    await fs.copyFile(file, tmp);
    await fs.chmod(tmp, 0o755);
    await fs.rename(tmp, appImage);
    app.relaunch({ execPath: appImage });
    setTimeout(() => app.exit(0), 200);
    return 'restarting';
  }
  await shell.openPath(file); // macOS disk image (drag to Applications) or a manual install
  return 'opened';
}

function testProfile() {
  if (!NICK_RE.test(settings.testNick)) throw Object.assign(new Error('pick a nickname for test mode'), { code: 'test_nick' });
  return { name: settings.testNick, uuid: offlineUuid(settings.testNick).replace(/-/g, ''), accessToken: '0', xuid: '0' };
}

function registerIpc() {
  handle('app:state', async () => {
    const st = await new GameManager(settings, trustedKeys()).updater.loadState();
    return { version: VERSION, settings, session: publicSession(), owner: await loadOwner(), backend: backendConfigured(), clientIdSet: /^[0-9a-f-]{36}$/i.test(clientId()) && !/^0{8}-/.test(clientId()), hardware, presets: Object.keys(GRAPHICS_PRESETS), installed: st, gameRunning, platform: process.platform, totalRamMb: Math.round(os.totalmem() / 1048576) };
  });

  handle('settings:save', async (patch: Partial<LauncherSettings>) => {
    const errs = validateSettings(patch, Math.round(os.totalmem() / 1048576));
    if (errs.length) throw new Error(`invalid settings: ${errs.join(', ')}`);
    const allowed: (keyof LauncherSettings)[] = ['memoryMb', 'javaPath', 'jvmArgs', 'width', 'height', 'fullscreen', 'preset', 'presetIsManual', 'language', 'channel', 'closeOnLaunch', 'installDir', 'azureClientId', 'apiBase', 'showSnapshots', 'serverMemoryMb', 'serverPort', 'ownerPort', 'ownerPublicUrl', 'gameAddress', 'tunnelMode', 'tunnelAuto'];
    for (const k of allowed) if (k in patch) (settings as any)[k] = (patch as any)[k];
    await settingsStore.save(settings);
    return settings;
  });

  handle('settings:pickDir', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('settings:pickJava', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: process.platform === 'win32' ? [{ name: 'Java', extensions: ['exe'] }] : [] });
    return r.canceled ? null : r.filePaths[0];
  });

  handle('auth:login', async () => {
    busy?.abort(); busy = new AbortController();
    const a = auth();
    const dc = await a.startDeviceCode();
    send('auth:code', { userCode: dc.userCode, verificationUri: dc.verificationUri, expiresIn: dc.expiresIn });
    const t = await a.pollDeviceCode(dc, busy.signal);
    session = await a.minecraftLogin(t.accessToken);
    await saveRefreshToken(t.refreshToken);
    await rememberOwner(session);
    return publicSession();
  });
  handle('auth:cancel', async () => { busy?.abort(); return true; });
  handle('auth:logout', async () => { session = null; await saveRefreshToken(null); return true; });

  handle('skin:upload', async (variant: 'classic' | 'slim') => {
    const s = await ensureFreshSession();
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (r.canceled) return null;
    await MicrosoftAuth.uploadSkin(s.accessToken, await fs.readFile(r.filePaths[0]!), variant);
    Object.assign(session!, await auth().profile(s.accessToken));
    return publicSession();
  });

  handle('server:status', () => api().status());
  // "My server": NeoForge server with the same build on this PC
  handle('myserver:state', async () => ({ state: await myServer().refreshState(), build: await myServer().installedBuild(), log: myServer().history(), port: settings.serverPort, testMode: settings.testMode, eulaAccepted: settings.eulaAccepted }));
  handle('myserver:install', async (eula: boolean) => {
    if (eula !== true) throw Object.assign(new Error('Minecraft EULA not accepted'), { code: 'eula' });
    if (!settings.eulaAccepted) { settings.eulaAccepted = true; await settingsStore.save(settings); }
    const gm = new GameManager(settings, trustedKeys(), insecureLocal(), apiBase());
    const manifest = gm.updater.accept(await signedManifest(), trustedKeys(), { allowHttp: insecureLocal() });
    const javaExe = await gm.javaExe(manifest.java.mojangComponent);
    await myServer().install(manifest, javaExe, serverOptions(), true, (done, total, detail) => send('progress', { stage: 'server', done, total, detail }));
    return true;
  });
  handle('myserver:start', async () => {
    const gm = new GameManager(settings, trustedKeys(), insecureLocal(), apiBase());
    const build = await myServer().installedBuild();
    if (!build) throw Object.assign(new Error('install the server first'), { code: 'server_missing' });
    await writeGuardConfig();
    await myServer().start(await gm.javaExe('java-runtime-delta'), serverOptions());
    return true;
  });
  handle('myserver:stop', async () => { await myServer().stop(); return true; });
  handle('myserver:restart', async () => {
    const gm = new GameManager(settings, trustedKeys(), insecureLocal(), apiBase());
    if (!(await myServer().installedBuild())) throw Object.assign(new Error('install the server first'), { code: 'server_missing' });
    await writeGuardConfig();
    await myServer().restart(await gm.javaExe('java-runtime-delta'), serverOptions());
    return true;
  });
  handle('myserver:status', async () => myServer().status(settings.serverPort));
  handle('myserver:backups', async () => myServer().backups.list());
  handle('myserver:backup', async () => {
    const b = await myServer().backups.create('manual');
    if (!b) throw Object.assign(new Error('no world yet: start the server once'), { code: 'no_world' });
    return myServer().backups.list();
  });
  handle('myserver:restore', async (name: string) => { await myServer().backups.restore(String(name)); return myServer().backups.list(); });
  handle('myserver:removeBackup', async (name: string) => { await myServer().backups.remove(String(name)); return myServer().backups.list(); });
  handle('myserver:openDir', async (what: 'server' | 'backups') => {
    const dir = what === 'backups' ? myServer().backups.dir : myServer().dir;
    await fs.mkdir(dir, { recursive: true });
    return shell.openPath(dir);
  });
  handle('myserver:command', async (text: string) => { myServer().command(String(text ?? '')); return true; });
  // launcher self-update: asked on every start, always optional
  handle('launcher:check', async () => {
    launcherUpdate = await checkLauncherUpdate(api(), VERSION, trustedKeys(), settings.language);
    return launcherUpdate ? { current: VERSION, version: launcherUpdate.version, notes: launcherUpdate.notes, size: launcherUpdate.file.size, publishedAt: launcherUpdate.publishedAt } : null;
  });
  handle('launcher:install', async () => {
    if (!launcherUpdate) throw new Error('no launcher update');
    if (gameRunning) throw Object.assign(new Error('close the game before updating the launcher'), { code: 'game_running' });
    launcherDownload = new AbortController();
    const file = await downloadLauncherUpdate(launcherUpdate, join(app.getPath('userData'), 'updates'), (done, total) => send('launcher:progress', { done, total }), launcherDownload.signal);
    await log(`launcher update ${VERSION} -> ${launcherUpdate.version} downloaded`);
    return installLauncher(file);
  });
  handle('launcher:cancel', async () => { launcherDownload?.abort(); return true; });
  handle('news:list', () => api().news(settings.language));

  handle('hw:detect', async (gpu: { vendorId?: number; renderer?: string; glVersion?: string }) => {
    hardware = await detectHardware(gpu);
    const rec = recommendPreset(hardware);
    return { hardware, recommended: rec, recommendedHeapMb: recommendHeapMb(hardware.totalRamMb) };
  });

  handle('pack:check', async () => {
    const signed = await signedManifest();
    const gm = new GameManager(settings, trustedKeys(), insecureLocal());
    const m = gm.updater.accept(signed, trustedKeys(), { allowHttp: insecureLocal() });
    const preset = currentPreset();
    const plan = await gm.updater.plan(m, preset);
    return { version: m.version, buildId: m.buildId, changelog: m.changelog ?? {}, downloadBytes: plan.downloadBytes, changes: plan.write.length + plan.remove.length };
  });

  handle('game:play', async () => {
    if (gameRunning) throw new Error('game already running');
    // Test mode plays with a nickname on the server on this PC; otherwise a Microsoft account is required.
    const s = settings.testMode ? testProfile() : await ensureFreshSession();
    // The project account must be signed in, active and linked to this Minecraft profile (verified by Mojang).
    if (!settings.testMode) await accounts.readyToPlay({ name: s.name, uuid: s.uuid, accessToken: s.accessToken });
    busy?.abort(); busy = new AbortController();
    const signed: SignedManifest = await signedManifest();
    const gm = new GameManager(settings, trustedKeys(), insecureLocal(), apiBase());
    const fromGame = await gm.inGamePresetRequest();
    if (fromGame && fromGame !== settings.preset) { settings.preset = fromGame; settings.presetIsManual = true; await settingsStore.save(settings); }
    const { versionId, javaExe } = await gm.prepare(signed, currentPreset(), (p) => send('progress', p), busy.signal);
    send('progress', { stage: 'launch', done: 0, total: 1 });
    const child = await gm.launch(versionId, javaExe, { name: s.name, uuid: s.uuid, accessToken: s.accessToken, xuid: s.xuid }, (l) => { void log(`[game] ${l}`); }, VERSION, clientId());
    gameRunning = true;
    send('game:state', { running: true });
    if (settings.closeOnLaunch) win?.hide();
    child.on('exit', (code) => {
      gameRunning = false;
      send('game:state', { running: false, exitCode: code });
      win?.show();
    });
    return true;
  });
  handle('game:cancel', async () => { busy?.abort(); return true; });
  handle('game:repair', async () => {
    const gm = new GameManager(settings, trustedKeys(), insecureLocal());
    return gm.updater.repair((p) => send('progress', { stage: 'pack', done: p.doneBytes, total: p.totalBytes, detail: p.phase }));
  });
  handle('game:rollback', async () => {
    const gm = new GameManager(settings, trustedKeys(), insecureLocal());
    return gm.updater.rollback((p) => send('progress', { stage: 'pack', done: p.doneBytes, total: p.totalBytes, detail: p.phase }));
  });
  // ---- Versions: any Minecraft version from Mojang, played with the Microsoft account (or offline by its owner)
  let versionCache: { at: number; data: Awaited<ReturnType<VersionLibrary['available']>> } | null = null;
  handle('versions:list', async () => {
    const lib = new VersionLibrary(settings);
    if (!versionCache || Date.now() - versionCache.at > 10 * 60_000) versionCache = { at: Date.now(), data: await lib.available() };
    return { ...versionCache.data, installed: await lib.installed() };
  });
  handle('versions:install', async (id: string) => {
    busy?.abort(); busy = new AbortController();
    const lib = new VersionLibrary(settings);
    await lib.install(id, (p) => send('progress', p), busy.signal);
    await lib.java(id, (p) => send('progress', p), busy.signal);
    return lib.installed();
  });
  handle('versions:remove', async (id: string, withWorlds: boolean) => {
    if (gameRunning) throw Object.assign(new Error('game is running'), { code: 'game_running' });
    const lib = new VersionLibrary(settings);
    await lib.remove(id, !!withWorlds);
    return lib.installed();
  });
  handle('versions:openDir', async (id: string) => {
    const dir = new VersionLibrary(settings).gameDir(id);
    await fs.mkdir(dir, { recursive: true });
    return shell.openPath(dir);
  });
  handle('versions:play', async (id: string, offline: boolean) => {
    if (gameRunning) throw Object.assign(new Error('game already running'), { code: 'game_running' });
    let profile: { name: string; uuid: string; accessToken: string; xuid: string; userType: 'msa' | 'legacy' };
    if (offline) {
      // offline only for the owner of the game: the profile Microsoft confirmed earlier on this PC
      const o = await loadOwner();
      if (!o) throw Object.assign(new Error('sign in with Microsoft once to play offline'), { code: 'need_account' });
      profile = { name: o.name, uuid: o.uuid, accessToken: '0', xuid: '0', userType: 'legacy' };
    } else {
      const s = await ensureFreshSession().catch(() => null);
      if (!s) throw Object.assign(new Error('sign in with Microsoft to play'), { code: 'need_account' });
      profile = { name: s.name, uuid: s.uuid, accessToken: s.accessToken, xuid: s.xuid, userType: 'msa' };
    }
    busy?.abort(); busy = new AbortController();
    const child = await new VersionLibrary(settings).play(id, profile, (l) => { void log(`[game ${id}] ${l}`); }, VERSION, clientId(), (p) => send('progress', p), busy.signal);
    gameRunning = true;
    send('game:state', { running: true });
    if (settings.closeOnLaunch) win?.hide();
    child.on('exit', (code) => { gameRunning = false; send('game:state', { running: false, exitCode: code }); win?.show(); });
    return true;
  });

  // ---- Owner mode: build server + admin panel on this PC
  handle('owner:state', ownerState);
  handle('owner:enable', async () => {
    settings.ownerMode = true; await settingsStore.save(settings);
    await startOwner();
    if (settings.tunnelAuto) await startTunnel().catch((e) => log(`tunnel: ${(e as Error).message}`));
    return ownerState();
  });
  handle('owner:disable', async () => { settings.ownerMode = false; await settingsStore.save(settings); await tunnel.stop(); await stopOwner(); return ownerState(); });
  handle('owner:restart', async () => { await stopOwner(); await startOwner(); return ownerState(); });
  handle('owner:create', async (username: string, password: string) => {
    if (!owner) throw new Error('owner mode is off');
    await owner.createOwner(String(username ?? '').trim(), String(password ?? ''));
    return ownerState();
  });
  handle('tunnel:state', async () => tunnelState());
  handle('tunnel:start', async () => { await startTunnel(); return tunnelState(); });
  handle('tunnel:stop', async () => { await tunnel.stop(); return tunnelState(); });
  handle('tunnel:setToken', async (token: string) => {
    const tk = String(token ?? '').trim();
    if (!tk) { await fs.rm(tokenPath(), { force: true }); return true; }
    if (!/^[A-Za-z0-9_\-=.]{40,}$/.test(tk)) throw Object.assign(new Error('this does not look like a tunnel token'), { code: 'tunnel_token' });
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS secure storage is unavailable; refusing to store the tunnel token in plain text');
    await fs.writeFile(tokenPath(), safeStorage.encryptString(tk));
    return true;
  });
  handle('conn:invite', async () => inviteCode());
  handle('conn:applyInvite', async (code: string) => {
    const inv = decodeInvite(String(code ?? ''));
    settings.apiBase = inv.api;
    if (inv.game) settings.gameAddress = inv.game;
    settings.expectedKeyIds = { ...(settings.expectedKeyIds ?? {}), [inv.api]: inv.keyId };
    const pk = { ...(settings.pinnedKeys ?? {}) }; delete pk[inv.api]; settings.pinnedKeys = pk;
    await settingsStore.save(settings);
    await ensurePinned();
    return settings;
  });
  /** Is the build reachable through its public address, and does the game answer at its public address? */
  handle('conn:check', async () => {
    const publicApi = owner ? settings.ownerPublicUrl : apiBase();
    const out: { build: { ok: boolean; detail: string }; game: { ok: boolean; detail: string; players?: number; max?: number } } = { build: { ok: false, detail: 'not set' }, game: { ok: false, detail: 'not set' } };
    if (publicApi && /^https?:\/\//.test(publicApi) && !isLoopback(publicApi)) {
      try {
        const k = await fetchJson<{ keyId: string }>(`${publicApi.replace(/\/$/, '')}/api/public/key`, { retries: 0, timeoutMs: 10000 });
        const want = owner?.keyId ?? settings.expectedKeyIds?.[publicApi] ?? null;
        out.build = { ok: !want || k.keyId === want, detail: want && k.keyId !== want ? `key ${k.keyId} ≠ ${want}` : `key ${k.keyId}` };
      } catch (e) { out.build = { ok: false, detail: (e as Error).message }; }
    }
    if (settings.gameAddress) {
      const [host, port] = settings.gameAddress.split(':');
      const p = await slpPing(host!, Number(port || 25565), 6000);
      out.game = p.online ? { ok: true, detail: p.version ?? '', players: p.players, max: p.maxPlayers } : { ok: false, detail: 'no answer' };
    }
    return out;
  });
  handle('owner:openPanel', async () => {
    if (!owner) throw new Error('owner mode is off');
    await shell.openExternal(`${owner.url}/admin/`);
    return true;
  });
  handle('conn:resetKey', async () => {
    const pk = { ...(settings.pinnedKeys ?? {}) }; delete pk[apiBase()];
    settings.pinnedKeys = pk; await settingsStore.save(settings);
    return true;
  });

  handle('shell:openGameDir', async () => { await fs.mkdir(join(settings.installDir, 'game'), { recursive: true }); return shell.openPath(join(settings.installDir, 'game')); });
  handle('shell:openLogs', async () => shell.openPath(dirname(logFile())));
  handle('shell:openUrl', async (url: string) => {
    const u = new URL(url);
    const allowed = ['microsoft.com', 'live.com', 'minecraft.net', ...(backendConfigured() ? [new URL(apiBase()).hostname] : []), 'mojang.com', 'learn.microsoft.com', 'portal.azure.com', 'entra.microsoft.com'];
    allowed.push('playit.gg', 'cloudflare.com', 'github.com');
    if (u.protocol !== 'https:' || !allowed.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))) throw new Error('blocked url');
    await shell.openExternal(u.toString());
    return true;
  });
  ipcMain.on('window:control', (_e, action: 'min' | 'max' | 'close') => {
    if (action === 'min') win?.minimize();
    if (action === 'max') win?.isMaximized() ? win.unmaximize() : win?.maximize();
    if (action === 'close') win?.close();
  });
}

function currentPreset(): GraphicsPresetId {
  return settings.preset ?? (hardware ? recommendPreset(hardware).preset : 'balanced');
}

let tray: Tray | null = null;
let quitting = false;
function ensureTray() {
  if (tray) return;
  tray = new Tray(nativeImage.createFromPath(join(appRoot, 'assets', 'icon.png')).resize({ width: 16, height: 16 }));
  tray.setToolTip('Spell and Iron Rift — сервер работает');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть лаунчер', click: () => { win?.show(); win?.focus(); } },
    { label: 'Остановить сервер и выйти', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => { win?.show(); win?.focus(); });
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 780, minWidth: 1100, minHeight: 680, frame: false, backgroundColor: '#0c0b10', show: false,
    icon: join(appRoot, 'assets', 'icon.png'),
    webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.once('ready-to-show', () => win?.show());
  // Closing the window while "My server" runs keeps the launcher in the tray, so the server is not cut off.
  win.on('close', (e) => {
    if (quitting || !localServer || !['running', 'starting'].includes(localServer.state)) return;
    e.preventDefault();
    win?.hide();
    ensureTray();
  });
  await win.loadFile(join(appRoot, 'renderer', 'index.html'));
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { win?.show(); win?.focus(); });
app.whenReady().then(async () => {
  settingsStore = new SettingsStore(join(app.getPath('userData'), 'settings.json'), defaultSettings(app.getPath('appData'), Math.round(os.totalmem() / 1048576)));
  settings = await settingsStore.load();
  registerIpc();
  if (settings.ownerMode) {
    await startOwner().catch((e) => log(`owner mode failed to start: ${(e as Error).stack ?? e}`));
    if (owner && settings.tunnelAuto) void startTunnel().catch((e) => log(`tunnel: ${(e as Error).message}`));
  }
  accounts = new AccountService({ apiBase: () => (backendConfigured() ? apiBase() : ''), allowInsecureLocal: insecureLocal, userData: app.getPath('userData'), handle, send, log });
  accounts.register();
  await accounts.restore();
  await createWindow();
  void restoreSession().then(() => send('auth:session', publicSession()));
});
app.on('window-all-closed', () => { if (!gameRunning) app.quit(); });
// Stop "My server" properly on exit so the world is saved.
let stoppingServer = false;
app.on('will-quit', () => { void tunnel.stop(); });
app.on('before-quit', (e) => {
  if (!localServer || stoppingServer || !['running', 'starting'].includes(localServer.state)) return;
  e.preventDefault();
  stoppingServer = true;
  void localServer.stop().finally(() => app.quit());
});
