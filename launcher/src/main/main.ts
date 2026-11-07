import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
import { promises as fs, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRAPHICS_PRESETS, recommendPreset, recommendHeapMb, type GraphicsPresetId, type HardwareInfo, type SignedManifest } from '@sir/shared';
import { RiftApi } from '../core/api.js';
import { AuthError, MicrosoftAuth, type MinecraftSession } from '../core/auth.js';
import { GameManager } from '../core/game.js';
import { SettingsStore, defaultSettings, validateSettings, type LauncherSettings } from '../core/settings.js';
import { detectHardware } from '../core/sysinfo.js';
import os from 'node:os';

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

function auth() { return new MicrosoftAuth(config.azureClientId); }
function api() { return new RiftApi(config.apiBase); }

async function restoreSession(): Promise<void> {
  const rt = await loadRefreshToken();
  if (!rt) return;
  try {
    const t = await auth().refresh(rt);
    await saveRefreshToken(t.refreshToken);
    session = await auth().minecraftLogin(t.accessToken);
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
  if (e instanceof AuthError) return { code: `auth.${e.code}`, message: e.message };
  const msg = (e as Error)?.message ?? String(e);
  if ((e as { code?: string })?.code === 'hash') return { code: 'download.hash', message: msg };
  if (/ENOSPC/.test(msg)) return { code: 'disk.full', message: msg };
  if (/fetch failed|network|ENOTFOUND|ECONNRE|timed? ?out/i.test(msg)) return { code: 'network', message: msg };
  if (/signature/.test(msg)) return { code: 'manifest.signature', message: msg };
  return { code: 'unknown', message: msg };
}

function handle<T>(channel: string, fn: (...args: any[]) => Promise<T>) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; } catch (e) { await log(`${channel}: ${(e as Error).stack ?? e}`); return { ok: false, error: errorPayload(e) }; }
  });
}

function registerIpc() {
  handle('app:state', async () => {
    const st = await new GameManager(settings, config.trustedManifestKeys).updater.loadState();
    return { version: VERSION, settings, session: publicSession(), hardware, presets: Object.keys(GRAPHICS_PRESETS), installed: st, gameRunning, platform: process.platform, totalRamMb: Math.round(os.totalmem() / 1048576) };
  });

  handle('settings:save', async (patch: Partial<LauncherSettings>) => {
    const errs = validateSettings(patch, Math.round(os.totalmem() / 1048576));
    if (errs.length) throw new Error(`invalid settings: ${errs.join(', ')}`);
    const allowed: (keyof LauncherSettings)[] = ['memoryMb', 'javaPath', 'jvmArgs', 'width', 'height', 'fullscreen', 'preset', 'presetIsManual', 'language', 'channel', 'closeOnLaunch', 'installDir'];
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
  handle('news:list', () => api().news(settings.language));

  handle('hw:detect', async (gpu: { vendorId?: number; renderer?: string; glVersion?: string }) => {
    hardware = await detectHardware(gpu);
    const rec = recommendPreset(hardware);
    return { hardware, recommended: rec, recommendedHeapMb: recommendHeapMb(hardware.totalRamMb) };
  });

  handle('pack:check', async () => {
    const signed = await api().manifest(settings.channel);
    const gm = new GameManager(settings, config.trustedManifestKeys, config.allowInsecureLocalApi);
    const m = gm.updater.accept(signed, config.trustedManifestKeys, { allowHttp: config.allowInsecureLocalApi });
    const preset = currentPreset();
    const plan = await gm.updater.plan(m, preset);
    return { version: m.version, buildId: m.buildId, changelog: m.changelog ?? {}, downloadBytes: plan.downloadBytes, changes: plan.write.length + plan.remove.length };
  });

  handle('game:play', async () => {
    if (gameRunning) throw new Error('game already running');
    const s = await ensureFreshSession();
    busy?.abort(); busy = new AbortController();
    const signed: SignedManifest = await api().manifest(settings.channel);
    const gm = new GameManager(settings, config.trustedManifestKeys, config.allowInsecureLocalApi, config.apiBase);
    const fromGame = await gm.inGamePresetRequest();
    if (fromGame && fromGame !== settings.preset) { settings.preset = fromGame; settings.presetIsManual = true; await settingsStore.save(settings); }
    const { versionId, javaExe } = await gm.prepare(signed, currentPreset(), (p) => send('progress', p), busy.signal);
    send('progress', { stage: 'launch', done: 0, total: 1 });
    const child = await gm.launch(versionId, javaExe, { name: s.name, uuid: s.uuid, accessToken: s.accessToken, xuid: s.xuid }, (l) => { void log(`[game] ${l}`); }, VERSION, config.azureClientId);
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
    const gm = new GameManager(settings, config.trustedManifestKeys, config.allowInsecureLocalApi);
    return gm.updater.repair((p) => send('progress', { stage: 'pack', done: p.doneBytes, total: p.totalBytes, detail: p.phase }));
  });
  handle('game:rollback', async () => {
    const gm = new GameManager(settings, config.trustedManifestKeys, config.allowInsecureLocalApi);
    return gm.updater.rollback((p) => send('progress', { stage: 'pack', done: p.doneBytes, total: p.totalBytes, detail: p.phase }));
  });
  handle('shell:openGameDir', async () => { await fs.mkdir(join(settings.installDir, 'game'), { recursive: true }); return shell.openPath(join(settings.installDir, 'game')); });
  handle('shell:openLogs', async () => shell.openPath(dirname(logFile())));
  handle('shell:openUrl', async (url: string) => {
    const u = new URL(url);
    const allowed = ['microsoft.com', 'live.com', 'minecraft.net', new URL(config.apiBase).hostname];
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

async function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 780, minWidth: 1100, minHeight: 680, frame: false, backgroundColor: '#0c0b10', show: false,
    webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.once('ready-to-show', () => win?.show());
  await win.loadFile(join(appRoot, 'renderer', 'index.html'));
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { win?.show(); win?.focus(); });
app.whenReady().then(async () => {
  settingsStore = new SettingsStore(join(app.getPath('userData'), 'settings.json'), defaultSettings(app.getPath('appData'), Math.round(os.totalmem() / 1048576)));
  settings = await settingsStore.load();
  registerIpc();
  await createWindow();
  void restoreSession().then(() => send('auth:session', publicSession()));
});
app.on('window-all-closed', () => { if (!gameRunning) app.quit(); });
