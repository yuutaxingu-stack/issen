// 団体戦の通しテスト（本物のSupabaseは使わない）
// 4つのページ（4人）で、部屋を作る → 寄合の「参陣」と同じ入口で入る → 出る順 → はじめる → 自分の番は試合・ほかの人は観戦 → 決着 まで。
// サーバーの代わり: 手元の PostgreSQL（tests/team-db-test.sh を KEEP=1 で実行して残したもの）と、
//                   このファイルの中の小さな「リアルタイム」のまね（部屋のチャンネルで送り物を配る）。
// 使い方: KEEP=1 sh tests/team-db-test.sh && node tests/team-flow-test.js [写真の保存先]
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const path = require('path');
const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
const out = process.argv[2] || '.';
const PG = ['-h', process.env.PGHOST || '/var/tmp/issen-pgtest-team', '-p', process.env.PGPORT || '5498', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'];
const sql = (q, vars) => execFileSync('psql', [...PG, '-q', ...Object.entries(vars || {}).flatMap(([k, v]) => ['-v', k + '=' + v])], { input: q + ';\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'OK ' : 'NG ') + msg); if (!c) fails++; };
const U = i => '00000000-0000-0000-0000-00000000000' + i;
const USERS = { user1: U(1), user2: U(2), user3: U(3), user4: U(4) };
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = id => b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, aud: 'authenticated' }) + '.sig';
const TYPES = { p: 'jsonb', p_n: 'int', p_id: 'uuid', p_room: 'uuid', p_user: 'uuid', p_to: 'uuid', p_loser: 'uuid', p_to_win: 'int', p_target: 'int', p_on: 'boolean', p_slots: 'uuid[]', p_report: 'jsonb', p_other: 'uuid', p_accept: 'boolean' };

/* ---------- リアルタイムのまね（Phoenix の決まりの、使う分だけ） ---------- */
const subs = new Set();   // { ws, topic, joinRef, self, pg: [{id, table, filter}] }
let pgId = 1;
function sendJson(ws, arr){ try { ws.send(JSON.stringify(arr)); } catch (e) {} }
function onWs(ws, owner){
  ws.onMessage(raw => {
    let m;
    if (typeof raw !== 'string') {
      const b = Buffer.from(raw); let o = 1;
      const jl = b[o++], rl = b[o++], tl = b[o++], el = b[o++], ml = b[o++], enc = b[o++];
      const take = n => { const s = b.slice(o, o + n).toString('utf8'); o += n; return s; };
      const joinRef = take(jl), ref = take(rl), topic = take(tl), event = take(el); take(ml);
      const payload = enc === 1 ? JSON.parse(b.slice(o).toString('utf8') || '{}') : null;
      m = [joinRef, ref, topic, 'broadcast', { type: 'broadcast', event, payload }];
    } else m = JSON.parse(raw);
    const [joinRef, ref, topic, event, payload] = m;
    if (topic === 'phoenix') return sendJson(ws, [null, ref, 'phoenix', 'phx_reply', { status: 'ok', response: {} }]);
    if (event === 'phx_join') {
      const cfg = (payload && payload.config) || {};
      const pg = (cfg.postgres_changes || []).map(x => Object.assign({ id: pgId++ }, x));
      subs.add({ ws, owner, topic, joinRef, self: !!(cfg.broadcast && cfg.broadcast.self), pg });
      return sendJson(ws, [joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: pg } }]);
    }
    if (event === 'phx_leave') { for (const s of subs) if (s.ws === ws && s.topic === topic) subs.delete(s); return sendJson(ws, [joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]); }
    if (process.env.RTLOG && /match/.test(topic)) console.log('rt', owner, event, topic.slice(-8), event === 'broadcast' ? JSON.stringify(payload.payload).slice(0, 60) : '');
    if (event === 'broadcast') {
      for (const s of subs) if (s.topic === topic && (s.ws !== ws || s.self)) setTimeout(() => sendJson(s.ws, [null, null, topic, 'broadcast', payload]), 20 + Math.random() * 60);
      if (ref) sendJson(ws, [joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]);
      return;
    }
    if (ref) sendJson(ws, [joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]);   // presence・access_token など
  });
  ws.onClose(() => { for (const s of subs) if (s.ws === ws) subs.delete(s); });
}
// 表が変わったことを知らせる（中身は気にせず、該当するチャンネルに配る）
function notify(table, record){
  for (const s of subs) for (const b of s.pg) {
    if (b.table !== table) continue;
    if (b.filter) { const [col, v] = b.filter.split('=eq.'); if (record && String(record[col]) !== v) continue; }
    sendJson(s.ws, [null, null, s.topic, 'postgres_changes', { ids: [b.id], data: { type: 'UPDATE', schema: 'public', table, commit_timestamp: new Date().toISOString(), record: record || {}, old_record: {}, columns: [], errors: null } }]);
  }
}
function notifyRooms(){
  const rooms = JSON.parse(sql("select coalesce(jsonb_agg(jsonb_build_object('id', id)), '[]') from public.team_rooms where status <> 'closed'"));
  for (const r of rooms) { notify('team_rooms', { id: r.id }); notify('team_members', { room_id: r.id }); notify('team_lineups', { room_id: r.id }); }
}

