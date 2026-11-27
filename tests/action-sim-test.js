// 対戦アクションの計算のテスト: node tests/action-sim-test.js
const A = require('../js/action/sim.js');
let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log('NG', msg); } else console.log('ok', msg); };
const I = o => Object.assign({}, A.NOIN, o || {});
function sim(dist){ const s = new A.Sim({ training: true }); s.p[0].x = 600 * A.FP; s.p[1].x = (600 + dist) * A.FP; return s; }
function simM(dist){ const s = new A.Sim({ toWin: 2 }); s.p[0].x = 600 * A.FP; s.p[1].x = (600 + dist) * A.FP; return s; } // 倒れる立ち合い（稽古の相手は体力無限）
function run(s, n, f0, f1){ for (let k = 0; k < n; k++) s.step([f0 ? f0(k, s) : I(), f1 ? f1(k, s) : I()]); }
function drain(s){ const e = s.ev; s.ev = []; return e; }

// 1) 弱斬り一段目: ヒットで+6、ガードで-2
{ const s = sim(60); run(s, 1, () => I({ A: 1 })); run(s, 30); const h = drain(s).find(e => e.t === 'hit'); ok(h && h.adv === 8, '弱斬りヒット +8F（持続の1F目に当てても終わりと同じ） (' + (h && h.adv) + ')'); }
{ const s = sim(60); run(s, 2, null, () => I({ G: 1 })); run(s, 1, () => I({ A: 1 }), () => I({ G: 1 })); run(s, 30, null, () => I({ G: 1 })); const h = drain(s).find(e => e.t === 'block'); ok(h && h.adv === 0, '弱斬りガード ±0F（持続の1F目でも終わりと同じ） (' + (h && h.adv) + ')'); }
// 2) 実際の有利Fを動かして確かめる: 当てた側と当てられた側が何F目に動けるか
{ const s = sim(60); let a0 = null, a1 = null;
  run(s, 1, () => I({ A: 1 }));
  let hit = false;
  for (let k = 2; k < 60; k++) { s.step([I(), I()]); if (drain(s).some(e => e.t === 'hit')) hit = true; if (!hit) continue; if (a0 == null && ['idle', 'walk'].includes(s.p[0].st) && s.hitstop === 0) a0 = s.frame; if (a1 == null && s.p[1].st === 'idle' && s.hitstop === 0) a1 = s.frame; }
  ok(a1 - a0 === 8, '動けるようになる差 = 8F (' + (a1 - a0) + ')'); }
// 3) 全体フレーム: 弱斬りは17F
{ const s = sim(400); run(s, 1, () => I({ A: 1 })); let n = 1; while (s.p[0].st === 'atk') { s.step([I(), I()]); n++; } ok(n === 17 && A.MV.jab1.total === 17, '弱斬り 全体17F（18F目に動ける） n=' + n); }
// 4) ガードを削りきると気絶、守が居合になって一本
{ const s = simM(60); s.p[1].gd = 500; run(s, 2, null, () => I({ G: 1 })); run(s, 1, () => I({ A: 1 }), () => I({ G: 1 })); run(s, 30, null, () => I({ G: 1 }));
  ok(s.p[1].st === 'stun', 'ガードが割れて気絶');
  run(s, 1, () => I({ G: 1 })); run(s, 40); ok(s.result && s.result.how === 'iai', '気絶中の居合で一本 ' + (s.result && s.result.name)); }
// 5) 連撃で体力を削りきる
{ const s = simM(60); s.p[1].hp = 200; let k = 0; run(s, 1, () => I({ A: 1 })); run(s, 30); ok(s.result && s.result.how === 'ko', '体力0で斬り伏せ ' + (s.result && s.result.name)); }
// 6) 弱斬りの連撃が三段まで出る
{ const s = sim(60); const seen = new Set(); for (let k = 0; k < 80; k++) { s.step([I({ A: (k % 6) < 2 }), I()]); if (s.p[0].mv) seen.add(s.p[0].mv); } ok(seen.has('jab2') && seen.has('jab3'), '弱斬り三段 ' + [...seen].join(',')); }
// 7) 跳ぶ・二段跳び・着地
{ const s = sim(400); run(s, 1, () => I({ J: 1 })); run(s, 10, () => I({ J: 1 })); const y1 = s.p[0].y; run(s, 1); run(s, 1, () => I({ J: 1 })); run(s, 120); ok(y1 > 0 && s.p[0].ground && s.p[0].st === 'idle', '跳んで着地'); }
// 8) 同じ操作なら同じ結果
{ const R = (seed) => { let x = seed; return () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; };
  const play = () => { const s = new A.Sim(); const r = R(7); for (let k = 0; k < 3000; k++) { const g = () => I({ L: r() < .2, R: r() < .3, U: r() < .1, D: r() < .1, A: r() < .25, J: r() < .08, G: r() < .15 }); s.step([g(), g()]); if (s.over) s.resetRound(); } return s.hash(); };
  ok(play() === play(), '同じ操作で同じ盤面（ずれない）'); }
