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

/* 画面: 一人なら一枚。同じ端末の二人対戦（触る画面）は左右に割り、それぞれを持ち手の方へ回す */
let SW = 0, SH = 0, W = 0, H = 0, DPR = 1, MIR = 1, VIEWS = [], CUR = null;
const SPLIT = matchMedia('(pointer: coarse)').matches || /split=1/.test(location.search);
function resize(){ DPR = Math.min(2, window.devicePixelRatio || 1); SW = innerWidth; SH = innerHeight; cv.width = SW * DPR; cv.height = SH * DPR; cv.style.width = SW + 'px'; cv.style.height = SH + 'px'; layoutViews(); }
addEventListener('resize', resize);
function layoutViews(){
  if (GAME.mode === 'vs' && SPLIT) {
    const hw = SW / 2;
    VIEWS = [{ me: 0, w: SH, h: hw, m: [0, 1, -1, 0, hw, 0], rect: [0, 0, hw, SH], mir: 1, pad: PADS[0] },
             { me: 1, w: SH, h: hw, m: [0, -1, 1, 0, hw, SH], rect: [hw, 0, hw, SH], mir: -1, pad: PADS[1] }];
  } else VIEWS = [{ me: 0, w: SW, h: SH, m: [1, 0, 0, 1, 0, 0], rect: [0, 0, SW, SH], mir: 1, pad: PADS[0] }];
  for (const v of VIEWS) layoutPad(v.pad, v.w, v.h);
  setView(VIEWS[0]);
}
function setView(v){ CUR = v; W = v.w; H = v.h; MIR = v.mir; GROUND = H * 0.8; }
function viewAt(sx, sy){
  for (const v of VIEWS) { const r = v.rect; if (sx >= r[0] && sx < r[0] + r[2] && sy >= r[1] && sy < r[1] + r[3]) {
    const [a, b, c, d, e, f] = v.m, det = a * d - b * c, X = sx - e, Y = sy - f;
    return { v, x: (d * X - c * Y) / det, y: (-b * X + a * Y) / det }; } }
  return null;
}

/* ---------- 設定 ---------- */
const OPT = { dummy: 'stand', frames: true, refill: true, boxes: false };
try { Object.assign(OPT, JSON.parse(localStorage.getItem('issen-action-opt') || '{}')); } catch (e) {}
function saveOpt(){ try { localStorage.setItem('issen-action-opt', JSON.stringify(OPT)); } catch (e) {} }
const DUMMY = [['stand', '立つだけ'], ['guard', '守り続ける'], ['jump', '跳び回る'], ['mash', '暴れる']];

/* ---------- 入力 ---------- */
const key = {};
addEventListener('keydown', e => { key[e.code] = true; if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault(); });
addEventListener('keyup', e => { key[e.code] = false; });
/* キーの割り当て。一人のときは両方の手で使えるように広く、二人のときは左右に分ける */
const KEYS = {
  solo: { L: ['KeyA', 'ArrowLeft'], R: ['KeyD', 'ArrowRight'], U: ['KeyW', 'ArrowUp'], D: ['KeyS', 'ArrowDown'], N: ['KeyJ', 'KeyZ'], A: ['KeyU', 'KeyV'], J: ['KeyK', 'KeyX', 'Space'], G: ['KeyL', 'KeyC'] },
  p0: { L: ['KeyA'], R: ['KeyD'], U: ['KeyW'], D: ['KeyS'], N: ['KeyJ'], A: ['KeyU'], J: ['KeyK'], G: ['KeyL'] },
  p1: { L: ['ArrowLeft'], R: ['ArrowRight'], U: ['ArrowUp'], D: ['ArrowDown'], N: ['Numpad1', 'Comma'], A: ['Numpad4', 'KeyM'], J: ['Numpad2', 'Period'], G: ['Numpad3', 'Slash'] },
};
const keyMap = pi => GAME.mode === 'vs' ? (pi ? KEYS.p1 : KEYS.p0) : pi ? null : KEYS.solo;
function mkPad(){ return { stick: null, btn: {}, prevN: false, BTN: [], hist: [0, 0, 0, 0], kb: { L: -99, R: -99, pl: false, pr: false } }; }
const PADS = [mkPad(), mkPad()], OWN = {};
/* ボタン: 斬（通常技）・技（刀の技）・跳・守。置き場所と大きさは「ボタン配置」で変えられ、この端末に覚える */
const BDEF = [['N', '斬', 1.12], ['A', '技', 0.98], ['J', '跳', 0.92], ['G', '守', 0.92]];
const BLAY_KEY = 'issen-action-btns-v1';
let BLAY = null; try { BLAY = JSON.parse(localStorage.getItem(BLAY_KEY) || 'null'); } catch (e) {}
function saveBlay(){ try { if (BLAY) localStorage.setItem(BLAY_KEY, JSON.stringify(BLAY)); else localStorage.removeItem(BLAY_KEY); } catch (e) {} }
function defaultPos(id, w, h, r){
  return { N: [w - r * 2.7, h - r * 1.55], A: [w - r * 4.4, h - r * 3.35], J: [w - r * 1.15, h - r * 2.95], G: [w - r * 4.95, h - r * 1.25] }[id];
}
function layoutPad(pd, w, h){
  const r = clamp(Math.min(w, h) * 0.085, 30, 54), sc = BLAY && BLAY.s ? BLAY.s : 1;
  pd.BTN = BDEF.map(([id, label, k]) => { const d = defaultPos(id, w, h, r), q = BLAY && BLAY[id];
    return { id, label, x: q ? q[0] * w : d[0], y: q ? q[1] * h : d[1], r: r * k * sc }; });
  pd.w = w; pd.h = h;
}
function inBtn(pd, x, y){ for (const b of pd.BTN) { const dx = x - b.x, dy = y - b.y; if (dx * dx + dy * dy <= (b.r * 1.25) ** 2) return b.id; } return null; }
cv.addEventListener('pointerdown', e => {
  e.preventDefault(); cv.setPointerCapture(e.pointerId);
  if (FX.finish && FX.finish.t > 40) { /* 演出中のタップで早送り */ FX.finish.t = Math.max(FX.finish.t, 150); }
  const at = viewAt(e.clientX, e.clientY); if (!at) return;
  const pd = at.v.pad, x = at.x, y = at.y;
  const b = inBtn(pd, x, y);
  if (EDIT) { if (b) { EDIT.sel = b; OWN[e.pointerId] = { v: at.v, r: 'E', id: b, dx: x - pd.BTN.find(q => q.id === b).x, dy: y - pd.BTN.find(q => q.id === b).y }; } return; }
  if (b) { pd.btn[b] = true; OWN[e.pointerId] = { v: at.v, r: b }; return; }
  if (x < at.v.w * 0.5 && !pd.stick) { pd.stick = { id: e.pointerId, ox: x, oy: y, x, y }; OWN[e.pointerId] = { v: at.v, r: 'S' }; }
}, { passive: false });
function localOf(v, sx, sy){ const [a, b, c, d, e, f] = v.m, det = a * d - b * c, X = sx - e, Y = sy - f; return [(d * X - c * Y) / det, (-b * X + a * Y) / det]; }
cv.addEventListener('pointermove', e => {
  const o = OWN[e.pointerId]; if (!o) return;
  const pd = o.v.pad, [x, y] = localOf(o.v, e.clientX, e.clientY);
  if (o.r === 'S' && pd.stick) { pd.stick.x = x; pd.stick.y = y; }
  if (o.r === 'E') { // 配置を変える: ボタンを指で動かす
    const nx = clamp(x - o.dx, 20, pd.w - 20), ny = clamp(y - o.dy, 20, pd.h - 20);
    BLAY = BLAY || { s: 1 }; BLAY[o.id] = [nx / pd.w, ny / pd.h]; for (const v of VIEWS) layoutPad(v.pad, v.w, v.h); }
});
function upPtr(e){ const o = OWN[e.pointerId]; if (!o) return; const pd = o.v.pad;
  if (o.r === 'S') pd.stick = null;
  else if (o.r !== 'E') pd.btn[o.r] = false;
  delete OWN[e.pointerId]; }
