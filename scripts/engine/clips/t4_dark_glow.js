// 片段 · 暗场光绘（t4）：暗底上只有发光的线和发光的粒子。全部图形加色混合画在离屏层，再做两级降采样模糊加回去（bloom）。
// 核心场景：粒子团（一种心理/力量）→ 被扫成上方光带 → 下方 K 线逐根画出 → 光带垂下丝线吊住 K 线上的点 → 落点标注。
// 每个 cue 都可选：只写 candle＋mark 就是一张发光 K 线；只写 swarm 就是一团呼吸的粒子。
//
// theme: { palette: 'ember'（默认，原片的粉橙＋青）| 'ice' | 'jade' | 'violet' | { base?: 预设名, 角色: '#hex' 或 [r,g,b], … } }
//        角色：glow（底色中心光）· swarm1/swarm2/swarm3（粒子三色，占比约 5:3.5:1.5）· thread（丝线）· bead（丝线上流动的珠子）
//              up / down（涨 / 跌）· accent / hot（两种标注色）· ink（标题）· sub（英文小字）
// data:  { title?, en?（标题下的英文小字）, series?: [{o,h,l,c}]（K 线）或 [{value}]（只画线）, upDown?: 'cn'（默认，红涨，和 t3 一致）| 'us'（交换 up/down 两色，青涨）,
//          badge?（右下角标；不给 series 时自动生成示意数据并标「示意数据」）, seed? }
// cues（at 秒）：swarm（粒子团出现，text/sub 是团的标签）· band（粒子从团飞成光带，约 1.9s 飞完）
//         candle | line（数据从 at 开始逐根画出，dur 默认 2.6）· title（标题从模糊里浮出，text/sub 覆盖 data.title/en）
//         thread（data.index: [第几根…]，丝线依次垂下，data.gap 间隔默认 0.42s；最后一根落定后，两端之间的涨色被染成跌色）
//         mark（data.index 第几根，data.tone: 'accent'|'hot' 或颜色；text/sub 标注文字）· out（at 起 1s 整体暗下去）
CLIPS.t4_dark_glow = (() => {
const { clamp, lerp } = U;
const SERIF = '"NotoSerifSC-700"', LATIN = '"CormorantGaramond-500"';
const PALETTES = {
  ember:  { glow: [28, 34, 74],  swarm1: [255, 160, 100], swarm2: [255, 92, 122],  swarm3: [255, 206, 120], thread: [255, 92, 122],  bead: [255, 160, 100],
            up: [255, 92, 122],  down: [80, 205, 255],  accent: [255, 206, 120], hot: [255, 92, 122],  ink: [255, 243, 238], sub: [255, 170, 160] },
  ice:    { glow: [14, 34, 66],  swarm1: [110, 200, 255], swarm2: [70, 120, 255],  swarm3: [225, 245, 255], thread: [110, 200, 255], bead: [225, 245, 255],
            up: [255, 120, 150], down: [110, 255, 205], accent: [255, 222, 150], hot: [255, 120, 150], ink: [236, 246, 255], sub: [140, 200, 255] },
  jade:   { glow: [10, 40, 38],  swarm1: [80, 230, 170],  swarm2: [255, 200, 90],  swarm3: [235, 255, 220], thread: [80, 230, 170],  bead: [255, 200, 90],
            up: [255, 105, 90],  down: [90, 240, 170],  accent: [255, 200, 90],  hot: [255, 105, 90],  ink: [240, 255, 245], sub: [150, 230, 190] },
  violet: { glow: [40, 20, 66],  swarm1: [255, 80, 200],  swarm2: [150, 110, 255], swarm3: [255, 230, 170], thread: [200, 120, 255], bead: [255, 120, 220],
            up: [255, 80, 160],  down: [100, 200, 255],  accent: [255, 230, 170], hot: [255, 80, 160],  ink: [250, 240, 255], sub: [210, 170, 255] },
};
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mixc = (a, b, k) => a.map((v, i) => Math.round(lerp(v, b[i], k)));
function color(v, name) {   // 边界校验：'#rrggbb' 或 [r,g,b]
  if (Array.isArray(v) && v.length === 3 && v.every(x => Number.isFinite(x) && x >= 0 && x <= 255)) return v.map(Math.round);
  const m = typeof v === 'string' && /^#?([0-9a-f]{6})$/i.exec(v.trim());
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  throw new Error(`t4_dark_glow：配色「${name}」写成 '#rrggbb' 或 [r,g,b]，收到 ${JSON.stringify(v)}`);
}
function palette(p) {
  const name = typeof p === 'string' ? p : (p && p.base) || 'ember';
  if (!PALETTES[name]) throw new Error(`t4_dark_glow：没有配色预设「${name}」，可选 ${Object.keys(PALETTES).join(' / ')}`);
  const out = { ...PALETTES[name] };
  if (p && typeof p === 'object') for (const [k, v] of Object.entries(p)) {
    if (k === 'base') continue;
    if (!(k in out)) throw new Error(`t4_dark_glow：配色没有「${k}」这个角色，可选 ${Object.keys(out).join(' / ')}`);
    out[k] = color(v, k);
  }
  return out;
}
function rng(seed) { return () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const mk = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });

let L, SP, S, s, H2, h2, H4, h4, BG, GRAIN, NZ;
function sprite(c) {
  const k = mk(64, 64), x = k.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.12, rgba(c, 1)); gr.addColorStop(.35, rgba(c, .35)); gr.addColorStop(1, rgba(c, 0));
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return k;
}
function dot(c, col, x, y, r, a) { if (a <= 0 || r <= 0) return; let sp = SP.get(col.join()); if (!sp) SP.set(col.join(), sp = sprite(col)); c.globalAlpha = Math.min(1, a); c.drawImage(sp, x - r, y - r, 2 * r, 2 * r); }
function flare(c, x, y, len, a, col) {   // 十字星芒
  if (a <= 0) return; c.globalAlpha = Math.min(1, a);
  for (const [dx, dy, k] of [[1, 0, 1], [0, 1, .55]]) {
    const gr = c.createLinearGradient(x - dx * len * k, y - dy * len * k, x + dx * len * k, y + dy * len * k);
    gr.addColorStop(0, rgba(col, 0)); gr.addColorStop(.5, rgba(col, 1)); gr.addColorStop(1, rgba(col, 0));
    c.fillStyle = gr; dx ? c.fillRect(x - len, y - .7, 2 * len, 1.4) : c.fillRect(x - .7, y - len * k, 1.4, 2 * len * k);
  }
}
function text(c, str, x, y, font, col, a, { blur = 0, spacing = 0, align = 'center' } = {}) {
  if (a <= 0 || !str) return;
  c.globalAlpha = Math.min(1, a); c.filter = blur > .1 ? `blur(${blur}px)` : 'none';
  c.font = font; c.fillStyle = col; c.textAlign = align; c.letterSpacing = spacing + 'px';
  c.fillText(str, align === 'center' ? x + spacing / 2 : x, y);   // 字距加在每个字后面：居中时补回半个
  c.filter = 'none'; c.letterSpacing = '0px';
}