// 9) 時間切れでサドンデス、一発で刹那
{ const s = new A.Sim({ toWin: 2 }); s.p[0].x = 600 * A.FP; s.p[1].x = 660 * A.FP; s.frame = A.C.roundF - 1; run(s, 2); ok(s.sd, 'サドンデスに入る'); run(s, 1, () => I({ A: 1 })); run(s, 20); ok(s.result && s.result.name === '刹那', 'サドンデスは一発で刹那'); }
// 10) 素早く倒すとダッシュ、歩きより速い
{ const s = sim(600); run(s, 1, () => I({ R: 1, F: 1 })); ok(s.p[0].st === 'dash', 'ダッシュに入る'); const x0 = s.p[0].x; run(s, 10, () => I({ R: 1 })); ok(s.p[0].x - x0 === 10 * A.PH.dash, 'ダッシュの速さ'); run(s, 1); ok(s.p[0].st === 'idle', '離すと止まる'); }
// 11) 相手の後ろに回っても自動で振り向かない
{ const s = sim(60); s.p[0].x = 900 * A.FP; s.p[1].x = 700 * A.FP; run(s, 5); ok(s.p[0].face === 1, '自動で振り向かない'); run(s, 2, () => I({ L: 1 })); ok(s.p[0].face === -1, '歩いた方を向く'); }
// 12) 急降下しながら前に倒して斬ると空前（斜め下でも空下にならない）
{ const s = sim(600); run(s, 1, () => I({ J: 1 })); run(s, 30); run(s, 1, () => I({ D: 1 })); ok(s.p[0].ff, '急降下'); run(s, 1, () => I({ D: 1, R: 1, C: 'r' })); ok(s.p[0].mv === 'fair', '急降下中に攻撃スティックで空前 (' + s.p[0].mv + ')'); }
// 13) スティックで強く下に倒していれば空下
{ const s = sim(600); run(s, 1, () => I({ J: 1 })); run(s, 30); run(s, 1, () => I({ D: 1, R: 1, A: 1, V: 'd' })); ok(s.p[0].mv === 'counter', '空中で下＋斬は特殊技3（カウンター）'); }
// 14) 空後は空前より発生が早い、空上は空前と同じくらい
ok(A.MV.bair.s < A.MV.fair.s && A.MV.bair.dmg > A.MV.fair.dmg && Math.abs(A.MV.uair.s - A.MV.fair.s) <= 1, '空中技の性格');
// 15) 攻撃スティック: 空中で後ろに弾くと空後（向きは変わらない）、地上で上に弾くと上斬り
{ const s = sim(600); run(s, 1, () => I({ J: 1 })); run(s, 20); run(s, 1, () => I({ C: 'l' })); ok(s.p[0].mv === 'bair' && s.p[0].face === 1, '攻撃スティックで空後'); }
{ const s = sim(600); run(s, 1, () => I({ C: 'u' })); ok(s.p[0].mv === 'utilt', '攻撃スティックで上斬り'); }
{ const s = sim(600); run(s, 1, () => I({ C: 'l' })); ok(s.p[0].mv === 'ftilt' && s.p[0].face === -1, '攻撃スティックで横斬り（弾いた向きへ）'); }
// 16) 斬ボタン: なし＝三段、横・上・下＝特殊技1〜3
{ const t = (inp, mv) => { const s = sim(600); run(s, 1, () => I(inp)); ok(s.p[0].mv === mv, '斬 ' + JSON.stringify(inp) + ' → ' + mv + ' (' + s.p[0].mv + ')'); };
  t({ A: 1 }, 'jab1'); t({ A: 1, R: 1 }, 'shot'); t({ A: 1, U: 1 }, 'rise'); t({ A: 1, D: 1 }, 'counter'); }
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
// 19) ダッシュ中に守で前方回避（設定オン）、前方回避の後は振り返る
{ const s = sim(600); s.p[0].dashRoll = true; run(s, 1, () => I({ R: 1, F: 1 })); run(s, 3, () => I({ R: 1 })); run(s, 1, () => I({ R: 1, G: 1 })); ok(s.p[0].st === 'roll' && s.p[0].rk === 'fwd', 'ダッシュ中の守は前方回避'); run(s, 40); ok(s.p[0].face === -1, '前方回避の後は反対を向く'); }
// 20) 飛ぶ斬撃: 18Fで出て、54F目に動ける。離れた相手に当たる
{ const s = sim(900); run(s, 1, () => I({ A: 1, R: 1 })); let born = 0, n = 1; while (s.p[0].st === 'atk') { if (!born && s.pj.length) born = s.frame; s.step([I(), I()]); n++; } ok(born === 18 && n === 53, '飛ぶ斬撃 発生18F・54F目に動ける (' + born + ',' + (n + 1) + ')');
}
{ const s = sim(350); run(s, 1, () => I({ A: 1, R: 1 })); let hit = false; for (let k = 0; k < 120; k++) { s.step([I(), I()]); if (drain(s).some(e => e.t === 'hit')) hit = true; } ok(hit, '飛ぶ斬撃が離れた相手に当たる'); }
// 21) カウンター: 受付7〜29F、失敗すると69F、受けると反撃（発生4F・全体42F）
{ const s = sim(400); run(s, 1, () => I({ A: 1, D: 1 })); let n = 1; const win = []; while (s.p[0].st === 'atk') { const m = A.MV[s.p[0].mv]; if (s.p[0].mvf >= m.s && s.p[0].mvf < m.s + m.a) win.push(s.p[0].mvf); s.step([I(), I()]); n++; }
  ok(win[0] === 7 && win[win.length - 1] === 29 && n === 69, 'カウンター受付7〜29F・失敗で全体69F (' + win[0] + '-' + win[win.length - 1] + ',' + n + ')'); }
{ const s = sim(60); run(s, 1, null, () => I({ A: 1, D: 1 })); run(s, 7); run(s, 1, () => I({ A: 1 })); run(s, 6); ok(s.p[1].mv === 'ctrHit' || drain(s).some(e => e.t === 'counter'), 'カウンターが取れる'); run(s, 30); ok(s.p[0].hp < A.HP_MAX && s.p[1].hp === A.HP_MAX, '反撃が当たって自分は無傷'); ok(A.MV.ctrHit.total === 42 && A.MV.ctrHit.s === 4, '反撃 発生4F・全体42F'); }
// 22) 走りながら攻撃スティックでダッシュ斬り。飛ぶ斬撃は当たっても少し怯むだけ
{ const s = sim(600); run(s, 1, () => I({ R: 1, F: 1 })); run(s, 3, () => I({ R: 1 })); run(s, 1, () => I({ R: 1, C: 'r' })); ok(s.p[0].mv === 'dashatk', 'ダッシュ斬り'); }
{ const s = sim(250); run(s, 1, () => I({ A: 1, R: 1 })); const sts = new Set(); for (let k = 0; k < 80; k++) { s.step([I(), I()]); sts.add(s.p[1].st); } ok(sts.has('hit') && !sts.has('tumble') && !sts.has('down'), '飛ぶ斬撃は怯むだけ ' + [...sts]); }

