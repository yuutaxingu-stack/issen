// 判定の自動テスト: 二人対戦の判定が変わっていないことを確かめる
// 使い方: node tests/judge-test.js
const { chromium } = require('playwright');
const path = require('path');

const SCENARIOS = [
  // [名前, 操作の列（[時刻ms, 'p0'|'p1', 'iai'|'mk'] または ['next'] で次の局面へ）, 期待する決着名, 勝者]
  ['疾風',   [[100,0,'iai']], '疾風', 0],
  ['先の先', [[100,0,'iai'],[300,1,'iai']], '先の先', 0],
  ['隙穿ち', [[100,1,'mk'],[200,0,'iai']], '隙穿ち', 0],
  ['陽炎',   [[100,0,'iai'],[300,0,'iai'],[320,1,'mk'],[460,0,'iai']], '陽炎', 0],
  ['明鏡止水', [[100,0,'iai'],[890,1,'mk']], '明鏡止水', 1],
  ['止め',   [[100,0,'iai'],[600,1,'mk'],['next'],[200,1,'iai']], '止め', 1],
  ['二の太刀', [[100,0,'iai'],[600,1,'mk'],['next'],[100,0,'iai'],[600,1,'mk']], '二の太刀', 1],
  ['死中活', [[100,0,'iai'],[600,1,'mk'],['next'],[100,0,'iai']], '死中活', 0],
  ['流転',   [[100,0,'iai'],[600,1,'mk'],['next'],[100,1,'iai'],[200,1,'iai'],[300,0,'iai'],[800,1,'mk']], '流転', 1],
  ['紙一重', [[100,0,'iai'],[600,1,'mk'],['next'],[100,1,'iai'],[600,0,'mk'],['next'],[100,0,'iai']], '紙一重', 0],
  ['鏡返し', [[100,0,'iai'],[600,1,'mk'],['next'],[100,1,'iai'],[600,0,'mk'],['next'],[100,1,'iai'],[600,0,'mk']], '鏡返し', 0],
  ['一閃',   [[100,0,'iai'],[600,1,'mk'],['next'],[100,1,'iai'],[600,0,'mk'],['next'],[100,1,'iai'],[880,0,'mk']], '一閃', 0],
  ['相打ちのあと疾風', [[100,0,'iai'],[100,1,'iai'],['next'],[100,1,'iai']], '疾風', 1],
  ['睨み合い', [], '睨み合い', null],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
  await page.addInitScript(() => { window.__T = 1000; performance.now = () => window.__T; });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForFunction(() => typeof startMatch === 'function');
  let fail = 0;
  for (const [title, ops, want, winner] of SCENARIOS) {
    const got = await page.evaluate(([ops]) => {
      // ゲームの1フレーム分の進行（描画なし）
      const tick = now => {
        if (G.phase === 'ready' && now >= G.cueAt) { G.phase = 'fight'; G.roundEnd = G.cueAt + CFG.roundSec * 1000; G.startAt = now; }
        if (G.phase === 'fight') stepTo(now);
        if (G.phase === 'fx') fxTick(now);
      };
      const adv = ms => { const end = window.__T + ms; while (window.__T < end) { window.__T = Math.min(end, window.__T + 8); tick(gnow()); } };
      const toFight = () => { let g = 0; while (G.phase !== 'fight' && g++ < 2000) adv(8); return gnow(); };
      startMatch('vs');
      let base = toFight();
      for (const op of ops) {
        if (op[0] === 'next') { let h = 0; while (G.phase === 'fight' && h++ < 2000) adv(8); base = toFight(); continue; }
        const [t, p, a] = op; const now = gnow();
        if (base + t > now) adv(base + t - now);
        input(p, a);
      }
      let g = 0; while (G.phase !== 'result' && g++ < 200) adv(1000);
      return G.result ? { name: G.result.name, winner: G.result.winner } : { name: '(結果なし) ' + G.phase };
    }, [ops]);
    const ok = got.name === want && got.winner === winner;
    if (!ok) fail++;
    console.log((ok ? '  OK ' : '  NG ') + title + ' → ' + got.name + (got.winner == null ? '' : '（' + ['朱', '藍'][got.winner] + '）'));
  }
  if (errors.length) { console.log('ページのエラー:', errors); fail++; }
  await browser.close();
  console.log(fail ? `失敗 ${fail}件` : '全部通りました');
  process.exit(fail ? 1 : 0);
})();
