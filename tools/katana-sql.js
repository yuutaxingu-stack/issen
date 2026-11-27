// js/game.js の刀の一覧（KATANA）と箱（BOXES）から、supabase/save-data.sql の刀と箱の行を作り直す
// 使い方: node tools/katana-sql.js   （刀や箱を足したり階級を変えたりしたら実行し、save-data.sql を SQL Editor で実行）
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'js/game.js'), 'utf8');
const body = js.slice(js.indexOf('const KATANA=['), js.indexOf('];', js.indexOf('const KATANA=[')));
// [id, 階級, 箱]（box を書いていない刀は第一弾 b1）
const rows = body.split('\n').map(l => {
  const m = l.match(/\{id:'([a-z0-9_]+)',[^\n]*?tier:'(.)'/); if (!m) return null;
  const b = l.match(/\bbox:'([a-z0-9_]+)'/); return [m[1], m[2], b ? b[1] : 'b1'];
}).filter(Boolean);
const ev = s => Function('return ' + s)();
const boxes = ev(js.match(/const BOXES=(\[.*?\]);/)[1]);
const ZNEW = +js.match(/const ZNEW=([\d.]+)/)[1], ZOLD = +js.match(/ZOLD=([\d.]+)/)[1];
// [id, 出た順, 名前, 目玉の絶, 最新のときの絶%, 古くなってからの絶%]
const boxRows = boxes.map((b, i) => [b.id, i + 1, b.mei, b.pick || null, b.zNew != null ? b.zNew : ZNEW, ZOLD]);
function katanaRows(){ return rows; }
module.exports = { katanaRows, boxRows: () => boxRows };
if (require.main === module) {
  const file = path.join(root, 'supabase/save-data.sql');
  let sql = fs.readFileSync(file, 'utf8');
  const put = (tag, lines) => { const a = sql.indexOf('-- ' + tag + '-BEGIN'), b = sql.indexOf('  -- ' + tag + '-END');
    sql = sql.slice(0, a) + '-- ' + tag + '-BEGIN\n' + lines + '\n' + sql.slice(b); };
  const q = v => v == null ? 'null' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
  put('BOXES', boxRows.map(r => '  (' + r.map(q).join(', ') + ')').join(',\n'));
  put('KATANA', rows.map(r => '  (' + r.map(q).join(', ') + ')').join(',\n'));
  fs.writeFileSync(file, sql);
  console.log(boxRows.length + 'つの箱・' + rows.length + '本の刀を書き出しました');
}
