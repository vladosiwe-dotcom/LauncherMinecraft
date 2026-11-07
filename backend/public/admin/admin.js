// Rift Control — staff panel for the Spell and Iron Rift server. Plain JS, no build step.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const DEMO = window.RIFT_DEMO;
  const S = { lang: 'ru', me: null, csrf: '', perms: [], view: 'overview', overview: null, consoleSeq: 0, es: null, libTab: 'mod', buildId: null, newsId: null, autoscroll: true };
  try { S.lang = localStorage.getItem('rift.lang') || 'ru'; } catch { /* storage unavailable */ }

  const t = (k, v = {}) => ((T[S.lang] && T[S.lang][k]) ?? T.ru[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const can = (p) => S.perms.includes(p);
  const fmtSize = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`);
  const locale = () => ({ ru: 'ru-RU', uk: 'uk-UA', en: 'en-GB' }[S.lang]);
  const fmtDate = (s) => (s ? new Date(s).toLocaleString(locale(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : t('never'));
  const fmtDur = (ms) => { const m = Math.floor(ms / 60000); const h = Math.floor(m / 60); const d = Math.floor(h / 24); return d ? `${d}d ${h % 24}h` : h ? `${h}h ${m % 60}m` : `${m}m`; };

  // ---------- API ----------
  async function api(method, path, body, raw) {
    if (DEMO) return DEMO.handle(method, path, body, raw);
    const headers = { 'x-rift-csrf': S.csrf };
    if (!raw && body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(`/api/admin${path}`, { method, headers, credentials: 'same-origin', body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && path !== '/login') { showLogin(); throw new Error('unauthenticated'); }
    if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status, body: j });
    return j;
  }
  function errText(e) {
    const code = String(e.message || '').split(':')[0];
    if (e.status === 403) return t('err.forbidden');
    if (T.ru[`err.${code}`]) return t(`err.${code}`, { v: String(e.message).split(':')[1] ?? '' });
    return t('err.generic', { e: e.message });
  }
  function toast(msg, isError) {
    const el = document.createElement('div');
    el.className = `toast${isError ? ' is-error' : ''}`; el.textContent = msg;
    $('#toasts').append(el); setTimeout(() => el.remove(), isError ? 6000 : 2800);
  }
  const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { if (e.message !== 'unauthenticated') toast(errText(e), true); } };

  function dialog(html, onConfirm, confirmLabel = t('confirm'), danger = false) {
    $('#dialogBox').innerHTML = `${html}<div class="dialog__actions"><button type="button" class="btn btn--ghost" data-d="cancel">${t('cancel')}</button><button type="button" class="btn ${danger ? 'btn--danger' : 'btn--gold'}" data-d="ok">${esc(confirmLabel)}</button></div>`;
    $('#dialog').hidden = false;
    $('#dialogBox [data-d=cancel]').onclick = () => { $('#dialog').hidden = true; };
    $('#dialogBox [data-d=ok]').onclick = guard(async () => { const ok = await onConfirm($('#dialogBox')); if (ok !== false) $('#dialog').hidden = true; });
    $('#dialogBox input, #dialogBox textarea')?.focus();
  }

  // ---------- shell ----------
  const NAV = [
    ['nav.g.server', [['overview', 'server.view'], ['console', 'server.view'], ['players', 'server.view']]],
    ['nav.g.content', [['library', 'server.view'], ['builds', 'server.view']]],
    ['nav.g.community', [['news', 'news.manage'], ['site', 'server.view']]],
    ['nav.g.system', [['backups', 'backups.manage'], ['users', 'users.manage'], ['audit', 'audit.view']]],
  ];
  function renderShell() {
    document.documentElement.lang = S.lang;
    $$('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
    $('#nav').innerHTML = NAV.map(([g, items]) => {
      const vis = items.filter(([, p]) => can(p));
      return vis.length ? `<div class="group">${t(g)}</div>${vis.map(([v]) => `<button type="button" data-nav="${v}" class="${S.view === v ? 'is-active' : ''}">${t(`nav.${v}`)}</button>`).join('')}` : '';
    }).join('');
    $('#langs').innerHTML = ['ru', 'uk', 'en'].map((l) => `<button type="button" data-lang="${l}" class="${l === S.lang ? 'is-active' : ''}">${l === 'uk' ? 'ua' : l}${l === 'en' ? ' β' : ''}</button>`).join('');
    $('#whoName').textContent = S.me?.username ?? '';
    $('#whoRole').textContent = S.me ? t(`role.${S.me.role}`) : '';
    $('#viewTitle').textContent = t(`nav.${S.view}`);
    $$('[data-server]').forEach((b) => { b.hidden = !can('server.control'); });
    if (DEMO) { $('#demoBanner').hidden = false; $('#demoBanner').textContent = t('demo.banner'); }
  }
  function setState(s) {
    const el = $('#serverState');
    el.dataset.s = s; el.textContent = s === 'unconfigured' ? t('state.notConfigured') : t(`state.${s}`);
    $('[data-server=start]').disabled = !(s === 'stopped' || s === 'crashed');
    $('[data-server=stop]').disabled = !(s === 'running' || s === 'starting');
    $('[data-server=restart]').disabled = s !== 'running';
  }
  function go(view) {
    S.view = view;
    try { history.replaceState(null, '', `#${view}`); } catch { /* sandboxed */ }
    $('#appView').classList.remove('nav-open');
    if (view !== 'console' && view !== 'overview') closeStream();
    renderShell(); render();
  }

  document.addEventListener('click', (e) => {
    const n = e.target.closest('[data-nav]'); if (n) go(n.dataset.nav);
    const l = e.target.closest('[data-lang]'); if (l) { S.lang = l.dataset.lang; try { localStorage.setItem('rift.lang', S.lang); } catch { /* ignore */ } renderShell(); render(); }
    const s = e.target.closest('[data-server]');
    if (s) guard(async () => {
      const a = s.dataset.server;
      const run = async () => { setState(a === 'start' ? 'starting' : 'stopping'); const r = await api('POST', `/server/${a}`); setState(r.state); refreshOverview(); };
      if (a === 'start') return run();
      dialog(`<h3>${t(`server.${a}`)}?</h3>`, run, t(`server.${a}`), a === 'stop');
    })();
  });
  $('#menuBtn').onclick = () => $('#appView').classList.toggle('nav-open');
  $('#logoutBtn').onclick = guard(async () => { await api('POST', '/logout'); closeStream(); showLogin(); });

  // ---------- login ----------
  function showLogin() {
    $('#appView').hidden = true; $('#loginView').hidden = false;
    $$('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
    if (DEMO) { $('#demoBanner').hidden = false; $('#demoBanner').textContent = t('demo.banner'); $('#lu').value = 'owner'; $('#lp').value = 'demo-password-1'; }
  }
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#loginError').hidden = true;
    try {
      const r = await api('POST', '/login', { username: $('#lu').value, password: $('#lp').value });
      S.me = r.user; S.csrf = r.csrf; S.perms = r.permissions; $('#lp').value = '';
      enterApp();
    } catch (err) {
      $('#loginError').textContent = err.status === 429 ? t('login.blocked') : t('login.invalid');
      $('#loginError').hidden = false;
    }
  });
  function enterApp() {
    $('#loginView').hidden = true; $('#appView').hidden = false;
    const fromHash = location.hash.slice(1);
    S.view = NAV.flatMap(([, i]) => i).some(([v, p]) => v === fromHash && can(p)) ? fromHash : 'overview';
    renderShell(); render(); refreshOverview();
    clearInterval(S.ovTimer); S.ovTimer = setInterval(refreshOverview, 10000);
  }
  async function refreshOverview() {
    try {
      S.overview = await api('GET', '/overview');
      setState(S.overview.server.configured ? S.overview.server.state : 'unconfigured');
      if (S.view === 'overview') renderOverview(true);
    } catch { /* shown elsewhere */ }
  }

  // ---------- console stream ----------
  function lineHtml(l) {
    const cls = l.source === 'err' || /\bERROR\b/.test(l.text) ? 'l-err' : l.source === 'panel' ? 'l-panel' : /\bWARN\b/.test(l.text) ? 'l-warn' : '';
    const time = new Date(l.at).toLocaleTimeString(locale(), { hour12: false });
    return `<div class="${cls}" data-text="${esc(l.text.toLowerCase())}"><span class="t">${time}</span>${esc(l.text)}</div>`;
  }
  function openStream(target) {
    closeStream();
    const add = (l) => {
      S.consoleSeq = Math.max(S.consoleSeq, l.seq);
      const box = $(target); if (!box) return;
      box.insertAdjacentHTML('beforeend', lineHtml(l));
      const f = $('#conFilter')?.value?.toLowerCase();
      if (f) { const last = box.lastElementChild; last.hidden = !last.dataset.text.includes(f); }
      while (box.childElementCount > 1500) box.firstElementChild.remove();
      if (S.autoscroll) box.scrollTop = box.scrollHeight;
    };
    if (DEMO) { S.es = DEMO.stream(add, setState); return; }
    const es = new EventSource('/api/admin/server/console/stream?after=0');
    es.addEventListener('line', (ev) => add(JSON.parse(ev.data)));
    es.addEventListener('state', (ev) => { setState(JSON.parse(ev.data)); refreshOverview(); });
    S.es = es;
  }
  function closeStream() { S.es?.close(); S.es = null; }

  // ---------- views ----------
  const VIEWS = {};
  async function render() {
    const c = $('#content');
    c.innerHTML = '<div class="empty">…</div>';
    try { await VIEWS[S.view](c); } catch (e) { if (e.message !== 'unauthenticated') c.innerHTML = `<div class="panel"><div class="empty">${esc(errText(e))}</div></div>`; }
  }

  function renderOverview(partial) {
    const o = S.overview; if (!o) return;
    const sv = o.server, st = o.status;
    const ram = sv.usage?.rssMb, tps = sv.tps?.tps;
    const tpsCls = tps == null ? '' : tps < 15 ? 'is-bad' : tps < 19 ? 'is-warn' : '';
    const stats = `
      <div class="stats">
        <div class="stat"><small>${t('ov.players')}</small><b>${st.online ? st.players : '—'} <em>/ ${st.online ? st.maxPlayers : '—'}</em></b><div class="bar"><i style="width:${st.online ? Math.min(100, (st.players / Math.max(1, st.maxPlayers)) * 100) : 0}%"></i></div></div>
        <div class="stat ${tpsCls}"><small>${t('ov.tps')}</small><b>${tps != null ? tps.toFixed(1) : '—'} <em>${sv.tps ? `${sv.tps.mspt.toFixed(1)} ${t('ov.mspt')}` : ''}</em></b><div class="bar"><i style="width:${tps != null ? (tps / 20) * 100 : 0}%"></i></div></div>
        <div class="stat"><small>${t('ov.cpu')}</small><b>${sv.usage?.cpu != null ? `${sv.usage.cpu}%` : '—'}</b><div class="bar"><i style="width:${Math.min(100, (sv.usage?.cpu ?? 0) / 4)}%"></i></div></div>
        <div class="stat"><small>${t('ov.ram')}</small><b>${ram != null ? `${(ram / 1024).toFixed(1)} <em>GB</em>` : '—'}</b><div class="bar"><i style="width:${ram ? Math.min(100, (ram / 12288) * 100) : 0}%"></i></div></div>
        <div class="stat"><small>${t('ov.uptime')}</small><b>${sv.startedAt ? fmtDur(Date.now() - sv.startedAt) : '—'}</b></div>
      </div>`;
    if (partial && $('#ovStats')) { $('#ovStats').innerHTML = stats; return; }
    $('#content').innerHTML = `
      <div id="ovStats">${stats}</div>
      <div class="grid3">
        <section class="panel">
          <div class="panel__head"><h2>${t('ov.console')}</h2><span class="spacer"></span><button type="button" class="btn btn--sm" data-nav="console">${t('ov.openConsole')}</button></div>
          <div class="console mini-console" id="miniConsole"></div>
        </section>
        <div style="display:flex;flex-direction:column;gap:20px;min-width:0">
          <section class="panel"><div class="panel__head"><h2>${t('ov.build')}</h2></div><div class="panel__body">
            ${o.stable ? `<div class="build-hero"><b>${esc(o.stable.version)}</b><span class="chip" data-k="published">${t('status.published')}</span></div><p class="muted">${t('ov.publishedAt')}: ${fmtDate(o.stable.publishedAt)}</p>` : `<p class="muted">${t('ov.noBuild')}</p>`}
            <dl class="kv"><dt>${t('ov.testing')}</dt><dd>${o.testing ? esc(o.testing) : '—'}</dd><dt>${t('ov.drafts')}</dt><dd>${o.drafts}</dd><dt>${t('ov.library')}</dt><dd>${o.library.mods} ${t('ov.mods')}, ${o.library.resourcepacks} ${t('ov.packs')}</dd></dl>
            <p><button type="button" class="btn btn--sm" data-nav="builds">${t('ov.openBuilds')}</button></p>
          </div></section>
          ${can('backups.manage') ? `<section class="panel"><div class="panel__head"><h2>${t('ov.backups')}</h2></div>${o.backups.length ? `<div class="table-wrap"><table><tbody>${o.backups.map((b) => `<tr><td>${fmtDate(b.createdAt)}<span class="sub">${t(`bk.reason.${b.reason}`)}</span></td><td class="num">${fmtSize(b.size)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${t('bk.empty')}</div>`}</section>` : ''}
        </div>
      </div>`;
    S.autoscroll = true;
    openStream('#miniConsole');
  }
  VIEWS.overview = async () => { if (!S.overview) await refreshOverview(); renderOverview(false); };

  VIEWS.console = async (c) => {
    c.innerHTML = `
      <section class="panel">
        <div class="panel__head"><input id="conFilter" placeholder="${t('console.filter')}" style="width:240px"><span class="spacer"></span><label class="inline"><input type="checkbox" id="conAuto" checked> ${t('console.autoscroll')}</label></div>
        <div class="console" id="console"></div>
        ${can('console.command') ? `<form class="cmd" id="cmdForm"><span>/</span><input id="cmdInput" autocomplete="off" spellcheck="false" placeholder="${esc(t('console.placeholder'))}"><button class="btn btn--gold" type="submit">${t('console.send')}</button></form>` : ''}
      </section>`;
    S.autoscroll = true;
    openStream('#console');
    $('#conAuto').onchange = (e) => { S.autoscroll = e.target.checked; };
    $('#conFilter').oninput = (e) => { const f = e.target.value.toLowerCase(); $$('#console > div').forEach((d) => { d.hidden = f && !d.dataset.text.includes(f); }); };
    const hist = []; let hi = 0;
    $('#cmdForm')?.addEventListener('submit', guard(async (e) => {
      e.preventDefault();
      const v = $('#cmdInput').value.trim(); if (!v) return;
      hist.push(v); hi = hist.length; $('#cmdInput').value = '';
      await api('POST', '/server/command', { command: v });
    }));
    $('#cmdInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' && hi > 0) { e.preventDefault(); e.target.value = hist[--hi]; }
      if (e.key === 'ArrowDown') { e.preventDefault(); hi = Math.min(hist.length, hi + 1); e.target.value = hist[hi] ?? ''; }
    });
  };

  VIEWS.players = async (c) => {
    const p = await api('GET', '/players');
    const mod = can('players.moderate');
    const online = p.online?.names ?? [];
    c.innerHTML = `
      <div class="grid2">
        <section class="panel"><div class="panel__head"><h2>${t('players.online')}</h2><span class="chip">${online.length} / ${p.online?.max ?? '—'}</span><span class="spacer"></span><button type="button" class="btn btn--sm" id="plRefresh">${t('players.refresh')}</button></div>
          ${online.length ? `<div class="table-wrap"><table><tbody>${online.map((n) => `<tr><td><b>${esc(n)}</b></td><td class="actions">${mod ? `<button type="button" class="btn btn--sm" data-pl="kick" data-name="${esc(n)}">${t('players.kick')}</button><button type="button" class="btn btn--sm btn--danger" data-pl="ban" data-name="${esc(n)}">${t('players.ban')}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${t('players.none')}</div>`}
        </section>
        <section class="panel"><div class="panel__head"><h2>${t('players.banned')}</h2><span class="spacer"></span>${mod ? `<button type="button" class="btn btn--sm btn--danger" id="banByName">${t('players.banByName')}</button>` : ''}</div>
          ${p.banned.length ? `<div class="table-wrap"><table><thead><tr><th>${t('players.name')}</th><th>${t('players.reason')}</th><th>${t('players.by')}</th><th></th></tr></thead><tbody>${p.banned.map((b) => `<tr><td><b>${esc(b.name)}</b><span class="sub">${esc(b.created ?? '')}</span></td><td>${esc(b.reason)}</td><td>${esc(b.source)}</td><td class="actions">${mod ? `<button type="button" class="btn btn--sm" data-pl="pardon" data-name="${esc(b.name)}">${t('players.pardon')}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${t('players.noBans')}</div>`}
        </section>
      </div>`;
    $('#plRefresh').onclick = () => render();
    const act = (action, name) => {
      const needsReason = action !== 'pardon';
      dialog(`<h3>${t(`players.${action}`)}${name ? `: ${esc(name)}` : ''}</h3>${name ? '' : `<label class="field"><span>${t('players.name')}</span><input id="dName" maxlength="16"></label>`}${needsReason ? `<label class="field"><span>${t('players.reason')}</span><input id="dReason" maxlength="200"></label>` : ''}`,
        async (box) => { await api('POST', `/players/${action}`, { name: name || $('#dName', box).value.trim(), reason: $('#dReason', box)?.value ?? '' }); toast(t('saved')); setTimeout(render, 500); }, t(`players.${action}`), action !== 'pardon');
    };
    $$('[data-pl]').forEach((b) => { b.onclick = () => act(b.dataset.pl, b.dataset.name); });
    $('#banByName')?.addEventListener('click', () => act('ban', ''));
  };

  const issueText = (code) => t(`issue.${code.split(':')[0]}`) + (code.includes(':') ? ` (${code.split(':').slice(1).join(':')})` : '');
  VIEWS.library = async (c) => {
    const items = await api('GET', '/library');
    const manage = can('content.manage');
    const cats = ['mod', 'resourcepack', 'shaderpack', 'config', 'other'];
    const list = items.filter((i) => i.category === S.libTab).sort((a, b) => a.name.localeCompare(b.name));
    c.innerHTML = `
      ${manage ? `<div class="drop" id="drop" tabindex="0" role="button">${t('lib.upload')}<input type="file" id="fileIn" multiple accept=".jar,.zip,.toml,.json,.json5,.cfg,.properties,.txt,.snbt" hidden></div>
      <div class="row"><label class="field" style="max-width:260px"><span>${t('lib.category')}</span><select id="upCat"><option value="">${t('lib.auto')}</option>${cats.map((x) => `<option value="${x}">${t(`lib.tab.${x}`)}</option>`).join('')}</select></label></div>` : ''}
      <section class="panel">
        <div class="panel__head"><div class="tabs">${cats.map((x) => `<button type="button" data-lt="${x}" class="${x === S.libTab ? 'is-active' : ''}">${t(`lib.tab.${x}`)} <span class="muted">${items.filter((i) => i.category === x).length}</span></button>`).join('')}</div></div>
        ${list.length ? `<div class="table-wrap"><table><thead><tr><th>${t('lib.name')}</th><th>${t('lib.version')}</th>${S.libTab === 'mod' ? `<th>${t('lib.modid')}</th><th>${t('lib.deps')}</th>` : ''}<th>${t('lib.check')}</th><th class="num">${t('lib.size')}</th><th>${t('lib.uploadedAt')}</th><th></th></tr></thead><tbody>
          ${list.map((i) => `<tr><td><b>${esc(i.name)}</b><span class="sub mono">${esc(i.fileName)}</span></td><td class="mono">${esc(i.version)}</td>
            ${S.libTab === 'mod' ? `<td class="mono">${esc(i.mod?.modId ?? '—')}</td><td class="mono">${(i.mod?.dependencies ?? []).filter((d) => !['minecraft', 'neoforge'].includes(d.modId) && d.type === 'required').map((d) => esc(d.modId)).join(', ') || '—'}</td>` : ''}
            <td>${i.errors.length ? i.errors.map((e) => `<span class="chip" data-k="error">${esc(issueText(e))}</span>`).join(' ') : i.warnings.length ? i.warnings.map((w) => `<span class="chip" data-k="warning">${esc(issueText(w))}</span>`).join(' ') : `<span class="chip" data-k="published">${t('lib.ok')}</span>`}</td>
            <td class="num">${fmtSize(i.size)}</td><td>${fmtDate(i.uploadedAt)}<span class="sub">${esc(i.uploadedBy)}</span></td>
            <td class="actions">${manage ? `<button type="button" class="btn btn--sm btn--danger" data-del="${i.id}">${t('lib.delete')}</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>` : `<div class="empty">${t('lib.empty')}</div>`}
      </section>`;
    $$('[data-lt]').forEach((b) => { b.onclick = () => { S.libTab = b.dataset.lt; render(); }; });
    $$('[data-del]').forEach((b) => { b.onclick = () => dialog(`<h3>${t('lib.delete')}?</h3>`, async () => { await api('DELETE', `/library/${b.dataset.del}`); toast(t('deleted')); render(); }, t('lib.delete'), true); });
    if (!manage) return;
    const drop = $('#drop'), input = $('#fileIn');
    const upload = guard(async (files) => {
      for (const f of files) {
        drop.textContent = `${t('lib.uploading')} ${f.name}`;
        const cat = $('#upCat').value;
        const item = await api('POST', `/library/upload?name=${encodeURIComponent(f.name)}${cat ? `&category=${cat}` : ''}`, undefined, f);
        toast(t('lib.uploaded', { name: item.name }), item.errors.length > 0);
        S.libTab = item.category;
      }
      render();
    });
    drop.onclick = () => input.click();
    drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') input.click(); };
    input.onchange = () => upload([...input.files]);
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('is-over'); };
    drop.ondragleave = () => drop.classList.remove('is-over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('is-over'); upload([...e.dataTransfer.files]); };
  };

  VIEWS.builds = async (c) => {
    if (S.buildId) return renderBuildEditor(c);
    const { builds, published } = await api('GET', '/builds');
    const manage = can('builds.manage');
    c.innerHTML = `
      <section class="panel">
        <div class="panel__head"><h2>${t('builds.list')}</h2><span class="spacer"></span>
          ${can('builds.publish') ? `<button type="button" class="btn btn--sm" id="rollback">${t('builds.rollback')}</button>` : ''}
          ${manage ? `<button type="button" class="btn btn--gold btn--sm" id="newBuild">${t('builds.new')}</button>` : ''}</div>
        ${builds.length ? `<div class="table-wrap"><table><thead><tr><th>${t('builds.version')}</th><th>${t('builds.status')}</th><th>NeoForge</th><th class="num">${t('builds.files')}</th><th>${t('builds.updated')}</th><th></th></tr></thead><tbody>
          ${builds.map((b) => `<tr><td><b>${esc(b.version)}</b>${b.id === published.stable ? ' ★' : ''}<span class="sub mono">${esc(b.id)}</span></td><td><span class="chip" data-k="${b.status}">${t(`status.${b.status}`)}</span></td><td class="mono">${esc(b.neoforgeVersion)}</td><td class="num">${b.entries.length}</td><td>${fmtDate(b.publishedAt ?? b.updatedAt)}<span class="sub">${esc(b.createdBy)}</span></td>
            <td class="actions"><button type="button" class="btn btn--sm" data-open="${b.id}">${t('builds.open')}</button>${manage ? `<button type="button" class="btn btn--sm btn--ghost" data-clone="${b.id}">${t('build.basedOn')}</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>` : `<div class="empty">${t('ov.noBuild')}</div>`}
      </section>`;
    $$('[data-open]').forEach((b) => { b.onclick = () => { S.buildId = b.dataset.open; render(); }; });
    $$('[data-clone]').forEach((b) => { b.onclick = guard(async () => { const nb = await api('POST', '/builds', { from: b.dataset.clone }); S.buildId = nb.id; render(); }); });
    $('#newBuild')?.addEventListener('click', guard(async () => { const nb = await api('POST', '/builds', {}); S.buildId = nb.id; render(); }));
    $('#rollback')?.addEventListener('click', () => dialog(`<h3>${t('builds.rollback')}?</h3><p>${t('build.publishText')}</p><label class="inline"><input type="checkbox" id="dRestart"> ${t('build.restart')}</label>`,
      async (box) => { const b = await api('POST', '/builds/rollback', { restartServer: $('#dRestart', box).checked }); toast(t('build.rolledBack', { v: b.version })); render(); }, t('builds.rollback'), true));
  };

  async function renderBuildEditor(c) {
    const [b, lib] = await Promise.all([api('GET', `/builds/${S.buildId}`), api('GET', '/library')]);
    const byId = new Map(lib.map((i) => [i.id, i]));
    const editable = can('builds.manage') && (b.status === 'draft' || b.status === 'testing');
    const dis = editable ? '' : 'disabled';
    const errors = b.issues.filter((i) => i.level === 'error');
    const inBuild = new Set(b.entries.map((e) => e.itemId));
    const addable = lib.filter((i) => !inBuild.has(i.id) && !i.errors.length);
    const packs = b.entries.map((e) => byId.get(e.itemId)).filter((i) => i?.category === 'resourcepack');
    c.innerHTML = `
      <div class="row"><button type="button" class="btn btn--ghost btn--sm" id="back">← ${t('builds.list')}</button></div>
      <section class="panel">
        <div class="panel__head"><h2>${t('build.edit', { v: esc(b.version) })}</h2><span class="chip" data-k="${b.status}">${t(`status.${b.status}`)}</span><span class="spacer"></span>
          ${editable && b.status === 'draft' ? `<button type="button" class="btn btn--sm btn--ghost" id="delBuild">${t('build.delete')}</button>` : ''}
          ${editable && can('builds.publish') && b.status === 'draft' ? `<button type="button" class="btn btn--sm btn--violet" id="toTesting" ${errors.length ? 'disabled' : ''}>${t('build.toTesting')}</button>` : ''}
          ${editable && can('builds.publish') ? `<button type="button" class="btn btn--sm btn--gold" id="publish" ${errors.length ? 'disabled' : ''}>${t('build.publish')}</button>` : ''}</div>
        <div class="panel__body" style="display:flex;flex-direction:column;gap:16px">
          ${editable ? '' : `<p class="muted">${t('build.locked')}</p>`}
          ${b.status === 'testing' ? `<p class="muted">${t('build.testingInfo')}</p>` : ''}
          <div class="row">
            <label class="field"><span>${t('builds.version')}</span><input id="bVersion" value="${esc(b.version)}" ${dis} pattern="\\d+\\.\\d+\\.\\d+"></label>
            <label class="field"><span>${t('build.neoforge')}</span><input id="bNeo" value="${esc(b.neoforgeVersion)}" ${dis}></label>
            ${editable ? `<button type="button" class="btn" id="saveMeta">${t('build.save')}</button>` : ''}
          </div>
          <div class="field"><span>${t('build.changelog')}</span>
            <div class="tabs" id="clTabs">${['ru', 'uk', 'en'].map((l, i) => `<button type="button" data-cl="${l}" class="${i === 0 ? 'is-active' : ''}">${l.toUpperCase()}</button>`).join('')}</div>
            ${['ru', 'uk', 'en'].map((l, i) => `<textarea data-clt="${l}" ${i ? 'hidden' : ''} ${dis}>${esc(b.changelog[l])}</textarea>`).join('')}
          </div>
          <div class="field"><span>${t('build.resourcePacks')}</span>
            <div class="row">${packs.length ? packs.map((p) => `<label class="inline"><input type="checkbox" data-rp="${esc(p.fileName)}" ${b.resourcePacks.includes(p.fileName) ? 'checked' : ''} ${dis}> ${esc(p.name)}</label>`).join('') : '<span class="muted">—</span>'}</div>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel__head"><h2>${t('build.check')}</h2>${errors.length ? `<span class="chip" data-k="error">${errors.length}</span>` : ''}${b.issues.length - errors.length ? `<span class="chip" data-k="warning">${b.issues.length - errors.length}</span>` : ''}</div>
        ${b.issues.length ? `<div class="issues">${b.issues.map((i) => `<div class="issue"><span class="chip" data-k="${i.level}">${i.level === 'error' ? '✕' : '!'}</span><b>${esc(issueText(i.code))}</b><span>${esc(i.item ?? '')}</span><span class="mono">${esc(i.detail ?? '')}</span></div>`).join('')}</div>` : `<div class="ok-line">✓ ${t('build.noIssues')}</div>`}
      </section>

      <section class="panel">
        <div class="panel__head"><h2>${t('build.files')}</h2><span class="chip">${b.entries.length}</span><span class="spacer"></span>
          ${editable ? `<select id="addItem" style="max-width:320px"><option value="">${t('build.add')}…</option>${addable.map((i) => `<option value="${i.id}">${esc(t(`lib.tab.${i.category}`))} · ${esc(i.name)} ${esc(i.version)}</option>`).join('')}</select><button type="button" class="btn btn--sm" id="addBtn">${t('build.addBtn')}</button>` : ''}</div>
        <div class="table-wrap"><table><thead><tr><th>${t('lib.name')}</th><th>${t('build.path')}</th><th>${t('build.side')}</th><th>${t('build.required')}</th><th>${t('build.mode')}</th><th>${t('build.presets')}</th><th></th></tr></thead><tbody>
          ${b.entries.map((e) => { const i = byId.get(e.itemId); return `<tr data-path="${esc(e.path)}">
            <td><b>${esc(i?.name ?? '?')}</b><span class="sub mono">${esc(i?.version ?? '')}</span></td><td class="mono">${esc(e.path)}</td>
            <td><select data-f="side" ${dis}>${['both', 'client', 'server'].map((s) => `<option value="${s}" ${e.side === s ? 'selected' : ''}>${t(`side.${s}`)}</option>`).join('')}</select></td>
            <td><input type="checkbox" data-f="required" ${e.required ? 'checked' : ''} ${dis} aria-label="${t('build.required')}"></td>
            <td><select data-f="mode" ${dis}>${['replace', 'keep-user'].map((m) => `<option value="${m}" ${e.mode === m ? 'selected' : ''}>${t(`mode.${m}`)}</option>`).join('')}</select></td>
            <td class="presets-cell">${['minimal', 'balanced', 'high', 'ultra'].map((p) => `<label class="inline" title="${p}"><input type="checkbox" data-preset="${p}" ${e.presets?.includes(p) ? 'checked' : ''} ${dis}>${p[0].toUpperCase()}</label>`).join('')}</td>
            <td class="actions">${editable ? `<button type="button" class="btn btn--sm btn--ghost" data-rm>${t('build.remove')}</button>` : ''}</td></tr>`; }).join('')}
        </tbody></table></div>
      </section>`;

    const reload = (nb) => { if (nb) render(); };
    $('#back').onclick = () => { S.buildId = null; render(); };
    $$('[data-cl]').forEach((x) => { x.onclick = () => { $$('[data-cl]').forEach((y) => y.classList.toggle('is-active', y === x)); $$('[data-clt]').forEach((ta) => { ta.hidden = ta.dataset.clt !== x.dataset.cl; }); }; });
    if (!editable) return;
    $('#saveMeta').onclick = guard(async () => {
      const changelog = Object.fromEntries($$('[data-clt]').map((ta) => [ta.dataset.clt, ta.value]));
      const resourcePacks = $$('[data-rp]').filter((x) => x.checked).map((x) => x.dataset.rp);
      reload(await api('PATCH', `/builds/${b.id}`, { version: $('#bVersion').value.trim(), neoforgeVersion: $('#bNeo').value.trim(), changelog, resourcePacks })); toast(t('saved'));
    });
    $$('[data-rp]').forEach((x) => { x.onchange = () => $('#saveMeta').click(); });
    $('#addBtn').onclick = guard(async () => { const id = $('#addItem').value; if (id) reload(await api('POST', `/builds/${b.id}/items`, { itemId: id })); });
    $$('tr[data-path]').forEach((tr) => {
      const path = tr.dataset.path;
      const patch = guard(async () => {
        const presets = $$('[data-preset]', tr).filter((x) => x.checked).map((x) => x.dataset.preset);
        reload(await api('PATCH', `/builds/${b.id}/items`, { path, side: $('[data-f=side]', tr).value, required: $('[data-f=required]', tr).checked, mode: $('[data-f=mode]', tr).value, presets }));
      });
      $$('select, input', tr).forEach((x) => { x.onchange = patch; });
      $('[data-rm]', tr).onclick = guard(async () => reload(await api('DELETE', `/builds/${b.id}/items?path=${encodeURIComponent(path)}`)));
    });
    $('#delBuild')?.addEventListener('click', () => dialog(`<h3>${t('build.delete')}?</h3>`, async () => { await api('DELETE', `/builds/${b.id}`); S.buildId = null; render(); }, t('build.delete'), true));
    $('#toTesting')?.addEventListener('click', guard(async () => { reload(await api('POST', `/builds/${b.id}/testing`)); toast(t('status.testing')); }));
    $('#publish')?.addEventListener('click', () => dialog(`<h3>${t('build.publishTitle', { v: esc(b.version) })}</h3><p>${t('build.publishText')}</p><label class="inline"><input type="checkbox" id="dRestart"> ${t('build.restart')}</label>`,
      async (box) => { const nb = await api('POST', `/builds/${b.id}/publish`, { restartServer: $('#dRestart', box).checked }); toast(t('build.published', { v: nb.version })); render(); refreshOverview(); }, t('build.publish')));
  }

  VIEWS.news = async (c) => {
    const items = (await api('GET', '/news')).sort((a, b) => b.date.localeCompare(a.date));
    const cur = items.find((n) => n.id === S.newsId);
    const editor = (n) => `
      <section class="panel"><div class="panel__head"><h2>${n ? esc(n.title.ru || '…') : t('news.new')}</h2></div><form class="panel__body" id="newsForm" style="display:flex;flex-direction:column;gap:14px">
        <div class="row">
          <label class="field"><span>${t('news.tag')}</span><select id="nTag">${['update', 'event', 'maintenance', 'news'].map((x) => `<option value="${x}" ${n?.tag === x ? 'selected' : ''}>${t(`tag.${x}`)}</option>`).join('')}</select></label>
          <label class="field"><span>${t('news.date')}</span><input type="date" id="nDate" value="${esc(n?.date ?? new Date().toISOString().slice(0, 10))}"></label>
          <label class="inline"><input type="checkbox" id="nPub" ${n?.published ? 'checked' : ''}> ${t('news.published')}</label>
        </div>
        ${['ru', 'uk', 'en'].map((l) => `<fieldset style="border:1px solid var(--line);padding:12px;display:flex;flex-direction:column;gap:8px;min-width:0"><legend class="muted">${l.toUpperCase()}${l === 'en' ? ' (Beta)' : ''}</legend>
          <input data-nt="${l}" placeholder="${t('news.title')}" value="${esc(n?.title[l] ?? '')}"><textarea data-nb="${l}" placeholder="${t('news.body')}">${esc(n?.body[l] ?? '')}</textarea></fieldset>`).join('')}
        <div class="row"><button class="btn btn--gold" type="submit">${t('news.save')}</button>${n ? `<button type="button" class="btn btn--danger" id="nDel">${t('news.delete')}</button>` : ''}</div>
      </form></section>`;
    c.innerHTML = `<div class="grid3">${editor(cur)}
      <section class="panel"><div class="panel__head"><h2>${t('nav.news')}</h2><span class="spacer"></span><button type="button" class="btn btn--sm" id="nNew">${t('news.new')}</button></div>
        ${items.length ? `<div class="table-wrap"><table><tbody>${items.map((n) => `<tr><td><button type="button" class="btn btn--ghost btn--sm" data-nid="${n.id}" style="white-space:normal;text-align:left">${esc(n.title.ru || n.title.uk || '—')}</button><span class="sub">${esc(n.date)} · ${t(`tag.${n.tag}`)}</span></td><td><span class="chip" data-k="${n.published ? 'published' : 'draft'}">${t(n.published ? 'news.published' : 'news.draft')}</span></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${t('news.empty')}</div>`}
      </section></div>`;
    $('#nNew').onclick = () => { S.newsId = null; render(); };
    $$('[data-nid]').forEach((b) => { b.onclick = () => { S.newsId = b.dataset.nid; render(); }; });
    $('#newsForm').addEventListener('submit', guard(async (e) => {
      e.preventDefault();
      const body = { tag: $('#nTag').value, date: $('#nDate').value, published: $('#nPub').checked, title: Object.fromEntries($$('[data-nt]').map((x) => [x.dataset.nt, x.value])), body: Object.fromEntries($$('[data-nb]').map((x) => [x.dataset.nb, x.value])) };
      const n = cur ? await api('PATCH', `/news/${cur.id}`, body) : await api('POST', '/news', body);
      S.newsId = n.id; toast(t('saved')); render();
    }));
    $('#nDel')?.addEventListener('click', () => dialog(`<h3>${t('news.delete')}?</h3>`, async () => { await api('DELETE', `/news/${cur.id}`); S.newsId = null; render(); }, t('news.delete'), true));
  };

  VIEWS.site = async (c) => {
    const s = await api('GET', '/site');
    const dis = can('site.manage') ? '' : 'disabled';
    c.innerHTML = `<section class="panel"><form class="panel__body" id="siteForm" style="display:flex;flex-direction:column;gap:16px;max-width:860px">
      <label class="field"><span>${t('site.motd')}</span><input id="sMotd" maxlength="120" value="${esc(s.motd)}" ${dis}></label>
      <div class="row"><label class="field" style="max-width:200px"><span>${t('site.maxPlayers')}</span><input type="number" id="sMax" min="1" max="1000" value="${s.maxPlayers}" ${dis}></label><label class="inline"><input type="checkbox" id="sWl" ${s.whitelist ? 'checked' : ''} ${dis}> ${t('site.whitelist')}</label></div>
      ${['ru', 'uk', 'en'].map((l) => `<label class="field"><span>${t('site.rules')} · ${l.toUpperCase()}</span><textarea data-rl="${l}" rows="8" ${dis}>${esc(s.rules[l])}</textarea></label>`).join('')}
      ${dis ? '' : `<div><button class="btn btn--gold" type="submit">${t('site.save')}</button></div>`}
    </form></section>`;
    $('#siteForm').addEventListener('submit', guard(async (e) => {
      e.preventDefault();
      const r = await api('PUT', '/site', { motd: $('#sMotd').value, maxPlayers: Number($('#sMax').value), whitelist: $('#sWl').checked, rules: Object.fromEntries($$('[data-rl]').map((x) => [x.dataset.rl, x.value])) });
      toast(r.restartRequired ? t('site.restart') : t('saved'));
    }));
  };

  VIEWS.backups = async (c) => {
    const list = await api('GET', '/backups');
    c.innerHTML = `<section class="panel"><div class="panel__head"><h2>${t('nav.backups')}</h2><span class="spacer"></span><button type="button" class="btn btn--gold btn--sm" id="bkNew">${t('bk.create')}</button></div>
      ${list.length ? `<div class="table-wrap"><table><thead><tr><th>${t('bk.date')}</th><th>${t('bk.reason')}</th><th>${t('bk.name')}</th><th class="num">${t('bk.size')}</th><th></th></tr></thead><tbody>
        ${list.map((b) => `<tr><td>${fmtDate(b.createdAt)}</td><td>${t(`bk.reason.${b.reason}`)}</td><td class="mono">${esc(b.name)}</td><td class="num">${fmtSize(b.size)}</td>
          <td class="actions">${can('backups.restore') ? `<button type="button" class="btn btn--sm" data-restore="${esc(b.name)}">${t('bk.restore')}</button>` : ''}<button type="button" class="btn btn--sm btn--danger" data-bdel="${esc(b.name)}">${t('bk.delete')}</button></td></tr>`).join('')}
      </tbody></table></div>` : `<div class="empty">${t('bk.empty')}</div>`}</section>`;
    $('#bkNew').onclick = guard(async (e) => { e.target.disabled = true; await api('POST', '/backups'); toast(t('bk.created')); render(); });
    $$('[data-bdel]').forEach((b) => { b.onclick = () => dialog(`<h3>${t('bk.delete')}?</h3><p class="mono">${esc(b.dataset.bdel)}</p>`, async () => { await api('DELETE', `/backups/${encodeURIComponent(b.dataset.bdel)}`); render(); }, t('bk.delete'), true); });
    $$('[data-restore]').forEach((b) => { b.onclick = () => dialog(`<h3>${t('bk.restoreTitle')}</h3><p>${t('bk.restoreText')}</p><p class="mono">${esc(b.dataset.restore)}</p>`, async () => { await api('POST', `/backups/${encodeURIComponent(b.dataset.restore)}/restore`); toast(t('saved')); render(); }, t('bk.restore'), true); });
  };

  VIEWS.users = async (c) => {
    const users = await api('GET', '/users');
    c.innerHTML = `<div class="grid3">
      <section class="panel"><div class="panel__head"><h2>${t('nav.users')}</h2></div><div class="table-wrap"><table><thead><tr><th>${t('users.username')}</th><th>${t('users.role')}</th><th>${t('users.lastLogin')}</th><th></th></tr></thead><tbody>
        ${users.map((u) => `<tr data-uid="${u.id}"><td><b>${esc(u.username)}</b>${u.disabled ? ` <span class="muted">(${t('users.disabled')})</span>` : ''}</td>
          <td><select data-role ${u.id === S.me.id ? 'disabled' : ''}>${['moderator', 'admin', 'owner'].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${t(`role.${r}`)}</option>`).join('')}</select></td>
          <td>${fmtDate(u.lastLoginAt)}</td>
          <td class="actions"><button type="button" class="btn btn--sm" data-pw>${t('users.reset')}</button>${u.id === S.me.id ? '' : `<button type="button" class="btn btn--sm" data-dis="${u.disabled ? 0 : 1}">${t(u.disabled ? 'users.enable' : 'users.disable')}</button><button type="button" class="btn btn--sm btn--danger" data-udel>${t('users.delete')}</button>`}</td></tr>`).join('')}
      </tbody></table></div></section>
      <div style="display:flex;flex-direction:column;gap:20px;min-width:0">
        <section class="panel"><div class="panel__head"><h2>${t('users.new')}</h2></div><form class="panel__body" id="uForm" style="display:flex;flex-direction:column;gap:12px">
          <label class="field"><span>${t('users.username')}</span><input id="uName" required pattern="[\\w.\\-]{3,32}" autocomplete="off"></label>
          <label class="field"><span>${t('users.role')}</span><select id="uRole"><option value="moderator">${t('role.moderator')}</option><option value="admin">${t('role.admin')}</option><option value="owner">${t('role.owner')}</option></select></label>
          <label class="field"><span>${t('users.password')}</span><input id="uPw" type="password" required minlength="12" autocomplete="new-password"></label>
          <div><button class="btn btn--gold" type="submit">${t('users.create')}</button></div></form></section>
        <section class="panel"><div class="panel__head"><h2>${t('users.perms')}</h2></div><div class="panel__body"><dl class="kv">${['owner', 'admin', 'moderator'].map((r) => `<dt><span class="chip" data-k="${r}">${t(`role.${r}`)}</span></dt><dd>${t(`perm.${r}`)}</dd>`).join('')}</dl></div></section>
      </div></div>`;
    $('#uForm').addEventListener('submit', guard(async (e) => { e.preventDefault(); await api('POST', '/users', { username: $('#uName').value, role: $('#uRole').value, password: $('#uPw').value }); toast(t('saved')); render(); }));
    $$('tr[data-uid]').forEach((tr) => {
      const id = tr.dataset.uid;
      $('[data-role]', tr).onchange = guard(async (e) => { await api('PATCH', `/users/${id}`, { role: e.target.value }); toast(t('saved')); });
      $('[data-pw]', tr).onclick = () => dialog(`<h3>${t('users.reset')}</h3><label class="field"><span>${t('users.password')}</span><input id="dPw" type="password" minlength="12" autocomplete="new-password"></label>`, async (box) => { await api('PATCH', `/users/${id}`, { password: $('#dPw', box).value }); toast(t('saved')); });
      $('[data-dis]', tr)?.addEventListener('click', guard(async (e) => { await api('PATCH', `/users/${id}`, { disabled: e.target.dataset.dis === '1' }); render(); }));
      $('[data-udel]', tr)?.addEventListener('click', () => dialog(`<h3>${t('users.delete')}?</h3>`, async () => { await api('DELETE', `/users/${id}`); render(); }, t('users.delete'), true));
    });
  };

  VIEWS.audit = async (c) => {
    const rows = await api('GET', '/audit');
    c.innerHTML = `<section class="panel">${rows.length ? `<div class="table-wrap"><table><thead><tr><th>${t('audit.at')}</th><th>${t('audit.user')}</th><th>${t('audit.action')}</th><th>${t('audit.detail')}</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${fmtDate(r.at)}</td><td>${esc(r.user)}</td><td class="mono">${esc(r.action)}</td><td>${esc(r.detail ?? '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">—</div>'}</section>`;
  };

  // ---------- boot ----------
  (async () => {
    try {
      const r = await api('GET', '/me');
      S.me = r.user; S.csrf = r.csrf; S.perms = r.permissions;
      enterApp();
    } catch { showLogin(); }
  })();
})();
