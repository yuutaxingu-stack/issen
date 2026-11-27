/* =====================================================================
   一閃 新しい版の知らせ
   運営が一閃を更新（GitHub Pages に新しい版を置く）したら、遊んでいる人の画面に知らせを出す。
   主なファイルの ETag（版ごとに変わる印）を数分おきに確かめ、変わっていたら「更新する」の帯を出す。
   対戦中は出さず、タイトルに戻ったときに出す。タブを離れて戻ってきたときにタイトルなら、そのまま読み直す。
   手元でファイルを開いたとき（file://）は何もしない。
   ===================================================================== */
(function(){
  if (!/^https?:$/.test(location.protocol)) return;
  const FILES = ['index.html', 'js/game.js', 'js/profile.js', 'css/style.css', 'js/online-ui.js'];
  const EVERY = 3 * 60 * 1000;
  let base = null, fresh = false, busy = false;

  async function sig(){
    const r = await Promise.all(FILES.map(f => fetch(f, { method: 'HEAD', cache: 'no-store' })
      .then(x => x.ok ? (x.headers.get('etag') || x.headers.get('last-modified') || x.headers.get('content-length') || '') : null)
      .catch(() => null)));
    return r.some(v => v === null) ? null : r.join('|');
  }
  const atTitle = () => { const m = document.getElementById('menu'); return !!m && !m.hidden; };

  const bar = document.createElement('div');
  bar.id = 'upd'; bar.hidden = true;
  bar.innerHTML = '<span>一閃が新しくなりました</span><button type="button" id="upd_go">更新する</button><button type="button" id="upd_later" aria-label="あとで">あとで</button>';
  document.body.appendChild(bar);
  const st = document.createElement('style');
  st.textContent = '#upd{position:fixed;left:50%;top:max(10px,env(safe-area-inset-top,0px));transform:translateX(-50%);z-index:29;display:flex;align-items:center;gap:12px;' +
    'padding:8px 10px 8px 16px;background:rgba(18,19,15,.95);border:1px solid rgba(168,50,42,.8);border-radius:6px;color:#e9e2cf;box-shadow:0 8px 30px rgba(0,0,0,.5);' +
    'font-family:var(--display,serif);font-size:16px;letter-spacing:.1em;white-space:nowrap;}' +
    '#upd[hidden]{display:none;}#upd button{font-family:var(--ui,sans-serif);font-size:13px;padding:6px 12px;border-radius:4px;border:1px solid rgba(233,226,207,.3);background:none;color:#e9e2cf;cursor:pointer;}' +
    '#upd #upd_go{background:#a8322a;border-color:#a8322a;color:#f2ede1;}';
  document.head.appendChild(st);
  let later = 0;
  document.getElementById('upd_go').addEventListener('click', () => location.reload());
  document.getElementById('upd_later').addEventListener('click', () => { bar.hidden = true; later = Date.now(); });

  function show(){ if (fresh && atTitle() && Date.now() - later > 10 * 60 * 1000) bar.hidden = false; }
  async function check(){
    if (busy || fresh) { show(); return; }
    busy = true;
    try {
      const s = await sig();
      if (s == null) return;
      if (base == null) { base = s; return; }
      if (s !== base) { fresh = true; show(); }
    } finally { busy = false; }
  }
  // タイトルに戻ったら知らせを出す（対戦中は出さない）
  const menu = document.getElementById('menu');
  if (menu) new MutationObserver(() => { if (!atTitle()) bar.hidden = true; else show(); }).observe(menu, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    await check();
    // しばらく離れていて、戻ってきたらタイトルにいる → そのまま新しい版に
    if (fresh && atTitle()) location.reload();
  });
  setTimeout(check, 1500);
  setInterval(check, EVERY);
  window.IssenUpdate = { check, state: () => ({ base, fresh }) };
})();
