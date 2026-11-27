// 招待コードとログイン必須の通しテスト（本物のSupabaseは使わない）
// 確かめること: ログインしないとタイトルから先へ進めない、招待コードがないと登録できない、
//   神様が発行したコードで登録できる・2回目は使えない、招待のリンクでコードが入る、神様だけに発行の欄が出る
// 使い方: PGHOST=<ソケットのフォルダ> PGPORT=<番号> node tests/invite-flow-test.js [写真の保存先]
//   （先に KEEP=1 sh tests/invite-db-test.sh を実行しておく。PGHOST=/var/tmp/issen-pgtest-inv PGPORT=5497）
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const path = require('path');
const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
const OUT = process.argv[2] || '/tmp';
const PG = ['-h', process.env.PGHOST || '/var/tmp/issen-pgtest-inv', '-p', process.env.PGPORT || '5497', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'];
const sql = (q, vars) => execFileSync('psql', [...PG, '-q', ...Object.entries(vars || {}).flatMap(([k, v]) => ['-v', k + '=' + v])], { input: "set issen.no_invite = 'off';\n" + q + ';\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: Object.assign({}, process.env, { PGOPTIONS: '-c client_min_messages=warning' }) }).trim();
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'OK ' : 'NG ') + msg); if (!c) fails++; };

const run = Date.now() % 1e6;
const USERS = {};
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = id => b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, aud: 'authenticated' }) + '.sig';
const TYPES = { p: 'jsonb', p_n: 'int', p_pick: 'text' };
const session = (id, email) => ({ access_token: jwt(id), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r' + id,
  user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });

async function mk(browser, q){
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } });
  await ctx.routeWebSocket(/realtime/, () => {});
  await ctx.route(/supabase\.co\//, async route => {
    const req = route.request(), u = new URL(req.url()), auth = req.headers()['authorization'] || '';
    let me = null; try { me = JSON.parse(Buffer.from(auth.replace(/^Bearer /, '').split('.')[1], 'base64url')).sub; } catch (e) {}
    const json = (s, b) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/auth/v1/signup') {
      // 本物と同じく auth.users に入れる。トリガーが断れば「Database error saving new user」
      const body = JSON.parse(req.postData() || '{}'), login = String(body.email || '').split('@')[0];
      const id = sql('select gen_random_uuid()');
      try { sql("insert into auth.users values (:'id', :'m'::jsonb)", { id, m: JSON.stringify(body.data || {}) }); }
      catch (e) { return json(500, { code: 500, error_code: 'unexpected_failure', msg: 'Database error saving new user' }); }
      USERS[login] = id; return json(200, session(id, body.email));
    }
    if (u.pathname === '/auth/v1/token') {
      const body = JSON.parse(req.postData() || '{}'), id = USERS[String(body.email || '').split('@')[0]];
      if (!id) return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      return json(200, session(id, body.email));
    }
    if (u.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, body: '' });
    if (u.pathname === '/rest/v1/profiles') return json(200, me ? JSON.parse(sql("select coalesce(json_agg(json_build_object('id',id,'login',login,'name',name,'code',code)),'[]') from public.profiles where id = :'me'", { me })) : []);
    if (u.pathname.startsWith('/rest/v1/rpc/')) {
      const fn = u.pathname.slice(13);
      if (!/^[a-z_]+$/.test(fn)) return json(400, { message: 'bad' });
      const body = JSON.parse(req.postData() || '{}'), vars = { me: me || '' }, args = [];
      Object.entries(body).forEach(([k, v], i) => { vars['a' + i] = typeof v === 'string' ? v : JSON.stringify(v); args.push(k + " => :'a" + i + "'::" + (TYPES[k] || 'text')); });
      const setof = /^(invite_list|invite_create)$/.test(fn);
      try {
        const role = me ? "set role authenticated; set request.jwt.claim.sub = :'me';" : 'set role anon;';
        const call = 'public.' + fn + '(' + args.join(', ') + ')';
        const out = sql(role + (setof ? 'select coalesce(jsonb_agg(r), \'[]\') from ' + call + ' r' : 'select to_json(' + call + ')'), vars);
        let body2 = out.split('\n').pop() || 'null';
        if (fn === 'invite_create') body2 = JSON.stringify(JSON.parse(body2).map(r => r.r !== undefined ? r.r : r));
        return route.fulfill({ status: 200, contentType: 'application/json', body: body2 });
      } catch (e) {
        const m = (String(e.stderr || e.message).match(/ERROR:\s+(.*)/) || [])[1] || 'error';
        return json(400, { code: 'P0001', message: m, details: null, hint: null });
      }
    }
    return json(200, []);
  });
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('ページのエラー', String(e)); fails++; });
  await p.goto(url + (q || ''));
  await p.waitForFunction(() => window.IssenNet && IssenNet.ready, null, { timeout: 15000 });
  await p.waitForTimeout(200);
  return p;
}
async function signup(p, login, code){
  if (await p.isHidden('#online')) await p.click('#m_online');
  await p.click('#o_auth .otabs button[data-tab="up"]');
  await p.fill('#o_login', login); await p.fill('#o_pass', 'pass1234'); await p.fill('#o_name', login.slice(0, 10));
  if (code != null) await p.fill('#o_invite', code);
  await p.click('#o_ago');
  await p.waitForFunction(() => document.getElementById('o_amsg').textContent === '' || !!IssenNet.user || !/しています/.test(document.getElementById('o_amsg').textContent), null, { timeout: 10000 });
  await p.waitForTimeout(400);
  return p.evaluate(() => ({ user: !!IssenNet.user, msg: document.getElementById('o_amsg').textContent }));
}

