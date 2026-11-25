// 観戦の同期テスト（Supabaseなし）。online-sync-test.js に「観戦する3つ目のページ」を足したもの
// 二人の送り物を、それぞれ遅れをはさんで観戦者にも届け、観戦者の画面の決着が二人と一致するかを確かめる。
// 使い方: node tests/watch-sync-test.js [試合数] [最小遅延ms] [最大遅延ms]
const { chromium } = require('playwright');
const path = require('path');
const N = +(process.argv[2] || 12), LMIN = +(process.argv[3] || 30), LMAX = +(process.argv[4] || 250);

function rng(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

(async () => {
  const browser = await chromium.launch();
  const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
  const pages = [];
  for (let i = 0; i < 3; i++) {
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
      window.__lastH = 0;
    }, [i, seed]);
    // 観戦者: 1.5秒遅れの時計で、二人の送り物から再生する
    await pages[2].evaluate(seed => {
      window.__T = 1000; window.__out = [];
      startOnline({ me: 0, watch: true, seed, startAt: 1000, clockOff: -1500, send: null, myName: '朱', oppName: '藍', toWin: 2 });
    }, seed);
    const inflight = [[], [], []]; // inflight[i]: ページiに届く予定の通信
    const lastDeliver = [0, 0, 0], lastW = [0, 0];
    let wdone = false;
    let T = 1000, done = false, steps = 0;
    // 押し方の作戦: 適当に押す、または相手の溜めを見て見切りを狙う
    const plan = [{ next: 1000 + 2000 + R() * 2000, aimed: null }, { next: 1000 + 2000 + R() * 2000, aimed: null }];
    while (!done && steps++ < 200000) {
      T += 8;
      for (let i = 0; i < 2; i++) {
        const deliver = inflight[i].filter(x => x.at <= T); inflight[i] = inflight[i].filter(x => x.at > T);
        const actions = [];
        const st = await pages[i].evaluate(([T, deliver]) => {
          window.__T = T;
          for (const d of deliver) { if (d.k === 'in') { netHorizon(d.t); netInput(d.t, d.a, d.s); } else if (d.k === 'h') netHorizon(d.h); }
          __tick(gnow());
          if (gnow() - window.__lastH >= 100) { window.__lastH = gnow(); window.__out.push({ k: 'h', h: gnow() }); }
          const out = window.__out; window.__out = [];
          const me = P[NET.me], op = P[1 - NET.me];
          return { out, phase: G.phase, me: me.state, op: op.state, opStart: op.start, opEnd: op.end, now: gnow() };
        }, [T, deliver]);
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
        for (const msg of st.out) {   // 観戦者へも（送った側ごとに順番は守る）
          const at = Math.max(lastW[i], T + LMIN + R() * (LMAX - LMIN)); lastW[i] = at;
          inflight[2].push({ ...msg, p: i, at });
        }
      }
      const deliver = inflight[2].filter(x => x.at <= T); inflight[2] = inflight[2].filter(x => x.at > T);
      deliver.sort((a, b) => a.at - b.at);
      const wst = await pages[2].evaluate(([T, deliver]) => {
        window.__T = T;
        for (const d of deliver) { if (d.k === 'in') { netHorizon(d.t, d.p); netInput(d.t, d.a, d.s, d.p); } else if (d.k === 'h') netHorizon(d.h, d.p); }
        __tick(gnow()); window.__out = [];
        return G.phase;
      }, [T, deliver]);
      if (wst === 'match') wdone = true;
      if (done && !wdone) done = false;
      if (!done) { const ph = await pages[1].evaluate(() => G.phase); if (ph === 'match' && wdone) done = true; }
    }
    const res = await Promise.all(pages.map(pg => pg.evaluate(() => ({ h: G.history.map(x => x.name + ':' + x.winner).join(' '), s: P.map(p => p.score).join('-'), phase: G.phase, coins: WALLET.coins }))));
    const ok = res[0].h === res[2].h && res[0].s === res[2].s && res[0].h === res[1].h && res[2].phase === 'match' && res[2].coins === 0;
    if (!ok) bad++;
    console.log((ok ? '  一致 ' : '  不一致 ') + `第${m + 1}試合 ${res[0].s}  ${res[0].h}` + (ok ? '' : `\n         観戦者: ${res[2].s}  ${res[2].h} (${res[2].phase}) 銭${res[2].coins}`));
  }
  await browser.close();
  console.log(bad ? `不一致 ${bad}件` : '観戦者の画面も全試合一致');
  process.exit(bad ? 1 : 0);
})();
