/* =====================================================================
   一閃 名乗り（プロフィール）・文箱・お知らせ
   名乗り: 名前・二つ名・背景の札・一言・好きな一振り。自分のものは書き換えられる。番付・寄合・団体戦・フレンドの名前を触ると開く
   文箱:   運営からの手紙。銭・玉鋼・二つ名・背景が添えられていれば「受け取る」で入る
   お知らせ: メンテナンス・大事なお知らせ・更新。大事なお知らせはタイトルで一度だけ大きく出す
   神様アカウントには「送る」「書く」の札が出て、条件を選んで一斉に手紙を送ったり、お知らせを載せたりできる
   サーバー側は supabase/profile.sql。まだ実行されていなければ、ここの物は静かに隠れる
   ===================================================================== */
(function(){
  const N = window.IssenNet, I = window.__issen;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const kn = n => (I && I.kn) ? I.kn(n) : String(n);
  const store = {
    get(k, d){ try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  const missing = e => e && (e.code === 'PGRST202' || e.code === '42883');
  const online = () => !!(N && N.configured && N.configured() && N.sb);
  async function rpc(fn, args){
    const { data, error } = await N.sb.rpc(fn, args || {});
    if (error) throw error;
    return data;
  }
  const errText = e => missing(e) ? 'サーバーの準備がまだです（SQLの実行待ち）' : (N && N.jp ? N.jp(e) : String(e && e.message || e));

  // 背景の札。絵は css/profile.css の .pl-<id>
  const PLATE_NAME = { sumi: '墨', take: '竹林', tsuki: '月夜', ouka: '桜華' };
  const KIND = { maint: 'メンテナンス', important: '大事なお知らせ', update: '更新' };
  const SEEN = 'issen-news-seen-v1', POPPED = 'issen-news-pop-v1';

  /* ---------- 画面の部品をつくる ---------- */
  const corner = document.createElement('div');
  corner.id = 'pf_corner'; corner.hidden = true;
  corner.innerHTML =
    '<button type="button" data-go="me"><span class="pfk">名</span><span class="pfl">名乗り</span></button>' +
    '<button type="button" data-go="mail"><span class="pfk">文</span><span class="pfl">文箱</span><b class="pfbadge" id="pf_mailb" hidden></b></button>' +
    '<button type="button" data-go="news"><span class="pfk">告</span><span class="pfl">お知らせ</span><b class="pfbadge" id="pf_newsb" hidden></b></button>';
  document.body.appendChild(corner);

  const scr = document.createElement('div');
  scr.id = 'pf'; scr.hidden = true;
  scr.innerHTML =
    '<div class="gwrap">' +
      '<div class="gtop"><button type="button" class="gback" id="pf_back">戻る</button><div class="otitle" id="pf_title">名乗り</div><div class="ospacer pfsp"></div></div>' +
      '<div class="gtabs pftabs" id="pf_tabs" hidden></div>' +
      '<div id="pf_body"></div>' +
    '</div>';
  document.body.appendChild(scr);

  const pop = document.createElement('div');
  pop.id = 'pf_pop'; pop.hidden = true;
  pop.innerHTML = '<div class="pfpsheet" role="dialog" aria-label="大事なお知らせ"><span class="pfpk">大事なお知らせ</span><h2 id="pf_pt"></h2><time id="pf_pd"></time><div class="pfpb" id="pf_pb"></div>' +
    '<div class="pfpact"><button type="button" class="gpull" id="pf_pok">承知</button><button type="button" class="olink" id="pf_pall">お知らせを見る</button></div></div>';
  document.body.appendChild(pop);

  // タイトルのメニューが出ている間だけ、左上の札を出す
  const menu = $('menu');
  function syncCorner(){ corner.hidden = !menu || menu.hidden; if (!corner.hidden) { badges(); maybePop(); } }
  if (menu) new MutationObserver(syncCorner).observe(menu, { attributes: true, attributeFilter: ['hidden'] });

  /* ---------- 状態 ---------- */
  const S = {
    mode: '', tab: '', busy: false, msg: '', err: '',
    prof: null, edit: null, pid: null,     // 見ている名乗り・書き換え中の値
    mail: null, notices: null, newsErr: '', mailErr: '',
    god: null, preview: null, arm: 0, open: {}
  };
  const tags = {}; const tagFns = new Set();

  /* ---------- 開く・閉じる ---------- */
  function show(mode, tab){
    S.mode = mode; S.tab = tab || ''; S.msg = ''; S.err = '';
    scr.hidden = false; scr.scrollTop = 0;
    render();
  }
  function close(){ scr.hidden = true; S.mode = ''; S.edit = null; badges(); }
  $('pf_back').addEventListener('click', () => {
    if (S.mode === 'card' && S.edit) { S.edit = null; render(); return; }
    close();
  });

  function openProfile(id){
    S.pid = id || (N && N.user ? N.user.id : null); S.prof = null; S.edit = null;
    show('card');
    loadProfile();
  }
  function openMail(){ show('mail', 'box'); loadMail(); }
  function openNews(){ show('news', 'list'); loadNews().then(() => { markSeen(); render(); }); }

  corner.addEventListener('click', e => {
    const b = e.target.closest('[data-go]'); if (!b) return;
    if (b.dataset.go === 'me') openProfile(null);
    else if (b.dataset.go === 'mail') openMail();
    else openNews();
  });
  // どこでも data-pid の付いた名前を触ると、その人の名乗りが開く
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-pid]');
    if (!t || !t.dataset.pid || t.closest('#pf')) return;
    e.preventDefault(); e.stopPropagation();
    openProfile(t.dataset.pid);
  }, true);

  /* ---------- 読み込み ---------- */
  async function loadProfile(){
    if (!online() || !N.user) { render(); return; }
    const want = S.pid;
    try {
      const d = await rpc('get_profile', { p_id: want });
      if (S.pid !== want) return;
      S.prof = d; S.err = '';
      if (d && d.id) tags[d.id] = { title: d.title_name, style: d.title_style, plate: d.plate };
    } catch (e) { S.err = errText(e); }
    render();
  }
  async function loadMail(){
    if (!online() || !N.user) { S.mail = null; render(); badges(); return; }
    try { S.mail = await rpc('my_mail'); S.mailErr = ''; }
    catch (e) { S.mailErr = missing(e) ? 'missing' : errText(e); }
    render(); badges();
  }
  async function loadNews(){
    if (!online()) return;
    try { S.notices = await rpc('list_notices'); S.newsErr = ''; }
    catch (e) { S.newsErr = missing(e) ? 'missing' : errText(e); }
    badges(); maybePop();
  }
  async function loadGod(){
    try { S.god = await rpc('god_info'); } catch (e) { S.err = errText(e); }
    render();
  }

  /* ---------- 未読の印 ---------- */
  function unseenNews(){ const s = store.get(SEEN, 0); return (S.notices || []).filter(n => n.id > s).length; }
  function markSeen(){ const top = (S.notices || []).reduce((m, n) => Math.max(m, n.id), 0); if (top) store.set(SEEN, Math.max(store.get(SEEN, 0), top)); badges(); }
  function badges(){
    const nb = $('pf_newsb'), mb = $('pf_mailb');
    if (!nb || !mb) return;
    const un = unseenNews();
    nb.hidden = !un; nb.textContent = un ? '新' : '';
    const m = S.mail && N && N.user ? (S.mail.unclaimed || 0) + 0 : 0, unread = S.mail && N && N.user ? S.mail.unread || 0 : 0;
    mb.hidden = !(m || unread); mb.textContent = m ? String(m) : unread ? '新' : '';
    // 文箱は、ログインしていないときは薄く
    corner.querySelector('[data-go="mail"]').classList.toggle('dim', !(N && N.user));
    corner.querySelector('[data-go="me"]').classList.toggle('dim', !(N && N.user));
  }
  // 大事なお知らせ: タイトルが出ているとき、まだ見せていない新しいものを一度だけ
  function maybePop(){
    if (!menu || menu.hidden || !pop.hidden || !scr.hidden || !S.notices) return;
    const last = store.get(POPPED, null);
    const imp = S.notices.find(n => n.kind === 'important');
    if (!imp) return;
    if (last == null) { store.set(POPPED, imp.id); }   // はじめて遊ぶ人には、昔のお知らせを出さない
    if (last != null && imp.id <= last) return;
    if (last == null && Date.now() - new Date(imp.at).getTime() > 3 * 86400000) return;
    $('pf_pt').textContent = imp.title; $('pf_pd').textContent = day(imp.at);
    $('pf_pb').innerHTML = para(imp.body);
    pop.hidden = false; pop.dataset.id = imp.id;
  }
  $('pf_pok').addEventListener('click', () => { store.set(POPPED, Number(pop.dataset.id)); pop.hidden = true; });
  $('pf_pall').addEventListener('click', () => { store.set(POPPED, Number(pop.dataset.id)); pop.hidden = true; openNews(); });

  /* ---------- 小物 ---------- */
  const two = n => String(n).padStart(2, '0');
  function day(ts){ const d = new Date(ts); return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + two(d.getHours()) + ':' + two(d.getMinutes()); }
  const para = t => esc(t || '').split(/\n{2,}/).map(p => '<p>' + p.replace(/\n/g, '<br>') + '</p>').join('');
  const zmark = id => window.IssenZetsu ? window.IssenZetsu.mark(id) : '';
  const kat = id => (I && I.KMAP && I.KMAP[id]) || null;
  const tcol = t => (I && I.TIER && I.TIER[t]) || '#e9e2cf';
  function needLogin(what){
    return '<div class="pfempty"><p>' + esc(what) + 'は、オンラインでログインすると使えます。</p>' +
      (online() ? '<button type="button" class="gpull" data-act="login">オンラインでログイン</button>' : '') + '</div>';
  }

  /* ---------- 名乗りの札（カード） ---------- */
  function cardHtml(p, ed){
    const v = ed ? Object.assign({}, p, ed) : p;
    const tt = ed ? ((p.my_titles || []).find(t => t.id === ed.title) || {}) : { name: p.title_name, style: p.title_style };
    const title = tt.name, tstyle = tt.style ? ' s-' + esc(tt.style) : '';
    const fav = v.fav ? kat(v.fav) : null;
    const stats = [
      ['戦闘力', String(v.rating)],
      ['勝ち抜き', v.cpu + '<small>人</small>'],
      ['刀帳', v.katana + '<small>/' + v.total + '</small>']
    ];
    if (v.issen > 0) stats.push(['一閃', kn(v.issen) + '<small>度</small>', 'iss']);
    return '<div class="pfcard pl-' + esc(v.plate || 'sumi') + '">' +
      '<div class="pfpetal" aria-hidden="true"></div>' +
      '<div class="pfmain">' +
        (title ? '<span class="pfnick' + tstyle + '">' + esc(title) + '</span>' : '<span class="pfnick none">二つ名なし</span>') +
        '<span class="pfname">' + esc(v.name) + zmark(v.id) + '</span>' +
        '<p class="pfword">' + (v.word ? '「' + esc(v.word) + '」' : '<span class="none">一言はまだない</span>') + '</p>' +
      '</div>' +
      '<div class="pffav">' + (fav ?
        '<canvas class="pfkat" width="560" height="66" data-kat="' + esc(fav.id) + '"></canvas>' +
        '<span class="pfkm"><i style="color:' + tcol(fav.tier) + '">' + esc(fav.tier) + '</i>' + esc(fav.mei) + '</span><span class="pfkc">好きな一振り</span>'
        : '<span class="pfkc">好きな一振りはまだない</span>') + '</div>' +
      '<div class="pfstats">' + stats.map(s => '<span class="' + (s[2] || '') + '"><small>' + s[0] + '</small><b>' + s[1] + '</b></span>').join('') + '</div>' +
      '<span class="pfseal" aria-hidden="true">閃</span>' +
    '</div>';
  }
  function drawKats(){
    scr.querySelectorAll('canvas.pfkat').forEach(c => {
      const k = kat(c.dataset.kat); const x = c.getContext('2d');
      x.clearRect(0, 0, c.width, c.height);
      if (!k || !k.canvas) { setTimeout(drawKats, 300); return; }
      const w = c.width, h = w * k.canvas.height / k.canvas.width;
      x.drawImage(k.canvas, 0, (c.height - h) / 2, w, h);
    });
  }

  function ownedKatanas(){
    const arm = I && I.arm ? I.arm() : null;
    const ord = { '絶': 0, '幻': 1, '極': 2, '上': 3, '並': 4 };
    return ((I && I.KATANA) || []).filter(k => k.id === 'mumei' || (arm && arm.owned && arm.owned[k.id] > 0))
      .sort((a, b) => (ord[a.tier] - ord[b.tier]));
  }

  function renderCard(){
    let h = '';
    if (!online()) h = '<div class="pfempty"><p>名乗りは準備中です。</p></div>';
    else if (!N.user) h = needLogin('名乗り');
    else if (S.err && !S.prof) h = '<p class="rmsg">' + esc(S.err) + '</p>';
    else if (!S.prof) h = '<p class="rmsg">読み込んでいます…</p>';
    else {
      const p = S.prof, ed = S.edit;
      h += cardHtml(p, ed);
      if (p.me && !ed) {
        h += '<div class="pfacts"><button type="button" class="gpull" data-act="edit">名乗りを書き換える</button></div>' +
             '<p class="gnote">二つ名と背景の札は、文箱に届く贈り物で増えます。名前は「オンライン」の画面で変えられます。</p>';
        if (p.title_name && p.title_note) h += '<p class="gnote pfnote">二つ名「' + esc(p.title_name) + '」　' + esc(p.title_note) + '</p>';
      } else if (p.me && ed) {
        const titles = p.my_titles || [], plates = p.my_plates || [];
        h += '<div class="pfedit">' +
          '<label class="pff">一言<input id="pf_word" maxlength="30" value="' + esc(ed.word) + '" placeholder="30文字まで" autocomplete="off"></label>' +
          '<div class="pff"><span>二つ名</span><div class="pfchips">' +
            '<button type="button" data-title=""' + (!ed.title ? ' class="on"' : '') + '>名乗らない</button>' +
            titles.map(t => '<button type="button" data-title="' + esc(t.id) + '" class="' + (ed.title === t.id ? 'on' : '') + (t.style ? ' s-' + esc(t.style) : '') + '"' + ' title="' + esc(t.note) + '">' + esc(t.name) + '</button>').join('') +
            (titles.length ? '' : '<span class="pfnone">まだ持っていません</span>') +
          '</div></div>' +
          '<div class="pff"><span>背景の札</span><div class="pfchips pfplates">' +
            plates.map(t => '<button type="button" data-plate="' + esc(t.id) + '"' + (ed.plate === t.id ? ' class="on"' : '') + '><i class="pfsw pl-' + esc(t.id) + '"></i>' + esc(t.name) + '</button>').join('') +
          '</div></div>' +
          '<label class="pff">好きな一振り<select id="pf_fav"><option value="">選ばない</option>' +
            ownedKatanas().map(k => '<option value="' + esc(k.id) + '"' + (ed.fav === k.id ? ' selected' : '') + '>' + esc(k.tier + '　' + k.mei) + '</option>').join('') +
          '</select></label>' +
          '<div class="pfsave">' + (S.msg ? '<p class="omsg">' + esc(S.msg) + '</p>' : '') + '<div class="pfacts"><button type="button" class="gpull" data-act="save"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? '記しています…' : 'これで名乗る') + '</button>' +
          '<button type="button" class="gback" data-act="cancel">やめる</button></div></div>' +
        '</div>';
      } else {
        h += '<p class="gnote">' + esc(p.name) + 'さんの名乗り</p>';
      }
    }
    return h;
  }

  /* ---------- 文箱 ---------- */
  function giftHtml(m){
    const g = m.gifts || {}, out = [];
    if (g.coins) out.push('<span class="pfg coin">銭 ' + g.coins + '</span>');
    if (g.steel) out.push('<span class="pfg steel">玉鋼 ' + g.steel + '</span>');
    (m.title_names || []).forEach(n => out.push('<span class="pfg nick">二つ名「' + esc(n) + '」</span>'));
    (m.plate_names || []).forEach(n => out.push('<span class="pfg plate">背景「' + esc(n) + '」</span>'));
    return out.join('');
  }
  function renderMail(){
    if (!online()) return '<div class="pfempty"><p>文箱は準備中です。</p></div>';
    if (!N.user) return needLogin('文箱');
    if (S.mailErr === 'missing') return '<div class="pfempty"><p>文箱は準備中です。</p></div>';
    if (S.mailErr) return '<p class="rmsg">' + esc(S.mailErr) + '</p>';
    if (!S.mail) return '<p class="rmsg">読み込んでいます…</p>';
    const items = S.mail.items || [];
    let h = '';
    if (S.msg) h += '<p class="pfgot">' + S.msg + '</p>';
    if (S.mail.unclaimed > 1) h += '<div class="pfacts"><button type="button" class="gpull" data-act="claimall"' + (S.busy ? ' disabled' : '') + '>まとめて受け取る（' + S.mail.unclaimed + '通）</button></div>';
    if (!items.length) h += '<div class="pfempty"><p>文箱は空です。</p></div>';
    h += '<ul class="pfmail">' + items.map(m => {
      const gift = m.gifts && Object.keys(m.gifts).length > 0, open = !!S.open[m.id];
      return '<li class="' + (m.read ? '' : 'new ') + (open ? 'open' : '') + '">' +
        '<button type="button" class="pfmh" data-mail="' + m.id + '"><span class="pfseal2">' + (gift && !m.claimed ? '贈' : '文') + '</span>' +
          '<span class="pfms"><b>' + esc(m.subject) + '</b><small>運営より　' + day(m.at) + '</small></span>' +
          (m.read ? '' : '<i class="pfnew">新</i>') + '</button>' +
        (open ? '<div class="pfmb">' + para(m.body) +
          (gift ? '<div class="pfgifts">' + giftHtml(m) + '</div>' +
            (m.claimed ? '<p class="pfdone">受け取り済み</p>' : '<button type="button" class="gpull" data-claim="' + m.id + '"' + (S.busy ? ' disabled' : '') + '>受け取る</button>') : '') +
        '</div>' : '') +
      '</li>';
    }).join('') + '</ul>';
    h += '<p class="gnote">手紙は新しい順に五十通まで残ります。</p>';
    return h;
  }

  /* ---------- お知らせ ---------- */
  function renderNews(){
    if (!online()) return '<div class="pfempty"><p>お知らせは準備中です。</p></div>';
    if (S.newsErr === 'missing') return '<div class="pfempty"><p>お知らせはまだありません。</p></div>';
    if (S.newsErr) return '<p class="rmsg">' + esc(S.newsErr) + '</p>';
    if (!S.notices) return '<p class="rmsg">読み込んでいます…</p>';
    if (!S.notices.length) return '<div class="pfempty"><p>お知らせはまだありません。</p></div>';
    const god = I && I.isGod && I.isGod();
    return '<ul class="pfnews">' + S.notices.map((n, i) => {
      const open = S.open['n' + n.id] != null ? S.open['n' + n.id] : i === 0;
      return '<li class="k-' + esc(n.kind) + (open ? ' open' : '') + '">' +
        '<button type="button" class="pfnh" data-news="' + n.id + '"><span class="pfkind">' + esc(KIND[n.kind] || '') + '</span>' +
        '<b>' + esc(n.title) + '</b><time>' + day(n.at) + '</time></button>' +
        (open ? '<div class="pfnb">' + (n.body ? para(n.body) : '') +
          (god ? '<button type="button" class="olink" data-delnews="' + n.id + '">' + (S.arm === 'd' + n.id ? 'もう一度触れて取り下げる' : 'このお知らせを取り下げる') + '</button>' : '') + '</div>' : '') +
      '</li>';
    }).join('') + '</ul>';
  }

  /* ---------- 神様: 送る・書く ---------- */
  const GF = { target: 'login', katana: 'ouka', logins: '', subject: '', body: '', coins: '', steel: '', title: '', plate: '' };
  const NF = { kind: 'update', title: '', body: '' };
  const PRESETS = {
    issen: { target: 'issen', subject: '一閃の誉れ', body: '後のない刹那に、明鏡止水を決めた者へ。\n二つ名を贈ります。名乗りの画面で名乗れます。', title: 'issen', plate: '', coins: '', steel: '' },
    ouka: { target: 'katana', katana: 'ouka', subject: '桜華の札', body: '絶の一振り「桜華」を手にした者へ。\n背景の札「桜華」を贈ります。名乗りの画面で使えます。', title: '', plate: 'ouka', coins: '', steel: '' }
  };
  function targetArgs(){
    return { p_target: GF.target, p_arg: GF.target === 'katana' ? GF.katana : GF.target === 'login' ? GF.logins : null };
  }
  function renderSend(){
    const g = S.god;
    if (!g) return '<p class="rmsg">' + esc(S.err || '読み込んでいます…') + '</p>';
    const kats = ((I && I.KATANA) || []).filter(k => k.tier === '絶' || k.tier === '幻');
    const pv = S.preview;
    return '<div class="pfedit pfgod">' +
      '<label class="pff">宛先<select id="gf_target">' +
        [['issen', '決着「一閃」を決めた人'], ['katana', 'この刀を持つ人'], ['all', '全員'], ['login', '名前かログインIDで選ぶ']]
          .map(([v, l]) => '<option value="' + v + '"' + (GF.target === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label>' +
      (GF.target === 'katana' ? '<label class="pff">刀<select id="gf_katana">' + ((I && I.KATANA) || []).map(k => '<option value="' + k.id + '"' + (GF.katana === k.id ? ' selected' : '') + '>' + esc(k.tier + '　' + k.mei) + '</option>').join('') + '</select></label>' : '') +
      (GF.target === 'login' ? '<label class="pff">名前かログインID（「、」で区切れば何人でも）<input id="gf_logins" value="' + esc(GF.logins) + '" autocapitalize="none" spellcheck="false" placeholder="例　風見、take_99"></label>' : '') +
      '<div class="pfacts"><button type="button" class="obtn" data-act="preview">宛先を確かめる</button></div>' +
      (pv ? '<p class="pfpv"><b>' + pv.n + '人</b>' + (pv.list && pv.list.length ? '　' + pv.list.map(x => esc(x.name) + '<small>(' + esc(x.login) + ')</small>').join('、') + (pv.n > pv.list.length ? ' ほか' : '') : '') + '</p>' : '') +
      '<label class="pff">題<input id="gf_subject" maxlength="40" value="' + esc(GF.subject) + '"></label>' +
      '<label class="pff">本文<textarea id="gf_body" maxlength="600" rows="4">' + esc(GF.body) + '</textarea></label>' +
      '<div class="pfrow"><label class="pff">銭<input id="gf_coins" type="number" min="0" max="1000000" inputmode="numeric" value="' + esc(GF.coins) + '"></label>' +
        '<label class="pff">玉鋼<input id="gf_steel" type="number" min="0" max="1000000" inputmode="numeric" value="' + esc(GF.steel) + '"></label></div>' +
      '<div class="pfrow"><label class="pff">二つ名<select id="gf_title"><option value="">添えない</option>' + (g.titles || []).map(t => '<option value="' + esc(t.id) + '"' + (GF.title === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('') + '</select></label>' +
        '<label class="pff">背景の札<select id="gf_plate"><option value="">添えない</option>' + (g.plates || []).filter(p => !p.free).map(t => '<option value="' + esc(t.id) + '"' + (GF.plate === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('') + '</select></label></div>' +
      '<div class="pfacts"><button type="button" class="gpull' + (S.arm === 'send' ? ' arm' : '') + '" data-act="send"' + (S.busy ? ' disabled' : '') + '>' +
        (S.arm === 'send' ? 'もう一度触れて送る' + (pv ? '（' + pv.n + '人）' : '') : '送る') + '</button></div>' +
      '<p class="omsg">' + esc(S.msg) + '</p>' +
      (g.auto && g.auto.length ? '<h3>条件を満たすと自動で届く贈り物</h3><ul class="pfsent">' + g.auto.map(a => '<li><b>' + esc(a.subject) + '</b><span>' + esc(a.cond === 'issen' ? '一閃を決めたら' : a.cond === 'issen_with' ? '「' + (((I && I.KMAP && I.KMAP[a.arg]) || {}).mei || a.arg) + '」で一閃を決めたら' : a.cond === 'katana' ? '「' + (((I && I.KMAP && I.KMAP[a.arg]) || {}).mei || a.arg) + '」を手にしたら' : '') + '・' + a.n + '人に届いた</span></li>').join('') + '</ul>' : '') +
      '<h3>送った手紙</h3><ul class="pfsent">' + ((g.sent || []).map(x => '<li><b>' + esc(x.subject) + '</b><span>' + x.n + '人・受け取り ' + x.claimed + '</span><time>' + day(x.at) + '</time></li>').join('') || '<li class="none">まだありません</li>') + '</ul>' +
    '</div>';
  }
  function renderWrite(){
    return '<div class="pfedit pfgod">' +
      '<div class="pff"><span>種類</span><div class="pfchips">' + Object.keys(KIND).map(k => '<button type="button" data-kind="' + k + '"' + (NF.kind === k ? ' class="on"' : '') + '>' + KIND[k] + '</button>').join('') + '</div></div>' +
      '<label class="pff">題<input id="nf_title" maxlength="40" value="' + esc(NF.title) + '"></label>' +
      '<label class="pff">本文（空行で段落を分ける）<textarea id="nf_body" maxlength="2000" rows="7">' + esc(NF.body) + '</textarea></label>' +
      '<div class="pfacts"><button type="button" class="gpull' + (S.arm === 'post' ? ' arm' : '') + '" data-act="post"' + (S.busy ? ' disabled' : '') + '>' + (S.arm === 'post' ? 'もう一度触れて載せる' : '載せる') + '</button></div>' +
      '<p class="gnote">大事なお知らせは、皆がタイトルを開いたときに一度だけ大きく出ます。</p>' +
      '<p class="omsg">' + esc(S.msg) + '</p>' +
    '</div>';
  }

  /* ---------- 描く ---------- */
  function render(){
    if (scr.hidden) return;
    const god = !!(I && I.isGod && I.isGod() && N && N.user);
    const tabs = $('pf_tabs');
    let title = '', body = '', tl = [];
    if (S.mode === 'card') { title = '名乗り'; body = renderCard(); }
    else if (S.mode === 'mail') {
      title = '文箱';
      if (god) tl = [['box', '文箱'], ['send', '送る']];
      body = S.tab === 'send' && god ? renderSend() : renderMail();
    } else if (S.mode === 'news') {
      title = 'お知らせ';
      if (god) tl = [['list', 'お知らせ'], ['write', '書く']];
      body = S.tab === 'write' && god ? renderWrite() : renderNews();
    }
    $('pf_title').textContent = title;
    tabs.hidden = !tl.length;
    tabs.innerHTML = tl.map(([k, l]) => '<button type="button" data-tab="' + k + '"' + (S.tab === k ? ' class="on"' : '') + '>' + l + '</button>').join('');
    // 入力中の欄は描き直しで消さない
    const act = document.activeElement, keep = act && act.id && scr.contains(act) ? { id: act.id, s: act.selectionStart, e: act.selectionEnd } : null;
    $('pf_body').innerHTML = body;
    $('pf_body').className = 'pfb-' + S.mode;
    if (keep) { const el = $(keep.id); if (el) { el.focus(); try { el.setSelectionRange(keep.s, keep.e); } catch (e) {} } }
    drawKats();
  }

  /* ---------- 操作 ---------- */
  function readForms(){
    const v = id => { const e = $(id); return e ? e.value : null; };
    if (S.edit) { const w = v('pf_word'); if (w != null) S.edit.word = w; const f = v('pf_fav'); if (f != null) S.edit.fav = f || null; }
    if (S.tab === 'send') {
      ['target', 'katana', 'logins', 'subject', 'body', 'coins', 'steel', 'title', 'plate'].forEach(k => { const x = v('gf_' + k); if (x != null) GF[k] = x; });
    }
    if (S.tab === 'write') { const t = v('nf_title'), b = v('nf_body'); if (t != null) NF.title = t; if (b != null) NF.body = b; }
  }
  let armTimer = 0;
  function armOnce(key){
    if (S.arm === key) { S.arm = 0; clearTimeout(armTimer); return true; }
    S.arm = key; clearTimeout(armTimer); armTimer = setTimeout(() => { S.arm = 0; render(); }, 4000); render();
    return false;
  }

  scr.addEventListener('input', e => {
    readForms();
    if (e.target.id === 'pf_word' && S.prof) {   // 一言は札にすぐ映す
      const w = scr.querySelector('.pfword'); if (w) w.innerHTML = S.edit.word ? '「' + esc(S.edit.word) + '」' : '<span class="none">一言はまだない</span>';
    }
  });
  scr.addEventListener('change', e => {
    readForms();
    if (e.target.id === 'gf_target' || e.target.id === 'gf_katana') { S.preview = null; render(); }
    if (e.target.id === 'pf_fav') render();
  });

  scr.addEventListener('click', async e => {
    const t = e.target.closest('button'); if (!t || t.disabled) return;
    readForms();
    const d = t.dataset;
    if (d.tab) {
      S.tab = d.tab; S.msg = ''; S.arm = 0;
      if (d.tab === 'send' && !S.god) loadGod();
      render(); return;
    }
    if (d.act === 'login') { close(); const b = $('m_online'); if (b) b.click(); return; }
    if (d.act === 'edit') { const p = S.prof; S.edit = { word: p.word || '', fav: p.fav || null, title: p.title || null, plate: p.plate || 'sumi' }; S.msg = ''; render(); return; }
    if (d.act === 'cancel') { S.edit = null; render(); return; }
    if (d.title != null && S.edit) { S.edit.title = d.title || null; render(); return; }
    if (d.plate && S.edit) { S.edit.plate = d.plate; render(); return; }
    if (d.act === 'save') {
      S.busy = true; S.msg = ''; render();
      try {
        const ed = S.edit;
        S.prof = await rpc('set_profile', { p_word: ed.word || '', p_fav: ed.fav || null, p_title: ed.title || null, p_plate: ed.plate || null });
        if (S.prof && S.prof.id) tags[S.prof.id] = { title: S.prof.title_name, style: S.prof.title_style, plate: S.prof.plate };
        tagFns.forEach(f => { try { f(); } catch (x) {} });
        S.edit = null; if (N.toast) N.toast('名乗りを改めました', 2500);
      } catch (x) { S.msg = errText(x); if (N.toast) N.toast('名乗りを改められませんでした：' + S.msg, 6000); console.warn('set_profile', x); }
      S.busy = false; render(); return;
    }
    if (d.mail) {
      const id = Number(d.mail); S.open[id] = !S.open[id];
      const m = S.mail && S.mail.items.find(x => x.id === id);
      if (m && !m.read && S.open[id]) { m.read = true; S.mail.unread = Math.max(0, (S.mail.unread || 1) - 1); rpc('read_mail', { p_id: id }).catch(() => {}); badges(); }
      render(); return;
    }
    if (d.claim || d.act === 'claimall') {
      S.busy = true; S.msg = ''; render();
      try {
        const r = await rpc('claim_mail', d.claim ? { p_id: Number(d.claim) } : {});
        if (r && r.save && window.IssenSave && window.IssenSave.applyServer) window.IssenSave.applyServer(r.save);
        const g = (r && r.got) || {}, got = [];
        if (g.coins) got.push('銭 ' + g.coins);
        if (g.steel) got.push('玉鋼 ' + g.steel);
        (g.titles || []).forEach(n => got.push('二つ名「' + esc(n) + '」'));
        (g.plates || []).forEach(n => got.push('背景の札「' + esc(n) + '」'));
        S.msg = got.length ? '<b>受け取りました</b>　' + got.join('・') + ((g.titles || []).length || (g.plates || []).length ? '<br><button type="button" class="olink" data-act="me">名乗りを見る</button>' : '') : '';
        await loadMail();
      } catch (x) { S.msg = esc(errText(x)); }
      S.busy = false; render(); return;
    }
    if (d.act === 'me') { openProfile(null); return; }
    if (d.news) { const k = 'n' + d.news, i = S.notices.findIndex(n => String(n.id) === d.news); S.open[k] = !(S.open[k] != null ? S.open[k] : i === 0); render(); return; }
    if (d.delnews) {
      if (!armOnce('d' + d.delnews)) return;
      try { await rpc('god_delete_notice', { p_id: Number(d.delnews) }); await loadNews(); } catch (x) { if (N.toast) N.toast(errText(x), 4000); }
      render(); return;
    }
    // 神様
    if (d.preset) { Object.assign(GF, PRESETS[d.preset]); S.preview = null; S.msg = ''; render(); preview(); return; }
    if (d.act === 'preview') { preview(); return; }
    if (d.act === 'send') {
      if (!GF.subject.trim()) { S.msg = '題を書いてください'; render(); return; }
      if (!S.preview) await preview();
      if (!armOnce('send')) return;
      S.busy = true; S.msg = ''; render();
      try {
        const gifts = {};
        if (+GF.coins > 0) gifts.coins = Math.floor(+GF.coins);
        if (+GF.steel > 0) gifts.steel = Math.floor(+GF.steel);
        if (GF.title) gifts.titles = [GF.title];
        if (GF.plate) gifts.plates = [GF.plate];
        const n = await rpc('god_send_mail', Object.assign(targetArgs(), { p_subject: GF.subject, p_body: GF.body, p_gifts: gifts }));
        S.msg = n + '人に送りました'; S.preview = null;
        await loadGod(); loadMail();
      } catch (x) { S.msg = errText(x); }
      S.busy = false; render(); return;
    }
    if (d.kind) { NF.kind = d.kind; render(); return; }
    if (d.act === 'post') {
      if (!NF.title.trim()) { S.msg = '題を書いてください'; render(); return; }
      if (!armOnce('post')) return;
      S.busy = true; S.msg = ''; render();
      try {
        const nid = await rpc('god_post_notice', { p_kind: NF.kind, p_title: NF.title, p_body: NF.body });
        store.set(POPPED, Math.max(store.get(POPPED, 0) || 0, Number(nid) || 0));   // 書いた本人には大きく出さない
        NF.title = ''; NF.body = ''; S.msg = '載せました';
        await loadNews(); markSeen();
        S.tab = 'list';
      } catch (x) { S.msg = errText(x); }
      S.busy = false; render(); return;
    }
  });
  async function preview(){
    try { S.preview = await rpc('god_preview', targetArgs()); S.msg = ''; }
    catch (x) { S.preview = null; S.msg = errText(x); }
    render();
  }

  /* ---------- 一覧の名前に添える二つ名 ---------- */
  async function loadTags(ids){
    if (!online() || !N.user) return;
    const want = [...new Set((ids || []).filter(Boolean))].slice(0, 64);
    if (!want.length) return;
    try {
      const d = await rpc('profile_tags', { p_ids: want });
      want.forEach(i => { tags[i] = d && d[i] ? d[i] : { title: null }; });
      tagFns.forEach(f => { try { f(); } catch (x) {} });
    } catch (e) {}
  }
  const tag = id => tags[id] && tags[id].title ? '<span class="pftag' + (tags[id].style ? ' s-' + esc(tags[id].style) : '') + '">' + esc(tags[id].title) + '</span>' : '';

  /* ---------- ログインの変化 ---------- */
  let who = null, mailTimer = 0;
  if (N && N.on) N.on(() => {
    const u = N.user ? N.user.id : null;
    if (u !== who) {
      who = u; S.mail = null; S.mailErr = ''; S.god = null;
      Object.keys(tags).forEach(k => delete tags[k]);
      clearInterval(mailTimer);
      if (u) { loadMail(); mailTimer = setInterval(() => { if (!menu || !menu.hidden) loadMail(); }, 120000); }
      if (!scr.hidden) { if (S.mode === 'card') { S.pid = S.pid || u; loadProfile(); } else if (S.mode === 'mail') loadMail(); else render(); }
    }
    if (N.ready && !S.notices && !S.newsErr && online()) loadNews();
    badges();
  });
  // お知らせは時々読み直す（タイトルにいるときだけ）
  setInterval(() => { if (menu && !menu.hidden && online()) loadNews(); }, 300000);
  // 対戦が始まるときは閉じる
  if (N) { const prev = N.onMatchUi; N.onMatchUi = function(s){ if (s !== 'idle') { close(); pop.hidden = true; } if (prev) prev(s); }; }
  if (window.IssenZetsu) window.IssenZetsu.on(() => render());

  syncCorner();
  window.IssenProfile = { open: openProfile, openMail, openNews, close, loadTags, tag, onTags: f => tagFns.add(f), plateName: id => PLATE_NAME[id] || id };
})();
