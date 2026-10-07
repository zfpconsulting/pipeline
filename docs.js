/* Soubory u klientů: přetáhneš PDF / obrázek / Word / tabulku na kartu klienta (nebo ho vybereš tlačítkem v detailu)
   a v detailu si ho jedním klepnutím otevřeš v rychlonáhledu.
   Docs.init({db,newId,toast,gfetch,token,demo})   db = stejné API jako LStore.api (collection/doc), gfetch = fetch s tokenem Googlu
   Docs.dropTarget(el,owner)  prvek přijme soubory přetažené z Finderu / Souborů;   owner = {ids:[…],primary,ensure,label} nebo funkce, která ho vrátí
   Docs.section(owner) / Docs.mount(box,owner)  sekce „Dokumenty“ v detailu (seznam, přidání, smazání, náhled)
   Docs.badge(owner)  malý štítek „sponka + počet“ na kartu;   Docs.preview(file,list)  rychlonáhled;   Docs.sync()  nahraje čekající soubory na Google Disk
   Ukládání: metadata = záznamy kolekce „files“ (synchronizují se jako všechno ostatní), obsah souboru = IndexedDB v zařízení
   + kopie ve složce „Pipeline – dokumenty“ na Google Disku (scope drive.file), aby byl soubor vidět i na druhém zařízení. */
(()=>{
"use strict";
const BASE=(()=>{try{return document.currentScript.src.replace(/[^/]*$/,"")}catch(e){return ""}})()||location.href.replace(/[^/]*$/,"");
const MAX=25*1024*1024, FOLDER="Pipeline – dokumenty", DRV="https://www.googleapis.com/drive/v3/files", UP="https://www.googleapis.com/upload/drive/v3/files";
let H=null, files=[], ready=false;
const subs=new Set(), live=new Set();

/* ---------- drobnosti ---------- */
const h=(tag,attrs={},...kids)=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(k==="class")e.className=v;else if(k.startsWith("on"))e.addEventListener(k.slice(2),v);else if(v!==undefined&&v!==null&&v!==false)e.setAttribute(k,v===true?"":v)}
  for(const k of kids.flat(3))if(k!=null&&k!==false)e.append(k.nodeType?k:document.createTextNode(String(k)));return e};
