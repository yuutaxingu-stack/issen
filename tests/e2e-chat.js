// 本物のSupabaseで寄合を確かめる: 登録 → フレンド → 皆で・名指し・密書がリアルタイムで届くか → 相手求む → 受けて立つ → 立ち合いの知らせ
// 使い方: node tests/e2e-chat.js <ログインIDの頭>   注意: 実際に2人の利用者が作られます（Authentication → Users から消せます）
const { chromium } = require('playwright');
const path = require('path');
const pre = process.argv[2] || ('c' + Date.now() % 100000);
const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
let fails = 0; const ok = (c, m) => { log((c ? 'OK ' : 'NG ') + m); if (!c) fails++; };
const wait = async (p, fn, arg, msg) => { try { await p.waitForFunction(fn, arg, { timeout: 15000 }); ok(true, msg); } catch (e) { ok(false, msg); } };
(async () => {
  const browser = await chromium.launch();
  const mk = async tag => {
    const p = await (await browser.newContext({ viewport: { width: 844, height: 390 } })).newPage();
    p.on('pageerror', e => log(tag, 'エラー', String(e)));
    await p.goto(url); await p.waitForFunction(() => window.IssenNet && IssenNet.ready, null, { timeout: 20000 });
    return p;
  };
  const A = await mk('A'), B = await mk('B');
  const signup = (p, l, n) => p.evaluate(([l, n]) => IssenNet.signUp(l, 'issen-test-pass', n).then(() => 'OK', e => e.message), [l, n]);
  log('登録', await signup(A, pre + '_a', '試甲'), await signup(B, pre + '_b', '試乙'));
  await A.waitForFunction(() => IssenNet.profile, null, { timeout: 20000 });
  await B.waitForFunction(() => IssenNet.profile, null, { timeout: 20000 });
  const cb = await B.evaluate(() => IssenNet.profile.code);
  await A.evaluate(c => IssenNet.request(c), cb);
  await B.waitForFunction(() => IssenNet.incoming.length > 0, null, { timeout: 60000 });
  await B.evaluate(() => IssenNet.respond(IssenNet.incoming[0].id, true));
  await A.waitForFunction(() => IssenNet.friends.length > 0 && IssenChat.ok, null, { timeout: 60000 });
  await B.waitForFunction(() => IssenChat.ok, null, { timeout: 20000 });
  log('フレンドになった・寄合の準備OK');
  await A.waitForTimeout(3000);   // リアルタイムの部屋に入るのを待つ
  const bid = await B.evaluate(() => IssenNet.user.id);
  await A.evaluate(id => IssenNet.sb.rpc('chat_post', { p_body: '@試乙 一本どうだ', p_mentions: [id], p_to: null }), bid);
  await wait(B, () => IssenChat.msgs.some(m => /一本どうだ/.test(m.body)), null, '皆での発言がリアルタイムで届いた');
  ok(/名指し/.test(await B.textContent('#c_herald')) && await B.isVisible('#c_herald'), '名指しの知らせ: ' + (await B.textContent('#c_herald')).trim());
  await A.waitForTimeout(3500);
  await A.evaluate(id => IssenNet.sb.rpc('chat_post', { p_body: '内緒の話', p_mentions: [], p_to: id }), bid);
  await wait(B, () => IssenChat.msgs.some(m => m.to_id && /内緒の話/.test(m.body)), null, '密書がリアルタイムで届いた');
  ok(/密書/.test(await B.textContent('#c_herald')), '密書の知らせ');
  await A.waitForTimeout(3500);
  await A.evaluate(() => { window.__m = null; IssenNet.onMatch = (id, me) => { window.__m = [id, me]; }; });
  await A.evaluate(() => IssenNet.sb.rpc('chat_post', { p_body: '', p_kind: 'recruit' }));
  await wait(B, () => IssenChat.msgs.some(m => m.kind === 'recruit' && m.ref.open), null, '相手求むが届いた');
  const rid = await B.evaluate(() => IssenChat.msgs.find(m => m.kind === 'recruit').id);
  const mid = await B.evaluate(async id => (await IssenNet.sb.rpc('chat_accept_recruit', { p_id: id })).data, rid);
  ok(!!mid, '受けて立つ → 対戦ができた');
  await wait(A, id => window.__m && window.__m[0] === id, mid, '募集した側も同じ対戦へ（リアルタイム）');
  await wait(B, () => IssenChat.msgs.some(m => m.kind === 'match_start'), null, '立ち合い開始の知らせが届いた');
  const rep = { h: ['先の先:0', '止め:0'], s: [2, 0] };
  await A.evaluate(([id, r]) => IssenNet.sb.rpc('report_result', { p_id: id, p_report: r }), [mid, rep]);
  await B.evaluate(([id, r]) => IssenNet.sb.rpc('report_result', { p_id: id, p_report: r }), [mid, rep]);
  await wait(B, () => IssenChat.msgs.some(m => m.kind === 'match_end' && m.ref.finish === '止め'), null, '終わりの知らせ（試甲の勝ち 止め）が届いた');
  await browser.close();
  log(fails ? 'NG ' + fails + '件' : 'すべてOK');
  process.exit(fails ? 1 : 0);
})();
