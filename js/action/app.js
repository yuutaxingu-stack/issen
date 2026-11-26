/* =====================================================================
   一閃（対戦アクション） 稽古場: 描画・操作・木偶（練習相手）
   計算は sim.js（IssenAction）。ここは見せ方と入力だけ。
   ===================================================================== */
(function(){
'use strict';
const A = window.IssenAction, FP = A.FP, MV = A.MV;
const cv = document.getElementById('cv'), cx = cv.getContext('2d');
const DISPLAY = "'Yuji Syuku','Hiragino Mincho ProN','Yu Mincho',serif";
const UIF = "'Zen Kaku Gothic New','Hiragino Sans',sans-serif";
const INK = '#141512', PALE = '#efe8d6';
const COL = [{ main: '#c8372d', light: '#f3a294', name: '朱' }, { main: '#2c4f96', light: '#a9c1f0', name: '藍' }];
const TIERC = { '並': '#d9d3c4', '上': '#9cc4ea', '極': '#e8c35a', '幻': '#e9b8ff', '絶': '#ffffff', '分': '#bdb6a6' };
const KN = ['〇','一','二','三','四','五','六','七','八','九','十'];
const kn = n => n <= 10 ? KN[n] : n < 20 ? '十' + KN[n - 10] : String(n);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rad = d => d * Math.PI / 180;

let W = 0, H = 0, DPR = 1;
function resize(){ DPR = Math.min(2, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight; cv.width = W * DPR; cv.height = H * DPR; cv.style.width = W + 'px'; cv.style.height = H + 'px'; layoutPad(); }
addEventListener('resize', resize);

/* ---------- 設定 ---------- */
const OPT = { dummy: 'stand', frames: true, refill: true, boxes: false };
try { Object.assign(OPT, JSON.parse(localStorage.getItem('issen-action-opt') || '{}')); } catch (e) {}
function saveOpt(){ try { localStorage.setItem('issen-action-opt', JSON.stringify(OPT)); } catch (e) {} }
const DUMMY = [['stand', '立つだけ'], ['guard', '守り続ける'], ['jump', '跳び回る'], ['mash', '暴れる']];

/* ---------- 入力 ---------- */
const key = {};
addEventListener('keydown', e => { key[e.code] = true; if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault(); });
addEventListener('keyup', e => { key[e.code] = false; });
const pad = { stick: null, btn: {}, owners: {}, cs: null, cPend: null };
let CS = { x: 0, y: 0, r: 40 };
let BTN = [];
function layoutPad(){
  const r = clamp(Math.min(W, H) * 0.085, 30, 54);
  BTN = [
    { id: 'A', label: '斬', x: W - r * 2.7, y: H - r * 1.55, r: r * 1.12 },
    { id: 'J', label: '跳', x: W - r * 1.15, y: H - r * 2.95, r: r * 0.92 },
    { id: 'G', label: '守', x: W - r * 4.95, y: H - r * 1.25, r: r * 0.92 },
  ];
  CS = { x: W - r * 4.35, y: H - r * 3.45, r: r * 0.95 };
}
function inBtn(x, y){ for (const b of BTN) { const dx = x - b.x, dy = y - b.y; if (dx * dx + dy * dy <= (b.r * 1.25) ** 2) return b.id; } return null; }
cv.addEventListener('pointerdown', e => {
  e.preventDefault(); cv.setPointerCapture(e.pointerId);
  if (FX.finish && FX.finish.t > 40) { /* 演出中のタップで早送り */ FX.finish.t = Math.max(FX.finish.t, 150); }
  { const dx = e.clientX - CS.x, dy = e.clientY - CS.y;
    if (dx * dx + dy * dy <= CS.r * CS.r && !pad.cs) { pad.cs = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY, fired: false }; pad.owners[e.pointerId] = 'C'; return; } }
  const b = inBtn(e.clientX, e.clientY);
  if (b) { pad.btn[b] = true; pad.owners[e.pointerId] = b; return; }
  if (e.clientX < W * 0.5 && !pad.stick) { pad.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY }; pad.owners[e.pointerId] = 'S'; }
}, { passive: false });
cv.addEventListener('pointermove', e => {
  if (pad.stick && pad.stick.id === e.pointerId) { pad.stick.x = e.clientX; pad.stick.y = e.clientY; }
  const c = pad.cs;
  if (c && c.id === e.pointerId) {
    c.x = e.clientX; c.y = e.clientY;
    const dx = c.x - c.ox, dy = c.y - c.oy;
    if (!c.fired && Math.hypot(dx, dy) > CS.r * 0.45) { c.fired = true; pad.cPend = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'r' : 'l') : (dy < 0 ? 'u' : 'd'); c.dir = pad.cPend; }
  }
});
function upPtr(e){ const o = pad.owners[e.pointerId];
  if (o === 'S') pad.stick = null;
  else if (o === 'C') { if (pad.cs && !pad.cs.fired) pad.cPend = 'n'; pad.cs = null; } // 弾かずに離したら向きなしの斬
  else if (o) pad.btn[o] = false;
  delete pad.owners[e.pointerId]; }
cv.addEventListener('pointerup', upPtr); cv.addEventListener('pointercancel', upPtr);
const stk = { hist: [0, 0, 0, 0] }, kb = { L: -99, R: -99, pl: false, pr: false };
let stepN = 0;
function readP0(){
  stepN++;
  const k = c => !!key[c];
  const i = { L: k('KeyA') || k('ArrowLeft'), R: k('KeyD') || k('ArrowRight'), U: k('KeyW') || k('ArrowUp'), D: k('KeyS') || k('ArrowDown'),
    A: k('KeyJ') || k('KeyZ') || !!pad.btn.A, J: k('KeyK') || k('KeyX') || k('Space') || !!pad.btn.J, G: k('KeyL') || k('KeyC') || !!pad.btn.G };
  // キーボード: 同じ向きを素早く二回押すとダッシュ
  const kl = k('KeyA') || k('ArrowLeft'), kr = k('KeyD') || k('ArrowRight');
  if (kl && !kb.pl) { if (stepN - kb.L < 14) i.F = true; kb.L = stepN; }
  if (kr && !kb.pr) { if (stepN - kb.R < 14) i.F = true; kb.R = stepN; }
  kb.pl = kl; kb.pr = kr;
  const T = Math.min(W, H) * 0.045;
  let dx = 0, dy = 0;
  if (pad.stick) {
    dx = pad.stick.x - pad.stick.ox; dy = pad.stick.y - pad.stick.oy;
    if (dx < -T) i.L = true; if (dx > T) i.R = true;
    if (dy < -T * 1.5) i.U = true; if (dy > T * 1.3) i.D = true;
    // 技の向きは強く倒した方
    if (Math.abs(dx) > T || Math.abs(dy) > T) i.V = Math.abs(dx) >= Math.abs(dy) ? 'h' : dy < 0 ? 'u' : 'd'; else i.V = 'n';
    // 素早く倒した（3F以内に真ん中付近から大きく）ならダッシュ
    if (Math.abs(dx) > T * 1.7 && stk.hist.slice(-3).some(v => Math.abs(v) < T * 0.6)) i.F = true;
  }
  stk.hist.push(dx); if (stk.hist.length > 4) stk.hist.shift();
  if (pad.cPend) { i.C = pad.cPend; pad.cPend = null; }
  // キーボードの攻撃スティック: I/J/K/L ではなく テンキー 8/4/6/2
  for (const [c, d] of [['Numpad8', 'u'], ['Numpad2', 'd'], ['Numpad4', 'l'], ['Numpad6', 'r']]) { if (key[c] && !kb[c]) i.C = d; kb[c] = key[c]; }
  return i;
}

