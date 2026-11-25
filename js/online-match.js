/* =====================================================================
   一閃 オンライン: 対戦の通信
   二人専用の非公開チャンネル（match:<対戦id>）で、次のものだけを送り合う。
     hello  … 名前と刀（はじめに数回）
     ping/pong … 時計合わせ（藍側が朱側の時計に合わせる。はじめに10往復）
     ready/start … 開始時刻の取り決め
     in     … 押した瞬間 {t: 時刻, a: 'iai'|'mk', s: 何度目の決着の後か}
     h      … 「この時刻までの操作は全部送った」という知らせ（0.5秒ごと）
     rep    … 結果を報告した合図
     bye    … 退出
   勝ち負けの判定は二人の端末が同じ計算で行い、最後にサーバーで結果を照らし合わせる。
   ===================================================================== */
(function(){
  const N = window.IssenNet;
  const I = window.__issen;
  const M = { active: null };
  const HB_MS = 500, WAIT_MS = 1200, DROP_MS = 10000, PINGS = 10;

  function toast(s, ms){ if (N.toast) N.toast(s, ms); }

  M.start = async function(matchId, me){
    if (M.active) return;
    const st = { id: matchId, me, ch: null, timers: [], lastRecv: performance.now(), oppHello: null, seenMe: false,
                 pings: [], off: 0, started: false, startMsg: null, reported: false, ended: false, report: null };
    M.active = st;
    N.setStatus('playing');
    if (N.onMatchUi) N.onMatchUi('connecting');
    const row = await N.sb.from('matches').select('id,p0,p1,seed,status').eq('id', matchId).maybeSingle();
    if (row.error || !row.data || row.data.status !== 'playing') return fail('対戦の部屋が見つかりませんでした');
    st.seed = row.data.seed;
    st.oppId = me === 0 ? row.data.p1 : row.data.p0;
    const kat = (function(){ try { return JSON.parse(localStorage.getItem('issen-armory-v1')).equip[0] || 'mumei'; } catch (e) { return 'mumei'; } })();
    const myName = N.profile ? N.profile.name : 'あなた';
    st.myName = myName; st.kat = kat;
    st.ch = N.sb.channel('match:' + matchId, { config: { private: true, broadcast: { self: false, ack: false } } });
    st.ch.on('broadcast', { event: 'm' }, ({ payload }) => recv(st, payload));
    st.ch.subscribe(s => {
      if (s === 'SUBSCRIBED') {
        const hello = () => { if (!st.started && !(st.oppHello && st.seenMe)) send(st, { k: 'hello', name: myName, kat, seen: !!st.oppHello }); };
        hello(); st.timers.push(setInterval(hello, 600));
      } else if ((s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') && !st.started) fail('対戦の部屋に入れませんでした');
    });
    st.timers.push(setTimeout(() => { if (!st.started) fail('相手が来ませんでした'); }, 25000));
    st.timers.push(setInterval(() => { N.sb.rpc('match_heartbeat', { p_id: matchId }); }, 20000));
    st.timers.push(setInterval(() => tick(st), HB_MS));
  };

  function send(st, msg){ if (st.ch) st.ch.send({ type: 'broadcast', event: 'm', payload: msg }).catch(() => {}); }

  function recv(st, m){
    if (M.active !== st || !m) return;
    st.lastRecv = performance.now();
    switch (m.k) {
      case 'hello':
        st.oppHello = m; if (m.seen) st.seenMe = true;
        if (!m.seen) send(st, { k: 'hello', name: st.myName, kat: st.kat, seen: true });
        if (st.me === 1 && st.seenMe && !st.pinging) beginSync(st);
        break;
      case 'ping': if (st.me === 0) send(st, { k: 'pong', i: m.i, t1: m.t1, t2: performance.now() }); break;
      case 'pong': onPong(st, m); break;
      case 'ready':
        if (st.me === 0) {
          if (!st.startMsg) st.startMsg = { k: 'start', startAt: performance.now() + 1500 };
          send(st, st.startMsg);
          begin(st, st.startMsg.startAt, 0);
        }
        break;
      case 'start': if (st.me === 1) begin(st, m.startAt, st.off); break;
      case 'in': if (st.started) { I.netHorizon(m.t); I.netInput(m.t, m.a, m.s); } break;
      case 'h': if (st.started) I.netHorizon(m.h); break;
      case 'rep': if (st.report) report(st); break;
      case 'bye': if (!st.ended) end(st, '相手が退出しました。この試合は記録しません'); break;
    }
  }

  /* 時計合わせ: 往復にかかった時間がいちばん短かった回を信じる */
  function beginSync(st){
    st.pinging = true; let i = 0;
    const one = () => { if (M.active !== st || st.started) return; send(st, { k: 'ping', i, t1: performance.now() }); if (++i < PINGS) setTimeout(one, 120); };
    one();
    st.timers.push(setTimeout(() => sendReady(st), 120 * PINGS + 600));
  }
  function onPong(st, m){
    const t3 = performance.now(), rtt = t3 - m.t1;
    st.pings.push({ rtt, off: m.t2 + rtt / 2 - t3 });
  }
  function sendReady(st){
    if (M.active !== st || st.started) return;
    if (!st.pings.length) { beginSync(st); return; }
    st.pings.sort((a, b) => a.rtt - b.rtt); st.off = st.pings[0].off; st.rtt = st.pings[0].rtt;
    send(st, { k: 'ready' });
    // 開始の合図が届かなければもう一度
    st.timers.push(setTimeout(() => { if (!st.started && M.active === st) send(st, { k: 'ready' }); }, 3000));
  }

  function begin(st, startAt, off){
    if (st.started) return; st.started = true;
    const o = st.oppHello || {};
    const oppName = o.name || N.nameOf(st.oppId);
    if (N.onMatchUi) N.onMatchUi('playing');
    I.NET.onPhase = ph => { if (ph === 'match') report(st); };
    I.NET.onLeave = ph => leave(st, ph);
    I.startOnline({ me: st.me, seed: st.seed, startAt, clockOff: off, oppKat: o.kat || 'mumei', oppName, myName: st.myName,
                    send: msg => send(st, msg) });
  }

  function tick(st){
    if (M.active !== st || !st.started || st.ended) return;
    const G = I.G, NET = I.NET;
    send(st, { k: 'h', h: performance.now() + (st.me === 1 ? st.off : 0) });
    const silent = performance.now() - st.lastRecv;
    if (silent > DROP_MS) return end(st, '相手との通信が切れました。この試合は記録しません');
    const behind = (performance.now() + (st.me === 1 ? st.off : 0)) - NET.oppH;
    NET.wait = (G.phase === 'fight' && behind > WAIT_MS) || silent > 3000 ? '通信待ち…' : '';
  }

  async function report(st){
    if (st.ended) return;
    const G = I.G, P = I.P;
    st.report = { h: G.history.map(x => x.name + ':' + (x.winner == null ? '-' : x.winner)), s: P.map(p => p.score) };
    const { data, error } = await N.sb.rpc('report_result', { p_id: st.id, p_report: st.report });
    if (!st.reported) { st.reported = true; send(st, { k: 'rep' }); }
    if (error) return toast('結果を記録できませんでした');
    if (data === 'done') toast('この試合を記録しました');
    else if (data === 'void') toast('二人の結果が食い違ったため、この試合は無効になりました', 6000);
  }

  function leave(st, phase){
    if (st.ended) { cleanup(st); return; }
    st.ended = true;
    if (phase !== 'match') { send(st, { k: 'bye' }); N.sb.rpc('leave_match', { p_id: st.id }); }
    cleanup(st);
  }
  function end(st, msg){
    if (st.ended) return; st.ended = true;
    N.sb.rpc('leave_match', { p_id: st.id });
    toast(msg, 4000);
    if (I.G.mode === 'online') { I.NET.wait = ''; setTimeout(() => { if (I.G.mode === 'online') I.goTitle(); }, 1800); }
    else cleanup(st);
  }
  function fail(msg){
    const st = M.active; if (!st) return;
    st.ended = true; if (st.id) N.sb.rpc('leave_match', { p_id: st.id });
    toast(msg, 4000); cleanup(st);
  }
  function cleanup(st){
    st.timers.forEach(t => { clearInterval(t); clearTimeout(t); });
    if (st.ch) { N.sb.removeChannel(st.ch); st.ch = null; }
    if (M.active === st) M.active = null;
    I.NET.onPhase = null; I.NET.onLeave = null;
    N.setStatus('online');
    if (N.onMatchUi) N.onMatchUi('idle');
  }

  // ページを閉じるときは、相手にすぐ知らせる
  window.addEventListener('pagehide', () => { const st = M.active; if (st && !st.ended && st.started) { send(st, { k: 'bye' }); } });
  N.onMatch = (id, me) => M.start(id, me);
  window.IssenMatch = M;
})();