cv.addEventListener('pointerup', upPtr); cv.addEventListener('pointercancel', upPtr);
let stepN = 0;
/* 人の手の入力（キーボード＋画面の操作）。向かい側の画面は左右が逆なので戻す */
function readHuman(pi){
  const pd = PADS[pi], km = keyMap(pi), kb = pd.kb;
  const k = list => !!km && list.some(c => key[c]);
  const i = { L: km ? k(km.L) : false, R: km ? k(km.R) : false, U: km ? k(km.U) : false, D: km ? k(km.D) : false,
    A: (km && k(km.A)) || !!pd.btn.A, J: (km && k(km.J)) || !!pd.btn.J, G: (km && k(km.G)) || !!pd.btn.G };
  i.S = i.A; // 技ボタンは向きなしでも刀の技
  // キーボード: 同じ向きを素早く二回押すとダッシュ
  if (km) {
    const kl = k(km.L), kr = k(km.R);
    if (kl && !kb.pl) { if (stepN - kb.L < 14) i.F = true; kb.L = stepN; }
    if (kr && !kb.pr) { if (stepN - kb.R < 14) i.F = true; kb.R = stepN; }
    kb.pl = kl; kb.pr = kr;
  }
  const T = Math.min(pd.w || W, pd.h || H) * 0.045;
  const v = VIEWS.find(q => q.pad === pd), flip = v && v.mir < 0;
  let dx = 0, dy = 0;
  if (pd.stick) {
    dx = pd.stick.x - pd.stick.ox; dy = pd.stick.y - pd.stick.oy;
    if (flip) dx = -dx;
    if (dx < -T) i.L = true; if (dx > T) i.R = true;
    if (dy < -T * 1.5) i.U = true; if (dy > T * 1.3) i.D = true;
    // 技の向きは強く倒した方
    if (Math.abs(dx) > T || Math.abs(dy) > T) i.V = Math.abs(dx) >= Math.abs(dy) ? 'h' : dy < 0 ? 'u' : 'd'; else i.V = 'n';
    // 素早く倒した（3F以内に真ん中付近から大きく）ならダッシュ
    if (Math.abs(dx) > T * 1.7 && pd.hist.slice(-3).some(q => Math.abs(q) < T * 0.6)) i.F = true;
  }
  pd.hist.push(dx); if (pd.hist.length > 4) pd.hist.shift();
  // 斬ボタン: 押した瞬間、倒している向きの通常技（横・上・下・向きなし。走りながらならダッシュ斬り、空中なら空中技）
  const nOn = (km && k(km.N)) || !!pd.btn.N;
  if (nOn && !pd.prevN) {
    const h = (i.R ? 1 : 0) - (i.L ? 1 : 0);
    let d = 'n';
    if (i.V === 'h' && h) d = h > 0 ? 'r' : 'l'; else if (i.V === 'u' || (i.V == null && i.U)) d = 'u'; else if (i.V === 'd' || (i.V == null && i.D)) d = 'd'; else if (h) d = h > 0 ? 'r' : 'l';
    i.C = d;
  }
  pd.prevN = nOn;
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

/* ---------- CPU ---------- */
/* 相手の様子は少し遅れて見る（反応の速さ＝強さ）。決めた動きは数Fかけてやり切る */
const CPU = { lv: 0, plan: null, k: 0, n: 0, seen: [], s: 777 };
const crnd = () => (CPU.s = (CPU.s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
function cpuReset(n){ CPU.lv = clamp((n - 1) / 9, 0, 1); CPU.plan = null; CPU.seen = []; CPU.s = 777 + n * 131; }
function cpuInput(){
  const p = sim.p[1], o = sim.p[0], x = CPU.lv, i = Object.assign({}, A.NOIN);
  CPU.seen.push({ st: o.st, mv: o.mv, mvf: o.mvf, x: o.x, y: o.y, ground: o.ground, gd: o.gd });
  if (CPU.seen.length > 32) CPU.seen.shift();
  const delay = Math.round(lerp(22, 7, x));
  const s = CPU.seen[Math.max(0, CPU.seen.length - 1 - delay)];
  const dx = (s.x - p.x) / FP, dist = Math.abs(dx), dir = dx >= 0 ? 1 : -1;
  const fwd = q => { if (dir > 0) q.R = true; else q.L = true; };
  const back = q => { if (dir > 0) q.L = true; else q.R = true; };
  const cf = dir > 0 ? 'r' : 'l';
  const set = (n, f) => { CPU.plan = f; CPU.n = n; CPU.k = 0; };
  // 決着の一太刀: 気絶した相手には寄って居合
  if (o.st === 'stun') { if (dist > 120) fwd(i); else if (sim.frame % 2) i.G = true; return i; }
  if (p.st === 'down') { if (p.f <= 0 && crnd() < 0.08) { const r = crnd(); if (r < 0.4) i.J = true; else if (r < 0.75) fwd(i); else i.A = true; } return i; }
  if (p.st === 'tumble') { if (p.y < 60 * FP && p.vy < 0 && crnd() < lerp(0.02, 0.25, x)) i.G = true; return i; }
  if (p.st === 'hit' || p.st === 'bstun' || p.st === 'stun') { CPU.plan = null; if (p.st === 'bstun') i.G = true; return i; }
  // 相手の技の出かかり・飛んでくる斬撃には守る（強いほど）
  const atkStart = s.st === 'atk' && MV[s.mv] && s.mvf < MV[s.mv].s + MV[s.mv].a && dist < 190;
  const shot = sim.pj.some(q => q.o === 0 && Math.sign(q.vx) === Math.sign(p.x - q.x) && Math.abs(q.x - p.x) < 260 * FP);
  if ((atkStart || shot) && p.ground && (!CPU.plan || CPU.def !== true)) {
    if (crnd() < lerp(0.06, 0.5, x)) { CPU.def = true; const r = crnd();
      if (r < 0.7) set(14 + Math.floor(crnd() * 12), (k, q) => { q.G = true; });
      else if (r < 0.85) set(2, (k, q) => { q.G = true; if (k === 1) q.D = true; });
      else set(2, (k, q) => { q.G = true; if (k === 1) back(q); });
    }
  }
  if (CPU.plan) { CPU.plan(CPU.k, i); CPU.k++; if (CPU.k >= CPU.n) { CPU.plan = null; CPU.def = false; } return i; }
  CPU.def = false;
  // 何もしない間（弱いほど長い）
  if (crnd() < lerp(0.12, 0.02, x)) { set(Math.floor(lerp(26, 6, x) * (0.5 + crnd())), () => {}); return i; }
  if (p.st === 'air') {
    if (dist < 120 && Math.abs(s.y - p.y) < 120 * FP) { const r = crnd(); i.C = r < 0.5 ? (p.face === dir ? cf : (dir > 0 ? 'r' : 'l')) : s.y < p.y ? 'd' : 'u'; }
    else fwd(i);
    return i;
  }
  if (!p.ground) return i;
  const r = crnd();
  if (s.st === 'hit' && dist < 140) { // 当たった後は続ける
    if (r < 0.6) set(18, (k, q) => { if (k % 7 === 0) q.A = true; });
    else set(1, (k, q) => { q.C = 'u'; });
    return i;
  }
  if (!s.ground && dist < 90 && s.y > p.y + 60 * FP && r < 0.5) { i.C = 'u'; return i; }
  if ((s.st === 'guard' || s.st === 'bstun') && dist < 90 && r < lerp(0.05, 0.3, x)) { i.G = true; i.A = true; return i; }
  if (dist < 115) {
    if (r < 0.35) set(20, (k, q) => { if (k % 7 === 0) q.A = true; });
    else if (r < 0.55) i.C = cf;
    else if (r < 0.7) i.C = 'd';
    else if (r < 0.8) set(2, (k, q) => { q.D = true; q.V = 'd'; if (k === 1) q.A = true; }); // カウンター
    else if (r < 0.9) set(8, (k, q) => back(q));
    else set(20, (k, q) => { q.J = k < 10; if (k === 12) q.C = cf; });
    return i;
  }
  if (dist < 300) {
    if (r < 0.45) set(10 + Math.floor(crnd() * 20), (k, q) => fwd(q));
    else if (r < 0.6) set(14, (k, q) => { fwd(q); if (k === 1) q.F = true; if (k === 10 && crnd() < 0.6) q.C = cf; });
    else if (r < 0.75) set(24, (k, q) => { q.J = k < 12; if (k > 2) fwd(q); if (k === 16) q.C = cf; });
    else if (r < 0.85) set(2, (k, q) => { fwd(q); q.V = 'h'; if (k === 1) q.A = true; }); // 踏み込み（今は飛ぶ斬撃）
    else set(10, (k, q) => { q.G = k < 8; });
    return i;
  }
  if (r < 0.15 && !sim.pj.some(q => q.o === 1)) set(2, (k, q) => { fwd(q); q.V = 'h'; if (k === 1) q.A = true; });
  else set(12 + Math.floor(crnd() * 14), (k, q) => { fwd(q); if (k === 1 && crnd() < 0.5) q.F = true; });
  return i;
}

/* ---------- 試合 ---------- */
/* mode: menu（選ぶ画面）/ train（稽古）/ cpu（勝ち抜き・一本勝負）/ vs（同じ端末で二人・二本先取） */
const GAME = { mode: 'menu', phase: 'intro', t: 0, n: 1, log: [], best: 0 };
try { GAME.best = (JSON.parse(localStorage.getItem('issen-action-cpu-v1') || '{}').best) | 0; } catch (e) {}
let sim = new A.Sim({ training: true });
const FX = { ouka: [], grow: [null, null], pflash: 0, gone: [], parts: [], texts: [], shake: 0, finish: null, trails: [[], []], combo: [null, null], last: null, hist: [], calm: 0, flash: 0 };
const cam = { x: 800, y: 0, z: 1 };

function clearFx(){ FX.cut = null; WORLD.f = WORLD.m = 0; FX.ouka = []; FX.grow = [null, null]; FX.pflash = 0; FX.gone = []; FX.finish = null; FX.trails = [[], []]; FX.combo = [null, null]; FX.texts = []; FX.parts = []; }
function resetRound(){ sim.resetRound(); clearFx(); }
/* 持たせる刀（新・一閃の特殊技）。common＝今の共通の技、ouka＝桜華 */
/* 持たせる刀: 一閃（index.html）で集めた刀から選ぶ。刀の技は桜華だけ固有、ほかは共通。
   持っている刀の一覧は一閃のタイトルが置いていく（issen-action-arm-v1）。勝ちは issen-action-out-v1 に積み、一閃が銭と戦績に足す */
const COIN = { '並': 3, '上': 9, '極': 24, '幻': 60, '絶': 150 };
let SNAP = { acct: false, owned: [] };
try { const q = JSON.parse(localStorage.getItem('issen-action-arm-v1') || 'null'); if (q && Array.isArray(q.owned)) SNAP = q; } catch (e) {}
if (!SNAP.owned.some(k => k.id === 'mumei')) SNAP.owned.unshift({ id: 'mumei', mei: '無銘', tier: '並' });
const owns = id => SNAP.owned.some(k => k.id === id);
const KITS = [(SNAP.equip && owns(SNAP.equip[0])) ? SNAP.equip[0] : 'mumei', (SNAP.equip && owns(SNAP.equip[1])) ? SNAP.equip[1] : 'mumei'];
try { const k = JSON.parse(localStorage.getItem('issen-action-kit2') || 'null'); if (Array.isArray(k)) k.forEach((v, i) => { if (owns(v)) KITS[i] = v; }); } catch (e) {}
function saveKits(){ try { localStorage.setItem('issen-action-kit2', JSON.stringify(KITS)); } catch (e) {} }
const kitOf = id => id === 'ouka' && owns('ouka') ? 'ouka' : 'common'; // 桜華の技は、ガチャなどで手に入れた人だけ
const kitsFor = mode => mode === 'vs' ? [kitOf(KITS[0], mode), kitOf(KITS[1], mode)] : [kitOf(KITS[0], mode), 'common'];
function recordWin(r){ // 勝った刀の戦績と銭
  const i = r.winner; if (i < 0 || GAME.mode === 'train' || (GAME.mode === 'cpu' && i !== 0)) return;
  const id = KITS[i]; if (!owns(id)) return;
  const coin = COIN[r.tier] || 0;
  try { const a = JSON.parse(localStorage.getItem('issen-action-out-v1') || '[]'); a.push({ f: r.name, k: id, acct: !!SNAP.acct, t: Date.now() }); localStorage.setItem('issen-action-out-v1', JSON.stringify(a.slice(-200))); } catch (e) {}
  GAME.coins = (GAME.coins || 0) + coin;
  if (coin) FX.texts.push({ s: '銭 +' + coin, x: 0, y: 0, t: 0, life: 110, screen: true });
}
function startMode(mode){
  GAME.mode = mode; GAME.log = []; GAME.n = 1; GAME.t = 0; GAME.coins = 0;
  sim = new A.Sim(mode === 'train' ? { training: true, kits: kitsFor(mode) } : { toWin: mode === 'cpu' ? 1 : 2, kits: kitsFor(mode) });
  if (mode === 'cpu') cpuReset(1);
  GAME.phase = mode === 'train' ? 'fight' : 'intro';
  GAME.zin = mode !== 'train' && sim.p.some(p => p.kit === 'ouka') ? 110 : 0; // 絶の持ち主がいれば立ち合いの前に抜刀のカットイン
  clearFx(); FX.hist = []; FX.last = null;
  document.body.dataset.mode = mode;
  showMenu(false); showOver(false);
  layoutViews();
}

/* ---------- 一歩 ---------- */
let acc = 0, lastT = performance.now();
function tick(now){
  let dt = now - lastT; lastT = now; if (dt > 250) dt = 250;
  acc += dt;
  if (GAME.mode === 'online') { acc = 0; onlineTick(); }
  while (acc >= 1000 / 60) { acc -= 1000 / 60; stepOnce(); }
  draw();
  requestAnimationFrame(tick);
}
function inputSym(i){
  const h = (i.R ? 1 : 0) - (i.L ? 1 : 0), v = (i.U ? 1 : 0) - (i.D ? 1 : 0);
  const ar = ['↙', '↓', '↘', '←', '・', '→', '↖', '↑', '↗'][(1 - v) * 3 + (h + 1)];
  return ar + (i.C ? '斬' + { u: '↑', d: '↓', l: '←', r: '→', n: '・' }[i.C] : '') + (i.A ? '技' : '') + (i.J ? '跳' : '') + (i.G ? (sim.p[1].st === 'stun' ? '居' : '守') : '');
}
function stepOnce(){
  if (DBG.pause || GAME.mode === 'menu' || GAME.mode === 'online' || PAUSED || EDIT) return;
  stepN++;
  if (GAME.phase === 'over') { tickParts(); return; }
  if (GAME.phase === 'intro') { GAME.t++; if (GAME.t === 1 && GAME.zin) SND.play('draw'); if (GAME.t > 80 + GAME.zin) { GAME.phase = 'fight'; GAME.t = 0; GAME.zin = 0; } tickParts(); return; }
  if (FX.cut) { FX.cut.t++; if (FX.cut.t >= 64) FX.cut = null; tickParts(); return; } // カットインの間は両者止まる
  if (FX.finish) {
    FX.finish.t++;
    if (FX.finish.t > 200) afterFinish();
    tickParts();
    return;
  }
  const i0 = readHuman(0);
  if (GAME.mode === 'train') { const s = inputSym(i0), hs = FX.hist;
    if (hs.length && hs[0].s === s) hs[0].n++; else { hs.unshift({ s, n: 1 }); if (hs.length > 16) hs.pop(); } }
  const i1 = GAME.mode === 'train' ? readDummy(sim) : GAME.mode === 'cpu' ? cpuInput() : readHuman(1);
  sim.step([i0, i1]);
  for (const e of sim.ev) onEvent(e);
  sim.ev = [];
  // 稽古: しばらく何もされなければ戻す
  const d = sim.p[1];
  if (GAME.mode === 'train' && OPT.refill && !sim.over) {
    if (['idle', 'walk', 'guard', 'crouch', 'air'].includes(d.st)) FX.calm++; else FX.calm = 0;
    if (FX.calm > 90 && d.hp < A.HP_MAX) { d.hp = A.HP_MAX; d.touched = false; d.stunCount = 0; }
    if (FX.calm > 90 && sim.p[0].combo) sim.p[0].combo = 0;
  }
  for (const p of sim.p) recordTrail(p);
  tickParts();
}
/* 一本のあと: 次の一本・次の相手・試合の終わり */
function afterFinish(){
  const r = sim.result;
  if (GAME.mode === 'train') { resetRound(); return; }
  GAME.log.push({ name: r.name, tier: r.tier, winner: r.winner });
  recordWin(r);
  if (GAME.mode === 'cpu') {
    if (r.winner === 0) { GAME.n++; sim = new A.Sim({ toWin: 1, kits: kitsFor('cpu') }); cpuReset(GAME.n); clearFx(); GAME.phase = 'intro'; GAME.t = 0; return; }
    if (r.winner < 0) { resetRound(); GAME.phase = 'intro'; GAME.t = 0; return; } // 引き分けは同じ相手ともう一度
    const rec = GAME.n - 1;
    if (rec > GAME.best) { GAME.best = rec; try { localStorage.setItem('issen-action-cpu-v1', JSON.stringify({ best: rec })); } catch (e) {} }
    GAME.phase = 'over'; showOver(true); return;
  }
  if (r.matchOver) { GAME.phase = 'over'; showOver(true); return; }
  resetRound(); GAME.phase = 'intro'; GAME.t = 0;
}
function onEvent(e){
  const wx = e.x / FP, wy = e.y / FP;
  if (e.t === 'hit' && sim.p[e.by].kit === 'ouka') { // 桜華の当たり: 花びらと紅の切り口
    petals(wx, wy, OUKA_MV[e.mv] ? 26 : 12, 6); burst(wx, wy, 10, '#8e0f22', 6, true);
    FX.ouka.push({ k: 'cut', x: wx, y: wy, t: 0, life: 16, a: rnd() * 3 }); if (OUKA_MV[e.mv]) FX.pflash = 4; SND.play('hit'); }
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
    FX.texts.push({ s: '崩', x: wx, y: wy + 90, t: 0, life: 90, seal: true, c: e.by });
    FX.last = { kind: 'ガードが割れた', mv: e.mv, adv: null };
  } else if (e.t === 'wall') { burst(wx, wy + 40, 10, '#6b6a55', 4); FX.shake = 6; }
  else if (e.t === 'down' || e.t === 'tech') { burst(wx, 6, 8, '#8d8a75', 3); if (e.t === 'tech') FX.texts.push({ s: '受け身', x: wx, y: 140, t: 0, life: 40, small: true }); }
  else if (e.t === 'counter') { burst(wx, wy, 16, '#fff6dc', 6, true); FX.shake = 8; FX.flash = 5; FX.texts.push({ s: '返し', x: wx, y: wy + 80, t: 0, life: 50, seal: true, c: e.p }); FX.last = { kind: 'カウンター成立', mv: 'ctrHit', adv: null }; }
  else if (e.t === 'clash') { burst(wx, wy, 12, '#ffffff', 5, true); }
  else if (e.t === 'finish') { const z = e.p >= 0 && sim.p[e.p].kit === 'ouka'; FX.finish = { t: 0, how: e.how, name: e.name, p: e.p, tier: sim.result.tier, x: e.x / FP, y: e.y / FP, zetsu: z }; FX.shake = 14; if (z) { SND.play('finish'); petals(e.x / FP, e.y / FP, 80, 9); } }
  else if (e.t === 'bloom') { const p = sim.p[e.p];
    petals(e.x / FP, e.y / FP + 60, e.stage === 1 ? 30 : 80, e.stage === 1 ? 4 : 7);
    if (e.stage >= 2) petals(e.x / FP, e.y / FP + 140, 50, 9);
    FX.ouka.push({ k: 'ring', x: e.x / FP, y: e.y / FP + 4, t: 0, life: 36, r: e.stage === 1 ? 140 : 260, flat: true });
    SND.play('bloom'); /* 段階が上がるときのカットインはなし（2026-11-26 ユーザー指定）、止まらない */ for (const q of STORM) { q.x = Math.random(); q.y = Math.random(); }
    FX.grow[e.p] = 0; FX.shake = 6 + e.stage * 3; FX.pflash = 6 + e.stage * 2; }
  else if (e.t === 'start' && OUKA_MV[e.mv]) oukaStart(e);
  else if (e.t === 'fallBurst') { const x = e.x / FP, y = e.y / FP; for (const d of [1, -1]) for (let k = 0; k < 40; k++) FX.parts.push({ x, y: y + 10 + rnd() * 40, vx: d * (2 + rnd() * 9), vy: 1 + rnd() * 4, life: 50 + rnd() * 30, t: 0, col: k % 3 ? SAKURA[k % 3] : CRIM[k % 3], r: 3 + rnd() * 3, petal: true, rot: rnd() * 6 });
    FX.ouka.push({ k: 'ring', x, y: y + 4, t: 0, life: 34, r: 420, flat: true }); FX.shake = 16; FX.pflash = 9; SND.play('drum'); SND.play('kotoChord'); }
  else if (e.t === 'treeGone') { petals(e.x / FP, e.y / FP + 70, 30, 3); FX.gone.push({ x: e.x / FP, y: e.y / FP, t: 0, p: e.p }); }
  else if (e.t === 'treeBreak') { petals(e.x / FP, e.y / FP + 70, 36, 6); burst(e.x / FP, e.y / FP + 40, 16, '#4a3528', 5); FX.shake = 8; FX.texts.push({ s: '折', x: e.x / FP, y: e.y / FP + 120, t: 0, life: 60, seal: true, c: e.by }); }
  else if (e.t === 'treeHit') { burst(e.x / FP, e.y / FP, 6, '#4a3528', 3); petals(e.x / FP, e.y / FP, 4, 3); }
  else if (e.t === 'sd') { FX.texts.push({ s: 'サドンデス　一太刀で決まる', x: 0, y: 0, t: 0, life: 120, screen: true }); }
}
/* ---------- 絶の音（琴と尺八を合成。絶の技だけ鳴る） ---------- */
const SND = (function(){
  let ac = null;
  const wake = () => { try { if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch (e) {} };
  addEventListener('pointerdown', wake, true); addEventListener('keydown', wake, true);
  const N = [146.83, 155.56, 196, 220, 233.08, 293.66, 311.13, 392, 440, 466.16, 587.33, 622.25, 783.99, 880]; // 都節（D Eb G A Bb）
  function koto(f, t0, dur, g){ // 弦をはじく音（Karplus-Strong）
    const sr = ac.sampleRate, n = Math.floor(sr * dur), buf = ac.createBuffer(1, n, sr), d = buf.getChannelData(0), P = Math.max(2, Math.round(sr / f)), ring = new Float32Array(P);
    for (let i = 0; i < P; i++) ring[i] = Math.random() * 2 - 1;
    let k = 0; for (let i = 0; i < n; i++) { const a = ring[k], b = ring[(k + 1) % P]; d[i] = a; ring[k] = (a + b) * 0.4985; k = (k + 1) % P; }
    const src = ac.createBufferSource(), gn = ac.createGain(); src.buffer = buf; gn.gain.value = g; src.connect(gn).connect(ac.destination); src.start(t0);
  }
  function shaku(f, t0, dur, g, bend){ // 息の混じった笛
    const o = ac.createOscillator(), lfo = ac.createOscillator(), ld = ac.createGain(), gn = ac.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(f * (bend ? 0.94 : 1), t0); o.frequency.linearRampToValueAtTime(f, t0 + 0.25);
    lfo.frequency.value = 5.2; ld.gain.value = f * 0.012; lfo.connect(ld).connect(o.frequency);
    gn.gain.setValueAtTime(0, t0); gn.gain.linearRampToValueAtTime(g, t0 + 0.18); gn.gain.setValueAtTime(g, t0 + dur * 0.6); gn.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(gn).connect(ac.destination); o.start(t0); lfo.start(t0); o.stop(t0 + dur); lfo.stop(t0 + dur);
    const sr = ac.sampleRate, nb = ac.createBuffer(1, Math.floor(sr * dur), sr), nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const ns = ac.createBufferSource(), bp = ac.createBiquadFilter(), ng = ac.createGain(); ns.buffer = nb; bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 3;
    ng.gain.setValueAtTime(0, t0); ng.gain.linearRampToValueAtTime(g * 0.35, t0 + 0.08); ng.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    ns.connect(bp).connect(ng).connect(ac.destination); ns.start(t0);
  }
  function drum(t0, g){ const o = ac.createOscillator(), gn = ac.createGain(); o.frequency.setValueAtTime(110, t0); o.frequency.exponentialRampToValueAtTime(42, t0 + 0.45);
    gn.gain.setValueAtTime(g, t0); gn.gain.exponentialRampToValueAtTime(0.001, t0 + 0.6); o.connect(gn).connect(ac.destination); o.start(t0); o.stop(t0 + 0.6); }
  const P = {
    hana: t => [5, 7, 9, 12].forEach((n, i) => koto(N[n], t + i * 0.045, 1.2, 0.32)),
    ten: t => { shaku(N[8], t, 0.9, 0.16, true); koto(N[5], t, 1.4, 0.3); koto(N[10], t + 0.12, 1.4, 0.25); },
    plant: t => { koto(N[0], t, 2, 0.4); koto(N[2], t + 0.1, 2, 0.3); },
    bloom: t => { for (let i = 0; i < 9; i++) koto(N[3 + i], t + i * 0.05, 1.6, 0.26); shaku(N[10], t + 0.2, 1.6, 0.15, true); drum(t, 0.5); },
    draw: t => { shaku(N[7], t, 2.2, 0.16, true); for (let i = 0; i < 8; i++) koto(N[13 - i], t + 0.6 + i * 0.06, 1.8, 0.24); drum(t + 0.8, 0.6); },
    drum: t => drum(t, 0.7),
    kotoChord: t => [5, 8, 10].forEach(n => koto(N[n], t, 1.8, 0.28)),
    hit: t => koto(N[12], t, 0.7, 0.22),
    finish: t => { drum(t, 0.7); for (let i = 0; i < 12; i++) koto(N[2 + i % 12], t + 0.1 + i * 0.07, 2.2, 0.24); shaku(N[9], t + 0.5, 2.6, 0.17, true); },
  };
  return { play(n){ if (!ac || ac.state !== 'running' || !P[n]) return; try { P[n](ac.currentTime + 0.01); } catch (e) {} } };
})();
/* 桜華の技の始まりの演出 */
const OUKA_MV = { hana: 1, ten: 1, tenK: 1, tenM: 1, tenR: 1, tenFall: 1, plant: 1, petal: 1, petalS: 1 };
function oukaStart(e){
  const p = sim.p[e.p], x = p.x / FP, y = p.y / FP, b = p.boost || 0, f = p.face;
  SND.play(e.mv === 'hana' ? 'hana' : e.mv === 'plant' ? 'plant' : e.mv === 'tenFall' ? 'kotoChord' : 'ten');
  if (e.mv === 'hana') { FX.ouka.push({ k: 'fan', x, y: y + 62, f, t: 0, life: 30, b }); FX.shake = 4 + b * 2; FX.pflash = 3 + b * 2; }
  else if (e.mv === 'plant') { FX.ouka.push({ k: 'roots', x: x + f * 20, y, t: 0, life: 40 }); FX.shake = 5; }
  else if (e.mv === 'tenFall') { FX.ouka.push({ k: 'storm', p: e.p, t: 0, life: 999 }); FX.pflash = 6; }
  else { const big = e.mv !== 'ten'; FX.ouka.push({ k: 'pillar', x, y, t: 0, life: big ? 46 : 32, w: big ? 120 : 70, crim: e.mv === 'tenR' || e.mv === 'tenM' });
    petals(x, y + 10, big ? 40 : 16, big ? 7 : 4); FX.shake = big ? 9 : 5; FX.pflash = big ? 7 : 3;
    if (e.mv === 'tenM' || e.mv === 'tenR') FX.ouka.push({ k: 'ring', x, y: y + 80, t: 0, life: 26, r: 150 }); }
}
function petals(x, y, n, sp){
  for (let k = 0; k < n; k++) { const a = rnd() * Math.PI * 2, v = sp * (0.3 + rnd()); FX.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v + 1.5, life: 50 + rnd() * 40, t: 0, col: SAKURA[k % 3], r: 3 + rnd() * 2.5, petal: true, rot: rnd() * 6 }); }
}
const SAKURA = ['#f6c6d4', '#f9dbe4', '#ec9fb8'], CRIM = ['#8e0f22', '#2a0508', '#c2193a'];
function burst(x, y, n, col, sp, spark){
  for (let k = 0; k < n; k++) { const a = rnd() * Math.PI * 2, v = sp * (0.4 + rnd()); FX.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v + 1, life: 18 + rnd() * 18, t: 0, col, r: spark ? 1.6 : 1.5 + rnd() * 3.5, spark }); }
}
function tickParts(){
  for (const q of FX.parts) { q.t++; q.x += q.vx; q.y += q.vy; if (q.petal) { q.vy = Math.max(-1.2, q.vy - 0.08); q.vx = q.vx * 0.96 + Math.sin((q.t + q.rot * 20) * 0.08) * 0.08; q.rot += 0.08; } else { q.vy -= 0.25; q.vx *= 0.94; } }
  for (const g of FX.gone) g.t++; FX.gone = FX.gone.filter(g => g.t < 40);
  for (let i = 0; i < 2; i++) if (FX.grow[i] != null && FX.grow[i] < 30) FX.grow[i]++;
  if (FX.pflash > 0) FX.pflash--;
  for (const o of FX.ouka) o.t++;
  // 花嵐の花びらは尾を引く。紅と黒が混じる
  for (const q of sim.pj) if (q.petal) for (let k = 0, n = q.hana ? 1 + Math.round(q.w / q.w0) : 2; k < n; k++) FX.parts.push({ x: q.x / FP + (rnd() - 0.5) * q.w * 0.6, y: q.y / FP + (rnd() - 0.5) * q.h * 0.6, vx: -Math.sign(q.vx) * (1 + rnd() * 2), vy: (rnd() - 0.3) * 1.5, life: 26 + rnd() * 20, t: 0, col: k ? SAKURA[FR % 3] : CRIM[(FR + k) % 3], r: 2.5 + rnd() * 2, petal: true, rot: rnd() * 6 });
  // 天桜: 体のまわりを花びらが渦を巻いて昇る / 降下は花の嵐
  for (const p of sim.p) if (p.st === 'atk' && OUKA_MV[p.mv] && p.mv.startsWith('ten')) {
    const n = p.mv === 'ten' ? 2 : 5, fall = p.mv === 'tenFall';
    for (let k = 0; k < n; k++) { const a = FR * 0.5 + k * (6.28 / n), R = 30 + rnd() * 30;
      FX.parts.push({ x: p.x / FP + Math.cos(a) * R, y: p.y / FP + 40 + rnd() * 80, vx: -Math.sin(a) * 3, vy: fall ? 4 + rnd() * 3 : -2 - rnd() * 2, life: 24 + rnd() * 16, t: 0, col: k % 3 === 2 ? CRIM[k % 3] : SAKURA[k % 3], r: 3 + rnd() * 2.5, petal: true, rot: rnd() * 6 }); } }
  // 降下が終わった（着地した）瞬間に花の衝撃
  for (const o of FX.ouka) if (o.k === 'storm' && o.life === 999) { const p = sim.p[o.p];
    if (!(p.st === 'atk' && p.mv === 'tenFall')) { o.life = 0; const x = p.x / FP, y = p.y / FP;
      FX.ouka.push({ k: 'ring', x, y: y + 4, t: 0, life: 30, r: 240, flat: true }); FX.ouka.push({ k: 'ring', x, y: y + 40, t: 0, life: 22, r: 160 });
      petals(x, y + 20, 70, 9); burst(x, y + 10, 18, '#2a0508', 7); FX.shake = 14; FX.pflash = 8; } }
  FX.ouka = FX.ouka.filter(o => o.t < o.life);
  // 落花の木は花びらを散らし続ける
  for (const p of sim.p) if (p.tree && p.tree.stage === 3 && FR % 3 === 0) { const t = p.tree; FX.parts.push({ x: t.x / FP + (rnd() - 0.5) * 130, y: t.y / FP + 120 + rnd() * 50, vx: (rnd() - 0.3) * 1.2, vy: -0.4, life: 120, t: 0, col: SAKURA[FR % 3], r: 3 + rnd() * 2, petal: true, rot: rnd() * 6 }); }
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
  if (st === 'hit') { P.lean = -10 - Math.min(10, p.hs * 0.6); P.sw = 45; P.arm = 20; P.hip = 54; }
  if (st === 'tumble') { P.rot = -fr * 18 * (p.face); P.fA = [-14, 18]; P.fB = [18, 8]; P.sw = 140; P.arm = 60; }
  if (st === 'stun') { const sway = Math.sin(fr * 0.15) * 6; P.lean = 26 + sway; P.head = 25; P.sw = -95; P.arm = -80; P.hip = 50; P.fA = [-12, 0]; P.fB = [12, 0]; }
  if (st === 'down' || st === 'ko') { P.rot = 90 * 1; P.hip = 14; P.sw = -170; P.fA = [-30, 0]; P.fB = [-26, 2]; P.lean = 0; }
  if (st === 'roll' && p.rk === 'spot') { P.hip = 46; P.lean = -14; P.sw = 70; P.arm = 20; P.alpha = A.invuln(p) ? 0.4 : 1; }
  else if (st === 'roll' || (st === 'getup' && p.gk === 'roll')) { P.rot = -(p.f * 14) * (p.rollDir * p.face); P.hip = 34; P.fA = [-8, 14]; P.fB = [10, 14]; P.sw = 10; P.alpha = (A.invuln(p)) ? 0.6 : 1; }
  if (st === 'tech' || (st === 'getup' && p.gk !== 'roll')) { P.hip = 40; P.lean = 20; P.alpha = A.invuln(p) ? 0.6 : 1; }
  if (st === 'atk') { // 技の最中は判定と同じ形（pose.js）
    const Q = window.IssenPose.attackPose(p.mv, MV[p.mv], p.mvf);
    Object.assign(P, Q); P.rot = 0; P.head = 0;
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
  c.save(); c.translate(sx, sy); c.scale(z * p.face * MIR, -z);
  c.globalAlpha = P.alpha;
  if (WORLD.f > 0.3) { c.shadowColor = `rgba(255,214,224,${0.8 * WORLD.f})`; c.shadowBlur = 8; } // 落花の夜でも姿が見えるように縁を光らせる
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
  const ext = p.st === 'atk' ? (MV[p.mv].ext || 0) : 0; // 刀より先まで届く技は軌跡も伸ばす
  const etx = tipx + Math.cos(sa) * ext, ety = tipy + Math.sin(sa) * ext;
  if (!P.sheath) {
    c.strokeStyle = '#2b2520'; c.lineWidth = 5; c.beginPath(); c.moveTo(hnx - Math.cos(sa) * 12, hny - Math.sin(sa) * 12); c.lineTo(hnx, hny); c.stroke();
    c.strokeStyle = '#c9a54a'; c.lineWidth = 3; c.beginPath(); c.moveTo(hnx + Math.cos(sa + 1.57) * 5, hny + Math.sin(sa + 1.57) * 5); c.lineTo(hnx - Math.cos(sa + 1.57) * 5, hny - Math.sin(sa + 1.57) * 5); c.stroke();
    c.strokeStyle = p.kit === 'ouka' ? '#f6dde6' : '#e8e6df'; c.lineWidth = 2.6; c.beginPath(); c.moveTo(hnx, hny); c.lineTo(tipx, tipy); c.stroke();
    c.strokeStyle = 'rgba(20,21,18,.55)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(hnx, hny); c.lineTo(tipx, tipy); c.stroke();
  }
  c.restore();
  // 刀の先（軌跡用）を世界の座標で返す
  const toW = (lx, ly) => {
    let x = lx, y = ly;
    if (P.rot) { const r = rad(P.rot), yy = y - P.hip; const nx = x * Math.cos(r) - yy * Math.sin(r), ny = x * Math.sin(r) + yy * Math.cos(r) + P.hip; x = nx; y = ny; }
    return [p.x / FP + x * p.face, p.y / FP + y];
  };
  p._tip = toW(etx, ety); p._hand = toW(hnx, hny);
  // 突き（刀の向きが変わらない技）は、届くところまで白い筋を出す
  if (p.st === 'atk') { const m = MV[p.mv]; if (m.arc[0] === m.arc[1] && !m.noBox && p.mvf >= m.s && p.mvf < m.s + m.a) {
    const h = p._hand, t = p._tip, nx = -(t[1] - h[1]), ny = t[0] - h[0], L = Math.hypot(nx, ny) || 1, w = 7;
    const b0 = [h[0] + (t[0] - h[0]) * 0.3, h[1] + (t[1] - h[1]) * 0.3];
    cx.save(); cx.globalCompositeOperation = 'lighter'; cx.fillStyle = 'rgba(250,246,236,.85)'; cx.beginPath();
    cx.moveTo(wx(b0[0] + nx / L * w), wy(b0[1] + ny / L * w)); cx.lineTo(wx(t[0]), wy(t[1])); cx.lineTo(wx(b0[0] - nx / L * w), wy(b0[1] - ny / L * w)); cx.closePath(); cx.fill(); cx.restore(); } } p._sheath = P.sheath;
}
function recordTrail(p){
  const tr = FX.trails[p.i];
  const swinging = p.st === 'atk' && !MV[p.mv].noBox && p.mvf >= MV[p.mv].s - 1 && p.mvf < MV[p.mv].s + MV[p.mv].a;
  if (swinging && p._tip) { const ox = p.x / FP, oy = p.y / FP; tr.push({ t: [p._tip[0] - ox, p._tip[1] - oy], h: [p._hand[0] - ox, p._hand[1] - oy], life: 10, iai: !!MV[p.mv].iai }); }
  if (!swinging && p.st !== 'atk') tr.length = 0;
  for (const q of tr) q.life--;
  FX.trails[p.i] = tr.filter(q => q.life > 0).slice(-10);
}
/* 桜の木。開花＝小さな木とつぼみ、満開＝大きな木と花、落花＝花が減って散っている */
function drawTree(t, owner, grow){
  const x = wx(t.x / FP), y = wy(t.y / FP), z = cam.z * (grow || 1), st = t.stage;
  const H = st === 1 ? 78 : 165, Wd = st === 1 ? 5 : 13;
  let sd = 1009 + owner * 77; const r = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  cx.save(); cx.translate(x, y); cx.scale(MIR, 1);
  cx.fillStyle = 'rgba(20,21,18,.22)'; cx.beginPath(); cx.ellipse(0, 0, (st === 1 ? 26 : 70) * z, 6 * z, 0, 0, Math.PI * 2); cx.fill();
  cx.strokeStyle = '#3d2a22'; cx.lineCap = 'round';
  const tips = [];
  const branch = (bx, by, ang, len, w, d) => {
    const ex = bx + Math.cos(ang) * len, ey = by - Math.sin(ang) * len;
    cx.lineWidth = Math.max(1, w * z); cx.beginPath(); cx.moveTo(bx * z, by * z); cx.quadraticCurveTo((bx + ex) / 2 * z + 4 * z, (by + ey) / 2 * z, ex * z, ey * z); cx.stroke();
    if (d <= 0) { tips.push([ex, ey]); return; }
    const n = st === 1 ? 2 : 3;
    for (let k = 0; k < n; k++) branch(ex, ey, ang + (k - (n - 1) / 2) * 0.55 + (r() - 0.5) * 0.3, len * (0.62 + r() * 0.12), w * 0.62, d - 1);
  };
  branch(0, 0, Math.PI / 2 + 0.05, H * 0.45, Wd, st === 1 ? 2 : 3);
  for (const [tx, ty] of tips) {
    if (st === 1) { // つぼみ
      for (let k = 0; k < 2; k++) { cx.fillStyle = k ? '#f3b6c8' : '#c95b7e'; cx.beginPath(); cx.arc((tx + (r() - 0.5) * 8) * z, (ty + (r() - 0.5) * 8) * z, (k ? 3 : 2.4) * z, 0, Math.PI * 2); cx.fill(); }
      continue; }
    const n = 7, ga = cx.globalAlpha; // 落花は花が減って薄く、若葉がのぞく
    for (let k = 0; k < n; k++) { const px = (tx + (r() - 0.5) * 34) * z, py = (ty + (r() - 0.5) * 26) * z, rr = (6 + r() * 7) * z;
      if (st === 3 && k % 3) { if (k % 3 === 1) { cx.fillStyle = '#8fa36a'; cx.globalAlpha = ga * 0.7; cx.beginPath(); cx.ellipse(px, py, rr * 0.5, rr * 0.3, k, 0, Math.PI * 2); cx.fill(); } continue; }
      cx.fillStyle = SAKURA[k % 3]; cx.globalAlpha = ga * (st === 3 ? 0.75 : 1); cx.beginPath(); cx.arc(px, py, st === 3 ? rr * 0.8 : rr, 0, Math.PI * 2); cx.fill(); }
    cx.globalAlpha = ga;
  }
  cx.restore();
  if (t.hp < A.TREE.hp) { const w = 60 * cam.z, yy = wy(t.y / FP + (st === 1 ? 92 : 185)); cx.fillStyle = 'rgba(20,21,18,.35)'; cx.fillRect(x - w / 2, yy, w, 4); cx.fillStyle = '#ec9fb8'; cx.fillRect(x - w / 2, yy, w * t.hp / A.TREE.hp, 4); }
}
/* 桜華の大きな演出: 扇・柱・輪・根・切り口・段階の文字 */
function drawOukaFx(){
  for (const o of FX.ouka) {
    const u = o.t / o.life, ease = 1 - Math.pow(1 - u, 3), fade = 1 - u;
    cx.save();
    if (o.k === 'fan') { // 花嵐: 前へ開く花の扇
      const R = (120 + o.b * 60) * ease * cam.z, x = wx(o.x), y = wy(o.y), dir = o.f * MIR > 0 ? 0 : Math.PI, sp = o.b === 3 ? 1.2 : 0.5 + o.b * 0.12;
      cx.globalCompositeOperation = 'lighter';
      const g = cx.createRadialGradient(x, y, 0, x, y, R); g.addColorStop(0, `rgba(255,200,220,${0.5 * fade})`); g.addColorStop(0.6, `rgba(194,25,58,${0.35 * fade})`); g.addColorStop(1, 'rgba(194,25,58,0)');
      cx.fillStyle = g; cx.beginPath(); cx.moveTo(x, y); cx.arc(x, y, R, dir - sp, dir + sp); cx.closePath(); cx.fill();
      cx.strokeStyle = `rgba(255,235,242,${0.8 * fade})`; cx.lineWidth = 2; cx.beginPath(); cx.arc(x, y, R * 0.95, dir - sp, dir + sp); cx.stroke();
    } else if (o.k === 'pillar') { // 天桜: 花の柱
      const x = wx(o.x), y0 = wy(o.y), h = 420 * ease * cam.z, w = o.w * cam.z * (0.6 + 0.4 * fade);
      cx.globalCompositeOperation = 'lighter';
      const g = cx.createLinearGradient(x - w, 0, x + w, 0); const c = o.crim ? '194,25,58' : '255,170,200';
      g.addColorStop(0, `rgba(${c},0)`); g.addColorStop(0.5, `rgba(${c},${0.45 * fade})`); g.addColorStop(1, `rgba(${c},0)`);
      cx.fillStyle = g; cx.fillRect(x - w, y0 - h, w * 2, h);
      cx.fillStyle = `rgba(255,245,248,${0.6 * fade})`; cx.fillRect(x - 3 * cam.z, y0 - h, 6 * cam.z, h);
    } else if (o.k === 'ring') { // 輪
      const x = wx(o.x), y = wy(o.y), R = o.r * ease * cam.z;
      cx.strokeStyle = `rgba(255,190,210,${0.9 * fade})`; cx.lineWidth = 5 * fade * cam.z + 1;
      cx.beginPath(); if (o.flat) cx.ellipse(x, y, R, R * 0.22, 0, 0, Math.PI * 2); else cx.arc(x, y, R, 0, Math.PI * 2); cx.stroke();
      cx.strokeStyle = `rgba(142,15,34,${0.8 * fade})`; cx.lineWidth = 2;
      cx.beginPath(); if (o.flat) cx.ellipse(x, y, R * 0.8, R * 0.18, 0, 0, Math.PI * 2); else cx.arc(x, y, R * 0.82, 0, Math.PI * 2); cx.stroke();
    } else if (o.k === 'roots') { // 植樹: 刀を突き立てた所から光の根
      const x = wx(o.x), y = wy(o.y); let sd = 31; const r = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
      cx.globalCompositeOperation = 'lighter'; cx.strokeStyle = `rgba(255,120,160,${0.85 * fade})`; cx.lineCap = 'round';
      for (let k = 0; k < 9; k++) { const a = (k / 8 - 0.5) * 2.6, L = (90 + r() * 120) * ease * cam.z; cx.lineWidth = (3 - k % 3) * cam.z + 1;
        cx.beginPath(); cx.moveTo(x, y + 2); cx.quadraticCurveTo(x + Math.sin(a) * L * 0.5, y + 8 * cam.z, x + Math.sin(a) * L, y + (4 + r() * 10) * cam.z); cx.stroke(); }
      const g = cx.createRadialGradient(x, y, 0, x, y, 70 * cam.z); g.addColorStop(0, `rgba(255,210,225,${0.7 * fade})`); g.addColorStop(1, 'rgba(194,25,58,0)'); cx.fillStyle = g; cx.fillRect(x - 70 * cam.z, y - 70 * cam.z, 140 * cam.z, 140 * cam.z);
    } else if (o.k === 'cut') { // 当たりの紅い切り口
      const x = wx(o.x), y = wy(o.y), L = 70 * cam.z * (0.4 + ease);
      cx.translate(x, y); cx.rotate(o.a); cx.fillStyle = `rgba(160,14,36,${fade})`;
      cx.beginPath(); cx.moveTo(-L, 0); cx.lineTo(0, -4 * cam.z * fade - 1); cx.lineTo(L, 0); cx.lineTo(0, 4 * cam.z * fade + 1); cx.closePath(); cx.fill();
      cx.fillStyle = `rgba(255,230,236,${fade})`; cx.fillRect(-L * 0.7, -0.8, L * 1.4, 1.6);
    } else if (o.k === 'band') { // 段階の文字: 赤黒の墨の帯に白い字
      const x = wx(o.x), y = wy(o.y) - o.t * 0.25, a = Math.min(1, o.t / 6) * (o.t > o.life - 14 ? (o.life - o.t) / 14 : 1), bw = 150 * cam.z * Math.min(1, o.t / 8) + 20, s = Math.round(40 * cam.z + 10);
      cx.globalAlpha = a; cx.fillStyle = 'rgba(40,4,10,.82)'; cx.beginPath(); cx.moveTo(x - bw, y - s * 0.45); cx.lineTo(x + bw, y - s * 0.62); cx.lineTo(x + bw * 0.92, y + s * 0.5); cx.lineTo(x - bw * 1.04, y + s * 0.4); cx.closePath(); cx.fill();
      cx.fillStyle = '#b3142a'; cx.fillRect(x - bw, y + s * 0.42, bw * 2, 2);
      cx.font = `${s}px ${DISPLAY}`; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.shadowColor = 'rgba(255,120,160,.9)'; cx.shadowBlur = 16; cx.fillStyle = '#ffe6ee'; cx.fillText(o.s, x, y); cx.textBaseline = 'alphabetic';
    }
    cx.restore();
  }
}
function drawTrails(){
  for (let i = 0; i < 2; i++) {
    const tr = FX.trails[i]; if (tr.length < 2) continue;
    const ox = sim.p[i].x / FP, oy = sim.p[i].y / FP;
    cx.save();
    cx.globalCompositeOperation = 'lighter';
    for (let k = 1; k < tr.length; k++) {
      const a = tr[k - 1], b = tr[k], al = Math.min(1, b.life / 10);
      cx.fillStyle = b.iai ? `rgba(255,255,255,${0.85 * al})` : sim.p[i].kit === 'ouka' ? `rgba(250,200,218,${0.6 * al})` : `rgba(240,236,226,${0.55 * al})`;
      cx.beginPath();
      const mid = (q, f) => [ox + q.h[0] + (q.t[0] - q.h[0]) * f, oy + q.h[1] + (q.t[1] - q.h[1]) * f];
      const a1 = mid(a, 0.3), b1 = mid(b, 0.3);
      cx.moveTo(wx(a1[0]), wy(a1[1])); cx.lineTo(wx(ox + a.t[0]), wy(oy + a.t[1])); cx.lineTo(wx(ox + b.t[0]), wy(oy + b.t[1])); cx.lineTo(wx(b1[0]), wy(b1[1]));
      cx.closePath(); cx.fill();
    }
    cx.restore();
  }
}

/* ---------- 画面の座標 ---------- */
let GROUND = 0;
const wx = x => (x - cam.x) * cam.z * MIR + W / 2; // 向かい側の画面は左右を返す
const wy = y => GROUND - (y - cam.y) * cam.z;
function updateCam(){
  // 画面は動かさない（キャラに合わせて動くと酔うので、2026-11-26 ユーザー指定）。戦場全体がいつも入るように固定
  setView(VIEWS[0]);
  cam.x = 800; cam.y = 0; cam.z = Math.min(W / 1640, GROUND / 560);
}

/* ---------- 背景 ---------- */
const BAMBOO = [];
(function(){ let s = 99; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let layer = 0; layer < 3; layer++) for (let k = 0; k < 26 - layer * 6; k++) BAMBOO.push({ layer, x: -200 + r() * 2000, w: [7, 11, 17][layer] * (0.8 + r() * 0.5), lean: (r() - 0.5) * 0.04, node: 70 + r() * 50 });
})();
function drawBg(fr){
  const sdOn = sim.sd || lastBout();
  const g = cx.createLinearGradient(0, 0, 0, H);
  if (sdOn) { g.addColorStop(0, '#5a1712'); g.addColorStop(1, '#a8382a'); }
  else { g.addColorStop(0, '#d8d6c6'); g.addColorStop(0.65, '#c9c9b4'); g.addColorStop(1, '#b4b59c'); }
  cx.fillStyle = g; cx.fillRect(0, 0, W, H);
  if (sdOn) { cx.fillStyle = 'rgba(255,214,170,.85)'; cx.beginPath(); cx.arc(W * 0.72, H * 0.24, Math.min(W, H) * 0.11, 0, Math.PI * 2); cx.fill(); }
  const cols = sdOn ? ['rgba(60,10,8,.35)', 'rgba(50,8,6,.55)', 'rgba(30,5,4,.85)'] : ['rgba(120,128,104,.35)', 'rgba(84,94,72,.55)', 'rgba(40,46,36,.85)'];
  const par = [0.35, 0.6, 0.85];
  for (const b of BAMBOO) {
    const z = cam.z * par[b.layer] + (1 - par[b.layer]) * 0.6;
    const x = W / 2 + MIR * ((b.x - cam.x * par[b.layer]) * z - (800 * (1 - par[b.layer])) * z);
    if (x < -40 || x > W + 40) continue;
    cx.fillStyle = cols[b.layer];
    const bw = b.w * z;
    cx.save(); cx.translate(x, GROUND); cx.rotate(b.lean);
    cx.fillRect(-bw / 2, -H * 1.3, bw, H * 1.3);
    cx.fillStyle = sdOn ? 'rgba(20,0,0,.35)' : 'rgba(20,24,18,.25)';
    for (let y = -b.node * z; y > -H * 1.3; y -= b.node * z) cx.fillRect(-bw / 2 - 1, y, bw + 2, Math.max(1.5, 2.5 * z));
    cx.restore();
  }
  drawSakuraWorld(fr);
  // 地面
  const gy = wy(0);
  cx.fillStyle = sdOn ? '#2a0806' : '#3a3d30'; cx.fillRect(0, gy, W, H - gy);
  if (WORLD.b > 0.01) { cx.globalAlpha = WORLD.b * (1 - WORLD.f); cx.fillStyle = '#5b2f3b'; cx.fillRect(0, gy, W, H - gy); cx.globalAlpha = WORLD.f; cx.fillStyle = '#160204'; cx.fillRect(0, gy, W, H - gy); cx.globalAlpha = 1;
    cx.globalAlpha = 1; }
  cx.fillStyle = sdOn ? 'rgba(255,120,90,.2)' : 'rgba(239,232,214,.18)'; cx.fillRect(0, gy, W, 2);
  // 端の太い竹
  for (const ex of [A.WALL_L / FP - 30, A.WALL_R / FP + 30]) { const x = wx(ex); cx.fillStyle = sdOn ? '#200403' : '#2d3227'; cx.fillRect(x - 24 * cam.z, 0, 48 * cam.z, gy); }
  // 足場（倒れた竹）
  for (const pl of A.PLATS) {
    const xa = wx(pl.x0 / FP), xb = wx(pl.x1 / FP), x0 = Math.min(xa, xb), x1 = Math.max(xa, xb), y = wy(pl.y / FP);
    cx.fillStyle = sdOn ? '#3a0c08' : '#5d6447'; cx.fillRect(x0, y - 1, x1 - x0, 11 * cam.z);
    cx.fillStyle = 'rgba(0,0,0,.3)'; for (let x = x0 + 40 * cam.z; x < x1; x += 70 * cam.z) cx.fillRect(x, y - 1, 2.5 * cam.z, 11 * cam.z);
    cx.fillStyle = 'rgba(255,255,240,.15)'; cx.fillRect(x0, y - 1, x1 - x0, 2);
  }
  // 笹（桜の世界では花びらに替わる）
  if (WORLD.b > 0.5) return;
  cx.fillStyle = sdOn ? 'rgba(200,40,30,.7)' : 'rgba(70,84,60,.5)';
  for (let k = 0; k < 14; k++) { const t = (fr * 0.6 + k * 97) % (H + 80), x = (k * 173 + Math.sin((fr + k * 40) * 0.02) * 40) % W; cx.save(); cx.translate(x, t - 40); cx.rotate(Math.sin(fr * 0.03 + k) * 0.8); cx.fillRect(-6, -1.5, 12, 3); cx.restore(); }
}