/* ---------- REST のまね ---------- */
function restSelect(table, u, me){
  const where = []; let order = '', limit = '';
  const vars = { me };
  let i = 0;
  for (const [k, v] of u.searchParams) {
    if (k === 'select') continue;
    if (k === 'order') { const [c, d] = v.split('.'); order = ' order by ' + c.replace(/[^a-z_]/g, '') + (d === 'desc' ? ' desc' : ''); continue; }
    if (k === 'limit') { limit = ' limit ' + (+v); continue; }
    const col = k.replace(/[^a-z_]/g, ''); const m = v.match(/^(eq|gt|in)\.(.*)$/); if (!m) continue;
    vars['w' + i] = m[2].replace(/^\(|\)$/g, '');
    if (m[1] === 'eq') where.push(col + "::text = :'w" + i + "'");
    else if (m[1] === 'gt') where.push(col + " > :'w" + i + "'");
    else where.push(col + "::text = any(string_to_array(:'w" + i + "', ','))");
    i++;
  }
  const q = "set role authenticated; set request.jwt.claim.sub = :'me'; select coalesce(jsonb_agg(t), '[]') from (select * from public." + table +
    (where.length ? ' where ' + where.join(' and ') : '') + order + limit + ') t';
  return JSON.parse(sql(q, vars).split('\n').pop());
}

