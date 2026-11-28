// js/game.js の刀の表（KATANA）から、新・一閃で刀を描くための見た目の表を js/action/katlook-data.js に書き出す
// 使い方: node tools/action-katlook.js   （刀を足したり色を変えたら実行する）  --check で食い違いだけ確かめる
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'game.js'), 'utf8');
const m = src.match(/const KATANA=\[([\s\S]*?)\n\];/);
if (!m) { console.error('KATANA が見つからない'); process.exit(1); }
const KATANA = eval('[' + m[1] + ']');
const L = {};
for (const k of KATANA) {
  const o = { t: k.tier };
  if (k.src) { o.src = k.src; if (k.up) o.up = 1; }
  else { o.w = k.wrap || null; o.m = k.metal || 'gold'; o.b = k.blade || null; }
  o.s = k.slash || {};
  L[k.id] = o;
}
const body = Object.keys(L).map(id => '  ' + id + ': ' + JSON.stringify(L[id])).join(',\n');
const text = `/* 自動で作った刀の見た目の表（tools/action-katlook.js が js/game.js の KATANA から作る）。手で直さない。
   t=階級 / w=柄巻の色 / m=鍔の金物 / b=刃の色 [r,g,b,濃さ] か 'iris' / s=斬った筋の色 / src=絶の絵（up=元から刃が上） */
(function(root){
const K = {
${body}
};
if (typeof module !== 'undefined' && module.exports) module.exports = K; else root.IssenKatLook = K;
})(typeof window !== 'undefined' ? window : globalThis);
`;
const out = path.join(__dirname, '..', 'js', 'action', 'katlook-data.js');
if (process.argv[2] === '--check') { const ok = fs.existsSync(out) && fs.readFileSync(out, 'utf8') === text; console.log(ok ? 'ok 刀の見た目の表は最新' : 'NG 刀の見た目の表が古い（node tools/action-katlook.js）'); process.exit(ok ? 0 : 1); }
fs.writeFileSync(out, text); console.log(Object.keys(L).length + ' 振り');
