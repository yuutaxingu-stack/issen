/* オンライン機能の設定
   url と anonKey は Supabase の「Project Settings → API」にある値です。
   anonKey（publishable key）はゲームに書いて公開してよい鍵です。
   service_role（secret）key は絶対にここへ書かないでください。
   url が空のあいだは、オンライン機能は「準備中」と表示され、ほかの遊び方には影響しません。 */
window.ISSEN_ONLINE = {
  url: 'https://rqxlfhqdsxmifolqfnye.supabase.co',
  anonKey: 'sb_publishable_gcjzyB27fLT8pKg387xwGw_7mxLU5ok',
  // ログインIDをSupabaseの仕組みに合わせるための、内部だけで使う宛先（メールは送られません）
  emailDomain: 'players.issen.app'
};