/* ---------- 桜華の世界 ----------
   木が満開になると竹林が桜の森に、落花になると赤黒い夜に花が吹き荒れる世界に塗り替わる（両方の画面とも） */
const WORLD = { b: 0, f: 0, k: 0, m: 0 };
const SKTREES = []; (function(){ let s = 4242; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  // 奥行きなし: 同じ大きさ・同じ色の木を一列に（2026-11-26 ユーザー指定）
  for (let k = 0; k < 9; k++) { const blobs = []; for (let j = 0; j < 9; j++) blobs.push([(r() - 0.5) * 1.6, r() * 0.7, 0.35 + r() * 0.45]);
    SKTREES.push({ layer: 1, x: 20 + k * 195 + (r() - 0.5) * 60, h: 470 * (0.9 + r() * 0.2), w: 175 * (0.9 + r() * 0.2), blobs }); } })();
function updateWorld(){
  let st = 0; for (const p of sim.p) if (p.tree && p.tree.stage > st) st = p.tree.stage;
  const zetsu = sim.p.some(p => p.kit === 'ouka'); // 絶の刀を持つ者がいる戦場は、最初から桜の森
  WORLD.b += ((zetsu || st >= 2 ? 1 : 0) - WORLD.b) * 0.06; WORLD.f += ((st >= 3 ? 1 : 0) - WORLD.f) * 0.05;
  WORLD.k += ((zetsu ? 1 : 0) - WORLD.k) * 0.05; WORLD.m += ((st >= 2 ? 1 : 0) - WORLD.m) * 0.05;
  if (FX.finish && FX.finish.zetsu) { WORLD.k = 1; WORLD.m = Math.min(1, WORLD.m + 0.05); }
}
function drawSakuraWorld(fr){
  const b = WORLD.b, f = WORLD.f; if (b < 0.01) return;
  const gy = wy(0);
  // 空: 満開は薄紅の霞、落花は紅から黒へ
  let g = cx.createLinearGradient(0, 0, 0, gy); g.addColorStop(0, '#fbe6ec'); g.addColorStop(0.6, '#f2bccb'); g.addColorStop(1, '#d98aa2');
  cx.globalAlpha = b * (1 - f); cx.fillStyle = g; cx.fillRect(0, 0, W, gy + 2);
  g = cx.createLinearGradient(0, 0, 0, gy); g.addColorStop(0, '#060102'); g.addColorStop(0.55, '#3d0610'); g.addColorStop(1, '#8e0f22');
  cx.globalAlpha = b * f; cx.fillStyle = g; cx.fillRect(0, 0, W, gy + 2);
  // 満開: 森全体が薄紅に光る
  if (WORLD.m > 0.01) { const g2 = cx.createRadialGradient(W / 2, gy, 0, W / 2, gy, Math.max(W, H)); g2.addColorStop(0, `rgba(255,220,232,${0.35 * WORLD.m * (1 - f)})`); g2.addColorStop(1, 'rgba(255,220,232,0)'); cx.globalAlpha = 1; cx.fillStyle = g2; cx.fillRect(0, 0, W, gy); }
  // 落花の夜: 大きな月
  if (f > 0.01) { const mx = W * 0.72, my = H * 0.26, R = Math.min(W, H) * 0.2; cx.globalAlpha = b * f;
    const mg = cx.createRadialGradient(mx, my, R * 0.6, mx, my, R * 2.2); mg.addColorStop(0, 'rgba(255,214,222,.35)'); mg.addColorStop(1, 'rgba(255,214,222,0)'); cx.fillStyle = mg; cx.fillRect(mx - R * 2.2, my - R * 2.2, R * 4.4, R * 4.4);
    cx.fillStyle = '#f6dfe2'; cx.beginPath(); cx.arc(mx, my, R, 0, Math.PI * 2); cx.fill(); cx.fillStyle = 'rgba(160,30,50,.25)'; cx.beginPath(); cx.arc(mx - R * 0.25, my - R * 0.1, R * 0.82, 0, Math.PI * 2); cx.fill(); }
  // 桜の森（三つの奥行き）
  const par = [0.3, 0.55, 0.8];
  const trunk = [['#a7788a', '#7a4a5c', '#4a2430'], ['#2a0508', '#150204', '#000']], bloom = [['#f8d3de', '#f2b3c6', '#e88aa7'], ['#5a0a14', '#7d0f20', '#a3182c']];
  for (const t of SKTREES) {
    const z = cam.z, x = wx(t.x);
    if (x < -t.w * z * 1.5 || x > W + t.w * z * 1.5) continue;
    const sway = Math.sin(fr * 0.01 + t.x) * 4 * z, h = t.h * z, w = t.w * z;
    for (const [mode, al] of [[0, b * (1 - f)], [1, b * f]]) { if (al < 0.01) continue; cx.globalAlpha = al;
      cx.strokeStyle = trunk[mode][t.layer]; cx.lineCap = 'round'; cx.lineWidth = (14 - t.layer * 3) * z;
      cx.beginPath(); cx.moveTo(x, gy); cx.quadraticCurveTo(x + 18 * z, gy - h * 0.5, x + sway, gy - h * 0.72); cx.stroke();
      cx.lineWidth = (6 - t.layer) * z; cx.beginPath(); cx.moveTo(x + 6 * z, gy - h * 0.5); cx.lineTo(x - w * 0.5, gy - h * 0.78); cx.moveTo(x + 8 * z, gy - h * 0.58); cx.lineTo(x + w * 0.55, gy - h * 0.84); cx.stroke();
      const keep = mode ? 0.45 : 1; // 落花は花が散って少ない
      t.blobs.forEach(([bx, by, br], j) => { if (mode && j % 2) return; if (!mode && WORLD.m < 0.5 && j % 3 === 2) return; /* 満開で花が増える */ cx.fillStyle = bloom[mode][(j + t.layer) % 3]; cx.beginPath(); cx.arc(x + sway + bx * w * 0.6, gy - h * 0.72 - by * h * 0.35, br * w * 0.55 * (mode ? 0.8 : 1), 0, Math.PI * 2); cx.fill(); }); }
  }
  cx.globalAlpha = 1;
}
/* 画面いっぱいの花吹雪（画面の座標。開花は少し、満開は舞い、落花は吹き荒れる） */
const STORM = []; for (let k = 0; k < 420; k++) STORM.push({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 1.2, r: Math.random() * 6, v: Math.random() });
function drawStorm(fr){
  const k = WORLD.k, b = WORLD.b, f = WORLD.f; if (k < 0.01 && WORLD.m < 0.01) return;
  const m = WORLD.m, n = Math.floor(30 * k + 150 * m + 240 * f), wind = 0.0006 + f * 0.006 + Math.max(0, Math.sin(fr * 0.02)) * f * 0.006, fall = 0.0012 + f * 0.003;
  const mv = CUR === VIEWS[0]; // 二画面のときも動かすのは一回だけ
  for (let i = 0; i < n; i++) { const q = STORM[i];
    if (mv) q.x += (wind + 0.0004 * Math.sin(fr * 0.03 + i)) * q.s * (MIR < 0 ? 1 : 1); if (mv) { q.y += fall * q.s + Math.sin(fr * 0.05 + i) * 0.0006; q.r += 0.05 * q.s; }
    if (q.y > 1.05) { q.y = -0.05; q.x = Math.random(); } if (q.x > 1.05) { q.x = -0.05; q.y = Math.random(); }
    const x = q.x * W, y = q.y * H, sz = (3 + q.s * 3) * (0.8 + f * 0.6);
    cx.globalAlpha = 0.55 + q.v * 0.45; cx.fillStyle = f > 0.5 && i % 3 ? CRIM[i % 3] : SAKURA[i % 3];
    cx.save(); cx.translate(x, y); cx.rotate(q.r); cx.scale(1, 0.5 + 0.5 * Math.abs(Math.sin(q.r * 1.7))); cx.beginPath(); cx.ellipse(0, 0, sz, sz * 0.55, 0, 0, Math.PI * 2); cx.fill(); cx.restore(); }
  cx.globalAlpha = 1;
  // 落花は画面の縁が紅く沈む
  if (f > 0.01) { const g = cx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75); g.addColorStop(0, 'rgba(60,2,10,0)'); g.addColorStop(1, `rgba(40,0,6,${0.55 * f})`); cx.fillStyle = g; cx.fillRect(0, 0, W, H); }
}
/* 絶の刀で勝ったとき: 赤黒の幕に刀の絵が斜めに走り、花吹雪の中に決着名 */
function drawZetsuFinish(f, t){
  const s = Math.min(W, H), out = t > 170 ? Math.max(0, (200 - t) / 30) : 1;
  cx.save(); cx.globalAlpha = Math.min(1, t / 10) * out * 0.9;
  const g = cx.createRadialGradient(W / 2, H / 2, s * 0.1, W / 2, H / 2, Math.max(W, H) * 0.8); g.addColorStop(0, '#5a0a14'); g.addColorStop(1, '#050102'); cx.fillStyle = g; cx.fillRect(0, 0, W, H);
  cx.globalAlpha = out;
  if (t >= 12 && t < 24) { cx.globalAlpha = (24 - t) / 12 * out; cx.fillStyle = '#fff'; cx.fillRect(0, 0, W, H); cx.globalAlpha = out; }
  if (OUKA_IMG.complete && OUKA_IMG.naturalWidth && t > 6) { const u = Math.min(1, (t - 6) / 14), e = 1 - Math.pow(1 - u, 3), kw = s * 1.9, kh = kw * 106 / 900;
    cx.save(); cx.translate(W / 2, H * 0.42); cx.rotate(-0.32); cx.shadowColor = 'rgba(255,90,130,1)'; cx.shadowBlur = 36; cx.drawImage(OUKA_IMG, -kw / 2 + (1 - e) * -W * 1.4, -kh / 2, kw, kh); cx.restore(); }
  cx.restore();
  for (let i = 0; i < 260; i++) { const q = STORM[i]; cx.globalAlpha = 0.85 * out; cx.fillStyle = i % 3 ? CRIM[i % 3] : SAKURA[i % 3];
    cx.beginPath(); cx.ellipse(((q.x + t * 0.003 * q.s) % 1) * W, ((q.y + t * 0.005 * q.s) % 1) * H, 4 + q.s * 3, 2 + q.s * 1.5, q.r + t * 0.06, 0, Math.PI * 2); cx.fill(); }
  cx.globalAlpha = 1;
  if (t > 26) { const a = Math.min(1, (t - 26) / 12) * out, sc = 1 + Math.max(0, (38 - t) / 12) * 0.7;
    cx.save(); cx.globalAlpha = a; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.shadowColor = 'rgba(220,30,60,1)'; cx.shadowBlur = 40; cx.fillStyle = '#fff1f4'; cx.font = `${Math.round(s * 0.2 * sc)}px ${DISPLAY}`; cx.fillText(f.name, W / 2, H * 0.62);
    cx.shadowBlur = 0; cx.font = `500 ${Math.round(s * 0.04)}px ${UIF}`; cx.fillStyle = '#ffd6e2';
    cx.fillText(`［${f.tier}］　${whoName(f.p)}　桜華にて一本`, W / 2, H * 0.62 + s * 0.15);
    const r = s * 0.045; cx.fillStyle = '#8e0f22'; cx.fillRect(W / 2 - r, H * 0.2 - r, r * 2, r * 2); cx.fillStyle = '#ffe6ec'; cx.font = `${Math.round(r * 1.5)}px ${DISPLAY}`; cx.fillText('絶', W / 2, H * 0.2 + 1);
    cx.restore(); }
}
/* 立ち合いの前: 絶の刀を抜くカットイン */
const SAYA_IMG = new Image(); SAYA_IMG.src = 'assets/katana_ouka_saya.png';
function drawZetsuIntro(t){
  const L = GAME.zin, s = Math.min(W, H), who = sim.p.find(p => p.kit === 'ouka').i, fin = t > L - 16 ? (L - t) / 16 : 1;
  cx.save(); cx.globalAlpha = fin;
  const g = cx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#050102'); g.addColorStop(0.5, '#3a0610'); g.addColorStop(1, '#050102'); cx.fillStyle = g; cx.fillRect(0, 0, W, H);
  const kw = Math.min(W * 0.92, s * 2.2), kh = kw * 106 / 900, cy = H * 0.5, x0 = (W - kw) / 2;
  const pull = Math.max(0, Math.min(1, (t - 26) / 22)), ease = 1 - Math.pow(1 - pull, 3);
  // 鞘から刃が抜けていく（刃の絵を左から見せる）
  if (OUKA_IMG.complete && OUKA_IMG.naturalWidth) { const show = 226 / 900 + (1 - 226 / 900) * ease;
    cx.save(); cx.shadowColor = 'rgba(255,110,150,.9)'; cx.shadowBlur = 20 + 30 * ease; cx.beginPath(); cx.rect(x0 - 10, cy - kh, kw * show + 10, kh * 2); cx.clip(); cx.drawImage(OUKA_IMG, x0 + ease * kw * 0.04, cy - kh / 2, kw, kh); cx.restore(); }
  if (SAYA_IMG.complete && SAYA_IMG.naturalWidth && pull < 1) { cx.save(); cx.globalAlpha = fin * (1 - pull * 0.7); cx.beginPath(); cx.rect(x0 + kw * 0.25, cy - kh, kw, kh * 2); cx.clip(); cx.drawImage(SAYA_IMG, x0 + pull * kw * 0.5, cy - kh / 2 + 2, kw, kh); cx.restore(); }
  if (t >= 46 && t < 56) { cx.globalAlpha = (56 - t) / 10 * fin; cx.fillStyle = '#fff'; cx.fillRect(0, 0, W, H); cx.globalAlpha = fin; }
  cx.textAlign = 'center'; cx.textBaseline = 'middle';
  if (t > 8) { cx.globalAlpha = Math.min(1, (t - 8) / 10) * fin; cx.font = `${Math.round(s * 0.05)}px ${DISPLAY}`; cx.fillStyle = COL[who].light; cx.fillText(whoName(who) + 'の刀', W / 2, H * 0.2); }
  if (t > 50) { const a = Math.min(1, (t - 50) / 10) * fin, sc = 1 + Math.max(0, (60 - t) / 10) * 0.5;
    cx.globalAlpha = a; cx.shadowColor = 'rgba(200,20,40,1)'; cx.shadowBlur = 30; cx.font = `${Math.round(s * 0.16 * sc)}px ${DISPLAY}`; cx.fillStyle = '#fff2f5'; cx.fillText('桜華', W / 2, H * 0.78);
    cx.shadowBlur = 0; cx.fillStyle = '#8e0f22'; const r = s * 0.05; cx.fillRect(W / 2 + s * 0.2, H * 0.78 - r, r * 2, r * 2); cx.fillStyle = '#ffe6ec'; cx.font = `${Math.round(r * 1.5)}px ${DISPLAY}`; cx.fillText('絶', W / 2 + s * 0.2 + r, H * 0.78 + 1); }
  cx.restore();
  if (t > 46) { const n = Math.min(160, (t - 46) * 6); for (let i = 0; i < n; i++) { const q = STORM[i]; cx.globalAlpha = 0.8 * fin; cx.fillStyle = i % 3 ? SAKURA[i % 3] : CRIM[i % 3]; cx.beginPath(); cx.ellipse(q.x * W, ((q.y + t * 0.004 * q.s) % 1) * H, 4 + q.s * 2, 2 + q.s, q.r + t * 0.05, 0, Math.PI * 2); cx.fill(); } cx.globalAlpha = 1; }
}
/* 段階が上がった瞬間のカットイン。止め絵で刀の絵が走り、大きな字が出る（この間は両者とも止まる） */
const OUKA_IMG = new Image(); OUKA_IMG.src = 'assets/katana_ouka.png';
function drawCutin(){
  const c = FX.cut; if (!c) return;
  const t = c.t, L = 64, s = Math.min(W, H), fin = t > L - 14 ? (L - t) / 14 : 1;
  cx.save();
  cx.globalAlpha = Math.min(1, t / 4) * fin; cx.fillStyle = c.stage === 3 ? 'rgba(10,0,2,.88)' : c.stage === 2 ? 'rgba(40,4,14,.8)' : 'rgba(20,6,10,.7)'; cx.fillRect(0, 0, W, H);
  // 斜めの帯
  cx.translate(W / 2, H / 2); cx.rotate(-0.18);
  const bw = Math.max(W, H) * 1.6, bh = s * 0.34, slide = (1 - Math.pow(1 - Math.min(1, t / 12), 3));
  const g = cx.createLinearGradient(0, -bh / 2, 0, bh / 2); g.addColorStop(0, '#2a0508'); g.addColorStop(0.5, c.stage === 2 ? '#c2577a' : '#8e0f22'); g.addColorStop(1, '#2a0508');
  cx.fillStyle = g; cx.fillRect(-bw / 2 + (1 - slide) * -bw, -bh / 2, bw, bh);
  cx.fillStyle = '#ffd6e2'; cx.fillRect(-bw / 2 + (1 - slide) * bw, -bh / 2 - 3, bw, 3); cx.fillRect(-bw / 2 + (1 - slide) * bw, bh / 2, bw, 3);
  // 刀の絵が帯の中を走る
  if (OUKA_IMG.complete && OUKA_IMG.naturalWidth) { const kw = s * 1.5, kh = kw * 106 / 900, kx = -kw / 2 + (1 - Math.min(1, t / 16)) * -W * 1.2 + t * 1.2;
    cx.shadowColor = 'rgba(255,120,160,.9)'; cx.shadowBlur = 24; cx.drawImage(OUKA_IMG, kx, -kh / 2, kw, kh); cx.shadowBlur = 0; }
  cx.restore(); cx.save();
  // 光の一閃
  if (t >= 10 && t < 20) { cx.globalAlpha = (20 - t) / 10; cx.fillStyle = '#fff'; cx.fillRect(0, 0, W, H); }
  // 大きな字（縦書き）と刀の名
  if (t >= 12) { const a = Math.min(1, (t - 12) / 6) * fin, sc = 1 + Math.max(0, (18 - t) / 6) * 0.6, fs = Math.round(s * 0.3 * sc);
    cx.globalAlpha = a; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.font = `${fs}px ${DISPLAY}`;
    const name = A.TREE.name[c.stage], x0 = W * 0.78;
    cx.shadowColor = c.stage === 3 ? 'rgba(200,20,40,1)' : 'rgba(255,140,180,1)'; cx.shadowBlur = 30;
    for (let k = 0; k < name.length; k++) { cx.fillStyle = '#fff4f7'; cx.fillText(name[k], x0, H / 2 + (k - (name.length - 1) / 2) * fs * 0.95); }
    cx.shadowBlur = 0; cx.font = `${Math.round(s * 0.06)}px ${DISPLAY}`; cx.fillStyle = '#ffd6e2'; cx.fillText('桜華', W * 0.2, H * 0.8);
    cx.font = `700 ${Math.round(s * 0.035)}px ${UIF}`; cx.fillStyle = '#c2193a'; cx.fillText('絶', W * 0.2 + s * 0.11, H * 0.8 - s * 0.02); }
  cx.restore();
}
/* ---------- 画面の表示 ---------- */
function bar(x, y, w, h, frac, col, right){
  cx.fillStyle = 'rgba(20,21,18,.25)'; cx.fillRect(x, y, w, h);
  const fw = w * clamp(frac, 0, 1);
  cx.fillStyle = col; cx.fillRect(right ? x + w - fw : x, y, fw, h);
}
function lastBout(){ return (GAME.mode === 'vs' || GAME.mode === 'online') && sim.wins[0] === 1 && sim.wins[1] === 1; } // 互いに後がない
function whoName(i){
  if (GAME.mode === 'train') return i ? '藍（木偶）' : '朱（あなた）';
  if (GAME.mode === 'cpu') return i ? '其の' + kn(GAME.n) : '朱（あなた）';
  if (GAME.mode === 'online' && ON) return COL[i].name + '　' + ON.names[i] + (i === ON.me ? '（あなた）' : '');
  return COL[i].name;
}
function drawHud(){
  const m = Math.max(16, W * 0.03), bw = Math.min(W * 0.34, 380), top = GAME.mode === 'train' ? 14 : 12;
  const red = sim.sd || lastBout() || WORLD.f > 0.5;
  for (let i = 0; i < 2; i++) {
    const p = sim.p[i], right = (i === 1) !== (MIR < 0), x = right ? W - m - bw : m;
    cx.font = `700 15px ${UIF}`; cx.fillStyle = red ? '#ffd9cf' : COL[i].main; cx.textAlign = right ? 'right' : 'left';
    let nm = whoName(i);
    if (GAME.mode === 'vs' || GAME.mode === 'online') nm += '　' + '●'.repeat(sim.wins[i]) + '○'.repeat(Math.max(0, 2 - sim.wins[i]));
    cx.fillText(nm, right ? W - m : m, top + 12);
    bar(x, top + 20, bw, 12, p.hp / A.HP_MAX, red ? '#f2e6d8' : INK, right);
    bar(x, top + 36, bw * 0.8 + 0, 5, p.gd / A.GD_MAX, p.gd <= 2000 ? COL[0].main : '#3d5a6c', right);
    cx.font = `500 11px ${UIF}`; cx.fillStyle = red ? '#f2e6d8' : '#3b3d33';
    cx.fillText(`体力 ${Math.ceil(p.hp / 100)}　ガード ${Math.ceil(p.gd / 100)}` + (p.kit === 'ouka' ? `　桜華${p.tree ? '・' + A.TREE.name[p.tree.stage] + (p.tree.u1 ? '' : '　花嵐◆') + (p.tree.u2 ? '' : '　天桜◆') : ''}` : ''), right ? W - m : m, top + 56);
  }
  const left = sim.sd ? Math.max(0, Math.ceil((A.C.sdF - (sim.frame - sim.sdStart)) / 60)) : Math.max(0, Math.ceil((A.C.roundF - sim.frame) / 60));
  cx.textAlign = 'center'; cx.font = `30px ${DISPLAY}`; cx.fillStyle = red ? '#ffe2d4' : INK;
  cx.fillText(sim.sd ? '一太刀' : String(left), W / 2, top + 32);
  cx.font = `500 11px ${UIF}`;
  const sub = sim.sd ? '残り ' + left + ' 秒' : GAME.mode === 'train' ? '稽古' : GAME.mode === 'cpu' ? '勝ち抜き　其の' + kn(GAME.n) : lastBout() ? '互いに後なし' : kn(sim.roundNo) + '本目';
  cx.fillText(sub, W / 2, top + 50);
}
/* 一本の始め */
function drawIntro(){
  if (GAME.phase !== 'intro') return;
  if (GAME.zin && GAME.t <= GAME.zin) return drawZetsuIntro(GAME.t);
  const t = GAME.t - GAME.zin, s = Math.min(W, H);
  cx.textAlign = 'center';
  cx.fillStyle = `rgba(10,10,8,${0.35 * clamp(1 - (t - 60) / 20, 0, 1)})`; cx.fillRect(0, 0, W, H);
  const head = GAME.mode === 'cpu' ? '其の' + kn(GAME.n) : lastBout() ? '後なし' : kn(sim.roundNo) + '本目';
  if (t < 52) { cx.globalAlpha = clamp(t / 10, 0, 1); cx.fillStyle = PALE; cx.font = `${Math.round(s * 0.13)}px ${DISPLAY}`; cx.fillText(head, W / 2, H * 0.45);
    if (GAME.mode === 'cpu' && GAME.best) { cx.font = `500 12px ${UIF}`; cx.fillText(`これまでの最高　${GAME.best}人抜き`, W / 2, H * 0.45 + s * 0.08); } }
  else { cx.globalAlpha = clamp(1 - (t - 70) / 10, 0, 1); cx.fillStyle = '#ffffff'; cx.font = `${Math.round(s * 0.17)}px ${DISPLAY}`; cx.fillText('始め', W / 2, H * 0.47); }
  cx.globalAlpha = 1;
}
function drawFrames(){
  if (!OPT.frames || GAME.mode !== 'train') return;
  const p = sim.p[0], x = Math.max(16, W * 0.03), y0 = 92;
  const lines = [];
  if (p.st === 'atk') { const m = MV[p.mv]; lines.push([`${m.n}　${p.mvf}F目`, INK]); lines.push([`発生 ${m.s}F　持続 ${m.a}F　硬直 ${m.r}F　全体 ${m.total}F${m.land ? '　着地 ' + m.land + 'F' : ''}`, '#3b3d33']); }
  else if (p.st === 'roll' || p.st === 'adodge') { const d = A.DG[p.st === 'roll' ? p.rk : p.ak]; lines.push([`${d.n}　${p.f}F目`, INK]); lines.push([`無敵 ${d.i0}〜${d.i1}F　全体 ${d.total}F${d.land ? '　着地 ' + d.land + 'F' : ''}`, '#3b3d33']); }
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
function drawPad(v){
  const pd = v.pad, me = v.me;
  if (GAME.mode === 'cpu' && me !== 0) return;
  const stunO = sim.p[1 - me].st === 'stun';
  if (pd.stick) {
    cx.strokeStyle = 'rgba(20,21,18,.35)'; cx.lineWidth = 2; cx.beginPath(); cx.arc(pd.stick.ox, pd.stick.oy, 46, 0, Math.PI * 2); cx.stroke();
    const dx = pd.stick.x - pd.stick.ox, dy = pd.stick.y - pd.stick.oy, d = Math.hypot(dx, dy), k = d > 46 ? 46 / d : 1;
    cx.fillStyle = 'rgba(20,21,18,.4)'; cx.beginPath(); cx.arc(pd.stick.ox + dx * k, pd.stick.oy + dy * k, 20, 0, Math.PI * 2); cx.fill();
  } else if (matchMedia('(pointer: coarse)').matches) {
    cx.fillStyle = 'rgba(20,21,18,.4)'; cx.font = `500 11px ${UIF}`; cx.textAlign = 'center'; cx.fillText('左半分を押して動かす', W * 0.22, H - 22);
  }
  for (const b of pd.BTN) {
    const iai = b.id === 'G' && stunO;
    const on = !!pd.btn[b.id] || readKeyFor(me, b.id);
    cx.globalAlpha = on ? 0.95 : 0.7;
    const pulse = iai ? 1 + Math.sin(performance.now() / 90) * 0.06 : 1;
    cx.fillStyle = iai ? 'rgba(200,55,45,.92)' : on ? 'rgba(20,21,18,.72)' : 'rgba(239,232,214,.55)';
    cx.beginPath(); cx.arc(b.x, b.y, b.r * pulse, 0, Math.PI * 2); cx.fill();
    cx.strokeStyle = iai ? '#ffd9cf' : 'rgba(20,21,18,.7)'; cx.lineWidth = 2; cx.stroke();
    cx.fillStyle = iai || on ? PALE : INK; cx.font = `${Math.round(b.r * 0.85)}px ${DISPLAY}`; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.fillText(iai ? '居' : b.label, b.x, b.y + 1);
    cx.textBaseline = 'alphabetic'; cx.globalAlpha = 1;
    if (EDIT) { cx.setLineDash([6, 5]); cx.strokeStyle = EDIT.sel === b.id ? '#c8372d' : 'rgba(20,21,18,.6)'; cx.lineWidth = 2; cx.beginPath(); cx.arc(b.x, b.y, b.r * 1.25, 0, Math.PI * 2); cx.stroke(); cx.setLineDash([]); }
  }
  if (EDIT) { cx.fillStyle = 'rgba(20,21,18,.55)'; cx.fillRect(0, 0, W * 0.5, H); cx.fillStyle = PALE; cx.font = `600 15px ${UIF}`; cx.textAlign = 'center';
    cx.fillText('左半分は移動（どこを押しても動ける）', W * 0.25, H * 0.5); cx.fillText('ボタンを指で動かして置き場所を決める', W * 0.25, H * 0.5 + 24); }
}
function readKeyFor(pi, id){ const km = keyMap(pi); return !!km && !!km[id] && km[id].some(c => key[c]); }

function drawFinish(){
  const f = FX.finish; if (!f) return;
  const t = f.t;
  if (f.zetsu) return drawZetsuFinish(f, t);
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
    if (GAME.mode !== 'train' && f.p >= 0) { cx.font = `700 14px ${UIF}`; cx.fillStyle = COL[f.p].light; cx.fillText(whoName(f.p) + 'の勝ち', W / 2, H * 0.5 - Math.min(W, H) * 0.13); }
    cx.globalAlpha = 1;
  }
}

