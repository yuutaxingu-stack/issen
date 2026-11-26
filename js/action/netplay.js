/* =====================================================================
   新・一閃 ネット対戦の巻き戻し（ロールバック）
   二人の端末が同じ計算を同じ入力で進める。相手の入力がまだ届いていないコマは
   「直前と同じ」と見込んで先に進め、本当の入力が届いて違っていたら、
   そのコマまで戻して計算し直す。画面や通信は知らない（app.js と online.js が持つ）。

   使い方:
     const np = NetPlay({ me, delay, maxRoll, save, load, step });
       save() → 盤面の写し / load(写し) / step(入力[2], 計算し直し中か)
     np.local(code)        … 自分の今の入力（delay コマ先に効く）を置く。置いたコマ番号を返す
     np.remote(f, code)    … 相手のコマ f の入力（f は 0 から順に届く）
     np.advance()          … 1コマ進める。相手が遅れすぎていれば進めずに false
   入力は数ひとつ（encode / decode）。
   ===================================================================== */
(function(root){
'use strict';

const CD = ['', 'n', 'l', 'r', 'u', 'd'], VD = [undefined, 'h', 'u', 'd', 'n'];
function encode(i){
  if (!i) return 0;
  let c = (i.L ? 1 : 0) | (i.R ? 2 : 0) | (i.U ? 4 : 0) | (i.D ? 8 : 0) | (i.A ? 16 : 0) | (i.J ? 32 : 0) | (i.G ? 64 : 0) | (i.S ? 128 : 0) | (i.F ? 256 : 0);
  const ci = i.C ? CD.indexOf(i.C) : 0, vi = i.V ? VD.indexOf(i.V) : 0;
  return c | ((ci > 0 ? ci : 0) << 9) | ((vi > 0 ? vi : 0) << 12);
}
function decode(c){
  const i = { L: c & 1 ? 1 : 0, R: c & 2 ? 1 : 0, U: c & 4 ? 1 : 0, D: c & 8 ? 1 : 0, A: c & 16 ? 1 : 0, J: c & 32 ? 1 : 0, G: c & 64 ? 1 : 0 };
  if (c & 128) i.S = 1;
  if (c & 256) i.F = true;
  const ci = (c >> 9) & 7, vi = (c >> 12) & 7;
  if (ci) i.C = CD[ci];
  if (vi) i.V = VD[vi];
  return i;
}
// 見込み: 押しっぱなしはそのまま、一瞬だけの入力（斬の向き・ダッシュ）は続かないものとする
const predictFrom = c => c & ~(256 | (7 << 9));

function NetPlay(o){
  const me = o.me, op = 1 - me, D = o.delay == null ? 2 : o.delay, MAXR = o.maxRoll || 10;
  const L = [], R = [], used = [], snaps = [];
  const np = {
    frame: 0,        // 次に計算するコマ
    lh: -1,          // 自分の入力を置いた最後のコマ
    rh: -1,          // 相手の入力が届いている最後のコマ（ここまでは確定）
    rollTo: -1,      // 計算し直す始まりのコマ（なければ -1）
    rolls: 0, rolled: 0, maxRolled: 0,
  };
  for (let f = 0; f < D; f++) { L[f] = 0; R[f] = 0; np.lh = f; np.rh = f; } // はじめの delay コマは二人とも何も押していない
  np.local = function(code){ const f = ++np.lh; L[f] = code; return f; };
  np.remote = function(f, code){
    if (f !== np.rh + 1) return false;   // 順に届く前提
    R[f] = code; np.rh = f;
    if (f < np.frame && used[f] !== code && (np.rollTo < 0 || f < np.rollTo)) np.rollTo = f;
    return true;
  };
  function remoteAt(f){
    if (f <= np.rh) return R[f];
    return np.rh >= 0 ? predictFrom(R[np.rh]) : 0;
  }
  function inputs(f){
    const a = [], rc = remoteAt(f); used[f] = rc;
    a[me] = decode(L[f] || 0); a[op] = decode(rc);
    return a;
  }
  np.canAdvance = () => np.frame - np.rh <= MAXR && np.frame <= np.lh;
  np.D = D;
  np.resolve = function(){
    if (np.rollTo >= 0) {
      const from = np.rollTo; np.rollTo = -1;
      o.load(snaps[from]);
      for (let f = from; f < np.frame; f++) { snaps[f] = o.save(); o.step(inputs(f), true, f); }
      np.rolls++; np.rolled += np.frame - from; np.maxRolled = Math.max(np.maxRolled, np.frame - from);
    }
  };
  np.advance = function(){
    np.resolve();
    if (!np.canAdvance()) return false;
    const f = np.frame;
    snaps[f] = o.save();
    o.step(inputs(f), false, f);
    np.frame++;
    // もう戻らないコマの写しは捨てる
    const keep = Math.min(np.rh, np.frame - 1);
    for (let k = keep - 1; k >= 0 && snaps[k] !== undefined; k--) { snaps[k] = undefined; }
    return true;
  };
  // 確定した（もう巻き戻らない）最後のコマ。ここまでの計算は二人で同じになる
  np.confirmed = () => Math.min(np.rh, np.frame - 1, np.rollTo >= 0 ? np.rollTo - 1 : Infinity); // 計算し直し待ちのコマはまだ確定していない
  np.localCode = f => L[f];
  return np;
}

const API = { NetPlay, encode, decode };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else root.IssenNetPlay = API;
})(typeof window !== 'undefined' ? window : globalThis);
