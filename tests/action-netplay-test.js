// 新・一閃 ネット対戦の巻き戻しのテスト: node tests/action-netplay-test.js
// 二つの端末を作り、遅れ・揺らぎのある通信で入力を送り合って、確定したコマの盤面が二人で同じかを確かめる
const A = require('../js/action/sim.js');
const { NetPlay, encode, decode } = require('../js/action/netplay.js');
let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log('NG', msg); } else console.log('ok', msg); };

// 入力の数への詰め直し
{ const i = { L: 1, R: 0, U: 1, D: 0, A: 1, J: 0, G: 1, S: 1, F: true, C: 'u', V: 'h' };
  const d = decode(encode(i)); ok(d.L && d.U && d.A && d.G && d.S && d.F && d.C === 'u' && d.V === 'h' && !d.R && !d.J && !d.D, '入力を数に詰めて戻せる');
  ok(encode(A.NOIN) === 0 && decode(0).C === undefined, '何も押さない = 0'); }

let seed = 99;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
function randomInput(prev){
  if (rnd() < 0.85) return prev; // たいていは前と同じ（人の手に近く）
  const i = {};
  for (const k of ['L', 'R', 'U', 'D', 'A', 'J', 'G']) if (rnd() < (k === 'G' ? 0.12 : 0.25)) i[k] = 1;
  if (rnd() < 0.2) i.C = ['n', 'l', 'r', 'u', 'd'][rnd() * 5 | 0];
  if (i.A && rnd() < 0.5) i.S = 1;
  if (rnd() < 0.08) i.F = true;
  return encode(i);
}

function peer(me, kits){
  const low = s => { s.p.forEach(q => { q.hp = 1200; }); return s; }; // 決着が早く来るよう体力を減らしておく
  const st = { sim: low(new A.Sim({ toWin: 2, kits })), log: [], hashes: {}, ph: 'fight', t: 0 };
  const save = () => ({ s: structuredClone(Object.assign({}, st.sim)), ph: st.ph, t: st.t, log: st.log.slice() });
  const load = z => { const s = new A.Sim({ toWin: 2, kits }); Object.assign(s, structuredClone(z.s)); st.sim = s; st.ph = z.ph; st.t = z.t; st.log = z.log.slice(); };
  const step = (inp, resim, f) => {
    if (st.ph === 'fight') { st.sim.step(inp); st.sim.ev = []; if (st.sim.over) { st.ph = 'fin'; st.t = 0; } }
    else if (st.ph === 'fin') { if (++st.t > 30) { st.log.push(st.sim.result.name + ':' + st.sim.result.winner); if (st.sim.result.matchOver) st.ph = 'over'; else { st.sim.resetRound(); low(st.sim); st.ph = 'fight'; } } }
    st.hashes[f] = st.sim.hash() ^ (st.log.length * 7919);
  };
  st.np = NetPlay({ me, delay: 2, maxRoll: 12, save, load, step });
  st.cur = 0;
  return st;
}

function run(lat, jit, frames, kits){
  const P = [peer(0, kits), peer(1, kits)], q = [[], []]; // q[to] = [{at, f, c}]
  let T = 0, stalls = 0;
  for (; T < frames; T++) {
    for (const me of [0, 1]) {
      const p = P[me];
      // 届いた入力
      const box = q[me]; box.sort((a, b) => a.at - b.at || a.f - b.f);
      while (box.length && box[0].at <= T) { const m = box.shift(); p.np.remote(m.f, m.c); }
      if (!p.np.canAdvance() && p.np.rollTo < 0) { stalls++; continue; }
      if (p.np.lh < p.np.frame + 2) { p.cur = randomInput(p.cur); const f = p.np.local(p.cur);
        q[1 - me].push({ at: T + lat + Math.floor(rnd() * jit), f, c: p.cur }); }
      p.np.advance();
    }
    // 届く順は送った順（TCP のように）: 遅れの揺らぎで追い越さないよう、後の物は前の物より早く着かない
    for (const box of q) { box.sort((a, b) => a.f - b.f); for (let k = 1; k < box.length; k++) if (box[k].at < box[k - 1].at) box[k].at = box[k - 1].at; }
  }
  // 残りを全部届けて、確定させる
  for (let k = 0; k < 200; k++) for (const me of [0, 1]) { const p = P[me], box = q[me]; while (box.length) { const m = box.shift(); p.np.remote(m.f, m.c); } if (p.np.rollTo >= 0) p.np.advance(); }
  return { P, stalls };
}

for (const [lat, jit] of [[0, 1], [4, 3], [9, 6]]) {
  const { P, stalls } = run(lat, jit, 6000, ['common', 'ouka']);
  const n = Math.min(P[0].np.confirmed(), P[1].np.confirmed());
  let bad = -1;
  for (let f = 0; f <= n; f++) if (P[0].hashes[f] !== P[1].hashes[f]) { bad = f; break; }
  ok(bad < 0 && n > 5000, `遅れ${lat}F・揺らぎ${jit}F: ${n}コマまで二人の盤面が同じ（巻き戻し ${P[0].np.rolls + P[1].np.rolls}回・最大${Math.max(P[0].np.maxRolled, P[1].np.maxRolled)}F・待ち ${stalls}回）` + (bad >= 0 ? ' ずれたコマ ' + bad : ''));
  ok(P[0].log.join() === P[1].log.join(), `　決着の記録も同じ（${P[0].log.length}本 ${P[0].log.slice(0, 3).join(' ')}…）`);
}

console.log(fail ? `\n${fail} 件しっぱい` : '\nすべてOK');
process.exit(fail ? 1 : 0);
