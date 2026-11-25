// オンライン対戦の「斬撃が止まって見える時間」を測るテスト（Supabaseなし）
// 本番と同じく「ここまで送った」の定期の知らせは0.5秒ごと。通信の遅れ（片道）をはさんで二人が適当に押し、
// 溜めが終わってから決着の演出が始まるまでに、それぞれの画面で何ms待ったかを測る。結果の一致も確かめる。
// 使い方: node tests/lag-test.js [試合数] [最小遅延ms] [最大遅延ms] [off]   （off で「すぐ知らせる」を止めて、直す前と比べる）
const { chromium } = require('playwright');
const path = require('path');
const N = +(process.argv[2] || 8), LMIN = +(process.argv[3] || 150), LMAX = +(process.argv[4] || 300), OFF = process.argv[5] === 'off';
const stalls = [];

function rng(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

(async () => {
  const browser = await chromium.launch();
  const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
  const pages = [];
  for (let i = 0; i < 2; i++) {
    const pg = await browser.newPage({ viewport: { width: 900, height: 500 } });
    await pg.addInitScript(() => { window.__T = 1000; performance.now = () => window.__T; window.requestAnimationFrame = () => 0; });
    pg.on('pageerror', e => { console.log('ページのエラー', i, String(e)); process.exitCode = 1; });
    await pg.goto(url);
    await pg.waitForFunction(() => typeof startOnline === 'function');
    // 1フレーム分の進行（描画なし）と、送信の受け皿
    await pg.evaluate(() => {
      window.__out = [];
      window.__tick = now => {
        if (G.phase === 'ready' && now >= G.cueAt) { G.phase = 'fight'; G.roundEnd = G.cueAt + CFG.roundSec * 1000; G.startAt = now; NET.fightFrom = G.cueAt; }
        if (G.phase === 'fight') stepTo(now);
        if (G.phase === 'fx') fxTick(now);
        if (G.phase === 'result' && now - G.resultAt > 4800) nextFromResult();
      };
    });
    pages.push(pg);
  }
  let bad = 0;
  for (let m = 0; m < N; m++) {
    const R = rng(1234 + m);
    const seed = (R() * 1e9) | 0;
    for (let i = 0; i < 2; i++) await pages[i].evaluate(([me, seed]) => {
      window.__T = 1000; window.__out = [];
      startOnline({ me, seed, startAt: 1000, clockOff: 0, send: msg => window.__out.push(msg), oppName: '相手', myName: 'あなた' });
      window.__lastH = 0; window.__waitFrom = null; window.__stalls = [];
    }, [i, seed]);
    const inflight = [[], []]; // inflight[i]: ページiに届く予定の通信
    const lastDeliver = [0, 0];
    let T = 1000, done = false, steps = 0;
    // 押し方の作戦: 適当に押す、または相手の溜めを見て見切りを狙う
    const plan = [{ next: 1000 + 2000 + R() * 2000, aimed: null }, { next: 1000 + 2000 + R() * 2000, aimed: null }];
    while (!done && steps++ < 200000) {
      T += 8;
      for (let i = 0; i < 2; i++) {
        const deliver = inflight[i].filter(x => x.at <= T); inflight[i] = inflight[i].filter(x => x.at > T);
        const actions = [];
        const st = await pages[i].evaluate(([T, deliver, OFF]) => {
          if (OFF) NET.hSent = Infinity;
          window.__T = T;
          for (const d of deliver) { if (d.k === 'in') { netHorizon(d.t); netInput(d.t, d.a, d.s); } else if (d.k === 'h') netHorizon(d.h); }
          const ph0 = G.phase;
          __tick(gnow());
          // 溜めの終わりを過ぎても決着していない（止まって見える）時間
          if (G.phase === 'fight' && P.some(p => p.state === 'charge' && p.end <= gnow())) { if (window.__waitFrom == null) window.__waitFrom = Math.min(...P.filter(p => p.state === 'charge').map(p => p.end)); }
          else if (window.__waitFrom != null) { window.__stalls.push(gnow() - window.__waitFrom); window.__waitFrom = null; }
          if (gnow() - window.__lastH >= 500) { window.__lastH = gnow(); window.__out.push({ k: 'h', h: gnow() }); }
          const out = window.__out; window.__out = [];
          const me = P[NET.me], op = P[1 - NET.me];
          return { out, phase: G.phase, me: me.state, op: op.state, opStart: op.start, opEnd: op.end, now: gnow() };
        }, [T, deliver, OFF]);
        // 作戦
        const pl = plan[i];
        let act = null;
        if (st.phase === 'fight') {
          if (st.op === 'charge' && st.me === 'idle' && pl.aimed !== st.opStart && R() < 0.6) {
            pl.aimed = st.opStart; const off = R() < 0.4 ? R() * 40 : R() * 400; pl.mkAt = st.opEnd - off;
          }
          if (pl.mkAt && T >= pl.mkAt) { act = 'mk'; pl.mkAt = 0; }
          else if (T >= pl.next) { act = R() < 0.65 ? 'iai' : 'mk'; pl.next = T + 200 + R() * 1800; }
        }
        if (act) st.out.push(...await pages[i].evaluate(a => { input(NET.me, a); const o = window.__out; window.__out = []; return o; }, act));
        for (const msg of st.out) {
          const at = Math.max(lastDeliver[1 - i], T + LMIN + R() * (LMAX - LMIN));
          lastDeliver[1 - i] = at; inflight[1 - i].push({ ...msg, at });
        }
        if (i === 1 && st.phase === 'match') done = true;
      }
    }
    const res = await Promise.all(pages.map(pg => pg.evaluate(() => ({ h: G.history.map(x => x.name + ':' + x.winner).join(' '), s: P.map(p => p.score).join('-'), phase: G.phase }))));
    for (const pg of pages) stalls.push(...await pg.evaluate(() => window.__stalls));
    const ok = res[0].h === res[1].h && res[0].s === res[1].s && res[0].phase === 'match' && res[1].phase === 'match';
    if (!ok) bad++;
    console.log((ok ? '  一致 ' : '  不一致 ') + `第${m + 1}試合 ${res[0].s}  ${res[0].h}` + (ok ? '' : `\n         もう一方: ${res[1].s}  ${res[1].h} (${res[0].phase}/${res[1].phase})`));
  }
  await browser.close();
  stalls.sort((a, b) => a - b);
  const avg = stalls.reduce((a, b) => a + b, 0) / (stalls.length || 1);
  console.log(`${OFF ? '直す前' : '直した後'}  片道${LMIN}〜${LMAX}ms: 斬撃が止まって見えた時間 平均${Math.round(avg)}ms 中央${Math.round(stalls[stalls.length >> 1] || 0)}ms 最大${Math.round(stalls[stalls.length - 1] || 0)}ms（${stalls.length}回）`);
  console.log(bad ? `不一致 ${bad}件` : '全試合一致');
  process.exit(bad ? 1 : 0);
})();
