// When the UI is opened in a plain browser (design preview), there is no Electron bridge.
// This stub stands in with clearly labelled sample data and simulated progress. It never runs inside the real launcher.
(() => {
  if (window.sir) return;
  document.documentElement.classList.add('demo');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ok = (data) => ({ ok: true, data });
  const listeners = { progress: [], 'auth:code': [], session: [], game: [], 'launcher:progress': [], 'server:line': [], 'server:state': [] };
  const demoSrv = { state: 'not_installed', build: null, log: [] };
  const emit = (k, p) => listeners[k].forEach((f) => f(p));
  let session = { name: 'Ardent_Vex', uuid: '5c1f2a9e8d7b4c3aa1e0f9d8c7b6a5f4', skin: null };
  const settings = { installDir: 'C:\\Users\\Player\\AppData\\Roaming\\SpellAndIronRift', memoryMb: 6144, javaPath: null, jvmArgs: '', width: 1600, height: 900, fullscreen: false, preset: null, presetIsManual: false, language: 'ru', channel: 'stable', closeOnLaunch: false };
  const installed = { buildId: 'b-0007', version: '0.3.1', preset: 'high', files: [], history: ['b-0006', 'b-0007'] };
  const news = {
    ru: [
      { id: '1', tag: 'update', date: '2026-11-05', title: 'Сборка 0.3.2: Цитадель Пепла', body: 'Новый данж с боссом Игнисом, переработанные школы огня и льда, 14 исправлений баланса заклинаний.' },
      { id: '2', tag: 'event', date: '2026-11-02', title: 'Ночь Разлома — 9 ноября, 20:00', body: 'Серверное событие: разломы открываются по всему миру. Награды — редкие свитки и руны.' },
      { id: '3', tag: 'maintenance', date: '2026-10-29', title: 'Плановые работы 30 октября', body: 'Сервер будет недоступен с 06:00 до 07:00 (Киев). Перенос мира на новые диски.' },
      { id: '4', tag: 'news', date: '2026-10-20', title: 'Открыт набор в гильдию Хранителей', body: 'Помогайте новичкам и следите за порядком на сервере. Заявки — в Discord.' },
    ],
  };
  news.uk = news.ru.map((n, i) => ({ ...n, title: ['Збірка 0.3.2: Цитадель Попелу', 'Ніч Розлому — 9 листопада, 20:00', 'Планові роботи 30 жовтня', 'Відкрито набір до гільдії Хранителів'][i], body: ['Новий данж із босом Ігнісом, перероблені школи вогню та льоду, 14 виправлень балансу заклять.', 'Серверна подія: розломи відкриваються по всьому світу. Нагороди — рідкісні сувої та руни.', 'Сервер буде недоступний з 06:00 до 07:00 (Київ). Перенесення світу на нові диски.', 'Допомагайте новачкам і стежте за порядком на сервері. Заявки — у Discord.'][i] }));
  news.en = news.ru.map((n, i) => ({ ...n, title: ['Build 0.3.2: Citadel of Ash', 'Rift Night — Nov 9, 20:00', 'Scheduled maintenance Oct 30', 'Wardens guild is recruiting'][i], body: ['A new dungeon with the boss Ignis, reworked fire and ice schools, 14 spell balance fixes.', 'Server event: rifts open across the world. Rewards: rare scrolls and runes.', 'The server is offline 06:00–07:00 (Kyiv) while the world moves to new disks.', 'Help newcomers and keep order on the server. Apply on Discord.'][i] }));

  window.sir = {
    demo: true,
    state: async () => ok({ version: '0.1.0', settings, session, hardware: null, presets: ['minimal', 'balanced', 'high', 'ultra'], installed, gameRunning: false, platform: 'win32', totalRamMb: 16384 }),
    saveSettings: async (p) => { Object.assign(settings, p); return ok(settings); },
    pickDir: async () => ok('D:\\Games\\SpellAndIronRift'),
    pickJava: async () => ok('C:\\Program Files\\Java\\jdk-21\\bin\\javaw.exe'),
    login: async () => { emit('auth:code', { userCode: 'RQ7K-M2XW', verificationUri: 'https://www.microsoft.com/link', expiresIn: 900 }); await wait(3500); session = { name: 'Ardent_Vex', uuid: '5c1f2a9e8d7b4c3aa1e0f9d8c7b6a5f4', skin: null }; return ok(session); },
    cancelLogin: async () => ok(true),
    logout: async () => { session = null; return ok(true); },
    uploadSkin: async () => ok(session),
    serverStatus: async () => { await wait(300); return ok({ online: true, players: 137, maxPlayers: 300, motd: 'Spell and Iron Rift', latencyMs: 34, checkedAt: new Date().toISOString() }); },
    news: async () => { await wait(200); return ok(news[settings.language] || news.ru); },
    detectHardware: async () => ok({ hardware: { cpuModel: 'AMD Ryzen 7 5800X 8-Core Processor', cpuThreads: 16, totalRamMb: 16384, gpuName: 'NVIDIA GeForce RTX 3060', gpuVendor: 'nvidia', vramMb: 12288, glVersion: 4.6 }, recommended: { preset: 'high', reasons: ['mid_range_discrete'] }, recommendedHeapMb: 6144 }),
    myServer: async () => ok({ state: demoSrv.state, build: demoSrv.build, log: demoSrv.log, port: 25565 }),
    installMyServer: async () => { demoSrv.state = 'installing'; for (let i = 1; i <= 10; i++) { await wait(120); emit('progress', { stage: 'server', done: i, total: 10 }); } demoSrv.build = 'b-0008'; demoSrv.state = 'stopped'; return ok(true); },
    startMyServer: async () => { demoSrv.state = 'starting'; emit('server:state', 'starting'); for (const l of ['[Server thread/INFO]: Starting minecraft server version 1.21.1', '[Server thread/INFO]: Loading 64 mods', '[Server thread/INFO]: Preparing level "world"', '[Server thread/INFO]: Done (8.412s)! For help, type "help"']) { await wait(500); demoSrv.log.push(l); emit('server:line', l); } demoSrv.state = 'running'; emit('server:state', 'running'); return ok(true); },
    stopMyServer: async () => { demoSrv.state = 'stopping'; emit('server:state', 'stopping'); await wait(800); demoSrv.state = 'stopped'; emit('server:state', 'stopped'); return ok(true); },
    serverCommand: async (c) => { const l = c === 'list' ? '[Server thread/INFO]: There are 0 of a max of 20 players online:' : `[Server thread/INFO]: Unknown or incomplete command: ${c}`; demoSrv.log.push(`> ${c}`, l); emit('server:line', `> ${c}`); emit('server:line', l); return ok(true); },
    onServerLine: (f) => (listeners['server:line'].push(f), () => {}),
    onServerState: (f) => (listeners['server:state'].push(f), () => {}),
    checkLauncherUpdate: async () => { await wait(600); return ok({ current: '0.1.0', version: '0.2.0', size: 92_400_000, publishedAt: new Date().toISOString(), notes: '• Новое главное меню в игре: разлом и полёт в него при входе\n• Иконка и логотип в новом стиле\n• Лаунчер сам предлагает обновиться' }); },
    installLauncherUpdate: async () => { for (let i = 1; i <= 20; i++) { await wait(90); emit('launcher:progress', { done: i * 4_620_000, total: 92_400_000 }); } return ok('opened'); },
    cancelLauncherUpdate: async () => ok(true),
    onLauncherProgress: (f) => (listeners['launcher:progress'].push(f), () => { listeners['launcher:progress'] = listeners['launcher:progress'].filter((x) => x !== f); }),
    checkUpdate: async () => ok({ version: '0.3.2', buildId: 'b-0008', changelog: {}, downloadBytes: 187_400_000, changes: 9 }),
    play: async () => {
      const stages = [['pack', 187_400_000, 40], ['launch', 1, 6]];
      for (const [stage, total, n] of stages) for (let i = 0; i <= n; i++) { emit('progress', { stage, done: Math.round((total * i) / n), total, detail: stage === 'pack' ? ['irons_spellbooks-1.21.1-3.9.2.jar', 'L_Enders_Cataclysm-2.36-1.21.1.jar', 'rift-ui-0.3.2.zip'][i % 3] : '' }); await wait(90); }
      installed.version = '0.3.2'; installed.buildId = 'b-0008';
      emit('game', { running: true }); await wait(2500); emit('game', { running: false, exitCode: 0 });
      return ok(true);
    },
    cancel: async () => ok(true),
    repair: async () => { for (let i = 0; i <= 20; i++) { emit('progress', { stage: 'pack', done: i, total: 20, detail: 'verify' }); await wait(60); } return ok(1); },
    rollback: async () => ok('b-0006'),
    openGameDir: async () => ok(''), openLogs: async () => ok(''), openUrl: async () => ok(true),
    window: () => {},
    onProgress: (f) => (listeners.progress.push(f), () => {}),
    onAuthCode: (f) => (listeners['auth:code'].push(f), () => {}),
    onSession: (f) => (listeners.session.push(f), () => {}),
    onGameState: (f) => (listeners.game.push(f), () => {}),
  };
})();
