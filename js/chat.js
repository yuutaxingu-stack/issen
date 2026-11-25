/* =====================================================================
   一閃 寄合（よりあい）: フレンドのオープンチャット
   * 発言はフレンドに見える。@名指しされた人には知らせが出る
   * 「相手求む」に「受けて立つ」と、そのまま対戦が始まる
   * 誰と誰の立ち合いが始まり、どう終わったかも流れる
   データと守りは supabase/chat.sql。未実行なら寄合は出さない。
   ===================================================================== */
(function(){
  const N = window.IssenNet, I = window.__issen;
  const $ = id => document.getElementById(id);
  const el = $('chat');
  if (!N || !el) return;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LIMIT = 200, MAXLEN = 100;

  const C = { ok: false, msgs: [], mutes: new Set(), ch: null, uid: null, lastRead: 0, picked: new Map(), sheet: null };
  window.IssenChat = C;

  /* ---------- 読んだ所（端末に覚える） ---------- */
  const READ_KEY = 'issen-chat-read-v1';
  function loadRead(){ try { return (JSON.parse(localStorage.getItem(READ_KEY) || '{}')[C.uid]) || 0; } catch (e) { return 0; } }
  function saveRead(){
    try { const o = JSON.parse(localStorage.getItem(READ_KEY) || '{}'); o[C.uid] = C.lastRead; localStorage.setItem(READ_KEY, JSON.stringify(o)); } catch (e) {}
  }

  const me = () => N.user && N.user.id;
  const isOpen = () => !el.hidden;
  const nameOf = id => {
    if (!id) return '？';
    if (N.profile && id === N.profile.id) return N.profile.name;
    const f = N.friends.find(x => x.id === id); return f ? f.name : '？';
  };
  const forMe = m => m.to_id === me() || (m.mentions || []).includes(me());
  const visible = m => !m.deleted && !C.mutes.has(m.author);

  /* ---------- 読み込み・受け取り ---------- */
  async function start(){
    stop();
    C.uid = me(); if (!C.uid) return render();
    C.lastRead = loadRead();
    const r = await N.sb.from('chat_messages').select('*').order('id', { ascending: false }).limit(LIMIT);
    if (r.error) { C.ok = false; render(); return; }   // chat.sql がまだ
    if (C.uid !== me()) return;
    C.ok = true;
    C.msgs = r.data.reverse();
    if (!C.lastRead && C.msgs.length) { C.lastRead = C.msgs[C.msgs.length - 1].id; saveRead(); }  // はじめての端末は既読から
    const mu = await N.sb.from('chat_mutes').select('target');
    C.mutes = new Set((mu.data || []).map(x => x.target));
    C.ch = N.sb.channel('chat:' + C.uid, { config: { private: true } });
    C.ch.on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, p => onChange(p))
      .subscribe(st => { if (st === 'SUBSCRIBED') catchUp(); });
    render();
  }
  function stop(){
    if (C.ch) { N.sb.removeChannel(C.ch); C.ch = null; }
    C.ok = false; C.msgs = []; C.uid = null; C.mutes = new Set();
  }
  // つなぎ直したときに、抜けた分を読む
  async function catchUp(){
    const last = C.msgs.length ? C.msgs[C.msgs.length - 1].id : 0;
    const r = await N.sb.from('chat_messages').select('*').gt('id', last).order('id').limit(LIMIT);
    if (!r.error) r.data.forEach(m => put(m, false));
    render();
  }
  function put(m, fresh){
    const i = C.msgs.findIndex(x => x.id === m.id);
    if (i >= 0) { C.msgs[i] = m; return false; }
    C.msgs.push(m); C.msgs.sort((a, b) => a.id - b.id);
    if (C.msgs.length > LIMIT) C.msgs.splice(0, C.msgs.length - LIMIT);
    return fresh;
  }
  function onChange(p){
    if (p.eventType === 'DELETE') { C.msgs = C.msgs.filter(x => x.id !== (p.old && p.old.id)); render(); return; }
    const m = p.new; if (!m || !m.id) return;
    const isNew = put(m, p.eventType === 'INSERT');
    if (isNew && m.author !== me() && visible(m)) {
      if (m.kind === 'say' && !N.friends.some(f => f.id === m.author)) N.refreshFriends();
      if (forMe(m)) herald(m);
    }
    myRecruitTaken(m);
    if (isOpen()) markRead();
    render();
  }

  /* ---------- 相手求む ---------- */
  const recruitOpen = m => m.kind === 'recruit' && !m.deleted && m.ref && m.ref.open && Date.parse(m.ref.until) > Date.now();
  const myRecruit = () => C.msgs.find(m => m.author === me() && recruitOpen(m));
  function myRecruitTaken(m){
    if (m.kind !== 'recruit' || m.author !== me() || !m.ref || !m.ref.match_id || C.started === m.id) return;
    C.started = m.id;
    close();
    if (N.toast) N.toast(nameOf(m.ref.taker) + 'さんが受けて立ちました');
    if (I.G.mode !== 'title' && I.G.mode !== 'online') I.goTitle();
    const g = $('gacha'); if (g) g.hidden = true;
    if (N.onMatch) N.onMatch(m.ref.match_id, 0);
  }

  /* ---------- 送る ---------- */
  async function rpc(fn, args){
    const { data, error } = await N.sb.rpc(fn, args || {});
    if (error) throw new Error(N.jp(error));
    return data;
  }
  async function send(){
    const box = $('c_text'), text = box.value.trim();
    if (!text) return;
    if (text.length > MAXLEN) return N.toast(MAXLEN + '文字までにしてください');
    // 本文に残っている @名前 だけを名指しにする
    const ms = [...C.picked].filter(([id, nm]) => text.includes('@' + nm)).map(([id]) => id);
    const btn = $('c_send'); btn.disabled = true;
    try {
      await rpc('chat_post', { p_body: text, p_mentions: ms, p_to: C.whisper || null });
      box.value = ''; C.picked.clear(); setWhisper(null); updateCount();
      await catchUp(); toBottom();
    } catch (e) { N.toast(e.message); }
    btn.disabled = false;
  }
  async function recruit(){
    if (myRecruit()) { try { await rpc('chat_close_recruit'); await refetchMine(); } catch (e) { N.toast(e.message); } return; }
    try { await rpc('chat_post', { p_body: '', p_kind: 'recruit' }); await catchUp(); toBottom(); } catch (e) { N.toast(e.message); }
  }
  async function refetchMine(){
    const r = await N.sb.from('chat_messages').select('*').eq('author', me()).eq('kind', 'recruit').order('id', { ascending: false }).limit(3);
    if (!r.error) r.data.forEach(m => put(m, false));
    render();
  }
  async function take(id, btn){
    btn.disabled = true;
    try {
      if (window.IssenMatch && IssenMatch.active) throw new Error('今は試合中です');
      const mid = await rpc('chat_accept_recruit', { p_id: id });
      close();
      if (I.G.mode !== 'title' && I.G.mode !== 'online') I.goTitle();
      if (N.onMatch) N.onMatch(mid, 1);
    } catch (e) { N.toast(e.message); btn.disabled = false; refetchMine(); }
  }

  /* ---------- 名指しの知らせ（どの画面でも、邪魔にならない大きさで） ---------- */
  let heraldT = 0;
  function herald(m){
    const h = $('c_herald'); if (!h) return;
    const playing = I.G.mode === 'online' || I.G.mode === 'cpu' || I.G.mode === 'vs';
    $('c_hfrom').textContent = nameOf(m.author);
    $('c_hbody').textContent = m.to_id ? '（内緒）' + m.body : m.body;
    h.classList.toggle('quiet', playing);
    h.hidden = false;
    clearTimeout(heraldT); heraldT = setTimeout(() => { h.hidden = true; }, playing ? 3500 : 6000);
    try { if (navigator.vibrate && !playing) navigator.vibrate(30); } catch (e) {}
  }

  /* ---------- 開け閉め ---------- */
  function open(){
    if (!N.user) { N.toast('オンラインでログインすると使えます'); const b = $('m_online'); if (b) b.click(); return; }
    if (!C.ok) { N.toast('寄合は準備中です'); return; }
    el.hidden = false; $('c_herald').hidden = true;
    markRead(); render(); toBottom();
  }
  function close(){ el.hidden = true; closeSheet(); render(); }
  function markRead(){
    const last = C.msgs.length ? C.msgs[C.msgs.length - 1].id : 0;
    if (last > C.lastRead) { C.lastRead = last; saveRead(); }
  }
  function toBottom(){ const l = $('c_list'); requestAnimationFrame(() => { l.scrollTop = l.scrollHeight; }); }

  /* ---------- 名指し・内緒 ---------- */
  function pickFriend(f){
    const box = $('c_text');
    C.picked.set(f.id, f.name);
    const tag = '@' + f.name + ' ';
    if (!box.value.includes('@' + f.name)) box.value = tag + box.value;
    box.focus(); updateCount(); closeSheet();
  }
  function setWhisper(id){
    C.whisper = id;
    $('c_whisper').hidden = !id;
    if (id) $('c_wname').textContent = nameOf(id);
    $('c_text').placeholder = id ? nameOf(id) + 'さんにだけ届きます' : 'ひとこと（@で名指し）';
  }
  function updateCount(){
    const n = $('c_text').value.length, c = $('c_count');
    c.textContent = n > MAXLEN - 20 ? (MAXLEN - n) : '';
    c.classList.toggle('over', n > MAXLEN);
  }

  // 小さな選び物の板（名指しの相手・発言への操作）
  function openSheet(html){
    const s = $('c_sheet'); s.innerHTML = html; s.hidden = false;
  }
  function closeSheet(){ const s = $('c_sheet'); if (s) { s.hidden = true; s.innerHTML = ''; } }
  function friendSheet(){
    if (!N.friends.length) return N.toast('まだフレンドがいません');
    openSheet('<div class="csh">誰を名指ししますか</div><div class="cchips">' +
      N.friends.filter(f => !C.mutes.has(f.id)).map(f => '<button type="button" data-pick="' + f.id + '">' +
        '<span class="odot ' + ({ online: 'on', playing: 'play' }[N.statusOf(f.id)] || 'off') + '"></span>' + esc(f.name) + '</button>').join('') +
      '</div><button type="button" class="obtn" data-sheet="close">やめる</button>');
  }
  function msgSheet(m){
    const mine = m.author === me();
    const who = esc(nameOf(m.author));
    let h = '<div class="csh">' + (mine ? '自分の発言' : who + 'さん') + '</div><div class="cops">';
    if (mine) h += '<button type="button" class="obtn" data-op="del" data-id="' + m.id + '">この発言を消す</button>';
    else {
      h += '<button type="button" class="obtn" data-op="at" data-id="' + m.author + '">@名指しする</button>';
      h += '<button type="button" class="obtn" data-op="wh" data-id="' + m.author + '">内緒で送る</button>';
      h += '<button type="button" class="obtn" data-op="mute" data-id="' + m.author + '">この人の発言を見えなくする</button>';
    }
    h += '<button type="button" class="obtn" data-sheet="close">やめる</button></div>';
    openSheet(h);
  }
  function muteSheet(){
    const list = [...C.mutes];
    openSheet('<div class="csh">見えなくしている人</div><div class="cops">' +
      (list.length ? list.map(id => '<button type="button" class="obtn" data-op="unmute" data-id="' + id + '">' + esc(nameOf(id)) + '　を戻す</button>').join('')
                   : '<p class="gnote">いません</p>') +
      '<button type="button" class="obtn" data-sheet="close">閉じる</button></div>');
  }

  /* ---------- 描く ---------- */
  const two = n => String(n).padStart(2, '0');
  function when(ts){
    const d = new Date(ts), now = new Date();
    const hm = two(d.getHours()) + ':' + two(d.getMinutes());
    if (d.toDateString() === now.toDateString()) return hm;
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
  }
  function bodyHtml(m){
    // @名前 を朱で
    let h = esc(m.body);
    const names = (m.mentions || []).map(nameOf).filter(n => n !== '？').sort((a, b) => b.length - a.length);
    names.forEach(n => { h = h.split('@' + esc(n)).join('<span class="cat">@' + esc(n) + '</span>'); });
    return h;
  }
  function left(m){
    const s = Math.max(0, Math.ceil((Date.parse(m.ref.until) - Date.now()) / 1000));
    return Math.floor(s / 60) + ':' + two(s % 60);
  }
  function line(m){
    const r = m.ref || {};
    if (m.kind === 'match_start') {
      return '<li class="cnews" data-id="' + m.id + '"><span class="cnm">' + esc(r.n0 || nameOf(m.author)) + '</span> 対 <span class="cnm">' +
        esc(r.n1 || nameOf(m.partner)) + '</span>　立ち合い<time>' + when(m.created_at) + '</time></li>';
    }
    if (m.kind === 'match_end') {
      let t;
      if (r.status === 'done' && r.winner) {
        const w = r.winner === m.author ? (r.n0 || nameOf(m.author)) : (r.n1 || nameOf(m.partner));
        const sc = Array.isArray(r.score) ? '　' + r.score[0] + '－' + r.score[1] : '';
        t = '<span class="cnm">' + esc(w) + '</span> の勝ち' + (r.finish ? '　<span class="cfin">' + esc(r.finish) + '</span>' : '') + '<small>' + esc(sc) + '</small>';
      } else {
        t = '<span class="cnm">' + esc(r.n0 || nameOf(m.author)) + '</span> 対 <span class="cnm">' + esc(r.n1 || nameOf(m.partner)) + '</span>　' +
          (r.status === 'done' ? '引き分け' : '決着つかず');
      }
      return '<li class="cnews end" data-id="' + m.id + '">' + t + '<time>' + when(m.created_at) + '</time></li>';
    }
    const mine = m.author === me();
    const cls = ['cmsg', mine ? 'mine' : '', forMe(m) ? 'forme' : '', m.to_id ? 'whisper' : ''].join(' ');
    let body;
    if (m.kind === 'recruit') {
      const open = recruitOpen(m);
      body = '<div class="crec' + (open ? '' : ' shut') + '"><span class="crt">相手求む</span>' +
        (open ? '<span class="crl" data-until="' + m.id + '">' + left(m) + '</span>' : '<span class="crl">' + (r.match_id ? '受けた：' + esc(nameOf(r.taker)) : 'しめ切り') + '</span>') +
        (open && !mine ? '<button type="button" class="obtn pri" data-take="' + m.id + '">受けて立つ</button>' : '') +
        (open && mine ? '<button type="button" class="obtn" data-op="shut">しめる</button>' : '') + '</div>';
    } else if (m.kind === 'team') {
      body = '<div class="crec"><span class="crt">団体戦</span><span class="crl">' + esc(m.body || '参陣を募る') + '</span></div>';
    } else {
      body = '<p>' + bodyHtml(m) + '</p>';
    }
    const to = m.to_id ? '<span class="cto">内緒 → ' + esc(m.to_id === me() ? 'あなた' : nameOf(m.to_id)) + '</span>' : '';
    return '<li class="' + cls + '" data-id="' + m.id + '"><div class="chd"><button type="button" class="cwho" data-who="' + m.id + '">' +
      esc(mine ? nameOf(m.author) : nameOf(m.author)) + '</button>' + to + '<time>' + when(m.created_at) + '</time></div>' + body + '</li>';
  }
  let lastSig = '';
  function render(){
    // タイトルの入口と印
    const btn = $('m_chat'), badge = $('m_chat_b');
    if (btn) {
      btn.hidden = !N.user;
      const unread = C.msgs.filter(m => m.id > C.lastRead && m.author !== me() && visible(m));
      const named = unread.filter(forMe).length;
      badge.textContent = named ? '名指し ' + named : unread.length ? String(unread.length > 99 ? '99+' : unread.length) : '';
      badge.className = 'cbadge' + (named ? ' named' : '');
      badge.hidden = !unread.length;
      $('m_chat_s').textContent = !C.ok ? '準備中' : unread.length ? '新しい便りあり' : 'フレンドと話す';
    }
    renderWait();
    if (!isOpen()) return;
    const list = $('c_list');
    const shown = C.msgs.filter(visible);
    const sig = shown.map(m => m.id + ':' + (m.deleted ? 1 : 0) + ':' + JSON.stringify(m.ref)).join(',') + '|' + C.mutes.size + '|' + N.friends.length;
    if (sig !== lastSig) {
      const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
      lastSig = sig;
      list.innerHTML = shown.length ? shown.map(line).join('') :
        '<li class="cempty">まだ便りはありません。<br>最初のひとことを。</li>';
      if (atBottom) toBottom();
    }
    const mr = myRecruit();
    const rb = $('c_rec'); rb.textContent = mr ? '募集をしめる' : '相手求む'; rb.classList.toggle('pri', !mr);
    $('c_mutes').hidden = !C.mutes.size;
  }
  // 自分の募集が出ている間は、どこでも上に小さく出す
  function renderWait(){
    const w = $('c_wait'); if (!w) return;
    const mr = C.ok && myRecruit();
    const busy = window.IssenMatch && IssenMatch.active;
    w.hidden = !mr || isOpen() || !!busy;
    if (mr) $('c_waitsec').textContent = left(mr);
  }
  setInterval(() => {
    if (!C.ok) return;
    document.querySelectorAll('[data-until]').forEach(s => {
      const m = C.msgs.find(x => String(x.id) === s.dataset.until);
      if (m && recruitOpen(m)) s.textContent = left(m); else lastSig = '';
    });
    if (!lastSig) render();
    renderWait();
  }, 1000);

  /* ---------- 操作 ---------- */
  const menuBtn = $('m_chat'); if (menuBtn) menuBtn.addEventListener('click', open);
  $('c_back').addEventListener('click', close);
  $('c_form').addEventListener('submit', e => { e.preventDefault(); send(); });
  $('c_text').addEventListener('input', () => {
    updateCount();
    const v = $('c_text').value;
    if (v.endsWith('@') && (v.length === 1 || /\s$/.test(v.slice(0, -1)))) { $('c_text').value = v.slice(0, -1); friendSheet(); }
  });
  $('c_at').addEventListener('click', friendSheet);
  $('c_rec').addEventListener('click', recruit);
  $('c_mutes').addEventListener('click', muteSheet);
  $('c_wclear').addEventListener('click', () => setWhisper(null));
  $('c_waitshut').addEventListener('click', async () => { try { await rpc('chat_close_recruit'); await refetchMine(); } catch (e) { N.toast(e.message); } });
  $('c_herald').addEventListener('click', () => { if (I.G.mode !== 'online') open(); else $('c_herald').hidden = true; });
  el.addEventListener('click', async e => {
    const t = e.target.closest('button'); if (!t) { if (e.target.id === 'c_sheet') closeSheet(); return; }
    if (t.dataset.take) return take(Number(t.dataset.take), t);
    if (t.dataset.who) { const m = C.msgs.find(x => String(x.id) === t.dataset.who); if (m) msgSheet(m); return; }
    if (t.dataset.pick) { const f = N.friends.find(x => x.id === t.dataset.pick); if (f) pickFriend(f); return; }
    if (t.dataset.sheet === 'close') return closeSheet();
    const op = t.dataset.op, id = t.dataset.id;
    try {
      if (op === 'shut') { await rpc('chat_close_recruit'); await refetchMine(); }
      else if (op === 'del') { await rpc('chat_delete', { p_id: Number(id) }); closeSheet(); await refetchOne(Number(id)); }
      else if (op === 'at') { const f = N.friends.find(x => x.id === id); if (f) pickFriend(f); else N.toast('フレンドではありません'); }
      else if (op === 'wh') { setWhisper(id); closeSheet(); $('c_text').focus(); }
      else if (op === 'mute') { await rpc('chat_set_mute', { p_target: id, p_mute: true }); C.mutes.add(id); closeSheet(); N.toast(nameOf(id) + 'さんの発言を見えなくしました'); render(); }
      else if (op === 'unmute') { await rpc('chat_set_mute', { p_target: id, p_mute: false }); C.mutes.delete(id); muteSheet(); render(); }
    } catch (err) { N.toast(err.message); }
  });
  async function refetchOne(id){
    const r = await N.sb.from('chat_messages').select('*').eq('id', id).maybeSingle();
    if (!r.error && r.data) put(r.data, false); else C.msgs = C.msgs.filter(x => x.id !== id);
    lastSig = ''; render();
  }

  /* ---------- ログインの変化についていく ---------- */
  let seenUser = null;
  N.on(() => {
    const u = me() || null;
    if (u !== seenUser) { seenUser = u; if (u) start(); else { stop(); close(); } }
    render();
  });
  C.open = open; C.close = close; C.render = render;
  C.feed = onChange;   // テスト用: リアルタイムの知らせのまね
})();
