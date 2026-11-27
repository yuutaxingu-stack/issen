/* =====================================================================
   一閃（対戦アクション） 計算の中身
   - 1秒60回の固定の歩み。位置・速さ・体力はすべて整数（1px = 100）で数える。
     同じ操作を入れれば、どの端末でも必ず同じ結果になる（ネット対戦・観戦の土台）。
   - 描画や音は持たない。毎フレーム step([入力0, 入力1]) を呼ぶだけ。
   - 入力は { L, R, U, D, A(斬), J(跳), G(守), F(スティックを素早く倒した瞬間), V(技の向き 'u'|'d'|'h'|'n'、省略可), C(攻撃スティックを弾いた瞬間 'u'|'d'|'l'|'r'|'n') }。
   ===================================================================== */
(function(root){
'use strict';
const FP = 100;
const WALL_L = 40 * FP, WALL_R = 1560 * FP;
const PLATS = [{ x0: 330 * FP, x1: 630 * FP, y: 190 * FP }, { x0: 970 * FP, x1: 1270 * FP, y: 190 * FP }];
const PH = { walk: 340, dash: 800, airMax: 520, airAcc: 70, grav: 62, fallMax: 1150, ffall: 1700, jumpS: 1150, jumpF: 1550, jump2: 1350,
             wallVX: 750, wallVY: 1350, gFric: 90, roll: 650 };
const HP_MAX = 10000, GD_MAX = 10000;
const C = {
  gdRegenDelay: 60,   // 守を離してから回復が始まるまで
  gdRegen: 33,        // 1Fの回復量（約 毎秒20）
  stunF: 90,          // 気絶
  stunRecoverGd: 5000,// 気絶明けのガード
  slideF: 30,         // ダッシュ中の守で滑る長さ（0.5秒）
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
  jab1:  { n:'弱斬り（一段目）', k:'g', s:5, a:3, r:10, dmg:300, gd:600, hit:6, blk:-2, kb:[220,0], box:[6,58,60,34], arc:[-35,25], chain:'jab2', cancel:1 },
  jab2:  { n:'弱斬り（二段目）', k:'g', s:5, a:3, r:12, dmg:300, gd:600, hit:5, blk:-3, kb:[220,0], box:[6,58,60,34], arc:[45,-20], chain:'jab3', cancel:1 },
  jab3:  { n:'弱斬り（三段目・払い）', k:'g', s:7, a:4, r:20, dmg:500, gd:1000, hs:30, blk:-10, kb:[750,850], kd:1, box:[6,42,74,50], arc:[-60,60], cancel:1 },
  side:  { n:'踏み込み斬り', k:'g', s:14, a:4, r:22, dmg:700, gd:1800, hs:28, blk:-8, kb:[950,560], box:[8,38,100,64], arc:[150,-35], lunge:[2,14,900] },
  ftilt: { n:'横斬り', k:'g', s:8, a:3, r:18, dmg:600, gd:900, hs:22, blk:-6, kb:[620,240], box:[8,40,86,52], arc:[60,-30] },
  sideA: { n:'踏み込み斬り（空中）', k:'a', s:12, a:4, r:18, land:14, dmg:600, gd:1500, hs:24, kb:[850,500], box:[8,30,100,70], arc:[150,-35], lunge:[2,12,850], hover:1 },
  rise:  { n:'昇り斬り', k:'a', s:5, a:10, r:12, land:20, dmg:600, gd:1000, hs:26, kb:[150,1250], box:[-24,40,76,120], arc:[-60,95], rise:1, kd:1, after:'fall', dfall:1 },
  sweep: { n:'足払い', k:'g', s:12, a:5, r:24, dmg:600, gd:1200, hs:30, blk:-12, kb:[420,650], kd:1, box:[4,0,112,26], arc:[-20,-5], crouch:1 },
  plunge:{ n:'落とし', k:'a', s:8, a:90, r:1, land:22, dmg:800, gd:1400, hs:28, kb:[350,800], kd:1, box:[-26,-30,52,84], arc:[-90,-90], plunge:1, ext:20, pad:12 },
  shot:  { n:'飛ぶ斬撃', k:'g', s:18, a:1, r:35, noBox:1, shot:1, arc:[150,-30] },
  shotP: { n:'飛ぶ斬撃', k:'p', s:1, a:1, r:0, dmg:500, gd:900, hs:14, blk:-4, kb:[260,0], flinch:1 },
  dashatk:{ n:'ダッシュ斬り', k:'g', s:7, a:6, r:22, dmg:700, gd:1000, hs:26, blk:-10, kb:[700,550], box:[4,30,92,70], arc:[160,-20], lunge:[1,10,700] },
  counter:{ n:'カウンター', k:'g', s:7, a:23, r:40, noBox:1, counter:1, arc:[95,95] },
  ctrHit:{ n:'カウンター（反撃）', k:'g', s:4, a:3, r:36, dmg:1000, gd:2000, hs:30, blk:-20, kb:[950,650], box:[-24,16,140,104], arc:[170,-40] },
  utilt: { n:'上斬り', k:'g', s:7, a:5, r:16, dmg:500, gd:800, hs:34, blk:-6, kb:[90,1500], box:[-14,72,84,92], arc:[-40,125] },
  dtilt: { n:'下斬り', k:'g', s:6, a:3, r:14, dmg:400, gd:700, hit:3, blk:-4, kb:[260,0], box:[6,0,92,34], arc:[-25,-5], crouch:1 },
  grab:  { n:'組み打ち', k:'g', s:7, a:2, r:30, dmg:400, gd:3500, hs:30, kb:[750,760], kd:1, box:[8,20,58,92], grab:1, arc:[-10,-10] },
  iai:   { n:'居合', k:'g', s:10, a:4, r:40, dmg:1000, gd:2000, hs:30, blk:-30, kb:[900,600], box:[0,30,132,82], iai:1, arc:[-45,15], lunge:[2,10,3400], ext:30 },
  gatk:  { n:'起き上がり斬り', k:'g', s:18, a:4, r:8, dmg:500, gd:800, hs:24, blk:-4, kb:[650,300], box:[-72,0,144,60], arc:[-170,170], inv:[1,12] },
  nair:  { n:'空中斬', k:'a', s:5, a:6, r:14, land:8, dmg:400, gd:600, hs:18, kb:[320,320], box:[-44,26,104,84], arc:[-150,150] },
  fair:  { n:'前空斬', k:'a', s:8, a:4, r:18, land:12, dmg:600, gd:900, hs:22, kb:[720,360], box:[8,28,98,72], arc:[120,-60] },
  bair:  { n:'後空斬', k:'a', s:5, a:3, r:16, land:11, dmg:900, gd:1100, hs:24, kb:[860,430], box:[-118,22,114,88], arc:[200,280], ext:20 },
  uair:  { n:'上空斬', k:'a', s:8, a:5, r:14, land:10, dmg:500, gd:700, hs:24, kb:[100,1150], box:[-44,92,88,74], arc:[-10,190] },
  dair:  { n:'下空斬（突き）', k:'a', s:16, a:2, r:20, land:18, dmg:800, gd:1200, hs:34, kb:[60,0], flinch:1, box:[-13,-97,26,129], arc:[-90,-90], ext:45, pad:12 },
  /* 刀「桜華」（絶）。強化は木の段階で決まり、段階ごとに一度だけ（startMove で判定） */
  hana:  { n:'花嵐', k:'g', s:20, a:1, r:40, noBox:1, shot:'hana', arc:[150,-30] },
  petal: { n:'花嵐', k:'p', s:1, a:1, r:0, dmg:400, gd:800, hs:14, blk:-4, kb:[220,0], flinch:1 },
  petalS:{ n:'花嵐（落花）', k:'p', s:1, a:1, r:0, dmg:200, gd:400, hs:10, blk:-2, kb:[120,0], flinch:1 },
  // 天桜を当てたら、天桜を使った側が着地して動けるまで相手は落ちてこない（確定反撃を受けない。2026-11-27）
  ten:   { n:'天桜', k:'a', s:5, a:10, r:12, land:20, dmg:600, gd:1000, hs:60, kb:[150,1750], arc:[-60,95], rise:1, kd:1, after:'fall', dfall:1, pose:'rise' },
  tenK:  { n:'天桜（開花）', k:'a', s:5, a:12, r:12, land:20, dmg:600, gd:1000, hs:86, kb:[150,2300], arc:[-60,95], rise:1, kd:1, riseV:2300, after:'fall', dfall:1, pose:'rise' },
  tenM:  { n:'天桜（満開）', k:'a', s:5, a:12, r:12, land:20, dmg:700, gd:1200, hs:86, kb:[150,2300], arc:[-60,95], rise:1, kd:1, riseV:2300, after:'fall', dfall:1, pose:'rise', aura:[-75,0,150,160] },
  tenR:  { n:'天桜（落花）', k:'a', s:5, a:12, r:6, land:20, dmg:700, gd:1200, hs:54, kb:[150,1850], arc:[-60,95], rise:1, dfall:1, kd:1, riseV:2300, pose:'rise', aura:[-75,0,150,160], next:'tenFall' },
  // 八咫（2026-11-28）: 羽跳 = 8方向へまっすぐ二度跳ぶ。二度目は跳び終わりに向きを入れたときだけ。二度とも当てると相手に大きい硬直（haneX）
  hane:  { n:'羽跳', k:'a', s:6, a:23, r:14, land:14, dmg:400, gd:700, hs:24, blk:-4, kb:[120,320], box:[-38,6,76,104], arc:[0,0], hane:1, after:'fall', noLate:1 },
  haneX: { n:'羽跳（二度当て）', k:'a', s:6, a:23, r:14, land:14, dmg:500, gd:900, hs:60, blk:-4, kb:[320,900], box:[-38,6,76,104], arc:[0,0], hane:1, noBox:1, noLate:1 },
  shoki: { n:'初虧', k:'g', s:8, a:4, r:20, land:16, dmg:[600, 1000], gd:[1200, 1800], hs:26, blk:-6, kb:[700,450], box:[0,30,110,70], arc:[150,-30], shoki:1, hover:1, lunge:[2,11,0], noLate:1, pose:'side' },
  shokujin:{ n:'食甚', k:'g', s:16, a:1, r:24, land:16, dmg:900, gd:2000, hs:30, blk:-14, kb:[800,700], noBox:1, sj:1, after:'air', noLate:1, arc:[150,-30], pose:'side' },
  fukuen:{ n:'復円', k:'g', s:4, a:1, r:12, land:12, noBox:1, fuku:1, arc:[100,100] },
  tenFall:{ n:'天桜（落花・降下）', k:'a', s:6, a:90, r:1, land:22, dmg:700, gd:1200, hs:28, kb:[300,700], kd:1, plunge:1, arc:[-90,-90], ext:20, pad:14, pose:'plunge', aura:[-60,-10,120,100], landBurst:1 },
  petalG:{ n:'天桜（落花・着地の花）', k:'p', s:1, a:1, r:0, dmg:250, gd:500, hs:12, blk:-2, kb:[160,0], flinch:1 },
  plant: { n:'植樹', k:'g', s:14, a:1, r:16, noBox:1, plant:1, arc:[-70,-85] },
  airiai:{ n:'空中居合', k:'a', s:10, a:4, r:30, land:20, dmg:1000, gd:2000, hs:30, blk:-30, kb:[900,600], box:[0,10,132,100], iai:1, arc:[-45,15], lunge:[2,10,3000], ext:30 },
};
for (const id in MV) {
  const m = MV[id]; m.id = id;
  m.total = m.s + m.a - 1 + m.r;
  if (m.hit != null) m.hs = m.hit + m.a - 1 + m.r;
  if (m.blk != null) m.bs = Math.max(1, m.blk + m.a - 1 + m.r);
  else m.bs = Math.max(1, m.a - 1 + m.r - 8);
}
/* 当たり判定: 刀の通り道から作った表（js/action/boxes.js、tools/action-boxes.js で作る）。無い技は box を使う */
const BOXES = (typeof module !== 'undefined' && module.exports) ? (function(){ try { return require('./boxes.js'); } catch (e) { return {}; } })() : (root.IssenActionBoxes || {});
for (const id in MV) if (BOXES[id]) MV[id].boxes = BOXES[id];
function curBox(p){
  const m = MV[p.mv], b = m.boxes ? m.boxes[Math.min(m.boxes.length - 1, Math.max(0, p.mvf - m.s))] : m.box;
  if (!m.aura || !b) return b || m.aura;
  const u = m.aura, x0 = Math.min(b[0], u[0]), y0 = Math.min(b[1], u[1]); // 花びらを纏う技は体のまわりも当たる
  return [x0, y0, Math.max(b[0] + b[2], u[0] + u[2]) - x0, Math.max(b[1] + b[3], u[1] + u[3]) - y0];
}
const SMASH_MIN = 12, SMASH_MAX = 40;
/* 斬ボタン＋向きで出る特殊技。刀ごとに入れ替える（今は共通の一組だけ） */
const KIT = { common: { n: '共通', s1: 'shot', s1a: 'shot', s2: 'rise', s2a: 'rise', s3: 'counter', s3a: 'counter' },
  yata: { n: '八咫', s1: 'ecl', s1a: 'ecl', s2: 'hane', s2a: 'hane', s3: 'counter', s3a: 'counter' },
  ouka: { n: '桜華', s1: 'hana', s1a: 'hana', s2: 'ten', s2a: 'ten', s3: 'plant', s3a: 'plant' } };
/* 桜の木: 耐久は体力の4割。段階 1開花 2満開 3落花。u1/u2 = その段階の強化を花嵐/天桜で使ったか */
const TREE = { hp: 4000, name: ['', '開花', '満開', '落花'], box: [null, [-22, 0, 44, 80], [-60, 0, 120, 170], [-60, 0, 120, 170]] };
// 花嵐の当たる大きさ（2026-11-26 面積で3倍に）。射程は無限で壁まで飛ぶ。飛んだ距離 grow px ごとに大きさ +1倍（最大 maxW 倍）、
// dmgPer px ごとに威力 +100%（最大 maxDm%）。遠いほど花が散って広く、重くなる
const HANE = { sp: 3400, d1: 9, gap: 5, d2: 9, win: 5 }; // 羽跳: 速さ（1Fに進むpx×100）、一度目・間・二度目のF（d1+gap+d2 = hane の持続）、win = 二度目の向きを受け付けるF（間の終わりから数える。間より長ければ一度目の終わりも含む）
/* 八咫の横＋技は使うたびに 初虧 → 食甚 → 復円 と変わる。復円を溜めきると初虧に戻る */
const ECL = ['shoki', 'shokujin', 'fukuen'], ECLN = ['初虧', '食甚', '復円'];
const SHOKI = { max: 40, d0: 90, dPer: 5 };   // 初虧: 溜めは最大40F、踏み込みは 90px + 溜め1Fごとに5px
const FUKU = { max: 90 };                    // 復円: 合わせて90F溜めると初虧に戻る（途中で離しても溜めは残る）
const SJ = { tight: 0, K: 1 };                     // 食甚: 羽跳の二度当ての後、最速で出せばちょうど当たる（tight = 余裕のF）
const PETAL = { slow: 0.4, w: 76, h: 76, life: 900, grow: 500, maxW: 4, dmgPer: 800, maxDm: 250 };
const SHOT = { speed: 900, life: 45, w: 48, h: 56, ox: 60, oy: 62 };
/* 回避（2026-11-26 ユーザーの表） i0〜i1 が無敵、total が全体 */
const DG = {
  spot: { n: 'その場回避', i0: 3, i1: 17, total: 25 },
  fwd:  { n: '前方回避', i0: 4, i1: 15, total: 29, mv: [4, 22], v: 1050 },
  back: { n: '後方回避', i0: 5, i1: 16, total: 34, mv: [5, 26], v: 900 },
  airN: { n: '空中回避', i0: 3, i1: 28, total: 44, land: 10 },
  airD: { n: '空中回避（方向）', i0: 3, i1: 22, total: 60, land: 15, mv: [3, 10], v: 1000 },
};

/* 決着名 */
const FIN = {
  '一閃':{tier:'絶'}, '明鏡止水':{tier:'幻'}, '紙一重':{tier:'極'}, '鏡返し':{tier:'極'}, '死中活':{tier:'極'}, '流転':{tier:'極'}, '百花':{tier:'極'},
  '二の太刀':{tier:'上'}, '陽炎':{tier:'上'}, '止め':{tier:'上'}, '落花':{tier:'上'}, '背水':{tier:'上'}, '刹那':{tier:'上'},
  '散華':{tier:'絶'}, '先の先':{tier:'並'}, '隙穿ち':{tier:'並'}, '疾風':{tier:'並'}, '斬り伏せ':{tier:'並'}, '睨み合い':{tier:'分'}
};

const sgn = v => v > 0 ? 1 : v < 0 ? -1 : 0;
const toward = (v, t, d) => v < t ? Math.min(t, v + d) : Math.max(t, v - d);
const NOIN = { L:0, R:0, U:0, D:0, A:0, J:0, G:0 };

function newPlayer(i){
  return { i, x: (i ? 1000 : 600) * FP, y: 0, vx: 0, vy: 0, face: i ? -1 : 1, ground: true, plat: -1,
    st: 'idle', f: 0, mv: null, mvf: 0, hitDone: false, chainReq: false, chargeF: 0, power: 0,
    jumps: 1, adUsed: false, ff: false, dropF: 0,
    hp: HP_MAX, gd: GD_MAX, gdDelay: 0, stun: 0, hs: 0, kd: false, nokd: false, dfall: false, pjCut: false, haneUsed: false, haneN: 0, hane2: false, hdx: 0, hdy: 0, hq: null, ecl: 0, fuku: 0, chg: 0, sjOK: false, sjHit: false,
    pi: NOIN, inp: NOIN, buf: { A: 0, J: 0, G: 0 }, hEdge: 0, holdA: 0, lastG: 99, downT: 0,
    combo: 0, comboDmg: 0, comboFirst: null, lastMv: null, sameCnt: 0,
    stunCount: 0, gdLow: false, touched: false, wallF: 0, kit: 'common', dashRoll: false, slideV: 0, slideF: 30, s1Used: false, rk: 'fwd', ak: 'airN', adx: 0, ady: 0 };
}

function Sim(opts){
  this.opts = Object.assign({ training: false }, opts || {});
  this.wins = [0, 0];
  this.roundNo = 0;
  this.resetRound();
}
Sim.prototype.resetRound = function(){
  this.p = [newPlayer(0), newPlayer(1)];
  if (this.opts.kits) this.p.forEach((p, i) => { p.kit = this.opts.kits[i] || 'common'; });
  if (this.opts.dashRoll) this.p.forEach((p, i) => { p.dashRoll = !!this.opts.dashRoll[i]; });
  this.frame = 0; this.hitstop = 0; this.sd = false; this.sdStart = 0;
  this.over = false; this.result = null; this.ev = []; this.pj = [];
  this.roundNo++;
};

/* 入力を読み、押した瞬間を先行入力として覚える。
   技の途中は、持続から硬直の終わり（着地の硬直も）までに押した斬・技・跳を覚えておき、動けるようになった瞬間に出す。
   発生の前に押したものは受け付けない（2026-11-27） */
function readInput(p, inp){
  const pi = p.inp; p.pi = pi; p.inp = inp;
  const m = p.st === 'atk' ? MV[p.mv] : null;
  p.bHold = (m && p.mvf >= m.s) || p.st === 'land';
  p.bBlock = !!(m && p.mvf < m.s);
  for (const k of ['A', 'J', 'G']) {
    const ok = k === 'G' || !p.bBlock, keep = k !== 'G' && p.bHold;
    if (inp[k] && !pi[k]) { if (ok) p.buf[k] = C.buf; } else if (p.buf[k] > 0 && !keep) p.buf[k]--;
  }
  const h = (inp.R ? 1 : 0) - (inp.L ? 1 : 0), ph = (pi.R ? 1 : 0) - (pi.L ? 1 : 0);
  p.hEdge = (h && h !== ph) ? h : 0;
  p.holdA = inp.A ? p.holdA + 1 : 0;
  if (inp.S && !pi.S) { if (!p.bBlock) p.spB = C.buf; } else if (p.spB > 0 && !p.bHold) p.spB--; // 技ボタン: 向きなしでも刀の技（横の技）が出る
  p.lastG = (inp.G && !pi.G) ? 0 : p.lastG + 1;
  takeC(p, inp);
}
/* 攻撃スティック: 弾いた瞬間を斬の先行入力として覚え、向きも一緒に覚える */
function takeC(p, inp){
  if (p.cb && !p.bHold && --p.cb.n <= 0) p.cb = null;
  if (p.wk && !p.bHold && --p.wk.n <= 0) p.wk = null;
  if (p.bBlock) return;
  if (inp.C) { p.buf.A = C.buf; p.cb = { d: inp.C, n: C.buf }; p.wk = null; }
  if (inp.K) { p.buf.A = C.buf; p.wk = { d: inp.K, n: C.buf }; p.cb = null; } // 技スティック
}
/* 落花の間は速く動ける（1.5倍） */
const spd = (p, v) => p.tree && p.tree.stage >= 2 ? Math.trunc(v * 13 / 10) : v; // 満開・落花は動きが1.3倍
const horiz = p => (p.inp.R ? 1 : 0) - (p.inp.L ? 1 : 0);
/* 技の向き。スティックは強く倒した方（V）、キーボードなどは斜めなら横を優先（急降下しながらでも空前・空後が出る） */
function hsign(p){ return p.cb ? (p.cb.d === 'r' ? 1 : p.cb.d === 'l' ? -1 : 0) : horiz(p); }
function adir(p, air){
  if (p.cb) return p.cb.d === 'l' || p.cb.d === 'r' ? 'h' : p.cb.d;
  const i = p.inp, h = horiz(p);
  if (i.V === 'h' && h) return 'h';
  if (i.V === 'u' && i.U) return 'u';
  if (i.V === 'd' && i.D) return 'd';
  if (i.V === 'n') return 'n';
  if (air && h) return 'h';
  if (i.D) return 'd';
  if (i.U) return 'u';
  return h ? 'h' : 'n';
}

function hurt(p){
  if (p.st === 'down') return [-50, 0, 100, 28];
  if (p.st === 'crouch' || (p.st === 'atk' && MV[p.mv].crouch)) return [-22, 0, 44, 76];
  if (!p.ground) return [-22, 6, 44, 106];
  return [-22, 0, 44, 120];
}
function invuln(p){
  if (p.st === 'down' || p.st === 'ko') return true;
  if (p.st === 'roll') { const d = DG[p.rk]; return p.f >= d.i0 && p.f <= d.i1; }
  if (p.st === 'adodge') { const d = DG[p.ak]; return p.f >= d.i0 && p.f <= d.i1; }
  if (p.st === 'tech') return p.f <= 14;
  if (p.st === 'getup') return true; // 起き上がりは終わるまで無敵（終わった1F目に重ねられても守れるように）
  if (p.st === 'atk' && MV[p.mv].inv) { const v = MV[p.mv].inv; return p.mvf >= v[0] && p.mvf <= v[1]; }
  return false;
}

Sim.prototype.startMove = function(p, id){
  p.boost = 0;
  if (id === 'hana' || id === 'ten') { // 使う瞬間の木の段階で強化（段階ごとに一度だけ）
    const t = p.tree, k = id === 'hana' ? 'u1' : 'u2';
    if (t && !t[k]) { t[k] = true; p.boost = t.stage; }
    if (id === 'ten' && p.boost) id = ['ten', 'tenK', 'tenM', 'tenR'][p.boost];
  }
  if (id === 'ecl') id = ECL[p.ecl] || 'shoki';
  p.sjOK = false;
  if (id === 'shoki') { p.ecl = 1; p.chg = 0; } else if (id === 'shokujin') { p.ecl = 2; } else if (id === 'fukuen') p.chg = 0;
  p.treeHit = false;
  if (id === 'hane') { p.haneUsed = true; p.haneN = 0; p.hane2 = false; p.hdx = 0; p.hdy = 1000; }
  p.st = 'atk'; p.mv = id; p.mvf = 0; p.hitDone = false; p.chainReq = false; p.buf.A = 0; p.cb = null; p.wk = null; p.spB = 0;
  if (id === 'iai' || id === 'airiai') { p.buf.G = 0; const o = this.p[1 - p.i]; if (o.x !== p.x) p.face = sgn(o.x - p.x); }
  this.ev.push({ t: 'start', p: p.i, mv: id });
};

/* 地上: 攻撃スティックは通常技、斬ボタンは 向きなし＝三段 / 横・上・下＝特殊技 */
/* 技スティック（設定）: 弾いた向きの刀の技。向きなし＝特殊技1、横＝その向きへ特殊技1、上＝特殊技2、下＝特殊技3 */
Sim.prototype.kitByStick = function(p, air){
  const kit = KIT[p.kit] || KIT.common, k = p.wk.d; p.wk = null;
  if (k === 'u') { const id = air ? kit.s2a : kit.s2; if (id === 'hane' && p.haneUsed) { p.buf.A = 0; return; } return this.startMove(p, id); }
  if (k === 'd') { const id = air ? kit.s3a : kit.s3; if (id === 'plant' && p.tree) { p.buf.A = 0; return; } return this.startMove(p, id); }
  if (air) { if (p.s1Used) { p.buf.A = 0; return; } p.s1Used = true; }
  if (k === 'l' || k === 'r') p.face = k === 'r' ? 1 : -1;
  return this.startMove(p, air ? kit.s1a : kit.s1);
};
Sim.prototype.groundAttack = function(p){
  const kit = KIT[p.kit] || KIT.common;
  if (p.wk) return this.kitByStick(p, false);
  if (p.cb) {
    const d = adir(p);
    if (d === 'h') { p.face = hsign(p); return this.startMove(p, 'ftilt'); }
    if (d === 'u') return this.startMove(p, 'utilt');
    if (d === 'd') return this.startMove(p, 'dtilt');
    return this.startMove(p, 'jab1');
  }
  const d = adir(p);
  if (d === 'h' || (d === 'n' && p.spB)) { p.face = horiz(p) || p.face; return this.startMove(p, kit.s1); }
  if (d === 'u') return this.startMove(p, kit.s2);
  if (d === 'd') { if (kit.s3 === 'plant' && p.tree) { p.buf.A = 0; return; } return this.startMove(p, kit.s3); } // 木があるうちは植えられない（相手に折られるまで）
  return this.startMove(p, 'jab1');
};
Sim.prototype.airAttack = function(p){
  const kit = KIT[p.kit] || KIT.common;
  if (p.wk) return this.kitByStick(p, true);
  if (p.cb) {
    const dv = adir(p, true);
    if (dv === 'u') return this.startMove(p, 'uair');
    if (dv === 'd') return this.startMove(p, 'dair');
    if (dv === 'h') return this.startMove(p, hsign(p) * p.face > 0 ? 'fair' : 'bair');
    return this.startMove(p, 'nair');
  }
  const dv = adir(p, true);
  if (dv === 'h' || (dv === 'n' && p.spB)) { if (p.s1Used) { p.buf.A = 0; return; } p.s1Used = true; p.face = horiz(p) || p.face; return this.startMove(p, kit.s1a); }
  if (dv === 'u') { if (kit.s2a === 'hane' && p.haneUsed) { p.buf.A = 0; return; } return this.startMove(p, kit.s2a); }
  if (dv === 'd') { if (kit.s3a === 'plant' && p.tree) { p.buf.A = 0; return; } return this.startMove(p, kit.s3a); }
  return this.startMove(p, 'nair');
};
Sim.prototype.dodge = function(p, k, dir){
  p.st = 'roll'; p.f = 0; p.rk = k; p.rollDir = dir || p.face; p.buf.G = 0;
  this.ev.push({ t: 'dodge', p: p.i, k });
};
Sim.prototype.think = function(p, o){
  const h = horiz(p), i = p.inp;
  const oppStun = o.st === 'stun';
  const canIai = oppStun && p.buf.G > 0;
  // 八咫: 羽跳を二度当てた後は、跳び終わった後の硬直・無防備落下・着地の硬直を食甚で打ち消せる（最速で出せばちょうど確定）
  if (p.sjOK && p.ecl === 1 && (p.st === 'fall' || p.st === 'land' || (p.st === 'atk' && p.mv === 'hane' && p.mvf >= MV.hane.s + MV.hane.a)) && (o.st === 'hit' || o.st === 'tumble')) {
    const side = (p.wk && p.wk.d !== 'u' && p.wk.d !== 'd') || (p.spB && !i.U && !i.D && !p.wk);
    if (side) return this.startMove(p, 'shokujin'); }
  switch (p.st) {
    case 'idle': case 'walk': case 'crouch':
      if (canIai) return this.startMove(p, 'iai');
      if (i.G && !oppStun) {
        if (p.buf.A) return this.startMove(p, 'grab');
        if (p.hEdge) return this.dodge(p, p.hEdge === p.face ? 'fwd' : 'back', p.hEdge);
        if (i.D && p.buf.G) return this.dodge(p, 'spot');
        p.st = 'guard'; p.f = 0; p.slideF = C.slideF; return;
      }
      if (p.buf.J) {
        p.buf.J = 0;
        if (i.D && p.plat >= 0) { p.ground = false; p.plat = -1; p.dropF = 12; p.st = 'air'; return; }
        p.st = 'jsq'; p.f = 0; return;
      }
      if (p.buf.A) return this.groundAttack(p);
      if (i.F && h && !i.D) { p.st = 'dash'; p.face = h; p.f = 0; this.ev.push({ t: 'dash', p: p.i }); return; }
      if (h && !i.D) p.face = h;
      p.st = i.D ? 'crouch' : h ? 'walk' : 'idle';
      return;
    case 'dash':
      if (canIai) return this.startMove(p, 'iai');
      if (i.G && !oppStun) { // ダッシュ中の守: 勢いを残したままシールド（設定で「前方回避」にもできる）
        if (p.dashRoll) return this.dodge(p, 'fwd', p.face);
        p.st = 'guard'; p.f = 0; p.slideV = p.vx; p.slideF = 0; return;
      }
      if (p.buf.J) { p.buf.J = 0; p.st = 'jsq'; p.f = 0; return; }
      if (p.buf.A) { if (p.cb) return this.startMove(p, 'dashatk'); return this.groundAttack(p); } // 走りながら攻撃スティックでダッシュ斬り
      if (i.D) { p.st = 'crouch'; return; }
      if (h === -p.face) { p.face = h; p.f = 0; return; }
      if (!h) { p.st = 'idle'; return; } // 手を離すと滑って止まる
      return;
    case 'guard':
      if (!i.G) { p.st = 'unguard'; p.f = 0; return; }
      if (p.buf.A) return this.startMove(p, 'grab');
      if (p.hEdge) return this.dodge(p, p.hEdge === p.face ? 'fwd' : 'back', p.hEdge);
      if (i.D && !p.pi.D) return this.dodge(p, 'spot');
      if (p.buf.J) { p.buf.J = 0; p.st = 'jsq'; p.f = 0; return; }
      return;
    case 'air': {
      if (canIai) return this.startMove(p, 'airiai');
      if (p.buf.G && !p.adUsed && !oppStun) {
        p.buf.G = 0; p.adUsed = true; p.st = 'adodge'; p.f = 0;
        const v = (i.U ? 1 : 0) - (i.D ? 1 : 0);
        if (h || v) { p.ak = 'airD'; const n = (h && v) ? 707 : 1000; p.adx = h * n; p.ady = v * n; } else { p.ak = 'airN'; p.adx = 0; p.ady = 0; }
        this.ev.push({ t: 'dodge', p: p.i, k: p.ak }); return;
      }
      if (p.buf.J) {
        const atL = p.x <= WALL_L + 600, atR = p.x >= WALL_R - 600;
        if ((atL && h > 0) || (atR && h < 0)) { p.buf.J = 0; p.vy = PH.wallVY; p.vx = h * PH.wallVX; p.face = h; p.ff = false; this.ev.push({ t: 'walljump', p: p.i }); return; }
        if (p.jumps > 0) { p.buf.J = 0; p.jumps--; p.vy = PH.jump2; p.vx = h * PH.airMax; p.ff = false; this.ev.push({ t: 'jump2', p: p.i }); return; }
      }
      if (p.buf.A) return this.airAttack(p);
      if (i.D && !p.pi.D && p.vy <= 200) p.ff = true;
      return;
    }
    case 'atk': {
      const m = MV[p.mv];
      // 弱斬り三段は、当たったら（ガードされても）途中で 横・上・下の斬り や 刀の技 に切り替えられる（2026-11-27）
      if (m.cancel && p.hitDone && p.ground && p.mvf >= m.s && (p.wk || (p.buf.A && ((p.cb && p.cb.d !== 'n') || p.spB)))) { p.chainReq = false; return this.groundAttack(p); }
      if (p.kit === 'yata' && p.mv === 'utilt' && p.hitDone && p.mvf >= m.s && (p.wk || (p.buf.A && !p.cb && adir(p, false) === 'u'))) return this.groundAttack(p); // 八咫: 上斬りが当たったら技へつなげる
      if (m.chain && p.buf.A && !p.wk && !p.spB && (!p.cb || p.cb.d === 'n') && p.mvf >= m.s) p.chainReq = true; // 向きなしの斬だけ次の段へ
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
    case 'guard':
      if (p.slideF < C.slideF) { p.slideF++; p.vx = Math.trunc(p.slideV * (5 - Math.floor(p.slideF * 5 / C.slideF)) / 5); break; } // 0.1秒ごとに2割ずつ落ち、0.5秒で止まる
      p.vx = toward(p.vx, 0, PH.gFric); break;
    case 'idle': case 'crouch': case 'unguard': case 'bstun': case 'hit': case 'land': case 'tech': case 'stun':
      p.vx = toward(p.vx, 0, PH.gFric); break;
    case 'walk': p.vx = spd(p, h * PH.walk); break;
    case 'dash': p.f++; p.vx = spd(p, p.face * PH.dash); break;
    case 'jsq':
      p.f++;
      if (p.f >= C.jsq) { p.st = 'air'; p.ground = false; p.plat = -1; p.vy = p.inp.J ? PH.jumpF : PH.jumpS; p.vx = h * Math.floor(PH.airMax * 4 / 5); p.ff = false; this.ev.push({ t: 'jump', p: p.i }); }
      break;
    case 'roll': {
      p.f++; const d = DG[p.rk];
      p.vx = (d.mv && p.f >= d.mv[0] && p.f <= d.mv[1]) ? p.rollDir * d.v : toward(p.vx, 0, PH.gFric * 2);
      if (p.f >= d.total) { p.st = 'idle'; if (p.rk === 'fwd') p.face = -p.face; } // 前方回避の後は振り返る
      break; }
    case 'adodge': {
      p.f++; const d = DG[p.ak];
      if (d.mv && p.f >= d.mv[0] && p.f <= d.mv[1]) { p.vx = Math.trunc(p.adx * d.v / 1000); p.vy = Math.trunc(p.ady * d.v / 1000) + PH.grav; }
      else if (d.mv && p.f > d.mv[1]) { p.vx = toward(p.vx, 0, 40); }
      else p.vx = toward(p.vx, 0, 30);
      if (p.f >= d.total) p.st = 'air';
      break; }
    case 'fall': p.vx = toward(p.vx, h * Math.floor(PH.airMax * 6 / 10), Math.floor(PH.airAcc / 2)); break;
    case 'getup':
      p.f++;
      if (p.gk === 'roll') p.vx = (p.f >= 4 && p.f <= 22) ? p.rollDir * 520 : 0;
      if (p.f >= (p.gk === 'roll' ? 32 : 30)) { if (p.inp.G && o.st !== 'stun') { p.st = 'guard'; p.f = 0; p.slideF = C.slideF; } else p.st = 'idle'; } // 守を押していれば、起きた瞬間からガード
      break;
    case 'down':
      p.vx = toward(p.vx, 0, PH.gFric * 2); p.downT++; if (p.f > 0) p.f--; break;
  }
  if (p.st === 'air' || (p.st === 'atk' && !p.ground) || p.st === 'adodge') {
    if (p.st !== 'adodge') p.vx = toward(p.vx, spd(p, h * PH.airMax), PH.airAcc);
  }
  if (p.st === 'atk') {
    const m = MV[p.mv];
    p.mvf++;
    if (m.hane) this.haneMove(p, m);
    if (m.rise && p.mvf === 3) { p.ground = false; p.plat = -1; p.vy = m.riseV || 1750; p.vx = p.face * 250; p.ff = false; }
    if (m.plunge) { if (p.mvf < m.s) { p.vy = 0; p.vx = toward(p.vx, 0, 60); } else { p.vy = -2200; p.vx = 0; } }
    if (m.shoki && p.mvf === 2 && p.inp.H && p.chg < SHOKI.max) { p.chg++; p.mvf = 1; if (p.chg === SHOKI.max) this.ev.push({ t: 'charged', p: p.i }); } // 初虧: 押し続けると溜める
    if (m.shoki) p.power = Math.floor(p.chg * 100 / SHOKI.max);
    if (m.fuku && p.mvf === 2 && p.inp.H) {                                    // 復円: 押し続けると溜まる（離しても溜めは残る）
      if (p.inp.G && !p.pi.G) { p.mv = null; p.st = p.ground ? 'guard' : 'air'; p.f = 0; p.slideF = C.slideF; return; }
      p.fuku++; p.mvf = 1;
      if (p.fuku >= FUKU.max) { p.fuku = 0; p.ecl = 0; p.mvf = 2; this.ev.push({ t: 'fukuen', p: p.i, x: p.x, y: p.y }); } }
    if (m.fuku && p.mvf <= 2 && !p.ground) p.vy = Math.max(p.vy, -300);       // 溜めている間はゆっくり落ちる
    if (m.sj && p.mvf === m.s) this.shokujin(p, o);
    if (m.hover && p.mvf <= m.lunge[1]) p.vy = 0;
    if (m.shoki && p.mvf >= m.lunge[0] && p.mvf <= m.lunge[1]) p.vx = p.face * Math.trunc((SHOKI.d0 + SHOKI.dPer * p.chg) * FP / (m.lunge[1] - m.lunge[0] + 1));
    else if (m.lunge && p.mvf >= m.lunge[0] && p.mvf <= m.lunge[1]) p.vx = p.face * m.lunge[2];
    if (m.shoki && p.mvf === m.lunge[1] + 1) p.vx = 0; // 踏み込みはぴたりと止まる
    else if (p.ground && !m.hane && !m.sj) p.vx = toward(p.vx, 0, PH.gFric);
    if (m.shot && p.mvf === m.s) { if (m.shot === 'hana') this.spawnPetals(p); else this.spawnShot(p); }
    if (m.plant && p.mvf === m.s) this.plant(p);
  }
  // 当たった・守った後の固まり
  if (p.st === 'hit' || p.st === 'bstun' || p.st === 'tumble') {
    if (p.hs > 0) p.hs--;
    if (p.hs <= 0) { if (p.st === 'tumble' || !p.ground) { const df = p.dfall && !p.ground; p.st = df ? 'fall' : 'air'; if (!df) p.kd = false; } else p.st = 'idle'; p.dfall = false; } // dfall: 昇り斬り・天桜を食らった側も無防備落下
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
    const lim = (p.st === 'atk' && MV[p.mv].plunge) ? 2400 : p.ff ? PH.ffall : PH.fallMax;
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
  p.y = y; p.vy = 0; p.ground = true; p.plat = plat; p.jumps = 1; p.adUsed = false; p.haneUsed = false; p.ff = false; p.s1Used = false;
  if (p.st === 'atk') {
    const m = MV[p.mv];
    if (m.landBurst) this.fallBurst(p);
    if (m.k === 'a') { p.st = 'land'; p.f = m.land; this.ev.push({ t: 'land', p: p.i, lag: m.land }); }
  } else if (p.st === 'tumble') {
    if (p.dfall && !p.kd) { p.st = 'land'; p.f = 20; p.hs = 0; } // 無防備落下のまま着地: 受け身は取れず、落ちた側と同じ着地の硬直
    else if (!p.nokd && (p.hs > 8 || p.kd || vy < -900)) { // nokd: ダウンしない技
      if (p.lastG <= C.techWin && !p.dfall) {
        const h = horiz(p);
        if (h) { p.st = 'roll'; p.f = 3; p.rollDir = h; p.rk = h === p.face ? 'fwd' : 'back'; } else { p.st = 'tech'; p.f = 20; }
        this.ev.push({ t: 'tech', p: p.i, x: p.x, y: p.y });
      } else { p.st = 'down'; p.f = C.downF; p.downT = 0; p.vx = Math.trunc(p.vx / 3); this.ev.push({ t: 'down', p: p.i, x: p.x, y: p.y }); }
      p.kd = false; p.hs = 0;
    } else { p.st = 'land'; p.f = 4; p.hs = 0; }
    p.nokd = false; p.dfall = false;
  } else if (p.st === 'adodge') { p.st = 'land'; p.f = DG[p.ak].land; }
  else if (p.st === 'fall') {
    if (p.kd) { p.st = 'down'; p.f = C.downF; p.downT = 0; p.vx = Math.trunc(p.vx / 3); p.hs = 0; this.ev.push({ t: 'down', p: p.i, x: p.x, y: p.y }); } // 「必ずダウン」の技で無防備落下: 受け身なしで必ずダウン
    else { p.st = 'land'; p.f = 20; }
    p.dfall = false; p.kd = false; }
  else if (p.st === 'air') { p.st = 'land'; p.f = C.landF; }
  else if (p.st === 'stun' || p.st === 'hit') { /* そのまま続く */ }
};

function box(p, b){
  const x0 = p.x + p.face * b[0] * FP, x1 = p.x + p.face * (b[0] + b[2]) * FP;
  return [Math.min(x0, x1), p.y + b[1] * FP, Math.max(x0, x1), p.y + (b[1] + b[3]) * FP];
}
function hbox(p){ const b = hurt(p); return [p.x + b[0] * FP, p.y + b[1] * FP, p.x + (b[0] + b[2]) * FP, p.y + (b[1] + b[3]) * FP]; }
const overlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/* 羽跳の動き。向きはその時のスティック（8方向、向きなし＝上） */
function haneDir(p){
  const h = horiz(p), v = (p.inp.U ? 1 : 0) - (p.inp.D ? 1 : 0);
  if (!h && !v) return null;
  const n = h && v ? 707 : 1000; return [h * n, v * n];
}
Sim.prototype.haneMove = function(p, m){
  const f = p.mvf, a = m.s, b = a + HANE.d1, c = b + HANE.gap, e = m.s + m.a;
  const go = () => { p.vx = Math.trunc(p.hdx * HANE.sp / 1000); p.vy = Math.trunc(p.hdy * HANE.sp / 1000);
    if (p.ground && p.hdy > 0) { p.ground = false; p.plat = -1; } if (p.ground) p.vy = 0; else p.vy += PH.grav; p.ff = false; };
  const nd = haneDir(p);
  if (f < a) { p.vx = toward(p.vx, 0, 200); if (!p.ground) p.vy = PH.grav; if (nd) p.hq = nd; }          // 構え: 宙に止まる。向きは構えの間に入れた最後のもの
  if (f === a) { const d = nd || p.hq || [0, 1000]; p.hq = null; p.hdx = d[0]; p.hdy = d[1]; if (d[0]) p.face = sgn(d[0]); this.ev.push({ t: 'hane', p: p.i, n: 1 }); }
  if (f >= a && f < b) go();
  else if (f >= c && f < e) go();
  if (f >= c - HANE.win && f < c && nd) p.hq = nd;                                      // 二度目の向きの受付
  if (f >= b && f < c) { p.vx = 0; p.vy = p.ground ? 0 : PH.grav;                // 間: 止まって次の向きを待つ
    if (f === c - 1) { const d = p.hq; p.hq = null; if (!d) { p.mvf = e; p.vy = 0; }          // 向きを入れていなければ一度で終わり
      else { p.hdx = d[0]; p.hdy = d[1]; if (d[0]) p.face = sgn(d[0]); p.hane2 = true; p.hitDone = false; p.treeHit = false; this.ev.push({ t: 'hane', p: p.i, n: 2 }); } } }
  else if (f === e) { p.vx = Math.trunc(p.vx / 3); p.vy = p.ground ? 0 : Math.min(p.vy, 400); }
};
/* 食甚: 自分と相手を結ぶ線の上を斬り抜けて、相手の向こう側へ出る（どこにいても届く） */
Sim.prototype.shokujin = function(p, o){
  const x0 = p.x, y0 = p.y, tx = o.x, ty = o.y;
  let dx = tx - x0, dy = ty - y0; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
  if (L < FP) { dx = p.face; dy = 0; }
  let nx = tx + Math.trunc(dx * 110 * FP), ny = ty + Math.trunc(dy * 110 * FP);
  nx = Math.min(WALL_R, Math.max(WALL_L, nx)); if (ny <= 0) { ny = 0; }
  p.x = nx; p.y = ny; p.vx = Math.trunc(dx * 600); p.vy = ny > 0 ? Math.trunc(dy * 400) : 0;
  if (ny > 0) { p.ground = false; p.plat = -1; } else { p.ground = true; p.plat = -1; p.vy = 0; }
  if (o.x !== p.x) p.face = sgn(o.x - p.x);
  p.sjHit = true;
  this.ev.push({ t: 'sj', p: p.i, x0, y0, x1: nx, y1: ny });
};
Sim.prototype.spawnShot = function(p){
  p.pjCut = false;
  this.pj.push({ o: p.i, x: Math.min(WALL_R, Math.max(WALL_L, p.x + p.face * SHOT.ox * FP)), y: p.y + SHOT.oy * FP, vx: p.face * SHOT.speed, life: SHOT.life });
  this.ev.push({ t: 'shot', p: p.i });
};
/* 花嵐: 普通は一枚。開花で速く、満開で三枚・大きく（まとめて一回当たる）、落花で五枚に散って一枚ずつ当たる */
Sim.prototype.spawnPetals = function(p){
  p.pjCut = false;
  const b = p.boost, x = Math.min(WALL_R, Math.max(WALL_L, p.x + p.face * SHOT.ox * FP)), y = p.y + SHOT.oy * FP;
  this.pjN = (this.pjN || 0) + 1;
  // 置き技（2026-11-26）: 弾の速さは前の slow 倍。大きさと威力の増え方は前と同じ速さ（前の速さで飛んだとした距離で決める）
    const add = (dy, vy, sp, w, mv, gid) => this.pj.push({ o: p.i, x, y: y + dy * FP, vx: Math.trunc(p.face * sp * PETAL.slow), vy: Math.trunc(vy * PETAL.slow), eq: sp, life: PETAL.life, w, h: w, w0: w, x0: x, dm: 100, mv, gid, petal: 1, hana: 1, b2: b === 2 ? 1 : 0 });
  if (b === 3) { const V = [-960, -640, -320, 0, 320, 640, 960]; V.forEach((v, k) => add(0, v, 1150, 86, 'petalS', this.pjN * 8 + k)); } // 落花: 散る角度は最初の3倍、七枚
  else if (b === 2) { for (const dy of [-60, 0, 60]) add(dy, 0, 1300, 108, 'petal', this.pjN * 8); }
  else add(0, 0, b === 1 ? 1350 : 800, PETAL.w, 'petal', this.pjN * 8);
  this.ev.push({ t: 'shot', p: p.i, petal: b });
};
/* 落花の天桜の着地: 前後へ三波ずつ、地を這う花びら。一枚ずつ当たる（多段） */
Sim.prototype.fallBurst = function(p){
  this.pjN = (this.pjN || 0) + 1;
  let k = 0;
  for (const d of [1, -1]) for (const sp of [650, 950, 1250]) this.pj.push({ o: p.i, x: p.x, y: p.y + 34 * FP, vx: d * sp, vy: 0, life: 32, w: 90, h: 70, mv: 'petalG', gid: this.pjN * 8 + (k++), petal: 1, ground: 1 });
  this.ev.push({ t: 'fallBurst', p: p.i, x: p.x, y: p.y });
};
/* 植樹: 足元に植えて開花。自分では抜けず、相手に折られるまで次の木は植えられない。
   木は相手に攻撃を当てるほど育つ（2026-11-26）: 7回当てるごとに 開花→満開→落花。満開の間は、強化した天桜・花嵐を2回当てると一気に落花 */
const GROW = { per: 7, big: 2 };
Sim.prototype.plant = function(p){
  const t = p.tree;
  if (t) return;
  let gy = 0; if (p.ground) gy = p.y; else for (const pl of PLATS) if (p.x >= pl.x0 && p.x <= pl.x1 && p.y >= pl.y && pl.y > gy) gy = pl.y;
  p.tree = { x: p.x, y: gy, hp: TREE.hp, stage: 1, u1: false, u2: false, n: 0, big: 0 };
  this.ev.push({ t: 'bloom', p: p.i, stage: 1, x: p.tree.x, y: p.tree.y });
};
Sim.prototype.grow = function(a, m, pj){
  const t = a.tree; if (!t || t.stage >= 3) return;
  if (t.stage === 2 && (m.id === 'tenM' || (pj && pj.b2)) && ++t.big >= GROW.big) return this.stageUp(a);
  if (++t.n >= GROW.per) this.stageUp(a);
};
Sim.prototype.stageUp = function(p){
  const t = p.tree; t.stage++; t.n = 0; t.big = 0; t.u1 = t.u2 = false;
  this.ev.push({ t: 'bloom', p: p.i, stage: t.stage, x: t.x, y: t.y });
};
function treeBox(t){ const b = TREE.box[t.stage]; return [t.x + b[0] * FP, t.y + b[1] * FP, t.x + (b[0] + b[2]) * FP, t.y + (b[1] + b[3]) * FP]; }
/* 相手の木を斬る（技ごとに一回） */
Sim.prototype.hitTree = function(a, d, dmg, x, y){
  const t = d.tree; t.hp -= dmg;
  if (t.hp <= 0) { d.tree = null; this.ev.push({ t: 'treeBreak', p: d.i, by: a.i, x: t.x, y: t.y }); }
  else this.ev.push({ t: 'treeHit', p: d.i, by: a.i, x, y, hp: t.hp });
};
const inCounter = d => d.st === 'atk' && MV[d.mv].counter && d.mvf >= MV[d.mv].s && d.mvf < MV[d.mv].s + MV[d.mv].a;
Sim.prototype.triggerCounter = function(d, a){
  if (a.x !== d.x) d.face = sgn(a.x - d.x);
  this.startMove(d, 'ctrHit');
  this.hitstop = 12;
  this.ev.push({ t: 'counter', p: d.i, by: a.i, x: d.x, y: d.y + 60 * FP });
};
Sim.prototype.moveShots = function(){
  const P = this.p;
  for (const q of this.pj) { q.x += q.vx; q.y += q.vy || 0; q.life--;
    if (q.hana) { const k = (PETAL.life - q.life) * q.eq / FP | 0; q.w = q.h = Math.min(q.w0 * PETAL.maxW, q.w0 + Math.floor(q.w0 * k / PETAL.grow)); q.dm = Math.min(PETAL.maxDm, 100 + Math.floor(k * 100 / PETAL.dmgPer)); }
    if (q.petal && q.y < 12 * FP) { q.y = 12 * FP; q.vy = 0; } if (q.y < 0 || q.y > 900 * FP) q.life = 0; else if (q.x < WALL_L || q.x > WALL_R) { q.x = q.x < WALL_L ? WALL_L : WALL_R; q.out = 1; } } // 花びらは地面に着くと地を這う。竹林の端に着いたら、そこで当たりを見てから消える（端の相手にも当たる）
  // 斬撃どうしは相殺
  for (let i = 0; i < this.pj.length; i++) for (let j = i + 1; j < this.pj.length; j++) {
    const a = this.pj[i], b = this.pj[j];
    if (a.o !== b.o && a.life > 0 && b.life > 0 && Math.abs(a.x - b.x) < ((a.w || SHOT.w) + (b.w || SHOT.w)) / 2 * FP && Math.abs(a.y - b.y) < ((a.h || SHOT.h) + (b.h || SHOT.h)) / 2 * FP) { a.life = b.life = 0; this.ev.push({ t: 'clash', x: a.x, y: a.y }); }
  }
  for (const q of this.pj) {
    if (q.life <= 0) continue;
    const d = P[1 - q.o], a = P[q.o], w = q.w || SHOT.w, h = q.h || SHOT.h;
    const bx = [q.x - w * FP / 2, q.y - h * FP / 2, q.x + w * FP / 2, q.y + h * FP / 2];
    const kill = () => { for (const r of this.pj) if (r === q || (q.gid != null && r.gid === q.gid)) r.life = 0; };
    if (d.tree && overlap(bx, treeBox(d.tree))) { kill(); this.hitTree(a, d, Math.floor(MV[q.mv || 'shotP'].dmg * (q.dm || 100) / 100), q.x, q.y); continue; }
    if (invuln(d)) continue;
    if (!overlap(bx, hbox(d))) continue;
    kill();
    if (inCounter(d)) { this.triggerCounter(d, a); continue; }
    // 花嵐・飛ぶ斬撃: 撃った側の硬直が12F以上残っているうちに当たったら（ガードでも）、残りの硬直を2F減らす（一つの技で一度）
    if (a.st === 'atk' && (a.mv === 'hana' || a.mv === 'shot') && !a.pjCut && MV[a.mv].total - a.mvf >= 12) { a.mvf += 2; a.pjCut = true; }
    this.applyHit(a, d, MV[q.mv || 'shotP'], { a: a.i, dst: d.st, dmv: d.mv, dmvf: d.mvf, dground: d.ground }, q);
  }
  this.pj = this.pj.filter(q => q.life > 0 && !q.out);
};
Sim.prototype.hits = function(){
  const P = this.p;
  const todo = [];
  for (const a of P) {
    if (a.st !== 'atk' || a.hitDone) continue;
    const m = MV[a.mv];
    if (m.sj && a.sjHit) { a.sjHit = false; const d = P[1 - a.i]; if (!invuln(d)) todo.push([a, d, m]); continue; } // 食甚は線の上にいれば当たる
    if (m.noBox || a.mvf < m.s || a.mvf >= m.s + m.a) continue;
    if (m.hane && a.mvf >= m.s + HANE.d1 && a.mvf < m.s + HANE.d1 + HANE.gap) continue; // 羽跳の間は当たらない
    const d = P[1 - a.i], ab = box(a, curBox(a));
    if (d.tree && !a.treeHit && !m.grab && overlap(ab, treeBox(d.tree))) { a.treeHit = true; this.hitTree(a, d, m.dmg, Math.trunc((ab[0] + ab[2]) / 2), Math.trunc((ab[1] + ab[3]) / 2)); }
    if (invuln(d)) continue;
    if (!overlap(ab, hbox(d))) continue;
    if (inCounter(d) && !m.grab && !m.iai) { a.hitDone = true; this.triggerCounter(d, a); continue; }
    if (m.hane) { const two = a.hane2 && a.haneN > 0; a.haneN++;
      if (two) { a.sjOK = true; todo.push([a, d, Object.assign({}, MV.haneX, { hs: Math.max(1, MV.hane.s + MV.hane.a - a.mvf + MV.shokujin.s + SJ.K + SJ.tight) })]); } // 二度当て: 最速の食甚がちょうど当たる硬直
      else todo.push([a, d, m]); continue; } // 二度とも当てたら大きい硬直
    todo.push([a, d, m]);
  }
  // 相打ちも両方当てる（同じFに決めるので順番に依らない）
  const snap = todo.map(([a, d]) => ({ a: a.i, dst: d.st, dmv: d.mv, dmvf: d.mvf, dground: d.ground }));
  todo.forEach(([a, d, m], k) => { a.hitDone = true; this.applyHit(a, d, m, snap[k]); });
};

Sim.prototype.applyHit = function(a, d, m, s, pj){
  const ev = this.ev;
  const dir = pj ? sgn(pj.vx) : (sgn(d.x - a.x) || a.face);
  const mvRem = pj ? null : m.total - a.mvf;
  // 持続の早いうちに当てても、持続の終わりに当てたのと同じ硬直差になるよう、相手の硬直を延ばす（残りの持続のぶん）
  const late = (pj || m.plunge || m.noLate) ? 0 : Math.max(0, m.s + m.a - 1 - a.mvf);
  const pw = a.power || 0;
  let dmgBase = Array.isArray(m.dmg) ? m.dmg[0] + Math.floor((m.dmg[1] - m.dmg[0]) * pw / 100) : m.dmg;
  if (pj && pj.dm) dmgBase = Math.floor(dmgBase * pj.dm / 100); // 花嵐: 遠くまで飛ぶほど重い
  if (a.tree && a.tree.stage === 3) dmgBase = Math.floor(dmgBase * 14 / 10); // 落花: 与えるダメージ1.4倍
  const gdBase = Array.isArray(m.gd) ? m.gd[0] + Math.floor((m.gd[1] - m.gd[0]) * pw / 100) : m.gd;
  const guarding = (s.dst === 'guard' || s.dst === 'bstun' || s.dst === 'unguard') && s.dground;
  const hx = pj ? pj.x : Math.trunc((a.x + d.x) / 2), hy = d.y + 60 * FP;

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
      d.st = 'bstun'; d.hs = m.bs + late; d.vx = dir * 520;
      this.hitstop = m.dmg >= 700 || Array.isArray(m.dmg) ? 7 : 4;
      ev.push({ t: 'block', p: d.i, by: a.i, x: hx, y: hy, mv: m.id, adv: mvRem == null ? null : m.bs + late - mvRem, gd: gdBase, shot: !!pj });
      return;
    }
  }
  // ここから当たり
  if (this.sd) { d.hp = Math.max(0, d.hp - dmgBase); this.finish(a, d, 'sd', m, s); return; }
  const inStun = s.dst === 'hit' || s.dst === 'tumble' || s.dst === 'stun' || s.dst === 'down';
  const inf = this.opts.training && d.i === 1; // 稽古の相手は体力無限（倒れない）
  if (s.dst === 'stun' && m.iai && !inf) { this.finish(a, d, 'iai', m, s); return; }
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
  this.grow(a, m, pj);
  const kbs = 100 + Math.floor((HP_MAX - d.hp) / 200);
  if (s.dst === 'stun') {
    d.vx = dir * Math.floor(m.kb[0] * kbs / 200);
    ev.push({ t: 'hit', p: d.i, by: a.i, x: hx, y: hy, mv: m.id, dmg, combo: a.combo, adv: null, stun: true });
  } else {
    let kx = Math.floor(m.kb[0] * kbs / 100), ky = Math.floor(m.kb[1] * kbs / 100);
    d.mv = null; d.chargeF = 0;
    if (m.flinch) {
      d.st = 'hit'; d.vx = dir * kx; if (!d.ground) d.vy = Math.min(d.vy, 0); d.ff = false;
    } else if (ky > 0 || !d.ground) {
      d.st = 'tumble'; d.ground = false; d.plat = -1; d.vx = dir * kx; d.vy = ky > 0 ? ky : m.kb[1] < 0 ? ky : Math.max(300, d.vy); d.ff = false;
      if (d.y === 0 && d.vy < 0) { d.vy = 0; }
      d.kd = m.kd === 1 || m.kd === true;
    } else if (m.kb[1] < 0) { // 地上の相手に叩きつけ
      d.st = 'tumble'; d.ground = false; d.plat = -1; d.vy = 500; d.vx = dir * 200; d.kd = true;
    } else { d.st = 'hit'; d.vx = dir * kx; }
    d.hs = m.hs + late; d.s1Used = false; d.nokd = m.kd === 0; d.dfall = !!m.dfall && d.st === 'tumble'; if (d.st === 'tumble') d.jumps = 1;
    const adv = (d.st === 'hit' && mvRem != null) ? m.hs + late - mvRem : null;
    ev.push({ t: 'hit', p: d.i, by: a.i, x: hx, y: hy, mv: m.id, dmg, combo: a.combo, adv, counter: a.combo === 1 && a.comboFirst.counter });
  }
  this.hitstop = dmg >= 700 ? 8 : 4;
  if (d.hp <= 0) { if (inf) d.hp = HP_MAX; else this.finish(a, d, 'ko', m, s); }
};

/* 一本。決着名を決める */
Sim.prototype.finish = function(w, l, how, m, s){
  const tw = this.opts.toWin || C.toWin;
  const bothLast = tw > 1 && this.wins[0] === tw - 1 && this.wins[1] === tw - 1; // 一本勝負では「後なし」はない
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
  if (w.kit === 'ouka' && (FIN[name].tier === '並' || FIN[name].tier === '上')) name = '散華'; // 絶の刀で勝つと専用の決着名
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
      if (inp.C) p.cb = { d: inp.C, n: C.buf + 1 }, p.buf.A = C.buf + 1;
      if (inp.K) p.wk = { d: inp.K, n: C.buf + 1 }, p.buf.A = C.buf + 1;
      if (inp.S && !p.inp.S) p.spB = C.buf + 1;
      p.inp = Object.assign({}, p.inp, { A: inp.A, J: inp.J, G: inp.G, S: inp.S });
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
  this.moveShots();
  this.hits();
  // 技の終わり
  for (const p of P) {
    if (p.st !== 'atk') continue;
    const m = MV[p.mv];
    if (m.chain && p.chainReq && p.mvf >= m.s + m.a - 1) { this.startMove(p, m.chain); continue; }
    if (m.next && p.mvf >= m.total) { this.startMove(p, m.next); continue; }
    if (p.mvf >= m.total) {
      p.st = p.ground ? 'idle' : m.after === 'fall' ? 'fall' : 'air'; p.mv = null; p.power = 0;
    }
  }
  if (this.over) return;
  if (this.opts.training) return; // 稽古は時間切れなし
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
  mix(this.frame); mix(this.hitstop); for (const q of this.pj) { mix(q.x); mix(q.y); mix(q.life); }
  for (const p of this.p) { if (p.tree) { mix(p.tree.x); mix(p.tree.hp); mix(p.tree.stage); mix(p.tree.n); mix(p.tree.big); } mix(p.x); mix(p.y); mix(p.vx); mix(p.vy); mix(p.hp); mix(p.gd); mix(p.stun); mix(p.mvf); mix(p.f); mix(p.hs); mix(p.st.length * 31 + p.st.charCodeAt(0)); }
  return h;
};

const API = { ECL, ECLN, SHOKI, FUKU, SJ, HANE, GROW, curBox, treeBox, TREE, PETAL, Sim, MV, FIN, KIT, DG, SHOT, C, PH, FP, PLATS, WALL_L, WALL_R, HP_MAX, GD_MAX, SMASH_MIN, SMASH_MAX, NOIN, invuln, hurt, box };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else root.IssenAction = API;
})(typeof window !== 'undefined' ? window : globalThis);
