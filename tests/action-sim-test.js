// 対戦アクションの計算のテスト: node tests/action-sim-test.js
const A = require('../js/action/sim.js');
let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log('NG', msg); } else console.log('ok', msg); };
const I = o => Object.assign({}, A.NOIN, o || {});
function sim(dist){ const s = new A.Sim({ training: true }); s.p[0].x = 600 * A.FP; s.p[1].x = (600 + dist) * A.FP; return s; }
function run(s, n, f0, f1){ for (let k = 0; k < n; k++) s.step([f0 ? f0(k, s) : I(), f1 ? f1(k, s) : I()]); }
function drain(s){ const e = s.ev; s.ev = []; return e; }

// 1) 弱斬り一段目: ヒットで+6、ガードで-2
{ const s = sim(60); run(s, 1, () => I({ A: 1 })); run(s, 30); const h = drain(s).find(e => e.t === 'hit'); ok(h && h.adv === 6, '弱斬りヒット +6F (' + (h && h.adv) + ')'); }
{ const s = sim(60); run(s, 2, null, () => I({ G: 1 })); run(s, 1, () => I({ A: 1 }), () => I({ G: 1 })); run(s, 30, null, () => I({ G: 1 })); const h = drain(s).find(e => e.t === 'block'); ok(h && h.adv === -2, '弱斬りガード -2F (' + (h && h.adv) + ')'); }
// 2) 実際の有利Fを動かして確かめる: 当てた側と当てられた側が何F目に動けるか
{ const s = sim(60); let a0 = null, a1 = null;
  run(s, 1, () => I({ A: 1 }));
  let hit = false;
  for (let k = 2; k < 60; k++) { s.step([I(), I()]); if (drain(s).some(e => e.t === 'hit')) hit = true; if (!hit) continue; if (a0 == null && ['idle', 'walk'].includes(s.p[0].st) && s.hitstop === 0) a0 = s.frame; if (a1 == null && s.p[1].st === 'idle' && s.hitstop === 0) a1 = s.frame; }
  ok(a1 - a0 === 6, '動けるようになる差 = 6F (' + (a1 - a0) + ')'); }
// 3) 全体フレーム: 弱斬りは17F
{ const s = sim(400); run(s, 1, () => I({ A: 1 })); let n = 1; while (s.p[0].st === 'atk') { s.step([I(), I()]); n++; } ok(n === 17 && A.MV.jab1.total === 17, '弱斬り 全体17F（18F目に動ける） n=' + n); }
// 4) ガードを削りきると気絶、守が居合になって一本
{ const s = sim(60); s.p[1].gd = 500; run(s, 2, null, () => I({ G: 1 })); run(s, 1, () => I({ A: 1 }), () => I({ G: 1 })); run(s, 30, null, () => I({ G: 1 }));
  ok(s.p[1].st === 'stun', 'ガードが割れて気絶');
  run(s, 1, () => I({ G: 1 })); run(s, 40); ok(s.result && s.result.how === 'iai', '気絶中の居合で一本 ' + (s.result && s.result.name)); }
// 5) 連撃で体力を削りきる
{ const s = sim(60); s.p[1].hp = 200; let k = 0; run(s, 1, () => I({ A: 1 })); run(s, 30); ok(s.result && s.result.how === 'ko', '体力0で斬り伏せ ' + (s.result && s.result.name)); }
// 6) 弱斬りの連撃が三段まで出る
{ const s = sim(60); const seen = new Set(); for (let k = 0; k < 80; k++) { s.step([I({ A: (k % 6) < 2 }), I()]); if (s.p[0].mv) seen.add(s.p[0].mv); } ok(seen.has('jab2') && seen.has('jab3'), '弱斬り三段 ' + [...seen].join(',')); }
// 7) 跳ぶ・二段跳び・着地
{ const s = sim(400); run(s, 1, () => I({ J: 1 })); run(s, 10, () => I({ J: 1 })); const y1 = s.p[0].y; run(s, 1); run(s, 1, () => I({ J: 1 })); run(s, 120); ok(y1 > 0 && s.p[0].ground && s.p[0].st === 'idle', '跳んで着地'); }
// 8) 同じ操作なら同じ結果
{ const R = (seed) => { let x = seed; return () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; };
  const play = () => { const s = new A.Sim(); const r = R(7); for (let k = 0; k < 3000; k++) { const g = () => I({ L: r() < .2, R: r() < .3, U: r() < .1, D: r() < .1, A: r() < .25, J: r() < .08, G: r() < .15 }); s.step([g(), g()]); if (s.over) s.resetRound(); } return s.hash(); };
  ok(play() === play(), '同じ操作で同じ盤面（ずれない）'); }