/* ---------- 木偶 ---------- */
let rngS = 12345; const rnd = () => (rngS = (rngS * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const ai = { t: 0, act: null, left: 0 };
function readDummy(sim){
  const p = sim.p[1], o = sim.p[0], i = Object.assign({}, A.NOIN);
  ai.t++;
  switch (OPT.dummy) {
    case 'guard': if (p.st !== 'stun') i.G = true; break;
    case 'jump': if (ai.t % 70 < 12) i.J = true; if (ai.t % 140 < 70) i.R = true; else i.L = true; break;
    case 'mash':
      if (ai.left <= 0) { const r = rnd(); ai.act = r < .35 ? 'jab' : r < .5 ? 'side' : r < .62 ? 'up' : r < .75 ? 'jump' : r < .9 ? 'guard' : 'wait'; ai.left = 10 + Math.floor(rnd() * 30); }
      ai.left--;
      const d = Math.sign(o.x - p.x);
      if (ai.act === 'jab' && ai.left % 6 < 2) i.A = true;
      if (ai.act === 'side') { if (d > 0) i.R = true; else i.L = true; if (ai.left % 20 === 0) i.A = true; }
      if (ai.act === 'up') { i.U = true; if (ai.left % 15 === 0) i.A = true; }
      if (ai.act === 'jump') { if (ai.left > 20) i.J = true; if (ai.left === 8) i.A = true; }
      if (ai.act === 'guard') i.G = true;
      if (ai.act === 'wait' && Math.abs(o.x - p.x) > 200 * FP) { if (d > 0) i.R = true; else i.L = true; }
      break;
  }
  // 倒れたら起き上がる（時々転がる）
  if (p.st === 'down' && p.f <= 0 && ai.t % 30 === 0) { if (rnd() < .3) i.R = true; else i.J = true; }
  return i;
}

/* ---------- 試合 ---------- */
let sim = new A.Sim({ training: true });
const FX = { parts: [], texts: [], shake: 0, finish: null, trails: [[], []], combo: [null, null], last: null, hist: [], calm: 0, flash: 0 };
const cam = { x: 800, y: 0, z: 1 };

function resetRound(){ sim.resetRound(); FX.finish = null; FX.trails = [[], []]; FX.combo = [null, null]; }

/* ---------- 一歩 ---------- */
let acc = 0, lastT = performance.now();
function tick(now){
  let dt = now - lastT; lastT = now; if (dt > 250) dt = 250;
  acc += dt;
  while (acc >= 1000 / 60) { acc -= 1000 / 60; stepOnce(); }
  draw();
  requestAnimationFrame(tick);
}
function inputSym(i){
  const h = (i.R ? 1 : 0) - (i.L ? 1 : 0), v = (i.U ? 1 : 0) - (i.D ? 1 : 0);
  const ar = ['↙', '↓', '↘', '←', '・', '→', '↖', '↑', '↗'][(1 - v) * 3 + (h + 1)];
  return ar + (i.C ? '攻' + { u: '↑', d: '↓', l: '←', r: '→', n: '・' }[i.C] : '') + (i.A ? '斬' : '') + (i.J ? '跳' : '') + (i.G ? (sim.p[1].st === 'stun' ? '居' : '守') : '');
}
function stepOnce(){
  if (FX.finish) {
    FX.finish.t++;
    if (FX.finish.t > 200) resetRound();
    tickParts();
    return;
  }
  const i0 = readP0();
  const s = inputSym(i0), hs = FX.hist;
  if (hs.length && hs[0].s === s) hs[0].n++; else { hs.unshift({ s, n: 1 }); if (hs.length > 16) hs.pop(); }
  sim.step([i0, readDummy(sim)]);
  for (const e of sim.ev) onEvent(e);
  sim.ev = [];
  // 稽古: しばらく何もされなければ戻す
  const d = sim.p[1];
  if (OPT.refill && !sim.over) {
    if (['idle', 'walk', 'guard', 'crouch', 'air'].includes(d.st)) FX.calm++; else FX.calm = 0;
    if (FX.calm > 90 && d.hp < A.HP_MAX) { d.hp = A.HP_MAX; d.touched = false; d.stunCount = 0; }
    if (FX.calm > 90 && sim.p[0].combo) sim.p[0].combo = 0;
  }
  for (const p of sim.p) recordTrail(p);
  tickParts();
}
function onEvent(e){
  const wx = e.x / FP, wy = e.y / FP;
  if (e.t === 'hit') {
    burst(wx, wy, e.dmg >= 700 ? 18 : 10, INK, 5);
    burst(wx, wy, 6, COL[e.by].light, 3);
    FX.shake = e.dmg >= 700 ? 9 : 4; FX.flash = 3;
    if (e.combo >= 2) FX.combo[e.by] = { n: e.combo, t: 0 };
    FX.last = { kind: e.stun ? '気絶中に当たり' : e.counter ? '出だしに当たり' : 'ヒット', mv: e.mv, adv: e.adv, dmg: e.dmg, combo: e.combo };
  } else if (e.t === 'block') {
    burst(wx, wy, 8, '#dfe9ff', 4, true);
    FX.shake = 2;
    FX.last = { kind: 'ガード', mv: e.mv, adv: e.adv, gd: e.gd };
  } else if (e.t === 'break') {
    burst(wx, wy, 26, '#dfe9ff', 7, true); burst(wx, wy, 12, COL[e.by].main, 5);
    FX.shake = 12; FX.flash = 6;
    FX.texts.push({ s: '崩', x: wx, y: wy + 90, t: 0, life: 90, seal: true, p: e.p });
    FX.last = { kind: 'ガードが割れた', mv: e.mv, adv: null };
  } else if (e.t === 'wall') { burst(wx, wy + 40, 10, '#6b6a55', 4); FX.shake = 6; }
  else if (e.t === 'down' || e.t === 'tech') { burst(wx, 6, 8, '#8d8a75', 3); if (e.t === 'tech') FX.texts.push({ s: '受け身', x: wx, y: 140, t: 0, life: 40, small: true }); }
  else if (e.t === 'finish') { FX.finish = { t: 0, how: e.how, name: e.name, p: e.p, tier: sim.result.tier, x: e.x / FP, y: e.y / FP }; FX.shake = 14; }
  else if (e.t === 'sd') { FX.texts.push({ s: 'サドンデス　一太刀で決まる', x: 0, y: 0, t: 0, life: 120, screen: true }); }
}
function burst(x, y, n, col, sp, spark){
  for (let k = 0; k < n; k++) { const a = rnd() * Math.PI * 2, v = sp * (0.4 + rnd()); FX.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v + 1, life: 18 + rnd() * 18, t: 0, col, r: spark ? 1.6 : 1.5 + rnd() * 3.5, spark }); }
}
function tickParts(){
  for (const q of FX.parts) { q.t++; q.x += q.vx; q.y += q.vy; q.vy -= 0.25; q.vx *= 0.94; }
  FX.parts = FX.parts.filter(q => q.t < q.life);
  for (const t of FX.texts) t.t++;
  FX.texts = FX.texts.filter(t => t.t < t.life);
  for (const c of FX.combo) if (c) c.t++;
  if (FX.shake > 0) FX.shake *= 0.8;
  if (FX.flash > 0) FX.flash--;
}

