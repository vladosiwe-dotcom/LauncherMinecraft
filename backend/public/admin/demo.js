// In-browser stand-in for the Rift Control API, used only when the panel is opened outside the backend
// (design preview). Sample data, clearly labelled by the demo banner. The real panel lives at /admin on the backend.
(() => {
  if (location.pathname.startsWith('/admin/') && !window.RIFT_FORCE_DEMO) return;
  const now = Date.now();
  const iso = (msAgo) => new Date(now - msAgo).toISOString();
  const H = 3600e3, D = 24 * H;
  const dep = (modId, versionRange = '*', type = 'required', side = 'BOTH') => ({ modId, versionRange, type, side });
  const mod = (id, fileName, name, modId, version, size, deps = [], extra = {}) => ({ id, sha256: id.padEnd(64, '0'), size, fileName, category: 'mod', name, version, uploadedAt: iso(extra.ago ?? 6 * D), uploadedBy: extra.by ?? 'Morwen', mod: { modId, displayName: name, version, loader: 'neoforge', dependencies: [dep('minecraft', '[1.21.1,1.22)'), dep('neoforge', '[21.1.0,)'), ...deps], clientOnlyHint: !!extra.client }, errors: extra.errors ?? [], warnings: extra.warnings ?? [] });
  const db = {
    users: [
      { id: 'u1', username: 'owner', role: 'owner', createdAt: iso(90 * D), lastLoginAt: iso(5 * 60e3) },
      { id: 'u2', username: 'Morwen', role: 'admin', createdAt: iso(60 * D), lastLoginAt: iso(3 * H) },
      { id: 'u3', username: 'Kestrel', role: 'moderator', createdAt: iso(20 * D), lastLoginAt: iso(1 * D) },
    ],
    library: [
      mod('a1', 'irons_spellbooks-1.21.1-3.9.2.jar', "Iron's Spells 'n Spellbooks", 'irons_spellbooks', '1.21.1-3.9.2', 21_400_000, [dep('geckolib', '[4.7,)'), dep('curios', '[9.0,)'), dep('playeranimator', '[2.0,)')]),
      mod('a2', 'L_Enders_Cataclysm-2.60-1.21.1.jar', "L_Ender's Cataclysm", 'cataclysm', '2.60', 48_900_000, [dep('lionfishapi', '[2.4,)')]),
      mod('a3', 'geckolib-neoforge-1.21.1-4.7.3.jar', 'GeckoLib', 'geckolib', '4.7.3', 1_300_000),
      mod('a4', 'curios-neoforge-9.2.2+1.21.1.jar', 'Curios API', 'curios', '9.2.2', 540_000),
      mod('a5', 'player-animation-lib-forge-2.0.1+1.21.1.jar', 'Player Animator', 'playeranimator', '2.0.1', 210_000),
      mod('a6', 'lionfishapi-2.4-1.21.1.jar', 'Lionfish API', 'lionfishapi', '2.4', 320_000),
      mod('a7', 'spellironrift-core-0.3.2.jar', 'Spell and Iron Rift Core', 'spellironrift', '0.3.2', 410_000, [], { client: true, by: 'owner', ago: 2 * D }),
      mod('a8', 'iris-neoforge-1.8.8+mc1.21.1.jar', 'Iris', 'iris', '1.8.8', 2_900_000, [], { client: true }),
      mod('a9', 'jei-1.21.1-neoforge-19.21.0.jar', 'Just Enough Items', 'jei', '19.21.0', 1_600_000),
      mod('a10', 'sodium-fabric-0.6.5+mc1.21.1.jar', 'sodium-fabric-0.6.5+mc1.21.1.jar', '?', '?', 1_100_000, [], { errors: ['fabric_mod'], ago: 1 * D }),
      { id: 'r1', sha256: 'r1'.padEnd(64, '0'), size: 7_800_000, fileName: 'rift-ui-0.3.2.zip', category: 'resourcepack', name: 'Rift UI', version: '34', uploadedAt: iso(2 * D), uploadedBy: 'owner', pack: { format: 34, description: 'Spell and Iron Rift interface' }, errors: [], warnings: [] },
      { id: 's1', sha256: 's1'.padEnd(64, '0'), size: 2_100_000, fileName: 'ComplementaryReimagined_r5.4.zip', category: 'shaderpack', name: 'ComplementaryReimagined_r5.4', version: '1', uploadedAt: iso(9 * D), uploadedBy: 'Morwen', errors: [], warnings: [] },
      { id: 'c1', sha256: 'c1'.padEnd(64, '0'), size: 4_200, fileName: 'irons_spellbooks-server.toml', category: 'config', name: 'irons_spellbooks-server.toml', version: '1', uploadedAt: iso(3 * D), uploadedBy: 'Morwen', errors: [], warnings: [] },
    ],
    builds: [], published: { stable: null, testing: null },
    news: [
      { id: 'n1', tag: 'update', date: '2026-11-05', published: true, title: { ru: 'Сборка 0.3.2: Цитадель Пепла', uk: 'Збірка 0.3.2: Цитадель Попелу', en: 'Build 0.3.2: Citadel of Ash' }, body: { ru: 'Новый данж с боссом Игнисом, переработанные школы огня и льда.', uk: 'Новий данж із босом Ігнісом, перероблені школи вогню та льоду.', en: 'A new dungeon with the boss Ignis.' } },
      { id: 'n2', tag: 'event', date: '2026-11-02', published: true, title: { ru: 'Ночь Разлома — 9 ноября', uk: 'Ніч Розлому — 9 листопада', en: 'Rift Night — Nov 9' }, body: { ru: 'Разломы открываются по всему миру.', uk: 'Розломи відкриваються по всьому світу.', en: 'Rifts open across the world.' } },
      { id: 'n3', tag: 'maintenance', date: '2026-11-12', published: false, title: { ru: 'Перенос мира на новые диски', uk: 'Перенесення світу на нові диски', en: '' }, body: { ru: 'Сервер будет недоступен один час.', uk: 'Сервер буде недоступний одну годину.', en: '' } },
    ],
    site: { motd: '§5Spell and Iron Rift §7— §6Ночь Разлома 9.11', maxPlayers: 300, whitelist: false, rules: { ru: '1. Уважайте других игроков.\n2. Читы, дюпы и эксплойты запрещены.\n3. Не разрушайте чужие постройки.', uk: '1. Поважайте інших гравців.\n2. Чити, дюпи та експлойти заборонені.\n3. Не руйнуйте чужі споруди.', en: '1. Respect other players.\n2. No cheats, dupes or exploits.' } },
    backups: [
      { name: '2026-11-07T04-00-00-000Z__scheduled.tar.gz', size: 3_412_000_000, createdAt: iso(14 * H), reason: 'scheduled' },
      { name: '2026-11-05T18-22-10-000Z__pre-publish.tar.gz', size: 3_398_000_000, createdAt: iso(2 * D), reason: 'pre-publish' },
      { name: '2026-11-04T04-00-00-000Z__scheduled.tar.gz', size: 3_380_000_000, createdAt: iso(3 * D + 14 * H), reason: 'scheduled' },
    ],
    audit: [
      { at: iso(2 * D), user: 'owner', action: 'build.publish', detail: '0.3.2' },
      { at: iso(2 * D + 60e3), user: 'owner', action: 'server.sync', detail: '7 copied, 1 removed' },
      { at: iso(1 * D), user: 'Morwen', action: 'library.upload', detail: 'sodium-fabric-0.6.5+mc1.21.1.jar' },
      { at: iso(5 * H), user: 'Kestrel', action: 'players.kick', detail: 'xX_Griefer_Xx полёт' },
    ],
    banned: [{ name: 'xX_Griefer_Xx', created: '2026-11-06 21:14:02 +0200', source: 'Kestrel', reason: 'Гриф чужих построек', expires: 'forever' }],
    online: ['Ardent_Vex', 'Sorcha', 'IronWarden', 'Mirela_UA', 'pyromancer77', 'Draven', 'NightOwl', 'Lysandra'],
    state: 'running', startedAt: now - 2 * D - 7 * H,
  };
  const entry = (itemId, path, side, extra = {}) => ({ itemId, path, side, required: true, mode: 'replace', ...extra });
  const base = [entry('a1', 'mods/irons_spellbooks-1.21.1-3.9.2.jar', 'both'), entry('a2', 'mods/L_Enders_Cataclysm-2.60-1.21.1.jar', 'both'), entry('a3', 'mods/geckolib-neoforge-1.21.1-4.7.3.jar', 'both'), entry('a4', 'mods/curios-neoforge-9.2.2+1.21.1.jar', 'both'), entry('a5', 'mods/player-animation-lib-forge-2.0.1+1.21.1.jar', 'both'), entry('a6', 'mods/lionfishapi-2.4-1.21.1.jar', 'both'), entry('a7', 'mods/spellironrift-core-0.3.2.jar', 'client'), entry('a8', 'mods/iris-neoforge-1.8.8+mc1.21.1.jar', 'client'), entry('r1', 'resourcepacks/rift-ui-0.3.2.zip', 'client'), entry('s1', 'shaderpacks/ComplementaryReimagined_r5.4.zip', 'client', { required: false, presets: ['high', 'ultra'] }), entry('c1', 'config/irons_spellbooks-server.toml', 'server', { mode: 'keep-user' })];
  const mk = (id, version, status, entries, ago, extra = {}) => ({ id, version, status, neoforgeVersion: '21.1.172', entries: structuredClone(entries), resourcePacks: ['rift-ui-0.3.2.zip'], changelog: { ru: '', uk: '', en: '' }, createdAt: iso(ago), createdBy: 'owner', updatedAt: iso(ago), ...extra });
  db.builds = [
    mk('b-0006', '0.3.1', 'archived', base.filter((e) => e.itemId !== 'a2' && e.itemId !== 'a6'), 12 * D, { publishedAt: iso(12 * D) }),
    mk('b-0007', '0.3.2', 'published', base, 2 * D, { publishedAt: iso(2 * D), changelog: { ru: 'Цитадель Пепла: новый данж и босс Игнис.\nПереработаны школы огня и льда.', uk: 'Цитадель Попелу: новий данж і бос Ігніс.', en: 'Citadel of Ash dungeon and the boss Ignis.' } }),
    mk('b-0008', '0.3.3', 'draft', [...base.filter((e) => e.itemId !== 'a5'), entry('a9', 'mods/jei-1.21.1-neoforge-19.21.0.jar', 'both')], 3 * H, { createdBy: 'Morwen' }),
  ];
  db.published.stable = 'b-0007';

  function analyze(b) {
    const issues = [];
    const items = b.entries.map((e) => ({ e, i: db.library.find((x) => x.id === e.itemId) }));
    const mods = items.filter((x) => x.i?.mod);
    for (const { e, i } of mods) for (const d of i.mod.dependencies) {
      if (['minecraft', 'neoforge'].includes(d.modId) || d.type !== 'required') continue;
      const found = mods.find((m) => m.i.mod.modId === d.modId);
      if (!found) issues.push({ level: 'error', code: 'missing_dependency', item: i.name, detail: `${d.modId} ${d.versionRange}` });
      else if (e.side !== 'client' && found.e.side === 'client') issues.push({ level: 'error', code: 'dependency_side', item: i.name, detail: `${d.modId} → client` });
    }
    for (const { e, i } of mods) if (i.mod.clientOnlyHint && e.side !== 'client') issues.push({ level: 'warning', code: 'client_only_on_server', item: i.name });
    for (const { i } of items) for (const w of i?.warnings ?? []) issues.push({ level: 'warning', code: w, item: i.name });
    return issues;
  }
  const audit = (action, detail) => db.audit.unshift({ at: new Date().toISOString(), user: 'owner', action, detail });
  const err = (status, message) => Object.assign(new Error(message), { status });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let seq = 0; const lines = []; const subs = new Set(); let stateCb = null;
  const push = (text, source = 'out') => { const l = { seq: ++seq, at: Date.now(), text, source }; lines.push(l); if (lines.length > 400) lines.shift(); subs.forEach((f) => f(l)); };
  [
    '[Server thread/INFO] [minecraft/DedicatedServer]: Starting Minecraft server on *:25565',
    '[Server thread/INFO] [ne.ne.fm.lo.LoadingModList/]: Loaded 9 mods: irons_spellbooks, cataclysm, geckolib, curios, playeranimator, lionfishapi, jei, neoforge, minecraft',
    '[Server thread/INFO] [minecraft/DedicatedServer]: Preparing level "world"',
    '[Server thread/INFO] [minecraft/DedicatedServer]: Done (18.402s)! For help, type "help"',
    '[Server thread/INFO] [minecraft/MinecraftServer]: Ardent_Vex joined the game',
    '[Server thread/WARN] [minecraft/MinecraftServer]: Can\'t keep up! Is the server overloaded? Running 2140ms or 42 ticks behind',
    '[Server thread/INFO] [minecraft/MinecraftServer]: Sorcha has made the advancement [Spellbinder]',
  ].forEach((x) => push(x));
  const chatter = ['<Sorcha> кто идёт в Цитадель?', '<IronWarden> я готов, жду у портала', '[irons_spellbooks] Lysandra cast Fireball (level 4)', '<Mirela_UA> привіт усім!', '[cataclysm] Ignis has been defeated by Draven', '<pyromancer77> лаг на спавне?', 'Saving the game (this may take a moment!)', 'Saved the game'];
  setInterval(() => { if (db.state === 'running') push(`[Server thread/INFO] [minecraft/MinecraftServer]: ${chatter[Math.floor(Math.random() * chatter.length)]}`); }, 3500);

  const routes = [
    ['GET', /^\/me$/, () => ({ user: db.users[0], csrf: 'demo', permissions: ['server.view', 'server.control', 'console.command', 'players.moderate', 'content.manage', 'builds.manage', 'builds.publish', 'news.manage', 'site.manage', 'backups.manage', 'backups.restore', 'users.manage', 'audit.view'], serverConfigured: true, keyId: 'demo' })],
    ['POST', /^\/login$/, (b) => { if (b.username !== 'owner') throw err(401, 'invalid_credentials'); return routes[0][2](); }],
    ['POST', /^\/logout$/, () => ({ ok: true })],
    ['GET', /^\/overview$/, () => {
      const stable = db.builds.find((b) => b.id === db.published.stable);
      const run = db.state === 'running';
      return { server: { configured: true, state: db.state, startedAt: run ? db.startedAt : null, pid: run ? 41872 : null, usage: run ? { cpu: 120 + Math.round(Math.random() * 60), rssMb: 7900 + Math.round(Math.random() * 400) } : {}, tps: run ? { tps: 19.6 + Math.random() * 0.4, mspt: 31 + Math.random() * 8, at: now } : null, players: { names: db.online, max: db.site.maxPlayers } },
        status: run ? { online: true, players: 137, maxPlayers: db.site.maxPlayers, motd: db.site.motd, latencyMs: 3 } : { online: false, players: 0, maxPlayers: 0, motd: '' },
        stable: stable ? { id: stable.id, version: stable.version, publishedAt: stable.publishedAt } : null, testing: db.published.testing,
        drafts: db.builds.filter((b) => b.status === 'draft').length, library: { mods: db.library.filter((i) => i.category === 'mod').length, resourcepacks: db.library.filter((i) => i.category === 'resourcepack').length, total: db.library.length }, backups: db.backups.slice(0, 3) };
    }],
    ['POST', /^\/server\/(start|stop|restart)$/, async (_b, m) => {
      const a = m[1];
      if (a !== 'start') { db.state = 'stopping'; stateCb?.('stopping'); push('[panel] stopping server', 'panel'); await sleep(900); db.state = 'stopped'; push('[panel] server exited with code 0', 'panel'); stateCb?.('stopped'); }
      if (a !== 'stop') { db.state = 'starting'; stateCb?.('starting'); push('[panel] starting server', 'panel'); await sleep(1200); db.startedAt = Date.now(); db.state = 'running'; push(`[Server thread/INFO] [minecraft/DedicatedServer]: Done (17.9s)! For help, type "help"`); stateCb?.('running'); }
      audit(`server.${a}`); return { state: db.state };
    }],
    ['POST', /^\/server\/command$/, (b) => { if (db.state !== 'running') throw err(409, 'not_running'); push(`> ${b.command}`, 'panel'); audit('console.command', b.command); if (/^list/.test(b.command)) push(`[Server thread/INFO] [minecraft/DedicatedServer]: There are ${db.online.length} of a max of ${db.site.maxPlayers} players online: ${db.online.join(', ')}`); }],
    ['GET', /^\/players$/, () => ({ online: { names: db.online, max: db.site.maxPlayers }, banned: db.banned, ops: [] })],
    ['POST', /^\/players\/(kick|ban|pardon)$/, (b, m) => {
      if (!/^[A-Za-z0-9_]{3,16}$/.test(b.name)) throw err(400, 'bad_player_name');
      if (m[1] !== 'pardon') db.online = db.online.filter((n) => n !== b.name);
      if (m[1] === 'ban') db.banned.unshift({ name: b.name, created: new Date().toISOString().slice(0, 19).replace('T', ' '), source: 'owner', reason: b.reason || 'Banned by an operator.', expires: 'forever' });
      if (m[1] === 'pardon') db.banned = db.banned.filter((x) => x.name !== b.name);
      push(`> ${m[1]} ${b.name} ${b.reason ?? ''}`, 'panel'); audit(`players.${m[1]}`, b.name);
    }],
    ['GET', /^\/launcher$/, () => { db.launcher ??= { releases: [], published: null }; return { releases: [...db.launcher.releases].reverse(), published: db.launcher.published }; }],
    ['POST', /^\/launcher$/, (b) => { db.launcher ??= { releases: [], published: null }; if (!/^\d+\.\d+\.\d+$/.test(b.version)) throw err(400, 'bad_version'); const files = Object.fromEntries(Object.entries(b.files).filter(([, v]) => v)); if (!Object.keys(files).length) throw err(400, 'launcher_no_files'); const r = { id: `l${Date.now()}`, version: b.version, notes: b.notes, files, createdAt: new Date().toISOString(), publishedAt: new Date().toISOString(), createdBy: 'owner' }; db.launcher.releases.push(r); db.launcher.published = r.id; audit('launcher.publish', r.version); return r; }],
    ['POST', /^\/launcher\/unpublish$/, () => { db.launcher.published = null; }],
    ['POST', /^\/launcher\/([^/]+)\/publish$/, (_b, m) => { db.launcher.published = m[1]; }],
    ['GET', /^\/library$/, () => db.library],
    ['POST', /^\/library\/upload/, async (_b, _m, raw, path) => {
      const name = decodeURIComponent(/name=([^&]+)/.exec(path)[1]);
      const cat = /category=(\w+)/.exec(path)?.[1];
      const lower = name.toLowerCase();
      const category = cat || (lower.endsWith('.jar') ? 'mod' : /\.(toml|json|cfg|properties)$/.test(lower) ? 'config' : 'resourcepack');
      await sleep(400);
      const item = { id: `x${Date.now()}`, sha256: Date.now().toString(16).padEnd(64, 'a'), size: raw?.size ?? 0, fileName: name, category, name: name.replace(/\.(jar|zip)$/i, ''), version: '1.0', uploadedAt: new Date().toISOString(), uploadedBy: 'owner', errors: /fabric/i.test(name) ? ['fabric_mod'] : [], warnings: category === 'mod' ? ['no_minecraft_dependency'] : [] };
      if (category === 'mod') item.mod = { modId: item.name.split(/[-_]/)[0].toLowerCase(), displayName: item.name, version: '1.0', loader: 'neoforge', dependencies: [], clientOnlyHint: false };
      db.library.push(item); audit('library.upload', name); return item;
    }],
    ['DELETE', /^\/library\/(.+)$/, (_b, m) => { const users = db.builds.filter((b) => b.status !== 'archived' && b.entries.some((e) => e.itemId === m[1])); if (users.length) throw err(409, `in_use:${users.map((b) => b.version).join(',')}`); db.library = db.library.filter((i) => i.id !== m[1]); }],
    ['GET', /^\/builds$/, () => ({ builds: [...db.builds].reverse(), published: db.published })],
    ['POST', /^\/builds$/, (b) => { const src = db.builds.find((x) => x.id === b.from) ?? db.builds.find((x) => x.id === db.published.stable); const [x, y, z] = src.version.split('.').map(Number); const nb = mk(`b-${Date.now().toString(36)}`, `${x}.${y}.${z + 1 + db.builds.filter((q) => q.status === 'draft').length}`, 'draft', src.entries, 0, { basedOn: src.id }); db.builds.push(nb); audit('build.create', nb.version); return nb; }],
    ['GET', /^\/builds\/([^/]+)$/, (_b, m) => { const b = db.builds.find((x) => x.id === m[1]); return { ...b, issues: analyze(b) }; }],
    ['PATCH', /^\/builds\/([^/]+)$/, (p, m) => { const b = db.builds.find((x) => x.id === m[1]); if (!/^\d+\.\d+\.\d+$/.test(p.version)) throw err(400, 'bad_version'); Object.assign(b, { version: p.version, neoforgeVersion: p.neoforgeVersion, changelog: p.changelog, resourcePacks: p.resourcePacks, updatedAt: new Date().toISOString() }); return { ...b, issues: analyze(b) }; }],
    ['POST', /^\/builds\/([^/]+)\/items$/, (p, m) => {
      const b = db.builds.find((x) => x.id === m[1]); const i = db.library.find((x) => x.id === p.itemId);
      if (i.errors.length) throw err(400, 'item_has_errors');
      const dir = { mod: 'mods', resourcepack: 'resourcepacks', shaderpack: 'shaderpacks', config: 'config', other: 'spellironrift' }[i.category];
      b.entries.push({ itemId: i.id, path: `${dir}/${i.fileName}`, side: i.category === 'mod' ? (i.mod?.clientOnlyHint ? 'client' : 'both') : i.category === 'config' ? 'server' : 'client', required: i.category !== 'shaderpack', mode: i.category === 'config' ? 'keep-user' : 'replace', presets: i.category === 'shaderpack' ? ['high', 'ultra'] : undefined });
      return { ...b, issues: analyze(b) };
    }],
    ['PATCH', /^\/builds\/([^/]+)\/items$/, (p, m) => { const b = db.builds.find((x) => x.id === m[1]); Object.assign(b.entries.find((e) => e.path === p.path), { side: p.side, required: p.required, mode: p.mode, presets: p.presets }); return { ...b, issues: analyze(b) }; }],
    ['DELETE', /^\/builds\/([^/]+)\/items\?path=(.+)$/, (_p, m) => { const b = db.builds.find((x) => x.id === m[1]); b.entries = b.entries.filter((e) => e.path !== decodeURIComponent(m[2])); return { ...b, issues: analyze(b) }; }],
    ['POST', /^\/builds\/([^/]+)\/testing$/, (_p, m) => { const b = db.builds.find((x) => x.id === m[1]); if (analyze(b).some((i) => i.level === 'error')) throw err(422, 'build_has_errors'); b.status = 'testing'; db.published.testing = b.id; audit('build.testing', b.version); return b; }],
    ['POST', /^\/builds\/rollback$/, async (p) => { const prev = db.builds.filter((b) => b.publishedAt && b.id !== db.published.stable).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0]; if (!prev) throw err(409, 'nothing_to_roll_back'); return publish(prev, p); }],
    ['POST', /^\/builds\/([^/]+)\/publish$/, async (p, m) => publish(db.builds.find((x) => x.id === m[1]), p)],
    ['DELETE', /^\/builds\/([^/]+)$/, (_p, m) => { db.builds = db.builds.filter((x) => x.id !== m[1]); }],
    ['GET', /^\/news$/, () => db.news],
    ['POST', /^\/news$/, (p) => { const n = { ...p, id: `n${Date.now()}` }; db.news.push(n); audit('news.create', n.title.ru); return n; }],
    ['PATCH', /^\/news\/(.+)$/, (p, m) => { const i = db.news.findIndex((x) => x.id === m[1]); db.news[i] = { ...db.news[i], ...p }; return db.news[i]; }],
    ['DELETE', /^\/news\/(.+)$/, (_p, m) => { db.news = db.news.filter((x) => x.id !== m[1]); }],
    ['GET', /^\/site$/, () => db.site],
    ['PUT', /^\/site$/, (p) => { Object.assign(db.site, p); audit('site.update'); return { ...db.site, restartRequired: db.state === 'running' }; }],
    ['GET', /^\/backups$/, () => db.backups],
    ['POST', /^\/backups$/, async () => { await sleep(1500); const b = { name: `${new Date().toISOString().replace(/[:.]/g, '-')}__manual.tar.gz`, size: 3_420_000_000, createdAt: new Date().toISOString(), reason: 'manual' }; db.backups.unshift(b); audit('backup.create', b.name); return b; }],
    ['DELETE', /^\/backups\/(.+)$/, (_p, m) => { db.backups = db.backups.filter((b) => b.name !== decodeURIComponent(m[1])); }],
    ['POST', /^\/backups\/(.+)\/restore$/, () => { if (db.state !== 'stopped') throw err(409, 'server_must_be_stopped'); }],
    ['GET', /^\/users$/, () => db.users],
    ['POST', /^\/users$/, (p) => { if ((p.password ?? '').length < 12) throw err(400, 'weak_password'); const u = { id: `u${Date.now()}`, username: p.username, role: p.role, createdAt: new Date().toISOString() }; db.users.push(u); return u; }],
    ['PATCH', /^\/users\/(.+)$/, (p, m) => { const u = db.users.find((x) => x.id === m[1]); if (p.password !== undefined && p.password.length < 12) throw err(400, 'weak_password'); if (p.role) u.role = p.role; if (typeof p.disabled === 'boolean') u.disabled = p.disabled; return u; }],
    ['DELETE', /^\/users\/(.+)$/, (_p, m) => { db.users = db.users.filter((x) => x.id !== m[1]); }],
    ['GET', /^\/audit$/, () => db.audit],
  ];
  async function publish(b, p) {
    if (analyze(b).some((i) => i.level === 'error')) throw err(422, 'build_has_errors');
    if (db.state === 'running' && !p.restartServer) throw err(409, 'server_running_restart_required');
    await sleep(800);
    db.backups.unshift({ name: `${new Date().toISOString().replace(/[:.]/g, '-')}__pre-publish.tar.gz`, size: 3_420_000_000, createdAt: new Date().toISOString(), reason: 'pre-publish' });
    db.builds.forEach((x) => { if (x.status === 'published') x.status = 'archived'; });
    b.status = 'published'; b.publishedAt = new Date().toISOString(); db.published.stable = b.id;
    if (db.published.testing === b.id) db.published.testing = null;
    audit('build.publish', b.version); return b;
  }

  window.RIFT_DEMO = {
    async handle(method, path, body, raw) {
      await sleep(120);
      for (const [m, re, fn] of routes) {
        const match = m === method && re.exec(path);
        if (match) return (await fn(body ?? {}, match, raw, path)) ?? { ok: true };
      }
      throw err(404, 'not_found');
    },
    stream(onLine, onState) { lines.forEach(onLine); subs.add(onLine); stateCb = onState; return { close: () => subs.delete(onLine) }; },
  };
})();