async function mk(browser, tag){
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } });
  await ctx.routeWebSocket(/realtime/, ws => onWs(ws, tag));
  await ctx.route(/supabase\.co\//, async route => {
    const req = route.request(), u = new URL(req.url()), auth = req.headers()['authorization'] || '';
    let me = '';
    try { me = JSON.parse(Buffer.from(auth.replace(/^Bearer /, '').split('.')[1], 'base64url')).sub || ''; } catch (e) {}
    const json = (s, b) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/auth/v1/token') {
      const body = JSON.parse(req.postData() || '{}'); const login = String(body.email || '').split('@')[0];
      const id = USERS[login]; if (!id) return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      return json(200, { access_token: jwt(id), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r' + id,
        user: { id, aud: 'authenticated', role: 'authenticated', email: body.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
    }
    if (u.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, body: '' });
    if (u.pathname.startsWith('/rest/v1/rpc/')) {
      const fn = u.pathname.slice(13);
      if (!/^[a-z_]+$/.test(fn)) return json(400, { message: 'bad' });
      if (fn === 'chat_post') return json(404, { code: 'PGRST202', message: 'Could not find the function public.chat_post' });
      const body = JSON.parse(req.postData() || '{}'), vars = { me }, args = [];
      Object.entries(body).forEach(([k, v], i) => {
        if (v === null) { args.push(k + ' => null::' + (TYPES[k] || 'text')); return; }
        vars['a' + i] = Array.isArray(v) ? '{' + v.join(',') + '}' : typeof v === 'string' ? v : JSON.stringify(v);
        args.push(k + " => :'a" + i + "'::" + (TYPES[k] || 'text'));
      });
      try {
        const r = sql("set role authenticated; set request.jwt.claim.sub = :'me'; select to_json(public." + fn + '(' + args.join(', ') + '))', vars);
        if (/^team_|^report_result|^leave_match/.test(fn) && fn !== 'team_heartbeat' && fn !== 'team_current' && fn !== 'team_peek') setTimeout(notifyRooms, 30);
        if (fn === 'team_invite') { const inv = JSON.parse(sql("select row_to_json(i) from public.team_invites i order by created_at desc limit 1")); notify('team_invites', inv); }
        return route.fulfill({ status: 200, contentType: 'application/json', body: r.split('\n').pop() || 'null' });
      } catch (e) {
        const m = (String(e.stderr || e.message).match(/ERROR:\s+(.*)/) || [])[1] || 'error';
        return json(400, { code: 'P0001', message: m, details: null, hint: null });
      }
    }
    const t = u.pathname.replace('/rest/v1/', '');
    if (/^(profiles|friendships|team_rooms|team_members|team_lineups|team_invites|matches|invites)$/.test(t)) {
      const rows = restSelect(t, u, me);
      if (/vnd\.pgrst\.object/.test(req.headers()['accept'] || '')) {
        if (rows.length === 1) return json(200, rows[0]);
        return json(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains ' + rows.length + ' rows' });
      }
      return json(200, rows);
    }
    if (process.env.RTLOG) console.log('rest?', u.pathname);
    return json(200, []);
  });
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log(tag, 'ページのエラー', String(e)); fails++; });
  await p.goto(url);
  await p.waitForFunction(() => window.IssenNet && IssenNet.ready, null, { timeout: 15000 });
  await p.evaluate(l => IssenNet.signIn(l, 'pass1234'), tag);
  await p.waitForFunction(() => IssenNet.user && IssenNet.profile, null, { timeout: 15000 });
  return p;
}
// 試合中は適当に押す
// 試合ごとの決着を、試合が終わった瞬間に覚えておく（見出し → 決着）
const recorder = p => p.evaluate(() => {
  window.__done = {};
  setInterval(() => { const G = __issen.G, NET = __issen.NET; if (G.mode === 'online' && G.phase === 'match' && NET.tag && !window.__done[NET.tag])
    window.__done[NET.tag] = (NET.watch ? '観' : '戦') + ' ' + G.history.map(x => x.name + ':' + x.winner).join(' ') + (window.__dbg ? ' [' + NET.myName + '-' + NET.oppName + ' ' + Math.round(performance.now()) + ']' : ''); }, 100);
});
const bot = p => p.evaluate(() => {
  window.__bot = setInterval(() => { const G = __issen.G, NET = __issen.NET; if (G.mode !== 'online' || NET.watch || G.phase !== 'fight') return;
    if (Math.random() < 0.12) { const a = Math.random() < 0.7 ? 'iai' : 'mk'; window.dispatchEvent(new KeyboardEvent('keydown', { key: a === 'iai' ? 'a' : 's' })); } }, 100);
});
const PAGES = {};
const roomOf = id => JSON.parse(sql("select row_to_json(r) from public.team_rooms r where id = :'id'", { id }));