let FR = 0;
function draw(){
  FR++;
  cx.setTransform(1, 0, 0, 1, 0, 0); cx.fillStyle = '#141512'; cx.fillRect(0, 0, cv.width, cv.height);
  if (GAME.mode === 'menu') return;
  updateCam(); updateWorld();
  for (const v of VIEWS) {
    setView(v);
    const m = v.m;
    cx.setTransform(m[0] * DPR, m[1] * DPR, m[2] * DPR, m[3] * DPR, m[4] * DPR, m[5] * DPR);
    cx.save(); cx.beginPath(); cx.rect(0, 0, W, H); cx.clip();
    drawView(v);
    cx.restore();
  }
  if (VIEWS.length > 1) { cx.setTransform(DPR, 0, 0, DPR, 0, 0); cx.fillStyle = '#141512'; cx.fillRect(SW / 2 - 1, 0, 2, SH); }
  if (GAME.mode === 'online' && ON && ON.msg) { cx.setTransform(DPR, 0, 0, DPR, 0, 0); cx.font = `500 13px ${UIF}`; cx.textAlign = 'center';
    const tw = cx.measureText(ON.msg).width + 24; cx.fillStyle = 'rgba(20,21,18,.72)'; cx.fillRect(SW / 2 - tw / 2, SH * 0.3 - 14, tw, 28); cx.fillStyle = PALE; cx.fillText(ON.msg, SW / 2, SH * 0.3 + 5); }
}
function drawView(v){
  const sh = 0; // 画面揺れは酔うのでなし（2026-11-26 ユーザー指定）
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
  for (const p of sim.p) if (p.tree) { const g = FX.grow[p.i]; drawTree(p.tree, p.i, g == null || g >= 30 ? 1 : 0.55 + 0.45 * (1 - Math.pow(1 - g / 30, 3)) + Math.sin(g / 30 * Math.PI) * 0.08); }
  for (const g of FX.gone) { cx.globalAlpha = 1 - g.t / 40; drawTree({ x: g.x * FP, y: g.y * FP, stage: 3, hp: 1 }, g.p, 1 + g.t / 40); cx.globalAlpha = 1; }
  for (const p of [sim.p[1], sim.p[0]]) drawFighter(p, FR + p.i * 37);
  for (const p of sim.p) if (p.tree && p.tree.stage === 2) { // 満開: 体に花びらを纏う
    { const g = cx.createRadialGradient(wx(p.x / FP), wy(p.y / FP + 62), 0, wx(p.x / FP), wy(p.y / FP + 62), 90 * cam.z); g.addColorStop(0, 'rgba(194,25,58,.22)'); g.addColorStop(1, 'rgba(194,25,58,0)'); cx.fillStyle = g; cx.fillRect(wx(p.x / FP) - 90 * cam.z, wy(p.y / FP + 152), 180 * cam.z, 180 * cam.z); }
    for (let k = 0; k < 16; k++) { const a = FR * 0.07 + k * 0.3927, rr = 30 + (k % 3) * 9, x = wx(p.x / FP + Math.cos(a) * rr), y = wy(p.y / FP + 62 + Math.sin(a * 2 + k) * 46);
      cx.save(); cx.translate(x, y); cx.rotate(a * 3); cx.fillStyle = k % 4 === 3 ? CRIM[k % 3] : SAKURA[k % 3]; cx.globalAlpha = 0.85; cx.beginPath(); cx.ellipse(0, 0, 5 * cam.z, 3 * cam.z, 0, 0, Math.PI * 2); cx.fill(); cx.restore(); } cx.globalAlpha = 1; }
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
  for (const q of sim.pj) {
    if (q.petal) { const x = wx(q.x / FP), y = wy(q.y / FP), r = (q.w || 44) / 2 * cam.z;
      cx.save(); cx.translate(x, y);
      for (let k = 0; k < 5; k++) { const a = FR * 0.25 + k * 1.2566, rr = r * (0.35 + 0.45 * ((k * 37) % 10) / 10);
        cx.save(); cx.translate(Math.cos(a) * rr, Math.sin(a) * rr); cx.rotate(a + FR * 0.1); cx.fillStyle = SAKURA[k % 3]; cx.beginPath(); cx.ellipse(0, 0, 7 * cam.z, 4 * cam.z, 0, 0, Math.PI * 2); cx.fill(); cx.restore(); }
      cx.restore(); continue; }
    const x = wx(q.x / FP), y = wy(q.y / FP), d = Math.sign(q.vx) * MIR, r = 30 * cam.z;
    cx.save(); cx.globalCompositeOperation = 'lighter'; cx.translate(x, y); cx.scale(d, 1);
    for (let k = 0; k < 3; k++) { cx.fillStyle = `rgba(245,240,228,${0.6 - k * 0.18})`; cx.beginPath();
      cx.arc(-k * 14 * cam.z, 0, r, -1.2, 1.2); cx.arc(-k * 14 * cam.z - r * 0.45, 0, r * 0.82, 1.1, -1.1, true); cx.closePath(); cx.fill(); }
    cx.restore();
  }
  // カウンターの構え（受付中は刃が光る）
  for (const p of sim.p) if (p.st === 'atk' && p.mv === 'counter') { const m = MV.counter; if (p.mvf >= m.s && p.mvf < m.s + m.a) {
    cx.strokeStyle = `rgba(255,246,220,${0.5 + Math.sin(FR * 0.6) * 0.3})`; cx.lineWidth = 3; cx.beginPath(); cx.arc(wx(p.x / FP), wy(p.y / FP + 70), 44 * cam.z, 0, Math.PI * 2); cx.stroke(); } }
  if (OPT.boxes) for (const p of sim.p) if (p.tree) { const b = A.treeBox(p.tree); cx.strokeStyle = 'rgba(236,159,184,.95)'; cx.lineWidth = 1.5; cx.strokeRect(wx(b[0] / FP), wy(b[3] / FP), (b[2] - b[0]) / FP * cam.z * MIR, (b[3] - b[1]) / FP * cam.z); }
  if (OPT.boxes) for (const p of sim.p) {
    const hb = A.hurt(p);
    cx.strokeStyle = A.invuln(p) ? 'rgba(255,255,255,.9)' : 'rgba(44,79,150,.85)'; cx.lineWidth = 1.5;
    cx.strokeRect(wx(p.x / FP + hb[0]), wy(p.y / FP + hb[1] + hb[3]), hb[2] * cam.z * MIR, hb[3] * cam.z);
    if (p.st === 'atk') { const m = MV[p.mv];
      if (!m.noBox && p.mvf >= m.s && p.mvf < m.s + m.a) { const b = A.box(p, A.curBox(p)); cx.fillStyle = 'rgba(200,55,45,.45)'; cx.fillRect(wx(b[0] / FP), wy(b[3] / FP), (b[2] - b[0]) / FP * cam.z * MIR, (b[3] - b[1]) / FP * cam.z); } }
  }
  drawOukaFx();
  for (const q of FX.parts) { cx.globalAlpha = 1 - q.t / q.life; cx.fillStyle = q.col; const r = q.r * cam.z;
    if (q.petal) { cx.save(); cx.translate(wx(q.x), wy(q.y)); cx.rotate(q.rot); cx.beginPath(); cx.ellipse(0, 0, r * 1.3, r * 0.7, 0, 0, Math.PI * 2); cx.fill(); cx.restore(); }
    else cx.fillRect(wx(q.x) - r, wy(q.y) - r, r * 2, r * 2); }
  cx.globalAlpha = 1;
  for (const t of FX.texts) {
    const a = 1 - t.t / t.life;
    cx.globalAlpha = a; cx.textAlign = 'center';
    if (t.screen) { cx.fillStyle = '#ffe2d4'; cx.font = `26px ${DISPLAY}`; cx.fillText(t.s, W / 2, H * 0.32); }
    else if (t.sakura) { const k = Math.min(1, t.t / 8); cx.font = `${Math.round((30 + 10 * k) * cam.z + 6)}px ${DISPLAY}`; cx.lineWidth = 4; cx.strokeStyle = 'rgba(90,20,40,.55)'; cx.strokeText(t.s, wx(t.x), wy(t.y) - t.t * 0.3); cx.fillStyle = '#ffd6e2'; cx.fillText(t.s, wx(t.x), wy(t.y) - t.t * 0.3); }
    else if (t.small) { cx.fillStyle = INK; cx.font = `600 12px ${UIF}`; cx.fillText(t.s, wx(t.x), wy(t.y)); }
    else { cx.fillStyle = COL[t.c || 0].main; cx.font = `${Math.round(48 * cam.z)}px ${DISPLAY}`; cx.fillText(t.s, wx(t.x), wy(t.y) - t.t * 0.4); }
    cx.globalAlpha = 1;
  }
  for (let i = 0; i < 2; i++) { const c = FX.combo[i]; if (!c || c.t > 70 || c.n < 2) continue; const p = sim.p[i];
    cx.globalAlpha = 1 - c.t / 70; cx.fillStyle = COL[i].main; cx.textAlign = 'center'; cx.font = `${Math.round(30 * cam.z + 8)}px ${DISPLAY}`;
    cx.fillText(kn(c.n) + '連', wx(p.x / FP), wy(p.y / FP + 175)); cx.globalAlpha = 1; }
  if (FX.flash) { cx.fillStyle = `rgba(255,255,255,${FX.flash * 0.05})`; cx.fillRect(0, 0, W, H); }
  if (FX.pflash) { const g = cx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.7); g.addColorStop(0, `rgba(255,190,210,${FX.pflash * 0.012})`); g.addColorStop(1, `rgba(60,4,12,${FX.pflash * 0.07})`); cx.fillStyle = g; cx.fillRect(0, 0, W, H); }
  cx.restore();
  drawStorm(FR);
  drawCutin();
  drawHud();
  drawFrames();
  drawIntro();
  drawFinish();
  if (GAME.phase !== 'over') drawPad(v);
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

