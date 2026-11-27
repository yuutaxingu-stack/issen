// 名乗り・文箱・お知らせの通しテスト（本物のSupabaseは使わない。手元の PostgreSQL に向ける）
// 確かめること: 神様が一閃を決めた人へ二つ名・桜華を持つ人へ背景を送る → 受け取る → 名乗りに出る、お知らせと大事なお知らせ
// 使い方: KEEP=1 sh tests/profile-db-test.sh のあと PGHOST=/var/tmp/issen-pgtest-prof node tests/profile-flow-test.js [写真の保存先]
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const path = require('path');
const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
const PG = ['-h', process.env.PGHOST || '/var/tmp/issen-pgtest-prof', '-p', process.env.PGPORT || '5499', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'];
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
const TYPES = { p: 'jsonb', p_n: 'int', p_pick: 'text', p_id: 'bigint', p_ids: 'uuid[]', p_gifts: 'jsonb' };
const FNTYPES = { get_profile: { p_id: 'uuid' } };
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
    if (u.pathname === '/rest/v1/friendships' && me) return json(200, JSON.parse(sql("select coalesce(json_agg(f),'[]') from public.friendships f where :'me' in (a::text, b::text)", { me })));
    if (u.pathname.startsWith('/rest/v1/rpc/')) {
      const fn = u.pathname.slice(13);
      if (offline) return route.abort('internetdisconnected');
      if (sqlMissing && /save|win|best|gacha|equip|import/.test(fn)) return json(404, { code: 'PGRST202', message: 'Could not find the function public.' + fn });
      if (!/^[a-z_]+$/.test(fn)) return json(400, { message: 'bad' });
      const body = JSON.parse(req.postData() || '{}'), vars = { me: me || '' }, args = [];
      Object.entries(body).forEach(([k, v], i) => {
        const ty = (FNTYPES[fn] || {})[k] || TYPES[k] || 'text';
        if (v == null) { args.push(k + ' => null::' + ty); return; }
        vars['a' + i] = Array.isArray(v) && ty.endsWith('[]') ? '{' + v.join(',') + '}' : typeof v === 'string' ? v : JSON.stringify(v);
        args.push(k + " => :'a" + i + "'::" + ty);
      });
      try {
        const out = sql("set role " + (me ? 'authenticated' : 'anon') + "; set request.jwt.claim.sub = :'me'; select to_json(public." + fn + '(' + args.join(', ') + '))', vars);
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


const OUT = process.argv[2] || '/tmp';
const notice = (kind, title, bodyText) => sql("insert into public.notices (kind, title, body) values (:'k', :'t', :'b') returning id", { k: kind, t: title, b: bodyText });

(async () => {
  const browser = await chromium.launch();
  const G = 'p' + run + 'g', A = 'p' + run + 'a', B = 'p' + run + 'b';
  user(G); user(A); user(B);
  sql("insert into public.god_accounts (id) values (:'id')", { id: USERS[G] });
  sql("update public.profiles set name = '風見' where id = :'id'", { id: USERS[A] });
  sql("insert into public.saves (id, owned, rec) values (:'id', '{\"mumei\":1,\"nichirin\":1}', '{\"nichirin\":{\"一閃\":2}}')", { id: USERS[A] });
  sql("insert into public.saves (id, owned) values (:'id', '{\"mumei\":1,\"ouka\":1}')", { id: USERS[B] });
  sql("insert into public.saves (id, owned) values (:'id', '{\"mumei\":1,\"ouka\":3}')", { id: USERS[G] });
  sql("insert into public.friendships (a, b, requester, status) values (least(:'x'::uuid, :'y'::uuid), greatest(:'x'::uuid, :'y'::uuid), :'x', 'accepted')", { x: USERS[A], y: USERS[B] });
  sql("update public.notices set deleted = true");
  notice('update', '第一弾の箱', '箱ガチャを始めました。');

  console.log('--- ログインしていなくても、お知らせが読める');
  const z = await mk(browser);
  await z.waitForSelector('#pf_corner:not([hidden])', { timeout: 8000 });
  await z.waitForFunction(() => !document.getElementById('pf_newsb').hidden, null, { timeout: 8000 });
  ok(true, 'タイトル左上に札、お知らせに「新」の印');
  ok(await z.isHidden('#pf_pop'), 'はじめて開いた人には、昔の大事なお知らせを出さない（そもそも無い）');
  await z.click('#pf_corner [data-go="news"]');
  await z.waitForSelector('.pfnews li');
  ok(/第一弾の箱/.test(await z.textContent('.pfnews')), 'お知らせの一覧');
  await z.screenshot({ path: OUT + '/news.png' });
  await z.click('#pf_back');
  ok(await z.isHidden('#pf_newsb'), '開いたら「新」が消える');
  await z.click('#pf_corner [data-go="mail"]');
  ok(/ログイン/.test(await z.textContent('#pf_body')), '文箱はログインを勧める');
  await z.click('#pf_back');

  console.log('--- 神様が送る');
  const g = await mk(browser);
  await login(g, G);
  await g.waitForFunction(() => __issen.isAccount() && __issen.isGod(), null, { timeout: 15000 });
  await g.evaluate(() => goTitle()); await g.waitForTimeout(200);
  await g.click('#pf_corner [data-go="mail"]');
  await g.click('#pf_tabs [data-tab="send"]');
  ok(sql("select count(*) from public.mail m where m.to_id = :'a' and m.subject = '一閃の誉れ'", { a: USERS[A] }) === '1' &&
     sql("select count(*) from public.mail m where m.to_id = :'b' and m.subject = '桜華の札'", { b: USERS[B] }) === '1' &&
     sql("select count(*) from public.mail m where m.to_id = :'g'", { g: USERS[G] }) === '0', '一閃の二つ名・桜華の背景は自動で届いた（神様には届かない）');
  await g.waitForSelector('#gf_logins');
  await g.waitForFunction(() => /自動で届く贈り物/.test(document.getElementById('pf_body').textContent), null, { timeout: 8000 });
  await g.fill('#gf_logins', '風見');
  await g.click('[data-act="preview"]');
  await g.waitForFunction(() => /^1人/.test((document.querySelector('.pfpv') || {}).textContent || ''), null, { timeout: 8000 });
  ok(/風見/.test(await g.textContent('.pfpv')), '名前で宛先を選べる: ' + await g.textContent('.pfpv'));
  await g.fill('#gf_subject', 'いつもありがとう'); await g.fill('#gf_coins', '100');
  await g.screenshot({ path: OUT + '/god-send.png', fullPage: true });
  await g.click('[data-act="send"]'); await g.click('[data-act="send"]');
  await g.waitForFunction(() => /1人に送りました/.test(document.getElementById('pf_body').textContent), null, { timeout: 8000 });
  ok(true, '名指しで銭を送った');
  // お知らせを書く（大事なお知らせ）
  await g.click('#pf_back');
  await g.click('#pf_corner [data-go="news"]');
  await g.click('#pf_tabs [data-tab="write"]');
  await g.click('[data-kind="important"]');
  await g.fill('#nf_title', '12月1日 メンテナンス');
  await g.fill('#nf_body', '2時から3時まで遊べません。\n\nご迷惑をおかけします。');
  await g.click('[data-act="post"]'); await g.click('[data-act="post"]');
  await g.waitForFunction(() => document.querySelectorAll('.pfnews li').length === 2, null, { timeout: 8000 });
  ok(true, '大事なお知らせを載せた');
  await g.click('#pf_back');
  await g.waitForTimeout(300);
  ok(await g.isHidden('#pf_pop'), '書いた本人には大きく出さない');

  console.log('--- 風見さん: 大事なお知らせ → 文箱で受け取る → 名乗り');
  const a = await mk(browser);
  await a.evaluate(() => localStorage.setItem('issen-news-pop-v1', '0'));   // 前から遊んでいる人のまね
  await a.reload(); await a.waitForFunction(() => window.IssenNet && IssenNet.ready, null, { timeout: 15000 });
  await a.waitForSelector('#pf_pop:not([hidden])', { timeout: 8000 });
  ok(/メンテナンス/.test(await a.textContent('#pf_pop')), '大事なお知らせがタイトルで出る');
  await a.screenshot({ path: OUT + '/news-pop.png' });
  await a.click('#pf_pok');
  await a.reload(); await a.waitForFunction(() => window.IssenNet && IssenNet.ready, null, { timeout: 15000 }); await a.waitForTimeout(1200);
  ok(await a.isHidden('#pf_pop'), '一度見たら二度は出ない');
  await login(a, A);
  await a.waitForFunction(() => __issen.isAccount(), null, { timeout: 15000 });
  await a.evaluate(() => goTitle());
  await a.waitForFunction(() => document.getElementById('pf_mailb').textContent === '2', null, { timeout: 8000 });
  ok(true, '文箱に「2」の印');
  await a.click('#pf_corner [data-go="mail"]');
  await a.waitForSelector('.pfmh');
  await a.click('.pfmh');
  await a.screenshot({ path: OUT + '/mail.png' });
  await a.click('[data-act="claimall"]');
  await a.waitForFunction(() => /一閃/.test((document.querySelector('.pfgot') || {}).textContent || '') && /銭 100/.test(document.querySelector('.pfgot').textContent), null, { timeout: 8000 });
  ok(true, 'まとめて受け取った（二つ名と銭）');
  await a.click('.pfgot [data-act="me"]');
  await a.waitForSelector('.pfcard');
  ok(/一閃/.test(await a.textContent('.pfnick')) && /一閃/.test(await a.textContent('.pfstats')), '名乗りに二つ名と一閃の回数');
  await a.click('[data-act="edit"]');
  await a.fill('#pf_word', '刹那に生きる');
  await a.selectOption('#pf_fav', 'nichirin');
  await a.click('[data-plate="tsuki"]');
  await a.click('[data-act="save"]');
  await a.waitForFunction(() => !document.getElementById('pf_word') && /刹那に生きる/.test(document.querySelector('.pfword').textContent), null, { timeout: 8000 });
  ok(sql("select word || ' ' || fav || ' ' || plate || ' ' || title from public.profile_ext where id = :'id'", { id: USERS[A] }) === '刹那に生きる nichirin tsuki issen', 'サーバーに名乗りが残った');
  await a.waitForTimeout(600);
  await a.screenshot({ path: OUT + '/profile-a.png' });

  console.log('--- 乙: 桜華の背景を受け取り、番付から風見さんの名乗りを見る');
  const b = await mk(browser);
  await login(b, B);
  await b.waitForFunction(() => __issen.isAccount(), null, { timeout: 15000 });
  await b.evaluate(() => goTitle());
  await b.waitForSelector('#pf_pop:not([hidden])', { timeout: 8000 });
  ok(true, 'はじめての人にも、3日以内の大事なお知らせは出る');
  await b.click('#pf_pok');
  await b.click('#pf_corner [data-go="mail"]');
  await b.waitForSelector('.pfmh'); await b.click('.pfmh'); await b.click('[data-claim]');
  await b.waitForFunction(() => /桜華/.test((document.querySelector('.pfgot') || {}).textContent || ''), null, { timeout: 8000 });
  await b.click('.pfgot [data-act="me"]'); await b.waitForSelector('[data-act="edit"]');
  await b.click('[data-act="edit"]'); await b.click('[data-plate="ouka"]'); await b.selectOption('#pf_fav', 'ouka');
  await b.fill('#pf_word', '散ってなお咲く');
  await b.click('[data-act="save"]');
  await b.waitForFunction(() => !document.getElementById('pf_word'), null, { timeout: 8000 });
  await b.waitForTimeout(700);
  await b.screenshot({ path: OUT + '/profile-ouka.png' });
  for (const [w, h, n] of [[390, 844, 'phone-tall'], [1180, 820, 'ipad']]) { await b.setViewportSize({ width: w, height: h }); await b.waitForTimeout(300); await b.screenshot({ path: OUT + '/profile-ouka-' + n + '.png' }); }
  await b.setViewportSize({ width: 844, height: 390 });
  await b.click('#pf_back');
  await b.click('#m_rank');
  await b.waitForFunction(() => /一閃/.test(document.getElementById('r_list').textContent), null, { timeout: 8000 });
  ok(true, '番付の名前に二つ名が添えられる');
  await b.screenshot({ path: OUT + '/rank-tag.png' });
  await b.click('#r_list li[data-pid="' + USERS[A] + '"]');
  await b.waitForFunction(() => /刹那に生きる/.test((document.querySelector('.pfword') || {}).textContent || ''), null, { timeout: 8000 });
  ok(!(await b.isVisible('[data-act="edit"]')), '番付から風見さんの名乗りが開き、書き換えはできない');
  await b.screenshot({ path: OUT + '/profile-other.png' });

  await browser.close();
  console.log(fails ? 'NG ' + fails + '件' : 'すべてOK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