// 花嵐: 射程は無限で壁まで、遠いほど大きく重い
{ const ou = d => { const s = new A.Sim({ training: true, kits: ['ouka', 'common'] }); s.p[0].x = 200 * A.FP; s.p[1].x = (200 + d) * A.FP; return s; };
  const dmgAt = d => { const s = ou(d); const h0 = s.p[1].hp; run(s, 1, () => I({ R: 1, A: 1, V: 'h' })); let w = 0; for (let k = 0; k < 900 && s.p[1].hp === h0; k++) { run(s, 1); if (s.pj[0]) w = s.pj[0].w; } return { dmg: h0 - s.p[1].hp, w }; };
  const near = dmgAt(150), far = dmgAt(1250);
  ok(near.dmg > 0 && far.dmg > near.dmg * 2, '花嵐は遠くまで届き、遠いほど重い (' + near.dmg + '→' + far.dmg + ')');
  ok(far.w > near.w * 2, '花嵐は遠いほど広がる (' + near.w + '→' + far.w + ')');
  const s = new A.Sim({ training: true, kits: ['ouka', 'common'] }); s.p[0].x = 200 * A.FP; s.p[1].x = 100 * A.FP;
  run(s, 1, () => I({ R: 1, A: 1, V: 'h' })); let maxX = 0; for (let k = 0; k < 900; k++) { run(s, 1); for (const q of s.pj) maxX = Math.max(maxX, q.x / A.FP); }
  ok(maxX > 1500 && s.pj.length === 0, '花嵐は壁に当たるまで飛ぶ (' + Math.round(maxX) + ')');
}
// 桜華: 下Bで植樹(開花)・自分では抜けない、段階は当てて育てる、強化は段階ごとに一度
{ const ou = d => { const s = new A.Sim({ training: true, kits: ['ouka', 'common'] }); s.p[0].x = 600 * A.FP; s.p[1].x = (600 + d) * A.FP; return s; };
  const down = s => { run(s, 1, () => I({ D: 1, A: 1, V: 'd' })); run(s, 40); };
  const s = ou(900); // 花嵐が遅いので、相手は遠くに置く（当たって止まると次の入力の向きが変わる）
  down(s); ok(s.p[0].tree && s.p[0].tree.stage === 1 && s.p[0].tree.x === 600 * A.FP, '植樹で開花の木');
  const tx = s.p[0].tree.x; run(s, 20, () => I({ R: 1 })); ok(s.p[0].tree.x === tx, '木は動かない');
  run(s, 1, () => I({ R: 1, A: 1, V: "h" })); run(s, 25); ok(s.pj.length === 1 && Math.abs(s.pj[0].vx) === 540, '開花の花嵐は普通より速い');
  run(s, 50); s.pj = []; run(s, 1, () => I({ R: 1, A: 1, V: 'h' })); run(s, 25); ok(s.pj.length === 1 && Math.abs(s.pj[0].vx) === 320, '強化は一度だけ、二度目は普通');
  run(s, 60); s.pj = []; s.stageUp(s.p[0]); ok(s.p[0].tree.stage === 2, '満開');
  s.pj = []; run(s, 1, () => I({ R: 1, A: 1, V: "h" })); run(s, 25); ok(s.pj.length === 3, '満開の花嵐は三枚'); run(s, 60);
  s.pj = []; s.stageUp(s.p[0]); ok(s.p[0].tree.stage === 3, '落花');
  s.pj = []; run(s, 1, () => I({ R: 1, A: 1, V: "h" })); run(s, 25); ok(s.pj.length === 7 && Math.max(...s.pj.map(q => q.vy)) === 384, '落花の花嵐は七枚・散る範囲3倍'); run(s, 60); s.pj = [];
  { const x0 = s.p[0].x; run(s, 10, () => I({ L: 1 })); ok(x0 - s.p[0].x === 10 * Math.trunc(A.PH.walk * 13 / 10), '落花は歩きが1.3倍'); }
  run(s, 1, () => I({ U: 1, A: 1, V: 'u' })); ok(s.p[0].mv === 'tenR', '落花の天桜'); let fell = false; for (let k = 0; k < 120; k++) { run(s, 1); if (s.p[0].mv === 'tenFall') fell = true; } ok(fell, '天桜のあと降下攻撃');
  run(s, 40); const tr = s.p[0].tree; down(s); ok(s.p[0].tree === tr && s.p[0].tree.stage === 3 && s.p[0].mv !== 'plant', '木があるときの下＋技は何もしない'); s.p[0].tree = null; down(s); ok(s.p[0].tree && s.p[0].tree.stage === 1, '折られたあとはまた植えられる'); }
