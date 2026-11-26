/* =====================================================================
   一閃 団体戦（カスタムマッチ）
   ホストが部屋を作り、赤・青（と観戦）に分かれて、四つのルールで戦う。
     大将戦 / 勝ち抜き戦 / 自由戦（勝ち残り） / トーナメント
   次に誰と誰が戦うかはサーバー（supabase/team.sql）が決める。この画面は部屋の様子を映し、
   自分の番が来たら試合を始め（IssenMatch.start）、ほかの人の試合は観戦する（IssenMatch.watch）。
   外からの入口: window.IssenTeam.join(roomId) … 寄合（オープンチャット）の「参陣」ボタンなど
   ===================================================================== */
(function(){
  const N = window.IssenNet, I = window.__issen, M = window.IssenMatch;
  const $ = id => document.getElementById(id);
  const el = $('team');
  if (!el || !N) return;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const kn = n => (I && I.kn) ? I.kn(n) : String(n);
  const toast = (m, ms) => N.toast && N.toast(m, ms);

  const RULES = {
    taisho:     { name: '大将戦',     sub: '先鋒から大将まで、一人ずつ',   desc: '出る順を決め、順に一戦ずつ。大将の勝ちは二点、ほかは一点。合計の多い方の勝ち。同点なら大将どうしの代表戦。' },
    kachinuki:  { name: '勝ち抜き戦', sub: '勝った者が残る',               desc: '出る順を決め、勝った者はそのまま次の相手と。先に全員が敗れた方の負け。一人で全員を斬ることもある。' },
    free:       { name: '自由戦',     sub: '挑む者が名乗り出る',           desc: '勝ち残り。相手の勝ち残りに挑む者が手を挙げる。一勝ごとに一点、先に決めた点に届いた方の勝ち。人数が違っても遊べる。' },
    tournament: { name: 'トーナメント', sub: '赤も青もなく、くじで組む',   desc: '出る人全員を、くじで組んだ勝ち上がり戦。最後に残った一人が優勝。' }
  };
  const TEAM = { red: '赤', blue: '青', watch: '観戦' };

  const T = {
    room: null, members: [], lineups: {}, ch: null, mine: null, invites: [], log: [],
    rule: 'taisho', busy: false, loadT: 0, started: {}, watched: {}, lateFor: null, autoWatch: true, pendingPass: null, lastStatus: null
  };
  try { T.autoWatch = localStorage.getItem('issen-team-watch') !== '0'; } catch (e) {}
  const me = () => N.user && N.user.id;
  const isHost = () => T.room && T.room.host === me();
  const myMember = () => T.members.find(m => m.user_id === me());
  const nameOf = id => { const m = T.members.find(x => x.user_id === id); if (m) return m.name; const st = T.room && T.room.state; return (st && st.names && st.names[id]) || '？'; };

  /* ---------- サーバーとのやり取り ---------- */
  async function rpc(fn, args){
    const { data, error } = await N.sb.rpc(fn, args || {});
    if (error) {
      if (error.code === 'PGRST202' || error.code === '42883') throw new Error('団体戦はまだ準備中です（データベースの設定がまだです）');
      throw new Error(N.jp(error));
    }
    return data;
  }
  async function act(fn, args, okMsg){
    if (T.busy) return; T.busy = true;
    try { const r = await rpc(fn, args); if (okMsg) toast(okMsg); await load(); return r; }
    catch (e) { toast(e.message, 4000); }
    finally { T.busy = false; render(); }
  }

  async function load(){
    if (!N.user || !T.room) { render(); return; }
    const id = T.room.id;
    const [r, m, l] = await Promise.all([
      N.sb.from('team_rooms').select('*').eq('id', id).maybeSingle(),
      N.sb.from('team_members').select('*').eq('room_id', id).order('joined_at'),
      N.sb.from('team_lineups').select('*').eq('room_id', id)
    ]);
    if (!T.room || T.room.id !== id) return;
    if (r.error || m.error) { $('t_err').textContent = N.jp(r.error || m.error); return; }
    $('t_err').textContent = '';
    const mem = m.data || [];
    if (!r.data || !mem.some(x => x.user_id === me())) {
      // 部屋がなくなった・外された
      const was = T.room; leaveLocal();
      if (was) toast(was.status === 'closed' || (r.data && r.data.status === 'closed') ? '部屋が解散されました' : '部屋から外れました', 4000);
      return;
    }
    if (r.data.status === 'closed') { leaveLocal(); toast('部屋が解散されました', 4000); return; }
    const before = T.room.status;
    T.room = r.data; T.members = mem;
    if (window.IssenZetsu) { const zk = mem.map(m => m.user_id).sort().join(','); if (zk !== T.zk) { T.zk = zk; window.IssenZetsu.refresh(mem.map(m => m.user_id)); } }
    T.lineups = {}; (l.data || []).forEach(x => { T.lineups[x.team] = x.slots || []; });
    if (before === 'playing' && T.room.status === 'done') finale();
    T.lastStatus = T.room.status;
    render(); drive();
  }
  function loadSoon(){ clearTimeout(T.loadT); T.loadT = setTimeout(load, 150); }

  function subscribe(){
    unsubscribe();
    const id = T.room.id;
    T.ch = N.sb.channel('team:' + id, { config: { private: true, broadcast: { self: true } } });
    T.ch
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_rooms', filter: 'id=eq.' + id }, loadSoon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members', filter: 'room_id=eq.' + id }, loadSoon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_lineups', filter: 'room_id=eq.' + id }, loadSoon)
      .on('broadcast', { event: 'say' }, ({ payload }) => onSay(payload))
      .subscribe(s => { if (s === 'SUBSCRIBED') load(); });
  }
  function unsubscribe(){ if (T.ch) { N.sb.removeChannel(T.ch); T.ch = null; } }

  async function enter(roomId){
    T.room = { id: roomId, state: {} }; T.members = []; T.lineups = {}; T.log = []; T.started = {}; T.watched = {}; T.lastStatus = null;
    subscribe(); await load();
  }
  function leaveLocal(){
    unsubscribe();
    if (M && M.watching) M.stopWatch();
    T.room = null; T.members = []; T.lineups = {}; T.log = [];
    render();
  }

  /* ---------- 招待（自分あて） ---------- */
  function joinMine(){
    if (T.mine) { N.sb.removeChannel(T.mine); T.mine = null; }
    if (!N.user) return;
    T.mine = N.sb.channel('tuser:' + N.user.id, { config: { private: true } });
    T.mine.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'team_invites', filter: 'to_id=eq.' + N.user.id }, p => onInvite(p.new)).subscribe();
  }
  async function loadInvites(){
    if (!N.user) return;
    const since = new Date(Date.now() - 30 * 60000).toISOString();
    const { data } = await N.sb.from('team_invites').select('*').eq('to_id', N.user.id).gt('created_at', since).order('created_at', { ascending: false }).limit(5);
    T.invites = data || []; render();
  }
  function onInvite(inv){
    if (!inv || inv.to_id !== me()) return;
    T.invites = [inv].concat(T.invites.filter(x => x.room_id !== inv.room_id)).slice(0, 5);
    if (!T.room || T.room.id !== inv.room_id) {
      $('t_invname').textContent = N.nameOf(inv.from_id);
      $('t_invbar').hidden = false; $('t_invbar').dataset.room = inv.room_id;
      clearTimeout(onInvite.t); onInvite.t = setTimeout(() => { $('t_invbar').hidden = true; }, 30000);
    }
    render();
  }
  $('t_invok').addEventListener('click', () => { $('t_invbar').hidden = true; IssenTeam.join($('t_invbar').dataset.room); });
  $('t_invno').addEventListener('click', () => { $('t_invbar').hidden = true; });

  /* ---------- 部屋の一言（部屋のチャンネルで送り合うだけ。残らない） ---------- */
  function onSay(p){
    if (!p || typeof p.t !== 'string') return;
    T.log.push({ who: String(p.who || '').slice(0, 10), t: p.t.slice(0, 60), at: Date.now() });
    if (T.log.length > 40) T.log.shift();
    renderLog();
  }
  $('t_say').addEventListener('submit', e => {
    e.preventDefault();
    const v = $('t_sayin').value.trim(); if (!v || !T.ch) return;
    T.ch.send({ type: 'broadcast', event: 'say', payload: { who: N.profile ? N.profile.name : '？', t: v } }).catch(() => {});
    $('t_sayin').value = '';
  });
  function renderLog(){
    const ul = $('t_log');
    ul.innerHTML = T.log.length ? T.log.map(x => '<li><b>' + esc(x.who) + '</b>' + esc(x.t) + '</li>').join('') : '<li class="none">待っている間、ここで話せます</li>';
    ul.scrollTop = ul.scrollHeight;
  }

  /* ---------- 入口の画面 ---------- */
  function fillTargets(sel, v){
    sel.innerHTML = Array.from({ length: 30 }, (_, i) => '<option' + (i + 1 === v ? ' selected' : '') + '>' + (i + 1) + '</option>').join('');
  }
  fillTargets($('t_target'), 5); fillTargets($('t_starget'), 5);
  $('t_rules').innerHTML = Object.keys(RULES).map(k => '<button type="button" class="trule" data-rule="' + k + '"><span class="tk">' + RULES[k].name + '</span><span class="ts">' + RULES[k].sub + '</span><span class="td">' + RULES[k].desc + '</span></button>').join('');
  $('t_rules').addEventListener('click', e => { const b = e.target.closest('[data-rule]'); if (!b) return; T.rule = b.dataset.rule; render(); });
  $('t_create').addEventListener('click', async () => {
    if (T.busy) return; T.busy = true; $('t_create').disabled = true;
    try {
      const id = await rpc('team_create', { p_rule: T.rule, p_to_win: +$('t_towin').value, p_target: +$('t_target').value, p_pass: $('t_pass').value });
      $('t_pass').value = '';
      await enter(id);
    } catch (e) { toast(e.message, 4000); }
    T.busy = false; $('t_create').disabled = false; render();
  });
  $('t_jform').addEventListener('submit', async e => {
    e.preventDefault();
    const code = $('t_code').value.trim().toUpperCase(), msg = $('t_jmsg');
    if (T.pendingPass) { await tryJoin(T.pendingPass, null, $('t_jpass').value); return; }
    if (!/^[A-Z0-9]{6}$/.test(code)) { msg.textContent = '部屋番号は6文字の英数字です'; return; }
    await tryJoin(null, code, $('t_jpass').value);
  });
  async function tryJoin(room, code, pass){
    const msg = $('t_jmsg'); msg.textContent = '入っています…';
    try {
      const id = await rpc('team_join', { p_room: room, p_code: code, p_pass: pass || null });
      msg.textContent = ''; $('t_code').value = ''; $('t_jpass').value = ''; T.pendingPass = null;
      await enter(id); open();
    } catch (e) {
      if (/合言葉/.test(e.message)) {
        T.pendingPass = room; msg.textContent = e.message + '。下に入れて「入る」を押してください';
        if (room) $('t_code').value = '（誘われた部屋）';
        open(); setTimeout(() => $('t_jpass').focus(), 50);
      } else { msg.textContent = e.message; toast(e.message, 4000); }
    }
    render();
  }

  /* ---------- 部屋の主の設定 ---------- */
  $('t_srule').addEventListener('change', () => render());
  $('t_ssave').addEventListener('click', () => {
    const pass = $('t_spass').value;
    act('team_settings', { p_room: T.room.id, p_rule: $('t_srule').value, p_to_win: +$('t_stowin').value, p_target: +$('t_starget').value,
      p_pass: $('t_spass').dataset.dirty === '1' ? pass : null }, '設定を変えました');
    $('t_spass').dataset.dirty = '';
  });
  $('t_spass').addEventListener('input', () => { $('t_spass').dataset.dirty = '1'; });

  /* ---------- 部屋の中のボタン ---------- */
  // 二度押しの確かめ。画面が描き直されても覚えておく
  let armed = null;
  function confirmTwice(btn, text){
    const key = btn.dataset.ta + ':' + (btn.dataset.id || '');
    if (armed && armed.key === key && performance.now() < armed.until) { armed = null; return true; }
    armed = { key, text, until: performance.now() + 2500 };
    btn.textContent = text;
    setTimeout(() => { if (armed && armed.key === key && performance.now() >= armed.until) { armed = null; render(); } }, 2600);
    return false;
  }
  function reArm(){
    if (!armed || performance.now() >= armed.until) return;
    const [ta, id] = armed.key.split(':');
    el.querySelectorAll('button[data-ta="' + ta + '"]').forEach(b => { if ((b.dataset.id || '') === id) b.textContent = armed.text; });
  }
  el.addEventListener('click', async e => {
    const b = e.target.closest('button[data-ta]'); if (!b || !T.room) return;
    const a = b.dataset.ta, id = b.dataset.id, R = T.room.id;
    if (a === 'team') return act('team_set_team', { p_room: R, p_user: id || me(), p_team: b.dataset.team });
    if (a === 'kick') { if (confirmTwice(b, '外す')) act('team_kick', { p_room: R, p_user: id }); return; }
    if (a === 'start') return act('team_start', { p_room: R });
    if (a === 'hand') return act('team_challenge', { p_room: R, p_on: b.dataset.on === '1' });
    if (a === 'redo') return act('team_redo', { p_room: R });
    if (a === 'forfeit') { if (confirmTwice(b, nameOf(id) + 'の負けにする')) act('team_forfeit', { p_room: R, p_loser: id }); return; }
    if (a === 'finish') { if (confirmTwice(b, 'もう一度押すと終わる')) act('team_finish', { p_room: R }); return; }
    if (a === 'again') return act('team_again', { p_room: R });
    if (a === 'close') { if (confirmTwice(b, 'もう一度押すと解散')) { await act('team_close', { p_room: R }); leaveLocal(); } return; }
    if (a === 'leave') { if (confirmTwice(b, 'もう一度押すと出る')) { try { await rpc('team_leave', { p_room: R }); } catch (err) {} leaveLocal(); } return; }
    if (a === 'invite') { b.disabled = true; try { await rpc('team_invite', { p_room: R, p_to: id }); toast(N.nameOf(id) + 'さんを誘いました'); } catch (err) { toast(err.message, 4000); b.disabled = false; } return; }
    if (a === 'ad') return postAd(b);
    if (a === 'copy') { const c = T.room.code; try { navigator.clipboard.writeText(c).then(() => toast('部屋番号を写しました'), () => toast('部屋番号 ' + c)); } catch (err) { toast('部屋番号 ' + c); } return; }
    if (a === 'watchnow') { T.watched = {}; T.lateFor = null; drive(true); return; }
    if (a === 'invs') { $('t_flist').hidden = !$('t_flist').hidden; return; }
  });
  el.addEventListener('change', e => {
    const s = e.target.closest('select[data-slot]'); if (!s || !T.room) return;
    const team = s.dataset.team, i = +s.dataset.slot;
    const slots = curLineup(team).slice(), old = slots[i]; slots[i] = s.value;
    // 選んだ人がほかの枠にいて、元の人がどこにもいなくなるなら入れ替える
    const j = slots.findIndex((x, k) => k !== i && x === s.value);
    if (j >= 0 && !slots.includes(old)) slots[j] = old;
    act('team_set_lineup', { p_room: T.room.id, p_team: team, p_slots: slots });
  });

  async function postAd(b){
    const R = RULES[T.room.rule];
    b.disabled = true;
    try {
      const { error } = await N.sb.rpc('chat_post', { p_body: R.name + 'の仲間を募っています', p_kind: 'team',
        p_ref: { room: T.room.id, rule: T.room.rule, host: nameOf(T.room.host), n: T.members.length } });
      if (error) throw error;
      toast('寄合に募集を流しました');
    } catch (e) {
      toast(e && (e.code === 'PGRST202' || e.code === '42883') ? '寄合（チャット）はまだ準備中です。部屋番号 ' + T.room.code + ' を伝えてください' : N.jp(e), 5000);
    }
    setTimeout(() => { b.disabled = false; }, 20000);
  }

  /* ---------- 出る順 ---------- */
  function teamList(t){ return T.members.filter(m => m.team === t).map(m => m.user_id); }
  function slotCount(t){
    if (T.room.rule === 'taisho') return Math.max(teamList('red').length, teamList('blue').length, 1);
    return teamList(t).length;
  }
  function curLineup(t){
    const mem = teamList(t), n = slotCount(t), want = T.lineups[t] || [];
    const out = [];
    for (let i = 0; i < n; i++) out.push(want[i] && mem.includes(want[i]) ? want[i] : null);
    // 空いた枠は、まだ出ていない人→順に埋める
    const left = mem.filter(id => !out.includes(id)); let k = 0;
    for (let i = 0; i < n; i++) if (!out[i]) out[i] = left.length ? left.shift() : mem[(k++) % mem.length];
    return out;
  }
  function posName(i, n){
    if (i === n - 1) return '大将';
    if (n === 2) return '先鋒';
    if (n === 3) return ['先鋒', '中堅'][i];
    if (n === 4) return ['先鋒', '中堅', '副将'][i];
    if (i === n - 2) return '副将'; if (i === n - 3) return '中堅';
    if (i === 0) return '先鋒'; if (i === 1) return '次鋒';
    return ['三', '四', '五', '六', '七', '八', '九'][i - 2] + '鋒';
  }

  /* ---------- 描く ---------- */
  function memberRow(m){
    const mine = m.user_id === me(), host = m.user_id === T.room.host, lobby = T.room.status === 'lobby';
    const free = T.room.status === 'playing' && T.room.rule === 'free';
    let btns = '';
    if ((mine || isHost()) && (lobby || free)) {
      ['red', 'blue', 'watch'].filter(t => t !== m.team).forEach(t => {
        btns += '<button type="button" class="obtn tmv ' + t + '" data-ta="team" data-id="' + m.user_id + '" data-team="' + t + '">' + (t === 'watch' ? '観る' : TEAM[t] + 'へ') + '</button>';
      });
    }
    if (isHost() && !mine) btns += '<button type="button" class="obtn" data-ta="kick" data-id="' + m.user_id + '">外す</button>';
    return '<li class="' + (mine ? 'me' : '') + '"><span class="onm">' + esc(m.name) + (window.IssenZetsu ? window.IssenZetsu.mark(m.user_id) : '') + '</span>' + (host ? '<span class="thmark">主</span>' : '') + '<span class="ost"></span>' + btns + '</li>';
  }

  function renderLobby(){
    const R = RULES[T.room.rule], tour = T.room.rule === 'tournament';
    const red = T.members.filter(m => m.team === 'red'), blue = T.members.filter(m => m.team === 'blue'), watch = T.members.filter(m => m.team === 'watch');
    let h = '<p class="tdesc">' + R.desc + '</p>';
    if (tour) {
      h += '<div class="tcol one"><h4>出る人 ' + (red.length + blue.length) + '</h4><ul class="olist">' + red.concat(blue).map(memberRow).join('') + '</ul></div>';
    } else {
      h += '<div class="tcols"><div class="tcol red"><h4>赤 <small>' + red.length + '人</small></h4><ul class="olist">' + (red.map(memberRow).join('') || '<li class="none">まだいません</li>') + '</ul></div>' +
           '<div class="tcol blue"><h4>青 <small>' + blue.length + '人</small></h4><ul class="olist">' + (blue.map(memberRow).join('') || '<li class="none">まだいません</li>') + '</ul></div></div>';
    }
    h += '<div class="tcol watch"><h4>観戦 <small>' + watch.length + '人</small></h4><ul class="olist">' + (watch.map(memberRow).join('') || '<li class="none">いません</li>') + '</ul></div>';
    // 出る順（自分のチームだけ。相手には始まるまで見えない）
    const mm = myMember();
    if ((T.room.rule === 'taisho' || T.room.rule === 'kachinuki') && mm && mm.team !== 'watch') {
      const t = mm.team, mem = T.members.filter(m => m.team === t), slots = curLineup(t), n = slots.length;
      h += '<div class="tline ' + t + '"><h4>' + TEAM[t] + 'の出る順 <small>相手には始まるまで見えません</small></h4><ol>';
      slots.forEach((id, i) => {
        h += '<li><span class="tpos">' + (T.room.rule === 'taisho' ? posName(i, n) : kn(i + 1) + '番手') + '</span><select data-team="' + t + '" data-slot="' + i + '">' +
          mem.map(m => '<option value="' + m.user_id + '"' + (m.user_id === id ? ' selected' : '') + '>' + esc(m.name) + '</option>').join('') + '</select></li>';
      });
      h += '</ol>';
      if (T.room.rule === 'taisho' && mem.length < n) h += '<p class="gnote">人数が少ないので、だれかが二度出ます（' + n + '枠）。</p>';
      h += '</div>';
    }
    // フレンドを誘う
    const inRoom = new Set(T.members.map(m => m.user_id));
    const fr = N.friends.filter(f => !inRoom.has(f.id));
    h += '<div class="tinv"><button type="button" class="obtn" data-ta="invs">フレンドを誘う</button> <button type="button" class="obtn" data-ta="ad">寄合で募る</button>' +
         '<ul class="olist" id="t_flist" hidden>' + (fr.length ? fr.map(f => {
           const s = N.statusOf(f.id);
           return '<li><span class="odot ' + (s === 'online' ? 'on' : s === 'playing' ? 'play' : 'off') + '"></span><span class="onm">' + esc(f.name) + '</span><span class="ost"></span>' +
             '<button type="button" class="obtn pri" data-ta="invite" data-id="' + f.id + '">誘う</button></li>';
         }).join('') : '<li class="none">誘えるフレンドがいません</li>') + '</ul></div>';
    return h;
  }

  function vs(a, b, cls){
    return '<div class="tvs ' + (cls || '') + '"><span class="tn red">' + esc(nameOf(a)) + '</span><span class="tx">対</span><span class="tn blue">' + esc(nameOf(b)) + '</span></div>';
  }
  function boutLine(b){
    const w = b.w, s = b.s ? '　' + (w === b.a ? b.s[0] + '−' + b.s[1] : b.s[1] + '−' + b.s[0]) : '';
    return '<li><span class="tlab">' + esc(b.label || '') + '</span><span class="' + (w === b.a ? 'tw red' : '') + '">' + esc(nameOf(b.a)) + '</span><span class="tx">対</span><span class="' + (w === b.b ? 'tw blue' : '') + '">' + esc(nameOf(b.b)) + '</span>' +
      '<span class="tres">' + (b.why ? b.why + '・' : '') + esc(nameOf(w)) + 'の勝ち' + s + '</span></li>';
  }

  function renderPlay(){
    const st = T.room.state || {}, rule = T.room.rule, cur = st.cur, mid = me();
    let h = '';
    // 点数
    if (rule === 'taisho' || rule === 'free') {
      h += '<div class="tscore"><span class="red">' + (st.score ? st.score.red : 0) + '</span><span class="tdash">−</span><span class="blue">' + (st.score ? st.score.blue : 0) + '</span></div>';
      if (rule === 'free') h += '<p class="tlead">先に ' + T.room.target + ' 点で勝ち</p>';
    }
    if (rule === 'kachinuki' && st.order) {
      h += '<div class="tcols">' + ['red', 'blue'].map(t => '<div class="tcol ' + t + '"><h4>' + TEAM[t] + '</h4><ol class="tord">' +
        st.order[t].map((id, i) => '<li class="' + (i < st.idx[t] ? 'out' : i === st.idx[t] ? 'now' : '') + '">' + esc(nameOf(id)) + '</li>').join('') + '</ol></div>').join('') + '</div>';
    }
    // 今の試合
    if (cur) {
      const mine = cur.a === mid || cur.b === mid;
      h += '<div class="tcur ' + (cur.st === 'stop' ? 'stop' : '') + '"><div class="tlab">' + esc(cur.label || '') + (cur.pts === 2 ? '　<small>勝ち点二</small>' : '') + '</div>' + vs(cur.a, cur.b, 'big');
      if (cur.st === 'play') {
        h += '<p class="tstat">' + (mine ? 'あなたの番です' : M && M.watching && M.watching.id === cur.match ? '観戦の準備中…' : T.lateFor === cur.match ? '途中からは観られません。結果を待っています' : '試合中') + '</p>';
        if (!mine && (!M || !M.watching) && !(I.G.mode === 'online')) h += '<div class="tacts"><button type="button" class="obtn" data-ta="watchnow">観戦する</button></div>';
      } else if (cur.st === 'stop') {
        h += '<p class="tstat">試合が止まりました（' + esc(cur.why || '') + '）</p>';
      }
      if (isHost()) {
        h += '<div class="tacts">' + (cur.st === 'stop' ? '<button type="button" class="obtn pri" data-ta="redo">もう一度</button>' : '') +
             '<button type="button" class="obtn" data-ta="forfeit" data-id="' + cur.a + '">' + esc(nameOf(cur.a)) + 'の負け</button>' +
             '<button type="button" class="obtn" data-ta="forfeit" data-id="' + cur.b + '">' + esc(nameOf(cur.b)) + 'の負け</button></div>' +
             (cur.st === 'play' ? '<p class="gnote">相手が来ない・通信が切れたときは、部屋の主が負けを決められます。</p>' : '');
      }
      h += '</div>';
    }
    // 自由戦: 挑む
    if (rule === 'free') {
      const champ = st.champ, hands = st.hands || { red: [], blue: [] }, mm = myMember();
      if (champ) h += '<p class="tchamp">勝ち残り　<b class="' + champ.team + '">' + esc(nameOf(champ.id)) + '</b>　' + kn(champ.wins) + '人抜き</p>';
      h += '<div class="tcols">' + ['red', 'blue'].map(t => '<div class="tcol ' + t + '"><h4>' + TEAM[t] + 'の挑む者</h4><ol class="tord">' +
        ((hands[t] || []).map(id => '<li>' + esc(nameOf(id)) + '</li>').join('') || '<li class="none">いない</li>') + '</ol></div>').join('') + '</div>';
      if (mm && mm.team !== 'watch') {
        const up = (hands[mm.team] || []).includes(mid), isChamp = champ && champ.id === mid, inBout = cur && (cur.a === mid || cur.b === mid);
        if (!isChamp && !inBout) h += '<div class="tacts"><button type="button" class="gpull thand' + (up ? ' sec' : '') + '" data-ta="hand" data-on="' + (up ? 0 : 1) + '">' + (up ? '挑むのをやめる' : '挑む') + '</button></div>';
      }
      if (!cur) h += '<p class="tstat">' + (champ ? (champ.team === 'red' ? '青' : '赤') + 'の挑む者を待っています' : '赤と青から一人ずつ「挑む」と始まります') + '</p>';
      // 自由戦は途中でチームを変えられる
      h += '<details class="tmem"><summary>顔ぶれとチーム</summary><ul class="olist">' + T.members.map(m => memberRow(m).replace('<span class="ost"></span>', '<span class="ost">' + TEAM[m.team] + '</span>')).join('') + '</ul></details>';
    }
    // トーナメント表
    if (rule === 'tournament' && st.rounds) {
      h += '<div class="tbr">' + st.rounds.map((rd, r) => {
        const title = rd.length === 2 ? '決勝' : rd.length === 4 ? '準決勝' : kn(r + 1) + '回戦';
        const pairs = []; for (let k = 0; k < rd.length / 2; k++) pairs.push([rd[2 * k], rd[2 * k + 1], st.win && st.win[r] ? st.win[r][k] : null]);
        return '<div class="tround"><h4>' + title + '</h4>' + pairs.map(([a, b, w]) => '<div class="tpair' + (cur && cur.round === r && ((cur.a === a && cur.b === b)) ? ' now' : '') + '">' +
          '<span class="' + (w && w === a ? 'tw' : w ? 'tl' : '') + '">' + (a ? esc(nameOf(a)) : '—') + '</span>' +
          '<span class="' + (w && w === b ? 'tw' : w ? 'tl' : '') + '">' + (b ? esc(nameOf(b)) : '—') + '</span></div>').join('') + '</div>';
      }).join('') + '</div>';
    }
    if (rule === 'taisho' && st.plan) {
      const done = st.bouts || [];
      h += '<ol class="tplan">' + st.plan.map((p, i) => {
        const b = done[i];
        return '<li class="' + (b ? 'done' : cur && cur.n === i + 1 ? 'now' : '') + '"><span class="tpos">' + esc(p.label) + '</span><span class="' + (b && b.w === p.a ? 'tw red' : 'red') + '">' + esc(nameOf(p.a)) + '</span><span class="tx">対</span><span class="' + (b && b.w === p.b ? 'tw blue' : 'blue') + '">' + esc(nameOf(p.b)) + '</span>' +
          '<span class="tres">' + (b ? (b.w === p.a ? '赤' : '青') + ' +' + p.pts + (b.why ? '（' + b.why + '）' : '') : '') + '</span></li>';
      }).join('') + '</ol>';
    }
    // これまでの試合（大将戦は上の表で見える）
    if (rule !== 'taisho' && (st.bouts || []).length) h += '<h3>これまで</h3><ol class="thist">' + st.bouts.slice().reverse().map(boutLine).join('') + '</ol>';
    if (rule === 'taisho' && (st.bouts || []).some(b => b.daihyo)) h += '<ol class="thist">' + st.bouts.filter(b => b.daihyo).map(boutLine).join('') + '</ol>';
    h += '<label class="pchk twatch"><input type="checkbox" ' + (T.autoWatch ? 'checked' : '') + ' data-ta-check="1"> ほかの人の試合を自動で観戦する</label>';
    return h;
  }

  function renderDone(){
    const st = T.room.state || {}, w = st.winner, rule = T.room.rule;
    let big, cls = '';
    if (rule === 'tournament') { big = w && w !== 'draw' ? esc(nameOf(w)) : '勝負なし'; cls = 'gold'; }
    else if (w === 'red' || w === 'blue') { big = TEAM[w] + 'の勝ち'; cls = w; }
    else big = '引き分け';
    let h = '<div class="tfin ' + cls + '"><div class="tfk">' + (rule === 'tournament' && w && w !== 'draw' ? '優勝' : RULES[rule].name) + '</div><div class="tfb">' + big + '</div>';
    if (st.score && (rule === 'taisho' || rule === 'free')) h += '<div class="tfs">赤 ' + st.score.red + ' − ' + st.score.blue + ' 青</div>';
    if (st.ended_by_host) h += '<div class="tfs">部屋の主が終わらせました</div>';
    h += '</div>';
    if ((st.bouts || []).length) h += '<h3>試合の記録</h3><ol class="thist">' + st.bouts.map(boutLine).join('') + '</ol>';
    return h;
  }

  function render(){
    const ok = N.configured() && N.ready, logged = ok && !!N.user;
    $('m_team_s').textContent = T.room ? (T.room.status === 'playing' ? '部屋で試合中' : '部屋にいます') : '赤と青に分かれて';
    $('t_login').hidden = logged;
    $('t_entry').hidden = !logged || !!T.room;
    $('t_room').hidden = !logged || !T.room;
    if (el.hidden) return;
    if (!logged) return;
    if (!T.room) {
      document.querySelectorAll('#t_rules .trule').forEach(b => b.classList.toggle('on', b.dataset.rule === T.rule));
      $('t_targetrow').hidden = T.rule !== 'free';
      $('t_invs').innerHTML = T.invites.length ? '<h3>届いた誘い</h3><ul class="olist">' + T.invites.map(v =>
        '<li><span class="onm">' + esc(N.nameOf(v.from_id)) + '</span><span class="ost">さんから</span><button type="button" class="obtn pri" data-tjoin="' + v.room_id + '">参陣</button></li>').join('') + '</ul>' : '';
      $('t_jpass').placeholder = T.pendingPass ? '合言葉を入れてください' : '合言葉（あれば）';
      return;
    }
    const R = RULES[T.room.rule] || RULES.taisho, st = T.room.status;
    $('t_head').innerHTML = '<div class="trname">' + R.name + '</div>' +
      '<div class="trmeta">部屋番号 <b>' + esc(T.room.code || '') + '</b> <button type="button" class="obtn" data-ta="copy">写す</button>' +
      (T.room.has_pass ? '<span class="tpassmark">合言葉あり</span>' : '') + '<span>一試合 ' + kn(T.room.to_win || 2) + '本先取</span>' +
      '<span>主 ' + esc(nameOf(T.room.host)) + '</span></div>';
    $('t_body').innerHTML = st === 'lobby' ? renderLobby() : st === 'playing' ? renderPlay() : st === 'done' ? renderDone() : '';
    const hs = $('t_hostset'); hs.hidden = !(isHost() && st === 'lobby');
    const key = T.room.rule + '|' + T.room.to_win + '|' + T.room.target;
    if (!hs.hidden && hs.dataset.key !== key) { $('t_srule').value = T.room.rule; $('t_stowin').value = T.room.to_win; $('t_starget').value = T.room.target; hs.dataset.key = key; }
    $('t_stargetrow').hidden = $('t_srule').value !== 'free';
    let f = '';
    if (st === 'lobby') {
      if (isHost()) f += '<button type="button" class="gpull" data-ta="start">はじめる</button><button type="button" class="obtn" data-ta="close">解散</button>';
      else f += '<p class="gnote">部屋の主がはじめるのを待っています</p><button type="button" class="obtn" data-ta="leave">部屋を出る</button>';
    } else if (st === 'playing') {
      if (isHost()) f += '<button type="button" class="obtn" data-ta="finish">' + (T.room.rule === 'free' ? '今の点で終わらせる' : '途中で終わらせる') + '</button><button type="button" class="obtn" data-ta="close">解散</button>';
      else f += '<button type="button" class="obtn" data-ta="leave">部屋を出る</button>';
    } else if (st === 'done') {
      if (isHost()) f += '<button type="button" class="gpull" data-ta="again">同じ顔ぶれでもう一度</button><button type="button" class="obtn" data-ta="close">解散</button>';
      else f += '<p class="gnote">部屋の主が「もう一度」を押すと、この部屋で続けられます</p><button type="button" class="obtn" data-ta="leave">部屋を出る</button>';
    }
    $('t_foot').innerHTML = f;
    renderLog(); reArm();
  }
  el.addEventListener('change', e => { if (e.target.dataset && e.target.dataset.taCheck) { T.autoWatch = e.target.checked; try { localStorage.setItem('issen-team-watch', T.autoWatch ? '1' : '0'); } catch (err) {} drive(); } });
  el.addEventListener('click', e => { const b = e.target.closest('[data-tjoin]'); if (b) IssenTeam.join(b.dataset.tjoin); });

  /* ---------- 決着の演出（部屋の勝敗が決まったとき） ---------- */
  function finale(){
    const st = T.room.state || {}, w = st.winner, rule = T.room.rule;
    if (st.ended_by_host && rule !== 'free') return;
    const c = $('t_turn'), t = $('t_turnt'), s = $('t_turns');
    c.classList.remove('red', 'blue', 'gold');
    if (rule === 'tournament') { t.textContent = '優勝'; s.textContent = w ? nameOf(w) : ''; c.classList.add('gold'); }
    else if (w === 'red' || w === 'blue') { t.textContent = TEAM[w] + 'の勝ち'; s.textContent = RULES[rule].name + '　決着'; c.classList.add(w); }
    else { t.textContent = '引き分け'; s.textContent = RULES[rule].name; }
    const show = () => { c.hidden = false; c.classList.add('fin'); setTimeout(() => { c.hidden = true; c.classList.remove('fin'); }, 3800); };
    // 自分の試合の結果画面が出ている間は、そのあとに
    if (I.G.mode === 'online') { const wait = setInterval(() => { if (I.G.mode !== 'online') { clearInterval(wait); open(); show(); } }, 400); }
    else { open(); show(); }
  }
  function turnCover(cur){
    const c = $('t_turn'); c.classList.remove('red', 'blue', 'gold', 'fin');
    $('t_turnt').textContent = '出番';
    $('t_turns').textContent = (cur.label || '') + '　' + nameOf(cur.a) + ' 対 ' + nameOf(cur.b);
    c.hidden = false; setTimeout(() => { c.hidden = true; }, 1600);
  }

  /* ---------- 自分の番・観戦を動かす ---------- */
  function tagOf(cur){ return RULES[T.room.rule].name + '　' + (cur.label || ''); }
  function drive(force){
    if (!T.room || T.room.status !== 'playing' || !M) return;
    const cur = T.room.state && T.room.state.cur, mid = me();
    if (!cur || cur.st !== 'play' || !cur.match) return;
    const mine = cur.a === mid || cur.b === mid;
    if (mine) {
      if (T.started[cur.match] || M.active) return;
      if (M.watching) {
        // 観戦中の試合は、結果が出るところまで見せてから（観戦は少し遅れて再生している）。ただし長くは待たない
        T.waitFrom = T.waitFrom || {}; T.waitFrom[cur.match] = T.waitFrom[cur.match] || performance.now();
        const late = performance.now() - T.waitFrom[cur.match] > 9000;
        if (!late && I.G.mode === 'online' && I.NET.watch && I.G.phase !== 'match') return;
        if (!late && I.G.mode === 'online' && I.G.phase === 'match' && I.now() - I.G.resultAt < 2500) return;
        M.stopWatch(); return;
      }
      // ひとつ前の試合の結果を見ている間は、少し待ってから
      if (I.G.mode === 'online') { if (I.G.phase === 'match' && I.now() - I.G.resultAt > 3500) I.goTitle(); return; }
      if (I.G.mode !== 'title') I.goTitle();
      T.started[cur.match] = true;
      document.getElementById('gacha').hidden = true; $('online').hidden = true; $('rank').hidden = true;
      turnCover(cur);
      setTimeout(() => {
        el.hidden = true;
        M.start(cur.match, cur.a === mid ? 0 : 1, { team: true, toWin: cur.to_win, tag: tagOf(cur), back: '画面をタップで部屋へ',
          onEnd: () => { if (T.room) { open(); load(); } } });
      }, 1200);
      return;
    }
    // 観戦
    if (!T.autoWatch && !force) return;
    if (M.active || M.watching || T.watched[cur.match]) return;
    // 自分の試合や観戦の結果を見ている間に次の試合が始まったら、少し見せてから部屋へ戻って観戦する
    if (I.G.mode === 'online') { if (I.G.phase === 'match' && I.now() - I.G.resultAt > 4500) I.goTitle(); return; }
    if (I.G.mode !== 'title') return;   // CPU戦などで遊んでいる人は引っぱらない
    if (!force && el.hidden) return;    // 団体戦の画面を開いている人だけ
    T.watched[cur.match] = true;
    const ok = M.watch(cur.match, { seed: cur.seed, toWin: cur.to_win, names: [nameOf(cur.a), nameOf(cur.b)], ids: [cur.a, cur.b], tag: tagOf(cur), back: '画面をタップで部屋へ',
      onStart: () => { el.hidden = true; },
      onEnd: why => { if (why === 'late') { T.lateFor = cur.match; } if (T.room) { open(); load(); } } });
    if (!ok) T.watched[cur.match] = false;
    render();
  }
  setInterval(() => {
    if (!T.room) return;
    drive();
    // 部屋の勝敗が決まったら、試合の結果を少し見せてから部屋の画面（決着の幕）へ
    if (T.room.status === 'done' && I.G.mode === 'online' && I.G.phase === 'match' && I.now() - I.G.resultAt > 5000) I.goTitle();
  }, 700);
  // 部屋の主の便り・念のための読み直し
  setInterval(() => { if (T.room && isHost() && T.room.status !== 'closed') N.sb.rpc('team_heartbeat', { p_room: T.room.id }); }, 20000);
  setInterval(() => { if (T.room && !M.active && !M.watching) load(); }, 10000);

  /* ---------- 開け閉め ---------- */
  function open(){ el.hidden = false; render(); if (N.user) { N.refreshFriends && N.refreshFriends(); if (!T.room) loadInvites(); } }
  function close(){ el.hidden = true; }
  $('m_team').addEventListener('click', () => { open(); if (T.room) load(); });
  $('t_back').addEventListener('click', close);
  $('t_go').addEventListener('click', () => { close(); $('m_online').click(); });

  // ログインしたら、前にいた部屋へ戻る
  let lastUser = null;
  if (window.IssenZetsu) window.IssenZetsu.on(() => render());
  N.on(() => {
    const u = N.user ? N.user.id : null;
    if (u !== lastUser) {
      lastUser = u;
      if (!u) { leaveLocal(); if (T.mine) { N.sb.removeChannel(T.mine); T.mine = null; } }
      else {
        joinMine(); loadInvites();
        N.sb.rpc('team_current').then(({ data }) => { if (data && !T.room) enter(data); }, () => {});
      }
    }
    if (!el.hidden) render();
  });

  window.IssenTeam = {
    /* 外からの入口（寄合の「参陣」・招待）。部屋の uuid を渡す */
    join: async function(roomId){
      if (!roomId) return;
      if (!N.user) { toast('先にオンラインでログインしてください'); $('m_online').click(); return; }
      if (T.room && T.room.id === roomId) { open(); return; }
      if (I.G.mode !== 'title' && I.G.mode !== 'online') I.goTitle();
      if (M && M.active) { toast('試合が終わってから入ってください'); return; }
      $('online').hidden = true; $('rank').hidden = true; document.getElementById('gacha').hidden = true;
      const chat = document.getElementById('chat'); if (chat && !chat.hidden && chat.id) chat.hidden = true;
      await tryJoin(roomId, null, null);
    },
    open, state: () => T
  };
  render();
})();
