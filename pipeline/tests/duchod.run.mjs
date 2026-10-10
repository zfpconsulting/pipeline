// Testy důchodové kalkulačky (duchod.js) v Chromiu – nepotřebují PP_KEY. Použití: node tests/duchod.run.mjs [--shots]
import { readFileSync } from "node:fs";
import { loadPlaywright, startServer, assert, eq } from "./helpers.mjs";

const SHOTS = process.argv.includes("--shots");
const { chromium } = await loadPlaywright();
const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
const { srv, url } = await startServer();
const base = url.replace(/index\.html$/, "");

/* prázdná stránka s tokeny barev jako v Pipeline + paměťové úložiště se stejným API jako LStore + dva fiktivní klienti */
async function open({ width = 1300, height = 900, dark = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? "dark" : "light" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route(base + "harness.html", r => r.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="cs"><head><meta charset="utf-8">
    <style>:root{--bg:#F2F2F7;--bg2:#fff;--label:#000;--label2:rgba(60,60,67,.6);--sep:rgba(60,60,67,.18);--orange:#FF9500;--orange-soft:rgba(255,149,0,.14);--red:#FF3B30;--tint:#007AFF;--card-shadow:0 1px 2px rgba(0,0,0,.04)}
    @media (prefers-color-scheme: dark){:root{--bg:#000;--bg2:#1C1C1E;--label:#fff;--label2:rgba(235,235,245,.6);--sep:rgba(84,84,88,.6)}}body{background:var(--bg);margin:0;padding:16px;font-family:-apple-system,system-ui,sans-serif}</style>
    </head><body><div id="box"></div><script src="duchod.js"></script><script>
    const docs={},subs=new Set(),emit=()=>subs.forEach(f=>f());let n=0;
    const store={collection:name=>({onSnapshot(cb){const f=()=>cb({docs:Object.entries(docs).filter(([k])=>k.startsWith(name+"/")).map(([k,v])=>({id:k.split("/")[1],data:()=>v}))});subs.add(f);f()},
      async add(d){const id="d"+(++n);docs[name+"/"+id]=d;emit();return{id}}}),
      doc:p=>({onSnapshot(cb){const f=()=>cb({exists:!!docs[p],data:()=>docs[p]});subs.add(f);f()},async set(d){docs[p]=d;emit()},async delete(){delete docs[p];emit()}})};
    const cl=[{id:"c:a",rec:{id:"a"},name:"Novák Petr"},{id:"l:b",name:"Dvořáková Jana"}];
    window.toasts=[];window.ensured=[];
    window.ui=DuchodCalc.mount(document.getElementById("box"),{store,toast:m=>toasts.push(m),clients:()=>cl,ensure:async e=>{ensured.push(e.id);e.rec={id:"new"+e.id.slice(2)};return e.rec}});window.docs=docs;
    </script></body></html>` }));
  await page.goto(base + "harness.html");
  await page.waitForFunction(() => window.ui);
  return { ctx, page, errors };
}
const tiles = page => page.$$eval(".dk-tile", ts => ts.map(t => [t.querySelector(".k").textContent, t.querySelector(".v").textContent.replace(/ /g, " ")]));
const fill = async (page, k, v) => { await page.fill(`[data-k="${k}"]`, String(v)); };

const tests = {
  async "redukce: 100 % / 26 % / 0 % podle redukčních hranic 2026"() {
    const { ctx, page } = await open();
    const r = await page.evaluate(() => {
      const { reduce, PAR } = DuchodCalc.math, p = PAR[2026];
      return { low: reduce(15000, p), mid: reduce(30000, p), hi: reduce(300000, p), zero: reduce(0, p) };
    });
    eq(r, { low: 15000, mid: 23745, hi: 66870, zero: 0 }, "výpočtový základ");
    await ctx.close();
  },
  async "invalidní, vdovský a sirotčí: ručně spočítaný případ (OVZ 30 000, 25 let, dopočtená doba 9 131 dní)"() {
    const { ctx, page } = await open();
    const r = await page.evaluate(() => {
      const c = DuchodCalc.math.calc({ ovz: 30000, tY: 25, tD: 0, nY: 0, nD: 0, evt: "2026-10-10", ret: "2051-10-10", dopPct: 100, kids: 2 });
      return { vz: c.vz, dop: c.dop, years: c.years, i1: c.i1.total, i2: c.i2.total, i3: c.i3.total, wid: c.wid.total, orp: c.orp.total, fam: c.orp.family };
    });
    /* VZ 23 745; 9 125 + 9 131 dní = 18 256 → 50 celých roků; PV III. 23 745·1,5 %·50 = 17 808,75 → 17 809 */
    eq(r, { vz: 23745, dop: 9131, years: 50, i1: 10837, i2: 13805, i3: 22709, wid: 13805, orp: 12024, fam: 24048 }, "částky");
    await ctx.close();
  },
  async "zákonná minima procentní výměry (2026) a rok 2027"() {
    const { ctx, page } = await open();
    const r = await page.evaluate(() => {
      const { calc } = DuchodCalc.math, a = calc({ ovz: 5000, tY: 1, tD: 0, evt: "2026-10-10" }), b = calc({ ovz: 5000, tY: 1, tD: 0, evt: "2027-03-01" });
      return { a: [a.i1.total, a.i2.total, a.i3.total, a.wid.total, a.orp.total, a.i3.minUsed], b: [b.i1.total, b.i3.total, b.wid.total, b.orp.total], by: b.pr.use };
    });
    eq(r.a, [4900 + 1634, 4900 + 2450, 4900 + 4900, 4900 + 2450, 4900 + 1960, true], "minima 2026");
    eq(r.b, [5170 + 1724, 5170 + 5170, 5170 + 2585, 5170 + 2068], "minima 2027");
    eq(r.by, 2027, "rok parametrů");
    await ctx.close();
  },
  async "náhradní doby jen z 80 %, dopočtená doba zkrácená a rok bez vyhlášených parametrů"() {
    const { ctx, page } = await open();
    const r = await page.evaluate(() => {
      const { doba, dopocet, paramsFor } = DuchodCalc.math;
      return { d: doba({ tY: 10, tD: 0, nY: 5, nD: 0 }), dop: dopocet("2026-10-10", "2026-10-20", 50), none: dopocet("2026-10-10", "2026-10-01", 100), w: paramsFor("2030-01-01").use, w2: paramsFor("2030-01-01").warn };
    });
    eq(r.d, { tot: 3650, sub: 1825, eff: 3285 }, "doba");
    eq([r.dop, r.none, r.w, r.w2], [5, 0, 2027, true], "dopočtená doba a parametry");
    await ctx.close();
  },
  async "vdovský a sirotčí z procentní výměry zemřelého, který už pobíral důchod"() {
    const { ctx, page } = await open();
    const r = await page.evaluate(() => {
      const c = DuchodCalc.math.calc({ ovz: 30000, tY: 40, tD: 0, evt: "2026-10-10", pvDead: 14001, kids: 1 });
      return { base: c.base, wid: c.wid.pv, orp: c.orp.pv };
    });
    eq(r, { base: 14001, wid: 7001, orp: 5601 }, "odvozené výměry (50 % a 40 % nahoru)");
    await ctx.close();
  },
  async "UI: zadání z IOLDP vyplní dlaždice, uložení ke klientovi a načtení zpět"() {
    const { ctx, page, errors } = await open();
    await fill(page, "ovz", "30 000"); await fill(page, "tY", 25); await fill(page, "tD", 0);
    await page.fill('[data-k="evt"]', "2026-10-10"); await page.fill('[data-k="ret"]', "2051-10-10");
    const t = await tiles(page);
    eq(t.map(x => x[0]), ["Invalidní I. stupně", "Invalidní II. stupně", "Invalidní III. stupně", "Vdovský / vdovecký", "Sirotčí (na 1 dítě)"], "dlaždice");
    eq(t[2][1], "22 709 Kč", "invalidní III.");
    /* bez klienta nejde uložit */
    await page.click('[data-a="save"]'); assert((await page.evaluate(() => toasts)).some(m => /vyber klienta/i.test(m)), "výzva k výběru klienta");
    /* virtuální klient se při uložení založí přes ensure() a data se uloží pod jeho id */
    await page.selectOption("#dk_cid", "l:b");
    await page.fill('[data-k="ioldp"]', "2026-10-09");
    await page.click('[data-a="save"]'); await page.waitForFunction(() => Object.keys(docs).length);
    const d = await page.evaluate(() => ({ keys: Object.keys(docs), ens: ensured, doc: docs[Object.keys(docs)[0]] }));
    eq(d.ens, ["l:b"], "ensure");
    eq(d.keys, ["duchod/newb"], "klíč dokumentu");
    eq([d.doc.name, d.doc.ioldp, d.doc.res.i3, d.doc.res.wid, d.doc.in.ovz], ["Dvořáková Jana", "2026-10-09", 22709, 13805, 30000], "uložený dokument");
    /* druhý klient s existující kartou, pak návrat k prvnímu */
    await page.selectOption("#dk_cid", "a"); await fill(page, "ovz", 45000);
    await page.click('[data-a="save"]'); await page.waitForFunction(() => Object.keys(docs).length === 2);
    await page.selectOption("#dk_cid", "newb");
    eq(await page.inputValue('[data-k="ovz"]'), "30000", "načtená data prvního klienta");
    assert((await page.$$(".dk-row")).length === 2, "dva uložené záznamy");
    /* smazání vyžaduje potvrzení */
    await page.click('[data-a="del"] >> nth=0'); assert((await page.evaluate(() => Object.keys(docs).length)) === 2, "první klik jen žádá potvrzení");
    await page.click('[data-a="del"][data-sure="1"]'); await page.waitForFunction(() => Object.keys(docs).length === 1);
    assert(!errors.length, "chyby: " + errors.join(" | "));
    await ctx.close();
  },
  async "import IOLDP: text se rozparsuje (OVZ nebere rok, náhradní doby zvlášť)"() {
    const { ctx, page } = await open();
    const txt = readFileSync(new URL("./fixtures/ioldp-ukazka.txt", import.meta.url), "utf8");
    const r = await page.evaluate(t => DuchodCalc.math.parseIoldp(t), txt);
    eq(r.fields, { ovz: 52300, tY: 22, tD: 120, nY: 2, nD: 30, ret: "2049-05-01", ioldp: "2026-10-09" }, "pole");
    eq(r.missing, [], "nenalezeno");
    const e = await page.evaluate(() => DuchodCalc.math.parseIoldp("nic užitečného"));
    eq(e.found, [], "prázdný soubor");
    await ctx.close();
  },
  async "import IOLDP: PDF i .txt vyplní formulář a rovnou se spočítá"() {
    for (const f of ["ioldp-ukazka.pdf", "ioldp-ukazka.txt"]) {
      const { ctx, page, errors } = await open();
      await page.setInputFiles("#dkFile", new URL("./fixtures/" + f, import.meta.url).pathname);
      await page.waitForFunction(() => document.querySelector("#dkImp .dk-warn"));
      eq(await page.inputValue('[data-k="ovz"]'), "52300", f + " OVZ");
      eq([await page.inputValue('[data-k="tY"]'), await page.inputValue('[data-k="tD"]'), await page.inputValue('[data-k="nY"]'), await page.inputValue('[data-k="ret"]')], ["22", "120", "2", "2049-05-01"], f + " doba a věk");
      assert((await page.textContent("#dkImp")).includes("Načteno"), f + " hláška");
      assert((await tiles(page)).length === 5, f + " dlaždice");
      assert(!errors.length, "chyby: " + errors.join(" | "));
      await ctx.close();
    }
  },
  async "UI: chybějící údaje a chybějící datum důchodového věku mají upozornění"() {
    const { ctx, page } = await open();
    assert((await page.textContent("#dkRes")).includes("Vyplň osobní vyměřovací základ"), "prázdný stav");
    await fill(page, "ovz", 30000); await fill(page, "tY", 20);
    assert((await page.textContent("#dkRes")).includes("Chybí datum dosažení důchodového věku"), "varování bez data");
    await ctx.close();
  },
  async "UI: mobil a tmavý režim bez chyb a bez vodorovného přetečení"() {
    for (const o of [{ width: 390, height: 844 }, { width: 1300, height: 900, dark: true }]) {
      const { ctx, page, errors } = await open(o);
      await fill(page, "ovz", 52300); await fill(page, "tY", 22); await page.fill('[data-k="ret"]', "2049-05-01");
      const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert(over <= 0, "vodorovné přetečení o " + over + " px");
      if (SHOTS) await page.screenshot({ path: `/tmp/dk-${o.width}${o.dark ? "-dark" : ""}.png`, fullPage: true });
      assert(!errors.length, "chyby: " + errors.join(" | "));
      await ctx.close();
    }
  }
};

let ok = 0, bad = 0;
for (const [name, fn] of Object.entries(tests)) {
  const t0 = Date.now();
  try { await fn(); ok++; console.log(`✓ ${name} (${Date.now() - t0} ms)`); }
  catch (e) { bad++; console.log(`✗ ${name}\n    ${String(e && e.stack || e).split("\n").slice(0, 4).join("\n    ")}`); }
}
await browser.close(); srv.close();
console.log(`\n${ok} prošlo, ${bad} selhalo`);
process.exit(bad ? 1 : 0);
