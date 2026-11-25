// 画面の確認: タイトル、CPU戦、二人対戦、ガチャ、オンライン（藍側）でエラーが出ないか、画面写真を撮る
// 使い方: node tests/smoke-test.js [写真の保存先]
const { chromium } = require('playwright');
const path = require('path');
const out = process.argv[2] || '.';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForTimeout(800);
  await page.screenshot({ path: out + '/title.png' });
  await page.click('#m_cpu'); await page.waitForTimeout(3500);
  await page.screenshot({ path: out + '/cpu.png' });
  await page.evaluate(() => goTitle()); await page.waitForTimeout(300);
  await page.click('#m_vs'); await page.waitForTimeout(3000);
  await page.screenshot({ path: out + '/vs.png' });
  await page.evaluate(() => goTitle()); await page.waitForTimeout(300);
  await page.click('#m_gacha'); await page.waitForTimeout(500);
  await page.screenshot({ path: out + '/gacha.png' });
  await page.click('#g_back'); await page.waitForTimeout(300);
  // オンライン（藍側、相手はいない）。相手の知らせを先に進めておく
  await page.evaluate(() => { startOnline({ me: 1, seed: 7, startAt: performance.now(), clockOff: 0, send: () => {}, oppName: 'たけ', myName: 'すいか' }); setInterval(() => netHorizon(gnow()), 100); });
  await page.waitForTimeout(3000);
  await page.mouse.click(844 - 50, 390 - 50); // 居合
  await page.waitForTimeout(400);
  await page.screenshot({ path: out + '/online-charge.png' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: out + '/online-fx.png' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: out + '/online-result.png' });
  console.log(errors.length ? 'エラー: ' + errors.join('\n') : 'エラーなし');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
