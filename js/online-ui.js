/* =====================================================================
   一閃 オンライン: 画面（ログイン・フレンド・招待の知らせ）
   ===================================================================== */
(function(){
  const N = window.IssenNet, I = window.__issen;
  const $ = id => document.getElementById(id);
  const el = $('online');
  let authTab = 'in', gateOpen = false;   // gateOpen: ログインのために開いた（ログインできたら閉じる）
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- 小さな知らせ ---------- */
  let toastT = 0;
  N.toast = function(msg, ms){
    const t = $('o_note'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms || 3200);
  };

  /* ---------- 開け閉め ---------- */
  function open(){ el.hidden = false; if (locked()) gateOpen = true; render(); if (N.user) { N.refreshFriends(); if (N.isGod()) loadInvites(); } }
  function close(){ el.hidden = true; gateOpen = false; }
  $('m_online').addEventListener('click', () => open());
  $('o_back').addEventListener('click', () => close());

  /* ---------- ログイン・登録 ---------- */
  document.querySelectorAll('#o_auth .otabs button').forEach(b => b.addEventListener('click', () => { authTab = b.dataset.tab; $('o_amsg').textContent = ''; render(); }));
  $('o_aform').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('o_ago'), msg = $('o_amsg'); btn.disabled = true; msg.textContent = authTab === 'in' ? 'ログインしています…' : '登録しています…';
    try {
      if (authTab === 'in') await N.signIn($('o_login').value, $('o_pass').value);
      else await N.signUp($('o_login').value, $('o_pass').value, $('o_name').value, $('o_invite').value);
      msg.textContent = ''; $('o_pass').value = '';
      if (authTab === 'up') { $('o_invite').value = ''; dropInviteFromUrl(); }
    } catch (err) { msg.textContent = err.message; }
    btn.disabled = false;
  });
  $('o_logout').addEventListener('click', async () => { if (confirmTwice($('o_logout'), 'もう一度押すとログアウト')) await N.signOut(); });
  $('o_copy').addEventListener('click', () => {
    const code = N.profile && N.profile.code; if (!code) return;
    try { navigator.clipboard.writeText(code).then(() => N.toast('IDを写しました'), () => N.toast('ID: ' + code)); } catch (e) { N.toast('ID: ' + code); }
  });
  $('o_rename').addEventListener('click', async () => {
    const v = prompt('新しい名前（1〜10文字）', N.profile ? N.profile.name : '');
    if (v == null) return;
    try { await N.setName(v); N.toast('名前を変えました'); } catch (e) { N.toast(e.message); }
  });

  /* ---------- フレンド ---------- */
  $('o_fform').addEventListener('submit', async e => {
    e.preventDefault();
    const code = $('o_fcode').value.trim().toUpperCase(), msg = $('o_fmsg');
    if (!/^[A-Z0-9]{6}$/.test(code)) { msg.textContent = 'IDは6文字の英数字です'; return; }
    msg.textContent = '探しています…';
    try {
      const p = await N.find(code);
      if (!p) { msg.textContent = 'そのIDの人は見つかりません'; return; }
      const r = await N.request(code);
      msg.textContent = { sent: p.name + 'さんに申請しました', accepted: p.name + 'さんとフレンドになりました', already: p.name + 'さんとはもうフレンドです', pending: p.name + 'さんの返事を待っています' }[r] || '';
      $('o_fcode').value = '';
    } catch (err) { msg.textContent = err.message; }
  });

  function confirmTwice(btn, text){
    if (btn.dataset.armed === '1') { btn.dataset.armed = ''; return true; }
    const old = btn.textContent; btn.dataset.armed = '1'; btn.textContent = text;
    setTimeout(() => { if (btn.dataset.armed === '1') { btn.dataset.armed = ''; btn.textContent = old; } }, 2500);
    return false;
  }

  el.addEventListener('click', async e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const id = b.dataset.id, act = b.dataset.act;
    try {
      if (act === 'ok') await N.respond(id, true);
      else if (act === 'no') await N.respond(id, false);
      else if (act === 'del') { if (confirmTwice(b, '本当に削除')) await N.remove(id); }
      else if (act === 'undo') await N.remove(id);
      else if (act === 'inv') { b.disabled = true; await N.sendInvite(id); }
      else if (act === 'inv2') { b.disabled = true; await N.sendInvite(id, 'action'); }
    } catch (err) { N.toast(err.message); b.disabled = false; }
  });

  /* ---------- ログインしないと遊べない（招待された人だけ） ---------- */
  // タイトルのボタンは「オンライン」以外、ログインするまで押しても登録画面が開くだけ
  const locked = () => N.configured() && !(N.ready && N.user);
  const menu = $('menu');
  menu.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.id === 'm_online' || !locked()) return;
    e.preventDefault(); e.stopImmediatePropagation(); open();
  }, true);
  // 招待のリンク（…/?invite=コード）で来たら、「はじめて」にコードを入れておく
  const urlInvite = N.normInvite(new URLSearchParams(location.search).get('invite'));
  if (urlInvite) { $('o_invite').value = urlInvite; authTab = 'up'; }
  function dropInviteFromUrl(){
    if (!urlInvite) return;
    try { const u = new URL(location.href); u.searchParams.delete('invite'); history.replaceState(null, '', u.pathname + u.search + u.hash); } catch (e) {}
  }
  let gateShown = false;
  function autoGate(){
    // 招待のリンクで来て、ログインしていなければ登録画面を出す（ふだんはボタンを押したときに出す。お知らせは読める）
    if (gateShown || !urlInvite || !N.ready || N.user || !N.configured() || I.G.phase !== 'title') return;
    gateShown = true; open();
  }
  N.on(() => { if (gateOpen && N.user) { gateOpen = false; close(); } });   // 登録・ログインできたらタイトルへ

  /* ---------- 招待コード（神様だけ） ---------- */
  let invites = [], invLoading = false;
  const SITE = location.origin + location.pathname.replace(/[^/]*$/, '');
  const fmtCode = c => c.slice(0, 4) + '-' + c.slice(4);
  const shareText = c => '一閃の招待コード ' + fmtCode(c) + '\n' + SITE + '?invite=' + c + '\n（1回だけ使えます。登録は「はじめて」から）';
  async function loadInvites(){
    if (invLoading) return; invLoading = true;
    try { invites = await N.inviteList(); } catch (e) { $('o_imsg').textContent = e.message; }
    invLoading = false; render();
  }
  function copy(text, done){
    try { navigator.clipboard.writeText(text).then(() => N.toast(done), () => prompt('写してください', text)); } catch (e) { prompt('写してください', text); }
  }
  $('o_iform').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('o_imsg'), memo = $('o_imemo').value.trim();
    msg.textContent = '発行しています…';
    try {
      const [code] = await N.inviteCreate(memo, 1);
      $('o_imemo').value = ''; msg.textContent = '発行しました: ' + fmtCode(code) + '（「写す」で招待の文が写せます）';
      await loadInvites();
    } catch (err) { msg.textContent = err.message; }
  });
  $('o_ilist').addEventListener('click', async e => {
    const b = e.target.closest('button[data-ic]'); if (!b) return;
    const code = b.dataset.code;
    if (b.dataset.ic === 'copy') copy(shareText(code), '招待の文を写しました。渡したい人だけに送ってください');
    else if (b.dataset.ic === 'rv' && confirmTwice(b, '本当に取り消す')) {
      try { await N.inviteRevoke(code); N.toast('取り消しました'); } catch (err) { N.toast(err.message); }
      loadInvites();
    }
  });
  const jpDate = t => { const d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate(); };
  function renderInvites(){
    const god = !!(N.user && N.isGod());
    $('o_god').hidden = !god; if (!god) return;
    const shown = invites.filter(v => !v.used_at).concat(invites.filter(v => v.used_at).slice(0, 20));   // 未使用を上に。使用済みは新しい20件
    $('o_ilist').innerHTML = shown.length ? shown.map(v => {
      const used = !!v.used_at;
      return '<li><span class="ocode' + (used ? ' used' : '') + '">' + fmtCode(v.code) + '</span>' +
        '<span class="ost">' + (v.memo ? esc(v.memo) + '　' : '') + (used ? jpDate(v.used_at) + ' ' + esc(v.used_name || '（消えた人）') + (v.used_login ? '（' + esc(v.used_login) + '）' : '') + 'が使用' : jpDate(v.created_at) + ' 発行・未使用') + '</span>' +
        (used ? '' : '<button type="button" class="obtn pri" data-ic="copy" data-code="' + v.code + '">写す</button><button type="button" class="obtn" data-ic="rv" data-code="' + v.code + '">取り消す</button>') + '</li>';
    }).join('') : '<li class="none">まだ発行していません</li>';
  }

  const STATUS = { online: ['オンライン', 'on'], playing: ['試合中', 'play'], offline: ['オフライン', 'off'] };

  function render(){
    const ok = N.configured();
    $('o_wait').hidden = !(ok && !N.ready);
    $('o_off').hidden = ok;
    $('o_auth').hidden = !(ok && N.ready && !N.user);
    $('o_main').hidden = !(ok && N.ready && N.user);
    $('o_err').textContent = N.error || '';
    const lock = locked();
    menu.classList.toggle('locked', lock);
    $('o_gate').hidden = !lock;
    $('m_online_s').textContent = !ok ? '準備中' : N.user && N.profile ? N.profile.name + ' でログイン中' : N.ready ? 'ログイン・登録' : 'つないでいます…';
    if (!el.hidden && N.ready && !N.user) {
      document.querySelectorAll('#o_auth .otabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === authTab));
      $('o_namerow').hidden = authTab === 'in';
      $('o_invrow').hidden = authTab === 'in';
      $('o_ago').textContent = authTab === 'in' ? 'ログイン' : '登録してはじめる';
      $('o_pass').autocomplete = authTab === 'in' ? 'current-password' : 'new-password';
    }
    if (N.user && N.profile) {
      $('o_myname').textContent = N.profile.name;
      $('o_mycode').textContent = N.profile.code;
      $('o_mylogin').textContent = 'ログインID ' + N.profile.login;
      const acct = I.isAccount && I.isAccount(); $('o_save').hidden = !acct;
      $('o_save').textContent = '銭・刀・戦績はこのアカウントに保存されています。ほかの端末でも同じIDでログインすれば続きから遊べます';
      const busy = !!N.waiting || !!(window.IssenMatch && IssenMatch.active);
      $('o_list').innerHTML = N.friends.length ? N.friends.map(f => {
        const s = N.statusOf(f.id), [lab, cls] = STATUS[s];
        return '<li><span class="odot ' + cls + '"></span><span class="onm" data-pid="' + esc(f.id) + '">' + esc(f.name) + '</span><span class="ost">' + lab + '</span>' +
          '<button type="button" class="obtn pri" data-act="inv" data-id="' + f.id + '"' + (s === 'online' && !busy ? '' : ' disabled') + '>招待</button>' +
          '<button type="button" class="obtn pri" data-act="inv2" data-id="' + f.id + '"' + (s === 'online' && !busy ? '' : ' disabled') + ' title="新・一閃（動いて斬り合う）で招待">新・一閃</button>' +
          '<button type="button" class="obtn" data-act="del" data-id="' + f.id + '">削除</button></li>';
      }).join('') : '<li class="none">まだフレンドがいません。相手のIDを上に入れて申請しましょう</li>';
      $('o_in').innerHTML = N.incoming.map(f => '<li><span class="onm">' + esc(f.name) + '</span><span class="ost">ID ' + esc(f.code) + '</span>' +
        '<button type="button" class="obtn pri" data-act="ok" data-id="' + f.id + '">承認</button><button type="button" class="obtn" data-act="no" data-id="' + f.id + '">拒否</button></li>').join('');
      $('o_inh').hidden = !N.incoming.length;
      $('o_out').innerHTML = N.outgoing.map(f => '<li><span class="onm">' + esc(f.name) + '</span><span class="ost">返事待ち</span>' +
        '<button type="button" class="obtn" data-act="undo" data-id="' + f.id + '">取り消す</button></li>').join('');
      $('o_outh').hidden = !N.outgoing.length;
    }
    renderInvites();
    renderInvite();
    autoGate();
  }

  /* ---------- 招待の知らせ（どの画面でも上に出る） ---------- */
  function renderInvite(){
    const box = $('o_inv'), w = $('o_waitinv'), inOnline = I.G.mode === 'online';
    const inv = N.invite;
    box.hidden = !inv || inOnline;
    if (inv) { $('o_invname').textContent = N.nameOf(inv.from_id); $('o_invgame').textContent = inv.game === 'action' ? '新・一閃で' : ''; }
    w.hidden = !N.waiting;
    if (N.waiting) { $('o_waitname').textContent = N.nameOf(N.waiting.to_id); $('o_waitgame').textContent = N.waiting.game === 'action' ? '（新・一閃）' : ''; }
    countdown();
  }
  function countdown(){
    const t = performance.now();
    if (N.invite) $('o_invsec').textContent = Math.max(0, Math.ceil((N.invite.until - t) / 1000));
    if (N.waiting) $('o_waitsec').textContent = Math.max(0, Math.ceil((N.waiting.until - t) / 1000));
  }
  setInterval(countdown, 250);
  $('o_invok').addEventListener('click', async () => {
    // ほかの遊びの途中なら、タイトルに戻ってから
    if (I.G.mode !== 'title' && I.G.mode !== 'online') I.goTitle();
    document.getElementById('gacha').hidden = true;
    try { await N.answerInvite(true); } catch (e) { N.toast(e.message); }
  });
  $('o_invno').addEventListener('click', async () => { try { await N.answerInvite(false); } catch (e) { N.toast(e.message); } });
  $('o_waitcancel').addEventListener('click', () => N.cancelInvite());

  /* 対戦の準備中・対戦中 */
  N.onMatchUi = function(state){
    $('o_conn').hidden = state !== 'connecting';
    if (state !== 'idle') { close(); document.getElementById('gacha').hidden = true; }
    render();
  };

  N.on(render);
  render();
  N.init();
})();
