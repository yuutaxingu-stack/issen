// js/game.js の刀の一覧（KATANA）から、supabase/save-data.sql の刀の行を作り直す
// 使い方: node tools/katana-sql.js   （刀を足したり階級を変えたりしたら実行し、save-data.sql を SQL Editor で実行）
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'js/game.js'), 'utf8');
const body = js.slice(js.indexOf('const KATANA=['), js.indexOf('];', js.indexOf('const KATANA=[')));
const rows = [...body.matchAll(/\{id:'([a-z0-9_]+)',[^\n]*?tier:'(.)'/g)].map(m => [m[1], m[2]]);
function katanaRows(){ return rows; }
module.exports = { katanaRows };
if (require.main === module) {
  const file = path.join(root, 'supabase/save-data.sql');
  const sql = fs.readFileSync(file, 'utf8');
  const a = sql.indexOf('-- KATANA-BEGIN'), b = sql.indexOf('  -- KATANA-END');
  const lines = rows.map(([id, t]) => "  ('" + id + "', '" + t + "')").join(',\n');
  fs.writeFileSync(file, sql.slice(0, a) + '-- KATANA-BEGIN\n' + lines + '\n' + sql.slice(b));
  console.log(rows.length + '本の刀を書き出しました');
}
