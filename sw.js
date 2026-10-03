const CACHE="pipeline-v7";
const CORE=["./","./index.html","./manifest.webmanifest","./icon-192.png?v=2","./icon-512.png?v=2","./apple-touch-icon.png?v=2","./favicon-48.png?v=2","./fincalc.js?v=3","./photoedit.js?v=1"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)));self.skipWaiting()});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=="GET"||u.origin!==location.origin)return;
  /* ukládá se jen skutečná odpověď webu – ne přesměrování na přihlášení (Cloudflare Access), jinak by se místo appky uložila přihlašovací stránka */
  const net=fetch(e.request).then(r=>{if(r.ok&&!r.redirected&&r.type==="basic"){const cp=r.clone();caches.open(CACHE).then(c=>c.put(e.request,cp))}return r});
  const timeout=new Promise((_,rej)=>setTimeout(()=>rej(new Error("timeout")),3500));
  e.respondWith(Promise.race([net,timeout]).catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||caches.match("./index.html"))));
});
