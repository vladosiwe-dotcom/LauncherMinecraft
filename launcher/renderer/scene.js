// Background: blocky ancient ruins under a sky torn by a glowing rift, with rising pixel motes.
// Everything is snapped to an 8px grid so it reads as Minecraft, not as a generic fantasy gradient.
(() => {
  const cv = document.getElementById('scene');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const P = 8;
  let W = 0, H = 0, ruins = [], motes = [], crack = [], t = 0;

  function rnd(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

  function build() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const r = rnd(1337);
    ruins = [];
    // three depth layers of towers and broken walls
    [[0.62, '#120f1c', 0.5], [0.72, '#0c0a13', 0.8], [0.84, '#07060b', 1]].forEach(([base, color, scale], layer) => {
      let x = -P * 4;
      while (x < W + P * 4) {
        const w = Math.round((3 + r() * 9) * scale) * P;
        const tall = r() < 0.22;
        const h = Math.round(((tall ? 18 : 4) + r() * (tall ? 16 : 8)) * scale) * P;
        const y = Math.round((H * base) / P) * P;
        ruins.push({ x, y: y - h, w, h, color, layer, battl: r() < 0.6, broken: r() < 0.4, win: tall && r() < 0.7 });
        x += w + Math.round(r() * 3) * P;
      }
    });
    // rift crack: jagged vertical line in the sky right of centre
    crack = [];
    let cx = Math.round((W * 0.68) / P) * P, cy = -P;
    while (cy < H * 0.6) { crack.push([cx, cy]); cy += P * (2 + Math.floor(r() * 3)); cx += P * (Math.floor(r() * 5) - 2); }
    motes = Array.from({ length: Math.round(W / 14) }, () => newMote(r, true));
  }
  function newMote(r, anywhere) {
    return { x: Math.random() * W, y: anywhere ? Math.random() * H : H + 10, s: Math.random() < 0.8 ? 2 : 4, v: 0.15 + Math.random() * 0.5, hue: Math.random() < 0.7 ? 'violet' : Math.random() < 0.5 ? 'blue' : 'gold', ph: Math.random() * 6.28 };
  }

  function draw() {
    t += 1;
    // sky
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a0814'); g.addColorStop(0.45, '#1a1030'); g.addColorStop(0.7, '#120c1f'); g.addColorStop(1, '#050408');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // rift glow
    const pulse = reduce ? 0.8 : 0.75 + Math.sin(t / 60) * 0.2;
    const last = crack[Math.floor(crack.length / 2)] || [W * 0.68, H * 0.3];
    const rg = ctx.createRadialGradient(last[0], last[1], 10, last[0], last[1], H * 0.7);
    rg.addColorStop(0, `rgba(122,80,255,${0.38 * pulse})`); rg.addColorStop(0.4, `rgba(60,140,255,${0.12 * pulse})`); rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    // crack as stacked pixel blocks
    for (let i = 0; i < crack.length - 1; i++) {
      const [x0, y0] = crack[i], [x1, y1] = crack[i + 1];
      const steps = Math.max(1, Math.abs(y1 - y0) / P);
      for (let s = 0; s <= steps; s++) {
        const x = Math.round((x0 + ((x1 - x0) * s) / steps) / P) * P;
        const y = y0 + s * P;
        ctx.fillStyle = `rgba(110,70,255,${0.35 * pulse})`; ctx.fillRect(x - P * 2, y, P * 5, P);
        ctx.fillStyle = `rgba(120,210,255,${0.7 * pulse})`; ctx.fillRect(x - P, y, P * 3, P);
        ctx.fillStyle = '#efe6ff'; ctx.fillRect(x, y, P, P);
      }
    }

    // ruins
    for (const b of ruins) {
      ctx.fillStyle = b.color; ctx.fillRect(b.x, b.y, b.w, H - b.y);
      if (b.battl) for (let x = b.x; x < b.x + b.w; x += P * 2) ctx.fillRect(x, b.y - P, P, P);
      if (b.broken) { ctx.clearRect(b.x + b.w - P * 2, b.y - P, P * 2, P * 3); ctx.fillStyle = b.color; }
      if (b.win) {
        const glow = reduce ? 0.6 : 0.45 + 0.25 * Math.sin(t / 40 + b.x);
        ctx.fillStyle = `rgba(154,107,255,${glow * (b.layer === 2 ? 1 : 0.6)})`;
        ctx.fillRect(b.x + Math.floor(b.w / P / 2) * P, b.y + P * 3, P, P * 2);
      }
      // top edge light from the rift
      ctx.fillStyle = 'rgba(154,107,255,0.08)'; ctx.fillRect(b.x, b.y, b.w, 2);
    }

    // motes
    for (const m of motes) {
      if (!reduce) { m.y -= m.v; m.x += Math.sin((t + m.ph * 60) / 50) * 0.3; }
      if (m.y < -10) Object.assign(m, newMote(null, false));
      const a = 0.4 + 0.4 * Math.sin(t / 20 + m.ph);
      ctx.fillStyle = m.hue === 'violet' ? `rgba(170,130,255,${a})` : m.hue === 'blue' ? `rgba(110,210,255,${a})` : `rgba(243,223,166,${a})`;
      ctx.fillRect(Math.round(m.x), Math.round(m.y), m.s, m.s);
    }
    // vignette
    const v = ctx.createRadialGradient(W * 0.4, H * 0.45, H * 0.3, W * 0.5, H * 0.5, W * 0.8);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.65)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    if (!reduce && !document.hidden) requestAnimationFrame(draw);
  }
  addEventListener('resize', () => { build(); if (reduce) draw(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !reduce) requestAnimationFrame(draw); });
  build(); draw();
})();