const toast=m=>{try{H&&H.toast&&H.toast(m)}catch(e){}};
const fmtSize=n=>n<1024?n+" B":n<1048576?Math.round(n/1024)+" kB":(Math.round(n/104857.6)/10).toString().replace(".",",")+" MB";
const fmtDay=iso=>{const d=new Date(iso);return isNaN(d)?"":d.getDate()+". "+(d.getMonth()+1)+". "+d.getFullYear()};
const ext=n=>(String(n).match(/\.([A-Za-z0-9]{1,6})$/)||[])[1]?.toLowerCase()||"";
const kindOf=(name,mime)=>{const x=ext(name),m=String(mime||"");
  if(m==="application/pdf"||x==="pdf")return"pdf";
  if(/^image\//.test(m)||/^(png|jpe?g|gif|webp|heic|heif|bmp|svg|avif)$/.test(x))return"img";
  if(x==="docx")return"docx";
  if(x==="xlsx"||x==="xlsm")return"xlsx";
  if(x==="csv"||x==="tsv")return"csv";
  if(/^(txt|md|log|json|xml)$/.test(x)||m==="text/plain")return"txt";
  return"other"};
const KIND={pdf:["PDF","var(--red)"],img:["FOTO","var(--orange)"],docx:["DOC","var(--tint)"],xlsx:["XLS","var(--green)"],csv:["CSV","var(--green)"],txt:["TXT","var(--gray)"],other:["",""]};
const tag=f=>{const k=kindOf(f.name,f.mime),x=ext(f.name).toUpperCase().slice(0,4);return k==="other"?[x||"SOUB","var(--gray)"]:KIND[k]};

/* ---------- úložiště obsahu: IndexedDB (když není, aspoň paměť) ---------- */
const mem=new Map();
const idb=(()=>{let p=null;
  const open=()=>p||(p=new Promise(res=>{try{const r=indexedDB.open("pp_docs",1);r.onupgradeneeded=()=>r.result.createObjectStore("blobs");r.onsuccess=()=>res(r.result);r.onerror=()=>res(null);r.onblocked=()=>res(null)}catch(e){res(null)}}));
  const run=(mode,fn)=>open().then(db=>new Promise(res=>{if(!db)return res({ok:false});try{const tx=db.transaction("blobs",mode),st=tx.objectStore("blobs"),rq=fn(st);let out;if(rq)rq.onsuccess=()=>{out=rq.result};tx.oncomplete=()=>res({ok:true,v:out});tx.onerror=tx.onabort=()=>res({ok:false})}catch(e){res({ok:false})}}));
  return{
    async get(id){const r=await run("readonly",s=>s.get(id));return r.ok?r.v||null:mem.get(id)||null},
    async put(id,blob){const r=await run("readwrite",s=>s.put(blob,id));if(!r.ok)mem.set(id,blob);return r.ok},
    async del(id){mem.delete(id);await run("readwrite",s=>s.delete(id))},
    async clear(){mem.clear();await run("readwrite",s=>s.clear())}}})();
/* smazání všeho lokálního (odhlášení / jiný účet): obsah souborů + zapamatovaná složka na Disku */
async function wipe(){try{localStorage.removeItem("pp_docs_folder")}catch(e){}try{await idb.clear()}catch(e){}}

/* ---------- seznam souborů ---------- */
const nameKey=s=>String(s||"").toLowerCase();
function filesFor(ids){const set=new Set((ids||[]).filter(Boolean));return files.filter(f=>set.has(f.owner)).sort((a,b)=>String(b.at||"").localeCompare(String(a.at||""))||nameKey(a.name).localeCompare(nameKey(b.name),"cs"))}
const resolve=o=>typeof o==="function"?o():o;
async function primaryOf(o){o=await resolve(o);if(!o)return null;return o.primary||(o.ensure?await o.ensure():null)||(o.ids||[])[0]||null}
function notify(){subs.forEach(f=>{try{f()}catch(e){console.error(e)}});[...live].forEach(f=>{if(!f())live.delete(f)})}

/* ---------- přidání / smazání ---------- */
async function add(owner,list){
  if(!H||!H.db)return 0;
  const o=await resolve(owner), prim=await primaryOf(o);
  if(!prim){toast("Soubor se nepodařilo přiřadit ke klientovi");return 0}
  const all=[...list||[]];let ok=0,big=0,empty=0;
  for(const f of all){
    if(!f.size){empty++;continue}
    if(f.size>MAX){big++;continue}
    const id=H.newId();
    try{
      await idb.put(id,f);
      await H.db.doc("files/"+id).set({owner:prim,name:f.name||"soubor",mime:f.type||"",size:f.size,at:new Date().toISOString(),drv:null});
      ok++;
    }catch(e){console.warn(e);await idb.del(id)}
  }
  const who=(o&&o.label)?" · "+o.label:"";
  if(ok)toast((ok===1?"Soubor přidán":"Přidáno "+ok+" "+(ok<5?"soubory":"souborů"))+who);
  if(big)toast("Soubor je větší než "+Math.round(MAX/1048576)+" MB – nepřidáno");
  else if(empty&&!ok)toast("Složky ani prázdné soubory nejdou přidat");
  if(ok)sync();
  return ok}
async function remove(f){
  try{await H.db.doc("files/"+f.id).delete()}catch(e){toast("Nepodařilo se smazat");return}
  await idb.del(f.id);
  if(f.drv&&H.token&&H.token()&&!H.demo)try{await H.gfetch(DRV+"/"+f.drv,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({trashed:true})})}catch(e){}
  toast("Soubor smazán")}

