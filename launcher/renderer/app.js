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
    $$('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
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
  /** Same banner as errors, for a plain notice (optionally with a link button). */
  function showNotice(text, url) {
    $('#alertText').textContent = text;
    $('#alert').hidden = false;
    const rb = $('#alertRetry'); rb.hidden = !url;
    if (url) { rb.textContent = t('play.official.get'); rb.onclick = () => { $('#alert').hidden = true; sir.openUrl(url); }; }
  }

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
    else if (acc.available && !acc.account) l.textContent = t('acc.play.signin');
    else if (state.settings?.playVia !== 'own' && !state.installed?.buildId) l.textContent = t('play.install');
    else if (state.settings?.playVia !== 'own' && state.update && state.update.changes > 0) l.textContent = t('play.update');
    else if (state.settings?.playVia !== 'own') l.textContent = t('play.official');
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
    $('#playViaOfficial').checked = s.playVia !== 'own'; $('#playViaOwn').checked = s.playVia === 'own';
    if (document.activeElement !== $('#azureClientId')) $('#azureClientId').value = s.azureClientId ?? '';
    if (document.activeElement !== $('#apiBase')) $('#apiBase').value = s.apiBase ?? '';
    $('#clientState').textContent = state.clientIdSet ? `✓ ${t('conn.ok')}` : t('conn.missing');
    $('#apiState').textContent = state.backend ? `✓ ${t('conn.ok')}` : t('conn.api.missing');
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
    await renderProfileInner();
    const info = $('#profileView .profile__info');
    if (info) { info.insertAdjacentHTML('beforeend', accountCard()); bindAccountCard(); }
  }
  async function renderProfileInner() {
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
    if (!state.settings?.testMode && acc.available && !acc.account) { renderAuthGate(); return; }
    if (!state.settings?.testMode && state.settings?.playVia !== 'own') {
      state.busy = true; renderPlay();
      try {
        const r = await call(sir.playOfficial()); const st = await call(sir.state()); state.installed = st.installed;
        showNotice(r.opened ? t('play.official.opened') : t('play.official.missing'), r.opened ? null : 'https://www.minecraft.net/download');
      } catch (e) { showError(e, () => $('#playBtn').click()); }
      finally { state.busy = false; $('#progress').hidden = true; renderPlay(); renderBuild(); loadUpdate(); }
      return;
    }
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

  // ---------- Spell and Iron Rift account (sign in / register; Microsoft still provides the game licence) ----------
  const acc = { available: false, account: null, mode: 'login' };
  const NICK = /^[A-Za-z0-9_]{3,16}$/;
  const pwRules = (pw, nick) => ({ len: pw.length >= 8, mix: /\p{L}/u.test(pw) && /\d/.test(pw), nick: !nick || !pw.toLowerCase().includes(nick.toLowerCase()) });
  function accError(e) {
    const code = String(e.code || '').replace(/^account\./, '');
    if (code === 'account_banned') return t('acc.err.account_banned', { reason: e.message && e.message !== 'account_banned' ? e.message : '—' });
    return T(`acc.err.${code}`) ?? (e.code === 'network' ? t('err.network') : e.code === 'secure_storage' ? t('err.secure_storage') : t('acc.err.generic'));
  }
  const T = (k) => ((I18N[state.lang] && I18N[state.lang][k]) ?? I18N.ru[k]);
  function setAuthMode(m) {
    acc.mode = m;
    $$('[data-authtab]').forEach((b) => b.classList.toggle('is-active', b.dataset.authtab === m));
    $('#accRegisterOnly').hidden = m !== 'register';
    $('#accNickHint').hidden = m !== 'register';
    $('#accForgot').hidden = m !== 'login';
    $('#accSubmit').textContent = t(m === 'login' ? 'acc.login.go' : 'acc.register.go');
    $('#accPass').autocomplete = m === 'login' ? 'current-password' : 'new-password';
    $('#accError').hidden = true;
    checkRules();
  }
  function checkRules() {
    const nick = $('#accNick').value.trim(), pw = $('#accPass').value, r = pwRules(pw, nick);
    r.same = pw.length > 0 && pw === $('#accPass2').value;
    $$('#accRules [data-rule]').forEach((li) => li.classList.toggle('is-ok', !!r[li.dataset.rule]));
    $('#accNick').setAttribute('aria-invalid', String(acc.mode === 'register' && nick.length > 0 && !NICK.test(nick)));
    return r;
  }
  function renderAuthGate() {
    const need = acc.available && !acc.account && !state.settings?.testMode;
    $('#authGate').hidden = !need;
    if (need && document.activeElement?.closest?.('#authGate') == null) setTimeout(() => $('#accNick').focus(), 50);
    if (acc.account?.mustChangePassword) openPw(true);
    renderPlay();
  }
  async function loadAccount() {
    try { const r = await call(sir.account()); acc.available = r.available; acc.account = r.account; } catch { acc.available = false; }
    renderAuthGate();
  }
  $$('[data-authtab]').forEach((b) => b.addEventListener('click', () => setAuthMode(b.dataset.authtab)));
  ['#accNick', '#accPass', '#accPass2'].forEach((id) => $(id).addEventListener('input', checkRules));
  $('#accEye').addEventListener('click', () => {
    const on = $('#accPass').type === 'password';
    $('#accPass').type = on ? 'text' : 'password'; $('#accPass2').type = $('#accPass').type;
    $('#accEye').classList.toggle('is-on', on);
  });
  $('#accTestMode').addEventListener('click', () => { $('#authGate').hidden = true; go('server'); loadServerView(); });
  $('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nick = $('#accNick').value.trim(), pw = $('#accPass').value, err = $('#accError');
    err.hidden = true;
    if (acc.mode === 'register') {
      const r = checkRules();
      const bad = !NICK.test(nick) ? 'nick_format' : !r.len ? 'password_short' : !r.mix ? 'password_letters_digits' : !r.nick ? 'password_contains_nick' : !r.same ? 'password_mismatch' : null;
      if (bad) { err.textContent = T(`acc.err.${bad}`); err.hidden = false; return; }
    } else if (!nick || !pw) { err.textContent = T('acc.err.invalid_credentials'); err.hidden = false; return; }
    $('#accSubmit').disabled = true;
    try {
      acc.account = await call(acc.mode === 'register' ? sir.accountRegister(nick, pw) : sir.accountLogin(nick, pw));
      $('#accPass').value = ''; $('#accPass2').value = '';
      renderAuthGate(); renderProfile();
    } catch (ex) { err.textContent = accError(ex); err.hidden = false; }
    finally { $('#accSubmit').disabled = false; }
  });
  sir.onAccount?.((a) => { acc.account = a; renderAuthGate(); renderProfile(); });

  function openPw(forced) {
    $('#pwWhy').textContent = t(forced ? 'acc.pw.forced' : 'acc.pw.why');
    $('#pwCancel').hidden = !!forced;
    $('#pwError').hidden = true;
    ['#pwCurrent', '#pwNew', '#pwNew2'].forEach((id) => { $(id).value = ''; });
    $('#pwModal').hidden = false; $('#pwCurrent').focus();
  }
  $('#pwCancel').addEventListener('click', () => { $('#pwModal').hidden = true; });
  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const cur = $('#pwCurrent').value, nw = $('#pwNew').value, err = $('#pwError'), r = pwRules(nw, acc.account?.nick ?? '');
    const bad = !r.len ? 'password_short' : !r.mix ? 'password_letters_digits' : !r.nick ? 'password_contains_nick' : nw !== $('#pwNew2').value ? 'password_mismatch' : null;
    if (bad) { err.textContent = T(`acc.err.${bad}`); err.hidden = false; return; }
    try { acc.account = await call(sir.accountPassword(cur, nw)); $('#pwModal').hidden = true; renderProfile(); }
    catch (ex) { err.textContent = accError(ex); err.hidden = false; }
  });

  /** The account card under the Minecraft profile in the Profile view. */
  function accountCard() {
    const a = acc.account;
    if (!acc.available) return '';
    if (!a) return `<div class="accountcard"><div class="accountcard__head"><b>${t('acc.title')}</b></div><p class="hint">${t('acc.none')}</p><div class="profile__actions"><button type="button" class="btn btn--gold" id="accOpen">${t('acc.login')}</button></div></div>`;
    return `<div class="accountcard"><div class="accountcard__head"><b>${esc(a.nick)}</b><span class="role role--${a.role}">${t(`acc.role.${a.role}`)}</span></div>
      <dl><dt>${t('acc.uuid')}</dt><dd class="mono">${esc(a.id)}</dd><dt>${t('acc.minecraft')}</dt><dd>${a.minecraft ? esc(a.minecraft.name) : t('acc.notLinked')}</dd></dl>
      ${a.minecraft ? '' : `<form id="linkCodeForm" class="linkcode"><label for="linkCode">${esc(t('link.code'))}</label><p class="hint">${esc(t('link.code.d'))}</p>
        <div class="pathrow"><input type="text" id="linkCode" maxlength="12" autocomplete="off" spellcheck="false" placeholder="ABCD2345"><button type="submit" class="btn btn--gold">${esc(t('link.code.apply'))}</button></div></form>`}
      <div class="profile__actions"><button type="button" class="btn" id="accPw">${t('acc.pw.title')}</button><button type="button" class="btn btn--ghost" id="accOut">${t('acc.logout')}</button></div></div>`;
  }
  function bindAccountCard() {
    $('#accOpen')?.addEventListener('click', () => { setAuthMode('login'); $('#authGate').hidden = false; $('#accNick').focus(); });
    $('#accPw')?.addEventListener('click', () => openPw(false));
    $('#linkCodeForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { acc.account = await call(sir.accountLinkCode($('#linkCode').value)); renderProfile(); renderPlay(); }
      catch (err) { showError(err); }
    });
    $('#accOut')?.addEventListener('click', async () => { await call(sir.accountLogout()).catch(() => null); acc.account = null; renderAuthGate(); renderProfile(); });
  }

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
    $('#srvRestart').disabled = srv.state !== 'running';
    const mem = $('#srvMemory');
    mem.max = String(Math.max(4096, Math.floor((state.totalRamMb - 2048) / 512) * 512));
    if (document.activeElement !== mem) { mem.value = s.serverMemoryMb; $('#srvMemoryOut').textContent = `${(s.serverMemoryMb / 1024).toFixed(1)} ${t('gb')}`; }
    if (document.activeElement !== $('#srvPort')) $('#srvPort').value = s.serverPort;
    renderSrvStats(); renderBackups();
    $('#srvAddr').textContent = srv.state === 'running' ? t('srv.addr', { port: srv.port ?? s.serverPort }) : '';
    renderPlay();
  }
  const fmtUptime = (sec) => { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return h ? `${h} ч ${m} мин` : `${m} мин`; };
  function renderSrvStats() {
    const st = srv.status, box = $('#srvStats');
    if (!st || st.state !== 'running') { box.innerHTML = ''; return; }
    box.innerHTML = `<span>${esc(t('srv.uptime', { t: fmtUptime(st.uptimeSec) }))}</span><span>${esc(t('srv.players', { n: st.players, max: st.maxPlayers }))}</span>`
      + `<span class="srv-stats__names">${st.names.length ? st.names.map(esc).join(', ') : esc(t('srv.nobody'))}</span>`;
  }
  async function pollStatus() {
    if (!$('.view--server').classList.contains('is-active')) return;
    try { srv.status = await call(sir.myServerStatus()); renderSrvStats(); } catch { /* not running */ }
  }
  setInterval(pollStatus, 5000);
  const bk = { list: [], confirm: null };
  function renderBackups() {
    const box = $('#srvBackups');
    if (!bk.list.length) { box.innerHTML = `<p class="hint">${esc(t('srv.backup.none'))}</p>`; return; }
    const stopped = !['running', 'starting', 'stopping', 'installing'].includes(srv.state);
    box.innerHTML = bk.list.map((b) => `<div class="srv-backup" data-name="${esc(b.name)}">
      <span>${esc(new Date(b.createdAt).toLocaleString(state.lang === 'en' ? 'en-GB' : state.lang))} · ${esc(t(`srv.reason.${b.reason}`))} · ${esc(fmtBytes(b.size))}</span>
      <span class="srv-actions"><button type="button" class="btn btn--ghost" data-bact="restore" ${stopped ? '' : 'disabled'}>${esc(bk.confirm === `restore:${b.name}` ? t('srv.backup.confirm') : t('srv.backup.restore'))}</button>
      <button type="button" class="btn btn--ghost" data-bact="remove">${esc(bk.confirm === `remove:${b.name}` ? t('srv.backup.confirm') : t('srv.backup.remove'))}</button></span></div>`).join('');
  }
  async function loadBackups() { try { bk.list = await call(sir.serverBackups()); } catch { bk.list = []; } renderBackups(); }
  $('#srvBackups').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-bact]'); if (!b || b.disabled) return;
    const name = b.closest('[data-name]').dataset.name, key = `${b.dataset.bact}:${name}`;
    if (bk.confirm !== key) { bk.confirm = key; renderBackups(); setTimeout(() => { if (bk.confirm === key) { bk.confirm = null; renderBackups(); } }, 4000); return; }
    bk.confirm = null;
    try { bk.list = await call(b.dataset.bact === 'restore' ? sir.restoreBackup(name) : sir.removeBackup(name)); } catch (err) { showError(err); }
    renderBackups();
  });
  $('#srvBackup').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { bk.list = await call(sir.backupServer()); } catch (err) { showError(err); }
    finally { e.target.disabled = false; renderBackups(); }
  });
  $('#srvBackupsDir').addEventListener('click', () => call(sir.openServerDir('backups')).catch(showError));
  $('#srvDir').addEventListener('click', () => call(sir.openServerDir('server')).catch(showError));
  $('#srvRestart').addEventListener('click', async () => { try { await call(sir.restartMyServer()); } catch (e) { showError(e); } await loadServerView(); });
  $('#srvMemory').addEventListener('input', (e) => { $('#srvMemoryOut').textContent = `${(e.target.value / 1024).toFixed(1)} ${t('gb')}`; });
  $('#srvMemory').addEventListener('change', (e) => save({ serverMemoryMb: Number(e.target.value) }).then(renderServer));
  $('#srvPort').addEventListener('change', (e) => save({ serverPort: Number(e.target.value) }).then(renderServer));
  function appendLog(lines) {
    const pre = $('#srvLog'); const atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 8;
    srv.log.push(...lines); if (srv.log.length > 1500) srv.log.splice(0, srv.log.length - 1500);
    pre.textContent = srv.log.join('\n');
    if (atEnd) pre.scrollTop = pre.scrollHeight;
  }
  async function loadServerView() {
    try { const r = await call(sir.myServer()); Object.assign(srv, { state: r.state, build: r.build, port: r.port }); srv.log = []; appendLog(r.log); } catch { /* not available */ }
    renderServer(); loadBackups(); pollStatus();
  }
  sir.onServerLine?.((l) => appendLog([l]));
  sir.onServerState?.((st) => { srv.state = st; if (st === 'stopped') loadServerView(); else renderServer(); });
  $('#testMode').addEventListener('change', async (e) => { await save({ testMode: e.target.checked }); renderServer(); renderAuthGate(); });
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

  // ---------- owner mode: build server + admin panel on this PC ----------
  const own = { st: null, msg: '' };
  function renderOwner() {
    const st = own.st; if (!st) return;
    $('#ownerMode').checked = !!st.enabled;
    const p = $('#ownerPill'); p.className = `pill ${st.running ? 'is-ok' : ''}`; p.textContent = t(st.running ? 'own.running' : 'own.off');
    $('#ownerBody').hidden = !st.running;
    $('#ownerCreate').hidden = !st.running || st.hasOwner;
    $('#ownerPanel').disabled = !st.hasOwner;
    $('#ownerInfo').textContent = st.running ? `${t('own.info', { url: st.url, key: st.keyId })}${own.msg ? ` · ${own.msg}` : ''}` : '';
  }
  async function loadOwner() { try { own.st = await call(sir.ownerState()); } catch { own.st = null; } renderOwner(); }
  $('#ownerMode').addEventListener('change', async (e) => {
    e.target.disabled = true;
    try { own.st = await call(e.target.checked ? sir.ownerEnable() : sir.ownerDisable()); await refreshFlags(); loadServer(); loadNews(); loadUpdate(); loadTunnel(); }
    catch (err) { showError(err); await loadOwner(); }
    finally { e.target.disabled = false; renderOwner(); }
  });
  $('#ownerCreate').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { own.st = await call(sir.ownerCreate($('#ownerName').value, $('#ownerPass').value)); $('#ownerPass').value = ''; own.msg = t('own.created'); }
    catch (err) { showError(err); }
    renderOwner();
  });
  $('#ownerPanel').addEventListener('click', () => call(sir.ownerOpenPanel()).catch(showError));
  $('#ownerRestart').addEventListener('click', async () => { try { own.st = await call(sir.ownerRestart()); } catch (e) { showError(e); } renderOwner(); });
  // ---------- access for friends: tunnel, game address, check, invite ----------
  const tun = { st: null, invite: null };
  async function loadTunnel() {
    try { tun.st = await call(sir.tunnelState()); tun.invite = await call(sir.invite()); } catch { /* owner mode off */ }
    renderTunnel();
  }
  function renderTunnel() {
    const st = tun.st, s = state.settings; if (!st || !s) return;
    $('#tunnelQuick').checked = st.mode === 'quick'; $('#tunnelToken').checked = st.mode === 'token';
    $('#tunnelModeHint').textContent = t(st.mode === 'quick' ? 'acc2.quick.d' : 'acc2.token.d');
    $('#tokenFields').hidden = st.mode !== 'token';
    const p = $('#tunnelPill'); p.className = `pill ${st.state === 'running' ? 'is-ok' : st.state === 'error' ? 'is-bad' : ['starting', 'downloading'].includes(st.state) ? 'is-warn' : ''}`; p.textContent = t(`tun.${st.state}`);
    $('#tunnelStart').disabled = ['running', 'starting', 'downloading'].includes(st.state);
    $('#tunnelStop').disabled = !['running', 'starting'].includes(st.state);
    $('#tunnelUrl').textContent = st.url ?? '';
    $('#tunnelAuto').checked = !!st.auto;
    if (document.activeElement !== $('#ownerPublicUrl')) $('#ownerPublicUrl').value = s.ownerPublicUrl ?? '';
    if (document.activeElement !== $('#gameAddress')) $('#gameAddress').value = s.gameAddress ?? '';
    $('#inviteCode').textContent = tun.invite ?? t('acc2.noInvite');
    $('#inviteCopy').disabled = !tun.invite;
  }
  $$('input[name="tunnelMode"]').forEach((r) => r.addEventListener('change', async (e) => { await save({ tunnelMode: e.target.value }); loadTunnel(); }));
  $('#tunnelAuto').addEventListener('change', (e) => save({ tunnelAuto: e.target.checked }).then(loadTunnel));
  $('#tunnelTokenInput').addEventListener('change', async (e) => { try { await call(sir.tunnelSetToken(e.target.value)); e.target.value = ''; e.target.placeholder = '••••••••'; } catch (err) { showError(err); } });
  $('#ownerPublicUrl').addEventListener('change', (e) => save({ ownerPublicUrl: e.target.value.trim().replace(/\/$/, '') }).then(() => call(sir.ownerRestart())).then(loadTunnel).catch(showError));
  $('#gameAddress').addEventListener('change', (e) => save({ gameAddress: e.target.value.trim() }).then(() => own.st?.running && call(sir.ownerRestart())).then(loadTunnel).catch(showError));
  $('#tunnelStart').addEventListener('click', async () => { try { tun.st = await call(sir.tunnelStart()); } catch (e) { showError(e); } loadTunnel(); });
  $('#tunnelStop').addEventListener('click', async () => { try { tun.st = await call(sir.tunnelStop()); } catch (e) { showError(e); } loadTunnel(); });
  sir.onTunnelState?.(() => loadTunnel());
  sir.onTunnelUrl?.(async () => { state.settings = (await call(sir.state())).settings; loadTunnel(); });
  $('#connCheck').addEventListener('click', async (e) => {
    e.target.disabled = true; $('#connChecks').innerHTML = '';
    try {
      const r = await call(sir.connCheck());
      $('#connChecks').innerHTML = [['acc2.check.build', r.build], ['acc2.check.game', r.game]].map(([k, v]) =>
        `<li class="${v.ok ? 'is-ok' : 'is-bad'}">${v.ok ? '✓' : '✗'} ${esc(t(k))}: ${esc(v.detail)}${v.players !== undefined ? ` · ${esc(t('srv.players', { n: v.players, max: v.max }))}` : ''}</li>`).join('');
    } catch (err) { showError(err); }
    finally { e.target.disabled = false; }
  });
  $('#inviteCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(tun.invite); $('#inviteCopy').textContent = t('acc2.copied'); setTimeout(() => { $('#inviteCopy').textContent = t('acc2.copy'); }, 1500); }
    catch { getSelection().selectAllChildren($('#inviteCode')); }
  });
  $('#inviteApply').addEventListener('click', async () => {
    try { state.settings = await call(sir.applyInvite($('#inviteInput').value)); $('#inviteInput').value = ''; $('#apiState').textContent = `✓ ${t('conn.invite.ok')}`; await refreshFlags(); loadServer(); loadNews(); loadUpdate(); loadAccount(); }
    catch (err) { showError(err); }
  });
  $$('.rail__item[data-view="server"]').forEach((b) => b.addEventListener('click', loadTunnel));

  $('#resetKey').addEventListener('click', async () => { try { await call(sir.resetKey()); loadUpdate(); } catch (e) { showError(e); } });
  $$('.rail__item[data-view="server"]').forEach((b) => b.addEventListener('click', loadOwner));

  // ---------- connection settings ----------
  async function refreshFlags() {
    const st = await call(sir.state());
    Object.assign(state, { owner: st.owner, backend: st.backend, clientIdSet: st.clientIdSet });
    renderSettings(); renderVersions();
  }
  $$('input[name="playVia"]').forEach((r) => r.addEventListener('change', (e) => save({ playVia: e.target.value }).then(renderPlay)));
  $('#azureClientId').addEventListener('change', (e) => save({ azureClientId: e.target.value.trim() }).then(refreshFlags));
  $('#apiBase').addEventListener('change', (e) => save({ apiBase: e.target.value.trim().replace(/\/$/, '') }).then(() => { refreshFlags(); loadServer(); loadNews(); loadUpdate(); loadAccount(); }));
  document.addEventListener('click', (e) => { const o = e.target.closest('[data-open]'); if (o) sir.openUrl(o.dataset.open); });

  // ---------- versions: any Minecraft version from Mojang ----------
  const ver = { list: null, installed: [], latest: null, busyId: null, confirm: null, offline: false, loading: false };
  const fmtDate = (d) => new Date(d).toLocaleDateString(state.lang === 'en' ? 'en-GB' : state.lang);
  async function loadVersions() {
    if (ver.loading) return;
    ver.loading = true; renderVersions();
    try {
      const r = await call(sir.versions());
      Object.assign(ver, { list: r.versions, installed: r.installed.map((v) => v.id), latest: r.latest });
    } catch (e) { showError(e, loadVersions); }
    finally { ver.loading = false; renderVersions(); }
  }
  function renderVersions() {
    const box = $('#verAccount'); if (!box || !state.settings) return;
    $('#verSnapshots').checked = !!state.settings.showSnapshots;
    if (!state.session && !state.owner) {
      box.innerHTML = `<span>${esc(t('ver.noAccount'))}</span> <button type="button" class="btn" id="verLogin">${esc(t('ver.login'))}</button>`;
      $('#verLogin').onclick = () => login();
    } else {
      if (!state.session) ver.offline = true;
      box.innerHTML = `<span>${esc(ver.offline ? t('ver.offlineAs', { name: state.owner?.name ?? '', date: state.owner ? fmtDate(state.owner.verifiedAt) : '' }) : t('ver.asMs', { name: state.session?.name ?? '' }))}</span>`
        + (state.owner ? ` <label class="switch"><input type="checkbox" id="verOffline" ${ver.offline ? 'checked' : ''} ${state.session ? '' : 'disabled'}><span></span><b>${esc(t('ver.offline'))}</b></label>` : '');
      const o = $('#verOffline'); if (o) o.onchange = (e) => { ver.offline = e.target.checked; renderVersions(); };
    }
    const list = $('#verList');
    if (!ver.list) { list.innerHTML = `<p class="hint">${esc(t(ver.loading ? 'ver.loading' : 'ver.empty'))}</p>`; return; }
    const q = $('#verSearch').value.trim().toLowerCase();
    const onlyInst = $('#verInstalledOnly').checked;
    const rows = ver.list.filter((v) => (v.type === 'release' || (v.type === 'snapshot' && state.settings.showSnapshots))
      && (!q || v.id.toLowerCase().includes(q)) && (!onlyInst || ver.installed.includes(v.id))).slice(0, 150);
    if (!rows.length) { list.innerHTML = `<p class="hint">${esc(t('ver.empty'))}</p>`; return; }
    list.innerHTML = rows.map((v) => {
      const inst = ver.installed.includes(v.id), busy = ver.busyId === v.id, locked = !!ver.busyId || state.running;
      const tag = v.id === ver.latest?.release || v.id === ver.latest?.snapshot ? `<span class="pill is-ok">${esc(t('ver.latest'))}</span>` : '';
      const meta = `${esc(t(v.type === 'snapshot' ? 'ver.snapshot' : 'ver.release'))} · ${esc(fmtDate(v.releaseTime))}${inst ? ` · ${esc(t('ver.installed'))}` : ''}`;
      const side = inst
        ? `<button type="button" class="btn btn--ghost" data-vact="folder">${esc(t('ver.folder'))}</button><button type="button" class="btn btn--ghost" data-vact="remove" ${locked ? 'disabled' : ''}>${esc(ver.confirm === v.id ? t('ver.removeConfirm', { id: v.id }) : t('ver.remove'))}</button>`
        : `<button type="button" class="btn" data-vact="install" ${locked ? 'disabled' : ''}>${esc(busy ? '…' : t('ver.install'))}</button>`;
      return `<div class="ver-row" role="listitem" data-id="${esc(v.id)}">
        <div class="ver-row__name"><b>${esc(v.id)}</b> ${tag}<small>${meta}</small></div>
        <div class="ver-row__actions">${side}<button type="button" class="btn btn--gold" data-vact="play" ${locked ? 'disabled' : ''}>${esc(busy ? '…' : t('ver.play'))}</button></div></div>`;
    }).join('');
  }
  async function versionAction(id, act) {
    if (act === 'folder') { try { await call(sir.openVersionDir(id)); } catch (e) { showError(e); } return; }
    if (act === 'remove') {
      if (ver.confirm !== id) { ver.confirm = id; renderVersions(); setTimeout(() => { if (ver.confirm === id) { ver.confirm = null; renderVersions(); } }, 4000); return; }
      ver.confirm = null;
      try { ver.installed = (await call(sir.removeVersion(id, false))).map((v) => v.id); } catch (e) { showError(e); }
      renderVersions(); return;
    }
    if (act === 'play' && !state.session && !state.owner) { login(); return; }
    ver.busyId = id; renderVersions();
    try {
      if (act === 'install') ver.installed = (await call(sir.installVersion(id))).map((v) => v.id);
      else { await call(sir.playVersion(id, ver.offline || !state.session)); if (!ver.installed.includes(id)) ver.installed.push(id); }
    } catch (e) { showError(e, () => versionAction(id, act)); }
    finally { ver.busyId = null; $('#verProgress').hidden = true; renderVersions(); }
  }
  $('#verList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-vact]'); if (!b || b.disabled) return;
    versionAction(b.closest('[data-id]').dataset.id, b.dataset.vact);
  });
  $('#verSearch').addEventListener('input', renderVersions);
  $('#verInstalledOnly').addEventListener('change', renderVersions);
  $('#verSnapshots').addEventListener('change', (e) => save({ showSnapshots: e.target.checked }).then(renderVersions));
  sir.onProgress((p) => {
    if (!ver.busyId) return;
    const pct = p.total ? Math.floor((p.done / p.total) * 100) : 0;
    $('#verProgress').hidden = false;
    $('#verProgressStage').textContent = `${ver.busyId} · ${t(`ver.stage.${p.stage}`)}${p.detail ? ` · ${p.detail}` : ''}`;
    $('#verProgressPct').textContent = `${pct}%`;
    $('#verProgressBar').style.width = `${pct}%`;
  });
  $$('.rail__item[data-view="versions"]').forEach((b) => b.addEventListener('click', () => { if (!ver.list) loadVersions(); }));
  sir.onSession(() => { refreshFlags().catch(() => undefined); });

  // ---------- boot ----------
  (async () => {
    const st = await call(sir.state());
    Object.assign(state, { settings: st.settings, session: st.session, installed: st.installed, running: st.gameRunning, lang: st.settings.language, totalRamMb: st.totalRamMb, owner: st.owner, backend: st.backend, clientIdSet: st.clientIdSet });
    applyI18n(); renderAll();
    setAuthMode('login'); loadAccount();
    loadServer(); loadNews(); loadUpdate(); detectHw(); checkLauncherUpdate();
    setInterval(loadServer, 30000);
    setInterval(loadUpdate, 10 * 60000);
  })();
})();
