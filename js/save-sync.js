/* =====================================================================
   一閃 銭と刀をアカウントに保存する
   ログイン中は、銭・刀・刀ごとの戦績・CPU戦の最高記録・持たせる刀をサーバーに置く。
   ガチャのくじと銭の計算はサーバー（supabase/save-data.sql）が行う。
   ログインしていなければ、これまでどおり端末（localStorage）に保存する。

   引っ越し: ログイン前にこの端末で遊んだ記録は、最初のログインのときに一度だけアカウントへ足す。
   端末の記録は消さずに残す（ログアウトするとその記録で遊べる）。
   ===================================================================== */
(function(){
  const N = window.IssenNet, I = window.__issen;
  if (!N || !I || !N.configured()) return;
  const MOVED = 'issen-moved-v1';                    // この端末の記録を引っ越した印 { uid, at }
  const QKEY = u => 'issen-pending-v1:' + u;          // まだサーバーに届いていない操作（電波が悪いとき用）
  let uid = null, loaded = false, last = null, flushing = false, starting = null;

  const store = {
    get(k, d){ try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  const isNet = e => !e || !e.code || /fetch|network|load failed|timeout/i.test(String(e.message || ''));
  const missing = e => e && (e.code === 'PGRST202' || e.code === '42883');   // SQL がまだ実行されていない
  async function rpc(fn, args){
    const { data, error } = await N.sb.rpc(fn, args || {});
    if (error) throw error;
    return data;
  }

  /* ---------- まだ届いていない操作の列（勝ち・最高記録・持たせる刀） ---------- */
  const queue = () => uid ? store.get(QKEY(uid), []) : [];
  const setQueue = a => { if (uid) store.set(QKEY(uid), a); };
  const pending = () => queue().reduce((s, x) => s + (x.t === 'win' ? x.c || 0 : 0), 0);
  function apply(d){ if (!d || !loaded) return; last = d; I.applySave(d, pending()); }
  function push(op){ const a = queue(); a.push(op); setQueue(a); flush(); }

  async function flush(){
    if (flushing || !uid || !loaded) return;
    flushing = true; const u = uid;
    try {
      for (;;) {
        const a = queue(); if (!a.length || uid !== u) break;
        const op = a[0];
        try {
          let d;
          if (op.t === 'win') d = await rpc('record_win', { p_finish: op.f, p_katana: op.k });
          else if (op.t === 'best') d = await rpc('record_cpu_best', { p_n: op.n });
          else if (op.t === 'equip') d = await rpc('set_equip', { p_a: op.a, p_b: op.b });
          if (uid !== u) break;
          setQueue(queue().slice(1)); apply(d);
        } catch (e) {
          if (uid !== u) break;
          if (isNet(e) || /多すぎ/.test(e.message || '')) break;   // あとでもう一度
          console.warn('記録を断られました', op, e);                // サーバーが断ったものは捨てて、サーバーの値に戻す
          setQueue(queue().slice(1)); if (last) apply(last);
        }
      }
    } finally { flushing = false; }
  }
  setInterval(flush, 20000);
  window.addEventListener('online', () => flush());

  /* ---------- ゲームから呼ばれる出入り口 ---------- */
  const api = {
    win(f, k, c){ push({ t: 'win', f, k, c: c || 0 }); },
    best(n){ push({ t: 'best', n }); },
    equip(eq){ push({ t: 'equip', a: eq[0], b: eq[1] }); },
    async pull(n, pick){   // pick: ピックアップする刀（運営アカウントだけ）
      await flush();
      if (queue().length) throw new Error('通信できませんでした。電波のよい所でもう一度引いてください');
      let d;
      try { d = await rpc('pull_gacha', pick ? { p_n: n, p_pick: pick } : { p_n: n }); }
      catch (e) { if (last) apply(last); throw new Error(N.jp(e)); }   // 断られたらサーバーの銭に戻す
      apply(d);
      return d;
    },
    async forge(id){   // 玉鋼で刀を鍛える（玉鋼の計算はサーバー）
      await flush();
      if (queue().length) throw new Error('通信できませんでした。電波のよい所でもう一度どうぞ');
      let d;
      try { d = await rpc('forge_katana', { p_id: id }); }
      catch (e) { if (last) apply(last); throw new Error(missing(e) ? 'サーバーの準備がまだです（SQLの実行待ち）' : N.jp(e)); }
      apply(d);
      return d;
    }
  };

  /* ---------- ログイン・ログアウト ---------- */
  function worth(g){
    return g.coins > 0 || g.steel > 0 || g.best > 0 || Object.keys(g.rec || {}).length > 0 ||
      Object.keys(g.owned || {}).some(k => k !== 'mumei' && g.owned[k] > 0);
  }
  async function start(u){
    if (starting === u) return; starting = u;
    try {
      let d = await rpc('get_save');
      if (uid !== u) return;
      const g = I.guestData();
      if (worth(g) && !store.get(MOVED, null)) {
        try {
          d = await rpc('import_local', { p: g });
          store.set(MOVED, { uid: u, at: new Date().toISOString() });
          if (N.toast) N.toast('この端末の銭と刀を、アカウントに引っ越しました', 5000);
        } catch (e) {
          if (isNet(e)) throw e;
          store.set(MOVED, { uid: u, at: new Date().toISOString(), skipped: e.message });
          if (N.toast) N.toast(N.jp(e), 5000);
        }
      }
      if (uid !== u) return;
      loaded = true; I.useAccount(api); apply(d); flush();
      N.listeners.forEach(f => { try { f(); } catch (e) {} });   // 画面の表示を更新
    } catch (e) {
      // SQL がまだ実行されていないときや通信できないときは、端末の記録のまま遊べる
      if (!missing(e)) console.warn('アカウントの記録を読めませんでした', e);
    } finally { if (starting === u) starting = null; }
  }
  function stop(){ uid = null; loaded = false; last = null; I.useGuest(); }

  // 読めなかったときは、ログイン中に何度かやり直す
  setInterval(() => { if (uid && !loaded) start(uid); }, 30000);

  N.on(() => {
    const u = N.user ? N.user.id : null;
    if (u === uid) return;
    if (uid) stop();
    if (u) { uid = u; start(u); }
  });

  window.IssenSave = { status: () => ({ uid, loaded, pending: queue().length, last }), flush };
})();