/* ---------- Google Disk ---------- */
let syncing=false, again=false;const failed=new Map();
const lsg=k=>{try{return localStorage.getItem(k)}catch(e){return null}}, lss=(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}};
async function folderId(){
  let id=lsg("pp_docs_folder");if(id)return id;
  const q=encodeURIComponent(`name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const r=await(await H.gfetch(`${DRV}?q=${q}&spaces=drive&fields=files(id)&pageSize=1`)).json();
  id=r.files&&r.files[0]&&r.files[0].id;
  if(!id)id=(await(await H.gfetch(DRV+"?fields=id",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:FOLDER,mimeType:"application/vnd.google-apps.folder"})})).json()).id;
  lss("pp_docs_folder",id);return id}
async function upload(f,blob){
  const parent=await folderId(), b="pp"+Math.random().toString(36).slice(2), mime=f.mime||blob.type||"application/octet-stream";
  const meta={name:f.name,parents:[parent],appProperties:{pp:f.id}};
  const body=new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${mime}\r\n\r\n`,blob,`\r\n--${b}--`]);
  const r=await(await H.gfetch(`${UP}?uploadType=multipart&fields=id`,{method:"POST",headers:{"Content-Type":"multipart/related; boundary="+b},body})).json();
  return r.id}
async function sync(){
  if(!H||!H.db||H.demo||!ready)return;
  if(syncing){again=true;return}
  if(!(H.token&&H.token())||(typeof navigator!=="undefined"&&navigator.onLine===false))return;
  syncing=true;
  try{
    for(const f of files.filter(x=>!x.drv&&(failed.get(x.id)||0)<3)){
      const blob=await idb.get(f.id);if(!blob)continue;   /* soubor je z jiného zařízení a ještě se nestáhl – nahrává ho to, kde vzniknul */
      try{const drv=await upload(f,blob);await H.db.doc("files/"+f.id).update({drv})}
      catch(e){failed.set(f.id,(failed.get(f.id)||0)+1);console.warn("Nahrání souboru selhalo",e);if(e&&e.code===404)try{localStorage.removeItem("pp_docs_folder")}catch(x){}if(e&&e.code===401)break}
    }
  }finally{syncing=false;if(again){again=false;setTimeout(sync,500)}}}
async function fetchBlob(f){
  const local=await idb.get(f.id);if(local)return local;
  if(!f.drv)throw new Error("Soubor ještě není nahraný – otevři ho na zařízení, kde vznikl.");
  if(!(H.token&&H.token()))throw new Error("Soubor je na Google Disku – přihlas se Googlem a otevři ho znovu.");
  if(typeof navigator!=="undefined"&&navigator.onLine===false)throw new Error("Jsi offline – soubor se stáhne, až budeš online.");
  let r;try{r=await H.gfetch(DRV+"/"+f.drv+"?alt=media")}catch(e){throw new Error(e&&e.code===404?"Soubor už na Google Disku není.":"Soubor se nepodařilo stáhnout z Google Disku.")}
  const blob=new Blob([await r.blob()],{type:f.mime||""});await idb.put(f.id,blob);return blob}

/* ---------- přetahování ---------- */
const isFileDrag=e=>{const t=e&&e.dataTransfer&&e.dataTransfer.types;return !!t&&[...t].includes("Files")};
function dropTarget(el,owner){
  if(!el)return;el._dcOwner=owner;if(el._dc)return;el._dc=1;let n=0;
  el.addEventListener("dragenter",e=>{if(!isFileDrag(e))return;e.preventDefault();e.stopPropagation();n++;el.classList.add("dc-over")});
  el.addEventListener("dragover",e=>{if(!isFileDrag(e))return;e.preventDefault();e.stopPropagation();try{e.dataTransfer.dropEffect="copy"}catch(x){}});
  el.addEventListener("dragleave",e=>{if(!isFileDrag(e))return;n=Math.max(0,n-1);if(!n)el.classList.remove("dc-over")});
  el.addEventListener("drop",e=>{if(!isFileDrag(e))return;e.preventDefault();e.stopPropagation();n=0;el.classList.remove("dc-over");add(el._dcOwner,e.dataTransfer.files)})}
function pick(owner){const i=h("input",{type:"file",multiple:true,hidden:true});i.addEventListener("change",()=>{const l=[...i.files];i.remove();if(l.length)add(owner,l)});i.addEventListener("cancel",()=>i.remove());document.body.append(i);i.click()}

