// 刀の通り道から当たり判定の表を作り、js/action/boxes.js に書き出す
// 使い方: node tools/action-boxes.js   （技の arc・s・a・ext や pose.js を変えたら実行する）
const fs = require('fs'), path = require('path');
const out = path.join(__dirname, '..', 'js', 'action', 'boxes.js');
fs.writeFileSync(out, 'module.exports={};'); // 古い表を読まないように一度空にする
delete require.cache[require.resolve('../js/action/sim.js')];
const A = require('../js/action/sim.js'), Pose = require('../js/action/pose.js');
const B = {};
for (const id in A.MV) { const b = Pose.sweepBoxes(id, A.MV[id]); if (b) B[id] = b; }
const body = Object.keys(B).map(id => '  ' + id + ': ' + JSON.stringify(B[id])).join(',\n');
fs.writeFileSync(out, `/* 自動で作った当たり判定の表（tools/action-boxes.js）。手で直さない。
   技ごとに、当たっているフレームの順に [前へのずれ, 足元からの高さ, 幅, 高さ](px) */
(function(root){
const B = {
${body}
};
if (typeof module !== 'undefined' && module.exports) module.exports = B; else root.IssenActionBoxes = B;
})(typeof window !== 'undefined' ? window : globalThis);
`);
console.log(Object.keys(B).length + ' 技');
for (const id in B) console.log(id.padEnd(8), JSON.stringify(B[id]));