/* ---------- 体の形 ---------- */
// 返り値: 腰からの相対で、足・手・刀の角度など（ローカル座標: +x 前、+y 上）
function pose(p, fr){
  const P = { hip: 56, lean: 6, fA: [-16, 0], fB: [18, 0], sw: 25, arm: -30, rot: 0, head: 0, alpha: 1, sheath: false };
  const st = p.st;
  const breathe = Math.sin(fr * 0.08) * 1.2;
  P.hip += breathe * 0.5;
  if (st === 'dash') { const ph = fr * 0.55; P.hip = 44; P.lean = 38; P.fA = [-6 + Math.sin(ph) * 26, Math.max(0, Math.cos(ph) * 12)]; P.fB = [8 - Math.sin(ph) * 26, Math.max(0, -Math.cos(ph) * 12)]; P.sw = -160; P.arm = -140; }
  if (st === 'walk') { const ph = fr * 0.28; P.fA = [-4 + Math.sin(ph) * 16, Math.max(0, Math.cos(ph) * 7)]; P.fB = [6 - Math.sin(ph) * 16, Math.max(0, -Math.cos(ph) * 7)]; P.lean = 10; }
  if (st === 'crouch' || st === 'jsq' || st === 'land') { P.hip = 38; P.fA = [-20, 0]; P.fB = [22, 0]; P.lean = 18; P.sw = 10; }
  if (st === 'guard' || st === 'bstun') { P.lean = -6; P.sw = 92; P.arm = 10; P.hip = 52; P.fA = [-22, 0]; P.fB = [14, 0]; }
  if (st === 'unguard') { P.sw = 60; P.arm = 0; }
  if (st === 'air' || st === 'adodge' || st === 'fall') { P.fA = [-12, 22]; P.fB = [16, 16]; P.sw = 35; P.lean = 4; if (st === 'adodge') P.alpha = A.invuln(p) ? 0.4 : 0.85; if (st === 'fall') { P.sw = -60; P.arm = -60; P.lean = -8; P.alpha = 0.8; } }
  if (st === 'hit') { P.lean = -22; P.sw = 50; P.arm = 30; }
  if (st === 'tumble') { P.rot = -fr * 18 * (p.face); P.fA = [-14, 18]; P.fB = [18, 8]; P.sw = 140; P.arm = 60; }
  if (st === 'stun') { const sway = Math.sin(fr * 0.15) * 6; P.lean = 26 + sway; P.head = 25; P.sw = -95; P.arm = -80; P.hip = 50; P.fA = [-12, 0]; P.fB = [12, 0]; }
  if (st === 'down' || st === 'ko') { P.rot = 90 * 1; P.hip = 14; P.sw = -170; P.fA = [-30, 0]; P.fB = [-26, 2]; P.lean = 0; }
  if (st === 'roll' && p.rk === 'spot') { P.hip = 46; P.lean = -14; P.sw = 70; P.arm = 20; P.alpha = A.invuln(p) ? 0.4 : 1; }
  else if (st === 'roll' || (st === 'getup' && p.gk === 'roll')) { P.rot = -(p.f * 14) * (p.rollDir * p.face); P.hip = 34; P.fA = [-8, 14]; P.fB = [10, 14]; P.sw = 10; P.alpha = (A.invuln(p)) ? 0.6 : 1; }
  if (st === 'tech' || (st === 'getup' && p.gk !== 'roll')) { P.hip = 40; P.lean = 20; P.alpha = A.invuln(p) ? 0.6 : 1; }
  if (st === 'charge') { P.sw = 160 + Math.sin(fr * 1.3) * 3; P.arm = 120; P.lean = -10; P.hip = 48; P.fA = [-24, 0]; P.fB = [20, 0]; }
  if (st === 'atk') {
    const m = MV[p.mv], f = p.mvf;
    const a0 = m.arc[0], a1 = m.arc[1];
    if (m.iai) P.sheath = f < m.s;
    if (f < m.s) { const t = f / m.s; P.sw = lerp(25, a0, Math.min(1, t * 1.6)); P.lean = lerp(6, -4, t); }
    else if (f < m.s + m.a) { const t = (f - m.s + 1) / m.a; P.sw = lerp(a0, a1, t); P.lean = 18; }
    else { const t = (f - m.s - m.a) / Math.max(1, m.r); P.sw = lerp(a1, 25, t * t); P.lean = lerp(18, 6, t); }
    P.arm = P.sw - 55;
    if (m.k === 'a') { P.fA = [-12, 20]; P.fB = [16, 14]; }
    if (p.mv === 'dtilt') { P.hip = 34; P.fA = [-22, 0]; P.fB = [30, 0]; }
    if (p.mv === 'rise') { P.fA = [-8, 6]; P.fB = [10, 16]; P.lean = -6; }
    if (p.mv === 'plunge') { P.fA = [-10, 18]; P.fB = [12, 22]; P.lean = 10; P.arm = -95; }
    if (p.mv === 'side' || p.mv === 'sideA' || m.iai) { P.fA = [-34, 0]; P.fB = [30, 0]; P.hip = 44; P.lean = 28; }
    if (p.mv === 'gatk') { P.rot = 0; P.hip = 40; }
    if (m.grab) { P.arm = 0; P.sw = -40; P.lean = 22; }
  }
  return P;
}
function leg(c, hx, hy, fx, fy, bend){
  const L = 30, dx = fx - hx, dy = fy - hy, d = Math.min(Math.hypot(dx, dy), L * 2 - 0.1);
  const a = Math.atan2(dy, dx), b = Math.acos(d / (2 * L)) * bend;
  const kx = hx + Math.cos(a + b) * L, ky = hy + Math.sin(a + b) * L;
  c.moveTo(hx, hy); c.lineTo(kx, ky); c.lineTo(hx + Math.cos(a) * d, hy + Math.sin(a) * d);
}
function drawFighter(p, fr){
  const P = pose(p, fr), col = COL[p.i];
  const sx = wx(p.x / FP), sy = wy(p.y / FP), z = cam.z;
  const c = cx;
  c.save(); c.translate(sx, sy); c.scale(z * p.face, -z);
  c.globalAlpha = P.alpha;
  if (P.rot) { c.translate(0, P.hip); c.rotate(rad(P.rot)); c.translate(0, -P.hip); }
  const hx = 0, hy = P.hip;
  const shx = hx + Math.sin(rad(P.lean)) * 44, shy = hy + Math.cos(rad(P.lean)) * 44;
  c.strokeStyle = INK; c.lineCap = 'round'; c.lineJoin = 'round';
  // 脚
  c.lineWidth = 5.5; c.beginPath(); leg(c, hx, hy, P.fA[0], P.fA[1], 1); leg(c, hx, hy, P.fB[0], P.fB[1], 1); c.stroke();
  // 胴
  c.lineWidth = 7; c.beginPath(); c.moveTo(hx, hy); c.lineTo(shx, shy); c.stroke();
  // 帯
  c.strokeStyle = col.main; c.lineWidth = 6; c.beginPath(); c.moveTo(hx - 6, hy + 4); c.lineTo(hx + 7, hy + 6); c.stroke();
  // 鞘
  c.strokeStyle = '#2a2622'; c.lineWidth = 4; c.beginPath(); c.moveTo(hx + 4, hy + 6); c.lineTo(hx - 34, hy - 8); c.stroke();
  // 頭
  const hd = rad(P.lean + P.head);
  const hcx = shx + Math.sin(hd) * 15, hcy = shy + Math.cos(hd) * 15;
  c.fillStyle = INK; c.beginPath(); c.arc(hcx, hcy, 10.5, 0, Math.PI * 2); c.fill();
  // 鉢巻の端
  c.strokeStyle = col.main; c.lineWidth = 3; c.beginPath(); c.moveTo(hcx - 8, hcy + 2);
  const flut = Math.sin(fr * 0.3) * 4;
  c.quadraticCurveTo(hcx - 20, hcy + 4 + flut, hcx - 30, hcy - 2 + flut * 1.4); c.stroke();
  // 腕と刀
  const am = rad(P.arm);
  let hnx = shx + Math.cos(am) * 30, hny = shy + Math.sin(am) * 30;
  if (P.sheath) { hnx = hx + 6; hny = hy + 8; }
  c.strokeStyle = INK; c.lineWidth = 5; c.beginPath(); c.moveTo(shx, shy); c.lineTo(hnx, hny); c.stroke();
  const sa = rad(P.sw);
  const tipx = hnx + Math.cos(sa) * 82, tipy = hny + Math.sin(sa) * 82;
  if (!P.sheath) {
    c.strokeStyle = '#2b2520'; c.lineWidth = 5; c.beginPath(); c.moveTo(hnx - Math.cos(sa) * 12, hny - Math.sin(sa) * 12); c.lineTo(hnx, hny); c.stroke();
    c.strokeStyle = '#c9a54a'; c.lineWidth = 3; c.beginPath(); c.moveTo(hnx + Math.cos(sa + 1.57) * 5, hny + Math.sin(sa + 1.57) * 5); c.lineTo(hnx - Math.cos(sa + 1.57) * 5, hny - Math.sin(sa + 1.57) * 5); c.stroke();
    c.strokeStyle = '#e8e6df'; c.lineWidth = 2.6; c.beginPath(); c.moveTo(hnx, hny); c.lineTo(tipx, tipy); c.stroke();
    c.strokeStyle = 'rgba(20,21,18,.55)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(hnx, hny); c.lineTo(tipx, tipy); c.stroke();
  }
  c.restore();
  // 刀の先（軌跡用）を世界の座標で返す
  const toW = (lx, ly) => {
    let x = lx, y = ly;
    if (P.rot) { const r = rad(P.rot), yy = y - P.hip; const nx = x * Math.cos(r) - yy * Math.sin(r), ny = x * Math.sin(r) + yy * Math.cos(r) + P.hip; x = nx; y = ny; }
    return [p.x / FP + x * p.face, p.y / FP + y];
  };
  p._tip = toW(tipx, tipy); p._hand = toW(hnx, hny); p._sheath = P.sheath;
}
function recordTrail(p){
  const tr = FX.trails[p.i];
  const swinging = p.st === 'atk' && p.mvf >= MV[p.mv].s - 1 && p.mvf < MV[p.mv].s + MV[p.mv].a + 2;
  if (swinging && p._tip) { const ox = p.x / FP, oy = p.y / FP; tr.push({ t: [p._tip[0] - ox, p._tip[1] - oy], h: [p._hand[0] - ox, p._hand[1] - oy], life: 10, iai: !!MV[p.mv].iai }); }
  if (!swinging && p.st !== 'atk') tr.length = 0;
  for (const q of tr) q.life--;
  FX.trails[p.i] = tr.filter(q => q.life > 0).slice(-10);
}
function drawTrails(){
  for (let i = 0; i < 2; i++) {
    const tr = FX.trails[i]; if (tr.length < 2) continue;
    const ox = sim.p[i].x / FP, oy = sim.p[i].y / FP;
    cx.save();
    cx.globalCompositeOperation = 'lighter';
    for (let k = 1; k < tr.length; k++) {
      const a = tr[k - 1], b = tr[k], al = Math.min(1, b.life / 10);
      cx.fillStyle = b.iai ? `rgba(255,255,255,${0.85 * al})` : `rgba(240,236,226,${0.55 * al})`;
      cx.beginPath();
      const mid = (q, f) => [ox + q.h[0] + (q.t[0] - q.h[0]) * f, oy + q.h[1] + (q.t[1] - q.h[1]) * f];
      const a1 = mid(a, 0.35), b1 = mid(b, 0.35);
      cx.moveTo(wx(a1[0]), wy(a1[1])); cx.lineTo(wx(ox + a.t[0]), wy(oy + a.t[1])); cx.lineTo(wx(ox + b.t[0]), wy(oy + b.t[1])); cx.lineTo(wx(b1[0]), wy(b1[1]));
      cx.closePath(); cx.fill();
    }
    cx.restore();
  }
}