/* ---------- styly ---------- */
const CSS=`
.dc-over{outline:2.5px dashed var(--tint,#007aff)!important;outline-offset:-2px;background-image:linear-gradient(var(--tint-soft,rgba(0,122,255,.12)),var(--tint-soft,rgba(0,122,255,.12)))!important}
.card.dc-over::after,.crow.dc-over::after,.scard.dc-over::after{content:"Pustit sem – přidá se ke klientovi";position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);padding:5px 12px;border-radius:999px;background:var(--tint,#007aff);color:#fff;font-size:12px;font-weight:600;white-space:nowrap;pointer-events:none;z-index:3}
.card.dc-over,.crow.dc-over,.scard.dc-over{position:relative}
.dc-tag{display:inline-flex;align-items:center;gap:3px}
.dc-tag svg{width:11px;height:11px}
.dc-row{cursor:pointer;-webkit-user-select:none;user-select:none}
.dc-row:focus-visible{outline:3px solid var(--tint-soft);outline-offset:-3px}
.dc-row:active{background:var(--fill2)}
.dc-ic{flex:none;width:38px;height:44px;border-radius:7px;background:var(--fill2);display:grid;place-items:center;font-size:10px;font-weight:700;letter-spacing:.02em;color:var(--ci,var(--gray));border:1.5px solid var(--ci,var(--gray))}
.dc-row .t{white-space:nowrap}
.dc-row .s{font-size:13px;color:var(--label2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dc-row .dc-x{flex:none;color:var(--red);font-size:14px;padding:6px 4px}
.dc-hint{padding:14px 16px;text-align:center;color:var(--label2);font-size:14px}
.dv{padding:0;border:none;width:min(1100px,100vw);height:min(94vh,100%);max-height:100%;border-radius:14px;background:var(--bg,#f2f2f7);color:var(--label,#000);overflow:hidden}
.dv[open]{display:flex;flex-direction:column}
.dv-bar{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px;padding:10px 14px;background:var(--bar-bg,rgba(242,242,247,.8));border-bottom:.5px solid var(--sep,rgba(60,60,67,.18));flex:none}
.dv-bar h2{margin:0;font-size:16px;font-weight:600;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dv-bar h2 small{display:block;font-size:12px;font-weight:400;color:var(--label2)}
.dv-bar button{color:var(--tint,#007aff);font-size:16px;padding:6px 4px;white-space:nowrap}
.dv-bar button:disabled{opacity:.3}
.dv-bar .dv-nav{display:flex;gap:4px;align-items:center}
.dv-bar .dv-r{display:flex;gap:10px;align-items:center;justify-content:flex-end}
.dv-bar .dv-ok{font-weight:600}
.dv-body{flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;align-items:center;padding:12px 8px 24px;gap:10px}
.dv-msg{margin:auto;text-align:center;color:var(--label2);max-width:340px;line-height:1.45;display:grid;gap:12px;justify-items:center}
.dv-msg b{color:var(--label)}
.dv-msg .chipbtn{display:inline-block}
.dv-img{max-width:100%;max-height:100%;object-fit:contain;margin:auto;border-radius:6px;background:var(--bg2,#fff)}
.dv-pg{display:block;flex:none;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.25);border-radius:2px;max-width:100%}
.dv-frame{flex:1;width:100%;min-height:60vh;border:0;background:#fff;border-radius:6px}
.dv-txt{align-self:stretch;margin:0;padding:12px 14px;background:var(--bg2,#fff);border-radius:10px;font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
.dv-tabs{display:flex;gap:6px;flex-wrap:wrap;align-self:stretch}
.dv-tabs button{background:var(--bg2,#fff);border-radius:999px;padding:5px 12px;font-size:13px;box-shadow:var(--card-shadow)}
.dv-tabs button[aria-selected="true"]{background:var(--tint,#007aff);color:#fff}
.dv-tbl{align-self:stretch;overflow-x:auto;background:var(--bg2,#fff);border-radius:10px;flex:none}
.dv-tbl table{border-collapse:collapse;font-size:13px;min-width:100%}
.dv-tbl td,.dv-tbl th{padding:5px 9px;border:.5px solid var(--sep,rgba(60,60,67,.18));white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis;text-align:left}
.dv-tbl th{background:var(--fill2);font-weight:600}
.dv-note{font-size:12px;color:var(--label2);align-self:stretch}
@media (max-width:640px){.dv{width:100vw;height:100%;border-radius:0}}
`;
function css(){if(document.getElementById("dcCss"))return;const s=document.createElement("style");s.id="dcCss";s.textContent=CSS;document.head.append(s)}

