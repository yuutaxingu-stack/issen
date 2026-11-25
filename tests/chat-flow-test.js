// 寄合（オープンチャット）の通しテスト（本物のSupabaseは使わない）
// ゲームの通信を横取りして、手元の PostgreSQL に入れた chat.sql などで答える。リアルタイムの知らせは C.feed でまねる。
// 使い方: KEEP=1 sh tests/chat-db-test.sh のあと
//         PGHOST=/var/tmp/issen-pgtest-chat PGPORT=5498 node tests/chat-flow-test.js [写真の保存先]
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const path = require('path');
const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
const out = process.argv[2] || '.';
const PG = ['-h', process.env.PGHOST || '/var/tmp/issen-pgtest-chat', '-p', process.env.PGPORT || '5498', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'];
const sql = (q, vars) => execFileSync('psql', [...PG, '-q', ...Object.entries(vars || {}).flatMap(([k, v]) => ['-v', k + '=' + v])], { input: q + ';\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'OK ' : 'NG ') + msg); if (!c) fails++; };
const U = { aaa: '11111111-1111-1111-1111-111111111111', bbb: '22222222-2222-2222-2222-222222222222', ccc: '33333333-3333-3333-3333-333333333333' };
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = id => b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, aud: 'authenticated' }) + '.sig';
const TYPES = { p_id: 'bigint', p_mentions: 'uuid[]', p_to: 'uuid', p_target: 'uuid', p_mute: 'boolean', p_ref: 'jsonb', p_accept: 'boolean', p_report: 'jsonb' };
const TABLES = ['chat_messages', 'chat_mutes', 'friendships', 'profiles', 'invites'];
const COLS = /^[a-z_]+$/;
let noChat = false;

// PostgREST の問い合わせの一部を SQL に直す（テストで使う分だけ）
function restSelect(table, q, me){
  const where = [], vars = { me }; let order = '', limit = '', n = 0;
  for (const [k, v] of q) {
    if (k === 'select') continue;
    if (k === 'order') { order = ' order by ' + v.split(',').map(x => { const [c, d] = x.split('.'); if (!COLS.test(c)) throw 0; return c + (d === 'desc' ? ' desc' : ''); }).join(','); continue; }
    if (k === 'limit') { limit = ' limit ' + (parseInt(v, 10) || 0); continue; }
    if (!COLS.test(k)) throw 0;
    const m = v.match(/^(eq|gt|lt|in)\.(.*)$/); if (!m) continue;
    const key = 'v' + (n++);
    if (m[1] === 'in') { vars[key] = '{' + m[2].replace(/^\(|\)$/g, '') + '}'; where.push(k + "::text = any(:'" + key + "'::text[])"); }
    else { vars[key] = m[2]; where.push(k + '::text ' + { eq: '=', gt: '>', lt: '<' }[m[1]] + " :'" + key + "'"); if (m[1] === 'gt' && k === 'id') where[where.length - 1] = "id > :'" + key + "'::bigint"; }
  }
  return sql("set role authenticated; set request.jwt.claim.sub = :'me'; select coalesce(jsonb_agg(t), '[]') from (select * from public." + table +
    (where.length ? ' where ' + where.join(' and ') : '') + order + limit + ') t', vars).split('\n').pop();
}

async function mk(browser, vp){
  const ctx = await browser.newContext({ viewport: vp || { width: 844, height: 390 } });
  await ctx.routeWebSocket(/realtime/, () => {});
  await ctx.route(/supabase\.co\//, async route => {
    const req = route.request(), u = new URL(req.url()), auth = req.headers()['authorization'] || '';
    let me = null; try { me = JSON.parse(Buffer.from(auth.replace(/^Bearer /, '').split('.')[1], 'base64url')).sub; } catch (e) {}
    const json = (s, b) => route.fulfill({ status: s, contentType: 'application/json', body: typeof b === 'string' ? b : JSON.stringify(b) });
    if (u.pathname === '/auth/v1/token') {
      const body = JSON.parse(req.postData() || '{}'); const id = U[String(body.email || '').split('@')[0]];
      if (!id) return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      return json(200, { access_token: jwt(id), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r' + id,
        user: { id, aud: 'authenticated', role: 'authenticated', email: body.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
    }
    if (u.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, body: '' });
    const t = u.pathname.replace('/rest/v1/', '');
    if (TABLES.includes(t)) {
      if (noChat && /^chat/.test(t)) return json(404, { code: '42P01', message: 'relation "public.' + t + '" does not exist' });
      if (!me) return json(200, []);
      try {
        const rows = restSelect(t, u.searchParams, me);
        if (/object\+json/.test(req.headers()['accept'] || '')) { const a = JSON.parse(rows); return a.length ? json(200, a[0]) : json(406, { code: 'PGRST116', message: 'no rows' }); }
        return json(200, rows);
      } catch (e) { return json(400, { message: 'bad query' }); }
    }
    if (u.pathname.startsWith('/rest/v1/rpc/')) {
      const fn = u.pathname.slice(13);
      if (!/^[a-z_]+$/.test(fn)) return json(400, { message: 'bad' });
      const body = JSON.parse(req.postData() || '{}'), vars = { me }, args = [];
      Object.entries(body).forEach(([k, v], i) => {
        if (v === null) { args.push(k + ' => null'); return; }
        vars['a' + i] = Array.isArray(v) ? '{' + v.join(',') + '}' : typeof v === 'string' ? v : JSON.stringify(v);
        args.push(k + " => :'a" + i + "'::" + (TYPES[k] || 'text'));
      });
      try {
        const o = sql("set role authenticated; set request.jwt.claim.sub = :'me'; select to_json(public." + fn + '(' + args.join(', ') + '))', vars);
        return json(200, o.split('\n').pop() || 'null');
      } catch (e) {
        const m = (String(e.stderr || e.message).match(/ERROR:\s+(.*)/) || [])[1] || 'error';
        return json(400, { code: 'P0001', message: m, details: null, hint: null });
      }
    }
    return json(200, []);
  });
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('ページのエラー', String(e)); fails++; });
  await p.goto(url);
  await p.waitForFunction(() => window.IssenNet && IssenNet.ready, null, { timeout: 15000 });
  return p;
}
const login = async (p, l) => { await p.evaluate(l => IssenNet.signIn(l, 'pass1234'), l); await p.waitForFunction(() => IssenNet.user && IssenNet.profile && IssenNet.friends.length && window.IssenChat.ok, null, { timeout: 15000 }); };
const lines = p => p.$$eval('#c_list li', ls => ls.map(l => l.innerText.replace(/\s+/g, ' ').trim()));
const row = id => JSON.parse(sql("select row_to_json(m) from public.chat_messages m where id = :'id'", { id }));
const asUser = (who, q) => sql("set request.jwt.claim.sub = '" + U[who] + "'; " + q);
const unstick = () => sql("update public.chat_messages set created_at = created_at - interval '10 seconds'");