return {
  fonts: ['NotoSerifSC-700'],
  safe: true,
  init(ctx) {
    const { W, H, u, box, data: d } = ctx, P = palette(ctx.theme.palette), R = rng(+d.seed || 20261010);
    const gauss = () => { let a = 0; while (!a) a = R(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * R()); };
    if (d.upDown != null && d.upDown !== 'cn' && d.upDown !== 'us') throw new Error(`t4_dark_glow：upDown 只能是 'cn'（红涨，默认）或 'us'（青涨），收到 ${JSON.stringify(d.upDown)}`);
    if (d.upDown === 'us') [P.up, P.down] = [P.down, P.up];   // 预设按 A 股红涨写（和 t3 一致）；'us' 换回原片的青涨
    const LY = ctx.portrait ? { x0: .1, x1: .9, band: .215, title: .13, en: .152, c0: .40, c1: .54, cl: [.27, .36], focus: .35 }
                            : { x0: .198, x1: .802, band: .255, title: .145, en: .178, c0: .55, c1: .74, cl: [.208, .56], focus: .445 };
    const fs = ctx.portrait ? 1.25 : 1;   // 竖屏在手机上看：英文小字放大两成半
    const X = k => box.x + box.w * k, Y = k => box.y + box.h * k;
    // ---- 数据：给了 series 就用（价格单位，映射到图区），没给就按种子生成一段示意走势 ----
    const qd = ctx.of('candle', 'line')[0];
    let S0 = d.series;
    if (qd && qd.kind === 'candle' && S0 && !S0.every(r => [r.o, r.h, r.l, r.c].every(Number.isFinite))) throw new Error('t4_dark_glow：candle 的 series 每项要有数值 o/h/l/c');
    if (qd && qd.kind === 'line' && S0 && !S0.every(r => Number.isFinite(r.value ?? r.c))) throw new Error('t4_dark_glow：line 的 series 每项要有数值 value（或 c）');
    const demo = !S0;
    if (demo) {   // 示意走势：先涨、阴跌、V 底、再涨（价格越大越高）
      const knots = [[0, 0], [.13, .62], [.22, .7], [.5, .23], [.64, -.18], [.7, -.14], [.88, .45], [1, .74]];
      const at = v => { for (let i = 1; i < knots.length; i++) if (v <= knots[i][0]) { const [a0, b0] = knots[i - 1], [a1, b1] = knots[i]; return lerp(b0, b1, (v - a0) / (a1 - a0)); } };
      let prev = 0; S0 = [];
      for (let i = 0; i < 46; i++) { const c = at(i / 45) + gauss() * .045, o = prev + gauss() * .02; S0.push({ o, c, h: Math.max(o, c) + .03 + R() * .09, l: Math.min(o, c) - .03 - R() * .09 }); prev = c; }
    }
    const N = S0.length, vals = S0.flatMap(r => r.h != null ? [r.h, r.l] : [r.value ?? r.c]);
    const lo = Math.min(...vals), hi = Math.max(...vals), yv = v => lerp(Y(LY.c1), Y(LY.c0), (v - lo) / ((hi - lo) || 1));
    const C = S0.map((r, i) => {
      const x = lerp(X(LY.x0), X(LY.x1), N > 1 ? i / (N - 1) : .5), c = yv(r.c ?? r.value);
      return r.o != null ? { x, o: yv(r.o), c, hi: yv(r.h), lo: yv(r.l) } : { x, o: c, c, hi: c, lo: c };
    });
    // ---- 丝线：顶端挂在光带上（比底端更靠中，丝线往外张开） ----
    const cx0 = X(.5), bandY = Y(LY.band);
    const TH = [];
    for (const q of ctx.of('thread')) {
      const idx = [].concat((q.data && q.data.index) ?? []), gap = (q.data && q.data.gap) ?? .42;
      idx.forEach((ci, k) => {
        if (!C[ci]) throw new Error(`t4_dark_glow：thread 的 index ${ci} 超出 series（共 ${N} 根）`);
        const b = C[ci], tx = cx0 + (b.x - cx0) * .88, ty = bandY + 14 * u;
        TH.push({ ci, tx, ty, bx: b.x, by: b.c, cx: (tx + b.x) / 2 + Math.sign(b.x - cx0) * 14 * u, cy: (ty + b.c) / 2, at: q.at + k * gap });
      });
    }
    const zone = TH.length ? [Math.min(...TH.map(T => T.ci)), Math.max(...TH.map(T => T.ci))] : null;
    const tintAt = ctx.of('thread').some(q => q.data && q.data.tint) ? Math.max(...TH.map(T => T.at)) + .75 : Infinity;   // 只有 data.tint 才染：染完涨跌就分不出了
    // ---- 粒子：同一批粒子先绕成团，再被扫成光带（18 簇，光带不匀才像光） ----
    const bx0 = X(LY.x0 - .01), bx1 = X(LY.x1 + .01), PT = [];
    for (let i = 0; i < 760; i++) {
      const v = clamp((Math.floor(R() * 18) + .5) / 18 + gauss() * .022), taper = 1 - Math.pow(2 * v - 1, 4) * .65, r = R();
      const col = r < .14 ? P.swarm3 : r < .62 ? P.swarm1 : P.swarm2;
      PT.push({ bx: lerp(bx0, bx1, v) + gauss() * 6 * u, by: bandY + gauss() * 24 * u * taper, ca: R() * 7, cr: (Math.abs(gauss()) * 80 + 6) * u,
        cw: (.25 + R() * .5) * (R() < .5 ? -1 : 1), d: v * .55 + R() * .35, col, s: (col === P.swarm3 ? 5 + R() * 5 : 2.5 + R() * 4.5) * u,
        bright: col === P.swarm3 && R() < .3, f1: .4 + R() * .9, f2: .5 + R() * 1.2, ph: R() * 7, tw: 1 + R() * 3, fl: 2.5 + R() * 3.5 });
    }
    const DUST = Array.from({ length: 70 }, () => ({ x: R() * W, y: R() * H, v: (4 + R() * 10) * u, a: .1 + R() * .25, r: (1.5 + R() * 2.5) * u }));
    // ---- 标注位置：依次试「正下方 → 右侧 → 左侧 → 左上 → 右上」，取第一个不压 K 线和丝线、不压已放的标注、不进字幕区的位置 ----
    const lim = box.y + box.h * (ctx.portrait && !ctx.safe.bottom ? .7 : 1) - 24 * u;   // 竖屏没给 safe.bottom：下方三成留给口播字幕
    const hits = r => C.some(d => d.x > r[0] - 6 * u && d.x < r[1] + 6 * u && d.lo > r[2] - 8 * u && d.hi < r[3] + 8 * u)
      || TH.some(T => [.5, .6, .7, .8, .9, 1].some(v => { const [x, y] = qpt(T, v); return x > r[0] - 8 * u && x < r[1] + 8 * u && y > r[2] && y < r[3]; }));
    const overlap = (a, b) => a[0] < b[1] + 24 * u && b[0] < a[1] + 24 * u && a[2] < b[3] + 12 * u && b[2] < a[3] + 12 * u;
    const taken = [];
    const MK = ctx.of('mark').map(q => {
      const i = q.data && q.data.index, tone = (q.data && q.data.tone) || 'accent';
      if (!C[i]) throw new Error(`t4_dark_glow：mark 的 data.index ${i} 超出 series（共 ${N} 根）`);
      const m = document.createElement('canvas').getContext('2d'); m.letterSpacing = 3 * u + 'px';
      m.font = `${40 * u}px ${SERIF}`; let w = m.measureText(q.text || '').width;
      m.letterSpacing = 5 * u + 'px'; m.font = `${20 * u * fs}px ${LATIN}`; w = Math.max(w, m.measureText(q.sub || '').width);
      const b = C[i], rect = (al, ax, ly) => { const x0 = al === 'left' ? ax : al === 'right' ? ax - w : ax - w / 2; return [x0, x0 + w, ly - 38 * u, ly + 32 * u * fs + 6 * u]; };
      const ok = r => r[0] > box.x + 16 * u && r[1] < box.x + box.w - 16 * u && r[3] < lim && !hits(r) && !taken.some(o => overlap(o, r));
      let pick = [['center', b.x, b.c + 96 * u], ['left', b.x + 64 * u, b.c + 44 * u], ['right', b.x - 64 * u, b.c + 44 * u],
                  ['right', b.x - 48 * u, b.c - 54 * u], ['left', b.x + 48 * u, b.c - 54 * u]]
        .map(([al, ax, ly]) => ({ al, ax, ly, r: rect(al, ax, ly) })).find(c => ok(c.r));
      if (!pick) {   // 三处都不行：退回正下方，压到下面那几根 K 线以下，再让开已放的标注
        const ax = clamp(b.x, box.x + w / 2 + 20 * u, box.x + box.w - w / 2 - 20 * u);
        let ly = Math.max(b.c + 96 * u, Math.max(b.c, ...C.filter(d => Math.abs(d.x - ax) < w / 2 + 12 * u).map(d => d.lo)) + 54 * u);
        while (taken.some(o => overlap(o, rect('center', ax, ly)))) ly += 84 * u;
        ly = Math.min(ly, lim - 32 * u * fs - 6 * u);
        pick = { al: 'center', ax, ly, r: rect('center', ax, ly), lead: true };   // 离落点远：画一条引线连回去
      }
      taken.push(pick.r);
      return { q, b, ax: pick.ax, ly: pick.ly, al: pick.al, lead: !!pick.lead, col: tone === 'accent' || tone === 'hot' ? P[tone] : color(tone, 'mark.tone') };
    });
    L = { P, LY, X, Y, C, N, TH, MK, zone, tintAt, PT, DUST, cl: [X(LY.cl[0]), Y(LY.cl[1])], bandY, focus: [X(.5), Y(LY.focus)], fs,
      badge: d.badge ?? (demo && qd ? '示意数据' : null) };
    // ---- 画布：场景层＋两级光晕；底（近黑＋中心光＋暗角）和颗粒只做一次 ----
    SP = new Map(); S = mk(W, H); s = S.getContext('2d'); H2 = mk(W >> 1, H >> 1); h2 = H2.getContext('2d'); H4 = mk(W >> 2, H >> 2); h4 = H4.getContext('2d');
    BG = mk(W, H); const bg = BG.getContext('2d');
    bg.fillStyle = '#03040a'; bg.fillRect(0, 0, W, H);
    let gr = bg.createRadialGradient(W * .5, H * .42, 0, W * .5, H * .42, Math.max(W, H) * .55);
    gr.addColorStop(0, rgba(P.glow, .55)); gr.addColorStop(.6, rgba(P.glow.map(v => v * .45), .35)); gr.addColorStop(1, 'rgba(0,0,0,0)');
    bg.fillStyle = gr; bg.fillRect(0, 0, W, H);
    gr = bg.createRadialGradient(W * .5, H * .5, Math.min(W, H) * .35, W * .5, H * .5, Math.max(W, H) * .6);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.78)');
    bg.fillStyle = gr; bg.fillRect(0, 0, W, H);
    NZ = mk(256, 256); const nz = NZ.getContext('2d'), img = nz.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) { const v = R() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    nz.putImageData(img, 0, 0); GRAIN = null;
  },
  draw(c, t, ctx) {
    const { W, H, u } = ctx, { P } = L;
    const qo = ctx.of('out')[0], fo = qo ? 1 - MO.smooth(ctx.p(t, qo.at, 1)) : 1;
    // 场景层：相机绕画面中心匀速慢推 1 → 1.035
    s.setTransform(1, 0, 0, 1, 0, 0); s.globalAlpha = 1; s.globalCompositeOperation = 'source-over'; s.clearRect(0, 0, W, H);
    const z = 1 + .035 * t / ctx.dur, [fx, fy] = L.focus;
    s.setTransform(z, 0, 0, z, fx - fx * z, fy - fy * z);
    s.globalCompositeOperation = 'lighter'; s.lineCap = 'round'; s.lineJoin = 'round';
    for (const d of L.DUST) dot(s, [235, 240, 255], d.x, ((d.y - d.v * t) % H + H) % H, d.r, d.a);
    drawSeries(s, t, ctx); drawThreads(s, t, ctx); drawSwarm(s, t, ctx); drawText(s, t, ctx);
    // bloom：半分辨率紧光晕 + 1/4 分辨率宽光晕
    h2.clearRect(0, 0, H2.width, H2.height); h2.filter = `blur(${4 * u}px)`; h2.drawImage(S, 0, 0, H2.width, H2.height); h2.filter = 'none';
    h4.clearRect(0, 0, H4.width, H4.height); h4.filter = `blur(${6 * u}px)`; h4.drawImage(H2, 0, 0, H4.width, H4.height); h4.filter = 'none';
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    if (!ctx.alpha) c.drawImage(BG, 0, 0);
    c.globalCompositeOperation = 'lighter'; c.globalAlpha = fo;
    c.drawImage(H2, 0, 0, W, H); c.drawImage(H4, 0, 0, W, H); c.drawImage(S, 0, 0);
    if (!ctx.alpha) {   // 胶片颗粒，24fps 换一次位置
      GRAIN = GRAIN || c.createPattern(NZ, 'repeat');
      const fi = Math.round(t * ctx.FPS); c.globalAlpha = .04; c.fillStyle = GRAIN;
      c.save(); c.translate((fi * 73) % 256, (fi * 151) % 256); c.fillRect(-256, -256, W + 256, H + 256); c.restore();
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    if (L.badge) text(c, L.badge, ctx.box.x + ctx.box.w - 40 * u, ctx.portrait ? ctx.box.y + 80 * u : ctx.box.y + ctx.box.h - 36 * u,   // 竖屏右下角常被平台按钮压住，放右上
      `${22 * u * L.fs}px ${SERIF}`, rgba(P.sub, .7), fo * MO.smooth(t / .6), { align: 'right', spacing: 2 * u });
  },
};