/* ---------- 画面の座標 ---------- */
let GROUND = 0;
const wx = x => (x - cam.x) * cam.z + W / 2;
const wy = y => GROUND - (y - cam.y) * cam.z;
function updateCam(){
  const a = sim.p[0], b = sim.p[1];
  const mx = (a.x + b.x) / 2 / FP, dx = Math.abs(a.x - b.x) / FP;
  const zt = clamp(W / (dx + 760), W / 1650, Math.min(W / 640, H / 360));
  cam.z = lerp(cam.z, zt, 0.08);
  const half = W / 2 / cam.z;
  const xt = clamp(mx, 0 + half, 1600 - half);
  cam.x = lerp(cam.x, half * 2 >= 1600 ? 800 : xt, 0.12);
  const top = Math.max(a.y, b.y) / FP;
  cam.y = lerp(cam.y, Math.max(0, top - 150) * 0.7, 0.08);
  GROUND = H * 0.8;
}

/* ---------- 背景 ---------- */
const BAMBOO = [];
(function(){ let s = 99; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let layer = 0; layer < 3; layer++) for (let k = 0; k < 26 - layer * 6; k++) BAMBOO.push({ layer, x: -200 + r() * 2000, w: [7, 11, 17][layer] * (0.8 + r() * 0.5), lean: (r() - 0.5) * 0.04, node: 70 + r() * 50 });
})();
function drawBg(fr){
  const sdOn = sim.sd;
  const g = cx.createLinearGradient(0, 0, 0, H);
  if (sdOn) { g.addColorStop(0, '#5a1712'); g.addColorStop(1, '#a8382a'); }
  else { g.addColorStop(0, '#d8d6c6'); g.addColorStop(0.65, '#c9c9b4'); g.addColorStop(1, '#b4b59c'); }
  cx.fillStyle = g; cx.fillRect(0, 0, W, H);
  if (sdOn) { cx.fillStyle = 'rgba(255,214,170,.85)'; cx.beginPath(); cx.arc(W * 0.72, H * 0.24, Math.min(W, H) * 0.11, 0, Math.PI * 2); cx.fill(); }
  const cols = sdOn ? ['rgba(60,10,8,.35)', 'rgba(50,8,6,.55)', 'rgba(30,5,4,.85)'] : ['rgba(120,128,104,.35)', 'rgba(84,94,72,.55)', 'rgba(40,46,36,.85)'];
  const par = [0.35, 0.6, 0.85];
  for (const b of BAMBOO) {
    const z = cam.z * par[b.layer] + (1 - par[b.layer]) * 0.6;
    const x = (b.x - cam.x * par[b.layer]) * z + W / 2 - (800 * (1 - par[b.layer])) * z;
    if (x < -40 || x > W + 40) continue;
    cx.fillStyle = cols[b.layer];
    const bw = b.w * z;
    cx.save(); cx.translate(x, GROUND); cx.rotate(b.lean);
    cx.fillRect(-bw / 2, -H * 1.3, bw, H * 1.3);
    cx.fillStyle = sdOn ? 'rgba(20,0,0,.35)' : 'rgba(20,24,18,.25)';
    for (let y = -b.node * z; y > -H * 1.3; y -= b.node * z) cx.fillRect(-bw / 2 - 1, y, bw + 2, Math.max(1.5, 2.5 * z));
    cx.restore();
  }
  // 地面
  const gy = wy(0);
  cx.fillStyle = sdOn ? '#2a0806' : '#3a3d30'; cx.fillRect(0, gy, W, H - gy);
  cx.fillStyle = sdOn ? 'rgba(255,120,90,.2)' : 'rgba(239,232,214,.18)'; cx.fillRect(0, gy, W, 2);
  // 端の太い竹
  for (const ex of [A.WALL_L / FP - 30, A.WALL_R / FP + 30]) { const x = wx(ex); cx.fillStyle = sdOn ? '#200403' : '#2d3227'; cx.fillRect(x - 24 * cam.z, 0, 48 * cam.z, gy); }
  // 足場（倒れた竹）
  for (const pl of A.PLATS) {
    const x0 = wx(pl.x0 / FP), x1 = wx(pl.x1 / FP), y = wy(pl.y / FP);
    cx.fillStyle = sdOn ? '#3a0c08' : '#5d6447'; cx.fillRect(x0, y - 1, x1 - x0, 11 * cam.z);
    cx.fillStyle = 'rgba(0,0,0,.3)'; for (let x = x0 + 40 * cam.z; x < x1; x += 70 * cam.z) cx.fillRect(x, y - 1, 2.5 * cam.z, 11 * cam.z);
    cx.fillStyle = 'rgba(255,255,240,.15)'; cx.fillRect(x0, y - 1, x1 - x0, 2);
  }
  // 笹
  cx.fillStyle = sdOn ? 'rgba(200,40,30,.7)' : 'rgba(70,84,60,.5)';
  for (let k = 0; k < 14; k++) { const t = (fr * 0.6 + k * 97) % (H + 80), x = (k * 173 + Math.sin((fr + k * 40) * 0.02) * 40) % W; cx.save(); cx.translate(x, t - 40); cx.rotate(Math.sin(fr * 0.03 + k) * 0.8); cx.fillRect(-6, -1.5, 12, 3); cx.restore(); }
}

