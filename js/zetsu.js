/* =====================================================================
   一閃 絶の印
   絶の刀を持つ人の名前の横に「絶」の印を出す（番付・寄合・団体戦・対戦・名乗りの名前）。
   印の色はその人の印の刀の色（朱に持たせている絶、なければ新しい箱の絶。桜華=赤黒、八咫=黒地に白）。
   持ち主と印の刀はサーバーの zetsu_owners（supabase/save-data.sql）に聞く。SQL がまだなら何も出さない。
   ===================================================================== */
(function(){
  const N = window.IssenNet;
  const Z = { ids: new Set(), kats: new Map(), fns: new Set(), ok: true };
  const extra = new Set();
  let key = '', busy = null, again = false;
  Z.has = id => !!id && Z.ids.has(id);
  Z.kat = id => Z.kats.get(id) || 'ouka';   // その人の印の刀（前のSQLでは分からないので桜華の色）
  Z.mark = id => Z.has(id) ? '<span class="zmark z-' + Z.kat(id).replace(/[^a-z0-9_]/g, '') + '" title="絶の刀の持ち主">絶</span>' : '';
  Z.on = f => Z.fns.add(f);
  Z.refresh = async function(ids){
    (ids || []).forEach(i => { if (i) extra.add(i); });
    if (!N || !N.sb || !N.user || !Z.ok) return;
    if (busy) { again = true; return busy; }
    busy = (async () => {
      try {
        const want = [...extra].slice(-64);
        const { data, error } = await N.sb.rpc('zetsu_owners', { p_ids: want.length ? want : null });
        if (error) { if (error.code === 'PGRST202' || error.code === '42883') Z.ok = false; return; }
        // 今は { id: 刀 }、前の SQL は id の配列
        const kats = new Map(Array.isArray(data) ? data.map(i => [i, 'ouka']) : Object.entries(data || {}));
        const next = new Set(kats.keys());
        const changed = next.size !== Z.ids.size || [...next].some(i => !Z.ids.has(i) || Z.kats.get(i) !== kats.get(i));
        Z.ids = next; Z.kats = kats;
        if (changed) Z.fns.forEach(f => { try { f(); } catch (e) { console.error(e); } });
      } catch (e) {}
    })();
    await busy; busy = null;
    if (again) { again = false; return Z.refresh(); }
  };
  // ログインやフレンドが変わったら聞き直す
  if (N && N.on) N.on(() => {
    const k = N.user ? N.user.id + ':' + (N.friends || []).map(f => f.id).sort().join(',') : '';
    if (k === key) return; key = k;
    if (!N.user) { Z.ids = new Set(); Z.kats = new Map(); extra.clear(); return; }
    Z.refresh();
  });
  window.IssenZetsu = Z;
})();