/* ---------- štítek na kartě ---------- */
const CLIP='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5l-8.6 8.6a5.5 5.5 0 01-7.8-7.8l8.9-8.9a3.7 3.7 0 115.2 5.2l-8.9 8.9a1.8 1.8 0 01-2.6-2.6l8.2-8.2"/></svg>';
function badge(owner){
  const o=resolve(owner);if(!o||typeof o.then==="function")return null;
  const n=filesFor(o.ids).length;if(!n)return null;
  const s=h("span",{class:"tag dc-tag",title:n+" "+(n===1?"soubor":n<5?"soubory":"souborů")});s.innerHTML=CLIP;s.append(String(n));return s}

/* ---------- rychlonáhled ---------- */
let dlg=null, cur=null;
function viewer(){
  if(dlg)return dlg;
  const d=h("dialog",{class:"dv","aria-label":"Náhled souboru"});
  const prev=h("button",{type:"button",class:"dv-prev","aria-label":"Předchozí soubor"},"‹"), next=h("button",{type:"button",class:"dv-next","aria-label":"Další soubor"},"›");
  const title=h("h2",{}), dl=h("button",{type:"button",class:"dv-dl"},"Stáhnout"), ok=h("button",{type:"button",class:"dv-ok"},"Hotovo");
  const body=h("div",{class:"dv-body"});
  d.append(h("div",{class:"dv-bar"},h("div",{class:"dv-nav"},prev,next),title,h("div",{class:"dv-r"},dl,ok)),body);
  Object.assign(d,{_t:title,_b:body,_prev:prev,_next:next,_dl:dl});
  ok.onclick=()=>d.close();
  prev.onclick=()=>step(-1);next.onclick=()=>step(1);dl.onclick=()=>cur&&download(cur);
  d.addEventListener("close",()=>{if(cur){cur.dead=true;cur.cleanup.forEach(f=>{try{f()}catch(e){}});cur=null}d._b.replaceChildren()});
  d.addEventListener("click",e=>{if(e.target===d)d.close()});
  d.addEventListener("keydown",e=>{
    if(e.target&&/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))return;
    if(e.key==="ArrowLeft"){e.preventDefault();e.stopPropagation();step(-1)}else if(e.key==="ArrowRight"){e.preventDefault();e.stopPropagation();step(1)}
    else if(e.key===" "&&!(e.target&&e.target.tagName==="BUTTON")){e.preventDefault();e.stopPropagation();d.close()}});
  document.body.append(d);dlg=d;return d}
const setSub=c=>{c.sub.textContent=[c.idx,...c.parts].filter(Boolean).join(" · ")};
function step(k){if(!cur)return;const i=cur.list.findIndex(x=>x.id===cur.f.id),n=cur.list[i+k];if(n)show(n,cur.list)}
async function download(c){
  try{const blob=await fetchBlob(c.f),file=new File([blob],c.f.name,{type:c.f.mime||blob.type});
    if(navigator.canShare&&navigator.canShare({files:[file]})&&matchMedia("(pointer:coarse)").matches){await navigator.share({files:[file]});return}
    const u=URL.createObjectURL(blob),a=h("a",{href:u,download:c.f.name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),30000)
  }catch(e){if(e&&e.name==="AbortError")return;toast(e&&e.message||"Nepodařilo se stáhnout")}}
const msg=(...kids)=>h("div",{class:"dv-msg"},...kids);
function preview(f,list){
  if(typeof f==="string")f=files.find(x=>x.id===f);if(!f)return;
  css();const d=viewer();
  show(f,list&&list.length?list:[f]);if(!d.open)d.showModal();
  d._b.tabIndex=-1;try{d._b.focus({preventScroll:true})}catch(e){}}