function drawSeries(c, t, ctx) {
  const q = ctx.of('candle', 'line')[0]; if (!q) return;
  const { C, N, P, zone } = L, u = ctx.u, dur = q.dur || 2.6, h = N * MO.smooth(ctx.p(t, q.at, dur)), lp = ctx.lt(t, q.at);   // 画笔缓入缓出
  const tint = MO.smooth((t - L.tintAt) / 1.4);
  let last = null;
  if (q.kind === 'candle') {
    for (let i = 0; i < N; i++) {
      const k = clamp((h - i) / 1.6); if (k <= 0) break;
      const d = C[i], up = d.c < d.o, col = up ? (zone && i >= zone[0] && i <= zone[1] ? mixc(P.up, P.down, tint) : P.up) : P.down;
      const cy = lerp(d.o, d.c, MO.expoOut(k)), top = Math.min(d.o, cy), bh = Math.max(2 * u, Math.abs(cy - d.o)), bw = clamp((C[1] ? C[1].x - C[0].x : 20) * (ctx.portrait ? .5 : .4), 3 * u, 14 * u);
      c.globalAlpha = .9 * k; c.strokeStyle = rgba(col, 1); c.lineWidth = 1.6 * u;
      c.beginPath(); c.moveTo(d.x, lerp(cy, d.hi, k)); c.lineTo(d.x, lerp(cy, d.lo, k)); c.stroke();
      c.fillStyle = rgba(col, .28); c.fillRect(d.x - bw / 2, top, bw, bh); c.strokeRect(d.x - bw / 2, top, bw, bh);
      last = [d.x, cy];
    }
  }
  // 收盘价连线（line 模式下它就是主角：更粗、带头）
  const n = Math.min(N, Math.floor(h) + 1); if (lp <= 0 || n < 1) return;
  const frac = clamp(h - Math.floor(h)), main = q.kind === 'line';
  c.globalAlpha = main ? .95 : .55; c.strokeStyle = main ? rgba(P.ink, 1) : 'rgba(255,240,245,1)'; c.lineWidth = (main ? 3 : 1.3) * u; c.beginPath();
  const pts = C.slice(0, n).map(d => [d.x, d.c]);
  if (n < N) { const a = C[n - 1], b = C[n]; last = [lerp(a.x, b.x, frac), lerp(a.c, b.c, frac)]; pts.push(last); } else if (!last || main) last = [C[N - 1].x, C[N - 1].c];
  c.moveTo(...pts[0]);
  for (let i = 1; i < pts.length; i++) {   // line 模式过中点画二次曲线（圆滑）；K 线的收盘连线保持折线
    if (!main || i === pts.length - 1) c.lineTo(...pts[i]);
    else c.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
  }
  c.stroke();
  const drawing = 1 - MO.smooth((lp - dur) / .4);
  dot(c, [235, 240, 255], last[0], last[1], 20 * u, drawing); flare(c, last[0], last[1], 50 * u, drawing * .8, [235, 240, 255]);
}

