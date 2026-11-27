// 画面側のリンク判定（js/no-link.js）を試す。使い方: node tests/no-link-test.js
const L = require('../js/no-link.js');
const C = require('./no-link-cases.json');
let bad = 0;
for (const t of C.link) if (!L.has(t)) { bad++; console.log('NG 見逃し:', t); }
for (const t of C.ok) if (L.has(t)) { bad++; console.log('NG 誤検出:', t); }
console.log(bad ? bad + ' 件NG' : 'OK ' + (C.link.length + C.ok.length) + ' 件');
process.exit(bad ? 1 : 0);
