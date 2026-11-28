// 番付の通しテスト（本物のSupabaseは使わない）
// ゲームの通信を横取りして、手元の PostgreSQL に入れた schema.sql / save-data.sql / ranking.sql で答える。
// 使い方: sh tests/ranking-db-test.sh を KEEP=1 で実行してデータベースを残し、
//         PGHOST=/var/tmp/issen-pgtest-rank PGPORT=5499 node tests/ranking-flow-test.js [写真の保存先]
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const path = require('path');
const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
const out = process.argv[2] || '.';
const PG = ['-h', process.env.PGHOST || '/var/tmp/issen-pgtest-rank', '-p', process.env.PGPORT || '5499', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'];
const sql = (q, vars) => execFileSync('psql', [...PG, '-q', ...Object.entries(vars || {}).flatMap(([k, v]) => ['-v', k + '=' + v])], { input: q + ';\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'OK ' : 'NG ') + msg); if (!c) fails++; };
// tests/ranking-db-test.sql が作った人たち
const USERS = { aaa: '11111111-1111-1111-1111-111111111111', bbb: '22222222-2222-2222-2222-222222222222' };
let sqlMissing = false, offline = false;
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = id => b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, aud: 'authenticated' }) + '.sig';
const TYPES = { p: 'jsonb', p_n: 'int', p_id: 'uuid', p_limit: 'int' };

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
      if (sqlMissing && /ranking|rating/.test(fn)) return json(404, { code: 'PGRST202', message: 'Could not find the function public.' + fn });
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
const rows = p => p.$$eval('#r_list li', ls => ls.map(l => l.innerText.replace(/\s+/g, ' ').trim()));

(async () => {
  const browser = await chromium.launch();
  console.log('--- ログイン前は番付を開けず、登録画面が出る（招待された人だけ）');
  const p = await mk(browser);
  await p.click('#m_rank'); await p.waitForTimeout(300);
  ok(await p.isVisible('#o_gate') && await p.isHidden('#rank'), '番付は開かず、ログインを促す');
  await p.screenshot({ path: out + '/rank-guest.png' });
  await p.click('#o_back');

  console.log('--- 甲でログインして番付を見る');
  await p.evaluate(() => localStorage.setItem('issen-action-cpu-v1', JSON.stringify({ best: 6 })));   // 新・一閃の CPU 戦で 6人抜き
  await login(p, 'aaa');
  await p.waitForFunction(() => IssenNet.user && IssenNet.profile, null, { timeout: 15000 });
  await p.click('#m_rank');
  await p.waitForFunction(() => document.querySelectorAll('#r_list li').length > 0, null, { timeout: 10000 });
  await p.waitForTimeout(900);
  let r = await rows(p);
  ok(r.length === 3, '自分とフレンド（申請中は除く）の3人: ' + JSON.stringify(r));
  ok(/甲/.test(r[0]) && /1074/.test(r[0]), '戦闘力の一位は甲 1074');
  ok(/二連勝中/.test(r[0]) && /8勝1敗/.test(r[0]), '勝ち負けと連勝が出る');
  ok(/戦闘力/.test(await p.textContent('#r_me')), '自分の欄が出る');
  await p.screenshot({ path: out + '/rank-power.png' });
  await p.click('.rtabs button[data-tab="cpu"]'); await p.waitForTimeout(900);
  r = await rows(p);
  ok(/乙/.test(r[0]) && /12人抜き/.test(r[0]) && /甲/.test(r[1]) && /7人抜き/.test(r[1]), '勝ち抜きの番付: ' + JSON.stringify(r));
  await p.screenshot({ path: out + '/rank-cpu.png' });
  await p.click('.rtabs button[data-tab="book"]'); await p.waitForTimeout(900);
  r = await rows(p);
  ok(/甲/.test(r[0]) && /3\/ \d+振り/.test(r[0]) && /^二/.test(r[1]) && /^二/.test(r[2]), '刀帳の番付（同じ数は同じ位）: ' + JSON.stringify(r));
  await p.screenshot({ path: out + '/rank-book.png' });

  console.log('--- 新・一閃に切り替える（今までの戦闘力は一閃の分）');
  await p.click('.rgame button[data-game="action"]');
  await p.click('.rtabs button[data-tab="power"]');
  await p.waitForFunction(() => /新・一閃/.test(document.getElementById('r_lead').textContent) && /1032/.test(document.getElementById('r_list').innerText), null, { timeout: 10000 });
  await p.waitForTimeout(900);
  r = await rows(p);
  ok(/甲/.test(r[0]) && /1032/.test(r[0]) && /2勝0敗/.test(r[0]) && /丙/.test(r[1]) && /1000/.test(r[1]) && /まだ対戦なし/.test(r[1]), '新・一閃の戦闘力は別: ' + JSON.stringify(r));
  await p.screenshot({ path: out + '/rank-action-power.png' });
  await p.click('.rtabs button[data-tab="cpu"]'); await p.waitForTimeout(900);
  r = await rows(p);
  ok(/甲/.test(r[0]) && /6人抜き/.test(r[0]), '新・一閃の勝ち抜き（端末の記録をアカウントへ送った）: ' + JSON.stringify(r));
  await p.click('.rgame button[data-game="issen"]'); await p.waitForTimeout(900);
  r = await rows(p);
  ok(/乙/.test(r[0]) && /12人抜き/.test(r[0]), '一閃に戻すと一閃の勝ち抜き: ' + JSON.stringify(r));

  console.log('--- 全員の番付（フレンドでない丁も出る。神様は出ない）');
  await p.click('.rscope button[data-scope="all"]');
  await p.click('.rtabs button[data-tab="cpu"]');
  await p.waitForFunction(() => /丁/.test(document.getElementById('r_list').innerText), null, { timeout: 10000 });
  await p.waitForTimeout(900);
  r = await rows(p);
  ok(/丁/.test(r[0]) && /30人抜き/.test(r[0]) && !r.some(x => /神/.test(x)), '全員の勝ち抜き（神様の99人抜きは出ない）: ' + JSON.stringify(r));
  ok(/三位　3人中/.test(await p.textContent('#r_me')), '自分の位: ' + (await p.textContent('#r_me')).replace(/\s+/g, ' '));
  await p.screenshot({ path: out + '/rank-all-cpu.png' });
  await p.click('.rtabs button[data-tab="power"]');
  await p.waitForFunction(() => /1074/.test(document.getElementById('r_list').innerText), null, { timeout: 10000 });
  r = await rows(p);
  ok(r.length === 3 && /甲/.test(r[0]) && /丙/.test(r[1]) && !/丁/.test(r.join()), '全員の戦闘力は対戦した人だけ: ' + JSON.stringify(r));
  await p.click('.rgame button[data-game="action"]');
  await p.waitForFunction(() => /1032/.test(document.getElementById('r_list').innerText), null, { timeout: 10000 });
  ok(true, '全員×新・一閃に切り替わる');
  await p.click('.rscope button[data-scope="friend"]'); await p.waitForTimeout(600);
  r = await rows(p);
  ok(r.length === 3 && /丙/.test(r.join()), 'フレンドに戻すとフレンドの番付: ' + JSON.stringify(r));


  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300);
  if (await p.isVisible('#r_ok')) await p.click('#r_ok');
  await p.click('.rtabs button[data-tab="power"]'); await p.waitForTimeout(900);
  const wide = await p.evaluate(() => document.getElementById('rank').scrollWidth <= window.innerWidth);
  ok(wide, '横にはみ出さない');
  await p.screenshot({ path: out + '/rank-portrait.png' });

  console.log('--- 試合のあとの戦闘力の表示');
  const mid = sql("select match_id from public.rating_log where user_id = :'me' and counted order by created_at desc limit 1", { me: USERS.aaa });
  const d = await p.evaluate(async id => (await IssenNet.sb.rpc('match_rating', { p_id: id })).data, mid);
  ok(d && typeof d.delta === 'number', 'match_rating で増減を読める ' + JSON.stringify(d));
  await p.setViewportSize({ width: 844, height: 390 });
  await p.click('#r_back');
  await p.evaluate(d => { startOnline({ me: 0, seed: 7, startAt: performance.now(), clockOff: 0, send: () => {}, oppName: '乙', myName: '甲' });
    P[0].score = 2; P[1].score = 1; G.history = [{ name: '先の先', winner: 0 }, { name: '疾風', winner: 1 }, { name: '止め', winner: 0 }];
    G.phase = 'match'; G.resultAt = gnow(); NET.rate = Object.assign({ at: performance.now() }, d, { delta: 18, before: 1056, after: 1074, streak: 3 }); }, d);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: out + '/rank-result.png' });

  await browser.close();
  console.log(fails ? 'NG ' + fails + '件' : 'すべてOK');
  process.exit(fails ? 1 : 0);
})();
