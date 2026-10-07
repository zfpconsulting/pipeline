// Testy souborů u klientů (docs.js) v Chromiu – nepotřebují PP_KEY. Použití: node tests/docs.run.mjs [filtr]
// Harness = prázdná stránka s kartou jako v pipeline, paměťové úložiště se stejným API jako LStore.api a falešný Google Disk.
import { readFileSync } from "node:fs";
import { loadPlaywright, startServer, assert, eq } from "./helpers.mjs";

const filter = process.argv[2] || "";
const { chromium } = await loadPlaywright();
const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
const { srv, url } = await startServer();
const base = url.replace(/index\.html$/, "");

async function open({ width = 1300, height = 900, token = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  if (process.env.DEBUG) page.on("console", m => console.log("    [stránka]", m.type(), m.text().slice(0, 240)));
  await page.route(base + "harness.html", r => r.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="cs"><head><meta charset="utf-8">
    <style>:root{--bg:#F2F2F7;--bg2:#fff;--fill:rgba(120,120,128,.12);--fill2:rgba(120,120,128,.08);--label:#000;--label2:rgba(60,60,67,.6);--sep:rgba(60,60,67,.18);--tint:#007AFF;--tint-soft:rgba(0,122,255,.12);--red:#FF3B30;--green:#34C759;--orange:#FF9500;--gray:#8E8E93;--r:12px;--card-shadow:0 1px 2px rgba(0,0,0,.04);--bar-bg:rgba(242,242,247,.8)}
    body{background:var(--bg);margin:0;padding:16px;font-family:-apple-system,system-ui,sans-serif;color:var(--label)}
    .group{background:var(--bg2);border-radius:12px;overflow:hidden}.row{display:flex;align-items:center;gap:12px;padding:11px 16px;position:relative;min-height:44px}.row .main{flex:1;min-width:0}
    .sechead{font-size:13px;color:var(--label2);text-transform:uppercase;margin:0 16px 7px;font-weight:400}.chipbtn{background:var(--bg2);border-radius:999px;padding:7px 13px;font-size:14px;color:var(--tint)}
    .card{background:var(--bg2);border-radius:12px;padding:12px 14px;width:260px;display:grid;gap:8px}.tags{display:flex;gap:4px;min-height:18px}.tag{font-size:12px;padding:2px 8px;border-radius:6px;background:var(--fill2)}
    #col{padding:20px;background:#ddd;width:320px}button{font:inherit;background:none;border:0;cursor:pointer}</style></head>
    <body><section id="col"><article class="card" id="card" data-id="l1"><div class="name">Jan Novák</div><div class="tags"></div></article></section>
    <div id="detail" style="margin-top:24px;width:480px"></div>
    <script src="docs.js"></script>
    <script>
    const docs={},subs=new Set(),emit=()=>[...subs].forEach(f=>f());
    const store={collection:name=>({onSnapshot(cb){const f=()=>cb({docs:Object.entries(docs).filter(([k])=>k.startsWith(name+"/")).map(([k,v])=>({id:k.split("/")[1],data:()=>v}))});subs.add(f);queueMicrotask(f)}}),
      doc:p=>({async set(d){docs[p]={...d};emit()},async update(d){if(!docs[p])throw new Error("neexistuje");docs[p]={...docs[p],...d};emit()},async delete(){delete docs[p];emit()}})};
    /* falešný Google Disk */
    window.drive={files:new Map(),folder:false,calls:[]};window.tok=${JSON.stringify(token)};let seq=0;
    const u8=async b=>new Uint8Array(await b.arrayBuffer()),find=(a,s,from=0)=>{outer:for(let i=from;i<=a.length-s.length;i++){for(let j=0;j<s.length;j++)if(a[i+j]!==s.charCodeAt(j))continue outer;return i}return -1};
    window.gfetch=async(url,opt={})=>{
      if(!tok)throw Object.assign(new Error("nepřihlášeno"),{code:401});
      const m=opt.method||"GET";drive.calls.push({m,url});const json=o=>new Response(JSON.stringify(o),{status:200,headers:{"Content-Type":"application/json"}});
      if(url.includes("/upload/drive/v3/files")){const a=await u8(opt.body),bd=/boundary=(\\S+)/.exec(opt.headers["Content-Type"])[1],dec=x=>new TextDecoder().decode(x);
        const i1=find(a,"\\r\\n\\r\\n"),m1=find(a,"\\r\\n--"+bd,i1),i2=find(a,"\\r\\n\\r\\n",m1),end=a.length-("\\r\\n--"+bd+"--").length;
        const id="drv"+(++seq);drive.files.set(id,{meta:JSON.parse(dec(a.slice(i1+4,m1))),data:a.slice(i2+4,end),ctype:/Content-Type: ([^\\r]+)/.exec(dec(a.slice(m1,i2)))?.[1]});return json({id})}
      if(/alt=media/.test(url)){const f=drive.files.get(/files\\/([^?]+)/.exec(url)[1]);if(!f)throw Object.assign(new Error("Google 404"),{code:404});return new Response(new Blob([f.data],{type:f.ctype||""}))}
      if(m==="PATCH"){const f=drive.files.get(/files\\/([^?]+)/.exec(url)[1]);if(f)f.trashed=true;return json({})}
      if(m==="POST"){drive.folder=true;return json({id:"fld1"})}
      return json({files:drive.folder?[{id:"fld1"}]:[]})};
    window.owner={ids:["l:l1","c:c1"],primary:"c:c1",label:"Jan Novák"};
    window.toasts=[];window.colEv={over:0,drop:0};
    const col=document.getElementById("col");col.addEventListener("dragover",()=>colEv.over++);col.addEventListener("drop",()=>colEv.drop++);
    Docs.init({db:store,newId:()=>"f"+(++seq)+Date.now().toString(36),toast:m=>toasts.push(m),gfetch,token:()=>tok,demo:false});
    const card=document.getElementById("card");Docs.dropTarget(card,owner);
    const paint=()=>{const b=Docs.badge(owner),t=card.querySelector(".tags");t.replaceChildren(...(b?[b]:[]))};Docs.onChange(paint);paint();
    document.getElementById("detail").append(Docs.section(owner));
    window.docsStore=docs;window.emit=emit;window.ready=true;
    </script></body></html>` }));
  await page.goto(base + "harness.html");
  await page.waitForFunction(() => window.ready);
  return { ctx, page, errors };
}

/* soubor z tests/fixtures připravit v prohlížeči jako File */
const load = (page, name, mime) => page.evaluate(async ([u, name, mime]) => {
  const b = await (await fetch(u)).blob(); (window.__f ||= {})[name] = new File([b], name, { type: mime }); return b.size;
}, [base + "tests/fixtures/" + name, name, mime]);
const drop = (page, sel, names) => page.evaluate(([sel, names]) => {
  const el = document.querySelector(sel), dt = new DataTransfer(); names.forEach(n => dt.items.add(window.__f[n]));
  const ev = t => new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true });
  el.dispatchEvent(ev("dragenter")); const over = el.classList.contains("dc-over");
  const o = ev("dragover"); el.dispatchEvent(o); const d = ev("drop"); el.dispatchEvent(d);
  return { over, overPrevented: o.defaultPrevented, dropPrevented: d.defaultPrevented, overAfter: el.classList.contains("dc-over") };
}, [sel, names]);
const files = page => page.evaluate(() => Object.entries(docsStore).map(([k, v]) => ({ id: k.split("/")[1], ...v })));
const waitFiles = (page, n, ids = ["c:c1", "l:l1"]) => page.waitForFunction(([n, ids]) => Docs.count({ ids }) === n, [n, ids]);
const MIME = { "ukazka.pdf": "application/pdf", "ukazka.docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "ukazka.xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "ukazka.csv": "text/csv", "ukazka-1250.csv": "text/csv", "foto.png": "image/png", "export.numbers": "" };
const prep = async (page, ...names) => { for (const n of names) await load(page, n, MIME[n]); };
const rowOf = (page, name) => page.locator(".dc-row", { hasText: name });

const tests = {
  async "druh souboru a čtení CSV"() {
    const { ctx, page } = await open();
    const r = await page.evaluate(() => {
      const { kindOf, parseCsv, fmtSize } = Docs._t;
      return { k: [["a.PDF", ""], ["x", "image/heic"], ["a.docx", ""], ["a.doc", ""], ["a.xlsx", ""], ["a.numbers", ""], ["a.csv", ""], ["a.txt", ""]].map(([n, m]) => kindOf(n, m)),
        csv: parseCsv('a;b;c\n1;"x;y";"he said ""hi"""\r\n\r\n2;;3', "x.csv"), tsv: parseCsv("a\tb\n1\t2", "x.tsv"), comma: parseCsv("a,b\n1,2", "x.csv"), sz: [fmtSize(900), fmtSize(2048), fmtSize(5.5 * 1048576)] };
    });
    eq(r.k, ["pdf", "img", "docx", "other", "xlsx", "other", "csv", "txt"], "druhy");
    eq(r.csv, [["a", "b", "c"], ["1", "x;y", 'he said "hi"'], ["2", "", "3"]], "csv s uvozovkami");
    eq(r.tsv, [["a", "b"], ["1", "2"]], "tsv"); eq(r.comma, [["a", "b"], ["1", "2"]], "csv s čárkou");
    eq(r.sz, ["900 B", "2 kB", "5,5 MB"], "velikosti");
    await ctx.close();
  },

  async "přetažení souborů na kartu: uloží se ke klientovi, štítek s počtem, sloupec o tom neví"() {
    const { ctx, page, errors } = await open();
    await prep(page, "ukazka.pdf", "foto.png");
    const r = await drop(page, "#card", ["ukazka.pdf", "foto.png"]);
    assert(r.over, "karta se při přetahování zvýrazní"); assert(r.overPrevented && r.dropPrevented, "dragover i drop jsou zachycené"); assert(!r.overAfter, "zvýraznění po puštění zmizí");
    await waitFiles(page, 2);
    const fs = await files(page);
    eq(fs.map(f => f.owner), ["c:c1", "c:c1"], "soubory patří klientovi (primary)");
    eq(fs.map(f => f.name).sort(), ["foto.png", "ukazka.pdf"], "jména");
    assert(fs.every(f => f.size > 0 && f.drv === null), "velikost a zatím nenahráno na Disk");
    assert(await page.evaluate(() => Docs._t.idb.get(docsStore && Object.keys(docsStore)[0].split("/")[1]).then(b => !!b && b.size > 0)), "obsah je v IndexedDB");
    eq(await page.locator("#card .dc-tag").textContent(), "2", "štítek na kartě");
    eq(await page.evaluate(() => colEv), { over: 0, drop: 0 }, "sloupec nedostal soubory (patří kartě)");
    assert(await page.evaluate(() => toasts.some(t => /Přidáno 2 soubory.*Jan Novák/.test(t))), "toast");
    eq(errors, [], "chyby stránky");
    await ctx.close();
  },

  async "jen soubory: obyčejné přetažení (text) kartou neprojde, soubor mimo kartu se zahodí s poradou"() {
    const { ctx, page } = await open();
    const t = await page.evaluate(() => { const dt = new DataTransfer(); dt.setData("text/plain", "l1"); const e = new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }); document.getElementById("card").dispatchEvent(e); return { prevented: e.defaultPrevented, col: colEv.over }; });
    eq(t, { prevented: false, col: 1 }, "přesun karty mezi sloupci zůstává věcí sloupce");
    await prep(page, "ukazka.pdf");
    const out = await page.evaluate(() => { const dt = new DataTransfer(); dt.items.add(__f["ukazka.pdf"]); const o = new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }); document.body.dispatchEvent(o);
      const d = new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }); document.body.dispatchEvent(d); return { o: o.defaultPrevented, d: d.defaultPrevented, effect: dt.dropEffect, toast: toasts.slice(-1)[0] }; });
    assert(out.o && out.d, "prohlížeč soubor v appce neotevře (jinak by appka zmizela)"); eq(out.effect, "none", "kurzor ukáže, že tady to nejde"); assert(/na kartu klienta/.test(out.toast), "rada: " + out.toast);
    eq((await files(page)).length, 0, "nic se neuložilo");
    await ctx.close();
  },

  async "sekce Dokumenty: seznam, sjednocení vlastníků (lead + klient), mazání na dvě klepnutí"() {
    const { ctx, page } = await open();
    await prep(page, "ukazka.pdf", "ukazka.csv");
    await page.evaluate(() => { const d = docsStore; d["files/x1"] = { owner: "l:l1", name: "z-leadu.txt", mime: "text/plain", size: 10, at: "2026-10-01T10:00:00Z", drv: "d1" }; d["files/x2"] = { owner: "c:other", name: "cizi.pdf", mime: "application/pdf", size: 5, at: "2026-10-01T10:00:00Z", drv: "d2" }; emit(); });
    await drop(page, "#card", ["ukazka.pdf", "ukazka.csv"]);
    await waitFiles(page, 3);
    const names = await page.$$eval(".dc-row .t", ts => ts.map(t => t.textContent));
    eq(names.sort(), ["ukazka.csv", "ukazka.pdf", "z-leadu.txt"], "vidí soubory klienta i leadu, ne cizí");
    assert(/Dokumenty · 3/.test(await page.locator(".dc-sec .sechead").textContent()), "nadpis s počtem");
    await rowOf(page, "ukazka.csv").locator(".dc-x").click();
    eq((await files(page)).length, 4, "první klepnutí jen ptá (nic nemaže)");
    assert(/Opravdu/.test(await rowOf(page, "ukazka.csv").locator(".dc-x").textContent()), "ptá se");
    const id = (await files(page)).find(f => f.name === "ukazka.csv").id;
    await rowOf(page, "ukazka.csv").locator(".dc-x").click();
    await waitFiles(page, 2);
    eq(await page.evaluate(id => Docs._t.idb.get(id), id), null, "smazán i obsah v zařízení");
    await ctx.close();
  },

  async "náhled PDF: stránky se kreslí postupně a mají obsah"() {
    const { ctx, page, errors } = await open();
    await prep(page, "ukazka.pdf"); await drop(page, "#card", ["ukazka.pdf"]); await waitFiles(page, 1);
    await rowOf(page, "ukazka.pdf").click();
    await page.waitForSelector(".dv[open] canvas.dv-pg[data-done='1']", { timeout: 20000 });
    eq(await page.locator(".dv-pg").count(), 3, "3 stránky");
    assert(/ukazka\.pdf/.test(await page.locator(".dv-bar h2").textContent()) && /3 strany/.test(await page.locator(".dv-bar h2 small").textContent()), "záhlaví: " + await page.locator(".dv-bar h2").textContent());
    const px = await page.evaluate(() => { const c = document.querySelector(".dv-pg[data-done='1']"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let blue = 0, dark = 0; for (let i = 0; i < d.length; i += 4) { if (d[i + 2] > 200 && d[i] < 60) blue++; if (d[i] < 60 && d[i + 1] < 60 && d[i + 2] < 60) dark++ } return { blue, dark, w: c.width }; });
    assert(px.blue > 1000 && px.dark > 200, "stránka je skutečně vykreslená: " + JSON.stringify(px));
    const before = await page.locator(".dv-pg[data-done='1']").count();
    await page.evaluate(() => { const b = document.querySelector(".dv-body"); b.scrollTop = b.scrollHeight });
    await page.waitForFunction(() => document.querySelectorAll(".dv-pg[data-done='1']").length === 3, null, { timeout: 15000 });
    assert(before < 3, "třetí stránka se nekreslí předem (kreslilo se " + before + ")");
    await page.keyboard.press("Space"); await page.waitForFunction(() => !document.querySelector(".dv[open]"));
    eq(errors, [], "chyby stránky");
    await ctx.close();
  },

  async "náhled Wordu: text i tabulka v izolovaném rámečku bez skriptů"() {
    const { ctx, page } = await open();
    await prep(page, "ukazka.docx"); await drop(page, "#card", ["ukazka.docx"]); await waitFiles(page, 1);
    await rowOf(page, "ukazka.docx").click();
    await page.waitForSelector(".dv[open] iframe.dv-frame", { timeout: 15000 });
    const fr = page.frameLocator(".dv-frame");
    await fr.locator("h1").waitFor(); eq(await fr.locator("h1").textContent(), "Ukázková smlouva", "nadpis");
    assert(/1 500 Kč/.test(await fr.locator("p").first().textContent()), "odstavec"); eq(await fr.locator("td").count(), 4, "tabulka");
    eq(await page.locator(".dv-frame").getAttribute("sandbox"), "", "rámeček je izolovaný (žádné skripty, žádný přístup k appce)");
    await ctx.close();
  },

  async "náhled Excelu: hodnoty, datum, přepínání listů; CSV (středník, windows-1250)"() {
    const { ctx, page } = await open();
    await prep(page, "ukazka.xlsx", "ukazka.csv", "ukazka-1250.csv"); await drop(page, "#card", ["ukazka.xlsx", "ukazka.csv", "ukazka-1250.csv"]); await waitFiles(page, 3);
    await rowOf(page, "ukazka.xlsx").click();
    await page.waitForSelector(".dv[open] .dv-tbl td", { timeout: 15000 });
    const grid = () => page.$$eval(".dv-tbl tr", rs => rs.map(r => [...r.children].map(c => c.textContent)));
    eq(await grid(), [["Položka", "Částka", "Datum"], ["Nájem", "15000,5", "1. 10. 2026"], ["Jídlo", "8000", "2. 10. 2026"]], "první list");
    await page.locator(".dv-tabs button", { hasText: "Cíle" }).click();
    eq(await grid(), [["Cíl", "Termín"], ["Byt", "2030"]], "druhý list");
    await page.keyboard.press("Escape");
    await rowOf(page, "ukazka.csv").first().click();
    await page.waitForSelector(".dv[open] .dv-tbl td");
    eq((await grid())[1], ["Novák Jan", "777 123 456", "volat po 17. hodině; ať zavolá"], "csv se středníkem a uvozovkami");
    await page.keyboard.press("Escape");
    await rowOf(page, "ukazka-1250.csv").click();
    await page.waitForSelector(".dv[open] .dv-tbl td");
    eq((await grid())[1], ["Žofie Řezníčková", "Říčany"], "windows-1250");
    await ctx.close();
  },

  async "náhled obrázku, neznámého typu, listování šipkami"() {
    const { ctx, page } = await open();
    await prep(page, "foto.png", "export.numbers", "ukazka.csv");
    await drop(page, "#card", ["foto.png", "export.numbers", "ukazka.csv"]); await waitFiles(page, 3);
    await rowOf(page, "foto.png").click();
    await page.waitForSelector(".dv[open] img.dv-img");
    assert(await page.evaluate(() => { const i = document.querySelector(".dv-img"); return i.complete && i.naturalWidth === 64 }), "obrázek se načetl");
    const names = await page.$$eval(".dc-row .t", ts => ts.map(t => t.textContent));   /* seznam je od nejnovějšího */
    const i = names.indexOf("foto.png");
    assert(await page.locator(".dv-bar h2 small").textContent().then(t => t.includes((i + 1) + " / 3")), "pořadí v záhlaví");
    const go = async key => { await page.keyboard.press(key); await page.waitForTimeout(150) };
    for (let k = 0; k < 4; k++) await go("ArrowRight");
    const last = await page.locator(".dv-bar h2").evaluate(h => h.firstChild.textContent);
    eq(last, names[2], "šipka doprava dojde na poslední a tam se zastaví");
    await go("ArrowLeft"); await go("ArrowLeft");
    eq(await page.locator(".dv-bar h2").evaluate(h => h.firstChild.textContent), names[0], "šipky listují");
    await page.keyboard.press("Escape");
    await rowOf(page, "export.numbers").click();
    await page.waitForSelector(".dv[open] .dv-msg .chipbtn");
    assert(/Náhled tohoto typu/.test(await page.locator(".dv-msg").textContent()), "neznámý typ nabídne stažení");
    await ctx.close();
  },

  async "limit velikosti a prázdné soubory"() {
    const { ctx, page } = await open();
    await page.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(26 * 1024 * 1024)], "velky.pdf", { type: "application/pdf" })); dt.items.add(new File([], "slozka", { type: "" }));
      document.getElementById("card").dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true })) });
    await page.waitForFunction(() => toasts.some(t => /větší než 25 MB/.test(t)));
    eq((await files(page)).length, 0, "nic se neuložilo");
    await ctx.close();
  },

  async "Google Disk: nahraje se do složky, po smazání do koše, na jiném zařízení se stáhne"() {
    const { ctx, page } = await open({ token: "tok" });
    await prep(page, "ukazka.pdf"); await drop(page, "#card", ["ukazka.pdf"]);
    await page.waitForFunction(() => Object.values(docsStore)[0]?.drv, null, { timeout: 15000 });
    const up = await page.evaluate(() => { const [[id, f]] = [...drive.files]; return { id, meta: f.meta, size: f.data.length, ctype: f.ctype, folder: drive.folder } });
    eq(up.meta.name, "ukazka.pdf", "název na Disku"); eq(up.meta.parents, ["fld1"], "ve složce Pipeline – dokumenty"); eq(up.ctype, "application/pdf", "typ");
    assert(up.size === 2571, "na Disk dorazil celý soubor (" + up.size + " B)");
    eq(await page.evaluate(() => localStorage.getItem("pp_docs_folder")), "fld1", "složka se příště nehledá");
    /* jiné zařízení: metadata jsou, obsah ne */
    const id = (await files(page))[0].id;
    await page.evaluate(id => Docs._t.idb.del(id), id);
    await rowOf(page, "ukazka.pdf").click();
    await page.waitForSelector(".dv[open] canvas.dv-pg[data-done='1']", { timeout: 20000 });
    assert(await page.evaluate(id => Docs._t.idb.get(id).then(b => !!b && b.size === 2571), id), "stažený soubor se uložil do zařízení");
    await page.keyboard.press("Escape");
    await rowOf(page, "ukazka.pdf").locator(".dc-x").click(); await rowOf(page, "ukazka.pdf").locator(".dc-x").click();
    await page.waitForFunction(() => [...drive.files.values()][0]?.trashed === true, null, { timeout: 10000 });
    await ctx.close();
  },

  async "bez přihlášení se nic nenahrává a soubor jde otevřít; cizí soubor bez Disku se vysvětlí"() {
    const { ctx, page } = await open();
    await prep(page, "foto.png"); await drop(page, "#card", ["foto.png"]); await waitFiles(page, 1);
    await page.waitForTimeout(300);
    eq(await page.evaluate(() => drive.calls.length), 0, "žádné volání Googlu");
    assert(/nahrává se/.test(await rowOf(page, "foto.png").textContent()), "stav v seznamu");
    await rowOf(page, "foto.png").click(); await page.waitForSelector(".dv[open] img.dv-img");
    await page.keyboard.press("Escape");
    await page.evaluate(() => { docsStore["files/z9"] = { owner: "c:c1", name: "z-iphonu.pdf", mime: "application/pdf", size: 100, at: "2026-10-07T10:00:00Z", drv: "drvX" }; emit(); });
    await page.evaluate(() => Docs.preview("z9"));
    await page.waitForFunction(() => /přihlas se Googlem/.test(document.querySelector(".dv-msg")?.textContent || ""));
    await ctx.close();
  },

  async "odhlášení: obsah souborů i zapamatovaná složka se smažou"() {
    const { ctx, page } = await open({ token: "tok" });
    await prep(page, "ukazka.pdf"); await drop(page, "#card", ["ukazka.pdf"]);
    await page.waitForFunction(() => Object.values(docsStore)[0]?.drv, null, { timeout: 15000 });
    const id = (await files(page))[0].id;
    assert(await page.evaluate(id => Docs._t.idb.get(id).then(b => !!b), id), "obsah je v zařízení");
    await page.evaluate(() => Docs.wipe());
    assert(await page.evaluate(id => Docs._t.idb.get(id).then(b => !b), id), "obsah je pryč");
    eq(await page.evaluate(() => localStorage.getItem("pp_docs_folder")), null, "složka se zapomněla");
    await ctx.close();
  },

  async "klávesnice: Enter v seznamu otevře náhled, Hotovo zavře"() {
    const { ctx, page } = await open();
    await prep(page, "foto.png"); await drop(page, "#card", ["foto.png"]); await waitFiles(page, 1);
    await rowOf(page, "foto.png").focus(); await page.keyboard.press("Enter");
    await page.waitForSelector(".dv[open] img.dv-img");
    await page.locator(".dv-ok").click(); await page.waitForFunction(() => !document.querySelector(".dv[open]"));
    eq(await page.locator(".dv-body").evaluate(b => b.children.length), 0, "po zavření se obsah uklidí");
    await ctx.close();
  },

  /* skutečný kód napojení z index.html (vlastníci souborů, řádky klientů) spuštěný nad skutečným docs.js;
     celá appka bez přístupového kódu nenaběhne, proto se tu kontroluje, že je napojení na svých místech, a vlastní funkce se spustí zvlášť */
  async "napojení v index.html: umístění a funkce vlastníků souborů"() {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    for (const [re, what] of [
      [/<script src="docs\.js\?v=\d+" defer><\/script>/, "načtení docs.js"], [/id="docsBox"/, "kontejner v detailu leadu"],
      [/Docs\.mount\(b,docOwnerLead\(l\)\)/, "sekce v detailu leadu"], [/Docs\.section\(docOwnerClient\(e,true\)\)/, "sekce v detailu klienta"], [/\n    docSection\(e\),/, "sekce zapojená v detailu klienta"],
      [/Docs\.dropTarget\(c,ow\)/, "karta v pipeline"], [/docDecor\(e,el\("button",\{type:"button",class:"row row-btn crow"/, "řádek v seznamu klientů"],
      [/return docDecor\(e,el\("article",\{class:"scard"/, "karta servisu"], [/Docs\.init\(\{db,newId,toast,gfetch,token/, "start modulu"],
      [/status\("ok"\);try\{window\.Docs&&Docs\.sync\(\)/, "nahrání souborů po synchronizaci"], [/Docs\.isFileDrag\(e\)\)return;e\.preventDefault\(\);col\.classList\.add\("drop"\)/, "sloupce pipeline soubory přeskakují"],
      [/function wipeLocal\(\)\{[^]*?Docs\.wipe\(\)/, "mazání souborů při odhlášení / jiném účtu"], [/const w=wipeLocal\(\);[^]*?reloadAfter\(w\)/, "odhlášení počká na smazání souborů"], [/\$\("lockForgot"\)\.onclick=[^]*?Docs\.wipe\(\)/, "reset zámku maže soubory"],
    ]) assert(re.test(html), "v index.html chybí: " + what);
    const cut = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b); assert(i > 0 && j > i, "nenalezeno: " + a); return html.slice(i, j) };
    const src = cut("function docOwnerLead", "function card(l,i,cur){") + cut("function docDecor", "function renderClients(){");
    const { ctx, page } = await open();
    await prep(page, "foto.png");
    const r = await page.evaluate(async src => {
      window.clients = [{ id: "c1", leadId: "l1" }, { id: "c2" }]; window.leads = [{ id: "l1", clientId: "c1" }, { id: "l2" }, { id: "l3", clientId: "c2" }];
      window.leadsOfClient = c => leads.filter(l => l.clientId === c.id || l.id === c.leadId);
      window.ensureClient = async e => { e.rec = { id: "cNew" }; return e.rec };
      const G = new Function(src + ";return {docOwnerLead,docOwnerClient,docDecor}")();
      const out = {};
      const a = G.docOwnerLead({ id: "l1", name: "Jan" }), b = G.docOwnerLead({ id: "l2", name: "Eva" });
      out.lead = [a.ids, a.primary, b.ids, b.primary];
      const c = G.docOwnerClient({ rec: { id: "c1" }, lead: { id: "l1" }, name: "Jan" });
      out.client = [c.ids, c.primary]; out.full = G.docOwnerClient({ rec: { id: "c2" }, name: "X" }, true).ids;
      const nr = { name: "Z kalendáře" }, n = G.docOwnerClient(nr);
      out.noRec = [n.ids, n.primary]; const prim = await n.ensure(); out.afterEnsure = [prim, n.ids, n.primary];
      /* řádek klienta: přijme soubor, ukáže štítek, servisní karta štítek nemá */
      const row = document.createElement("button"); row.className = "row crow"; row.innerHTML = '<span class="t">Jan</span>'; document.body.append(row);
      G.docDecor({ rec: { id: "c1" }, lead: { id: "l1" }, name: "Jan" }, row);
      const dt = new DataTransfer(); dt.items.add(__f["foto.png"]); row.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
      await new Promise(res => { const t = setInterval(() => { if (Docs.count({ ids: ["c:c1"] }) === 1) { clearInterval(t); res() } }, 20) });
      const row2 = document.createElement("button"); row2.innerHTML = '<span class="t">Jan</span>';
      G.docDecor({ rec: { id: "c1" }, lead: { id: "l1" }, name: "Jan" }, row2);
      const sc = document.createElement("article"); sc.className = "scard"; sc.innerHTML = '<span class="t">Jan</span>'; G.docDecor({ rec: { id: "c1" }, name: "Jan" }, sc);
      out.badgeRow = row2.querySelector(".t .dc-tag")?.textContent; out.badgeScard = !!sc.querySelector(".dc-tag"); out.owner = Object.values(docsStore)[0].owner;
      return out;
    }, src);
    eq(r.lead, [["l:l1", "c:c1"], "c:c1", ["l:l2"], "l:l2"], "vlastník leadu (klient má přednost, lead bez klienta je sám)");
    eq(r.client, [["c:c1", "l:l1"], "c:c1"], "vlastník klienta v seznamu");
    eq(r.full, ["c:c2", "l:l3"], "detail klienta sečte soubory všech jeho leadů");
    eq(r.noRec, [[], null], "klient jen z kalendáře nemá záznam");
    eq(r.afterEnsure, ["c:cNew", ["c:cNew"], "c:cNew"], "záznam vznikne až při prvním souboru a okamžitě se projeví");
    eq(r.badgeRow, "1", "štítek u klienta v seznamu"); eq(r.badgeScard, false, "karta servisu štítek nemá"); eq(r.owner, "c:c1", "soubor puštěný na řádek patří klientovi");
    await ctx.close();
  },

  /* jen s --shots: snímky do složky SHOT_DIR (pro kontrolu vzhledu očima) */
  async "snímky vzhledu"() {
    if (!process.argv.includes("--shots")) return;
    const dir = process.env.SHOT_DIR || "."; 
    for (const [w, h, tag] of [[1300, 900, "desktop"], [390, 800, "mobil"]]) {
      const { ctx, page } = await open({ width: w, height: h });
      await prep(page, "ukazka.pdf", "ukazka.xlsx", "foto.png", "ukazka.docx", "export.numbers");
      await drop(page, "#card", ["ukazka.pdf", "ukazka.xlsx", "foto.png", "ukazka.docx", "export.numbers"]); await waitFiles(page, 5);
      await page.evaluate(() => { document.getElementById("card").classList.add("dc-over") });
      await page.screenshot({ path: `${dir}/${tag}-1-karta.png` });
      await page.evaluate(() => { document.getElementById("card").classList.remove("dc-over") });
      await rowOf(page, "ukazka.pdf").click(); await page.waitForSelector(".dv-pg[data-done='1']"); await page.waitForTimeout(300);
      await page.screenshot({ path: `${dir}/${tag}-2-pdf.png` });
      await page.keyboard.press("Escape"); await rowOf(page, "ukazka.xlsx").click(); await page.waitForSelector(".dv-tbl td"); await page.screenshot({ path: `${dir}/${tag}-3-xlsx.png` });
      await page.keyboard.press("Escape"); await rowOf(page, "export.numbers").click(); await page.waitForSelector(".dv-msg .chipbtn"); await page.screenshot({ path: `${dir}/${tag}-4-numbers.png` });
      await ctx.close();
    }
  },
};

let ok = 0, bad = 0;
for (const [name, fn] of Object.entries(tests)) {
  if (filter && !name.includes(filter)) continue;
  const t0 = Date.now();
  try { await fn(); ok++; console.log(`✓ ${name} (${Date.now() - t0} ms)`); }
  catch (e) { bad++; console.log(`✗ ${name}\n    ${String(e && e.stack || e).split("\n").slice(0, 5).join("\n    ")}`); }
}
await browser.close(); srv.close();
console.log(`\n${ok} prošlo, ${bad} selhalo`);
process.exit(bad ? 1 : 0);
