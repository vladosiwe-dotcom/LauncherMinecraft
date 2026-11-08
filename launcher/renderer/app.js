// Spell and Iron Rift launcher UI. Talks to the main process only through window.sir (see preload.cts).
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const sir = window.sir;
  const state = { lang: 'ru', settings: null, session: null, installed: null, update: null, hw: null, rec: null, recHeap: 6144, busy: false, running: false, totalRamMb: 8192, news: [] };

  // ---------- i18n ----------
  const t = (key, vars = {}) => {
    const s = (I18N[state.lang] && I18N[state.lang][key]) ?? I18N.ru[key] ?? key;
    return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  };
  function applyI18n() {
    document.documentElement.lang = state.lang === 'uk' ? 'uk' : state.lang;
    $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $('#langSwitch').innerHTML = ['ru', 'uk', 'en'].map((l) => `<button type="button" data-lang="${l}" class="${l === state.lang ? 'is-active' : ''}">${l === 'uk' ? 'ua' : l}</button>`).join('');
    if (sir.demo) { const b = $('#demoBanner'); b.hidden = false; b.textContent = t('demo.banner'); }
  }
  async function setLang(l) {
    state.lang = l; await call(sir.saveSettings({ language: l }));
    applyI18n(); renderAll(); loadNews();
  }

  const call = async (p) => {
    const r = await p;
    if (!r.ok) throw Object.assign(new Error(r.error.message), { code: r.error.code });
    return r.data;
  };
  const fmtBytes = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} ${t('gb')}` : `${Math.max(0.1, b / 1e6).toFixed(1)} ${t('mb')}`);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function showError(e, retry) {
    const key = `err.${e.code ?? 'unknown'}`;
    $('#alertText').textContent = I18N.ru[key] ? t(key) : t('err.unknown', { msg: e.message });
    $('#alert').hidden = false;
    const rb = $('#alertRetry'); rb.hidden = !retry; rb.onclick = () => { $('#alert').hidden = true; retry?.(); };
  }
  $('#alertClose').onclick = () => { $('#alert').hidden = true; };

  // ---------- skins ----------
  function defaultSkin() {
    // A plain Steve-coloured texture so the UI has something to draw before the real skin loads.
    const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d');
    const box = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    box(8, 8, 8, 8, '#b4876a'); box(8, 8, 8, 2, '#3b2817'); box(8, 10, 1, 1, '#3b2817'); box(15, 10, 1, 1, '#3b2817');
    box(9, 12, 2, 1, '#fff'); box(10, 12, 1, 1, '#523d89'); box(13, 12, 2, 1, '#fff'); box(13, 12, 1, 1, '#523d89'); box(11, 14, 2, 1, '#6a4231'); box(10, 15, 4, 1, '#3b2817');
    box(20, 20, 8, 12, '#00a8a8'); box(20, 20, 8, 1, '#008a8a');
    box(44, 20, 4, 12, '#b4876a'); box(44, 20, 4, 4, '#00a8a8'); box(36, 52, 4, 12, '#b4876a'); box(36, 52, 4, 4, '#00a8a8');
    box(4, 20, 4, 12, '#3a3aa6'); box(20, 52, 4, 12, '#3a3aa6'); box(4, 30, 4, 2, '#555'); box(20, 62, 4, 2, '#555');
    return c;
  }
  const skinCache = new Map();
  function loadSkin(url) {
    if (!url) return Promise.resolve(defaultSkin());
    if (skinCache.has(url)) return skinCache.get(url);
    const p = new Promise((res) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(defaultSkin()); i.src = url; });
    skinCache.set(url, p); return p;
  }
  async function drawFace(cv) {
    const img = await loadSkin(state.session?.skin?.url);
    const g = cv.getContext('2d'); g.imageSmoothingEnabled = false; g.clearRect(0, 0, 8, 8);
    g.drawImage(img, 8, 8, 8, 8, 0, 0, 8, 8); g.drawImage(img, 40, 8, 8, 8, 0, 0, 8, 8);
  }
  async function drawFront(cv, slim) {
    const img = await loadSkin(state.session?.skin?.url);
    const g = cv.getContext('2d'); g.imageSmoothingEnabled = false; g.clearRect(0, 0, cv.width, cv.height);
    const a = slim ? 3 : 4, s = cv.width / 16;
    const part = (sx, sy, w, h, dx, dy) => g.drawImage(img, sx, sy, w, h, dx * s, dy * s, w * s, h * s);
    part(8, 8, 8, 8, 4, 0); part(20, 20, 8, 12, 4, 8);
    part(44, 20, a, 12, 4 - a, 8); part(36, 52, a, 12, 12, 8);
    part(4, 20, 4, 12, 4, 20); part(20, 52, 4, 12, 8, 20);
    part(40, 8, 8, 8, 4, 0); part(20, 36, 8, 12, 4, 8); part(44, 36, a, 12, 4 - a, 8); part(52, 52, a, 12, 12, 8); part(4, 36, 4, 12, 4, 20); part(4, 52, 4, 12, 8, 20);
  }

  // ---------- render ----------
  function renderProfileChip() {
    const s = state.session;
    $('#profileChip').innerHTML = s
      ? `<canvas class="avatar" width="8" height="8" data-avatar></canvas><div><b>${esc(s.name)}</b><small>Microsoft · Java Edition</small></div>`
      : `<canvas class="avatar" width="8" height="8" data-avatar></canvas><div><b>${t('profile.guest')}</b><button type="button" class="link" id="chipLogin">${t('profile.login')}</button></div>`;
    $$('[data-avatar]').forEach(drawFace);
    $('#chipLogin')?.addEventListener('click', login);
  }

  function renderPlay() {
    const b = $('#playBtn'), l = $('#playLabel');
    b.classList.toggle('is-busy', state.busy);
    b.disabled = state.running;
    if (state.running) l.textContent = t('play.running');
    else if (state.busy) l.textContent = t('play.cancel');
    else if (state.settings?.testMode) l.textContent = t('play.test', { nick: state.settings.testNick || '—' });
    else if (!state.session) l.textContent = t('play.login');
    else if (!state.installed?.buildId) l.textContent = t('play.install');
    else if (state.update && state.update.changes > 0) l.textContent = t('play.update');
    else l.textContent = t('play');
  }

  function renderBuild() {
    const i = state.installed, u = state.update, pill = $('#buildPill');
    $('#buildCurrent').textContent = i?.version ?? '—';
    const hasUpdate = u && (u.changes > 0 || !i?.buildId);
    $('#buildArrow').hidden = !hasUpdate; $('#buildLatestWrap').hidden = !hasUpdate;
    $('#buildLatest').textContent = u?.version ?? '—';
    pill.className = `pill ${!i?.buildId ? 'is-warn' : hasUpdate ? 'is-warn' : 'is-ok'}`;
    pill.textContent = !i?.buildId ? t('build.notInstalled') : hasUpdate ? t('build.update') : t('build.uptodate');
    $('#buildNote').textContent = hasUpdate && u.downloadBytes ? `${fmtBytes(u.downloadBytes)} ${t('build.download')}` : '';
  }

  function renderServer(st) {
    const pill = $('#serverPill');
    if (!st || !st.online) {
      pill.className = 'pill is-bad'; pill.textContent = t('server.offline');
      $('#playersOnline').textContent = '—'; $('#playersMax').textContent = '—'; $('#playersMeter').style.width = '0'; $('#serverPing').textContent = '';
      return;
    }
    pill.className = 'pill is-ok'; pill.textContent = t('server.online');
    $('#playersOnline').textContent = st.players; $('#playersMax').textContent = st.maxPlayers;
    $('#playersMeter').style.width = `${Math.min(100, (st.players / Math.max(1, st.maxPlayers)) * 100)}%`;
    $('#serverPing').textContent = st.latencyMs != null ? `${t('server.ping')} ${st.latencyMs} ms` : '';
  }

  function newsHtml(n) {
    const d = new Date(n.date).toLocaleDateString(state.lang === 'uk' ? 'uk-UA' : state.lang === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'long' });
    return `<article class="news"><div class="news__meta"><span class="news__tag" data-tag="${esc(n.tag)}">${t(`tag.${n.tag}`)}</span><time datetime="${esc(n.date)}">${d}</time></div><h3>${esc(n.title)}</h3><p>${esc(n.body)}</p></article>`;
  }
  function renderNews(err) {
    const empty = `<p class="empty">${err ? t('news.error') : t('news.empty')}</p>`;
    $('#newsShort').innerHTML = state.news.length ? state.news.slice(0, 3).map(newsHtml).join('') : empty;
    $('#newsFull').innerHTML = state.news.length ? state.news.map(newsHtml).join('') : empty;
  }

  function renderSettings() {
    const s = state.settings; if (!s) return;
    const mem = $('#memory');
    mem.max = String(Math.max(4096, Math.floor((state.totalRamMb - 1536) / 512) * 512));
    mem.value = s.memoryMb; $('#memoryOut').textContent = `${(s.memoryMb / 1024).toFixed(1)} ${t('gb')}`;
    $('#memoryHint').textContent = t('settings.memory.hint', { mb: state.recHeap });
    $('#javaAuto').checked = !s.javaPath; $('#javaCustom').checked = !!s.javaPath;
    $('#javaPathRow').hidden = !s.javaPath; $('#javaPath').textContent = s.javaPath ?? '';
    $('#jvmArgs').value = s.jvmArgs; $('#resW').value = s.width; $('#resH').value = s.height;
    $('#fullscreen').checked = s.fullscreen; $('#closeOnLaunch').checked = s.closeOnLaunch;
    $('#installDir').textContent = s.installDir; $('#channel').value = s.channel;
    $('#presetAuto').checked = !s.presetIsManual;
    renderGraphics(); renderLangs();
  }

  function renderGraphics() {
    const hw = state.hw;
    const cell = (k, v) => `<div><small>${t(k)}</small><b title="${esc(v)}">${esc(v ?? t('gfx.unknown'))}</b></div>`;
    $('#hwBox').innerHTML = hw
      ? [cell('gfx.cpu', `${hw.cpuModel} · ${hw.cpuThreads}T`), cell('gfx.gpu', hw.gpuName), cell('gfx.vram', hw.vramMb ? `${(hw.vramMb / 1024).toFixed(0)} ${t('gb')}` : null), cell('gfx.ram', `${(hw.totalRamMb / 1024).toFixed(0)} ${t('gb')}`), cell('gfx.gl', hw.glVersion ? String(hw.glVersion) : null), cell('gfx.recommended', t(`preset.${state.rec}`))].join('')
      : `<div><small>${t('gfx.detected')}</small><b>…</b></div>`;
    const active = state.settings.presetIsManual ? state.settings.preset : state.rec;
    const levels = { minimal: 1, balanced: 2, high: 3, ultra: 4 };
    $('#presets').innerHTML = ['minimal', 'balanced', 'high', 'ultra'].map((p) => `
      <button type="button" class="preset ${p === active ? 'is-selected' : ''}" data-preset="${p}" ${state.settings.presetIsManual ? '' : 'disabled'}>
        ${p === state.rec ? `<span class="rec">${t('gfx.recommended')}</span>` : ''}
        <b>${t(`preset.${p}`)}</b>
        <span class="bars">${[1, 2, 3, 4].map((i) => `<i class="${i <= levels[p] ? 'on' : ''}"></i>`).join('')}</span>
        <p>${t(`preset.${p}.d`)}</p>
        <small>${p === 'high' || p === 'ultra' ? t('gfx.shaders') : t('gfx.noShaders')}</small>
      </button>`).join('');
  }

  function renderLangs() {
    const names = { ru: ['Русский', 'Russian'], uk: ['Українська', 'Ukrainian'], en: ['English', 'English'] };
    $('#langCards').innerHTML = ['ru', 'uk', 'en'].map((l) => `<button type="button" class="lang ${l === state.lang ? 'is-selected' : ''}" data-lang="${l}"><b>${names[l][0]}${l === 'en' ? `<span class="beta">${t('lang.beta')}</span>` : ''}</b><small>${names[l][1]}</small></button>`).join('');
  }

  async function renderProfile() {
    const s = state.session, v = $('#profileView');
    if (!s) {
      v.innerHTML = `<div class="profile__skin"><canvas width="160" height="320" id="skinFront"></canvas></div><div class="profile__info"><h3>${t('profile.guest')}</h3><p class="hint">${t('profile.license')}</p><p class="hint">${t('profile.secure')}</p><div class="profile__actions"><button type="button" class="btn" id="pLogin">${t('profile.login')}</button></div></div>`;
      $('#pLogin').onclick = login;
    } else {
      const slim = s.skin?.variant === 'SLIM';
      v.innerHTML = `<div class="profile__skin"><canvas width="160" height="320" id="skinFront"></canvas></div>
        <div class="profile__info"><h3>${esc(s.name)}</h3><div class="uuid">UUID ${esc(s.uuid)}</div>
        <div class="field" style="margin-top:20px"><span class="label">${t('profile.skin')}</span>
          <div class="segmented"><label><input type="radio" name="variant" value="classic" ${slim ? '' : 'checked'}><span>${t('profile.classic')}</span></label><label><input type="radio" name="variant" value="slim" ${slim ? 'checked' : ''}><span>${t('profile.slim')}</span></label></div></div>
        <div class="profile__actions"><button type="button" class="btn" id="pSkin">${t('profile.uploadSkin')}</button><button type="button" class="btn btn--ghost" id="pLogout">${t('profile.logout')}</button></div>
        <p class="hint">${t('profile.secure')}</p></div>`;
      $('#pSkin').onclick = async () => {
        try { const v2 = $('input[name=variant]:checked').value; const r = await call(sir.uploadSkin(v2)); if (r) { state.session = r; skinCache.clear(); renderProfile(); renderProfileChip(); } } catch (e) { showError(e); }
      };
      $('#pLogout').onclick = async () => { await call(sir.logout()); state.session = null; renderAll(); };
    }
    drawFront($('#skinFront'), s?.skin?.variant === 'SLIM');
  }

  function renderAll() { renderProfileChip(); renderPlay(); renderBuild(); renderSettings(); renderProfile(); renderNews(); }

  // ---------- data ----------
  async function loadServer() { try { renderServer(await call(sir.serverStatus())); } catch { renderServer(null); } }
  async function loadNews() { try { state.news = await call(sir.news()); renderNews(); } catch { state.news = []; renderNews(true); } }
  async function loadUpdate() { try { state.update = await call(sir.checkUpdate()); } catch { state.update = null; } renderBuild(); renderPlay(); }
  async function detectHw() {
    let renderer;
    try {
      const gl = document.createElement('canvas').getContext('webgl');
      const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : undefined;
    } catch { /* ignore */ }
    try {
      const r = await call(sir.detectHardware({ renderer }));
      state.hw = r.hardware; state.rec = r.recommended.preset; state.recHeap = r.recommendedHeapMb;
    } catch { state.rec = 'balanced'; }
    renderSettings();
  }

  // ---------- actions ----------
  let codeOff;
  async function login() {
    $('#loginModal').hidden = false;
    $('#loginCode').textContent = '— — — —';
    codeOff = sir.onAuthCode((c) => {
      $('#loginCode').textContent = c.userCode; $('#loginUrl').textContent = c.verificationUri;
      $('#loginOpen').onclick = () => sir.openUrl(c.verificationUri);
      $('#loginCopy').onclick = async () => { try { await navigator.clipboard.writeText(c.userCode); $('#loginCopy').textContent = t('login.copied'); } catch { getSelection().selectAllChildren($('#loginCode')); } };
    });
    try { state.session = await call(sir.login()); renderAll(); loadUpdate(); }
    catch (e) { if (e.code !== 'auth.declined') showError(e, login); }
    finally { $('#loginModal').hidden = true; codeOff?.(); }
  }
  $('#loginCancel').onclick = () => { sir.cancelLogin(); $('#loginModal').hidden = true; };

  const STAGES = ['java', 'minecraft', 'neoforge', 'pack', 'launch', 'server'];
  sir.onProgress((p) => {
    $('#progress').hidden = false;
    const pct = p.total ? Math.floor((p.done / p.total) * 100) : 0;
    $('#progressStage').textContent = p.stage === 'server' ? t('stage.server') : `${STAGES.indexOf(p.stage) + 1}/5 · ${t(`stage.${p.stage}`)}`;
    $('#progressPct').textContent = `${pct}%`;
    $('#progressBar').style.width = `${pct}%`;
    $('#progressDetail').textContent = p.stage === 'pack' && p.total > 1000 ? `${fmtBytes(p.done)} / ${fmtBytes(p.total)} · ${p.detail ?? ''}` : (p.detail ?? '');
  });
  sir.onGameState((g) => { state.running = g.running; if (!g.running) loadUpdate(); renderPlay(); });
  sir.onSession((s) => { state.session = s; renderAll(); });

  $('#playBtn').addEventListener('click', async () => {
    if (state.busy) { await sir.cancel(); return; }
    if (state.settings?.testMode && !/^[A-Za-z0-9_]{3,16}$/.test(state.settings.testNick || '')) { go('server'); $('#testNick').focus(); return; }
    if (!state.settings?.testMode && !state.session) { login(); return; }
    state.busy = true; renderPlay();
    try { await call(sir.play()); const st = await call(sir.state()); state.installed = st.installed; }
    catch (e) { showError(e, () => $('#playBtn').click()); }
    finally { state.busy = false; $('#progress').hidden = true; renderPlay(); renderBuild(); }
  });

  // navigation
  function go(view) {
    $$('.rail__item').forEach((b) => b.classList.toggle('is-active', b.dataset.view === view));
    $$('.view').forEach((v) => v.classList.toggle('is-active', v.dataset.view === view));
  }
  $$('.rail__item').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]'); if (g) go(g.dataset.goto);
    const l = e.target.closest('[data-lang]'); if (l) setLang(l.dataset.lang);
    const w = e.target.closest('[data-win]'); if (w) sir.window(w.dataset.win);
    const p = e.target.closest('[data-preset]'); if (p && !p.disabled) save({ preset: p.dataset.preset, presetIsManual: true }).then(renderGraphics);
  });
  $$('.tab').forEach((b) => b.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.toggle('is-active', x === b));
    $$('.tabpanel').forEach((x) => x.classList.toggle('is-active', x.dataset.tab === b.dataset.tab));
  }));

  // settings bindings
  let toastTimer;
  async function save(patch) {
    try {
      state.settings = await call(sir.saveSettings(patch));
      const toast = $('#savedToast'); toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 1400);
    } catch (e) { showError(e); renderSettings(); }
  }
  $('#memory').addEventListener('input', (e) => { $('#memoryOut').textContent = `${(e.target.value / 1024).toFixed(1)} ${t('gb')}`; });
  $('#memory').addEventListener('change', (e) => save({ memoryMb: Number(e.target.value) }));
  $('#javaAuto').addEventListener('change', () => save({ javaPath: null }).then(renderSettings));
  $('#javaCustom').addEventListener('change', async () => { const p = await call(sir.pickJava()); if (p) await save({ javaPath: p }); renderSettings(); });
  $('#pickJava').addEventListener('click', async () => { const p = await call(sir.pickJava()); if (p) { await save({ javaPath: p }); renderSettings(); } });
  $('#jvmArgs').addEventListener('change', (e) => save({ jvmArgs: e.target.value }));
  $('#resW').addEventListener('change', (e) => save({ width: Number(e.target.value) }));
  $('#resH').addEventListener('change', (e) => save({ height: Number(e.target.value) }));
  $('#fullscreen').addEventListener('change', (e) => save({ fullscreen: e.target.checked }));
  $('#closeOnLaunch').addEventListener('change', (e) => save({ closeOnLaunch: e.target.checked }));
  $('#channel').addEventListener('change', (e) => save({ channel: e.target.value }).then(loadUpdate));
  $('#pickDir').addEventListener('click', async () => { const d = await call(sir.pickDir()); if (d) { await save({ installDir: d }); renderSettings(); } });
  $('#presetAuto').addEventListener('change', (e) => save(e.target.checked ? { presetIsManual: false, preset: null } : { presetIsManual: true, preset: state.rec }).then(renderGraphics));
  $('#repairBtn').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { const n = await call(sir.repair()); e.target.textContent = t('maint.repaired', { n }); } catch (err) { showError(err); }
    finally { e.target.disabled = false; $('#progress').hidden = true; }
  });
  $('#rollbackBtn').addEventListener('click', async (e) => {
    try { const id = await call(sir.rollback()); e.target.textContent = id ? `${t('maint.done')}: ${id}` : '—'; const st = await call(sir.state()); state.installed = st.installed; renderBuild(); } catch (err) { showError(err); }
  });
  $('#openGameDir').addEventListener('click', () => sir.openGameDir());
  $('#openLogs').addEventListener('click', () => sir.openLogs());

  // ---------- server view: test mode and "My server" ----------
  const srv = { state: 'not_installed', log: [] };
  const SRV_PILL = { not_installed: '', stopped: '', installing: 'is-warn', starting: 'is-warn', running: 'is-ok', stopping: 'is-warn' };
  function renderServer() {
    const s = state.settings; if (!s) return;
    $('#testMode').checked = !!s.testMode;
    if (document.activeElement !== $('#testNick')) $('#testNick').value = s.testNick || '';
    const tp = $('#testPill'); tp.className = `pill ${s.testMode ? 'is-warn' : ''}`; tp.textContent = t(s.testMode ? 'srv.test.pillOn' : 'srv.test.pillOff');
    const sp = $('#srvPill'); sp.className = `pill ${SRV_PILL[srv.state] ?? ''}`; sp.textContent = t(`srv.state.${srv.state}`);
    $('#srvBuild').textContent = srv.build ? t('srv.build', { b: srv.build }) : t('srv.notInstalled');
    $('#srvEula').checked = !!s.eulaAccepted;
    const busy = ['installing', 'starting', 'stopping'].includes(srv.state);
    $('#srvInstall').textContent = t(srv.build ? 'srv.update' : 'srv.install');
    $('#srvInstall').disabled = busy || srv.state === 'running' || !$('#srvEula').checked;
    $('#srvStart').disabled = busy || srv.state === 'running' || !srv.build;
    $('#srvStop').disabled = srv.state !== 'running' && srv.state !== 'starting';
    $('#srvAddr').textContent = srv.state === 'running' ? t('srv.addr', { port: srv.port ?? s.serverPort }) : '';
    renderPlay();
  }
  function appendLog(lines) {
    const pre = $('#srvLog'); const atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 8;
    srv.log.push(...lines); if (srv.log.length > 1500) srv.log.splice(0, srv.log.length - 1500);
    pre.textContent = srv.log.join('\n');
    if (atEnd) pre.scrollTop = pre.scrollHeight;
  }
  async function loadServerView() {
    try { const r = await call(sir.myServer()); Object.assign(srv, { state: r.state, build: r.build, port: r.port }); srv.log = []; appendLog(r.log); } catch { /* not available */ }
    renderServer();
  }
  sir.onServerLine?.((l) => appendLog([l]));
  sir.onServerState?.((st) => { srv.state = st; if (st === 'stopped') loadServerView(); else renderServer(); });
  $('#testMode').addEventListener('change', async (e) => { await save({ testMode: e.target.checked }); renderServer(); });
  $('#testNick').addEventListener('change', async (e) => {
    const v = e.target.value.trim();
    if (v && !/^[A-Za-z0-9_]{3,16}$/.test(v)) { showError(Object.assign(new Error(t('srv.nick.bad')), { code: 'unknown' })); return; }
    await save({ testNick: v }); renderServer();
  });
  $('#srvEula').addEventListener('change', renderServer);
  $('#srvInstall').addEventListener('click', async () => {
    srv.state = 'installing'; renderServer();
    try { await call(sir.installMyServer($('#srvEula').checked)); state.settings.eulaAccepted = true; }
    catch (e) { showError(e); }
    finally { $('#progress').hidden = true; await loadServerView(); }
  });
  $('#srvStart').addEventListener('click', async () => { try { await call(sir.startMyServer()); } catch (e) { showError(e); } await loadServerView(); });
  $('#srvStop').addEventListener('click', async () => { try { await call(sir.stopMyServer()); } catch (e) { showError(e); } });
  $('#srvCmdForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const v = $('#srvCmd').value.trim(); if (!v) return;
    $('#srvCmd').value = ''; await call(sir.serverCommand(v)).catch(showError);
  });
  $$('.rail__item[data-view="server"]').forEach((b) => b.addEventListener('click', loadServerView));

  // ---------- launcher update (asked on every start, never required) ----------
  let launcherUpd = null;
  function showLauncherUpdate() {
    if (!launcherUpd) return;
    $('#updVersions').innerHTML = t('lupd.versions', { cur: esc(launcherUpd.current), new: `<b>${esc(launcherUpd.version)}</b>` }) + ` · ${fmtBytes(launcherUpd.size)}`;
    $('#updNotes').textContent = launcherUpd.notes;
    $('#updProgress').hidden = true;
    $('#updNow').disabled = false; $('#updLater').textContent = t('lupd.later');
    $('#updateModal').hidden = false;
    $('#updNow').focus();
  }
  async function checkLauncherUpdate() {
    try { launcherUpd = await call(sir.checkLauncherUpdate()); } catch { launcherUpd = null; }
    $('#updBadge').hidden = !launcherUpd;
    if (launcherUpd) showLauncherUpdate();
  }
  let updBusy = false;
  $('#updBadge').onclick = showLauncherUpdate;
  $('#updLater').onclick = () => {
    if (updBusy) { sir.cancelLauncherUpdate(); return; }
    $('#updateModal').hidden = true;
  };
  $('#updNow').onclick = async () => {
    updBusy = true;
    $('#updNow').disabled = true; $('#updLater').textContent = t('lupd.cancel');
    $('#updProgress').hidden = false; $('#updBar').style.width = '0%'; $('#updPct').textContent = '0%';
    const off = sir.onLauncherProgress((p) => {
      const pct = Math.min(100, Math.floor((p.done / Math.max(1, p.total)) * 100));
      $('#updBar').style.width = `${pct}%`; $('#updPct').textContent = `${pct}%`;
    });
    try {
      const r = await call(sir.installLauncherUpdate());
      if (r === 'opened') { $('#updNotes').textContent = t('lupd.opened'); $('#updProgress').hidden = true; }
    } catch (e) {
      $('#updateModal').hidden = true;
      if (e.code !== 'unknown' || !/abort/i.test(e.message)) showError(e);
    } finally {
      off?.(); updBusy = false;
      $('#updNow').disabled = false; $('#updLater').textContent = t('lupd.later');
    }
  };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#updateModal').hidden && !updBusy) $('#updateModal').hidden = true; });

  // ---------- boot ----------
  (async () => {
    const st = await call(sir.state());
    Object.assign(state, { settings: st.settings, session: st.session, installed: st.installed, running: st.gameRunning, lang: st.settings.language, totalRamMb: st.totalRamMb });
    applyI18n(); renderAll();
    loadServer(); loadNews(); loadUpdate(); detectHw(); checkLauncherUpdate();
    setInterval(loadServer, 30000);
    setInterval(loadUpdate, 10 * 60000);
  })();
})();
