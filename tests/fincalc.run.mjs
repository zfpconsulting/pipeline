// Testy kalkulačky (fincalc.js) v Chromiu – nepotřebují PP_KEY. Použití: node tests/fincalc.run.mjs [--shots]
import { loadPlaywright, startServer, assert, eq } from "./helpers.mjs";

const SHOTS = process.argv.includes("--shots");
const { chromium } = await loadPlaywright();
const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
const { srv, url } = await startServer();
const base = url.replace(/index\.html$/, "");

/* prázdná stránka s tokeny barev jako v Pipeline + paměťové úložiště se stejným API jako LStore */
async function open({ width = 1300, height = 900, dark = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? "dark" : "light" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", d => d.accept(d.type() === "prompt" ? "Test klient" : undefined));
  await page.route(base + "harness.html", r => r.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="cs"><head><meta charset="utf-8">
    <style>:root{--bg:#F2F2F7;--bg2:#fff;--label:#000;--red:#FF3B30;--card-shadow:0 1px 2px rgba(0,0,0,.04)}
    @media (prefers-color-scheme: dark){:root{--bg:#000;--bg2:#1C1C1E;--label:#fff}}body{background:var(--bg);margin:0;padding:16px;font-family:-apple-system,system-ui,sans-serif}</style>
    </head><body><div id="box"></div><script src="fincalc.js"></script><script>
    const docs={},subs=new Set(),emit=()=>subs.forEach(f=>f());let n=0;
    const store={collection:name=>({onSnapshot(cb){const f=()=>cb({docs:Object.entries(docs).filter(([k])=>k.startsWith(name+"/")).map(([k,v])=>({id:k.split("/")[1],data:()=>v}))});subs.add(f);f()},
      async add(d){const id="d"+(++n);docs[name+"/"+id]=d;emit();return{id}}}),
      doc:p=>({async set(d){docs[p]=d;emit()},async delete(){delete docs[p];emit()}})};
    window.toasts=[];window.ui=FinCalc.mount(document.getElementById("box"),{store,toast:m=>toasts.push(m)});window.docs=docs;
    </script></body></html>` }));
  await page.goto(base + "harness.html");
  await page.waitForFunction(() => window.ui);
  return { ctx, page, errors };
}
const tiles = page => page.$$eval(".fc-tile", ts => Object.fromEntries(ts.map(t => [t.querySelector(".k").textContent, t.querySelector(".v").textContent])));

const tests = {
  async "výpočty: investice podle kalkulačky ZFP (100 000 + 5 000/měs., 6 %, 20 let)"() {
    const { ctx, page } = await open();
    const r = await page.evaluate(() => {
      const { solve } = FinCalc.math, b = { pv: 100000, pmt: 5000, years: 20, rate: 6, freq: "m" };
      const fv = solve("inv", b, "fv").val;
      return {
        fv, pmt: solve("inv", { ...b, fv }, "pmt").val, pv: solve("inv", { ...b, fv }, "pv").val,
        years: solve("inv", { ...b, fv }, "years").val, rate: solve("inv", { ...b, fv }, "rate").val,
        neg: solve("inv", { ...b, fv: 200000 }, "pmt")
      };
    });
    eq(Math.round(r.fv), 2641225, "konečná hodnota");
    assert(Math.abs(r.pmt - 5000) < 0.01, "zpětně měsíční investice: " + r.pmt);
    assert(Math.abs(r.pv - 100000) < 0.01, "zpětně jednorázový vklad: " + r.pv);
    assert(Math.abs(r.years - 20) < 1e-6, "zpětně doba: " + r.years);
    assert(Math.abs(r.rate - 6) < 1e-6, "zpětně zhodnocení: " + r.rate);
    assert(!r.neg.ok && /záporn/.test(r.neg.err), "záporná investice se hlásí chybou");
    await ctx.close();
  },
  async "výpočty: úvěr a renta"() {
    const { ctx, page } = await open();
    const r = await page.evaluate(() => {
      const { solve } = FinCalc.math;
      const loan = { pv: 3000000, years: 30, rate: 5, freq: "m" };
      const pmt = solve("loan", loan, "pmt").val;
      return {
        pmt, rate: solve("loan", { ...loan, pmt }, "rate").val,
        never: solve("loan", { ...loan, pmt: 12000 }, "years"),
        yrs: solve("loan", { ...loan, pmt: 20000 }, "years").val,
        renta: solve("renta", { pv: 3000000, years: 20, rate: 4, fv: 0, freq: "m" }, "pmt").val,
        rentaKeep: solve("renta", { pv: 3000000, years: 20, rate: 4, fv: 3000000, freq: "m" }, "pmt").val,
        zero: solve("inv", { pv: 1000, pmt: 100, years: 10, rate: 0, freq: "m" }, "fv").val,
        q: solve("inv", { pv: 100000, pmt: 0, years: 1, rate: 12, freq: "q" }, "fv").val
      };
    });
    assert(Math.abs(r.pmt - 16104.65) < 0.01, "anuitní splátka 3 mil./30 let/5 %: " + r.pmt);
    assert(Math.abs(r.rate - 5) < 1e-6, "zpětně sazba úvěru");
    assert(!r.never.ok && /úroky/.test(r.never.err), "splátka pod úroky = chyba");
    assert(Math.abs(r.yrs - 19.657424624271) < 1e-6, "doba splácení při 20 000/měs.: " + r.yrs);
    assert(Math.abs(r.renta - 18179.41) < 0.01, "renta 3 mil./20 let/4 %: " + r.renta);
    assert(Math.abs(r.rentaKeep - 10000) < 0.01, "renta s ponecháním jistiny = jen úrok 10 000: " + r.rentaKeep);
    eq(r.zero, 13000, "nulové zhodnocení");
    assert(Math.abs(r.q - 112550.88) < 0.01, "čtvrtletní připisování 12 % = 12,55 % ročně: " + r.q);
    await ctx.close();
  },
  async "UI: výchozí investice, psaní, vlajka, režimy, uložení"() {
    const { ctx, page, errors } = await open();
    let t = await tiles(page);
    eq(t["Konečná hodnota inv."], "2 641 225 Kč", "dlaždice konečná hodnota");
    eq(t["Celkem vložíte"], "1 300 000 Kč", "dlaždice vloženo");
    assert(await page.$eval('input[data-k="fv"]', i => i.disabled), "dopočítávané pole je zamčené");
    assert(await page.$("#fcChart svg"), "graf se vykreslil");
    // psaní do pole přepočítá výsledky a kurzor zůstane v poli
    await page.click('input[data-k="pmt"]');
    await page.keyboard.press("Control+A");
    await page.keyboard.type("10000");
    t = await tiles(page);
    eq(t["Pravidelná měs. inv."], "10 000 Kč", "nová měsíční investice");
    assert(await page.evaluate(() => document.activeElement?.dataset.k === "pmt"), "kurzor zůstal v poli");
    // + / − tlačítka
    await page.click('button[data-a="inc"][data-k="years"]');
    eq((await tiles(page))["Splatnost"], "21 let", "plus u splatnosti");
    // vlajka: dopočítat měsíční investici k cíli 3 mil.
    await page.click('button[data-a="flag"][data-k="pmt"]');
    assert(await page.$eval('input[data-k="pmt"]', i => i.disabled), "měsíční investice je teď dopočítávaná");
    await page.fill('input[data-k="fv"]', "3000000");
    await page.keyboard.press("Tab");
    t = await tiles(page);
    eq(t["Konečná hodnota inv."], "3 000 000 Kč", "cíl");
    assert(/Kč$/.test(t["Pravidelná měs. inv."]) && t["Pravidelná měs. inv."] !== "10 000 Kč", "dopočtená investice: " + t["Pravidelná měs. inv."]);
    // nesmyslné zadání ukáže chybu, ne NaN
    await page.fill('input[data-k="fv"]', "1000");
    await page.keyboard.press("Tab");
    assert(await page.$eval(".fc-errm", e => !e.hidden && /záporn/.test(e.textContent)), "chybová hláška");
    assert(!(await page.content()).includes("NaN"), "nikde NaN");
    // úvěr
    await page.click('button[data-a="mode"][data-k="loan"]');
    t = await tiles(page);
    eq(t["Měsíční splátka"], "16 105 Kč", "splátka úvěru");
    eq(t["Přeplatek na úrocích"], "2 797 674 Kč", "přeplatek");
    // renta
    await page.click('button[data-a="mode"][data-k="renta"]');
    eq((await tiles(page))["Měsíční renta"], "18 179 Kč", "renta");
    // uložení + načtení ze seznamu
    await page.click('button[data-a="save"]');
    assert(await page.$eval(".fc-title", e => e.textContent.includes("Test klient")), "název v hlavičce");
    assert(await page.evaluate(() => Object.keys(docs).length === 1), "uloženo do úložiště");
    await page.click('button[data-a="new"]');
    assert(await page.$eval(".fc-title", e => /Koncept$/.test(e.textContent)), "nová kalkulace = Koncept");
    await page.click('button[data-a="menu"]');
    await page.click('button[data-a="load"]');
    assert(await page.$eval(".fc-title", e => e.textContent.includes("Test klient")), "načtená kalkulace");
    // stav přežije znovunačtení
    await page.reload(); await page.waitForFunction(() => window.ui);
    eq(await page.$eval('.fc-tabs [aria-selected="true"]', b => b.textContent), "Renta", "zapamatovaný režim");
    assert(!errors.length, "chyby v konzoli: " + errors.join(" | "));
    await ctx.close();
  },
  async "UI: animace křivky při změně zadání, ne při překreslení"() {
    const { ctx, page, errors } = await open();
    const dNow = () => page.$eval("#fcChart .fc-la", p => p.getAttribute("d"));
    await page.waitForTimeout(1100);
    const final1 = await dNow();
    await page.click('button[data-a="inc"][data-k="years"]');
    await page.waitForTimeout(120);
    const mid = await dNow();
    if (SHOTS) await page.screenshot({ path: "/tmp/fc-anim.png" });
    await page.waitForTimeout(1100);
    const final2 = await dNow();
    assert(mid !== final2, "uprostřed animace je křivka jinde než na konci");
    // pravý konec investice roste zdola: uprostřed animace leží níž (větší y) než na konci
    const lastY = d => +d.trim().split(/[ML]/).filter(Boolean).pop().split(" ")[1];
    assert(lastY(mid) > lastY(final2) + 5, `pravý konec stoupá (${lastY(mid)} → ${lastY(final2)})`);
    assert(final1 !== final2, "změna zadání změnila křivku");
    // otevření nápovědy překreslí panel, ale křivka se znovu neanimuje
    await page.click('button[data-a="help"][data-k="pv"]');
    eq(await dNow(), final2, "bez animace při překreslení");
    // úvěr: levý začátek klesající křivky stoupá zdola
    await page.click('button[data-a="mode"][data-k="loan"]');
    await page.waitForTimeout(120);
    const firstY = d => +d.trim().slice(1).split("L")[0].split(" ")[1];
    const lm = await dNow(); await page.waitForTimeout(1100); const lf = await dNow();
    assert(firstY(lm) > firstY(lf) + 5, `levý začátek úvěru stoupá (${firstY(lm)} → ${firstY(lf)})`);
    assert(!errors.length, "chyby: " + errors.join(" | "));
    await ctx.close();
  },
  async "UI: PDF má vodoznak a hodnoty"() {
    const { ctx, page, errors } = await open();
    const popP = ctx.waitForEvent("page");
    await page.click('button[data-a="pdf"]');
    const pop = await popP;
    await pop.waitForLoadState();
    const html = await pop.content();
    assert(html.includes("2 641 225 Kč") && html.includes("CONSULTING") && html.includes("Vývoj hodnoty investice"), "obsah PDF");
    if (SHOTS) await pop.screenshot({ path: "/tmp/fc-pdf.png", fullPage: true });
    assert(!errors.length, "chyby: " + errors.join(" | "));
    await ctx.close();
  },
  async "UI: mobil a tmavý režim bez chyb"() {
    for (const o of [{ width: 390, height: 844 }, { width: 1300, height: 900, dark: true }]) {
      const { ctx, page, errors } = await open(o);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert(over <= 0, "vodorovné přetečení o " + over + " px");
      if (SHOTS) { await page.waitForTimeout(1100); await page.screenshot({ path: `/tmp/fc-${o.width}${o.dark ? "-dark" : ""}.png`, fullPage: true }); }
      assert(!errors.length, "chyby: " + errors.join(" | "));
      await ctx.close();
    }
  }
};

let ok = 0, bad = 0;
if (SHOTS) { const { ctx, page } = await open(); await page.waitForTimeout(1100); await page.screenshot({ path: "/tmp/fc-1300.png", fullPage: true }); await ctx.close(); }
for (const [name, fn] of Object.entries(tests)) {
  const t0 = Date.now();
  try { await fn(); ok++; console.log(`✓ ${name} (${Date.now() - t0} ms)`); }
  catch (e) { bad++; console.log(`✗ ${name}\n    ${String(e && e.stack || e).split("\n").slice(0, 4).join("\n    ")}`); }
}
await browser.close(); srv.close();
console.log(`\n${ok} prošlo, ${bad} selhalo`);
process.exit(bad ? 1 : 0);
