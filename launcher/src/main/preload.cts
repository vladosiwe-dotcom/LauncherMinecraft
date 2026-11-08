// Preload runs in an isolated, sandboxed context and exposes a narrow, typed API to the UI.
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch: string, ...a: unknown[]) => ipcRenderer.invoke(ch, ...a);
const on = (ch: string) => (cb: (p: unknown) => void) => {
  const l = (_e: unknown, p: unknown) => cb(p);
  ipcRenderer.on(ch, l);
  return () => ipcRenderer.removeListener(ch, l);
};

contextBridge.exposeInMainWorld('sir', {
  state: () => invoke('app:state'),
  saveSettings: (patch: unknown) => invoke('settings:save', patch),
  pickDir: () => invoke('settings:pickDir'),
  pickJava: () => invoke('settings:pickJava'),
  login: () => invoke('auth:login'),
  cancelLogin: () => invoke('auth:cancel'),
  logout: () => invoke('auth:logout'),
  uploadSkin: (variant: 'classic' | 'slim') => invoke('skin:upload', variant),
  serverStatus: () => invoke('server:status'),
  myServer: () => invoke('myserver:state'),
  installMyServer: (eula: boolean) => invoke('myserver:install', eula),
  startMyServer: () => invoke('myserver:start'),
  stopMyServer: () => invoke('myserver:stop'),
  serverCommand: (text: string) => invoke('myserver:command', text),
  onServerLine: on('server:line'),
  onServerState: on('server:state'),
  checkLauncherUpdate: () => invoke('launcher:check'),
  installLauncherUpdate: () => invoke('launcher:install'),
  cancelLauncherUpdate: () => invoke('launcher:cancel'),
  onLauncherProgress: on('launcher:progress'),
  news: () => invoke('news:list'),
  detectHardware: (gpu: unknown) => invoke('hw:detect', gpu),
  checkUpdate: () => invoke('pack:check'),
  play: () => invoke('game:play'),
  cancel: () => invoke('game:cancel'),
  repair: () => invoke('game:repair'),
  rollback: () => invoke('game:rollback'),
  openGameDir: () => invoke('shell:openGameDir'),
  openLogs: () => invoke('shell:openLogs'),
  openUrl: (u: string) => invoke('shell:openUrl', u),
  window: (a: 'min' | 'max' | 'close') => ipcRenderer.send('window:control', a),
  onProgress: on('progress'),
  onAuthCode: on('auth:code'),
  onSession: on('auth:session'),
  onGameState: on('game:state'),
});
