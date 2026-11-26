/* =====================================================================
   一閃 絶の印
   絶の刀を持つ人の名前の横に、赤黒い「絶」の印を出す（番付・寄合・団体戦・対戦の名前）。
   持ち主かどうかはサーバーの zetsu_owners（supabase/save-data.sql）に聞く。SQL がまだなら何も出さない。
   ===================================================================== */
(function(){
  const N = window.IssenNet;
  const Z = { ids: new Set(), fns: new Set(), ok: true };
  const extra = new Set();
  let key = '', busy = null, again = false;
  Z.has = id => !!id && Z.ids.has(id);
  Z.mark = id => Z.has(id) ? '<span class="zmark" title="絶の刀の持ち主">絶</span>' : '';
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
        const next = new Set(Array.isArray(data) ? data : []);
        const changed = next.size !== Z.ids.size || [...next].some(i => !Z.ids.has(i));
        Z.ids = next;
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
    if (!N.user) { Z.ids = new Set(); extra.clear(); return; }
    Z.refresh();
  });
  window.IssenZetsu = Z;
})();
