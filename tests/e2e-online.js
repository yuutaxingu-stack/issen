// 本物のSupabaseを使った通しテスト: 登録 → フレンド申請・承認 → オンライン状態 → 招待 → 対戦 → 結果の照合
// 使い方: node tests/e2e-online.js <ログインIDの頭>  （例: node tests/e2e-online.js t1）
// 注意: 実際に2人の利用者が作られます。終わったら Supabase の Authentication → Users から消せます。
const { chromium } = require('playwright');
const path = require('path');
const pre = process.argv[2] || ('t' + Date.now() % 100000);
const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

(async () => {
  const browser = await chromium.launch();
  const mk = async (tag) => {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => log(tag, 'エラー', String(e)));
    p.on('console', m => { if (m.type() === 'error') log(tag, 'console', m.text()); });
    await p.goto(url);
    await p.waitForFunction(() => window.IssenNet && IssenNet.ready, null, { timeout: 20000 });
    return p;
  };
  const A = await mk('A'), B = await mk('B');
  const signup = async (p, login, name) => {
    await p.click('#m_online'); await p.click('#o_auth .otabs button[data-tab=up]');
    await p.fill('#o_login', login); await p.fill('#o_pass', 'issen-test-pass'); await p.fill('#o_name', name);
    await p.click('#o_ago');
    await p.waitForFunction(() => IssenNet.profile || document.getElementById('o_amsg').textContent.match(/ん|た|。|）/), null, { timeout: 20000 });
    const r = await p.evaluate(() => ({ prof: IssenNet.profile, msg: document.getElementById('o_amsg').textContent }));
    log('登録', login, r.prof ? 'OK ID=' + r.prof.code : 'NG ' + r.msg);
    return r.prof;
  };
  const pa = await signup(A, pre + '_a', 'テスト甲'), pb = await signup(B, pre + '_b', 'テスト乙');
  if (!pa || !pb) { await browser.close(); process.exit(1); }

  await A.fill('#o_fcode', pb.code); await A.click('#o_fform button');
  await A.waitForFunction(() => /申請しました|フレンド/.test(document.getElementById('o_fmsg').textContent), null, { timeout: 15000 });
  log('A→B 申請:', await A.textContent('#o_fmsg'));
  await B.waitForFunction(() => IssenNet.incoming.length > 0, null, { timeout: 60000 });
  log('B に申請が届いた（リアルタイム）');
  await B.click('#o_in button[data-act=ok]');
  await A.waitForFunction(() => IssenNet.friends.length > 0, null, { timeout: 60000 });
  log('フレンド成立（A側にも反映）');
  await A.waitForFunction(id => IssenNet.statusOf(id) === 'online', pb.id, { timeout: 30000 });
  log('A から見た B の状態:', await A.evaluate(id => IssenNet.statusOf(id), pb.id));

  await A.click('#o_list button[data-act=inv]');
  await B.waitForFunction(() => !document.getElementById('o_inv').hidden, null, { timeout: 30000 });
  log('B に招待が届いた:', (await B.textContent('#o_inv')).replace(/\s+/g, ' '));
  await B.click('#o_invok');
  await Promise.all([A, B].map(p => p.waitForFunction(() => __issen.G.mode === 'online', null, { timeout: 40000 })));
  log('対戦開始。時計のずれ推定:', await B.evaluate(() => IssenMatch.active && IssenMatch.active.off.toFixed(1) + 'ms 往復 ' + (IssenMatch.active.rtt || 0).toFixed(0) + 'ms'));
  log('試合中の表示:', await A.evaluate(id => IssenNet.statusOf(id), pb.id));

  // 二人とも適当に押す
  const bot = p => p.evaluate(() => {
    window.__bot = setInterval(() => { const G = __issen.G, NET = __issen.NET; if (G.mode !== 'online' || G.phase !== 'fight') return;
      if (Math.random() < 0.08) { const a = Math.random() < 0.6 ? 'iai' : 'mk'; press(NET.me, a); } }, 100);
  });
  await bot(A); await bot(B);
  await Promise.all([A, B].map(p => p.waitForFunction(() => __issen.G.phase === 'match', null, { timeout: 240000 })));
  const res = await Promise.all([A, B].map(p => p.evaluate(() => ({ h: __issen.G.history.map(x => x.name + ':' + x.winner).join(' '), s: __issen.P.map(p => p.score).join('-') }))));
  log('A の結果', res[0].s, res[0].h); log('B の結果', res[1].s, res[1].h);
  await A.waitForTimeout(4000);
  const note = await Promise.all([A, B].map(p => p.textContent('#o_note')));
  log('知らせ', note);
  await A.screenshot({ path: '/tmp/claude-0/shots/e2e-A.png' }); await B.screenshot({ path: '/tmp/claude-0/shots/e2e-B.png' });
  await browser.close();
  process.exit(res[0].h === res[1].h ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
