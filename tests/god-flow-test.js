// 運営アカウント（god_accounts）の通しテスト（本物のSupabaseは使わない）
// 確かめること: 銭が「無限」と出て減らない、ピックアップで選んだ刀が必ず出る、ふつうの人には出ないし使えない
// 使い方: PGHOST=<ソケットのフォルダ> PGPORT=<番号> node tests/god-flow-test.js
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
const TYPES = { p: 'jsonb', p_n: 'int', p_pick: 'text' };
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
  const G = 'g' + run + 'a', N = 'g' + run + 'b';
  user(G); user(N);
  sql("insert into public.god_accounts (id) values (:'id')", { id: USERS[G] });

  console.log('--- 運営アカウント');
  const p = await mk(browser);
  await login(p, G);
  await p.waitForFunction(() => __issen.isAccount(), null, { timeout: 15000 });
  await p.evaluate(() => goTitle()); await p.waitForTimeout(200);
  ok(/所持 無限 銭/.test((await st(p)).meta), 'タイトルに「所持 無限 銭」');
  await p.click('#m_gacha'); await p.waitForTimeout(300);
  ok(await p.textContent('#g_coins') === '無限', 'ガチャの銭が「無限」');
  ok(await p.isVisible('#g_pick') && await p.isEnabled('#g_pull1') && /十振り/.test(await p.textContent('#g_pull10')) && await p.isHidden('#g_all'), 'ピックアップの選択が出て、銭0でも引ける');
  await p.selectOption('#g_pick', 'ouka');
  await p.click('#g_pull10');
  await p.waitForFunction(() => GA.phase !== 'wait' && GA.phase !== 'idle', null, { timeout: 10000 });
  let v = server(G);
  ok(v.owned.ouka === 10 && v.coins === 0 && v.pulls === 10, '十振りすべて桜華、銭は減らない ' + JSON.stringify({ ouka: v.owned.ouka, coins: v.coins }));
  ok(await p.screenshot({ path: process.env.SHOT || '/tmp/god-gacha.png' }) && true, '画面を撮った');
  // 公開前の第二弾（八咫）は神様だけに見え、引ける
  const gb = await p.evaluate(() => [...document.querySelectorAll('#g_box .gbx')].map(b => b.textContent));
  ok(gb.length === 2 && /第二弾/.test(gb[0]) && /先/.test(gb[0]), '神様には公開前の第二弾が見える（先の印） ' + JSON.stringify(gb));
  const gp = await p.evaluate(() => ACCT.pull(10, null, 'b2').then(r => (r.got || []).map(g => g.id), e => e.message));
  const B2 = sql("select string_agg(id, ',') from public.katana_catalog where box = 'b2'").split(',');
  ok(Array.isArray(gp) && gp.length === 10 && gp.every(id => B2.includes(id)), '神様は第二弾を引ける（第二弾の刀だけ）');
  await p.evaluate(() => openGacha('book')); await p.waitForTimeout(200);
  ok(/第二弾/.test(await p.textContent('#g_grid')), '神様の刀帳に第二弾が出る');

  console.log('--- ふつうのアカウント');
  const q = await mk(browser);
  await login(q, N);
  await q.waitForFunction(() => __issen.isAccount(), null, { timeout: 15000 });
  await q.click('#m_gacha'); await q.waitForTimeout(300);
  ok(await q.textContent('#g_coins') === '0' && !(await q.isVisible('#g_pick')), '銭は0のまま、ピックアップは出ない');
  const r = await q.evaluate(() => ACCT.pull(1, 'ouka').then(() => 'got', e => e.message));
  ok(/ピックアップは使えません/.test(r), 'ピックアップを直接呼んでもサーバーが断る: ' + r);
  const nb = await q.evaluate(() => [...document.querySelectorAll('#g_box .gbx')].map(b => b.textContent));
  ok(nb.length === 1 && /第一弾/.test(nb[0]), 'ふつうの人には第二弾の箱が見えない ' + JSON.stringify(nb));
  const r2 = await q.evaluate(() => ACCT.pull(1, null, 'b2').then(() => 'got', e => e.message));
  ok(/その箱は引けません/.test(r2), '第二弾を直接引こうとしてもサーバーが断る: ' + r2);
  await q.evaluate(() => openGacha('book')); await q.waitForTimeout(200);
  const bt = await q.textContent('#g_grid');
  ok(!/第二弾/.test(bt) && /第一弾/.test(bt), 'ふつうの人の刀帳に第二弾は出ない');
  ok(!/八咫|\/50/.test(await q.textContent('#g_count')) , '刀帳の数も第一弾の分だけ: ' + (await q.textContent('#g_count')).slice(0, 14));

  await browser.close();
  console.log(fails ? 'NG ' + fails + '件' : 'すべてOK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