function qpt(T, v) { const a = (1 - v) ** 2, b = 2 * v * (1 - v), w = v * v; return [a * T.tx + b * T.cx + w * T.bx, a * T.ty + b * T.cy + w * T.by]; }
function drawThreads(c, t, ctx) {
  const { P } = L, u = ctx.u;
  for (const T of L.TH) {
    const p = MO.smooth(ctx.p(t, T.at, .75)); if (p <= 0) continue;
    for (const [lw, a] of [[6, .12], [1.5, .85]]) {   // 外层软光 + 芯线
      c.globalAlpha = a; c.strokeStyle = rgba(P.thread, 1); c.lineWidth = lw * u; c.beginPath();
      for (let j = 0; j <= 48; j++) { const [x, y] = qpt(T, p * j / 48); j ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.stroke();
    }
    for (let j = 0; j < 23; j++) { const v = (j / 22 + t * .18) % 1; if (v <= p) { const [x, y] = qpt(T, v); dot(c, P.bead, x, y, 5 * u, .9); } }   // 珠子沿线往下流
    const e = ctx.lt(t, T.at) - .62;   // 0.62s 时线头离落点只剩约 4%，被线头的光点盖住，看上去已经碰到：从这里起闪
    if (e < 0) { const [x, y] = qpt(T, p); dot(c, [235, 240, 255], x, y, 14 * u, 1); continue; }
    const g = MO.expoOut(e / .12);   // 落点：0.12s 长到全尺寸再回落 + 一圈波纹，之后常亮
    dot(c, P.thread, T.bx, T.by, (46 + 30 * Math.exp(-e * 4)) * u * g, (.55 + .6 * Math.exp(-e * 3)) * g); dot(c, [235, 240, 255], T.bx, T.by, 7 * u, .9);
    if (e < .9) { c.globalAlpha = (1 - e / .9) * .6; c.strokeStyle = rgba(P.thread, 1); c.lineWidth = 1.2 * u; c.beginPath(); c.arc(T.bx, T.by, (10 + 110 * MO.expoOut(e / .9)) * u, 0, 7); c.stroke(); }
  }
}

function drawSwarm(c, t, ctx) {
  const qs = ctx.of('swarm')[0], qb = ctx.of('band')[0]; if (!qs && !qb) return;
  const t0 = qs ? qs.at : qb.at, tb = qb ? qb.at : Infinity, [cx, cy] = L.cl;
  const pos = (p, tt) => {
    const a = p.ca + p.cw * tt, rr = p.cr * (1 + .06 * Math.sin(tt * 2.1 + p.ph));
    const x0 = cx + rr * Math.cos(a), y0 = cy + rr * Math.sin(a) * .72;
    const x1 = p.bx + Math.sin(tt * p.f1 + p.ph) * 7 * ctx.u, y1 = p.by + Math.sin(tt * p.f2 + p.ph * 1.7) * 5 * ctx.u;
    const k = qs ? MO.smooth((tt - tb - p.d) / 1.0) : 1;   // 没写 swarm：光带直接在
    if (k <= 0) return [x0, y0, 0]; if (k >= 1) return [x1, y1, 1];
    const qx = lerp(x0, x1, .7), qy = lerp(y0, y1, .15), a1 = (1 - k) ** 2, b1 = 2 * k * (1 - k), c1 = k * k;   // 先往右、再往上：一束彗尾
    return [a1 * x0 + b1 * qx + c1 * x1, a1 * y0 + b1 * qy + c1 * y1, k];
  };
  for (const p of L.PT) {
    const [x, y, k] = pos(p, t);
    let a = MO.smooth((t - t0 - p.d * .6) / .8) * (.55 + .45 * Math.sin(t * p.tw + p.ph) ** 2);
    for (const T of L.TH) { const on = MO.smooth((t - T.at) / .4); if (on) a += on * .8 * Math.exp(-(((x - T.tx) / (40 * ctx.u)) ** 2 + ((y - T.ty) / (26 * ctx.u)) ** 2)); }   // 丝线挂点附近更亮
    if (a <= 0) continue;
    if (k > 0 && k < 1) { const [px, py] = pos(p, t - .1); c.globalAlpha = .3 * Math.min(1, a); c.strokeStyle = rgba(p.col, 1); c.lineWidth = p.s * .25; c.beginPath(); c.moveTo(px, py); c.lineTo(x, y); c.stroke(); }
    dot(c, p.col, x, y, p.s, a);
    if (p.bright) flare(c, x, y, p.s * p.fl, a * .45, [255, 225, 190]);
  }
}

function drawText(c, t, ctx) {
  const { P, LY, X, Y } = L, u = ctx.u, d = ctx.data;
  const qs = ctx.of('swarm')[0];
  if (qs && (qs.text || qs.sub)) {   // 团的标签：团被扫走前退场
    const qb = ctx.of('band')[0], la = MO.smooth((ctx.lt(t, qs.at) - .3) / .6) * (qb ? 1 - MO.smooth((t - qb.at + .2) / .4) : 1);
    text(c, qs.text, L.cl[0], L.cl[1] + 158 * u, `${36 * u}px ${SERIF}`, rgba(P.ink, 1), la);
    text(c, qs.sub, L.cl[0], L.cl[1] + 194 * u, `${20 * u * L.fs}px ${LATIN}`, rgba(P.sub, .9), la * .9, { spacing: 6 * u });
  }
  const qt = ctx.of('title')[0];
  if (qt) {   // 标题从模糊里浮出
    const p = MO.smooth(ctx.lt(t, qt.at) / .9), dy = (1 - p) * 12 * u;
    text(c, qt.text ?? d.title, X(.5), Y(LY.title) + dy, `${46 * u}px ${SERIF}`, rgba(P.ink, 1), p, { blur: (1 - p) * 10 * u });
    text(c, (qt.sub ?? d.en ?? '').toUpperCase(), X(.5), Y(LY.en) + dy, `${22 * u * L.fs}px ${LATIN}`, rgba(P.sub, .9), p * .9, { blur: (1 - p) * 10 * u, spacing: 9 * u });
  }
  for (const { q, b, ax, ly, al, lead, col } of L.MK) {
    const e = ctx.lt(t, q.at); if (e <= 0) continue;
    const k = MO.expoOut(e / .5), pulse = 1 + .12 * Math.sin(e * 5), [x, y] = [b.x, b.c];
    dot(c, col, x, y, 34 * pulse * k * u, .95); dot(c, [235, 240, 255], x, y, 9 * k * u, 1); flare(c, x, y, 70 * k * u, .7, col);
    const ph = (e % 1.4) / 1.4; c.globalAlpha = (1 - ph) * .5 * k; c.strokeStyle = rgba(col, 1); c.lineWidth = 1.2 * u;
    c.beginPath(); c.arc(x, y, (10 + 40 * MO.expoOut(ph)) * u, 0, 7); c.stroke();   // 波纹最大 50px：不穿过下面的字
    const ta = MO.smooth((e - .15) / .4);
    if (lead) { const y0 = b.c + 16 * u, y1 = ly - 46 * u, k2 = MO.smooth((e - .1) / .4);   // 引线：从落点往下画到文字上沿
      c.globalAlpha = .6 * k2; c.strokeStyle = rgba(col, 1); c.lineWidth = 1.2 * u; c.beginPath(); c.moveTo(b.x, y0); c.lineTo(lerp(b.x, ax, k2), lerp(y0, y1, k2)); c.stroke(); }
    text(c, q.text, ax, ly, `${40 * u}px ${SERIF}`, rgba(col, 1), ta, { spacing: 3 * u, align: al });
    text(c, q.sub, ax, ly + 32 * u * L.fs, `${20 * u * L.fs}px ${LATIN}`, rgba(col, .9), ta * .9, { spacing: 5 * u, align: al });
  }
}
})();
