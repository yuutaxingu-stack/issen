// アカウント保存の通しテスト（本物のSupabaseは使わない）
// ゲームの通信を横取りして、手元の PostgreSQL に入れた schema.sql / save-data.sql で答える。
// 確かめること: 初回ログインの引っ越し、勝ちの銭、サーバーのガチャ、読み込み直し、ログアウト、
//               2台目の端末、電波が切れたときの記録待ち、SQL未実行のときに端末保存のまま動くこと
// 使い方: PGHOST=<ソケットのフォルダ> PGPORT=<番号> node tests/save-flow-test.js
//   （先に tests/supabase-stub.sql, supabase/schema.sql, supabase/save-data.sql を実行しておく）
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const path = require('path');
const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
const PG = ['-h', process.env.PGHOST || '/var/tmp/issenpg', '-p', process.env.PGPORT || '5499', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'];
const sql = (q, vars) => execFileSync('psql', [...PG, '-q', ...Object.entries(vars || {}).flatMap(([k, v]) => ['-v', k + '=' + v])], { input: q + ';\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'OK ' : 'NG ') + msg); if (!c) fails++; };

const run = Date.now() % 1e6;
const USERS = {};
function user(login){
  const id = sql("select gen_random_uuid()");
  sql("insert into auth.users values (:'id', jsonb_build_object('login', :'l', 'name', :'l'))", { id, l: login });
  USERS[login] = id; return id;
}
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = id => b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, aud: 'authenticated' }) + '.sig';
const TYPES = { p: 'jsonb', p_n: 'int' };
let sqlMissing = false, offline = false;

async function mk(browser, guest){
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } });
  if (guest) await ctx.addInitScript(g => { if (!localStorage.getItem('issen-wallet-v1')) {
    localStorage.setItem('issen-wallet-v1', JSON.stringify({ coins: g.coins, best: g.best }));
    localStorage.setItem('issen-armory-v1', JSON.stringify({ owned: g.owned, equip: g.equip, rec: g.rec })); } }, guest);
  await ctx.routeWebSocket(/realtime/, () => {});   // リアルタイムはつながない
  await ctx.route(/supabase\.co\//, async route => {
    const req = route.request(), u = new URL(req.url()), auth = req.headers()['authorization'] || '';
    const tok = auth.replace(/^Bearer /, ''); let me = null;
    try { me = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url')).sub; } catch (e) {}
    const json = (s, b) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/auth/v1/token') {
      const body = JSON.parse(req.postData() || '{}'); const login = String(body.email || '').split('@')[0];
      const id = USERS[login]; if (!id) return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      return json(200, { access_token: jwt(id), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r' + id,
        user: { id, aud: 'authenticated', role: 'authenticated', email: body.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
    }
    if (u.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, body: '' });
    if (u.pathname === '/rest/v1/profiles') return json(200, me ? JSON.parse(sql("select coalesce(json_agg(json_build_object('id',id,'login',login,'name',name,'code',code)),'[]') from public.profiles where id = :'me'", { me })) : []);
    if (u.pathname.startsWith('/rest/v1/rpc/')) {
      const fn = u.pathname.slice(13);
      if (offline) return route.abort('internetdisconnected');
      if (sqlMissing && /save|win|best|gacha|equip|import/.test(fn)) return json(404, { code: 'PGRST202', message: 'Could not find the function public.' + fn });
      if (!/^[a-z_]+$/.test(fn)) return json(400, { message: 'bad' });
      const body = JSON.parse(req.postData() || '{}'), vars = { me }, args = [];
      Object.entries(body).forEach(([k, v], i) => { vars['a' + i] = typeof v === 'string' ? v : JSON.stringify(v); args.push(k + " => :'a" + i + "'::" + (TYPES[k] || 'text')); });
      try {
        const out = sql("set role authenticated; set request.jwt.claim.sub = :'me'; select to_json(public." + fn + '(' + args.join(', ') + '))', vars);
        return route.fulfill({ status: 200, contentType: 'application/json', body: out.split('\n').pop() || 'null' });
      } catch (e) {
        const m = (String(e.stderr || e.message).match(/ERROR:\s+(.*)/) || [])[1] || 'error';
        return json(400, { code: 'P0001', message: m, details: null, hint: null });
      }
    }
    return json(200, []);   // friendships / invites など
  });
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('ページのエラー', String(e)); fails++; });
  await p.goto(url);
  await p.waitForFunction(() => window.IssenNet && IssenNet.ready, null, { timeout: 15000 });
  return p;
}
const login = async (p, l) => { await p.evaluate(l => IssenNet.signIn(l, 'pass1234'), l); };
const server = l => JSON.parse(sql("select to_json(s) from public.saves s where id = :'id'", { id: USERS[l] }) || 'null');
const st = p => p.evaluate(() => ({ coins: __issen.WALLET.coins, best: __issen.WALLET.best, owned: ARM.owned, rec: ARM.rec, equip: ARM.equip, acct: __issen.isAccount(),
  moved: localStorage.getItem('issen-moved-v1'), guest: JSON.parse(localStorage.getItem('issen-wallet-v1') || 'null'), meta: document.getElementById('m_meta').textContent }));