// 桜華: 落花は威力1.4倍、木は相手に斬られて折れる（耐久4000）
{ const s = new A.Sim({ training: true, kits: ['ouka', 'common'] }); s.p[0].x = 600 * A.FP; s.p[1].x = 660 * A.FP;
  s.p[0].tree = { x: 200 * A.FP, y: 0, hp: 4000, stage: 3, u1: true, u2: true, n: 0, big: 0 };
  run(s, 1, () => I({ A: 1 })); run(s, 30); ok(s.p[1].hp === 10000 - Math.floor(300 * 14 / 10), '落花で弱斬り 300→420 (' + (10000 - s.p[1].hp) + ')');
  const t = new A.Sim({ training: true, kits: ['ouka', 'common'] }); t.p[0].x = 300 * A.FP; t.p[1].x = 660 * A.FP; t.p[1].face = -1;
  t.p[0].tree = { x: 610 * A.FP, y: 0, hp: 4000, stage: 1, u1: false, u2: false };
  let n = 0; for (let k = 0; k < 400 && t.p[0].tree; k++) { t.step([I(), I({ A: (k % 20) === 0 })]); }
  ok(!t.p[0].tree, '相手の斬りで木が折れる'); }
// 桜華: 落花の天桜は着地で前後に花が散り、何度も当たる
{ const s = new A.Sim({ training: true, kits: ['ouka', 'common'] }); s.p[0].x = 800 * A.FP; s.p[1].x = 960 * A.FP; s.p[1].face = -1;
  s.p[0].tree = { x: 300 * A.FP, y: 0, hp: 4000, stage: 3, u1: true, u2: false };
  run(s, 1, () => I({ U: 1, A: 1, V: 'u' })); let n = 0, back = false;
  for (let k = 0; k < 200; k++) { s.step([I(), I()]); for (const e of drain(s)) { if (e.t === 'fallBurst') back = s.pj.some(q => q.vx < 0); if (e.t === 'hit' && e.mv === 'petalG') n++; } }
  ok(back && n >= 2, '着地の花が前後に散って多段ヒット (' + n + '回)'); }
