// ゲーム（js/game.js）とサーバー（supabase/save-data.sql）で、刀の一覧・ガチャの確率・決着の銭が一致しているか
// 刀を足したのに SQL を作り直し忘れた、を見つける。使い方: node tests/save-values-test.js
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'js/game.js'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'supabase/save-data.sql'), 'utf8');
const { katanaRows } = require('../tools/katana-sql.js');
let ng = 0; const ok = (c, m) => { console.log((c ? 'OK ' : 'NG ') + m); if (!c) ng++; };
const game = katanaRows().map(r => r.join(':')).sort().join(',');
const block = sql.slice(sql.indexOf('KATANA-BEGIN'), sql.indexOf('KATANA-END'));
const srv = [...block.matchAll(/\('([a-z0-9_]+)', '(.)'\)/g)].map(m => m[1] + ':' + m[2]).sort().join(',');
ok(game === srv, '刀の一覧（' + katanaRows().length + '本）が一致' + (game === srv ? '' : '。node tools/katana-sql.js を実行してください'));
const ids = katanaRows().map(r => r[0]); ok(new Set(ids).size === ids.length, '刀の id に重なりがない');
const ev = s => Function('return ' + s)();
const rate = ev(js.match(/const TIERRATE=(\[.*?\]);/)[1]), dup = ev(js.match(/const DUPBACK=(\{.*?\});/)[1]);
const tiers = [...sql.matchAll(/\('(.)', (\d+), (\d+)\)/g)].map(m => [m[1], +m[2], +m[3]]);
ok(rate.every(([t, w]) => tiers.some(x => x[0] === t && x[1] === w && x[2] === dup[t])), 'ガチャの確率と重なりの銭が一致');
const coin = ev(js.match(/const COIN=(\{.*?\});/)[1]);
const fin = ev(js.slice(js.indexOf('const FIN=') + 10, js.indexOf('};', js.indexOf('const FIN=')) + 1));
const fc = Object.fromEntries([...sql.matchAll(/\('([^']+)', (\d+)\)/g)].map(m => [m[1], +m[2]]));
ok(Object.keys(fin).filter(n => fin[n].tier !== '分').every(n => fc[n] === coin[fin[n].tier]), '決着ごとの銭が一致');
ok(+js.match(/let PULLCOST=(\d+)/)[1] === +sql.match(/pull_cost int not null default (\d+)/)[1], 'ガチャ1回の銭が一致');
process.exit(ng ? 1 : 0);
