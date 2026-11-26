/* =====================================================================
   一閃（対戦アクション） 計算の中身
   - 1秒60回の固定の歩み。位置・速さ・体力はすべて整数（1px = 100）で数える。
     同じ操作を入れれば、どの端末でも必ず同じ結果になる（ネット対戦・観戦の土台）。
   - 描画や音は持たない。毎フレーム step([入力0, 入力1]) を呼ぶだけ。
   - 入力は { L, R, U, D, A(斬), J(跳), G(守) } の真偽値。
   ===================================================================== */
(function(root){
'use strict';
const FP = 100;
const WALL_L = 40 * FP, WALL_R = 1560 * FP;
const PLATS = [{ x0: 330 * FP, x1: 630 * FP, y: 190 * FP }, { x0: 970 * FP, x1: 1270 * FP, y: 190 * FP }];
const PH = { walk: 420, airMax: 520, airAcc: 70, grav: 62, fallMax: 1150, ffall: 1700, jumpS: 1150, jumpF: 1550, jump2: 1350,
             wallVX: 750, wallVY: 1350, gFric: 90, roll: 650 };
const HP_MAX = 10000, GD_MAX = 10000;
const C = {
  gdRegenDelay: 60,   // 守を離してから回復が始まるまで
  gdRegen: 33,        // 1Fの回復量（約 毎秒20）
  stunF: 90,          // 気絶
  stunRecoverGd: 5000,// 気絶明けのガード
  roundF: 7200,       // 120秒
  sdF: 3600,          // サドンデスの長さ
  toWin: 2,
  buf: 6,             // 先行入力を覚えておくF
  techWin: 10,        // 受け身の受付
  downF: 24, downMax: 60,
  jsq: 3, landF: 3,
};

/* 技 ---------------------------------------------------------------
   s=発生(このFから当たる) a=持続 r=硬直 / 空中技は r=空中での硬直, land=着地硬直
   dmg, gd は 1/100 単位。hit=ヒット時の有利F（決めると hs を計算）、blk=ガード時の有利F
   box=[前へのずれ, 足元からの高さ, 幅, 高さ](px)  kb=[横, 縦] 吹き飛ばし(1/100px/F) */
const MV = {
  jab1:  { n:'弱斬り（一段目）', k:'g', s:5, a:3, r:10, dmg:300, gd:600, hit:6, blk:-2, kb:[220,0], box:[6,52,80,44], arc:[-70,20], chain:'jab2' },
  jab2:  { n:'弱斬り（二段目）', k:'g', s:5, a:3, r:12, dmg:300, gd:600, hit:5, blk:-3, kb:[220,0], box:[6,52,80,44], arc:[40,-45], chain:'jab3' },
  jab3:  { n:'弱斬り（三段目・払い）', k:'g', s:7, a:4, r:20, dmg:500, gd:1000, hs:30, blk:-10, kb:[750,850], kd:1, box:[6,36,96,62], arc:[-100,55] },
  side:  { n:'踏み込み斬り', k:'g', s:14, a:4, r:22, dmg:700, gd:1800, hs:28, blk:-8, kb:[950,560], box:[8,38,100,64], arc:[150,-35], lunge:[2,14,900] },
  utilt: { n:'上斬り', k:'g', s:7, a:5, r:16, dmg:500, gd:800, hs:34, blk:-6, kb:[90,1500], box:[-14,72,84,92], arc:[-40,125] },
  dtilt: { n:'下斬り', k:'g', s:6, a:3, r:14, dmg:400, gd:700, hit:3, blk:-4, kb:[260,0], box:[6,0,92,34], arc:[-25,-5], crouch:1 },
  smash: { n:'溜め斬り', k:'g', s:10, a:4, r:26, dmg:[1000,1600], gd:[2500,4000], hs:32, blk:-12, kb:[1150,720], box:[8,28,112,82], arc:[165,-40] },
  grab:  { n:'組み打ち', k:'g', s:7, a:2, r:30, dmg:400, gd:3500, hs:30, kb:[750,760], kd:1, box:[8,20,58,92], grab:1, arc:[-10,-10] },
  iai:   { n:'居合', k:'g', s:10, a:4, r:40, dmg:1000, gd:2000, hs:30, blk:-30, kb:[900,600], box:[0,30,132,82], iai:1, arc:[-165,10], lunge:[2,10,3400] },
  gatk:  { n:'起き上がり斬り', k:'g', s:18, a:4, r:8, dmg:500, gd:800, hs:24, blk:-4, kb:[650,300], box:[-72,0,144,60], arc:[-170,170], inv:[1,12] },
  nair:  { n:'空中斬', k:'a', s:5, a:6, r:14, land:8, dmg:400, gd:600, hs:18, kb:[320,320], box:[-44,26,104,84], arc:[-150,150] },
  fair:  { n:'前空斬', k:'a', s:8, a:4, r:18, land:12, dmg:600, gd:900, hs:22, kb:[720,360], box:[8,28,98,72], arc:[120,-60] },
  bair:  { n:'後空斬', k:'a', s:7, a:3, r:16, land:11, dmg:700, gd:1000, hs:22, kb:[820,420], box:[-104,36,92,62], arc:[200,280] },
  uair:  { n:'上空斬', k:'a', s:6, a:5, r:14, land:10, dmg:500, gd:700, hs:24, kb:[100,1150], box:[-44,92,88,74], arc:[-10,190] },
  dair:  { n:'下空斬（兜割り）', k:'a', s:12, a:4, r:22, land:18, dmg:800, gd:1200, hs:26, kb:[120,-1350], kd:1, box:[-32,-34,64,70], arc:[60,-100] },
  airiai:{ n:'空中居合', k:'a', s:10, a:4, r:30, land:20, dmg:1000, gd:2000, hs:30, blk:-30, kb:[900,600], box:[0,10,132,100], iai:1, arc:[-165,10], lunge:[2,10,3000] },
};
for (const id in MV) {
  const m = MV[id]; m.id = id;
  m.total = m.s + m.a - 1 + m.r;
  if (m.hit != null) m.hs = m.hit + m.a - 1 + m.r;
  if (m.blk != null) m.bs = Math.max(1, m.blk + m.a - 1 + m.r);
  else m.bs = Math.max(1, m.a - 1 + m.r - 8);
}
const SMASH_MIN = 12, SMASH_MAX = 40;

/* 決着名 */
const FIN = {
  '一閃':{tier:'絶'}, '明鏡止水':{tier:'幻'}, '紙一重':{tier:'極'}, '鏡返し':{tier:'極'}, '死中活':{tier:'極'}, '流転':{tier:'極'}, '百花':{tier:'極'},
  '二の太刀':{tier:'上'}, '陽炎':{tier:'上'}, '止め':{tier:'上'}, '落花':{tier:'上'}, '背水':{tier:'上'}, '刹那':{tier:'上'},
  '先の先':{tier:'並'}, '隙穿ち':{tier:'並'}, '疾風':{tier:'並'}, '斬り伏せ':{tier:'並'}, '睨み合い':{tier:'分'}
};

const sgn = v => v > 0 ? 1 : v < 0 ? -1 : 0;
const toward = (v, t, d) => v < t ? Math.min(t, v + d) : Math.max(t, v - d);
const NOIN = { L:0, R:0, U:0, D:0, A:0, J:0, G:0 };

function newPlayer(i){
  return { i, x: (i ? 1000 : 600) * FP, y: 0, vx: 0, vy: 0, face: i ? -1 : 1, ground: true, plat: -1,
    st: 'idle', f: 0, mv: null, mvf: 0, hitDone: false, chainReq: false, chargeF: 0, power: 0,
    jumps: 1, adUsed: false, ff: false, dropF: 0,
    hp: HP_MAX, gd: GD_MAX, gdDelay: 0, stun: 0, hs: 0, kd: false,
    pi: NOIN, inp: NOIN, buf: { A: 0, J: 0, G: 0 }, hEdge: 0, holdA: 0, lastG: 99, downT: 0,
    combo: 0, comboDmg: 0, comboFirst: null, lastMv: null, sameCnt: 0,
    stunCount: 0, gdLow: false, touched: false, wallF: 0 };
}

function Sim(opts){
  this.opts = Object.assign({ training: false }, opts || {});
  this.wins = [0, 0];
  this.roundNo = 0;
  this.resetRound();
}
Sim.prototype.resetRound = function(){
  this.p = [newPlayer(0), newPlayer(1)];
  this.frame = 0; this.hitstop = 0; this.sd = false; this.sdStart = 0;
  this.over = false; this.result = null; this.ev = [];
  this.roundNo++;
};

/* 入力を読み、押した瞬間を先行入力として覚える */
function readInput(p, inp){
  const pi = p.inp; p.pi = pi; p.inp = inp;
  for (const k of ['A', 'J', 'G']) {
    if (inp[k] && !pi[k]) p.buf[k] = C.buf; else if (p.buf[k] > 0) p.buf[k]--;
  }
  const h = (inp.R ? 1 : 0) - (inp.L ? 1 : 0), ph = (pi.R ? 1 : 0) - (pi.L ? 1 : 0);
  p.hEdge = (h && h !== ph) ? h : 0;
  p.holdA = inp.A ? p.holdA + 1 : 0;
  p.lastG = (inp.G && !pi.G) ? 0 : p.lastG + 1;
}
const horiz = p => (p.inp.R ? 1 : 0) - (p.inp.L ? 1 : 0);

function hurt(p){
  if (p.st === 'down') return [-50, 0, 100, 28];
  if (p.st === 'crouch' || (p.st === 'atk' && MV[p.mv].crouch)) return [-22, 0, 44, 76];
  if (!p.ground) return [-22, 6, 44, 106];
  return [-22, 0, 44, 120];
}
function invuln(p){
  if (p.st === 'down' || p.st === 'ko') return true;
  if (p.st === 'roll') return p.f >= 4 && p.f <= 15;
  if (p.st === 'adodge') return p.f >= 3 && p.f <= 14;
  if (p.st === 'tech') return p.f <= 14;
  if (p.st === 'getup') return p.f <= (p.gk === 'roll' ? 16 : 20);
  if (p.st === 'atk' && MV[p.mv].inv) { const v = MV[p.mv].inv; return p.mvf >= v[0] && p.mvf <= v[1]; }
  return false;
}

Sim.prototype.startMove = function(p, id){
  p.st = 'atk'; p.mv = id; p.mvf = 0; p.hitDone = false; p.chainReq = false; p.buf.A = 0;
  if (id === 'iai' || id === 'airiai') p.buf.G = 0;
  this.ev.push({ t: 'start', p: p.i, mv: id });
};

Sim.prototype.think = function(p, o){
  const h = horiz(p), i = p.inp;
  const oppStun = o.st === 'stun';
  const canIai = oppStun && p.buf.G > 0;
  if (p.ground && (p.st === 'idle' || p.st === 'walk' || p.st === 'crouch' || p.st === 'guard')) {
    if (o.x !== p.x) p.face = sgn(o.x - p.x);
  }
  switch (p.st) {
    case 'idle': case 'walk': case 'crouch':
      if (canIai) return this.startMove(p, 'iai');
      if (i.G && !oppStun) {
        if (p.buf.A) return this.startMove(p, 'grab');
        if (p.hEdge) { p.st = 'roll'; p.f = 0; p.rollDir = p.hEdge; return; }
        p.st = 'guard'; p.f = 0; return;
      }
      if (p.buf.J) {
        p.buf.J = 0;
        if (i.D && p.plat >= 0) { p.ground = false; p.plat = -1; p.dropF = 12; p.st = 'air'; return; }
        p.st = 'jsq'; p.f = 0; return;
      }
      if (p.buf.A) {
        if (i.D) return this.startMove(p, 'dtilt');
        if (i.U) return this.startMove(p, 'utilt');
        if (h) return this.startMove(p, 'side');
        return this.startMove(p, 'jab1');
      }
      p.st = i.D ? 'crouch' : h ? 'walk' : 'idle';
      return;
    case 'guard':
      if (!i.G) { p.st = 'unguard'; p.f = 0; return; }
      if (p.buf.A) return this.startMove(p, 'grab');
      if (p.hEdge) { p.st = 'roll'; p.f = 0; p.rollDir = p.hEdge; return; }
      if (p.buf.J) { p.buf.J = 0; p.st = 'jsq'; p.f = 0; return; }
      return;
    case 'air': {
      if (canIai) return this.startMove(p, 'airiai');
      if (p.buf.G && !p.adUsed && !oppStun) { p.buf.G = 0; p.adUsed = true; p.st = 'adodge'; p.f = 0; return; }
      if (p.buf.J) {
        const atL = p.x <= WALL_L + 600, atR = p.x >= WALL_R - 600;
        if ((atL && h > 0) || (atR && h < 0)) { p.buf.J = 0; p.vy = PH.wallVY; p.vx = h * PH.wallVX; p.face = h; p.ff = false; this.ev.push({ t: 'walljump', p: p.i }); return; }
        if (p.jumps > 0) { p.buf.J = 0; p.jumps--; p.vy = PH.jump2; p.vx = h * PH.airMax; p.ff = false; if (h) p.face = h; this.ev.push({ t: 'jump2', p: p.i }); return; }
      }
      if (p.buf.A) {
        const d = h * p.face;
        if (i.U && !i.D) return this.startMove(p, 'uair');
        if (i.D) return this.startMove(p, 'dair');
        if (d > 0) return this.startMove(p, 'fair');
        if (d < 0) return this.startMove(p, 'bair');
        return this.startMove(p, 'nair');
      }
      if (i.D && !p.pi.D && p.vy <= 200) p.ff = true;
      return;
    }
    case 'atk': {
      const m = MV[p.mv];
      if (m.chain && p.buf.A && p.mvf >= m.s) p.chainReq = true;
      return;
    }
    case 'down':
      if (p.f <= 0) {
        if (p.buf.A) { p.st = 'atk'; this.startMove(p, 'gatk'); return; }
        if (h) { p.st = 'getup'; p.gk = 'roll'; p.f = 0; p.rollDir = h; return; }
        if (p.buf.J || p.buf.G || i.U || p.downT >= C.downMax) { p.st = 'getup'; p.gk = 'stand'; p.f = 0; return; }
      }
      return;
  }
};

/* 状態ごとの時間の進み・移動 */
Sim.prototype.update = function(p, o){
  const h = horiz(p);
  if (p.wallF > 0) p.wallF--;
  if (p.dropF > 0) p.dropF--;
  switch (p.st) {
    case 'idle': case 'crouch': case 'guard': case 'unguard': case 'bstun': case 'hit': case 'land': case 'tech': case 'stun':
      p.vx = toward(p.vx, 0, PH.gFric); break;
    case 'walk': p.vx = h * PH.walk; break;
    case 'jsq':
      p.f++;
      if (p.f >= C.jsq) { p.st = 'air'; p.ground = false; p.plat = -1; p.vy = p.inp.J ? PH.jumpF : PH.jumpS; p.vx = h * Math.floor(PH.airMax * 4 / 5); p.ff = false; this.ev.push({ t: 'jump', p: p.i }); }
      break;
    case 'roll':
      p.f++;
      p.vx = (p.f >= 4 && p.f <= 20) ? p.rollDir * PH.roll : toward(p.vx, 0, PH.gFric * 2);
      if (p.f >= 28) { p.st = 'idle'; }
      break;
    case 'adodge':
      p.f++; p.vx = toward(p.vx, 0, 30);
      if (p.f >= 26) p.st = 'air';
      break;
    case 'getup':
      p.f++;
      if (p.gk === 'roll') p.vx = (p.f >= 4 && p.f <= 22) ? p.rollDir * 520 : 0;
      if (p.f >= (p.gk === 'roll' ? 32 : 30)) p.st = 'idle';
      break;
    case 'down':
      p.vx = toward(p.vx, 0, PH.gFric * 2); p.downT++; if (p.f > 0) p.f--; break;
  }
  if (p.st === 'air' || (p.st === 'atk' && !p.ground) || p.st === 'adodge') {
    if (p.st !== 'adodge') p.vx = toward(p.vx, h * PH.airMax, PH.airAcc);
  }
  if (p.st === 'atk') {
    const m = MV[p.mv];
    p.mvf++;
    if (m.lunge && p.mvf >= m.lunge[0] && p.mvf <= m.lunge[1]) p.vx = p.face * m.lunge[2];
    else if (p.ground) p.vx = toward(p.vx, 0, PH.gFric);
    if (p.mv === 'jab1' && p.inp.A && p.holdA >= m.total && p.mvf >= m.total) { // 押し続けると溜めへ
      p.st = 'charge'; p.chargeF = 0; p.mv = null;
    }
  } else if (p.st === 'charge') {
    p.vx = toward(p.vx, 0, PH.gFric);
    p.chargeF++;
    if (!p.inp.A || p.chargeF >= SMASH_MAX) {
      const c = Math.max(SMASH_MIN, p.chargeF);
      p.power = Math.floor((c - SMASH_MIN) * 100 / (SMASH_MAX - SMASH_MIN));
      this.startMove(p, 'smash');
      p.mvf = 1;
    }
  }
  // 当たった・守った後の固まり
  if (p.st === 'hit' || p.st === 'bstun' || p.st === 'tumble') {
    if (p.hs > 0) p.hs--;
    if (p.hs <= 0) { if (p.st === 'tumble') { p.st = 'air'; } else p.st = 'idle'; }
  }
  if (p.st === 'unguard' || p.st === 'land' || p.st === 'tech') {
    p.f--; if (p.f <= 0) p.st = 'idle';
  }
  if (p.st === 'stun') {
    p.stun--;
    if (p.stun <= 0) { p.st = 'idle'; p.gd = C.stunRecoverGd; this.ev.push({ t: 'stunEnd', p: p.i }); }
  }
  // ガードの回復
  if (p.st === 'guard' || p.st === 'bstun' || p.st === 'stun') p.gdDelay = 0;
  else { p.gdDelay++; if (p.gdDelay > C.gdRegenDelay && p.gd < GD_MAX) p.gd = Math.min(GD_MAX, p.gd + C.gdRegen); }
};

Sim.prototype.physics = function(p){
  if (!p.ground) {
    p.vy -= PH.grav;
    const lim = p.ff ? PH.ffall : PH.fallMax;
    if (p.ff) p.vy = Math.min(p.vy, -PH.ffall + 400);
    if (p.vy < -lim) p.vy = -lim;
  }
  const py = p.y;
  p.x += p.vx; p.y += p.vy * (p.ground ? 0 : 1);
  // 竹林の端
  if (p.x < WALL_L || p.x > WALL_R) {
    const hitWall = (p.st === 'tumble') && Math.abs(p.vx) > 500;
    p.x = p.x < WALL_L ? WALL_L : WALL_R;
    if (hitWall) { p.vx = -Math.trunc(p.vx / 2); p.wallF = 60; this.ev.push({ t: 'wall', p: p.i, x: p.x, y: p.y }); }
    else p.vx = 0;
  }
  if (p.ground) {
    if (p.plat >= 0) {
      const pl = PLATS[p.plat];
      if (p.x < pl.x0 || p.x > pl.x1) { p.ground = false; p.plat = -1; p.jumps = Math.min(p.jumps, 1); if (p.st === 'walk' || p.st === 'idle') p.st = 'air'; }
    }
    if (p.ground) p.vy = 0;
    return;
  }
  // 着地
  let landY = null, plat = -1;
  if (p.y <= 0) { landY = 0; }
  else if (p.vy <= 0 && p.dropF === 0 && !(p.st === 'tumble' && p.inp.D)) {
    for (let k = 0; k < PLATS.length; k++) {
      const pl = PLATS[k];
      if (py >= pl.y && p.y < pl.y && p.x >= pl.x0 && p.x <= pl.x1) { landY = pl.y; plat = k; break; }
    }
  }
  if (landY != null) this.land(p, landY, plat);
};

Sim.prototype.land = function(p, y, plat){
  const vy = p.vy;
  p.y = y; p.vy = 0; p.ground = true; p.plat = plat; p.jumps = 1; p.adUsed = false; p.ff = false;
  if (p.st === 'atk') {
    const m = MV[p.mv];
    if (m.k === 'a') { p.st = 'land'; p.f = m.land; this.ev.push({ t: 'land', p: p.i, lag: m.land }); }
  } else if (p.st === 'tumble') {
    if (p.hs > 8 || p.kd || vy < -900) {
      if (p.lastG <= C.techWin) {
        const h = horiz(p);
        if (h) { p.st = 'roll'; p.f = 3; p.rollDir = h; } else { p.st = 'tech'; p.f = 20; }
        this.ev.push({ t: 'tech', p: p.i, x: p.x, y: p.y });
      } else { p.st = 'down'; p.f = C.downF; p.downT = 0; p.vx = Math.trunc(p.vx / 3); this.ev.push({ t: 'down', p: p.i, x: p.x, y: p.y }); }
      p.kd = false; p.hs = 0;
    } else { p.st = 'land'; p.f = 4; p.hs = 0; }
  } else if (p.st === 'adodge') { p.st = 'land'; p.f = 10; }
  else if (p.st === 'air') { p.st = 'land'; p.f = C.landF; }
  else if (p.st === 'stun') { /* 立ったまま気絶が続く */ }
};

function box(p, b){
  const x0 = p.x + p.face * b[0] * FP, x1 = p.x + p.face * (b[0] + b[2]) * FP;
  return [Math.min(x0, x1), p.y + b[1] * FP, Math.max(x0, x1), p.y + (b[1] + b[3]) * FP];
}
function hbox(p){ const b = hurt(p); return [p.x + b[0] * FP, p.y + b[1] * FP, p.x + (b[0] + b[2]) * FP, p.y + (b[1] + b[3]) * FP]; }
const overlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

Sim.prototype.hits = function(){
  const P = this.p;
  const todo = [];
  for (const a of P) {
    if (a.st !== 'atk' || a.hitDone) continue;
    const m = MV[a.mv];
    if (a.mvf < m.s || a.mvf >= m.s + m.a) continue;
    const d = P[1 - a.i];
    if (invuln(d)) continue;
    if (!overlap(box(a, m.box), hbox(d))) continue;
    todo.push([a, d, m]);
  }
  // 相打ちも両方当てる（同じFに決めるので順番に依らない）
  const snap = todo.map(([a, d]) => ({ a: a.i, dst: d.st, dmv: d.mv, dmvf: d.mvf, dground: d.ground }));
  todo.forEach(([a, d, m], k) => { a.hitDone = true; this.applyHit(a, d, m, snap[k]); });
};

Sim.prototype.applyHit = function(a, d, m, s){
  const ev = this.ev;
  const dir = sgn(d.x - a.x) || a.face;
  const mvRem = m.total - a.mvf;
  const pw = a.power || 0;
  const dmgBase = Array.isArray(m.dmg) ? m.dmg[0] + Math.floor((m.dmg[1] - m.dmg[0]) * pw / 100) : m.dmg;
  const gdBase = Array.isArray(m.gd) ? m.gd[0] + Math.floor((m.gd[1] - m.gd[0]) * pw / 100) : m.gd;
  const guarding = (s.dst === 'guard' || s.dst === 'bstun' || s.dst === 'unguard') && s.dground;
  const hx = Math.trunc((a.x + d.x) / 2), hy = d.y + 60 * FP;

  if (m.grab && !guarding) { a.hitDone = false; return; }       // 組み打ちはガード中の相手だけ
  if (guarding && !m.iai) {
    d.gd -= gdBase; d.touched = true; d.gdDelay = 0;
    if (d.gd <= 2000) d.gdLow = true;
    if (d.gd <= 0) {
      d.gd = 0; d.st = 'stun'; d.stun = C.stunF; d.stunCount++; d.vx = dir * 500;
      this.hitstop = 14;
      ev.push({ t: 'break', p: d.i, by: a.i, x: hx, y: hy, mv: m.id });
      a.combo = 0;
      return;
    }
    if (m.grab) { /* 投げる */ }
    else {
      d.st = 'bstun'; d.hs = m.bs; d.vx = dir * 520;
      this.hitstop = m.dmg >= 700 || Array.isArray(m.dmg) ? 7 : 4;
      ev.push({ t: 'block', p: d.i, by: a.i, x: hx, y: hy, mv: m.id, adv: m.bs - mvRem, gd: gdBase });
      return;
    }
  }
  // ここから当たり
  if (this.sd) { d.hp = Math.max(0, d.hp - dmgBase); this.finish(a, d, 'sd', m, s); return; }
  const inStun = s.dst === 'hit' || s.dst === 'tumble' || s.dst === 'stun' || s.dst === 'down';
  if (s.dst === 'stun' && m.iai) { this.finish(a, d, 'iai', m, s); return; }
  if (inStun && a.combo > 0) { a.combo++; }
  else {
    a.combo = 1; a.comboDmg = 0; a.sameCnt = 0; a.lastMv = null;
    const dm = s.dmv ? MV[s.dmv] : null;
    a.comboFirst = {
      counter: s.dst === 'atk' && dm && s.dmvf < dm.s,
      punish: (s.dst === 'atk' && dm && s.dmvf >= dm.s + dm.a) || s.dst === 'land' || s.dst === 'roll',
    };
  }
  if (a.lastMv === m.id) a.sameCnt++; else a.sameCnt = 0;
  a.lastMv = m.id;
  let scale = a.combo >= 4 ? Math.max(40, 100 - 10 * (a.combo - 3)) : 100;
  for (let k = 0; k < a.sameCnt; k++) scale = Math.floor(scale * 8 / 10);
  if (a.combo === 1 && a.comboFirst.counter) scale = Math.floor(scale * 13 / 10);
  const dmg = Math.floor(dmgBase * scale / 100) + (m.grab ? 0 : 0);
  d.hp = Math.max(0, d.hp - dmg); d.touched = true;
  if (m.grab) { d.gd = Math.max(1, d.gd - gdBase); }
  a.comboDmg += dmg;
  const kbs = 100 + Math.floor((HP_MAX - d.hp) / 200);
  if (s.dst === 'stun') {
    d.vx = dir * Math.floor(m.kb[0] * kbs / 200);
    ev.push({ t: 'hit', p: d.i, by: a.i, x: hx, y: hy, mv: m.id, dmg, combo: a.combo, adv: null, stun: true });
  } else {
    let kx = Math.floor(m.kb[0] * kbs / 100), ky = Math.floor(m.kb[1] * kbs / 100);
    d.mv = null; d.chargeF = 0;
    if (ky > 0 || !d.ground) {
      d.st = 'tumble'; d.ground = false; d.plat = -1; d.vx = dir * kx; d.vy = ky > 0 ? ky : m.kb[1] < 0 ? ky : Math.max(300, d.vy); d.ff = false;
      if (d.y === 0 && d.vy < 0) { d.vy = 0; }
      d.kd = !!m.kd;
    } else if (m.kb[1] < 0) { // 地上の相手に叩きつけ
      d.st = 'tumble'; d.ground = false; d.plat = -1; d.vy = 500; d.vx = dir * 200; d.kd = true;
    } else { d.st = 'hit'; d.vx = dir * kx; }
    d.hs = m.hs; if (d.st === 'tumble') d.jumps = 1;
    const adv = (d.st === 'hit') ? m.hs - mvRem : null;
    ev.push({ t: 'hit', p: d.i, by: a.i, x: hx, y: hy, mv: m.id, dmg, combo: a.combo, adv, counter: a.combo === 1 && a.comboFirst.counter });
  }
  this.hitstop = dmg >= 700 ? 8 : 4;
  if (d.hp <= 0) this.finish(a, d, 'ko', m, s);
};

/* 一本。決着名を決める */
Sim.prototype.finish = function(w, l, how, m, s){
  const tw = this.opts.toWin || C.toWin;
  const bothLast = this.wins[0] === tw - 1 && this.wins[1] === tw - 1;
  const air = !w.ground || !s.dground;
  const back = l.face * (w.x - l.x) < 0;
  const iai = how === 'iai';
  let name;
  if (how === 'sd') name = '刹那';
  else if (iai && bothLast && !w.touched) name = '一閃';
  else if (!w.touched) name = '明鏡止水';
  else if (bothLast && iai) name = '紙一重';
  else if (bothLast) name = '鏡返し';
  else if (w.hp <= 2000) name = '死中活';
  else if (iai && w.gdLow) name = '流転';
  else if (!iai && w.combo >= 10) name = '百花';
  else if (iai && l.stunCount >= 2) name = '二の太刀';
  else if (back) name = '陽炎';
  else if (!iai && w.comboDmg >= 5000) name = '止め';
  else if (air) name = '落花';
  else if (l.wallF > 0) name = '背水';
  else if (iai) name = '疾風';
  else if (w.comboFirst && w.comboFirst.counter) name = '先の先';
  else if (w.comboFirst && w.comboFirst.punish) name = '隙穿ち';
  else name = '斬り伏せ';
  this.over = true;
  if (!this.opts.training) this.wins[w.i]++;
  l.st = 'ko';
  this.hitstop = 0;
  this.result = { winner: w.i, how, name, tier: FIN[name].tier, combo: w.combo, frame: this.frame,
    matchOver: !this.opts.training && this.wins[w.i] >= tw };
  this.ev.push({ t: 'finish', p: w.i, how, name, x: l.x, y: l.y + 60 * FP });
};

Sim.prototype.step = function(inputs){
  if (this.over) return;
  const P = this.p;
  if (this.hitstop > 0) {
    this.hitstop--;
    for (const p of P) { // 止まっている間も押した瞬間は覚えておく
      const inp = inputs[p.i] || NOIN;
      for (const k of ['A', 'J', 'G']) if (inp[k] && !p.inp[k]) p.buf[k] = C.buf;
      p.inp = Object.assign({}, p.inp, { A: inp.A, J: inp.J, G: inp.G });
    }
    return;
  }
  this.frame++;
  for (const p of P) readInput(p, inputs[p.i] || NOIN);
  this.think(P[0], P[1]); this.think(P[1], P[0]);
  for (const p of P) this.update(p, P[1 - p.i]);
  for (const p of P) this.physics(p);
  // 押し合い
  const a = P[0], b = P[1];
  if (Math.abs(a.y - b.y) < 100 * FP && a.st !== 'roll' && b.st !== 'roll' && a.st !== 'down' && b.st !== 'down') {
    const dx = b.x - a.x, ov = 44 * FP - Math.abs(dx);
    if (ov > 0) { const s = dx >= 0 ? 1 : -1, hlf = Math.ceil(ov / 2); a.x -= s * hlf; b.x += s * hlf;
      a.x = Math.min(WALL_R, Math.max(WALL_L, a.x)); b.x = Math.min(WALL_R, Math.max(WALL_L, b.x)); }
  }
  this.hits();
  // 技の終わり
  for (const p of P) {
    if (p.st !== 'atk') continue;
    const m = MV[p.mv];
    if (m.chain && p.chainReq && p.mvf >= m.s + m.a - 1) { this.startMove(p, m.chain); continue; }
    if (p.mvf >= m.total) {
      if (p.mv === 'jab1' && p.inp.A && p.holdA >= m.total) { p.st = 'charge'; p.chargeF = 0; p.mv = null; continue; }
      p.st = p.ground ? 'idle' : 'air'; p.mv = null; p.power = 0;
    }
  }
  if (this.over) return;
  if (!this.sd && this.frame >= C.roundF) { this.sd = true; this.sdStart = this.frame; this.ev.push({ t: 'sd' }); }
  if (this.sd && this.frame - this.sdStart >= C.sdF) {
    this.over = true; this.result = { winner: -1, how: 'draw', name: '睨み合い', tier: '分', frame: this.frame, matchOver: false };
    this.ev.push({ t: 'finish', p: -1, how: 'draw', name: '睨み合い' });
  }
};

/* 盤面の要約（ずれの検出・テスト用） */
Sim.prototype.hash = function(){
  let h = 2166136261 >>> 0;
  const mix = v => { h ^= (v | 0); h = Math.imul(h, 16777619) >>> 0; };
  mix(this.frame); mix(this.hitstop);
  for (const p of this.p) { mix(p.x); mix(p.y); mix(p.vx); mix(p.vy); mix(p.hp); mix(p.gd); mix(p.stun); mix(p.mvf); mix(p.f); mix(p.hs); mix(p.st.length * 31 + p.st.charCodeAt(0)); }
  return h;
};

const API = { Sim, MV, FIN, C, PH, FP, PLATS, WALL_L, WALL_R, HP_MAX, GD_MAX, SMASH_MIN, SMASH_MAX, NOIN, invuln, hurt, box };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else root.IssenAction = API;
})(typeof window !== 'undefined' ? window : globalThis);
