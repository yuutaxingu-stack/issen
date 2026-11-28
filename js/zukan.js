/* =====================================================================
   一閃 図鑑
   決着（旧・一閃／新・一閃）・二つ名・背景の札の条件を一覧で見る。
   決着の回数は端末（ログイン中はアカウント）の刀ごとの戦績 ARM.rec を合計する（旧と新は分けずに数えている）。
   二つ名・背景はサーバーの zukan()（supabase/zukan.sql）から読む。
   隠し二つ名は、一度でも手にした人にだけ名前と条件が返ってくる。
   ===================================================================== */
(function(){
  const N = window.IssenNet, I = window.__issen;
  const $ = id => document.getElementById(id);
  const el = $('zukan');
  if (!el || !I) return;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const D = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const kn = n => n < 10 ? D[n] : n < 100 ? (n >= 20 ? D[Math.floor(n / 10)] : '') + '十' + (n % 10 ? D[n % 10] : '') : String(n);
  const TIERS = ['並', '上', '極', '幻', '絶'];
  const TLEAD = { '並': '並　なみ', '上': '上　じょう', '極': '極　きわみ', '幻': '幻　まぼろし', '絶': '絶　ぜつ' };

  // 決着の条件。順は階級ごと。いくつも当てはまるときは上の階級になる
  const OLD = [
    ['疾風', 'はやて', '並', '構えていない相手を、居合で斬る'],
    ['先の先', 'せんのせん', '並', '居合どうし、先に抜いた方が斬る'],
    ['隙穿ち', 'すきうがち', '並', '見切りを空振りした相手の硬直を、居合で斬る'],
    ['陽炎', 'かげろう', '上', '居合を解いて見切りを誘い、空振りの硬直を斬る'],
    ['二の太刀', 'にのたち', '上', '見切りで一度返し、もう一度見切りで返して勝つ'],
    ['止め', 'とどめ', '上', '見切りで一度返した側が、居合で決める'],
    ['死中活', 'しちゅうかつ', '極', '見切りで一度返された側が、居合で逆転する'],
    ['流転', 'るてん', '極', '居合を解いてすぐ見切り、二度目の返しで決める'],
    ['紙一重', 'かみひとえ', '極', '互いに一度ずつ見切りで返し、後がない。そこを居合で斬り勝つ'],
    ['鏡返し', 'かがみがえし', '極', '互いに一度ずつ見切りで返し、後がない。そこを見切りで返して勝つ'],
    ['明鏡止水', 'めいきょうしすい', '幻', '斬られるその刹那に見切る。寸分違わぬ見切りは一度で勝ち'],
    ['一閃', 'いっせん', '絶', '互いに後がない一本で、寸分違わぬ見切りを決める']
  ];
  const NEW = [
    ['斬り伏せ', 'きりふせ', '並', '連撃で体力を削りきる'],
    ['疾風', 'はやて', '並', '気絶させた相手を、居合で斬る'],
    ['先の先', 'せんのせん', '並', '相手の技の出かかりを斬り、そこからの連撃で勝つ'],
    ['隙穿ち', 'すきうがち', '並', '技の後の隙・着地・転がりを斬り、そこからの連撃で勝つ'],
    ['落花', 'らっか', '上', 'どちらかが宙にいるうちに決める'],
    ['背水', 'はいすい', '上', '相手を壁に打ちつけ、追い詰めて勝つ'],
    ['止め', 'とどめ', '上', '一続きの連撃で、体力の半分を削って決める'],
    ['陽炎', 'かげろう', '上', '相手の背から斬って決める'],
    ['刹那', 'せつな', '上', '時間切れの後の一太刀勝負で、先に当てる'],
    ['百花', 'ひゃっか', '極', '十連撃を超えて決める'],
    ['流転', 'るてん', '極', 'ガードを割られかけたところから、居合で決める'],
    ['死中活', 'しちゅうかつ', '極', '体力が二割を切ってから勝つ'],
    ['鏡返し', 'かがみがえし', '極', '互いに後がない一本を、連撃で取る'],
    ['紙一重', 'かみひとえ', '極', '互いに後がない一本を、居合で取る'],
    ['明鏡止水', 'めいきょうしすい', '幻', '一度も攻撃を受けずに勝つ'],
    ['一閃', 'いっせん', '絶', '互いに後がない一本を、無傷のまま居合で取る'],
    ['散華', 'さんげ', '絶', '絶の一振り「桜華」で勝つと、並と上の決着は散華に変わる']
  ];
  const DRAW = {
    old: ['睨み合い', 'にらみあい', '時間内に決着がつかない。引き分け'],
    new: ['睨み合い', 'にらみあい', '一太刀勝負でも六十秒決まらない。引き分け']
  };

  const store = {
    get(k, d){ try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v){ try { localStorage.setItem(k, v); } catch (e) {} }
  };
  let tab = store.get('issen-zukan-tab', 'fin'), mode = store.get('issen-zukan-mode', 'old');
  let data = null, loading = false, err = '';

  function counts(){
    const rec = (I.arm && I.arm().rec) || {}, c = {};
    Object.keys(rec).forEach(k => { const r = rec[k] || {}; Object.keys(r).forEach(n => { c[n] = (c[n] || 0) + (+r[n] || 0); }); });
    return c;
  }

  function open(){ el.hidden = false; el.scrollTop = 0; render(); load(); }
  function close(){ el.hidden = true; }
  $('m_zukan').addEventListener('click', open);
  $('z_back').addEventListener('click', close);
  el.querySelectorAll('.ztabs button').forEach(b => b.addEventListener('click', () => {
    tab = b.dataset.tab; store.set('issen-zukan-tab', tab); el.scrollTop = 0; render();
  }));
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-mode]'); if (!b) return;
    mode = b.dataset.mode; store.set('issen-zukan-mode', mode); render();
  });

  async function load(){
    if (!N || !N.configured() || !N.ready || !N.user || loading) return;
    loading = true; err = ''; render();
    try {
      const { data: d, error } = await N.sb.rpc('zukan');
      if (error) throw error;
      data = d;
    } catch (e) {
      err = e && (e.code === 'PGRST202' || e.code === '42883') ? 'この頁はまだ準備中です' : N.jp(e);
    }
    loading = false; render();
  }

  function finHtml(){
    const list = mode === 'new' ? NEW : OLD, c = counts();
    const got = list.filter(f => c[f[0]] > 0).length;
    let h = '<div class="zmode" role="tablist">' +
      '<button type="button" data-mode="old"' + (mode === 'old' ? ' class="on"' : '') + '>旧・一閃<small>居合と見切り</small></button>' +
      '<button type="button" data-mode="new"' + (mode === 'new' ? ' class="on"' : '') + '>新・一閃<small>動いて斬り合う</small></button></div>' +
      '<p class="zsum">決めた決着　<b>' + kn(got) + '</b><small>／' + kn(list.length) + '</small></p>';
    TIERS.forEach(t => {
      const fs = list.filter(f => f[2] === t); if (!fs.length) return;
      h += '<section class="zsec t-' + t + '"><h3><i>' + t + '</i>' + esc(TLEAD[t].split('　')[1]) + '</h3><ol class="zlist">';
      fs.forEach(f => {
        const n = c[f[0]] || 0, veil = f[0] === '一閃' && !n;   // 一閃だけは、決めるまで条件を伏せる（ユーザー指定）
        h += '<li class="zfin' + (n ? ' got' : '') + (veil ? ' veil' : '') + '"><div class="zname"><b>' + esc(f[0]) + '</b><small>' + esc(f[1]) + '</small></div>' +
          '<p class="zcond">' + (veil ? '決めた者だけが知る' : esc(f[3])) + '</p><span class="zcnt">' + (n ? kn(n) + '<small>回</small>' : '未') + '</span></li>';
      });
      h += '</ol></section>';
    });
    const d = DRAW[mode] || DRAW.old;
    h += '<section class="zsec t-分"><h3><i>分</i>ひきわけ</h3><ol class="zlist"><li class="zfin draw"><div class="zname"><b>' + esc(d[0]) + '</b><small>' + esc(d[1]) + '</small></div><p class="zcond">' + esc(d[2]) + '</p><span class="zcnt"></span></li></ol></section>';
    h += '<p class="gnote">いくつも当てはまるときは、上の階級の決着になります。' + (mode === 'new' ? '「後がない」は二本先取で、互いに一本ずつ取ったとき。' : '') +
      '<br>回数は旧・一閃と新・一閃を合わせて数えています。</p>';
    return h;
  }

  function needServer(){
    if (!N || !N.configured()) return '<p class="zmsg">二つ名と背景の札は、オンラインの準備ができてから見られます。</p>';
    if (!N.user) return '<p class="zmsg">オンラインでログインすると見られます。</p>';
    if (err) return '<p class="zmsg">' + esc(err) + '</p>';
    if (!data) return '<p class="zmsg">読み込んでいます…</p>';
    return '';
  }

  function titleRow(t){
    if (!t.name) return '<li class="zt veil"><div class="zname"><b>？？？</b></div><p class="zcond">手にした者だけが知る</p><span class="zcnt">未</span></li>';
    const st = t.style ? ' s-' + esc(t.style) : '';
    const state = t.have ? '手中' : t.seen ? '離る' : '未';
    return '<li class="zt' + (t.have ? ' got' : '') + (t.seen && !t.have ? ' gone' : '') + '"><div class="zname"><span class="ztag' + st + '">' + esc(t.name) + '</span></div>' +
      '<p class="zcond">' + esc(t.note) + (t.hidden && t.seen && !t.have ? '<br><em>今は他の者の手にある。一番に返り咲けば戻る</em>' : '') + '</p><span class="zcnt">' + state + '</span></li>';
  }

  function titlesHtml(){
    const w = needServer(); if (w) return w;
    const all = data.titles || [], open_ = all.filter(t => !t.hidden), hid = all.filter(t => t.hidden);
    let h = '<p class="zsum">手にした二つ名　<b>' + kn(all.filter(t => t.have).length) + '</b><small>／' + kn(all.length) + '</small></p>';
    h += '<section class="zsec"><h3><i>名</i>二つ名</h3><ol class="zlist">' + open_.map(titleRow).join('') + '</ol></section>';
    if (hid.length) {
      const known = hid.filter(t => t.name).length;
      h += '<section class="zsec hid"><h3><i>秘</i>隠し二つ名<span class="zsub">' + kn(known) + '／' + kn(hid.length) + ' を知る</span></h3>' +
        '<p class="zlead">一番の者だけが名乗れる。抜かれれば、抜いた者へ移る。</p><ol class="zlist">' + hid.map(titleRow).join('') + '</ol></section>';
    }
    h += '<p class="gnote">二つ名は文箱に届きます。名乗りの画面で名乗れます。</p>';
    return h;
  }

  function platesHtml(){
    const w = needServer(); if (w) return w;
    const ps = data.plates || [];
    let h = '<p class="zsum">手にした背景の札　<b>' + kn(ps.filter(p => p.have).length) + '</b><small>／' + kn(ps.length) + '</small></p><ol class="zlist zplates">';
    h += ps.map(p => '<li class="zt' + (p.have ? ' got' : '') + '"><div class="zname"><i class="pfsw pl-' + esc(p.id) + '"></i><b>' + esc(p.name) + '</b></div>' +
      '<p class="zcond">' + esc(p.note) + '</p><span class="zcnt">' + (p.have ? '手中' : '未') + '</span></li>').join('');
    return h + '</ol><p class="gnote">背景の札は、名乗りの画面で選べます。</p>';
  }

  function render(){
    if (el.hidden) return;
    el.querySelectorAll('.ztabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    $('z_body').innerHTML = tab === 'title' ? titlesHtml() : tab === 'plate' ? platesHtml() : finHtml();
  }
  let who = null;
  if (N && N.on) N.on(() => { const u = N.user ? N.user.id : null; if (u !== who) { who = u; data = null; err = ''; if (!el.hidden) load(); } });
  window.IssenZukan = { open, close };
})();
