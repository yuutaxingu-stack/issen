/* =====================================================================
   一閃 寄合（よりあい）: フレンドのオープンチャット
   * 「皆で」… 発言は送った人のフレンドに見える。@名指しされた人には知らせが出る
   * 「密書」… フレンドと一対一の話（その二人にしか見えない）
   * 「相手求む」に「受けて立つ」と、そのまま対戦が始まる。団体戦の募集には「参陣」
   * 誰と誰の立ち合いが始まり、どう終わったかも流れる
   * オンライン対戦の最中は「言」から定型の一言、一本の合間は自由に打てる（相手にだけ届き、残らない）
   データと守りは supabase/chat.sql。未実行なら寄合は「準備中」。
   ===================================================================== */
(function(){
  const N = window.IssenNet, I = window.__issen;
  const $ = id => document.getElementById(id);
  const el = $('chat');
  if (!N || !el) return;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LIMIT = 200, MAXLEN = 100;

  const C = { ok: false, msgs: [], mutes: new Set(), ch: null, uid: null, read: { open: 0, dm: {} }, picked: new Map(),
              tab: 'open', dm: null, started: null };
  window.IssenChat = C;

  /* ---------- 読んだ所（端末に覚える） ---------- */
  const READ_KEY = 'issen-chat-read-v2';
  function loadRead(){
    try { const r = JSON.parse(localStorage.getItem(READ_KEY) || '{}')[C.uid]; if (r) return { open: r.open || 0, dm: r.dm || {} }; } catch (e) {}
    return null;
  }
  function saveRead(){
    try { const o = JSON.parse(localStorage.getItem(READ_KEY) || '{}'); o[C.uid] = C.read; localStorage.setItem(READ_KEY, JSON.stringify(o)); } catch (e) {}
  }

  const me = () => N.user && N.user.id;
  const isOpen = () => !el.hidden;
  const nameOf = id => {
    if (!id) return '？';
    if (N.profile && id === N.profile.id) return N.profile.name;
    const f = N.friends.find(x => x.id === id); return f ? f.name : '？';
  };
  const isDm = m => !!m.to_id;
  const dmPeer = m => m.author === me() ? m.to_id : m.author;
  const named = m => !isDm(m) && (m.mentions || []).includes(me());
  const visible = m => !m.deleted && !C.mutes.has(m.author);
  const lastId = list => list.length ? list[list.length - 1].id : 0;
  const openMsgs = () => C.msgs.filter(m => !isDm(m) && visible(m));
  const dmMsgs = fid => C.msgs.filter(m => isDm(m) && dmPeer(m) === fid && !m.deleted);
  const unreadOpen = () => openMsgs().filter(m => m.id > C.read.open && m.author !== me());
  const unreadDm = fid => C.msgs.filter(m => isDm(m) && m.to_id === me() && (!fid || m.author === fid) && visible(m) && m.id > (C.read.dm[m.author] || 0));

  /* ---------- 読み込み・受け取り ---------- */
  const q = () => N.sb.from('chat_messages').select('*');
  async function start(){
    stop();
    C.uid = me(); if (!C.uid) return render();
    const [o, d] = await Promise.all([
      q().is('to_id', null).order('id', { ascending: false }).limit(LIMIT),
      q().not('to_id', 'is', null).order('id', { ascending: false }).limit(LIMIT)
    ]);
    if (o.error || d.error) { C.ok = false; render(); return; }   // chat.sql がまだ
    if (C.uid !== me()) return;
    C.ok = true;
    C.msgs = o.data.concat(d.data).sort((a, b) => a.id - b.id);
    const saved = loadRead();
    if (saved) C.read = saved;
    else {   // はじめての端末は、今ある分を読んだことにする
      C.read = { open: lastId(C.msgs.filter(m => !isDm(m))), dm: {} };
      C.msgs.filter(isDm).forEach(m => { C.read.dm[dmPeer(m)] = Math.max(C.read.dm[dmPeer(m)] || 0, m.id); });
      saveRead();
    }
    const mu = await N.sb.from('chat_mutes').select('target');
    C.mutes = new Set((mu.data || []).map(x => x.target));
    C.ch = N.sb.channel('chat:' + C.uid, { config: { private: true } });
    C.ch.on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages' }, p => onChange(p))
      .subscribe(st => { if (st === 'SUBSCRIBED') catchUp(); });
    render();
  }
  function stop(){
    if (C.ch) { N.sb.removeChannel(C.ch); C.ch = null; }
    C.ok = false; C.msgs = []; C.uid = null; C.mutes = new Set(); C.dm = null; C.tab = 'open';
  }
  // つなぎ直したときや送った後に、抜けた分を読む
  async function catchUp(){
    const r = await q().gt('id', lastId(C.msgs)).order('id').limit(LIMIT);
    if (!r.error) r.data.forEach(m => put(m));
    render();
  }
  function put(m){
    const i = C.msgs.findIndex(x => x.id === m.id);
    if (i >= 0) { C.msgs[i] = m; return false; }
    C.msgs.push(m); C.msgs.sort((a, b) => a.id - b.id);
    if (C.msgs.length > LIMIT * 2) C.msgs.splice(0, C.msgs.length - LIMIT * 2);
    return true;
  }
  function onChange(p){
    if (p.eventType === 'DELETE') { C.msgs = C.msgs.filter(x => x.id !== (p.old && p.old.id)); render(); return; }
    const m = p.new; if (!m || !m.id) return;
    const isNew = put(m) && p.eventType === 'INSERT';
    if (isNew && m.author !== me() && visible(m)) {
      if (m.kind === 'say' && !N.friends.some(f => f.id === m.author)) N.refreshFriends();
      const looking = isOpen() && (isDm(m) ? C.tab === 'dm' && C.dm === m.author : C.tab === 'open');
      if ((isDm(m) || named(m)) && !looking) herald(m);
    }
    myRecruitTaken(m);
    markRead();
    render();
  }

  /* ---------- 相手求む ---------- */
  const recruitOpen = m => m.kind === 'recruit' && !m.deleted && m.ref && m.ref.open && Date.parse(m.ref.until) > Date.now();
  const myRecruit = () => C.msgs.find(m => m.author === me() && recruitOpen(m));
  function goPlay(){
    close();
    if (I.G.mode !== 'title' && I.G.mode !== 'online') I.goTitle();
    const g = $('gacha'); if (g) g.hidden = true;
  }
  function myRecruitTaken(m){
    if (m.kind !== 'recruit' || m.author !== me() || !m.ref || !m.ref.match_id || C.started === m.id) return;
    C.started = m.id;
    if (window.IssenMatch && IssenMatch.active) return;
    goPlay();
    if (N.toast) N.toast(nameOf(m.ref.taker) + 'さんが受けて立ちました');
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
    if (N.hasLink(text) && !N.isGod()) return N.toast(N.LINK_MSG);
    const dm = C.tab === 'dm' ? C.dm : null;
    if (C.tab === 'dm' && !dm) return;
    // 本文に残っている @名前 だけを名指しにする
    const ms = dm ? [] : [...C.picked].filter(([id, nm]) => text.includes('@' + nm)).map(([id]) => id);
    const btn = $('c_send'); btn.disabled = true;
    try {
      await rpc('chat_post', { p_body: text, p_mentions: ms, p_to: dm });
      box.value = ''; C.picked.clear(); updateCount(); suggest();
      await catchUp(); markRead(); toBottom();
    } catch (e) { N.toast(e.message); }
    btn.disabled = false;
  }
  async function recruit(){
    try {
      if (myRecruit()) { await rpc('chat_close_recruit'); await refetchMine(); return; }
      await rpc('chat_post', { p_body: '', p_kind: 'recruit' }); await catchUp(); markRead(); toBottom();
    } catch (e) { N.toast(e.message); }
  }
  async function refetchMine(){
    const r = await q().eq('author', me()).eq('kind', 'recruit').order('id', { ascending: false }).limit(3);
    if (!r.error) r.data.forEach(m => put(m));
    lastSig = ''; render();
  }
  async function take(id, btn){
    btn.disabled = true;
    try {
      if (window.IssenMatch && IssenMatch.active) throw new Error('今は試合中です');
      const mid = await rpc('chat_accept_recruit', { p_id: id });
      goPlay();
      if (N.onMatch) N.onMatch(mid, 1);
    } catch (e) { N.toast(e.message); btn.disabled = false; refetchMine(); }
  }

  /* ---------- 名指し・密書の知らせ（どの画面でも、邪魔にならない大きさで） ---------- */
  let heraldT = 0;
  function herald(m){
    const h = $('c_herald'); if (!h) return;
    const playing = I.G.mode === 'online' || I.G.mode === 'cpu' || I.G.mode === 'vs';
    h.dataset.dm = isDm(m) ? m.author : '';
    $('c_hseal').textContent = isDm(m) ? '密' : '便';
    $('c_hfrom').textContent = nameOf(m.author) + (isDm(m) ? 'より密書' : 'より名指し');
    $('c_hbody').textContent = m.body;
    h.classList.toggle('quiet', playing);
    h.hidden = false;
    clearTimeout(heraldT); heraldT = setTimeout(() => { h.hidden = true; }, playing ? 3500 : 6000);
    try { if (navigator.vibrate && !playing) navigator.vibrate(30); } catch (e) {}
  }

  /* ---------- 開け閉め・切り替え ---------- */
  function open(tab, dm){
    if (!N.user) { N.toast('オンラインでログインすると使えます'); const b = $('m_online'); if (b) b.click(); return; }
    if (!C.ok) { N.toast('寄合は準備中です'); return; }
    if (tab) C.tab = tab;
    else { C.tab = unreadDm().length ? 'dm' : 'open'; C.dm = null; }   // 入口からは「皆で」（密書が届いていれば密書の一覧）
    if (dm !== undefined) C.dm = dm;
    el.hidden = false; $('c_herald').hidden = true;
    lastSig = ''; markRead(); render(); toBottom();
  }
  function close(){ el.hidden = true; closeSheet(); render(); }
  function show(tab, dm){ C.tab = tab; C.dm = dm || null; C.picked.clear(); $('c_text').value = ''; updateCount(); suggest(); closeSheet(); lastSig = ''; markRead(); render(); toBottom(); }
  function markRead(){
    if (!isOpen()) return;
    let ch = false;
    if (C.tab === 'open') { const l = lastId(C.msgs.filter(m => !isDm(m))); if (l > C.read.open) { C.read.open = l; ch = true; } }
    if (C.tab === 'dm' && C.dm) { const l = lastId(dmMsgs(C.dm)); if (l > (C.read.dm[C.dm] || 0)) { C.read.dm[C.dm] = l; ch = true; } }
    if (ch) saveRead();
  }
  function toBottom(){ const l = $('c_list'); requestAnimationFrame(() => { l.scrollTop = l.scrollHeight; }); }

  /* ---------- @を打つとフレンドの候補が出る ---------- */
  function atToken(){
    const box = $('c_text'), pos = box.selectionStart == null ? box.value.length : box.selectionStart;
    const m = box.value.slice(0, pos).match(/(^|\s)@([^\s@]{0,10})$/);
    return m ? { q: m[2], from: pos - m[2].length - 1, to: pos } : null;
  }
  function suggest(){
    const s = $('c_sugg'), t = C.tab === 'open' ? atToken() : null;
    const list = t ? N.friends.filter(f => !C.mutes.has(f.id) && f.name.toLowerCase().includes(t.q.toLowerCase())).slice(0, 12) : [];
    s.hidden = !t;
    if (!t) return;
    s.innerHTML = list.length ? list.map(f => '<button type="button" data-pick="' + f.id + '"><span class="odot ' +
      ({ online: 'on', playing: 'play' }[N.statusOf(f.id)] || 'off') + '"></span>' + esc(f.name) + '</button>').join('')
      : '<span class="cnone">' + (N.friends.length ? '当てはまるフレンドがいません' : 'まだフレンドがいません') + '</span>';
  }
  function pickFriend(f){
    const box = $('c_text'), t = atToken();
    const tag = '@' + f.name + ' ';
    if (t) box.value = box.value.slice(0, t.from) + tag + box.value.slice(t.to);
    else box.value = (box.value && !/\s$/.test(box.value) ? box.value + ' ' : box.value) + tag;
    C.picked.set(f.id, f.name);
    const pos = t ? t.from + tag.length : box.value.length;
    box.focus(); try { box.setSelectionRange(pos, pos); } catch (e) {}
    updateCount(); suggest(); closeSheet();
  }
  function updateCount(){
    const n = $('c_text').value.length, c = $('c_count');
    c.textContent = n > MAXLEN - 20 ? (MAXLEN - n) : '';
    c.classList.toggle('over', n > MAXLEN);
  }

  /* ---------- 小さな選び物の板（発言への操作） ---------- */
  function openSheet(html){ const s = $('c_sheet'); s.innerHTML = html; s.hidden = false; }
  function closeSheet(){ const s = $('c_sheet'); if (s) { s.hidden = true; s.innerHTML = ''; } }
  function msgSheet(m){
    const mine = m.author === me(), friend = N.friends.some(f => f.id === m.author);
    let h = '<div class="csh">' + (mine ? '自分の発言' : esc(nameOf(m.author)) + 'さん') + '</div><div class="cops">';
    if (window.IssenProfile) h += '<button type="button" class="obtn" data-pid="' + esc(m.author) + '">名乗りを見る</button>';
    if (mine) h += '<button type="button" class="obtn" data-op="del" data-id="' + m.id + '">この発言を消す</button>';
    else {
      if (friend && !isDm(m)) h += '<button type="button" class="obtn" data-op="at" data-id="' + m.author + '">@名指しする</button>';
      if (friend && !isDm(m)) h += '<button type="button" class="obtn" data-op="dm" data-id="' + m.author + '">密書を送る</button>';
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
    let h = esc(m.body);
    const names = (m.mentions || []).map(nameOf).filter(n => n !== '？').sort((a, b) => b.length - a.length);
    names.forEach(n => { h = h.split('@' + esc(n)).join('<span class="cat">@' + esc(n) + '</span>'); });
    return h;
  }
  function left(m){
    const s = Math.max(0, Math.ceil((Date.parse(m.ref.until) - Date.now()) / 1000));
    return Math.floor(s / 60) + ':' + two(s % 60);
  }
  const RULE = { free: '自由戦', taisho: '大将戦', tournament: 'トーナメント', kachinuki: '勝ち抜き団体戦' };
  function line(m){
    const r = m.ref || {};
    const team = r.room ? '<span class="cteam">団体戦</span>' : '';
    const n0 = esc(r.n0 || nameOf(m.author)), n1 = esc(r.n1 || nameOf(m.partner));
    if (m.kind === 'match_start') {
      return '<li class="cnews">' + team + '<span class="cnm">' + n0 + '</span> 対 <span class="cnm">' + n1 + '</span>　立ち合い<time>' + when(m.created_at) + '</time></li>';
    }
    if (m.kind === 'match_end') {
      let t;
      if (r.status === 'done' && r.winner) {
        const sc = Array.isArray(r.score) ? '　' + r.score[0] + '－' + r.score[1] : '';
        t = '<span class="cnm">' + (r.winner === m.author ? n0 : n1) + '</span> の勝ち' + (r.finish ? '　<span class="cfin">' + esc(r.finish) + '</span>' : '') + '<small>' + esc(sc) + '</small>';
      } else {
        t = '<span class="cnm">' + n0 + '</span> 対 <span class="cnm">' + n1 + '</span>　' + (r.status === 'done' ? '引き分け' : '決着つかず');
      }
      return '<li class="cnews end">' + team + t + '<time>' + when(m.created_at) + '</time></li>';
    }
    const mine = m.author === me();
    let body;
    if (m.kind === 'recruit') {
      const open = recruitOpen(m);
      body = '<div class="crec' + (open ? '' : ' shut') + '"><span class="crt">相手求む</span>' +
        (open ? '<span class="crl" data-until="' + m.id + '">' + left(m) + '</span>' : '<span class="crl">' + (r.match_id ? '受けた：' + esc(nameOf(r.taker)) : 'しめ切り') + '</span>') +
        (open && !mine ? '<button type="button" class="obtn pri" data-take="' + m.id + '">受けて立つ</button>' : '') +
        (open && mine ? '<button type="button" class="obtn" data-op="shut">しめる</button>' : '') + '</div>';
    } else if (m.kind === 'team') {
      const open = r.open && !m.deleted, canJoin = open && !mine && r.room && window.IssenTeam && IssenTeam.join;
      body = '<div class="crec' + (open ? '' : ' shut') + '"><span class="crt">団体戦</span><span class="crl">' +
        esc([RULE[r.rule] || '', r.n ? r.n + '人' : '', m.body || '参陣を募る'].filter(Boolean).join('・')) + (open ? '' : '　しめ切り') + '</span>' +
        (canJoin ? '<button type="button" class="obtn pri" data-team="' + esc(r.room) + '">参陣</button>' : '') + '</div>';
    } else {
      body = '<p>' + bodyHtml(m) + '</p>';
    }
    const cls = ['cmsg', mine ? 'mine' : '', named(m) ? 'forme' : '', isDm(m) ? 'dm' : ''].join(' ');
    return '<li class="' + cls + '"><div class="chd"><button type="button" class="cwho" data-who="' + m.id + '">' +
      esc(nameOf(m.author)) + (window.IssenZetsu ? window.IssenZetsu.mark(m.author) : '') + '</button><time>' + when(m.created_at) + '</time></div>' + body + '</li>';
  }
  function dmIndex(){
    const rows = N.friends.map(f => { const l = dmMsgs(f.id); return { f, last: l[l.length - 1], un: unreadDm(f.id).length }; })
      .sort((a, b) => (b.last ? b.last.id : 0) - (a.last ? a.last.id : 0) || a.f.name.localeCompare(b.f.name, 'ja'));
    if (!rows.length) return '<li class="cempty">フレンドができると、ここで一対一の話ができます。</li>';
    return rows.map(({ f, last, un }) => '<li class="cdm"><button type="button" data-open="' + f.id + '">' +
      '<span class="odot ' + ({ online: 'on', playing: 'play' }[N.statusOf(f.id)] || 'off') + '"></span>' +
      '<span class="cdmn">' + esc(f.name) + (window.IssenZetsu ? window.IssenZetsu.mark(f.id) : '') + '</span>' +
      '<span class="cdml">' + (last ? (last.author === me() ? 'あなた：' : '') + esc(last.body) : 'まだ密書はありません') + '</span>' +
      (un ? '<span class="cbadge named">' + un + '</span>' : '') + '</button></li>').join('');
  }
  let lastSig = '';
  function render(){
    const uo = C.ok ? unreadOpen() : [], ud = C.ok ? unreadDm() : [];
    const hot = uo.filter(named).length + ud.length;
    const btn = $('m_chat'), badge = $('m_chat_b');
    if (btn) {
      btn.hidden = !N.user;
      const n = hot || uo.length;
      badge.textContent = n > 99 ? '99+' : String(n);
      badge.className = 'cbadge' + (hot ? ' named' : '');
      badge.hidden = !n;
      $('m_chat_s').textContent = !C.ok ? '準備中' : ud.length ? '密書が届いています' : hot ? '名指しされています' : uo.length ? '新しい便りあり' : 'フレンドと話す';
    }
    renderWait();
    if (!isOpen()) return;
    document.querySelectorAll('#chat .ctabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === C.tab));
    const tb = $('c_tabdm'); tb.textContent = ud.length ? String(ud.length) : ''; tb.hidden = !ud.length;
    const oh = uo.filter(named).length, to = $('c_tabopen'); to.textContent = oh ? String(oh) : ''; to.hidden = !oh;
    const inDm = C.tab === 'dm', index = inDm && !C.dm;
    $('c_dmhead').hidden = !(inDm && C.dm);
    if (inDm && C.dm) $('c_dmname').textContent = nameOf(C.dm);
    $('c_form').hidden = index;
    $('c_rec').style.visibility = inDm ? 'hidden' : '';
    $('c_at').hidden = inDm;
    $('c_text').placeholder = inDm ? nameOf(C.dm) + 'さんにだけ届きます' : 'ひとこと（@で名指し）';
    $('c_foottext').textContent = inDm ? '密書は二人にしか見えません。七日で消えます' : 'フレンドに見えます。七日で消えます。名前を押すと名指し・密書・見えなくするができます';
    const list = $('c_list');
    const shown = index ? null : inDm ? dmMsgs(C.dm) : openMsgs();
    const sig = C.tab + ':' + C.dm + '|' + (shown ? shown.map(m => m.id + ':' + (m.deleted ? 1 : 0) + ':' + JSON.stringify(m.ref)).join(',') :
      N.friends.map(f => f.id + N.statusOf(f.id)).join(',') + lastId(C.msgs) + ':' + ud.length) + '|' + C.mutes.size + '|' + N.friends.length;
    if (sig !== lastSig) {
      const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
      lastSig = sig;
      list.classList.toggle('index', index);
      list.innerHTML = index ? dmIndex() : shown.length ? shown.map(line).join('') :
        '<li class="cempty">' + (inDm ? 'まだ密書はありません。' : 'まだ便りはありません。<br>最初のひとことを。') + '</li>';
      if (atBottom && !index) toBottom();
    }
    const mr = myRecruit();
    const rb = $('c_rec'); rb.textContent = mr ? '募集をしめる' : '相手求む'; rb.classList.toggle('pri', !mr);
    $('c_mutes').hidden = !C.mutes.size;
  }
  // 自分の募集が出ている間は、どこでも下に小さく出す
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
  const menuBtn = $('m_chat'); if (menuBtn) menuBtn.addEventListener('click', () => open());
  $('c_back').addEventListener('click', close);
  $('c_form').addEventListener('submit', e => { e.preventDefault(); send(); });
  $('c_text').addEventListener('input', () => { updateCount(); suggest(); });
  $('c_text').addEventListener('click', suggest);
  $('c_at').addEventListener('click', () => {
    const box = $('c_text');
    box.value = box.value + (box.value && !/\s$/.test(box.value) ? ' @' : '@');
    box.focus(); try { box.setSelectionRange(box.value.length, box.value.length); } catch (e) {}
    suggest();
  });
  $('c_sugg').addEventListener('pointerdown', e => e.preventDefault());   // 押しても文字入れの欄から外れない
  $('c_rec').addEventListener('click', recruit);
  $('c_mutes').addEventListener('click', muteSheet);
  $('c_dmback').addEventListener('click', () => show('dm', null));
  document.querySelectorAll('#chat .ctabs button').forEach(b => b.addEventListener('click', () => show(b.dataset.tab, null)));
  $('c_waitshut').addEventListener('click', async () => { try { await rpc('chat_close_recruit'); await refetchMine(); } catch (e) { N.toast(e.message); } });
  $('c_herald').addEventListener('click', () => {
    const h = $('c_herald');
    if (I.G.mode === 'online') { h.hidden = true; return; }
    if (h.dataset.dm) open('dm', h.dataset.dm); else open('open', null);
  });
  el.addEventListener('click', async e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.take) return take(Number(t.dataset.take), t);
    if (t.dataset.team) { if (window.IssenTeam) { close(); IssenTeam.join(t.dataset.team); } return; }
    if (t.dataset.who) { const m = C.msgs.find(x => String(x.id) === t.dataset.who); if (m) msgSheet(m); return; }
    if (t.dataset.pick) { const f = N.friends.find(x => x.id === t.dataset.pick); if (f) pickFriend(f); return; }
    if (t.dataset.open) return show('dm', t.dataset.open);
    if (t.dataset.sheet === 'close') return closeSheet();
    const op = t.dataset.op, id = t.dataset.id;
    try {
      if (op === 'shut') { await rpc('chat_close_recruit'); await refetchMine(); }
      else if (op === 'del') { await rpc('chat_delete', { p_id: Number(id) }); closeSheet(); await refetchOne(Number(id)); }
      else if (op === 'at') { const f = N.friends.find(x => x.id === id); if (f) pickFriend(f); }
      else if (op === 'dm') show('dm', id);
      else if (op === 'mute') { await rpc('chat_set_mute', { p_target: id, p_mute: true }); C.mutes.add(id); closeSheet(); N.toast(nameOf(id) + 'さんの発言を見えなくしました'); render(); }
      else if (op === 'unmute') { await rpc('chat_set_mute', { p_target: id, p_mute: false }); C.mutes.delete(id); muteSheet(); render(); }
    } catch (err) { N.toast(err.message); }
  });
  async function refetchOne(id){
    const r = await q().eq('id', id).maybeSingle();
    if (!r.error && r.data) put(r.data); else C.msgs = C.msgs.filter(x => x.id !== id);
    lastSig = ''; render();
  }

  /* =====================================================================
     対戦中のひとこと（相手にだけ届き、どこにも残らない）
     試合中は定型の一言だけ。一本の合間（決着の後〜次の一本の合図まで）は自由に打てる
     ===================================================================== */
  const PHRASES = ['いざ', 'よろしく', '見事', '参った', 'もう一本', 'かたじけない'];
  const MC_MAX = 30;
  let mcLast = 0;
  const mcBtn = $('mc_btn'), mcPanel = $('mc_panel');
  const inMatch = () => I.G.mode === 'online' && window.IssenMatch && IssenMatch.active && IssenMatch.active.started && !IssenMatch.active.ended;
  const between = () => !(I.G.phase === 'fight' || I.G.phase === 'fx');
  function mcSay(text){
    text = String(text || '').trim().slice(0, MC_MAX);
    if (!text || !inMatch()) return;
    if (N.hasLink(text)) { N.toast(N.LINK_MSG); return; }
    if (performance.now() - mcLast < 1500) return;
    mcLast = performance.now();
    IssenMatch.say(text);
    bubble(0, text);
    mcPanel.hidden = true; $('mc_text').value = ''; $('mc_text').blur();
  }
  const bubT = [0, 0];
  function bubble(side, text){
    const b = $('mc_b' + side); if (!b) return;
    b.textContent = text; b.hidden = false; b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
    clearTimeout(bubT[side]); bubT[side] = setTimeout(() => { b.hidden = true; }, 3800);
  }
  C.matchSay = text => { if (I.G.mode === 'online' && !N.hasLink(text)) bubble(1, String(text || '').slice(0, MC_MAX)); };   // リンク入りは見せない
  if (mcBtn) {
    $('mc_phr').innerHTML = PHRASES.map(p => '<button type="button" data-say="' + p + '">' + p + '</button>').join('');
    mcBtn.addEventListener('click', () => { mcPanel.hidden = !mcPanel.hidden; mcTick(); });
    mcPanel.addEventListener('click', e => { const b = e.target.closest('[data-say]'); if (b) mcSay(b.dataset.say); });
    $('mc_form').addEventListener('submit', e => { e.preventDefault(); if (between()) mcSay($('mc_text').value); });
    let wasFight = false;
    function mcTick(){
      const on = !!inMatch();
      mcBtn.hidden = !on;
      if (!on) { mcPanel.hidden = true; $('mc_b0').hidden = true; $('mc_b1').hidden = true; return; }
      const fight = !between();
      $('mc_form').hidden = fight;
      // 立ち合いが始まったら、文字入れは閉じる（操作の邪魔をしない）
      if (fight && !wasFight && document.activeElement === $('mc_text')) { $('mc_text').blur(); mcPanel.hidden = true; }
      wasFight = fight;
    }
    setInterval(mcTick, 200);
  }

  /* ---------- ログインの変化についていく ---------- */
  let seenUser = null;
  if (window.IssenZetsu) window.IssenZetsu.on(() => render());
  N.on(() => {
    const u = me() || null;
    if (u !== seenUser) { seenUser = u; if (u) start(); else { stop(); close(); } }
    render();
  });
  C.open = open; C.close = close; C.render = render;
  C.feed = onChange;   // テスト用: リアルタイムの知らせのまね
})();
