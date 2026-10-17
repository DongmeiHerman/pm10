// 两层注册表：书 → 关卡。只用相对路径，兼容 GitHub Pages 子路径与 Cloudflare Pages 根路径
const base = new URL('../', import.meta.url);
let cache;
export async function loadRegistry(){
  if(!cache){ const r = await fetch(new URL('levels/index.json', base)); cache = (await r.json()).books; }
  return cache;
}
export async function loadLevel(bookId, levelId){
  const dir = new URL(`levels/${bookId}/${levelId}/`, base);
  const meta = await (await fetch(new URL('level.json', dir))).json();
  let data = null;
  if(meta && meta.data) data = await (await fetch(new URL(meta.data, dir))).json();
  const mod = await import(new URL('level.js', dir).href);
  return { meta, data, mod, dir };
}