// 桜華で勝つと 並・上 の決着名は「散華」になる
{ const s = new A.Sim({ kits: ['ouka', 'common'] }); s.p[0].x = 600 * A.FP; s.p[1].x = 660 * A.FP; s.p[1].hp = 100; s.p[0].touched = true;
  run(s, 1, () => I({ A: 1 })); run(s, 30); ok(s.result && s.result.name === '散華', '桜華の決着は散華 (' + (s.result && s.result.name) + ')'); }
// 木は当てて育つ: 7回で一段、満開は強化した天桜・花嵐を2回で一気に落花。満開は動き1.3倍・威力そのまま、落花は威力1.4倍
{ const s = new A.Sim({ training: true, kits: ['ouka', 'common'] }); s.p[0].x = 600 * A.FP; s.p[1].x = 700 * A.FP;
  s.plant(s.p[0]); const t = s.p[0].tree, d = s.p[1], a = s.p[0], snap = () => ({ a: 0, dst: 'idle', dground: true });
  for (let k = 0; k < 6; k++) s.applyHit(a, d, A.MV.jab1, snap()); ok(t.stage === 1 && t.n === 6, '6回ではまだ開花');
  s.applyHit(a, d, A.MV.jab1, snap()); ok(t.stage === 2 && t.n === 0, '7回目で満開');
  d.hp = A.HP_MAX; a.combo = 0; s.applyHit(a, d, A.MV.jab1, snap()); ok(A.HP_MAX - d.hp === A.MV.jab1.dmg, '満開は威力そのまま (' + (A.HP_MAX - d.hp) + ')');
  s.applyHit(a, d, A.MV.tenM, snap()); ok(t.stage === 2 && t.big === 1, '強化した天桜1回目');
  s.applyHit(a, d, A.MV.petal, snap(), { vx: 100, b2: 1, dm: 100 }); ok(t.stage === 3, '強化した花嵐2回目で一気に落花');
  d.hp = A.HP_MAX; a.combo = 0; s.applyHit(a, d, A.MV.jab1, snap()); ok(A.HP_MAX - d.hp === Math.floor(A.MV.jab1.dmg * 14 / 10), '落花は威力1.4倍 (' + (A.HP_MAX - d.hp) + ')');
  const g = new A.Sim({ training: true, kits: ['ouka', 'common'] }); g.plant(g.p[0]); g.p[0].tree.stage = 2; const x0 = g.p[0].x; for (let k = 0; k < 10; k++) g.step([I({ R: 1 }), I()]);
  ok(g.p[0].x - x0 === 10 * Math.trunc(A.PH.walk * 13 / 10), '満開は歩きが1.3倍'); }

