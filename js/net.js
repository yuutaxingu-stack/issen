/* =====================================================================
   一閃 オンライン: Supabase とのやり取り
   ログイン・フレンド・オンライン状態・招待を受け持つ。
   対戦そのものの同期は js/online-match.js。
   ===================================================================== */
(function(){
  const C = window.ISSEN_ONLINE || {};
  const LIB = 'js/vendor/supabase-2.118.0.js';
  const N = {
    sb: null, ready: false, error: '',
    user: null, profile: null,
    friends: [], incoming: [], outgoing: [],   // {id,name,code}
    presence: {},                               // id -> 'online' | 'playing'
    status: 'online',
    invite: null,                               // 届いている招待 {id,from_id,name,until}
    waiting: null,                              // 返事を待っている招待 {id,to_id,name,until}
    listeners: new Set()
  };
  let lobby = null, mine = null, friendTimer = 0;

  function emit(){ N.listeners.forEach(f => { try { f(); } catch (e) { console.error(e); } }); }
  N.on = f => N.listeners.add(f);
  N.configured = () => !!(C.url && C.anonKey);
  // リンク（URL）を書かせない。判定は js/no-link.js、サーバーでも同じものを弾く（神様は通す）
  N.hasLink = t => !!(window.IssenNoLink && IssenNoLink.has(t));
  N.LINK_MSG = 'リンク（URL）は書き込めません';
  N.isGod = () => !!(window.__issen && __issen.isGod && __issen.isGod());

  // Supabase の言葉を、やさしい日本語に
  function jp(err){
    const m = String((err && (err.message || err.msg || err.error_description)) || err || '');
    const code = err && (err.code || err.error_code);
    if (/Invalid login credentials/i.test(m)) return 'ログインIDかパスワードが違います';
    if (/already registered|already exists|User already/i.test(m)) return 'そのログインIDはもう使われています';
    if (/Password should be at least/i.test(m)) return 'パスワードは6文字以上にしてください';
    if (code === 'email_address_invalid' || /Email address .* is invalid/i.test(m)) return '登録の設定に問題があります（作った人に知らせてください）';
    if (/rate limit|too many/i.test(m)) return '少し時間をおいてからもう一度試してください';
    if (/Failed to fetch|NetworkError|network/i.test(m)) return '通信できませんでした。電波のよい所でもう一度試してください';
    if (/[ぁ-んァ-ン一-龥]/.test(m)) return m;   // サーバーの処理が返した日本語はそのまま
    return 'うまくいきませんでした（' + m + '）';
  }
  N.jp = jp;

  function loadLib(){
    return new Promise((res, rej) => {
      if (window.supabase && window.supabase.createClient) return res();
      const s = document.createElement('script'); s.src = LIB; s.async = true;
      s.onload = () => res(); s.onerror = () => rej(new Error('通信の部品を読み込めませんでした'));
      document.head.appendChild(s);
    });
  }

  N.init = async function(){
    if (!N.configured()) { N.ready = true; emit(); return; }
    try {
      await loadLib();
      N.sb = window.supabase.createClient(C.url, C.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'issen-auth-v1' }
      });
      N.sb.auth.onAuthStateChange((ev, session) => {
        // ここで直接 Supabase を呼ぶと止まることがあるので、少し後で
        setTimeout(() => applySession(session, ev), 0);
      });
      const { data } = await N.sb.auth.getSession();
      await applySession(data.session, 'INITIAL');
    } catch (e) { N.error = jp(e); }
    N.ready = true; emit();
  };

  async function applySession(session, ev){
    const uid = session && session.user ? session.user.id : null;
    if (session) { try { await N.sb.realtime.setAuth(session.access_token); } catch (e) {} }
    if (uid && N.user && uid === N.user.id) return;
    teardown();
    N.user = session ? session.user : null;
    if (N.user) {
      await loadProfile();
      await refreshFriends();
      await loadPendingInvite();
      joinLobby(); joinMine();
      clearInterval(friendTimer); friendTimer = setInterval(refreshFriends, 45000);
    }
    emit();
  }

  function teardown(){
    clearInterval(friendTimer);
    if (lobby) { N.sb.removeChannel(lobby); lobby = null; }
    if (mine) { N.sb.removeChannel(mine); mine = null; }
    N.profile = null; N.friends = []; N.incoming = []; N.outgoing = []; N.presence = {}; N.invite = null; N.waiting = null;
  }

  /* ---------- 登録・ログイン ---------- */
  const emailOf = login => login + '@' + (C.emailDomain || 'players.issen.app');
  const LOGIN_RE = /^[a-z0-9_]{3,16}$/;

  N.signUp = async function(login, password, name){
    login = String(login || '').trim().toLowerCase(); name = String(name || '').trim();
    if (!LOGIN_RE.test(login)) throw new Error('ログインIDは英小文字・数字・_ で3〜16文字にしてください');
    if (String(password || '').length < 6) throw new Error('パスワードは6文字以上にしてください');
    if (name.length < 1 || name.length > 10) throw new Error('名前は1〜10文字にしてください');
    if (N.hasLink(name)) throw new Error('名前に' + N.LINK_MSG);
    const av = await N.sb.rpc('login_available', { p_login: login });
    if (av.error) throw new Error(jp(av.error));
    if (!av.data) throw new Error('そのログインIDはもう使われています');
    const { data, error } = await N.sb.auth.signUp({ email: emailOf(login), password, options: { data: { login, name } } });
    if (error) throw new Error(jp(error));
    if (!data.session) throw new Error('登録はできましたが、ログインできませんでした（Supabase の「Confirm email」をオフにしてください）');
  };

  N.signIn = async function(login, password){
    login = String(login || '').trim().toLowerCase();
    if (!login || !password) throw new Error('ログインIDとパスワードを入れてください');
    const { error } = await N.sb.auth.signInWithPassword({ email: emailOf(login), password });
    if (error) throw new Error(jp(error));
  };

  N.signOut = async function(){ teardown(); N.user = null; emit(); await N.sb.auth.signOut(); };

  async function loadProfile(){
    const { data, error } = await N.sb.from('profiles').select('id,login,name,code').eq('id', N.user.id).maybeSingle();
    if (error) { N.error = jp(error); return; }
    N.profile = data;
  }

  N.setName = async function(name){
    if (N.hasLink(name) && !N.isGod()) throw new Error('名前に' + N.LINK_MSG);
    const { error } = await N.sb.rpc('set_name', { p_name: name });
    if (error) throw new Error(jp(error));
    await loadProfile(); emit();
  };

  /* ---------- フレンド ---------- */
  async function refreshFriends(){
    if (!N.user) return;
    const me = N.user.id;
    // 神様は全員とフレンドなので多い。1000行ずつ読み、名前は100人ずつ聞く
    let fs = [];
    for (let at = 0; ; at += 1000) {
      const { data, error } = await N.sb.from('friendships').select('a,b,requester,status').order('a').order('b').range(at, at + 999);
      if (error) { N.error = jp(error); emit(); return; }
      fs = fs.concat(data || []);
      if (!data || data.length < 1000) break;
    }
    const ids = fs.map(f => f.a === me ? f.b : f.a);
    let ps = [];
    for (let i = 0; i < ids.length; i += 100) {
      const r = await N.sb.from('profiles').select('id,name,code').in('id', ids.slice(i, i + 100));
      if (!r.error) ps = ps.concat(r.data);
    }
    const P = {}; ps.forEach(p => P[p.id] = p);
    N.friends = []; N.incoming = []; N.outgoing = [];
    for (const f of fs) {
      const other = f.a === me ? f.b : f.a, p = P[other] || { id: other, name: '？', code: '' };
      if (f.status === 'accepted') N.friends.push(p);
      else if (f.requester === me) N.outgoing.push(p);
      else N.incoming.push(p);
    }
    N.friends.sort((x, y) => x.name.localeCompare(y.name, 'ja'));
    emit();
  }
  N.refreshFriends = refreshFriends;

  N.find = async function(code){
    const { data, error } = await N.sb.rpc('find_by_code', { p_code: code });
    if (error) throw new Error(jp(error));
    return data && data[0] || null;
  };
  N.request = async function(code){
    const { data, error } = await N.sb.rpc('send_friend_request', { p_code: code });
    if (error) throw new Error(jp(error));
    await refreshFriends(); return data;
  };
  N.respond = async function(id, ok){
    const { error } = await N.sb.rpc('respond_friend_request', { p_other: id, p_accept: ok });
    if (error) throw new Error(jp(error));
    await refreshFriends();
  };
  N.remove = async function(id){
    const { error } = await N.sb.rpc('remove_friend', { p_other: id });
    if (error) throw new Error(jp(error));
    await refreshFriends();
  };
  N.statusOf = id => N.presence[id] || 'offline';
  N.nameOf = id => { const f = N.friends.find(x => x.id === id); return f ? f.name : '相手'; };

  /* ---------- オンライン状態（Presence） ---------- */
  function joinLobby(){
    const uid = N.user.id;
    lobby = N.sb.channel('lobby', { config: { private: true, presence: { key: uid } } });
    lobby.on('presence', { event: 'sync' }, () => {
      const st = lobby.presenceState(), m = {};
      for (const k in st) m[k] = st[k].some(x => x.s === 'playing') ? 'playing' : 'online';
      N.presence = m; emit();
    });
    lobby.subscribe(async s => { if (s === 'SUBSCRIBED') { try { await lobby.track({ s: N.status }); } catch (e) {} } });
  }
  N.setStatus = function(s){
    if (N.status === s) return; N.status = s;
    if (lobby) lobby.track({ s }).catch(() => {});
  };

  /* ---------- 招待 ---------- */
  function joinMine(){
    const uid = N.user.id;
    mine = N.sb.channel('user:' + uid, { config: { private: true } });
    mine
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invites', filter: 'to_id=eq.' + uid }, p => onInviteToMe(p.new))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'invites', filter: 'from_id=eq.' + uid }, p => onMyInvite(p.new))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships', filter: 'a=eq.' + uid }, () => refreshFriends())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships', filter: 'b=eq.' + uid }, () => refreshFriends())
      .subscribe(st => { if (st === 'SUBSCRIBED') { refreshFriends(); loadPendingInvite(); } });
  }
  function untilOf(inv){
    const dur = Date.parse(inv.expires_at) - Date.parse(inv.created_at);
    return performance.now() + Math.max(0, Math.min(dur, Date.parse(inv.expires_at) - Date.now() + 2000));
  }
  async function loadPendingInvite(){
    const { data } = await N.sb.from('invites').select('*').eq('to_id', N.user.id).eq('status', 'pending')
      .gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1);
    if (data && data[0]) onInviteToMe(data[0]);
  }
  function onInviteToMe(inv){
    if (!inv || !inv.id) return;
    if (inv.status === 'pending') {
      if (!N.friends.some(f => f.id === inv.from_id)) refreshFriends();
      N.invite = { id: inv.id, from_id: inv.from_id, until: untilOf(inv), game: inv.game || 'issen' };
    } else if (N.invite && N.invite.id === inv.id) N.invite = null;
    emit();
  }
  function onMyInvite(inv){
    if (!N.waiting || inv.id !== N.waiting.id) return;
    if (inv.status === 'accepted' && inv.match_id) {
      N.waiting = null; emit();
      if (N.onMatch) N.onMatch(inv.match_id, 0, inv.game || N.waitingGame || 'issen');
    } else if (inv.status !== 'pending') {
      const why = { declined: 'ことわられました', expired: '返事がありませんでした', cancelled: '取り消されました' }[inv.status] || '';
      N.waiting = null; emit();
      if (N.toast) N.toast(N.nameOf(inv.to_id) + 'さんへの招待は' + why);
    }
  }
  /* game: 'issen'（今までの一閃）/ 'action'（新・一閃。action-online.sql が要る） */
  N.sendInvite = async function(to, game){
    const act = game === 'action';
    const { data, error } = await N.sb.rpc('send_invite', act ? { p_to: to, p_game: 'action' } : { p_to: to });
    if (error) {
      if (act && /function|p_game|schema cache/i.test(String(error.message || ''))) throw new Error('新・一閃のオンライン対戦は、サーバーの準備がまだです');
      throw new Error(jp(error));
    }
    N.waitingGame = act ? 'action' : 'issen';
    const r = await N.sb.from('invites').select('*').eq('id', data).maybeSingle();
    N.waiting = { id: data, to_id: to, game: N.waitingGame, until: r.data ? untilOf(r.data) : performance.now() + 60000 };
    emit();
  };
  N.cancelInvite = async function(){
    const w = N.waiting; N.waiting = null; emit();
    if (w) await N.sb.rpc('cancel_invite', { p_id: w.id });
  };
  N.answerInvite = async function(ok){
    const inv = N.invite; N.invite = null; emit();
    if (!inv) return;
    const { data, error } = await N.sb.rpc('respond_invite', { p_id: inv.id, p_accept: ok });
    if (error) throw new Error(jp(error));
    if (ok && data && N.onMatch) N.onMatch(data, 1, inv.game || 'issen');
  };
  // 期限切れを画面から消す
  setInterval(() => {
    const t = performance.now(); let ch = false;
    if (N.invite && t > N.invite.until) { N.invite = null; ch = true; }
    if (N.waiting && t > N.waiting.until) { N.waiting = null; ch = true; if (N.toast) N.toast('返事がありませんでした'); }
    if (ch) emit();
  }, 1000);

  window.IssenNet = N;
})();
