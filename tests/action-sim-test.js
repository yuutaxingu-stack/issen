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
console.log(fail ? fail + ' 件失敗' : 'すべて成功'); process.exit(fail ? 1 : 0);