// ダッシュ中の守: 勢いを残したシールドで、0.1秒ごとに2割ずつ落ちて0.5秒で止まる。設定がオンなら前方回避
{ const s = new A.Sim({ training: true }); s.p[0].x = 400 * A.FP; s.p[1].x = 1400 * A.FP;
  s.step([I({ R: 1, F: true }), I()]); for (let k = 0; k < 10; k++) s.step([I({ R: 1 }), I()]);
  const v0 = s.p[0].vx; s.step([I({ R: 1, G: 1 }), I()]); ok(s.p[0].st === 'guard', 'ダッシュ中の守でシールド (' + s.p[0].st + ')');
  const vs = [s.p[0].vx]; for (let k = 0; k < 31; k++) { s.step([I({ G: 1 }), I()]); vs.push(s.p[0].vx); }
  ok(v0 > 0 && vs[0] === v0 && vs[6] === Math.trunc(v0 * 4 / 5) && vs[12] === Math.trunc(v0 * 3 / 5) && vs[24] === Math.trunc(v0 / 5) && vs[30] === 0, '0.1秒ごとに2割落ちて0.5秒で止まる (' + [0, 6, 12, 24, 30].map(k => vs[k]).join(',') + ')');
  const r = new A.Sim({ training: true, dashRoll: [true, false] }); r.p[0].x = 400 * A.FP; r.step([I({ R: 1, F: true }), I()]); for (let k = 0; k < 10; k++) r.step([I({ R: 1 }), I()]);
  r.step([I({ R: 1, G: 1 }), I()]); ok(r.p[0].st === 'roll', '設定オンならダッシュ中の守で前方回避 (' + r.p[0].st + ')'); }

// 技スティック（設定）: 弾いた向きの刀の技
{ const mk = () => { const s = new A.Sim({ training: true }); s.p[0].x = 600 * A.FP; s.p[1].x = 1200 * A.FP; return s; };
  const first = (K, pre) => { const s = mk(); if (pre) pre(s); s.step([I({ K }), I()]); for (let k = 0; k < 8 && !s.p[0].mv; k++) s.step([I(), I()]); return s.p[0]; };
  ok(first('n').mv === 'shot', '技スティック 向きなし＝飛ぶ斬撃');
  const l = first('l'); ok(l.mv === 'shot' && l.face === -1, '技スティック 左＝左へ飛ぶ斬撃');
  ok(first('u').mv === 'rise', '技スティック 上＝昇り斬り');
  ok(first('d').mv === 'counter', '技スティック 下＝カウンター');
  const s = mk(); s.step([I({ A: 1, C: 'n' }), I()]); for (let k = 0; k < 11; k++) s.step([I(), I()]); s.step([I({ K: 'u' }), I()]);
  let mv = new Set(); for (let k = 0; k < 40; k++) { s.step([I(), I()]); if (s.p[0].mv) mv.add(s.p[0].mv); } ok(mv.has('rise') && !mv.has('jab2'), '弱斬り中に弾くと、斬りの続きでなく技が出る ' + [...mv]); }

// 天桜を当てたら、使った側が着地して動けるのが相手より先（確定反撃を受けない）
{ const FREE = ['idle', 'walk', 'crouch', 'air', 'guard', 'dash'];
  for (const [stage, mv] of [[0, 'ten'], [1, 'tenK'], [2, 'tenM'], [3, 'tenR']]) for (const hp of [10000, 6000, 3000]) {
    const s = new A.Sim({ training: true, kits: ['ouka', 'common'] }); s.p[0].x = 600 * A.FP; s.p[1].x = 660 * A.FP; s.p[1].hp = hp;
    if (stage) { s.plant(s.p[0]); s.p[0].tree.stage = stage; s.p[0].tree.x = 200 * A.FP; }
    s.step([I({ U: 1, A: 1, S: 1 }), I()]); let hit = false, a = -1, d = -1, used = null;
    for (let f = 1; f < 400 && (a < 0 || d < 0); f++) { s.step([I(), I()]); for (const e of s.ev) if (e.t === 'hit' && e.by === 0) { hit = true; used = used || e.mv; } s.ev = [];
      if (!hit) continue; if (a < 0 && FREE.includes(s.p[0].st) && s.p[0].ground && !s.hitstop) a = f; if (d < 0 && FREE.includes(s.p[1].st) && !s.hitstop) d = f; }
    ok(used === mv && d > a, `${mv} 相手の体力${hp / 100}: 使った側が先に動ける（${d - a}F 早い）`); } }

// 稽古は時間切れなし
{ const s = new A.Sim({ training: true }); for (let k = 0; k < A.C.roundF + A.C.sdF + 60; k++) s.step([I(), I()]); ok(!s.sd && !s.over, '稽古は時間切れにならない'); }