/* ---------- 画面の表示 ---------- */
function bar(x, y, w, h, frac, col, right){
  cx.fillStyle = 'rgba(20,21,18,.25)'; cx.fillRect(x, y, w, h);
  const fw = w * clamp(frac, 0, 1);
  cx.fillStyle = col; cx.fillRect(right ? x + w - fw : x, y, fw, h);
}
function drawHud(){
  const m = Math.max(16, W * 0.03), bw = Math.min(W * 0.34, 380), top = 14;
  for (let i = 0; i < 2; i++) {
    const p = sim.p[i], right = i === 1, x = right ? W - m - bw : m;
    cx.font = `700 15px ${UIF}`; cx.fillStyle = COL[i].main; cx.textAlign = right ? 'right' : 'left';
    cx.fillText(i ? '藍（木偶）' : '朱（あなた）', right ? W - m : m, top + 12);
    bar(x, top + 20, bw, 12, p.hp / A.HP_MAX, sim.sd ? '#f2e6d8' : INK, right);
    bar(x, top + 36, bw * 0.8 + 0, 5, p.gd / A.GD_MAX, p.gd <= 2000 ? COL[0].main : '#3d5a6c', right);
    if (right) { /* 位置合わせ */ }
    cx.font = `500 11px ${UIF}`; cx.fillStyle = sim.sd ? '#f2e6d8' : '#3b3d33';
    cx.fillText(`体力 ${Math.ceil(p.hp / 100)}　ガード ${Math.ceil(p.gd / 100)}`, right ? W - m : m, top + 56);
  }
  const left = sim.sd ? Math.max(0, Math.ceil((A.C.sdF - (sim.frame - sim.sdStart)) / 60)) : Math.max(0, Math.ceil((A.C.roundF - sim.frame) / 60));
  cx.textAlign = 'center'; cx.font = `30px ${DISPLAY}`; cx.fillStyle = sim.sd ? '#ffe2d4' : INK;
  cx.fillText(sim.sd ? '一太刀' : String(left), W / 2, top + 32);
  cx.font = `500 11px ${UIF}`; cx.fillText(sim.sd ? '残り ' + left + ' 秒' : '稽古', W / 2, top + 50);
}
function drawFrames(){
  if (!OPT.frames) return;
  const p = sim.p[0], x = Math.max(16, W * 0.03), y0 = 92;
  const lines = [];
  if (p.st === 'atk') { const m = MV[p.mv]; lines.push([`${m.n}　${p.mvf}F目`, INK]); lines.push([`発生 ${m.s}F　持続 ${m.a}F　硬直 ${m.r}F　全体 ${m.total}F${m.land ? '　着地 ' + m.land + 'F' : ''}`, '#3b3d33']); }
  else if (p.st === 'roll' || p.st === 'adodge') { const d = A.DG[p.st === 'roll' ? p.rk : p.ak]; lines.push([`${d.n}　${p.f}F目`, INK]); lines.push([`無敵 ${d.i0}〜${d.i1}F　全体 ${d.total}F${d.land ? '　着地 ' + d.land + 'F' : ''}`, '#3b3d33']); }
  else if (p.st === 'charge') lines.push([`溜め斬り　溜め ${p.chargeF}F（${A.SMASH_MIN}〜${A.SMASH_MAX}）`, INK]);
  else lines.push([`状態: ${STN[p.st] || p.st}`, '#3b3d33']);
  const L = FX.last;
  if (L) {
    const adv = L.adv == null ? '' : `　${L.adv >= 0 ? '+' : '−'}${Math.abs(L.adv)}F`;
    const extra = L.dmg != null ? `　体力 −${(L.dmg / 100).toFixed(L.dmg % 100 ? 1 : 0)}` : L.gd != null ? `　ガード −${L.gd / 100}` : '';
    lines.push([`直前: ${MV[L.mv] ? MV[L.mv].n : ''} ${L.kind}${adv}${extra}`, L.adv == null ? '#3b3d33' : L.adv >= 0 ? '#2c4f96' : '#c8372d']);
  }
  if (p.combo >= 2) lines.push([`連撃 ${p.combo}　与えた体力 ${Math.round(p.comboDmg / 100)}`, '#3b3d33']);
  cx.textAlign = 'left';
  cx.fillStyle = 'rgba(239,232,214,.72)';
  cx.fillRect(x - 8, y0 - 16, Math.min(W * 0.42, 440), lines.length * 18 + 10);
  lines.forEach(([s, c], k) => { cx.font = `${k ? 500 : 700} 12.5px ${UIF}`; cx.fillStyle = c; cx.fillText(s, x, y0 + k * 18); });
  // 入力の履歴
  const hx = W - Math.max(16, W * 0.03), hy = 92;
  cx.textAlign = 'right'; cx.font = `500 12px ${UIF}`;
  FX.hist.slice(0, 12).forEach((h, k) => { cx.fillStyle = `rgba(20,21,18,${0.85 - k * 0.06})`; cx.fillText(`${h.s}　${h.n > 99 ? '99+' : h.n}`, hx, hy + k * 15); });
}
const STN = { fall: '無防備落下', idle: '待ち', walk: '歩き', dash: 'ダッシュ', crouch: 'しゃがみ', jsq: '踏み切り', air: '空中', land: '着地', guard: 'ガード', unguard: 'ガードを解く', bstun: 'ガード硬直', roll: '転がり', hit: 'のけぞり', tumble: '吹き飛び', down: 'ダウン', getup: '起き上がり', stun: '気絶', adodge: '空中回避', tech: '受け身', ko: '一本' };
function drawPad(){
  const stunO = sim.p[1].st === 'stun';
  if (pad.stick) {
    cx.strokeStyle = 'rgba(20,21,18,.35)'; cx.lineWidth = 2; cx.beginPath(); cx.arc(pad.stick.ox, pad.stick.oy, 46, 0, Math.PI * 2); cx.stroke();
    const dx = pad.stick.x - pad.stick.ox, dy = pad.stick.y - pad.stick.oy, d = Math.hypot(dx, dy), k = d > 46 ? 46 / d : 1;
    cx.fillStyle = 'rgba(20,21,18,.4)'; cx.beginPath(); cx.arc(pad.stick.ox + dx * k, pad.stick.oy + dy * k, 20, 0, Math.PI * 2); cx.fill();
  } else if (matchMedia('(pointer: coarse)').matches) {
    cx.fillStyle = 'rgba(20,21,18,.4)'; cx.font = `500 11px ${UIF}`; cx.textAlign = 'center'; cx.fillText('左半分を押して動かす', W * 0.22, H - 22);
  }
  { // 攻撃スティック
    const c = pad.cs;
    cx.globalAlpha = c ? 0.95 : 0.6;
    cx.strokeStyle = 'rgba(20,21,18,.7)'; cx.lineWidth = 2; cx.fillStyle = 'rgba(239,232,214,.35)';
    cx.beginPath(); cx.arc(CS.x, CS.y, CS.r, 0, Math.PI * 2); cx.fill(); cx.stroke();
    cx.fillStyle = INK;
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; cx.save(); cx.translate(CS.x + Math.cos(a) * CS.r * 0.72, CS.y + Math.sin(a) * CS.r * 0.72); cx.rotate(a);
      cx.beginPath(); cx.moveTo(5, 0); cx.lineTo(-3, -5); cx.lineTo(-3, 5); cx.closePath(); cx.fill(); cx.restore(); }
    let kx = CS.x, ky = CS.y;
    if (c) { const dx = c.x - c.ox, dy = c.y - c.oy, d = Math.hypot(dx, dy), m = d > CS.r * 0.6 ? CS.r * 0.6 / d : 1; kx += dx * m; ky += dy * m; }
    cx.fillStyle = c && c.fired ? COL[0].main : 'rgba(20,21,18,.55)'; cx.beginPath(); cx.arc(kx, ky, CS.r * 0.36, 0, Math.PI * 2); cx.fill();
    cx.fillStyle = PALE; cx.font = `${Math.round(CS.r * 0.4)}px ${DISPLAY}`; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText('攻', kx, ky + 1); cx.textBaseline = 'alphabetic';
    cx.globalAlpha = 1;
  }
  for (const b of BTN) {
    const iai = b.id === 'G' && stunO;
    const on = !!pad.btn[b.id] || readKeyFor(b.id);
    cx.globalAlpha = on ? 0.95 : 0.7;
    const pulse = iai ? 1 + Math.sin(performance.now() / 90) * 0.06 : 1;
    cx.fillStyle = iai ? 'rgba(200,55,45,.92)' : on ? 'rgba(20,21,18,.72)' : 'rgba(239,232,214,.55)';
    cx.beginPath(); cx.arc(b.x, b.y, b.r * pulse, 0, Math.PI * 2); cx.fill();
    cx.strokeStyle = iai ? '#ffd9cf' : 'rgba(20,21,18,.7)'; cx.lineWidth = 2; cx.stroke();
    cx.fillStyle = iai || on ? PALE : INK; cx.font = `${Math.round(b.r * 0.85)}px ${DISPLAY}`; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.fillText(iai ? '居' : b.label, b.x, b.y + 1);
    cx.textBaseline = 'alphabetic'; cx.globalAlpha = 1;
  }
}
function readKeyFor(id){ return id === 'A' ? !!(key.KeyJ || key.KeyZ) : id === 'J' ? !!(key.KeyK || key.KeyX || key.Space) : !!(key.KeyL || key.KeyC); }

