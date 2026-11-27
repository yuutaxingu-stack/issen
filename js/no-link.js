/* =====================================================================
   一閃: プレイヤーが書く文にリンク（URL・ドメイン）を入れさせない（2026-11-27）
   寄合・密書・名前・名乗りの一言・対戦中のひとこと で使う。
   サーバー側の同じ判定は supabase/schema.sql の public.has_link（ここと揃えること）。
   神様（運営アカウント）はサーバー側で通す。
   ===================================================================== */
(function(root){
  // よく使われる末尾（.com など）。ここに無いものも「ドメイン/」の形なら弾く
  const TLD = 'com|net|org|info|biz|jp|co|io|me|gg|tv|ly|to|cc|be|us|uk|ru|cn|kr|tw|hk|de|fr|eu|in|ai|so|gl|app|dev|xyz|link|site|online|top|club|shop|page|fun|live|vip|work|blog|store|tech|asia|mobi|pro|world|today|chat|social|moe|tokyo';
  const RE = new RegExp(
    '(https?|ftp)\\s?:\\s?/' +            // http:/ https:/
    '|:\\s?//' +                           // ://
    '|www\\s?\\.' +                        // www.
    '|[a-z0-9-]+\\s?[.。]\\s?(' + TLD + ')(?![a-z0-9])' +   // example.com / example。com
    '|[a-z0-9-]+\\.[a-z]{2,}/'             // example.something/
  );
  function norm(t){
    t = String(t == null ? '' : t);
    try { t = t.normalize('NFKC'); } catch (e) {}
    return t.toLowerCase();
  }
  const L = {
    has: t => RE.test(norm(t)),
    MSG: 'リンク（URL）は書き込めません'
  };
  root.IssenNoLink = L;
  if (typeof module !== 'undefined' && module.exports) module.exports = L;
})(typeof window !== 'undefined' ? window : globalThis);