/* ---------- 選ぶ画面・試合の終わり・一時停止 ---------- */
let PAUSED = false;
/* ボタン配置: 稽古の場面を止めて、ボタンを指で動かす。大きさも変えられる */
let EDIT = null;
function startEdit(){ showMenu(false); setPause(false); if (GAME.mode !== 'train') startMode('train'); EDIT = { sel: null, from: GAME.mode }; $('edbar').hidden = false; document.body.dataset.edit = '1'; }
function endEdit(save){ if (!save) { try { BLAY = JSON.parse(localStorage.getItem(BLAY_KEY) || 'null'); } catch (e) { BLAY = null; } } else saveBlay();
  EDIT = null; $('edbar').hidden = true; delete document.body.dataset.edit; for (const v of VIEWS) layoutPad(v.pad, v.w, v.h); }
function editScale(k){ BLAY = BLAY || { s: 1 }; BLAY.s = clamp((BLAY.s || 1) * k, 0.6, 1.7); for (const v of VIEWS) layoutPad(v.pad, v.w, v.h); }
const $ = id => document.getElementById(id);
function showMenu(on){
  $('menu').hidden = !on;
  if (on) { GAME.mode = 'menu'; document.body.dataset.mode = 'menu'; $('mn_best').textContent = GAME.best ? `最高 ${GAME.best}人抜き` : '一本勝負で勝ち抜く'; }
}
function showOver(on){
  const el = $('over'); el.hidden = !on; if (!on) return;
  const lines = GAME.log.filter(l => l.winner >= 0);
  let head, sub;
  if (GAME.mode === 'cpu') { head = GAME.n - 1 ? `${GAME.n - 1}人抜き` : '敗れる'; sub = `其の${kn(GAME.n)}に敗れる` + (GAME.n - 1 >= GAME.best && GAME.n > 1 ? '　最高記録' : `　最高 ${GAME.best}人抜き`); }
  else if (GAME.mode === 'online' && ON) { const w = sim.wins[0] > sim.wins[1] ? 0 : 1; head = w === ON.me ? '勝ち' : '負け'; sub = `${ON.names[0]} ${sim.wins[0]} 対 ${sim.wins[1]} ${ON.names[1]}`; }
  else { const w = sim.wins[0] > sim.wins[1] ? 0 : 1; head = COL[w].name + 'の勝ち'; sub = `${sim.wins[0]} 対 ${sim.wins[1]}`; }
  if (GAME.coins) sub += `　・　得た銭 ${GAME.coins}`;
  $('ov_h').textContent = head; $('ov_s').textContent = sub;
  $('ov_l').innerHTML = lines.map((l, k) => `<li><span class="w" style="color:${COL[l.winner].light}">${GAME.mode === 'cpu' ? (l.winner ? '相手' : 'あなた') : GAME.mode === 'online' && ON ? (l.winner === ON.me ? 'あなた' : ON.names[l.winner]) : COL[l.winner].name}</span><b style="color:${TIERC[l.tier] || PALE}">${l.name}</b><small>${l.tier === '分' ? '' : l.tier}</small></li>`).join('');
}
function setPause(on){ PAUSED = on; $('pausep').hidden = !on; }
function setupMenu(){
  $('mn_cpu').onclick = () => startMode('cpu');
  $('mn_vs').onclick = () => startMode('vs');
  $('mn_train').onclick = () => startMode('train');
  $('ov_again').onclick = () => startMode(GAME.mode);
  $('ov_menu').onclick = () => { if (GAME.mode === 'online' && ON) { ON.onExit(); return; } showOver(false); showMenu(true); };
  $('a_pause').onclick = () => { if (GAME.mode === 'online' && ON) { // ネット対戦は止められない。二度押しで退出
      const b = $('a_pause'); if (b.dataset.armed) { ON.onExit('leave'); return; }
      b.dataset.armed = '1'; b.textContent = 'もう一度押すと退出（記録しない）'; setTimeout(() => { b.dataset.armed = ''; b.textContent = '退出'; }, 2500); return; }
    setPause(true); };
  $('ps_resume').onclick = () => setPause(false);
  $('ps_retry').onclick = () => { setPause(false); startMode(GAME.mode); };
  $('ps_menu').onclick = () => { setPause(false); showMenu(true); };
  $('a_menu').onclick = () => showMenu(true);
  $('mn_help').onclick = () => { $('help').hidden = false; };
  $('mn_btns').onclick = () => startEdit(); $('a_btns').onclick = () => startEdit(); $('ps_btns').onclick = () => startEdit();
  $('ed_small').onclick = () => editScale(1 / 1.12); $('ed_big').onclick = () => editScale(1.12);
  $('ed_reset').onclick = () => { BLAY = null; for (const v of VIEWS) layoutPad(v.pad, v.w, v.h); };
  $('ed_ok').onclick = () => endEdit(true); $('ed_cancel').onclick = () => endEdit(false);
  const KOPT = SNAP.owned.map(k => [k.id, k.mei + '〔' + k.tier + '〕' + (k.id === 'ouka' ? '　花嵐・天桜・植樹' : '')]);
  for (const [id, i] of [['kt0', 0], ['kt1', 1], ['a_kit', 0]]) { const el = $(id);
    const opts = KOPT.slice();
    opts.forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; el.appendChild(o); });
    el.value = KITS[i]; el.onchange = () => { KITS[i] = el.value; saveKits(); ['kt0', 'kt1', 'a_kit'].forEach((q, j) => { $(q).value = KITS[j === 2 ? 0 : j]; }); el.blur();
      if (id === 'a_kit' && GAME.mode === 'train') startMode('train'); }; }
}