function drawFinish(){
  const f = FX.finish; if (!f) return;
  const t = f.t;
  if (f.how === 'iai' || f.how === 'sd') {
    const dark = clamp(t / 14, 0, 1) * (t < 150 ? 1 : clamp(1 - (t - 150) / 50, 0, 1));
    cx.fillStyle = `rgba(6,6,5,${0.88 * dark})`; cx.fillRect(0, 0, W, H);
    if (t > 14) {
      const k = clamp((t - 14) / 8, 0, 1), y = wy(f.y);
      cx.save(); cx.globalCompositeOperation = 'lighter';
      const g = cx.createLinearGradient(0, y - 30, 0, y + 30); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      cx.fillStyle = g; const th = 4 + 40 * Math.max(0, 1 - (t - 22) / 30);
      cx.fillRect(0, y - th / 2, W * k, th);
      cx.restore();
    }
  } else if (f.how === 'ko') {
    const k = clamp(t / 18, 0, 1);
    cx.fillStyle = `rgba(20,21,18,${0.55 * Math.min(1, t / 10) * (t < 150 ? 1 : clamp(1 - (t - 150) / 50, 0, 1))})`;
    cx.fillRect(0, H * 0.42, W * k, H * 0.16);
  }
  if (t > 30) {
    const a = clamp((t - 30) / 20, 0, 1) * (t < 160 ? 1 : clamp(1 - (t - 160) / 40, 0, 1));
    cx.globalAlpha = a; cx.textAlign = 'center';
    cx.fillStyle = TIERC[f.tier] || PALE;
    cx.font = `${Math.round(Math.min(W, H) * 0.16)}px ${DISPLAY}`;
    cx.fillText(f.name, W / 2, H * 0.5 + Math.min(W, H) * 0.05);
    cx.font = `500 13px ${UIF}`; cx.fillStyle = PALE;
    const how = f.how === 'iai' ? '居合で一本' : f.how === 'ko' ? '斬り伏せて一本' : f.how === 'sd' ? 'サドンデスの一太刀' : '引き分け';
    cx.fillText(`${f.tier === '分' ? '' : '［' + f.tier + '］　'}${how}`, W / 2, H * 0.5 + Math.min(W, H) * 0.12);
    cx.globalAlpha = 1;
  }
}

