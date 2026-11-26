/* =====================================================================
   新・一閃 ネット対戦: つなぐ（action.html?match=<対戦id>&me=<0|1>）
   一閃のフレンド招待（index.html）で「新・一閃で」と受けると、二人ともこのページに来る。
   通り道は二つ:
     1) Supabase の非公開チャンネル match:<id>（いつも使える。送る回数を絞る）
     2) WebRTC の直結（つながれば、こちらへ切り替える。遅れが小さく、サーバーの通信量も使わない）
   送り物:
     hello {name, kit, kat, mei, tier, seen} / ping・pong（時計合わせ）/ ready・start（始める時刻）
     i {n: 通し番号, h: ここまでのコマを送った, c: [[コマ, 入力], …] 変わった所だけ, fr: 今のコマ}
     x {f, h}（盤面の要約。ずれの検出）/ sig（WebRTC のつなぎ方）/ bye（退出）
   勝ち負けは二人の端末が同じ計算で出し、最後にサーバーで照らし合わせる（report_result）。戦闘力にも数える。
   ===================================================================== */
(function(){
  const q = new URLSearchParams(location.search);
  const MATCH = q.get('match'); if (!MATCH) return;
  const ME = q.get('me') === '1' ? 1 : 0, OP = 1 - ME;
  const N = window.IssenNet, AP = window.__action, NPL = window.IssenNetPlay;
  const $ = id => document.getElementById(id);
  const PINGS = 10, DROP_MS = 10000;
  const st = { ch: null, pc: null, dc: null, dcOpen: false, timers: [], lastRecv: performance.now(), hello: null, seenMe: false, pinging: false,
               pings: [], off: 0, started: false, startMsg: null, ended: false, reported: false,
               seq: 0, sentH: -1, changes: [], lastCode: 0, lastFlush: 0,
               rseq: 0, rbuf: new Map(), rcode: 0, oppFr: 0, sentX: -1, oppX: {}, desync: false };

  function cover(title, text, back){
    const el = $('netov'); el.hidden = !title; if (!title) return;
    $('nv_h').textContent = title; $('nv_p').textContent = text || '';
    $('nv_back').hidden = !back;
  }
  function home(){ location.href = 'index.html'; }
  $('nv_back').onclick = home;

  cover('対戦の準備中', 'ログインを確かめています…');
  N.setStatus('playing');
  N.init().then(start, e => cover('つなげませんでした', String(e && e.message || e), true));

  async function start(){
    if (!N.user) return cover('ログインしていません', '一閃のタイトルの「オンライン」からログインしてください', true);
    cover('対戦の準備中', '相手を待っています…', true);
    const row = await N.sb.from('matches').select('id,p0,p1,seed,status').eq('id', MATCH).maybeSingle();
    if (row.error || !row.data) return cover('対戦の部屋が見つかりませんでした', '', true);
    if (row.data.status !== 'playing') return cover('この対戦はもう終わっています', '', true);
    st.oppId = ME === 0 ? row.data.p1 : row.data.p0;
    const k = AP.myKat();
    st.mine = { name: N.profile ? N.profile.name : 'あなた', kit: k.kit, kat: k.id, mei: k.mei, tier: k.tier };
    st.ch = N.sb.channel('match:' + MATCH, { config: { private: true, broadcast: { self: false, ack: false } } });
    st.ch.on('broadcast', { event: 'm' }, ({ payload }) => recv(payload));
    st.ch.subscribe(s => {
      if (s === 'SUBSCRIBED') {
        const hello = () => { if (!st.started) rt(Object.assign({ k: 'hello', seen: !!st.hello }, st.mine)); };
        hello(); st.timers.push(setInterval(hello, 600));
      } else if ((s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') && !st.started) fail('対戦の部屋に入れませんでした');
    });
    st.timers.push(setTimeout(() => { if (!st.started) fail('相手が来ませんでした'); }, 30000));
    st.timers.push(setInterval(() => N.sb.rpc('match_heartbeat', { p_id: MATCH }), 20000));
    N.sb.rpc('match_heartbeat', { p_id: MATCH });
    st.timers.push(setInterval(pump, 16));
  }

  /* ---------- 送る ---------- */
  function rt(msg){ if (st.ch) st.ch.send({ type: 'broadcast', event: 'm', payload: Object.assign({ p: ME }, msg) }).catch(() => {}); }
  function send(msg){
    if (st.dcOpen) { try { st.dc.send(JSON.stringify(Object.assign({ p: ME }, msg))); return; } catch (e) { st.dcOpen = false; } }
    rt(msg);
  }
  // 自分の入力（app.js から1コマごと）。変わった所だけ覚えておき、まとめて送る
  function onLocal(f, code){
    if (code !== st.lastCode) { st.changes.push([f, code]); st.lastCode = code; }
    st.H = f;
  }
  function flush(){
    if (st.H == null || st.H === st.sentH) return;
    send({ k: 'i', n: ++st.seq, h: st.H, c: st.changes, fr: ON().np.frame });
    st.changes = []; st.sentH = st.H; st.lastFlush = performance.now();
  }
  const ON = () => AP.ON;

  /* ---------- 受け取る ---------- */
  function recv(m){
    if (!m || m.p !== OP || st.ended) return;
    st.lastRecv = performance.now();
    switch (m.k) {
      case 'hello':
        st.hello = m; if (m.seen) st.seenMe = true;
        if (!m.seen) rt(Object.assign({ k: 'hello', seen: true }, st.mine));
        if (ME === 1 && st.seenMe && !st.pinging) beginSync();
        if (ME === 0 && !st.pc) rtcOffer();
        break;
      case 'ping': if (ME === 0) rt({ k: 'pong', i: m.i, t1: m.t1, t2: performance.now() }); break;
      case 'pong': { const t3 = performance.now(), rtt = t3 - m.t1; st.pings.push({ rtt, off: m.t2 + rtt / 2 - t3 }); break; }
      case 'ready':
        if (ME === 0) { st.rtt = +m.rtt || 100; if (!st.startMsg) st.startMsg = { k: 'start', startAt: performance.now() + 2200 }; rt(st.startMsg); begin(st.startMsg.startAt); }
        break;
      case 'start': if (ME === 1) begin(m.startAt); break;
      case 'i': st.rbuf.set(m.n, m); while (st.rbuf.has(st.rseq + 1)) { const x = st.rbuf.get(++st.rseq); st.rbuf.delete(st.rseq); applyIn(x); } break;
      case 'x': st.oppX[m.f] = m.h; checkX(); break;
      case 'sig': rtcSignal(m.d); break;
      case 'rep': if (st.check) st.check(); break;
      case 'bye': if (!st.ended) gone('相手が退出しました。この試合は記録しません'); break;
    }
  }
  function applyIn(m){
    const np = ON() && ON().np; if (!np) return;
    const ch = new Map(m.c || []);
    for (let f = np.rh + 1; f <= m.h; f++) { if (ch.has(f)) st.rcode = ch.get(f); np.remote(f, st.rcode); }
    st.oppFr = m.fr | 0; st.oppFrAt = performance.now();
  }

  /* 時計合わせ: 藍が朱の時計に合わせる（往復がいちばん短かった回を信じる） */
  function beginSync(){
    st.pinging = true; let i = 0;
    const one = () => { if (st.started) return; rt({ k: 'ping', i, t1: performance.now() }); if (++i < PINGS) setTimeout(one, 120); };
    one();
    st.timers.push(setTimeout(sendReady, 120 * PINGS + 600));
  }
  function sendReady(){
    if (st.started) return;
    if (!st.pings.length) { st.pinging = false; beginSync(); return; }
    st.pings.sort((a, b) => a.rtt - b.rtt); st.off = st.pings[0].off; st.rtt = st.pings[0].rtt;
    rt({ k: 'ready', rtt: st.rtt });
    st.timers.push(setTimeout(() => { if (!st.started) rt({ k: 'ready' }); }, 3000));
  }

  function begin(startAt){
    if (st.started) return; st.started = true;
    const h = st.hello || {}, kits = [], names = [];
    kits[ME] = st.mine.kit; kits[OP] = h.kit === 'ouka' ? 'ouka' : 'common';
    names[ME] = st.mine.name; names[OP] = String(h.name || N.nameOf(st.oppId)).slice(0, 10);
    const off = ME === 1 ? st.off : 0;
    cover(null);
    AP.onlineStart({ me: ME, kits, names, kat: st.mine.kat, startAt, now: () => performance.now() + off, delay: 2,
      onLocal, onOver: report, onExit: why => leave(why) });
  }

  /* 毎コマ: まとめて送る・相手の様子を見る */
  function pump(){
    if (!st.started || st.ended) return;
    const on = ON(); if (!on) return;
    const t = performance.now(), gap = st.dcOpen ? 0 : 66; // サーバー経由は1秒に15回まで
    if (t - st.lastFlush >= gap) flush();
    // 盤面の要約を1秒ごとに送り合う
    const c = on.np.confirmed(), f = c - (c % 60);
    if (f > st.sentX && on.hashes[f] != null) { st.sentX = f; send({ k: 'x', f, h: on.hashes[f] }); checkX(); }
    // 先に進みすぎていたら、少しだけ時計を遅らせて相手に合わせる
    if (st.oppFrAt && t - st.oppFrAt < 200) {
      const F = 1000 / 60, lat = (st.dcOpen ? Math.min(st.rtt || 100, 60) : st.rtt || 100) / 2;
      const theirs = st.oppFr + (t - st.oppFrAt + lat) / F, lead = on.np.frame - theirs;
      if (lead > 2.5) on.startAt += 1000 / 60 / 4;
    }
    const silent = t - st.lastRecv;
    if (!st.reported && silent > DROP_MS) return gone('相手との通信が切れました。この試合は記録しません');
    on.extMsg = st.desync ? '同期がずれました（この試合は記録されないかもしれません）' : silent > 2500 && !on.done ? '通信待ち…' : '';
  }
  function checkX(){
    const on = ON(); if (!on || st.desync) return;
    for (const f in st.oppX) {
      if (on.hashes[f] == null) { if (f < on.np.confirmed() - 1200) delete st.oppX[f]; continue; }
      if (+f > on.np.confirmed()) continue;
      if (on.hashes[f] !== st.oppX[f]) { st.desync = true; console.warn('同期ずれ', f, on.hashes[f], st.oppX[f]); }
      delete st.oppX[f];
    }
  }

  /* ---------- 結果 ---------- */
  async function report(log, wins){
    if (st.reported) return; st.reported = true;
    const rep = { h: log.map(x => x.name + ':' + (x.winner < 0 ? '-' : x.winner)), s: wins };
    const sub = $('ov_s');
    const note = s => { const e = document.createElement('div'); e.className = 'onote'; e.textContent = s; sub.after(e); return e; };
    const { data, error } = await N.sb.rpc('report_result', { p_id: MATCH, p_report: rep });
    send({ k: 'rep' });
    if (error) return note('結果を記録できませんでした');
    if (data === 'waiting') { // 相手の報告を待つ（相手が報告したら「rep」が届く）
      const w = note('相手の報告を待っています');
      st.check = async () => { const r = await N.sb.from('matches').select('status').eq('id', MATCH).maybeSingle();
        if (r.data && r.data.status !== 'playing' && st.check) { st.check = null; w.remove(); finishNote(r.data.status, note); } };
      for (let k = 0; k < 30 && st.check; k++) { await new Promise(r => setTimeout(r, 1500)); if (st.check) await st.check(); }
      return;
    }
    finishNote(data, note);
  }
  async function finishNote(status, note){
    if (status === 'void') return note('二人の結果が食い違ったため、この試合は無効になりました');
    if (status !== 'done') return;
    for (let i = 0; i < 4; i++) {
      const { data, error } = await N.sb.rpc('match_rating', { p_id: MATCH });
      if (error) break;
      if (data) { const d = data.delta | 0; note('戦闘力 ' + data.after + '（' + (d >= 0 ? '+' : '') + d + '）' + (data.counted === false ? '　同じ相手との対戦は今日はもう数えません' : '')); return; }
      await new Promise(r => setTimeout(r, 800));
    }
    note('この試合を記録しました');
  }

  /* ---------- 終わり方 ---------- */
  function stopAll(){
    st.ended = true;
    st.timers.forEach(t => { clearInterval(t); clearTimeout(t); });
    try { if (st.dc) st.dc.close(); if (st.pc) st.pc.close(); } catch (e) {}
  }
  function leave(why){
    if (!st.ended && !st.reported && st.started) { send({ k: 'bye' }); N.sb.rpc('leave_match', { p_id: MATCH }); }
    stopAll();
    if (st.ch) { const c = st.ch; st.ch = null; setTimeout(() => { N.sb.removeChannel(c); home(); }, 150); } else home();
  }
  function gone(msg){
    if (st.ended) return;
    N.sb.rpc('leave_match', { p_id: MATCH });
    stopAll(); AP.onlineEnd();
    cover('対戦の終わり', msg, true);
  }
  function fail(msg){ if (st.ended) return; N.sb.rpc('leave_match', { p_id: MATCH }); stopAll(); cover('つなげませんでした', msg, true); }
  addEventListener('pagehide', () => { if (st.started && !st.ended && !st.reported) send({ k: 'bye' }); });

  /* ---------- WebRTC の直結（つながらなければサーバー経由のまま） ---------- */
  const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
  function mkPc(){
    if (!window.RTCPeerConnection || st.pc) return st.pc;
    const pc = st.pc = new RTCPeerConnection({ iceServers: ICE });
    pc.onicecandidate = e => { if (e.candidate) rt({ k: 'sig', d: { ice: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate } }); };
    pc.ondatachannel = e => useDc(e.channel);
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') st.dcOpen = false; };
    return pc;
  }
  function useDc(dc){
    st.dc = dc;
    dc.onopen = () => { st.dcOpen = true; };
    dc.onclose = () => { st.dcOpen = false; };
    dc.onmessage = e => { try { recv(JSON.parse(e.data)); } catch (x) {} };
  }
  async function rtcOffer(){
    try {
      const pc = mkPc(); if (!pc) return;
      useDc(pc.createDataChannel('in', { ordered: true }));
      await pc.setLocalDescription(await pc.createOffer());
      rt({ k: 'sig', d: { sdp: pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription } });
    } catch (e) { console.warn('直結できません', e); }
  }
  async function rtcSignal(d){
    try {
      const pc = mkPc(); if (!pc || !d) return;
      if (d.sdp) {
        await pc.setRemoteDescription(d.sdp);
        if (d.sdp.type === 'offer') { await pc.setLocalDescription(await pc.createAnswer()); rt({ k: 'sig', d: { sdp: pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription } }); }
        (st.iceQ || []).forEach(c => pc.addIceCandidate(c).catch(() => {})); st.iceQ = null;
      } else if (d.ice) {
        if (!pc.remoteDescription) (st.iceQ = st.iceQ || []).push(d.ice); else await pc.addIceCandidate(d.ice);
      }
    } catch (e) { console.warn('直結できません', e); }
  }
  window.__actionNet = { st, get via(){ return st.dcOpen ? 'direct' : 'server'; } };
})();