// 弱斬りは当たったら途中で他の技に切り替えられる（キャンセル）
{ const go = (lead, inp) => { const s = sim(60); s.step([I({ A: 1, C: 'n' }), I()]); for (let k = 0; k < lead; k++) s.step([I(), I()]); s.step([inp, I()]); const seen = []; for (let k = 0; k < 6; k++) { s.step([I(), I()]); if (s.p[0].mv && seen[seen.length - 1] !== s.p[0].mv) seen.push(s.p[0].mv); } return seen; };
  ok(go(7, I({ A: 1, C: 'r' })).includes('ftilt'), '弱斬りが当たったら横斬りへ切り替え');
  ok(go(7, I({ A: 1, S: 1 })).includes('shot'), '弱斬りが当たったら技（飛ぶ斬撃）へ切り替え');
  ok(go(7, I({ K: 'u' })).includes('rise'), '弱斬りが当たったら技スティック上（昇り斬り）へ');
  const nb = sim(400); nb.step([I({ A: 1, C: 'n' }), I()]); for (let k = 0; k < 7; k++) nb.step([I(), I()]); nb.step([I({ A: 1, C: 'r' }), I()]); for (let k = 0; k < 6; k++) nb.step([I(), I()]); ok(nb.p[0].mv !== 'ftilt', '空振りの弱斬りは切り替えられない (' + nb.p[0].mv + ')'); }

// 先行入力: 持続から硬直の終わりまでに押したものは覚えておき、動けるようになった瞬間に出る。発生前の入力は受け付けない
{ const s = sim(400); s.step([I({ A: 1, C: 'n' }), I()]); for (let k = 0; k < 8; k++) s.step([I(), I()]); // 弱斬りの硬直の始め（終わりの8F以上前）
  s.step([I({ A: 1, C: 'u' }), I()]); let f = 0; while (s.p[0].mv === 'jab1' && f < 40) { s.step([I(), I()]); f++; } s.step([I(), I()]);
  ok(s.p[0].mv === 'utilt', '硬直中に入れた上斬りが、弱斬りの終わりにすぐ出る (' + s.p[0].mv + ')');
  const b = sim(400); b.step([I({ A: 1, C: 'n' }), I()]); b.step([I(), I()]); b.step([I({ J: 1 }), I()]); let g = 0; while (b.p[0].mv === 'jab1' && g < 40) { b.step([I(), I()]); g++; }
  ok(b.p[0].st !== 'jsq' && b.p[0].ground, '発生前に押した跳は受け付けない (' + b.p[0].st + ')'); }

// 稽古の相手は体力無限: 体力を少なくしても倒れない
{ const s = sim(70); s.p[1].hp = 300; let ko = false;
  for (let k = 0; k < 600 && !ko; k++) { s.step([I(k % 12 === 0 ? { A: 1, C: 'n' } : {}), I()]); ko = !!s.over; }
  ok(!ko && s.p[1].hp > 0, '稽古の相手は斬られ続けても倒れない (体力 ' + s.p[1].hp + ')');
  const t = new A.Sim({ toWin: 2 }); t.p[0].x = 600 * A.FP; t.p[1].x = 670 * A.FP; t.p[1].hp = 300; let ko2 = false;
  for (let k = 0; k < 600 && !ko2; k++) { t.step([I(k % 12 === 0 ? { A: 1, C: 'n' } : {}), I()]); ko2 = !!t.over; }
  ok(ko2, '稽古でなければ倒れる'); }

// 持続のどこで当てても硬直差は同じ
{ const adv = d => { const s = sim(d); run(s, 1, () => I({ A: 1 })); run(s, 30); const h = drain(s).find(e => e.t === 'hit'); return h && h.adv; };
  const near = adv(50), far = adv(105); ok(near === far && near === 8, '近く(早い持続)でも遠く(遅い持続)でも同じ有利 ' + near + ' / ' + far); }