(async () => {
  const browser = await chromium.launch();
  const G = 'kami' + run;
  USERS[G] = sql("set issen.no_invite = 'on'; insert into auth.users values (gen_random_uuid(), jsonb_build_object('login', :'l', 'name', '神様')) returning id", { l: G }).split('\n').pop();
  sql("insert into public.god_accounts (id) values (:'id')", { id: USERS[G] });

  console.log('--- ログインしていない人');
  const a = await mk(browser);
  ok(await a.isHidden('#online') && await a.isVisible('#pf_corner [data-go="news"]'), '開いた時はタイトル（お知らせは読める）');
  ok(await a.evaluate(() => document.getElementById('menu').classList.contains('locked')), 'タイトルのボタンが薄くなる');
  await a.click('#m_cpu'); await a.waitForTimeout(400);
  ok(await a.evaluate(() => __issen.G.mode === 'title') && await a.isVisible('#online') && await a.isVisible('#o_gate'), 'CPU戦を押しても始まらず、登録画面と「招かれた人だけ」の案内が出る');
  await a.screenshot({ path: OUT + '/invite-gate.png' });
  await a.click('#o_back');
  await a.click('#m_vs'); await a.waitForTimeout(300);
  ok(await a.evaluate(() => __issen.G.mode === 'title'), '二人対戦も始まらない');
  await a.click('#o_back');
  await a.click('#m_gacha'); await a.waitForTimeout(300);
  ok(await a.isHidden('#gacha'), 'ガチャも開かない');
  await a.click('#o_back');
  await a.click('#m_action'); await a.waitForTimeout(500);
  ok(/index\.html/.test(a.url()), '新・一閃へも行かない');
  let r = await signup(a, 'nocode' + run, '');
  ok(!r.user && /招待コードを入れて/.test(r.msg), 'コードなしは登録できない: ' + r.msg);
  r = await signup(a, 'nocode' + run, 'ABCD-2345');
  ok(!r.user && /招待コードが違う/.test(r.msg), 'でたらめなコードは登録できない: ' + r.msg);
  // 画面の確かめを飛ばして、Supabase の登録を直接呼んでもだめ
  const direct = await a.evaluate(l => IssenNet.sb.auth.signUp({ email: l + '@players.issen.app', password: 'pass1234', options: { data: { login: l, name: 'x' } } }).then(x => x.error ? x.error.message : 'registered'), 'hack' + run);
  ok(direct !== 'registered', '登録を直接呼んでも断られる: ' + direct);
  ok(sql("select count(*) from public.profiles where login = :'l'", { l: 'hack' + run }) === '0', 'サーバーに行が残らない');

  console.log('--- 神様がコードを発行');
  const g = await mk(browser);
  await g.click('#m_online');
  await g.click('#o_auth .otabs button[data-tab="in"]');
  await g.fill('#o_login', G); await g.fill('#o_pass', 'pass1234'); await g.click('#o_ago');
  await g.waitForFunction(() => !!IssenNet.user && IssenNet.isGod(), null, { timeout: 15000 });
  await g.waitForTimeout(300);
  ok(await g.isHidden('#online') && !(await g.evaluate(() => document.getElementById('menu').classList.contains('locked'))), 'ログインするとタイトルに戻り、遊べる');
  await g.click('#m_online'); await g.waitForTimeout(500);
  ok(await g.isVisible('#o_god'), '神様には「招待コード」の欄が出る');
  await g.fill('#o_imemo', 'たけし用'); await g.click('#o_iform button'); await g.waitForTimeout(800);
  await g.fill('#o_imemo', 'はなこ用'); await g.click('#o_iform button'); await g.waitForTimeout(800);
  const codes = JSON.parse(sql("select json_agg(code order by created_at) from public.invite_codes where created_by = :'g'", { g: USERS[G] }));
  ok(codes.length === 2 && (await g.textContent('#o_ilist')).includes('たけし用'), '発行すると一覧に出る ' + await g.textContent('#o_imsg'));
  await g.evaluate(() => { window.__copied = null; navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); }; });
  await g.click('#o_ilist button[data-ic="copy"]');
  const copied = await g.evaluate(() => window.__copied);
  ok(/招待コード [A-Z0-9]{4}-[A-Z0-9]{4}/.test(copied) && /\?invite=[A-Z0-9]{8}/.test(copied), '「写す」で招待の文（コードとリンク）が写せる');
  await g.screenshot({ path: OUT + '/invite-god.png' });

  console.log('--- コードで登録');
  r = await signup(a, 'takeshi' + run, codes[0].toLowerCase().replace(/(....)/, '$1 '));
  ok(r.user, 'もらったコードで登録できる（小文字・空白入りでも） ' + r.msg);
  await a.waitForTimeout(300);
  ok(await a.isHidden('#online') && !(await a.evaluate(() => document.getElementById('menu').classList.contains('locked'))), '登録するとタイトルに戻り、遊べる');
  await a.click('#m_cpu'); await a.waitForTimeout(500);
  ok(await a.evaluate(() => __issen.G.mode === 'cpu'), 'CPU戦が始まる');

  const b = await mk(browser);
  r = await signup(b, 'friend' + run, codes[0]);
  ok(!r.user && /招待コードが違うか、もう使われています/.test(r.msg), '同じコードは2回目に使えない: ' + r.msg);

  console.log('--- 招待のリンク');
  const c = await mk(browser, '?invite=' + codes[1]);
  ok(await c.isVisible('#o_invrow') && await c.inputValue('#o_invite') === codes[1], 'リンクで来ると「はじめて」が開き、コードが入っている');
  await c.screenshot({ path: OUT + '/invite-link.png' });
  r = await signup(c, 'hanako' + run, null);
  ok(r.user && !/invite=/.test(c.url()), 'そのまま登録でき、アドレスからコードが消える');

  await g.click('#o_back'); await g.click('#m_online'); await g.waitForTimeout(600);
  const list = await g.textContent('#o_ilist');
  ok(list.includes('takeshi' + run) && list.includes('hanako' + run) && list.includes('が使用'), '神様の一覧で誰が使ったか分かる');

  const n = await mk(browser);
  await n.click('#m_online');
  await n.fill('#o_login', 'takeshi' + run); await n.fill('#o_pass', 'pass1234'); await n.click('#o_ago');
  await n.waitForFunction(() => !!IssenNet.user, null, { timeout: 15000 }); await n.waitForTimeout(300);
  await n.click('#m_online'); await n.waitForTimeout(400);
  ok(await n.isHidden('#o_god'), 'ふつうの人には発行の欄が出ない');
  const hack = await n.evaluate(() => IssenNet.inviteCreate('x', 1).then(() => 'made', e => e.message));
  ok(/神様だけ/.test(hack), 'ふつうの人が直接呼んでも作れない: ' + hack);

  await browser.close();
  console.log(fails ? 'NG ' + fails + '件' : 'すべてOK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
