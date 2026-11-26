/* =====================================================================
   一閃（対戦アクション） 技の最中の体と刀の形
   描画（app.js）と、当たり判定の表づくり（tools/action-boxes.js）の両方がこれを使う。
   刀の通り道から判定を作るので、白い軌跡と判定がずれない。
   座標は足元が原点、+x が前、+y が上（px）。
   ===================================================================== */
(function(root){
'use strict';
const BLADE = 82;          // 刀の長さ
const ARM = 30, TORSO = 44;
const lerp = (a, b, t) => a + (b - a) * t;
const rad = d => d * Math.PI / 180;

/* 技 m の f フレーム目の形 */
function attackPose(id, m, f){
  const P = { hip: 56, lean: 6, fA: [-16, 0], fB: [18, 0], sw: 25, arm: -30, sheath: false };
  const a0 = m.arc[0], a1 = m.arc[1];
  if (m.iai) P.sheath = f < m.s;
  if (f < m.s) { const t = f / m.s; P.sw = lerp(25, a0, Math.min(1, t * 1.6)); P.lean = lerp(6, -4, t); }
  else if (f < m.s + m.a) { const t = (f - m.s + 1) / m.a; P.sw = lerp(a0, a1, t); P.lean = 18; }
  else { const t = (f - m.s - m.a) / Math.max(1, m.r); P.sw = lerp(a1, 25, t * t); P.lean = lerp(18, 6, t); }
  P.arm = P.sw * 0.55 - 18;          // 腕は刀の向きに半分ほどついていく（手が体の前に来る）
  if (m.k === 'a') { P.fA = [-12, 20]; P.fB = [16, 14]; }
  if (id === 'dtilt' || id === 'sweep') { P.hip = 34; P.fA = [-22, 0]; P.fB = [30, 0]; }
  if (id === 'counter') { P.sw = 100; P.arm = 30; P.lean = -4; P.hip = 50; P.fA = [-22, 0]; P.fB = [16, 0]; }
  if (id === 'rise') { P.fA = [-8, 6]; P.fB = [10, 16]; P.lean = -6; }
  if (id === 'dair' || id === 'plunge') { P.fA = [-10, 18]; P.fB = [12, 22]; P.lean = 6; P.arm = -80; }
  if (id === 'side' || id === 'sideA' || id === 'dashatk' || m.iai) { P.fA = [-34, 0]; P.fB = [30, 0]; P.hip = 44; P.lean = 28; if (m.k === 'a') { P.fA = [-24, 16]; P.fB = [20, 10]; } }
  if (id === 'gatk') { P.hip = 40; }
  if (m.grab) { P.arm = 0; P.sw = -40; P.lean = 22; }
  return P;
}
/* 肩・手・刀先 */
function joints(P){
  const hx = 0, hy = P.hip;
  const sx = hx + Math.sin(rad(P.lean)) * TORSO, sy = hy + Math.cos(rad(P.lean)) * TORSO;
  let nx = sx + Math.cos(rad(P.arm)) * ARM, ny = sy + Math.sin(rad(P.arm)) * ARM;
  if (P.sheath) { nx = hx + 6; ny = hy + 8; }
  const dx = Math.cos(rad(P.sw)), dy = Math.sin(rad(P.sw));
  return { sx, sy, nx, ny, dx, dy, tx: nx + dx * BLADE, ty: ny + dy * BLADE };
}
/* 当たっているフレームごとの判定（刀の通り道を囲む四角）。[前へのずれ, 高さ, 幅, 高さ] */
function sweepBoxes(id, m){
  if (m.noBox || !m.arc || m.grab) return null;
  const out = [], ext = m.ext || 0, pad = m.pad || 6;
  for (let f = m.s; f < m.s + m.a; f++) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const A = attackPose(id, m, f - 1), B = attackPose(id, m, f);
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      const P = { hip: lerp(A.hip, B.hip, t), lean: lerp(A.lean, B.lean, t), arm: lerp(A.arm, B.arm, t), sw: lerp(A.sw, B.sw, t), sheath: false };
      const j = joints(P);
      for (let q = 0.3; q <= 1.0001 + ext / BLADE; q += 0.1) {
        const x = j.nx + j.dx * BLADE * q, y = j.ny + j.dy * BLADE * q;
        if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
      }
    }
    out.push([Math.round(x0 - pad), Math.round(y0 - pad), Math.round(x1 - x0 + pad * 2), Math.round(y1 - y0 + pad * 2)]);
  }
  return out;
}
const API = { attackPose, joints, sweepBoxes, BLADE, ARM, TORSO };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else root.IssenPose = API;
})(typeof window !== 'undefined' ? window : globalThis);
