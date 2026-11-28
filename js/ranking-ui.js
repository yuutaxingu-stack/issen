/* =====================================================================
   一閃 番付（自分とフレンドだけのランキング）
   三つの番付: 戦闘力（オンライン対戦）・勝ち抜き（CPU戦の最高）・刀帳（集めた刀の数）
   一閃と新・一閃は切り替えて見る（戦闘力と勝ち抜きが別々。刀帳は共通）
   値はサーバーの friend_ranking（supabase/ranking.sql）から読む。戦闘力の計算もサーバーが行う。
   ===================================================================== */
(function(){
  const N = window.IssenNet, I = window.__issen;
  const $ = id => document.getElementById(id);
  const el = $('rank');
  if (!el) return;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const kn = n => (I && I.kn) ? I.kn(n) : String(n);
  let tab = 'power', game = 'issen', data = null, loading = false, err = '';
  const cache = {};   // 遊び方ごとの読み込んだ番付
  try { tab = localStorage.getItem('issen-rank-tab') || 'power'; game = localStorage.getItem('issen-rank-game') === 'action' ? 'action' : 'issen'; } catch (e) {}
  const GNAME = { issen: '一閃', action: '新・一閃' };

  const TABS = {
    power: {
      lead: 'オンライン対戦の戦闘力',
      val: r => r.rating,
      cell: r => String(r.rating),
      sub: r => (r.wins || r.losses ? r.wins + '勝' + r.losses + '敗' : 'まだ対戦なし') + (r.streak >= 2 ? '・' + kn(r.streak) + '連勝中' : ''),
      note: '勝つと増え、負けると減ります。はじめは1000。同じくらいの相手なら±16前後、格上に勝つほど大きく増え、格下に負けるほど大きく減ります。' +
            '連勝中は増える分が一勝ごとに一割ずつ盛られ、六連勝目からは一・五倍。同じ相手との対戦は一日五戦まで数えます。'
    },
    cpu: {
      lead: 'CPU戦　最高の勝ち抜き',
      val: r => r.cpu,
      cell: r => r.cpu + '<small>人抜き</small>',
      sub: () => '',
      note: 'CPU戦で、一度の挑戦で倒した人数の最高記録です。'
    },
    book: {
      lead: '刀帳に記した刀の数（一閃・新・一閃 共通）',
      val: r => r.katana,
      cell: r => r.katana + '<small>/ ' + (data ? data.total : '') + '振り</small>',
      sub: () => '',
      note: '集めた刀の種類の数です。同じ刀が重なっても一振りと数えます。'
    }
  };

  function open(){ el.hidden = false; render(); load(); if (window.IssenZetsu) window.IssenZetsu.refresh(); }
  if (window.IssenZetsu) window.IssenZetsu.on(() => render());
  function close(){ el.hidden = true; }
  $('m_rank').addEventListener('click', open);
  $('r_back').addEventListener('click', close);
  $('r_reload').addEventListener('click', () => load());
  $('r_go').addEventListener('click', () => { close(); $('m_online').click(); });
  el.querySelectorAll('.rgame button').forEach(b => b.addEventListener('click', () => {
    if (game === b.dataset.game) return;
    game = b.dataset.game; try { localStorage.setItem('issen-rank-game', game); } catch (e) {}
    data = cache[game] || null; err = ''; render(); load();
  }));
  el.querySelectorAll('.rtabs button').forEach(b => b.addEventListener('click', () => {
    tab = b.dataset.tab; try { localStorage.setItem('issen-rank-tab', tab); } catch (e) {}
    render();
  }));

  async function load(){
    if (!N || !N.configured() || !N.ready || !N.user || loading) { render(); return; }
    loading = true; err = ''; render();
    const g = game;
    try {
      let { data: d, error } = await N.sb.rpc('friend_ranking', { p_game: g });
      // サーバーの SQL がまだ古い（一閃と新・一閃を分ける前）なら、一閃は前の形で読む
      if (error && missing(error)) {
        if (g !== 'issen') throw Object.assign(new Error('新・一閃の番付はまだ準備中です'), { soon: true });
        ({ data: d, error } = await N.sb.rpc('friend_ranking'));
      }
      if (error) throw error;
      cache[g] = d;
      if (g !== game) return;
      data = d;
      if (window.IssenProfile && d && d.rows) window.IssenProfile.loadTags(d.rows.map(r => r.id));
    } catch (e) {
      if (g === game) err = e.soon ? e.message : missing(e) ? '番付はまだ準備中です' : N.jp(e);
    } finally { loading = false; }
    if (g !== game) { load(); return; }
    render();
  }

  const missing = e => e && (e.code === 'PGRST202' || e.code === '42883');

  // 同じ値は同じ位にする（1位・1位・3位）
  function ranked(rows, f){
    const a = rows.slice().sort((x, y) => (f(y) - f(x)) || String(x.name).localeCompare(String(y.name), 'ja'));
    let last = null, no = 0;
    return a.map((r, i) => { if (f(r) !== last) { no = i + 1; last = f(r); } return { r, no }; });
  }

  function render(){
    if (el.hidden) return;
    const T = TABS[tab] || TABS.power;
    el.querySelectorAll('.rtabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    el.querySelectorAll('.rgame button').forEach(b => { const on = b.dataset.game === game; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    $('r_lead').textContent = tab === 'book' ? T.lead : GNAME[game] + '　' + T.lead;
    const loggedIn = !!(N && N.user);
    $('r_login').hidden = loggedIn || !(N && N.configured() && N.ready);
    $('r_reload').hidden = !loggedIn;
    let msg = '';
    if (!N || !N.configured()) msg = '番付は準備中です';
    else if (!N.ready) msg = 'つないでいます…';
    else if (!loggedIn) msg = '番付は、自分とフレンドの記録を並べます。オンラインでログインすると見られます。';
    else if (err) msg = err;
    else if (loading && !data) msg = '読み込んでいます…';
    $('r_msg').textContent = msg;

    const rows = loggedIn && data && !err ? data.rows || [] : [];
    const list = ranked(rows, T.val);
    $('r_list').innerHTML = list.map(({ r, no }, i) =>
      '<li data-pid="' + esc(r.id) + '" class="' + (r.me ? 'me ' : '') + (no <= 3 ? 'top' + no : '') + '" style="animation-delay:' + Math.min(i, 12) * 45 + 'ms">' +
        '<span class="rno"><span>' + kn(no) + '</span></span>' +
        '<span class="rwho"><span class="onm">' + esc(r.name) + (window.IssenZetsu ? window.IssenZetsu.mark(r.id) : '') + (window.IssenProfile ? window.IssenProfile.tag(r.id) : '') + '</span>' + (T.sub(r) ? '<small>' + esc(T.sub(r)) + '</small>' : '') + '</span>' +
        '<span class="rval">' + T.cell(r) + '</span>' +
      '</li>').join('');

    const mine = list.find(x => x.r.me);
    const me = $('r_me');
    me.hidden = !mine;
    if (mine) {
      const r = mine.r, place = list.length > 1 ? kn(mine.no) + '位　' + list.length + '人中' : 'フレンドを増やすと競えます';
      if (tab === 'power') {
        me.innerHTML = '<span class="rcap">戦闘力</span><span class="rbig">' + r.rating + '</span>' +
          '<span class="rsub"><span>' + esc(place) + '</span><span>最高 <b>' + r.peak + '</b></span>' + (r.best_streak ? '<span>最高 ' + kn(r.best_streak) + '連勝</span>' : '') + '</span>';
      } else if (tab === 'cpu') {
        me.innerHTML = '<span class="rcap">勝ち抜き</span><span class="rbig">' + r.cpu + '</span>' +
          '<span class="rsub"><span>人抜き</span><span>' + esc(place) + '</span></span>';
      } else {
        me.innerHTML = '<span class="rcap">刀帳</span><span class="rbig">' + r.katana + '</span>' +
          '<span class="rsub"><span>/ ' + data.total + '振り</span><span>' + esc(place) + '</span></span>';
      }
    }
    $('r_note').textContent = loggedIn ? T.note + (tab === 'book' ? '' : '　一閃と新・一閃は別々に数えます。') + '　自分とフレンドだけの番付です。' : '';
  }

  // 対戦が始まるときは閉じる
  const prev = N && N.onMatchUi;
  if (N) {
    N.onMatchUi = function(s){ if (s !== 'idle') close(); if (prev) prev(s); };
    N.on(() => { if (!el.hidden) { if (N.user && !data && !loading && !err) load(); else render(); } if (!N.user) { data = null; delete cache.issen; delete cache.action; } });
  }
  const ok = $('o_invok'); if (ok) ok.addEventListener('click', close);
  // 名乗りの二つ名が届いたら描き直す（profile.js は後から読まれる）
  setTimeout(() => { if (window.IssenProfile) window.IssenProfile.onTags(() => render()); }, 0);
  window.IssenRank = { open, close, load };
})();