let FR = 0;
function draw(){
  FR++;
  cx.setTransform(DPR, 0, 0, DPR, 0, 0);
  updateCam();
  const sh = FX.shake > 0.3 ? FX.shake : 0;
  cx.save(); if (sh) cx.translate((rnd() - 0.5) * sh, (rnd() - 0.5) * sh);
  drawBg(FR);
  // 気絶の印
  for (const p of sim.p) if (p.st === 'stun') {
    const x = wx(p.x / FP), y = wy(p.y / FP + 150);
    cx.fillStyle = COL[0].main; cx.globalAlpha = 0.85 + Math.sin(FR * 0.2) * 0.15;
    cx.fillRect(x - 15, y - 15, 30, 30); cx.fillStyle = PALE; cx.font = `22px ${DISPLAY}`; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText('崩', x, y + 1); cx.textBaseline = 'alphabetic'; cx.globalAlpha = 1;
    cx.fillStyle = INK; cx.font = `500 11px ${UIF}`; cx.fillText(`気絶 ${p.stun}F`, x, y + 32);
  }
  for (const p of sim.p) { const gy = p.plat >= 0 ? A.PLATS[p.plat].y / FP : (p.y / FP >= 190 && Math.abs(p.x / FP - 480) < 150) || (p.y / FP >= 190 && Math.abs(p.x / FP - 1120) < 150) ? 190 : 0;
    cx.fillStyle = 'rgba(20,21,18,.25)'; cx.beginPath(); cx.ellipse(wx(p.x / FP), wy(gy), 30 * cam.z, 5 * cam.z, 0, 0, Math.PI * 2); cx.fill(); }
  for (const p of [sim.p[1], sim.p[0]]) drawFighter(p, FR + p.i * 37);
  // シールド: 耐久が減るほど小さく、残り2割で朱く
  for (const p of sim.p) if (p.st === 'guard' || p.st === 'bstun' || p.st === 'unguard') {
    const k = p.gd / A.GD_MAX, r = (28 + 50 * k) * cam.z, x = wx(p.x / FP), y = wy(p.y / FP + 62);
    const low = p.gd <= 2000, c = low ? '200,55,45' : p.i ? '60,100,190' : '210,80,60';
    const fade = p.st === 'unguard' ? 0.4 : 1, hitk = p.st === 'bstun' ? 1.25 : 1;
    const g = cx.createRadialGradient(x, y, r * 0.2, x, y, r);
    g.addColorStop(0, `rgba(${c},${0.08 * fade})`); g.addColorStop(0.8, `rgba(${c},${0.26 * fade * hitk})`); g.addColorStop(1, `rgba(${c},${0.5 * fade * hitk})`);
    cx.fillStyle = g; cx.beginPath(); cx.arc(x, y, r, 0, Math.PI * 2); cx.fill();
    cx.strokeStyle = `rgba(255,255,255,${0.5 * fade})`; cx.lineWidth = 1.5; cx.beginPath(); cx.arc(x, y, r - 1, Math.PI * 1.1, Math.PI * 1.5); cx.stroke();
  }
  drawTrails();
  if (OPT.boxes) for (const p of sim.p) {
    const hb = A.hurt(p);
    cx.strokeStyle = A.invuln(p) ? 'rgba(255,255,255,.9)' : 'rgba(44,79,150,.85)'; cx.lineWidth = 1.5;
    cx.strokeRect(wx(p.x / FP + hb[0]), wy(p.y / FP + hb[1] + hb[3]), hb[2] * cam.z, hb[3] * cam.z);
    if (p.st === 'atk') { const m = MV[p.mv];
      if (p.mvf >= m.s && p.mvf < m.s + m.a) { const b = A.box(p, m.box); cx.fillStyle = 'rgba(200,55,45,.45)'; cx.fillRect(wx(b[0] / FP), wy(b[3] / FP), (b[2] - b[0]) / FP * cam.z, (b[3] - b[1]) / FP * cam.z); } }
  }
  for (const q of FX.parts) { cx.globalAlpha = 1 - q.t / q.life; cx.fillStyle = q.col; const r = q.r * cam.z; cx.fillRect(wx(q.x) - r, wy(q.y) - r, r * 2, r * 2); }
  cx.globalAlpha = 1;
  for (const t of FX.texts) {
    const a = 1 - t.t / t.life;
    cx.globalAlpha = a; cx.textAlign = 'center';
    if (t.screen) { cx.fillStyle = '#ffe2d4'; cx.font = `26px ${DISPLAY}`; cx.fillText(t.s, W / 2, H * 0.32); }
    else if (t.small) { cx.fillStyle = INK; cx.font = `600 12px ${UIF}`; cx.fillText(t.s, wx(t.x), wy(t.y)); }
    else { cx.fillStyle = COL[0].main; cx.font = `${Math.round(48 * cam.z)}px ${DISPLAY}`; cx.fillText(t.s, wx(t.x), wy(t.y) - t.t * 0.4); }
    cx.globalAlpha = 1;
  }
  for (let i = 0; i < 2; i++) { const c = FX.combo[i]; if (!c || c.t > 70 || c.n < 2) continue; const p = sim.p[i];
    cx.globalAlpha = 1 - c.t / 70; cx.fillStyle = COL[i].main; cx.textAlign = 'center'; cx.font = `${Math.round(30 * cam.z + 8)}px ${DISPLAY}`;
    cx.fillText(kn(c.n) + '連', wx(p.x / FP), wy(p.y / FP + 175)); cx.globalAlpha = 1; }
  if (FX.flash) { cx.fillStyle = `rgba(255,255,255,${FX.flash * 0.05})`; cx.fillRect(0, 0, W, H); }
  cx.restore();
  drawHud();
  drawFrames();
  drawFinish();
  drawPad();
}