(async () => {
  sql("delete from public.team_rooms; delete from public.team_invites");
  const browser = await chromium.launch();
  const P = PAGES;
  for (const k of ['user1', 'user2', 'user3', 'user4']) P[k] = await mk(browser, k);
  const A = P.user1;

  console.log('--- 部屋を作る');
  await A.click('#m_team'); await A.waitForTimeout(400);
  await A.screenshot({ path: out + '/team-entry.png' });
  await A.click('.trule[data-rule="taisho"]');
  await A.selectOption('#t_towin', '1');
  await A.click('#t_create');
  await A.waitForFunction(() => IssenTeam.state().room && IssenTeam.state().room.code, null, { timeout: 10000 });
  const room = await A.evaluate(() => IssenTeam.state().room.id);
  ok(!!room, '部屋ができた ' + await A.evaluate(() => IssenTeam.state().room.code));

  console.log('--- 寄合の「参陣」と同じ入口（IssenTeam.join）で3人が入る');
  for (const k of ['user2', 'user3', 'user4']) { await P[k].evaluate(r => IssenTeam.join(r), room); await P[k].waitForTimeout(300); }
  await A.waitForFunction(() => IssenTeam.state().members.length === 4, null, { timeout: 10000 });
  ok(true, '4人そろった（ホストの画面にリアルタイムで反映）');
  const teams = await A.evaluate(() => IssenTeam.state().members.map(m => m.name + ':' + m.team).join(' '));
  ok(teams === '人1:red 人2:blue 人3:red 人4:blue', '赤と青に分かれた: ' + teams);

  console.log('--- 赤の出る順を変える（人3を先鋒に）');
  await P.user3.waitForSelector('select[data-slot="0"]');
  await P.user3.selectOption('select[data-slot="0"]', U(3));
  await P.user3.waitForTimeout(600);
  await A.waitForFunction(u => (IssenTeam.state().lineups.red || [])[0] === u, U(3), { timeout: 8000 });
  ok(true, '同じチームの人1にも新しい順が見える');
  ok(await P.user2.evaluate(() => !IssenTeam.state().lineups.red), '青の人2には赤の順が見えない');
  await P.user3.evaluate(() => { const b = document.querySelector('#t_say input'); b.value = 'よろしく'; document.getElementById('t_say').requestSubmit(); });
  await A.waitForFunction(() => /よろしく/.test(document.getElementById('t_log').textContent), null, { timeout: 5000 });
  ok(true, '部屋の一言が届く');
  await A.screenshot({ path: out + '/team-lobby.png' });
  await P.user3.screenshot({ path: out + '/team-lobby-red.png' });

  console.log('--- はじめる');
  for (const k in P) { await bot(P[k]); await recorder(P[k]); }
  await A.click('[data-ta="start"]');
  // 先鋒: 人3（赤） 対 人2（青）。人1と人4は観戦
  await Promise.all([P.user3, P.user2].map(p => p.waitForFunction(() => __issen.G.mode === 'online' && !__issen.NET.watch, null, { timeout: 30000 })));
  ok(true, '先鋒の二人（人3・人2）の試合が始まった');
  await Promise.all([A, P.user4].map(p => p.waitForFunction(() => __issen.G.mode === 'online' && __issen.NET.watch, null, { timeout: 30000 })));
  ok(true, 'ほかの二人（人1・人4）は観戦している');
  await P.user3.waitForTimeout(2500);
  await P.user3.screenshot({ path: out + '/team-bout.png' });
  await A.screenshot({ path: out + '/team-watch.png' });
  try { await Promise.all([P.user3, P.user2, A, P.user4].map(p => p.waitForFunction(() => Object.keys(window.__done).some(k => /先鋒/.test(k)), null, { timeout: 120000 }))); }
  catch (e) { for (const k in P) console.log(k, await P[k].evaluate(() => JSON.stringify({ done: window.__done, mode: __issen.G.mode, ph: __issen.G.phase, tag: __issen.NET.tag, w: __issen.NET.watch, note: document.getElementById('o_note').textContent, h: __issen.G.history }))); throw e; }
  const hs = await Promise.all([P.user3, P.user2, A, P.user4].map(p => p.evaluate(() => { const k = Object.keys(window.__done).find(k => /先鋒/.test(k)); return window.__done[k]; })));
  ok(hs.every(h => h.slice(2) === hs[0].slice(2)) && hs.filter(h => h[0] === '観').length === 2, '二人と観戦者の決着が一致: ' + hs.join(' / '));
  await A.waitForTimeout(800);
  await A.screenshot({ path: out + '/team-watch-end.png' });
  const r1 = roomOf(room);
  ok(r1.state.bouts.length >= 1 && r1.state.bouts[0].label === '先鋒' && r1.state.bouts[0].w === (hs[0].endsWith(':0') ? U(3) : U(2)), '先鋒の勝者が部屋に記録された');

  console.log('--- 大将戦（人1 対 人4）は自動で始まる');
  await Promise.all([A, P.user4].map(p => p.waitForFunction(() => Object.keys(window.__done).some(k => /　大将$/.test(k)), null, { timeout: 240000 })));
  const hs2 = await Promise.all([A, P.user4, P.user2, P.user3].map(p => p.evaluate(() => { const k = Object.keys(window.__done).find(k => /　大将$/.test(k)); return k ? window.__done[k] : ''; })));
  ok(hs2[0][0] === '戦' && hs2[1][0] === '戦', '大将の二人は観戦から自分の試合に切り替わった');
  ok(hs2.filter(Boolean).every(h => h.slice(2) === hs2[0].slice(2)), '大将戦も観戦者と一致: ' + hs2.join(' / '));
  // 決着がつくまで（同点なら代表戦）
  for (let i = 0; i < 40; i++) { const r = roomOf(room); if (r.status === 'done') break; await A.waitForTimeout(1500); }
  const fin = roomOf(room);
  ok(fin.status === 'done' && /^(red|blue)$/.test(fin.state.winner), '決着: ' + fin.state.winner + ' ' + JSON.stringify(fin.state.score) + ' 試合数 ' + fin.state.bouts.length);
  ok(sql('select count(*) from public.rating_log') === '0', '戦闘力は動かない');
  // 結果を少し見せたあと、自動で部屋の画面に戻り、決着の幕が出る
  await A.waitForFunction(() => !document.getElementById('t_turn').hidden, null, { timeout: 20000 });
  await A.waitForTimeout(900);
  await A.screenshot({ path: out + '/team-finale.png' });
  await A.waitForFunction(() => !document.getElementById('team').hidden && IssenTeam.state().room.status === 'done' && document.getElementById('t_turn').hidden, null, { timeout: 20000 });
  ok(true, '決着の幕のあと、部屋の画面に戻った');
  await P.user2.waitForFunction(() => !document.getElementById('team').hidden && __issen.G.mode === 'title', null, { timeout: 20000 });
  ok(true, '先に試合を終えた人も部屋の画面に戻っている');
  await A.screenshot({ path: out + '/team-done.png' });
  await P.user2.waitForTimeout(500);
  await P.user2.screenshot({ path: out + '/team-done-blue.png' });

  console.log('--- もう一度 → 自由戦にして始める');
  await A.click('[data-ta="again"]');
  await A.waitForFunction(() => IssenTeam.state().room.status === 'lobby', null, { timeout: 8000 });
  await A.selectOption('#t_srule', 'free'); await A.selectOption('#t_starget', '2'); await A.click('#t_ssave');
  await A.waitForFunction(() => IssenTeam.state().room.rule === 'free', null, { timeout: 8000 });
  for (const k in P) await P[k].evaluate(() => clearInterval(window.__bot));
  await A.click('[data-ta="start"]');
  await A.waitForFunction(() => IssenTeam.state().room.status === 'playing', null, { timeout: 8000 });
  await A.waitForTimeout(600);
  await A.screenshot({ path: out + '/team-free.png' });
  await P.user2.waitForSelector('[data-ta="hand"]', { timeout: 8000 });
  await P.user2.click('[data-ta="hand"]');
  await A.waitForTimeout(800);
  ok(/人2/.test(await A.textContent('#t_body')), '青の人2が挑む者に並んだ');
  await A.click('[data-ta="finish"]'); await A.click('[data-ta="finish"]');
  await A.waitForFunction(() => IssenTeam.state().room.status === 'done', null, { timeout: 8000 });
  ok(true, 'ホストが終わらせられる');

  console.log('--- 縦向きのスマホでも崩れない');
  await A.setViewportSize({ width: 390, height: 844 }); await A.waitForTimeout(300);
  if (await A.isVisible('#r_ok')) await A.click('#r_ok');
  ok(await A.evaluate(() => document.getElementById('team').scrollWidth <= window.innerWidth), '横にはみ出さない');
  await A.screenshot({ path: out + '/team-portrait.png' });
  await A.click('[data-ta="again"]'); await A.waitForTimeout(800);
  await A.screenshot({ path: out + '/team-portrait-lobby.png', fullPage: true });

  await browser.close();
  console.log(fails ? 'NG ' + fails + '件' : 'すべてOK');
  process.exit(fails ? 1 : 0);
})().catch(async e => {
  console.error(e);
  for (const k in PAGES) try { console.log(k, await PAGES[k].evaluate(() => JSON.stringify({ done: window.__done, mode: __issen.G.mode, ph: __issen.G.phase, tag: __issen.NET.tag, w: __issen.NET.watch,
    act: !!IssenMatch.active, wat: IssenMatch.watching && { st: IssenMatch.watching.started, base: IssenMatch.watching.base }, hid: document.getElementById('team').hidden,
    T: { late: IssenTeam.state().lateFor, watched: IssenTeam.state().watched, started: IssenTeam.state().started, cur: IssenTeam.state().room && IssenTeam.state().room.state.cur },
    note: document.getElementById('o_note').textContent }))); } catch (er) {}
  process.exit(1);
});