async function show(f,list){
  const d=viewer();
  if(cur){cur.dead=true;cur.cleanup.forEach(x=>{try{x()}catch(e){}})}
  const c=cur={f,list,dead:false,cleanup:[]}, kind=kindOf(f.name,f.mime), i=list.findIndex(x=>x.id===f.id);
  c.parts=[fmtSize(f.size),fmtDay(f.at)];c.idx=list.length>1?(i+1)+" / "+list.length:"";c.sub=h("small",{});d._t.replaceChildren(f.name,c.sub);setSub(c);
  d._prev.disabled=i<=0;d._next.disabled=i<0||i>=list.length-1;
  d._b.replaceChildren(msg("Načítám…"));d._b.scrollTop=0;
  let blob;
  try{blob=await fetchBlob(f)}catch(e){if(!c.dead)d._b.replaceChildren(msg(h("b",{},"Soubor se nepodařilo otevřít"),e&&e.message||""));return}
  if(c.dead)return;
  const put=(...n)=>{if(!c.dead)d._b.replaceChildren(...n)};
  const fallback=why=>put(msg(h("b",{},f.name),why||"Náhled tohoto typu souboru není k dispozici.",h("button",{type:"button",class:"chipbtn",onclick:()=>download(c)},"Stáhnout / otevřít v aplikaci")));
  try{
    if(kind==="img"){
      const u=URL.createObjectURL(blob);c.cleanup.push(()=>URL.revokeObjectURL(u));
      const im=h("img",{class:"dv-img",alt:f.name});im.onerror=()=>fallback("Tenhle prohlížeč tento formát obrázku nezobrazí.");im.src=u;put(im)}
    else if(kind==="pdf")await showPdf(c,blob,put,fallback);
    else if(kind==="docx")await showDocx(c,blob,put);
    else if(kind==="xlsx")await showXlsx(c,blob,put);
    else if(kind==="csv")put(...tables([{name:"",rows:parseCsv(await text(blob),f.name)}]));
    else if(kind==="txt"){const t=await text(blob);put(h("pre",{class:"dv-txt"},t.length>200000?t.slice(0,200000)+"\n…":t))}
    else fallback()
  }catch(e){console.warn("Náhled selhal",e);if(!c.dead)fallback("Soubor se nepodařilo zobrazit – zkus ho stáhnout.")}}

/* --- PDF (pdf.js, stránky se kreslí postupně podle posunu) --- */
let pdfLib=null;
function loadPdf(){return pdfLib||(pdfLib=import(BASE+"vendor/pdf.min.mjs").then(m=>{m.GlobalWorkerOptions.workerSrc=BASE+"vendor/pdf.worker.min.mjs";return m}).catch(e=>{pdfLib=null;throw e}))}
async function showPdf(c,blob,put,fallback){
  let lib,doc;
  try{lib=await loadPdf();doc=await lib.getDocument({data:new Uint8Array(await blob.arrayBuffer()),isEvalSupported:false,enableXfa:false}).promise}
  catch(e){console.warn("pdf.js",e);if(c.dead)return;
    const u=URL.createObjectURL(blob);c.cleanup.push(()=>URL.revokeObjectURL(u));put(h("iframe",{class:"dv-frame",src:u,title:c.f.name}));return}
  if(c.dead){doc.destroy();return}
  let io=null;
  c.cleanup.push(()=>{try{io&&io.disconnect()}catch(e){}try{doc.destroy()}catch(e){}});
  const body=dlg._b, first=await doc.getPage(1), v1=first.getViewport({scale:1});
  if(c.dead)return;
  const w=Math.min(Math.max(240,body.clientWidth-16),980), dpr=Math.min(window.devicePixelRatio||1,2);
  const pages=[];
  for(let n=1;n<=doc.numPages;n++){const cv=h("canvas",{class:"dv-pg"});cv.style.width=w+"px";cv.style.height=Math.round(w*v1.height/v1.width)+"px";cv.dataset.n=n;pages.push(cv)}
  io=new IntersectionObserver(es=>es.forEach(en=>{if(en.isIntersecting){io.unobserve(en.target);draw(en.target)}}),{root:body,rootMargin:"900px 0px"});
  async function draw(cv){
    try{const p=await doc.getPage(+cv.dataset.n),vp=p.getViewport({scale:1}),v=p.getViewport({scale:w/vp.width*dpr});
      cv.width=Math.floor(v.width);cv.height=Math.floor(v.height);cv.style.height=Math.round(w*vp.height/vp.width)+"px";
      await p.render({canvasContext:cv.getContext("2d"),viewport:v}).promise;cv.dataset.done="1"}catch(e){if(!c.dead)console.warn("Stránka PDF",e)}}
  put(...pages);pages.forEach(p=>io.observe(p));
  if(doc.numPages>1){c.parts.push(doc.numPages+" "+(doc.numPages<5?"strany":"stran"));setSub(c)}}