// 昇り斬り・天桜を当てると相手も無防備落下し、着地して動けるのは当てた側が先（確定反撃を取られない）
for (const kit of ['common', 'ouka']) { const s = new A.Sim({ training: true, kits: [kit, 'common'] }); s.p[0].x = 600 * A.FP; s.p[1].x = 640 * A.FP;
  s.step([I({ K: 'u' }), I()]); let fell = false, hit = false, freeA = -1, freeD = -1;
  for (let k = 0; k < 300; k++) { s.step([I(), I({ G: k > 20 && k % 2 ? 1 : 0 })]); for (const e of drain(s)) if (e.t === 'hit') hit = true; if (s.p[1].st === 'fall' || (hit && s.p[1].st === 'land')) fell = true;
    const free = q => ['idle', 'walk', 'crouch', 'guard', 'tech', 'roll'].includes(q.st) && q.ground; // 受け身を取ろうとしても取れない
    if (freeA < 0 && k > 5 && free(s.p[0])) freeA = k; if (freeD < 0 && hit && k > 5 && free(s.p[1])) freeD = k; }
  ok(hit && fell && freeA >= 0 && freeA <= freeD, (kit === 'ouka' ? '天桜' : '昇り斬り') + 'を当てると相手も無防備落下・先に動けるのは当てた側 (当てた側 ' + freeA + 'F / 食らった側 ' + freeD + 'F)'); }
{ const s = sim(400); s.p[1].y = 300 * A.FP; s.p[1].ground = false; s.p[1].st = 'air'; s.p[1].x = s.p[0].x + 30 * A.FP;
  s.applyHit(s.p[0], s.p[1], A.MV.ten, { dst: 'air', dground: false }); let fell = false, down = false;
  for (let k = 0; k < 300; k++) { s.step([I(), I()]); if (s.p[1].st === 'fall') fell = true; if (s.p[1].st === 'down') down = true; }
  ok(fell, '天桜を食らった側も無防備落下'); 
  const t = sim(400); t.p[1].y = 300 * A.FP; t.p[1].ground = false; t.p[1].st = 'air'; const m = Object.assign({}, A.MV.ten, { dfall: 0, kd: 0 });
  t.applyHit(t.p[0], t.p[1], m, { dst: 'air', dground: false }); let f2 = false, d2 = false;
  for (let k = 0; k < 300; k++) { t.step([I(), I()]); if (t.p[1].st === 'fall') f2 = true; if (t.p[1].st === 'down') d2 = true; }
  ok(!f2 && !d2, '無防備落下・ダウンを切ると、どちらにもならない'); }

// 無防備落下＋必ずダウンの技は、空中で硬直が切れても着地で必ずダウン（受け身も取れない）
{ const t = sim(400); t.p[1].y = 300 * A.FP; t.p[1].ground = false; t.p[1].st = 'air'; const m = Object.assign({}, A.MV.rise, { kd: 1, hs: 10 });
  t.applyHit(t.p[0], t.p[1], m, { dst: 'air', dground: false }); let f = false, d = false;
  for (let k = 0; k < 300; k++) { t.step([I(), I({ G: k % 2 })]); if (t.p[1].st === 'fall') f = true; if (t.p[1].st === 'down') d = true; }
  ok(f && d, '無防備落下中に「必ずダウン」なら着地で必ずダウン'); }

// 起き上がりの1F目に攻撃を重ねられても、守を押していればガードできる
for (const lag of [0, 1, 2, 4]) { const s = sim(60); s.p[1].st = 'down'; s.p[1].f = 0; s.p[1].ground = true; let gu = -1;
  s.step([I(), I({ G: 1 })]); for (let k = 0; k < 40 && gu < 0; k++) { s.step([I(), I({ G: 1 })]); if (s.p[1].st !== 'getup') gu = k; }
  for (let k = 0; k < 5 + lag; k++) s.step([I(), I({ G: 1 })]); // 起きる少し前から構えておく
  const t = sim(60); t.p[1].st = 'down'; t.p[1].f = 0; t.p[1].ground = true; let ev = [], n = 0;
  t.step([I(), I({ G: 1 })]); while (t.p[1].st === 'getup' || t.p[1].st === 'down') { const f0 = t.p[1].f; t.step([n === 0 && false ? I() : I(), I({ G: 1 })]); n++; if (n > 60) break; if (t.p[1].st === 'getup' && f0 === 30 - 5 - lag) { t.step([I({ A: 1, C: 'n' }), I({ G: 1 })]); } }
  for (let k = 0; k < 20; k++) { t.step([I(), I({ G: 1 })]); ev.push(...drain(t)); }
  const hit = ev.some(e => e.t === 'hit'), blk = ev.some(e => e.t === 'block');
  ok(!hit, '起き上がりに重ねた斬り（' + lag + 'F 前に出す）はガードか空振り ' + (blk ? '(ガード)' : '(空振り)')); }

console.log(fail ? fail + ' 件失敗' : 'すべて成功'); process.exit(fail ? 1 : 0);