(async () => {
  const browser = await chromium.launch();
  sql('delete from public.chat_messages; delete from public.chat_mutes; delete from public.matches; delete from public.invites');

  console.log('--- ログイン前は入口が出ない');
  const a = await mk(browser);
  ok(await a.isHidden('#m_chat'), '寄合の入口は隠れている');

  console.log('--- 甲でログイン、乙は先に発言しておく');
  asUser('bbb', "select public.chat_post('今宵、一本いかが')"); unstick();
  await login(a, 'aaa');
  ok(await a.isVisible('#m_chat'), '入口が出る');
  await a.screenshot({ path: out + '/chat-title.png' });
  await a.click('#m_chat'); await a.waitForTimeout(400);
  let L = await lines(a);
  ok(L.length === 1 && /乙/.test(L[0]) && /今宵/.test(L[0]), '乙の発言が見える: ' + JSON.stringify(L));

  console.log('--- @で乙を名指しして送る');
  await a.click('#c_at'); await a.waitForTimeout(200);
  await a.click('#c_sheet [data-pick="' + U.bbb + '"]');
  await a.type('#c_text', '受けて立とう');
  await a.click('#c_send'); await a.waitForTimeout(800);
  const last = JSON.parse(sql("select row_to_json(m) from public.chat_messages m order by id desc limit 1"));
  ok(last.body === '@乙 受けて立とう' && last.mentions.includes(U.bbb), '名指し付きで送られた: ' + last.body);
  L = await lines(a);
  ok(L.length === 2 && /@乙/.test(L[1]), '自分の発言が並ぶ');
  console.log('--- すぐもう一度送ると止められる');
  await a.type('#c_text', '連投'); await a.click('#c_send'); await a.waitForTimeout(600);
  ok(/少し待って/.test(await a.textContent('#o_note')), '連投の注意: ' + await a.textContent('#o_note'));
  await a.fill('#c_text', ''); unstick();

  console.log('--- 乙の画面: 名指しの知らせと印');
  const b = await mk(browser, { width: 390, height: 844 });
  if (await b.isVisible('#r_ok')) await b.click('#r_ok');
  await login(b, 'bbb');
  await b.evaluate(() => { const C = IssenChat; C.lastRead = 0; C.render(); });
  const badge = await b.textContent('#m_chat_b');
  ok(/名指し 1/.test(badge), 'タイトルの入口に「名指し」の印: ' + badge);
  await b.screenshot({ path: out + '/chat-badge.png' });
  // 甲から乙へ新しい名指しが届いた（リアルタイムのまね）
  const nid = asUser('aaa', "select public.chat_post('@乙 いざ', array['" + U.bbb + "']::uuid[])").split('\n').pop(); unstick();
  await b.evaluate(r => IssenChat.feed({ eventType: 'INSERT', new: r }), row(nid));
  await b.waitForTimeout(300);
  ok(await b.isVisible('#c_herald') && /甲/.test(await b.textContent('#c_herald')), '名指しの知らせが出る: ' + (await b.textContent('#c_herald')).trim());
  await b.screenshot({ path: out + '/chat-herald.png' });
  await b.click('#c_herald'); await b.waitForTimeout(400);
  ok(await b.isVisible('#chat'), '知らせを押すと寄合が開く');
  ok((await b.$$('#c_list li.forme')).length === 2, '自分あての発言は朱の線');
  await b.screenshot({ path: out + '/chat-portrait.png' });
  ok(await b.evaluate(() => document.getElementById('chat').scrollWidth <= innerWidth), '縦向きでも横にはみ出さない');
  await b.click('#c_back');
  ok(await b.isHidden('#m_chat_b'), '読んだら印が消える');

  console.log('--- 内緒: 甲→乙は丙に見えない');
  asUser('aaa', "select public.chat_post('内緒だが', '{}', '" + U.bbb + "')"); unstick();
  ok(sql("set role authenticated; set request.jwt.claim.sub = '" + U.ccc + "'; select count(*) from public.chat_messages where to_id is not null").split('\n').pop() === '0', '丙には見えない');

  console.log('--- 相手求む → 乙が受けて立つ → 二人とも対戦へ');
  await a.click('#c_rec'); await a.waitForTimeout(700);
  ok(/募集をしめる/.test(await a.textContent('#c_rec')), '自分の募集が出る');
  const rid = sql("select id from public.chat_messages where kind = 'recruit' order by id desc limit 1");
  await a.evaluate(() => { window.__started = null; IssenNet.onMatch = (id, me) => { window.__started = [id, me]; }; });
  await b.evaluate(() => { window.__started = null; IssenNet.onMatch = (id, me) => { window.__started = [id, me]; }; });
  await b.evaluate(r => IssenChat.feed({ eventType: 'INSERT', new: r }), row(rid));
  await b.click('#m_chat'); await b.waitForTimeout(300);
  await b.screenshot({ path: out + '/chat-recruit.png' });
  await b.click('[data-take="' + rid + '"]'); await b.waitForTimeout(800);
  const sb = await b.evaluate(() => window.__started);
  ok(sb && sb[1] === 1, '乙は藍として対戦へ ' + JSON.stringify(sb));
  await a.evaluate(r => IssenChat.feed({ eventType: 'UPDATE', new: r }), row(rid));
  const sa = await a.evaluate(() => window.__started);
  ok(sa && sa[1] === 0 && sa[0] === sb[0], '甲は朱として同じ対戦へ');

  console.log('--- 立ち合いの知らせ');
  const rep = '{"h":["先の先:0","陽炎:1","止め:0"],"s":[2,1]}';
  asUser('aaa', "select public.report_result('" + sa[0] + "', '" + rep + "')");
  asUser('bbb', "select public.report_result('" + sa[0] + "', '" + rep + "')");
  for (const id of sql("select id from public.chat_messages where kind like 'match%' order by id").split('\n')) await a.evaluate(r => IssenChat.feed({ eventType: 'INSERT', new: r }), row(id));
  await a.click('#m_chat'); await a.waitForTimeout(400);
  L = await lines(a);
  ok(L.some(x => /甲 対 乙 立ち合い/.test(x)), '始まりの知らせ');
  ok(L.some(x => /甲 の勝ち 止め/.test(x) && /2－1/.test(x)), '終わりの知らせ（勝者・決着名・本数）: ' + L.filter(x => /勝ち/.test(x)));
  await a.screenshot({ path: out + '/chat-landscape.png' });

  console.log('--- 自分の発言を消す・乙を見えなくする');
  await a.click('#c_list li.mine .cwho'); await a.waitForTimeout(200);
  await a.click('#c_sheet [data-op="del"]'); await a.waitForTimeout(600);
  ok(!(await lines(a)).some(x => /受けて立とう/.test(x)), '消した発言は見えない');
  await a.click('#c_list li:not(.mine) .cwho'); await a.waitForTimeout(200);
  await a.screenshot({ path: out + '/chat-sheet.png' });
  await a.click('#c_sheet [data-op="mute"]'); await a.waitForTimeout(600);
  ok(!(await lines(a)).some(x => /今宵/.test(x)), '見えなくした人の発言は消える');
  await a.click('#c_mutes'); await a.click('#c_sheet [data-op="unmute"]'); await a.waitForTimeout(600);
  ok((await lines(a)).some(x => /今宵/.test(x)), '戻すとまた見える');

  console.log('--- chat.sql 未実行なら入口は「準備中」で、他は壊れない');
  noChat = true;
  const c = await mk(browser);
  await c.evaluate(() => IssenNet.signIn('ccc', 'pass1234'));
  await c.waitForFunction(() => IssenNet.user && IssenNet.profile, null, { timeout: 15000 }); await c.waitForTimeout(800);
  ok(/準備中/.test(await c.textContent('#m_chat_s')), '準備中: ' + await c.textContent('#m_chat_s'));

  await browser.close();
  console.log(fails ? 'NG ' + fails + '件' : 'すべてOK');
  process.exit(fails ? 1 : 0);
})();
