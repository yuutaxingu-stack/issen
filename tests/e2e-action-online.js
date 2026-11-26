// 新・一閃のネット対戦の通しテスト（本物の Supabase）: 登録 → フレンド → 招待 → action.html で二本先取 → 結果の照合
// 使い方: node tests/e2e-action-online.js <ログインIDの頭> [server]
//   server を付けると WebRTC を使わせず、サーバー経由だけで戦う
// 注意: 実際に2人の利用者が作られます。
const { chromium } = require('playwright');
const path = require('path');
const pre = process.argv[2] || ('t' + Date.now() % 100000);
const serverOnly = process.argv[3] === 'server';
const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const shots = process.env.SHOTS || '/tmp/claude-0/shots';

(async () => {
  const browser = await chromium.launch();
  const mk = async (tag) => {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } });
    if (serverOnly) await ctx.addInitScript(() => { delete window.RTCPeerConnection; });
    const p = await ctx.newPage();
    p.on('pageerror', e => log(tag, 'エラー', String(e)));
    p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') log(tag, 'console', m.text()); });
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
  await B.waitForFunction(() => IssenNet.incoming.length > 0, null, { timeout: 60000 });
  await B.click('#o_in button[data-act=ok]');
  await A.waitForFunction(id => IssenNet.friends.length > 0 && IssenNet.statusOf(id) === 'online', pb.id, { timeout: 60000 });
  log('フレンド成立');

  // 新・一閃で招待（サーバーの SQL が未実行なら、その旨が出る）
  await A.click('#o_list button[data-act=inv2]');
  await A.waitForTimeout(2500);
  const sqlReady = await A.evaluate(() => !!IssenNet.waiting);
  log('新・一閃で招待:', sqlReady ? '送れた' : 'まだ使えない「' + (await A.textContent('#o_note')) + '」');
  if (!sqlReady) {
    // SQL 未実行のときは今までの招待で試合を作り、新・一閃のページへ行かせる
    for (const p of [A, B]) await p.evaluate(() => { IssenNet.onMatch = (id, me) => { location.href = 'action.html?match=' + id + '&me=' + me; }; });
    await A.waitForTimeout(3500);
    await A.click('#o_list button[data-act=inv]');
  }
  await B.waitForFunction(() => !document.getElementById('o_inv').hidden, null, { timeout: 30000 });
  log('B に招待:', (await B.textContent('#o_inv')).replace(/\s+/g, ' '));
  await B.click('#o_invok');
  await Promise.all([A, B].map(p => p.waitForURL(/action\.html\?match=/, { timeout: 30000 })));
  log('二人とも新・一閃のページへ');
  await Promise.all([A, B].map(p => p.waitForFunction(() => window.__action && __action.ON, null, { timeout: 40000 })));
  log('立ち合い開始', await A.evaluate(() => __actionNet.via), await B.evaluate(() => __actionNet.via + ' 時計のずれ ' + __actionNet.st.off.toFixed(1) + 'ms 往復 ' + (__actionNet.st.rtt || 0).toFixed(0) + 'ms'));
  await A.screenshot({ path: shots + '/aon-intro-A.png' });

  // 二人とも相手に寄って斬る（キーを押す）
  const bot = p => p.evaluate(() => {
    const down = c => dispatchEvent(new KeyboardEvent('keydown', { code: c })), up = c => dispatchEvent(new KeyboardEvent('keyup', { code: c }));
    let t = 0;
    window.__bot = setInterval(() => { const O = __action.ON; if (!O) return; const s = __action.sim, me = s.p[O.me], op = s.p[1 - O.me];
      t++;
      const dx = op.x - me.x; up('KeyA'); up('KeyD');
      if (Math.abs(dx) > 90 * 100) down(dx > 0 ? 'KeyD' : 'KeyA');
      const r = Math.random();
      if (r < 0.35) { down('KeyJ'); setTimeout(() => up('KeyJ'), 40); }
      else if (r < 0.42) { down('KeyU'); setTimeout(() => up('KeyU'), 40); }
      else if (r < 0.47) { down('KeyK'); setTimeout(() => up('KeyK'), 120); }
      else if (r < 0.55) { down('KeyL'); setTimeout(() => up('KeyL'), 200); }
      if (op.st === 'stun' && Math.random() < 0.5) { down('KeyL'); setTimeout(() => up('KeyL'), 40); }
    }, 70);
  });
  await bot(A); await bot(B);
  let shot = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 420000) {
    await A.waitForTimeout(3000);
    const s = await Promise.all([A, B].map(p => p.evaluate(() => { const O = __action.ON, np = O && O.np; return O ? { ph: O.L.ph, f: np.frame, c: np.confirmed(), rolls: np.rolls, maxR: np.maxRolled, w: __action.sim.wins.join('-'), done: O.done, via: __actionNet.via, desync: __actionNet.st.desync, msg: O.msg } : null; })));
    log(s.map(x => x && `${x.ph} f${x.f} 確定${x.c} 勝${x.w} 巻戻${x.rolls}(最大${x.maxR}F) ${x.via}${x.desync ? ' ずれ!' : ''}${x.msg ? ' ' + x.msg : ''}`).join(' | '));
    if (!shot && s[0] && s[0].ph === 'fight' && s[0].f > 1200) { await A.screenshot({ path: shots + '/aon-fight-A.png' }); await B.screenshot({ path: shots + '/aon-fight-B.png' }); shot = true; }
    if (s.every(x => x && x.done)) break;
  }
  await A.waitForTimeout(6000);
  const res = await Promise.all([A, B].map(p => p.evaluate(() => ({ h: __action.ON.L.log.map(x => x.name + ':' + x.winner).join(' '), w: __action.sim.wins.join('-'), head: document.getElementById('ov_h').textContent, sub: document.getElementById('ov_s').textContent, notes: [...document.querySelectorAll('.onote')].map(e => e.textContent).join(' / '), desync: __actionNet.st.desync }))));
  log('A', JSON.stringify(res[0])); log('B', JSON.stringify(res[1]));
  await A.screenshot({ path: shots + '/aon-over-A.png' }); await B.screenshot({ path: shots + '/aon-over-B.png' });
  const out = await A.evaluate(() => localStorage.getItem('issen-action-out-v1'));
  log('A の勝ちの記録', out);
  await browser.close();
  process.exit(res[0].h === res[1].h && res[0].h && !res[0].desync && !res[1].desync ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