/* ---------- ネット対戦（フレンドと1対1・二本先取） ----------
   つなぐのは online.js。ここは計算と見せ方。二人の端末は同じ時計のコマ番号で同じ計算を進め、
   相手の入力が遅れたら見込みで進めて、届いたら巻き戻して計算し直す（netplay.js）。
   一本の始まり（立ち合い）・決着の間・次の一本への切り替えも、コマ数で決めて二人で揃える。 */
const NPL = window.IssenNetPlay;
let ON = null;
const FRAME_MS = 1000 / 60;
/* o = { me, kits:[朱,藍], names:[朱,藍], kat: 自分の刀のid, startAt: 始まりの時刻（自分の時計）, delay,
         onLocal(f, code) 自分の入力を送る, onOver(log, wins) 決着を知らせる, onExit() 戻る } */
function onlineStart(o){
  GAME.mode = 'online'; GAME.log = []; GAME.coins = 0; GAME.n = 1;
  sim = new A.Sim({ toWin: 2, kits: o.kits });
  const zin = sim.p.some(p => p.kit === 'ouka') ? 110 : 0;
  ON = Object.assign({ L: { ph: 'intro', t: 0, zin, log: [] }, played: new Map(), hashes: {}, round: sim.roundNo, msg: '', done: false, wait: 0 }, o);
  ON.np = NPL.NetPlay({ me: o.me, delay: o.delay == null ? 2 : o.delay, maxRoll: 12, save: onSave, load: onLoad, step: onStep });
  GAME.phase = 'intro'; GAME.t = 0; GAME.zin = zin;
  clearFx(); FX.hist = []; FX.last = null;
  document.body.dataset.mode = 'online';
  showMenu(false); showOver(false); setPause(false);
  $('a_pause').textContent = '退出'; $('ov_again').hidden = true; $('ov_menu').textContent = '一閃へ戻る';
  layoutViews();
  return ON;
}
function onSave(){ return { s: structuredClone(Object.assign({}, sim)), L: structuredClone(ON.L) }; }
function onLoad(z){ const s = new A.Sim(sim.opts); Object.assign(s, structuredClone(z.s)); sim = s; ON.L = structuredClone(z.L); }
function onStep(inp, resim, f){
  const L = ON.L;
  if (L.ph === 'intro') { L.t++; if (L.t === 1 && L.zin && !resim) SND.play('draw'); if (L.t > 80 + L.zin) { L.ph = 'fight'; L.t = 0; L.zin = 0; } }
  else if (L.ph === 'fight') {
    sim.step(inp);
    for (const e of sim.ev) { // 見込みで一度見せた出来事は、計算し直しても二度は見せない
      const k = f + ':' + e.t + ':' + (e.p != null ? e.p : e.by != null ? e.by : '') + ':' + (e.mv || '');
      if (!ON.played.has(k)) { ON.played.set(k, f); onEvent(e); }
    }
    sim.ev = [];
    if (sim.over) { L.ph = 'fin'; L.t = 0; }
    if (!resim) for (const p of sim.p) recordTrail(p);
  } else if (L.ph === 'fin') {
    if (++L.t > 200) { const r = sim.result; L.log.push({ name: r.name, tier: r.tier, winner: r.winner });
      if (r.matchOver) L.ph = 'over'; else { sim.resetRound(); L.ph = 'intro'; L.t = 0; } }
  }
  ON.hashes[f] = (sim.hash() ^ Math.imul(L.log.length + 1, 40503) ^ Math.imul(L.t + 7, 2654435761)) >>> 0; // ずれの検出用
  if (f % 600 === 0) for (const k in ON.hashes) if (k < f - 1200) delete ON.hashes[k];
}
/* 計算の結果を画面の状態に写す（巻き戻しで決着が取り消されたら、決着の演出も消す） */
function onlineSync(){
  const L = ON.L;
  GAME.phase = L.ph === 'intro' ? 'intro' : L.ph === 'over' ? 'over' : 'fight';
  GAME.t = L.t; GAME.zin = L.zin; GAME.log = L.log;
  if (sim.roundNo !== ON.round) { ON.round = sim.roundNo; clearFx(); }
  if (L.ph === 'fin' || L.ph === 'over') {
    if (!FX.finish && sim.result) { const r = sim.result, w = r.winner, l = w >= 0 ? sim.p[1 - w] : sim.p[0];
      FX.finish = { t: 0, how: r.how, name: r.name, p: w, tier: r.tier, x: l.x / FP, y: l.y / FP + 60, zetsu: w >= 0 && sim.p[w].kit === 'ouka' }; }
    if (FX.finish) FX.finish.t = L.ph === 'over' ? 201 : L.t;
  } else if (FX.finish) FX.finish = null;
}
function onlineTick(){
  if (!ON) return;
  const np = ON.np, target = Math.floor((ON.now() - ON.startAt) / FRAME_MS);
  let n = 0;
  while (np.frame < target && n < 8) {
    if (np.lh < np.frame + np.D) { const i = readHuman(0); stepN++; const code = NPL.encode(i); ON.onLocal(np.local(code), code); }
    if (!np.advance()) break;
    n++; tickParts();
  }
  np.resolve();
  onlineSync();
  if (ON.played.size > 400) { const c = np.confirmed() - 60; for (const [k, f] of ON.played) if (f < c) ON.played.delete(k); }
  // 相手の入力が来ないまま先に進みすぎたら待つ
  const behind = target - np.frame;
  ON.wait = behind > 2 && !np.canAdvance() ? ON.wait + 1 : 0;
  ON.msg = ON.wait > 20 ? '通信待ち…' : ON.extMsg || '';
  // 決着がもう巻き戻らなくなったら、結果を知らせる
  if (ON.L.ph === 'over' && !ON.done && np.confirmed() >= np.frame - 1) {
    ON.done = true; GAME.log = ON.L.log;
    for (const l of ON.L.log) if (l.winner === ON.me) recordOnlineWin(l);
    showOver(true);
    if (ON.onOver) ON.onOver(ON.L.log.slice(), sim.wins.slice());
  }
}
function recordOnlineWin(l){ // 勝った一本ごとに、自分の刀の戦績と銭
  const id = ON.kat; if (!owns(id)) return;
  const coin = COIN[l.tier] || 0;
  try { const a = JSON.parse(localStorage.getItem('issen-action-out-v1') || '[]'); a.push({ f: l.name, k: id, acct: !!SNAP.acct, t: Date.now() }); localStorage.setItem('issen-action-out-v1', JSON.stringify(a.slice(-200))); } catch (e) {}
  GAME.coins = (GAME.coins || 0) + coin;
}
function onlineEnd(){ ON = null; }

resize(); setupBar(); setupMenu();
{ const m = (location.search.match(/[?&]m=(\w+)/) || [])[1]; if (m === 'train' || m === 'cpu' || m === 'vs') startMode(m); else if (!/[?&]match=/.test(location.search)) showMenu(true); }

const DBG = { pause: false };
window.__action = { onlineStart, onlineEnd, get ON(){ return ON; },
  myKat(){ const k = SNAP.owned.find(q => q.id === KITS[0]) || SNAP.owned[0]; return { id: k.id, mei: k.mei, tier: k.tier, kit: kitOf(k.id, 'online') }; }, step: () => stepOnce(), get sim(){ return sim; }, GAME, startMode, CPU, FX, OPT, resetRound, DBG, recordTrail, draw, cam, get W(){ return W; }, get GROUND(){ return GROUND; } };
requestAnimationFrame(t => { lastT = t; requestAnimationFrame(tick); });
})();
