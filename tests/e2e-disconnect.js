// 切断のテスト: 対戦中に片方がページを閉じたら、もう片方に知らせが出てタイトルに戻り、相手がオフラインになるか
// 使い方: node tests/e2e-disconnect.js <ログインIDの頭>（e2e-online.js で作った2人を使う）
const { chromium } = require('playwright');
const path = require('path');
const pre = process.argv[2];
const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
(async () => {
  const browser = await chromium.launch();
  const mk = async (login) => {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } }); const p = await ctx.newPage();
    p.on('pageerror', e => log(login, 'エラー', String(e)));
    await p.goto(url); await p.waitForFunction(() => window.IssenNet && IssenNet.ready, null, { timeout: 20000 });
    await p.click('#m_online'); await p.fill('#o_login', login); await p.fill('#o_pass', 'issen-test-pass'); await p.click('#o_ago');
    await p.waitForFunction(() => IssenNet.profile && IssenNet.friends.length, null, { timeout: 20000 });
    log('ログイン', login); return p;
  };
  const A = await mk(pre + '_a'), B = await mk(pre + '_b');
  const bid = await B.evaluate(() => IssenNet.user.id);
  await A.waitForFunction(id => IssenNet.statusOf(id) === 'online', bid, { timeout: 30000 });
  await A.click('#o_list button[data-act=inv]');
  await B.waitForFunction(() => !document.getElementById('o_inv').hidden, null, { timeout: 30000 });
  await B.click('#o_invok');
  await Promise.all([A, B].map(p => p.waitForFunction(() => __issen.G.phase === 'fight', null, { timeout: 40000 })));
  log('対戦中。B のページを閉じます');
  await B.close();
  const t0 = Date.now();
  await A.waitForFunction(() => /切れました|退出/.test(document.getElementById('o_note').textContent), null, { timeout: 30000 });
  log('A の知らせ:', await A.textContent('#o_note'), ((Date.now() - t0) / 1000).toFixed(1) + '秒後');
  await A.waitForFunction(() => __issen.G.mode === 'title', null, { timeout: 10000 });
  log('A はタイトルに戻った');
  await A.waitForFunction(id => IssenNet.statusOf(id) === 'offline', bid, { timeout: 60000 });
  log('B の状態: offline', ((Date.now() - t0) / 1000).toFixed(1) + '秒後');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
