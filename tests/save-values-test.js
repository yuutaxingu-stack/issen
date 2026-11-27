// ゲーム（js/game.js）とサーバー（supabase/save-data.sql）で、刀の一覧・ガチャの確率・決着の銭が一致しているか
// 刀を足したのに SQL を作り直し忘れた、を見つける。使い方: node tests/save-values-test.js
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'js/game.js'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'supabase/save-data.sql'), 'utf8');
const { katanaRows, boxRows } = require('../tools/katana-sql.js');
let ng = 0; const ok = (c, m) => { console.log((c ? 'OK ' : 'NG ') + m); if (!c) ng++; };
const game = katanaRows().map(r => r.join(':')).sort().join(',');
const block = sql.slice(sql.indexOf('KATANA-BEGIN'), sql.indexOf('KATANA-END'));
const srv = [...block.matchAll(/\('([a-z0-9_]+)', '(.)', '([a-z0-9_]+)'\)/g)].map(m => m[1] + ':' + m[2] + ':' + m[3]).sort().join(',');
ok(game === srv, '刀の一覧と箱（' + katanaRows().length + '本）が一致' + (game === srv ? '' : '。node tools/katana-sql.js を実行してください'));
const ids = katanaRows().map(r => r[0]); ok(new Set(ids).size === ids.length, '刀の id に重なりがない');
const bblock = sql.slice(sql.indexOf('BOXES-BEGIN'), sql.indexOf('BOXES-END'));
const q = v => v == null ? 'null' : typeof v === 'number' ? String(v) : "'" + v + "'";
const brow = boxRows().map(r => '(' + r.map(q).join(', ') + ')').join('|');
const bsrv = [...bblock.matchAll(/\((.*)\)/g)].map(m => '(' + m[1] + ')').join('|');
ok(brow === bsrv, '箱（' + boxRows().length + 'つ）が一致');
ok(katanaRows().every(r => boxRows().some(b => b[0] === r[2])), 'どの刀も、ある箱に入っている');
ok(boxRows().every(b => !b[3] || katanaRows().some(r => r[0] === b[3] && r[1] === '絶' && r[2] === b[0])), '目玉はその箱の絶の刀');
ok(boxRows().every(b => katanaRows().filter(r => r[2] === b[0] && r[1] === '絶').length <= 1), '絶は一つの箱に一振りまで');
const ev = s => Function('return ' + s)();
const rate = ev(js.match(/const TIERRATE=(\[.*?\]);/)[1]);
const steel = ev(js.match(/const STEEL=(\{.*?\});/)[1]), forge = ev(js.match(/const FORGE=(\{.*?\});/)[1]);
const tiers = [...sql.matchAll(/\('(.)', ([\d.]+), (\d+), (\d+), (\d+)\)/g)].map(m => [m[1], +m[2], +m[3], +m[4], +m[5]]);
ok(tiers.length === 5 && rate.every(([t, w]) => tiers.some(x => x[0] === t && x[1] === w)) && tiers.filter(x => x[0] === '並' || x[0] === '絶').every(x => x[1] === 0)
  && tiers.every(x => x[2] === 0 && x[3] === steel[x[0]] && x[4] === forge[x[0]]), 'ガチャの確率・玉鋼・鍛える値段が一致');
const coin = ev(js.match(/const COIN=(\{.*?\});/)[1]);
const fin = ev(js.slice(js.indexOf('const FIN=') + 10, js.indexOf('};', js.indexOf('const FIN=')) + 1));
const fc = Object.fromEntries([...sql.matchAll(/\('([^']+)', (\d+)\)/g)].map(m => [m[1], +m[2]]));
ok(Object.keys(fin).filter(n => fin[n].tier !== '分').every(n => fc[n] === coin[fin[n].tier]), '決着ごとの銭が一致');
ok(+js.match(/let PULLCOST=(\d+)/)[1] === +sql.match(/pull_cost int not null default (\d+)/)[1], 'ガチャ1回の銭が一致');
process.exit(ng ? 1 : 0);