/* ---------- 上の操作 ---------- */
function setupBar(){
  const sel = document.getElementById('a_dummy');
  DUMMY.forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; sel.appendChild(o); });
  sel.value = OPT.dummy; sel.addEventListener('change', () => { OPT.dummy = sel.value; saveOpt(); sel.blur(); });
  const fr = document.getElementById('a_frames'); fr.checked = OPT.frames; fr.addEventListener('change', () => { OPT.frames = fr.checked; saveOpt(); });
  const bx = document.getElementById('a_boxes'); bx.checked = OPT.boxes; bx.addEventListener('change', () => { OPT.boxes = bx.checked; saveOpt(); });
  const rf = document.getElementById('a_refill'); rf.checked = OPT.refill; rf.addEventListener('change', () => { OPT.refill = rf.checked; saveOpt(); });
  document.getElementById('a_reset').addEventListener('click', e => { resetRound(); e.target.blur(); });
  document.getElementById('a_help').addEventListener('click', () => { document.getElementById('help').hidden = false; });
  document.getElementById('h_close').addEventListener('click', () => { document.getElementById('help').hidden = true; });
}

resize(); setupBar();
window.__action = { get sim(){ return sim; }, FX, OPT, resetRound };
requestAnimationFrame(t => { lastT = t; requestAnimationFrame(tick); });
})();