// 9) 時間切れでサドンデス、一発で刹那
{ const s = sim(60); s.frame = A.C.roundF - 1; run(s, 2); ok(s.sd, 'サドンデスに入る'); run(s, 1, () => I({ A: 1 })); run(s, 20); ok(s.result && s.result.name === '刹那', 'サドンデスは一発で刹那'); }
// 10) 素早く倒すとダッシュ、歩きより速い
{ const s = sim(600); run(s, 1, () => I({ R: 1, F: 1 })); ok(s.p[0].st === 'dash', 'ダッシュに入る'); const x0 = s.p[0].x; run(s, 10, () => I({ R: 1 })); ok(s.p[0].x - x0 === 10 * A.PH.dash, 'ダッシュの速さ'); run(s, 1); ok(s.p[0].st === 'idle', '離すと止まる'); }
// 11) 相手の後ろに回っても自動で振り向かない
{ const s = sim(60); s.p[0].x = 900 * A.FP; s.p[1].x = 700 * A.FP; run(s, 5); ok(s.p[0].face === 1, '自動で振り向かない'); run(s, 2, () => I({ L: 1 })); ok(s.p[0].face === -1, '歩いた方を向く'); }
// 12) 急降下しながら前に倒して斬ると空前（斜め下でも空下にならない）
{ const s = sim(600); run(s, 1, () => I({ J: 1 })); run(s, 30); run(s, 1, () => I({ D: 1 })); ok(s.p[0].ff, '急降下'); run(s, 1, () => I({ D: 1, R: 1, C: 'r' })); ok(s.p[0].mv === 'fair', '急降下中に攻撃スティックで空前 (' + s.p[0].mv + ')'); }
// 13) スティックで強く下に倒していれば空下
{ const s = sim(600); run(s, 1, () => I({ J: 1 })); run(s, 30); run(s, 1, () => I({ D: 1, R: 1, A: 1, V: 'd' })); ok(s.p[0].mv === 'plunge', '空中で下＋斬は特殊技3（落とし）'); }
// 14) 空後は空前より発生が早い、空上は空前と同じくらい
ok(A.MV.bair.s < A.MV.fair.s && A.MV.bair.dmg > A.MV.fair.dmg && Math.abs(A.MV.uair.s - A.MV.fair.s) <= 1, '空中技の性格');
// 15) 攻撃スティック: 空中で後ろに弾くと空後（向きは変わらない）、地上で上に弾くと上斬り
{ const s = sim(600); run(s, 1, () => I({ J: 1 })); run(s, 20); run(s, 1, () => I({ C: 'l' })); ok(s.p[0].mv === 'bair' && s.p[0].face === 1, '攻撃スティックで空後'); }
{ const s = sim(600); run(s, 1, () => I({ C: 'u' })); ok(s.p[0].mv === 'utilt', '攻撃スティックで上斬り'); }
{ const s = sim(600); run(s, 1, () => I({ C: 'l' })); ok(s.p[0].mv === 'ftilt' && s.p[0].face === -1, '攻撃スティックで横斬り（弾いた向きへ）'); }
// 16) 斬ボタン: なし＝三段、横・上・下＝特殊技1〜3
{ const t = (inp, mv) => { const s = sim(600); run(s, 1, () => I(inp)); ok(s.p[0].mv === mv, '斬 ' + JSON.stringify(inp) + ' → ' + mv + ' (' + s.p[0].mv + ')'); };
  t({ A: 1 }, 'jab1'); t({ A: 1, R: 1 }, 'side'); t({ A: 1, U: 1 }, 'rise'); t({ A: 1, D: 1 }, 'sweep'); }
// 17) 回避の無敵と全体F（ユーザーの表）
{ const meas = (setup) => { const s = sim(600); setup(s); const inv = []; let n = 0; while ((s.p[0].st === 'roll' || s.p[0].st === 'adodge') && n < 200) { n++; if (A.invuln(s.p[0])) inv.push(s.p[0].f); s.step([I(), I()]); } return { first: inv[0], last: inv[inv.length - 1], total: n + 1 }; }; // 押したFを1F目と数える
  const g = (inp) => (s) => { run(s, 1, () => I({ G: 1 })); s.step([I(Object.assign({ G: 1 }, inp)), I()]); };
  const sp = meas(g({ D: 1 })), fw = meas(g({ R: 1 })), bk = meas(g({ L: 1 }));
  ok(sp.first === 3 && sp.last === 17 && sp.total === 25, 'その場回避 3〜17 全体25 ' + JSON.stringify(sp));
  ok(fw.first === 4 && fw.last === 15 && fw.total === 29, '前方回避 4〜15 全体29 ' + JSON.stringify(fw));
  ok(bk.first === 5 && bk.last === 16 && bk.total === 34, '後方回避 5〜16 全体34 ' + JSON.stringify(bk));
  const air = (inp) => (s) => { s.p[0].y = 600 * A.FP; s.p[0].ground = false; s.p[0].st = 'air'; s.p[0].vy = 1500; s.step([I(Object.assign({ G: 1 }, inp)), I()]); };
  const an = meas(air({})), ad = meas(air({ R: 1 }));
  ok(an.first === 3 && an.last === 28 && an.total === 44, '空中回避 3〜28 全体44 ' + JSON.stringify(an));
  ok(ad.first === 3 && ad.last === 22 && ad.total === 60, '方向空中回避 3〜22 全体60 ' + JSON.stringify(ad)); }
// 18) 昇り斬りの後は無防備に落ちて、着地硬直20F
{ const s = sim(600); run(s, 1, () => I({ A: 1, U: 1 })); let st = new Set(); for (let k = 0; k < 200 && !(s.p[0].st === 'idle' && s.p[0].ground); k++) { s.step([I({ J: k % 2 }), I()]); st.add(s.p[0].st); } ok(st.has('fall') && st.has('land'), '昇り斬り→無防備落下→着地 ' + [...st]); }
// 19) ダッシュ中に守で前方回避、前方回避の後は振り返る
{ const s = sim(600); run(s, 1, () => I({ R: 1, F: 1 })); run(s, 3, () => I({ R: 1 })); run(s, 1, () => I({ R: 1, G: 1 })); ok(s.p[0].st === 'roll' && s.p[0].rk === 'fwd', 'ダッシュ中の守は前方回避'); run(s, 40); ok(s.p[0].face === -1, '前方回避の後は反対を向く'); }
console.log(fail ? fail + ' 件失敗' : 'すべて成功'); process.exit(fail ? 1 : 0);