/* --- Word (.docx → HTML v izolovaném rámečku bez skriptů) --- */
const scripts=new Map();
function loadScript(src){if(!scripts.has(src))scripts.set(src,new Promise((res,rej)=>{const s=document.createElement("script");s.src=BASE+src;s.onload=res;s.onerror=()=>{scripts.delete(src);rej(new Error("nenačteno "+src))};document.head.append(s)}));return scripts.get(src)}
async function showDocx(c,blob,put){
  await loadScript("vendor/mammoth.browser.min.js");
  const r=await window.mammoth.convertToHtml({arrayBuffer:await blob.arrayBuffer()});
  const doc=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:15px/1.5 -apple-system,Calibri,Arial,sans-serif;color:#111;margin:0;padding:18px 20px;max-width:820px;margin:auto;overflow-wrap:anywhere}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:4px 8px}img{max-width:100%}a{color:#0a58ca}</style><base target="_blank">${r.value||"<p>(prázdný dokument)</p>"}`;
  put(h("iframe",{class:"dv-frame",sandbox:"",srcdoc:doc,title:c.f.name}))}

/* --- tabulky (.xlsx přes read-excel-file, .csv vlastním čtením) --- */
const LIM={rows:400,cols:40};
function cell(v){if(v==null)return"";if(v instanceof Date)return isNaN(v)?"":v.toLocaleDateString("cs-CZ");if(typeof v==="number")return String(v).replace(".",",");if(typeof v==="boolean")return v?"ANO":"NE";return String(v)}
function tables(sheets){
  const out=[],holder=h("div",{class:"dv-tbl"});let sel=0;
  const draw=()=>{const s=sheets[sel],rows=s.rows||[],cols=Math.min(LIM.cols,rows.reduce((m,r)=>Math.max(m,r.length),0));
    const t=h("table",{},h("tbody",{},...rows.slice(0,LIM.rows).map((r,ri)=>h("tr",{},...Array.from({length:cols},(_,ci)=>h(ri===0?"th":"td",{},cell(r[ci])))))));
    holder.replaceChildren(rows.length?t:h("div",{class:"dv-hint dc-hint"},"Prázdná tabulka"));
    note.textContent=rows.length>LIM.rows||rows.reduce((m,r)=>Math.max(m,r.length),0)>LIM.cols?"Zobrazeno prvních "+Math.min(rows.length,LIM.rows)+" řádků a "+cols+" sloupců – celý soubor si stáhni.":""};
  const note=h("div",{class:"dv-note"});
  if(sheets.length>1)out.push(h("div",{class:"dv-tabs",role:"tablist"},...sheets.map((s,i)=>h("button",{type:"button",role:"tab","aria-selected":String(i===0),onclick:e=>{sel=i;[...e.currentTarget.parentNode.children].forEach((b,j)=>b.setAttribute("aria-selected",String(j===i)));draw()}},s.name||"List "+(i+1)))));
  out.push(holder,note);draw();return out}
async function showXlsx(c,blob,put){
  await loadScript("vendor/read-excel-file.min.js");
  const r=await window.readXlsxFile(blob);
  const sheets=Array.isArray(r)&&r.length&&r[0]&&!Array.isArray(r[0])&&"data" in r[0]?r.map(s=>({name:s.sheet,rows:s.data})):[{name:"",rows:r}];
  put(...tables(sheets))}
async function text(blob){
  const buf=await blob.arrayBuffer();let t=new TextDecoder("utf-8").decode(buf);
  if(t.includes("�"))try{t=new TextDecoder("windows-1250").decode(buf)}catch(e){}
  return t.replace(/^﻿/,"")}