(async () => {
  const browser = await chromium.launch();
  const A = 's' + run + 'a';
  user(A);
  const guestA = { coins: 57, best: 3, owned: { mumei: 1, ruri: 2, nichirin: 1, kesareta_katana: 1 }, equip: ['ruri', 'mumei'], rec: { ruri: { '疾風': 4 } } };

  console.log('--- 1台目: ログイン前に遊んでいた記録を引っ越す');
  const p1 = await mk(browser, guestA);
  await login(p1, A);
  await p1.waitForFunction(() => __issen.isAccount(), null, { timeout: 15000 });
  let s = await st(p1), v = server(A);
  ok(s.coins === 57 && v.coins === 57, '銭 57 がアカウントへ（画面 ' + s.coins + ' / サーバー ' + v.coins + '）');
  ok(v.owned.ruri === 2 && v.owned.nichirin === 1 && !v.owned.kesareta_katana, '刀も引っ越し、知らない刀は捨てる ' + JSON.stringify(v.owned));
  ok(v.rec.ruri && v.rec.ruri['疾風'] === 4 && v.cpu_best === 3 && v.equip[0] === 'ruri', '戦績・最高記録・持たせた刀も引き継ぐ');
  ok(!!s.moved && s.guest.coins === 57, '端末の記録は消さずに残し、引っ越し済みの印をつける');
  await p1.evaluate(() => goTitle()); await p1.waitForTimeout(200);
  ok(/アカウントに保存中/.test((await st(p1)).meta), 'タイトルに「アカウントに保存中」');

  console.log('--- 勝ちの銭はサーバーが数える');
  await p1.evaluate(() => { WALLET.coins += 20; recordWin(0, '明鏡止水', 20); });
  await p1.waitForFunction(() => IssenSave.status().pending === 0, null, { timeout: 10000 });
  v = server(A); s = await st(p1);
  ok(v.coins === 77 && s.coins === 77 && v.rec.ruri['明鏡止水'] === 1, '明鏡止水で +20（サーバー ' + v.coins + '）');
  ok(server(A) && JSON.parse(sql("select coalesce(day_coins,0) from public.saves where id = :'id'", { id: USERS[A] })) === 20, '今日の銭として数えている');

  console.log('--- ガチャはサーバーが引く');
  await p1.click('#m_gacha'); await p1.waitForTimeout(300);
  const before = server(A);
  await p1.click('#g_pull1');
  await p1.waitForFunction(() => GA.phase === 'draw', null, { timeout: 10000 });
  v = server(A); s = await st(p1);
  const cnt = o => Object.values(o).reduce((a, b) => a + b, 0);
  ok(cnt(v.owned) === cnt(before.owned) + 1 && v.pulls === 1, '刀が1本増えた（サーバー）');
  ok(s.coins === v.coins && v.coins <= 67 + 30 && v.coins >= 67, '銭が10減った（重なれば戻る） 画面 ' + s.coins + ' / サーバー ' + v.coins);
  await p1.evaluate(() => { WALLET.coins = 99999; refreshCoins(); });
  await p1.waitForFunction(() => GA.phase === 'shown' || GA.phase === 'draw', null);
  await p1.evaluate(() => { GA.phase = 'idle'; doPull(50); });
  await p1.waitForFunction(() => GA.phase !== 'wait', null, { timeout: 10000 });
  ok(/銭が足りません/.test(await p1.textContent('#g_msg')), '画面の銭を書き換えても、サーバーが断る: ' + await p1.textContent('#g_msg'));
  ok((await st(p1)).coins === server(A).coins, '断られた後は正しい銭に戻る');
  await p1.click('#g_back');

  console.log('--- 持たせる刀');
  await p1.evaluate(() => { ARM.equip[1] = 'nichirin'; ACCT.equip(ARM.equip); });
  await p1.waitForFunction(() => IssenSave.status().pending === 0, null, { timeout: 10000 });
  ok(server(A).equip[1] === 'nichirin', '藍に日輪を持たせたのが保存された');

  console.log('--- 電波が切れているあいだの勝ち');
  offline = true;
  await p1.evaluate(() => { WALLET.coins += 1; recordWin(0, '疾風', 1); });
  await p1.waitForTimeout(1500);
  ok((await p1.evaluate(() => IssenSave.status().pending)) === 1, '届かなかった勝ちは端末で待つ');
  offline = false;
  const c0 = server(A).coins;
  await p1.evaluate(() => IssenSave.flush());
  await p1.waitForFunction(() => IssenSave.status().pending === 0, null, { timeout: 10000 });
  ok(server(A).coins === c0 + 1 && (await st(p1)).coins === c0 + 1, '電波が戻ったら届いた');

  console.log('--- 読み込み直し（アップデート後にページを開き直すのと同じ）');
  const keep = server(A);
  await p1.reload();
  await p1.waitForFunction(() => window.__issen && __issen.isAccount(), null, { timeout: 15000 });
  v = server(A); s = await st(p1);
  ok(v.imports === 1 && v.coins === keep.coins && s.coins === keep.coins, '二重に引っ越さず、銭もそのまま（' + v.coins + '）');

  console.log('--- ログアウトすると端末の記録に戻る');
  await p1.evaluate(() => IssenNet.signOut());
  await p1.waitForFunction(() => !__issen.isAccount(), null, { timeout: 10000 });
  s = await st(p1);
  ok(s.coins === 57 && s.owned.ruri === 2, '端末の記録（57銭）で遊べる');

  console.log('--- 2台目の端末（別の記録あり）で同じアカウント');
  const p2 = await mk(browser, { coins: 5, best: 7, owned: { mumei: 1, mugen: 1 }, equip: ['mugen', 'mumei'], rec: {} });
  const k2 = server(A);
  await login(p2, A);
  await p2.waitForFunction(() => __issen.isAccount(), null, { timeout: 15000 });
  v = server(A); s = await st(p2);
  ok(v.coins === k2.coins + 5 && v.owned.mugen >= 1 && v.cpu_best === 7 && s.coins === v.coins, '2台目の分が足されて、1台目の分も残る（' + v.coins + '銭）');

  console.log('--- 3台目: 何もない端末でログイン');
  const p3 = await mk(browser, null);
  await login(p3, A);
  await p3.waitForFunction(() => __issen.isAccount(), null, { timeout: 15000 });
  s = await st(p3);
  ok(s.coins === server(A).coins && s.owned.ruri === 2 && !s.moved, '同じ銭と刀が見える。空の記録は引っ越さない');

  console.log('--- SQL をまだ実行していないとき');
  sqlMissing = true;
  const B = 's' + run + 'b'; user(B);
  const p4 = await mk(browser, { coins: 9, best: 0, owned: { mumei: 1 }, equip: ['mumei', 'mumei'], rec: {} });
  await login(p4, B);
  await p4.waitForFunction(() => IssenNet.profile, null, { timeout: 15000 }); await p4.waitForTimeout(1000);
  s = await st(p4);
  ok(!s.acct && s.coins === 9 && !s.moved, 'ログインしても端末の記録のまま遊べる（壊れない）');
  sqlMissing = false;

  await browser.close();
  console.log(fails ? 'NG ' + fails + '件' : 'すべてOK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