function parseCsv(t,name){
  const first=t.split(/\r?\n/,1)[0]||"", d=ext(name)==="tsv"?"\t":[";","\t",","].map(x=>[x,first.split(x).length]).sort((a,b)=>b[1]-a[1])[0][0];
  const rows=[];let row=[],f="",q=false;
  for(let i=0;i<t.length;i++){const ch=t[i];
    if(q){if(ch==='"'){if(t[i+1]==='"'){f+='"';i++}else q=false}else f+=ch}
    else if(ch==='"')q=true;
    else if(ch===d){row.push(f);f=""}
    else if(ch==="\n"||ch==="\r"){if(ch==="\r"&&t[i+1]==="\n")i++;row.push(f);f="";rows.push(row);row=[];if(rows.length>LIM.rows+50)break}
    else f+=ch}
  if(f!==""||row.length){row.push(f);rows.push(row)}
  return rows.filter(r=>r.some(x=>x!==""))}

/* ---------- sekce „Dokumenty“ v detailu ---------- */
function section(owner){
  css();
  const box=h("div",{class:"fg dc-sec"});mount(box,owner);return box}
function mount(box,owner){
  css();box.classList.add("dc-sec");box._sure=null;if(box._draw)live.delete(box._draw);
  const draw=()=>{
    if(!box.isConnected&&box._seen)return false;
    if(box.isConnected)box._seen=true;
    const o=resolve(owner)||{ids:[]}, list=filesFor(o.ids), sure=box._sure;
    const rows=list.map(f=>{const[t,col]=tag(f),k=f.id;
      const st=!f.drv?(H&&H.demo?"jen v tomto zařízení":"nahrává se…"):"";
      const row=h("div",{class:"row dc-row",role:"button",tabindex:"0","aria-label":"Otevřít "+f.name,onclick:e=>{if(e.target.closest(".dc-x"))return;preview(f,list)},
        onkeydown:e=>{if(e.target!==row)return;if(e.key==="Enter"||e.key===" "){e.preventDefault();preview(f,list)}}},
        h("span",{class:"dc-ic",style:"--ci:"+col},t),
        h("span",{class:"main"},h("div",{class:"t"},f.name),h("div",{class:"s"},[fmtSize(f.size),fmtDay(f.at),st].filter(Boolean).join(" · "))),
        h("button",{type:"button",class:"dc-x","aria-label":"Smazat "+f.name,onclick:async e=>{e.stopPropagation();if(box._sure!==k){box._sure=k;draw();return}box._sure=null;await remove(f)}},sure===k?"Opravdu smazat?":"Smazat"));
      return row});
    const drop=h("div",{class:"dc-hint"},rows.length?"Další soubor přetáhni sem nebo ":"Přetáhni sem PDF, fotku, Word nebo tabulku – nebo ");
    drop.append(h("button",{type:"button",class:"chipbtn",style:"margin-left:4px",onclick:()=>pick(owner)},"vyber soubor"));
    box.replaceChildren(h("div",{class:"sechead-row"},h("h3",{class:"sechead"},"Dokumenty"+(list.length?" · "+list.length:""))),
      h("div",{class:"group"},...rows,rows.length?h("div",{class:"row",style:"justify-content:center;min-height:0;padding:8px 16px"},drop):h("div",{style:"padding:6px 0"},drop)));
    return true};
  dropTarget(box,owner);
  box._draw=draw;live.add(draw);draw()}

/* ---------- start ---------- */
let inited=false;
function init(host){
  if(inited)return;H=host;css();
  if(!H||!H.db)return;inited=true;
  H.db.collection("files").onSnapshot(s=>{files=s.docs.map(d=>({id:d.id,...d.data()}));const first=!ready;ready=true;notify();if(first)setTimeout(sync,4000)});
  /* soubor puštěný mimo kartu by prohlížeč otevřel místo appky – zachytíme ho a poradíme, kam ho pustit */
  addEventListener("dragover",e=>{if(isFileDrag(e)){e.preventDefault();try{e.dataTransfer.dropEffect="none"}catch(x){}}});
  addEventListener("drop",e=>{if(isFileDrag(e)){e.preventDefault();toast("Pusť soubor přímo na kartu klienta")}});
  addEventListener("online",()=>setTimeout(sync,1500))}

window.Docs={init,dropTarget,section,mount,badge,preview,sync,add,wipe,isFileDrag,filesFor,count:o=>filesFor((resolve(o)||{}).ids).length,
  onChange(f){subs.add(f);return()=>subs.delete(f)},_t:{kindOf,parseCsv,fmtSize,idb,get files(){return files}}};
})();
