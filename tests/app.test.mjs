import { readFileSync } from "node:fs";
// Testy appky Pipeline – každý test dostane env {browser,url,key} a otevře si vlastní stránku.
import { openApp, assert, eq } from "./helpers.mjs";

const TABS = ["pipe", "money", "cli", "cal", "net", "tax", "goals", "pf"];
const closeDialogs = p => p.evaluate(() => document.querySelectorAll("dialog[open]").forEach(d => d.close()));
const STORE = {
  "settings/main": { manual: {}, sign: "Test", career: { cpts: 30000, cAsOf: "2026-06-15", cBase: 0 }, tabHidden: [], _u: 1 },
  "leads/r1": { name: "Skutečný Klient", stage: "nabidka", items: [], _u: 1 },
  "team/a": { name: "A", pos: "P4", parent: null, m: { "2026-07": 400, "2026-08": 300, "2026-09": 200 }, _u: 1 },
};

export default {
  async "appka naběhne a všechny záložky se vykreslí bez chyb"(env) {
    const { ctx, page, errors } = await openApp(env, { store: STORE });
    for (const v of TABS) { await page.evaluate(v => setView(v), v); await page.waitForTimeout(300); }
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },

  async "synchronizace slučuje změny ze dvou zařízení po položkách"(env) {
    const { ctx, page } = await openApp(env);
    const r = await page.evaluate(() => {
      const base = { sjetiny: { "2026-08/1": 10 }, tax: { 2026: { a: 1 } }, sign: "A", _u: 1, _f: {} };
      const A = structuredClone(base); A.sjetiny["2026-09/1"] = 50; A._f = stampDoc(base, A, 100); A._u = 100;
      const B = structuredClone(base); B.tax = { 2026: { a: 2 } }; B.sign = "B"; B._f = stampDoc(base, B, 200); B._u = 200;
      const m1 = mergeDoc(A, B), m2 = mergeDoc(B, A);
      const C = structuredClone(base); C.sjetiny = {}; C._f = stampDoc(base, C, 300); C._u = 300;
      const m3 = mergeDoc(m1, C);
      return { sj: m1.sjetiny, tax: m1.tax, sign: m1.sign, sym: JSON.stringify(m1) === JSON.stringify(m2), sj3: m3.sjetiny };
    });
    eq(r.sj, { "2026-08/1": 10, "2026-09/1": 50 }, "sjetina z prvního zařízení");
    eq(r.tax, { 2026: { a: 2 } }, "daně z druhého zařízení");
    eq(r.sign, "B", "novější podpis");
    assert(r.sym, "výsledek nezávisí na pořadí");
    eq(r.sj3, { "2026-09/1": 50 }, "pozdější smazání sjetiny se propíše");
    await ctx.close();
  },

  async "krok zpět a vpřed"(env) {
    const { ctx, page } = await openApp(env, { store: STORE });
    const act = async f => { await page.mouse.click(200, 500); await page.evaluate(f); await page.waitForTimeout(250); };
    await act(async () => { await db.collection("leads").add({ name: "Undo", stage: "novy", items: [] }) });
    await act(async () => { const l = leads.find(x => x.name === "Undo"); await db.doc("leads/" + l.id).update({ stage: "schuzka" }) });
    await act(async () => { const l = leads.find(x => x.name === "Undo"); await db.doc("leads/" + l.id).delete() });
    const st = () => page.evaluate(() => leads.find(x => x.name === "Undo")?.stage || null);
    eq(await st(), null, "smazáno");
    await page.click("#undoBtn"); await page.waitForTimeout(200); eq(await st(), "schuzka", "zpět 1");
    await page.click("#undoBtn"); await page.waitForTimeout(200); eq(await st(), "novy", "zpět 2");
    await page.click("#redoBtn"); await page.waitForTimeout(200); eq(await st(), "schuzka", "vpřed");
    await page.keyboard.press("Control+z"); await page.waitForTimeout(200); eq(await st(), "novy", "Ctrl+Z");
    await ctx.close();
  },

  async "prezentační režim: fiktivní data, pravidla a návrat ke skutečným"(env) {
    const { ctx, page, errors } = await openApp(env, { store: STORE });
    const before = await page.evaluate(() => localStorage.getItem("crm_store_v1"));
    await page.evaluate(() => demoSwitch(true, true)); await page.waitForTimeout(2500); await closeDialogs(page);
    const r = await page.evaluate(() => {
      const lv = x => { const l = obratLevelFor(x); return l ? PROFI.indexOf(l) + 1 : 0 };
      const qs = [qShift(CURQ(), -3), qShift(CURQ(), -2), qShift(CURQ(), -1)];
      return { demo: DEMO, team: team.length, maxPos: Math.max(...team.map(m => +m.pos.slice(1))), stat: +career().stat.slice(1),
        me: qs.map(q => lv(quarterTotal(q))), tm: qs.map(q => lv(Math.max(...team.map(m => memberQPts(m, q))))),
        clients: clientEntries().length, open: leads.filter(l => !SIGNED(l.stage)).length, sign: settings.sign };
    });
    assert(r.demo, "běží demo"); eq(r.team, 8, "8 obchodníků"); eq(r.clients, 10, "10 klientů"); assert(r.open >= 5, "rozjednané leady");
    assert(r.stat > r.maxPos, "statická kariéra výš než tým");
    r.me.forEach((l, i) => assert(l > r.tm[i], `obratová výš než tým (kvartál ${i}: ${l} vs ${r.tm[i]})`));
    assert(/^V\S* K/.test(r.sign), "iniciály VK");
    for (const v of TABS) { await page.evaluate(v => setView(v), v); await page.waitForTimeout(250); }
    await page.evaluate(() => demoSwitch(false)); await page.waitForTimeout(1800);
    eq(await page.evaluate(() => [DEMO, leads.map(l => l.name)]), [false, ["Skutečný Klient"]], "zpět na skutečná data");
    eq(await page.evaluate(() => localStorage.getItem("crm_store_v1")), before, "skutečná data beze změny");
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },

  async "daně: režim s.r.o."(env) {
    const { ctx, page } = await openApp(env, { store: STORE });
    const r = await page.evaluate(() => { const c = { ...taxCfg(), sroPay: 40000, sroIns: false, sroAcc: 36000, sroDiv: 100, kids: 2, oth: 0, pre: {}, exp: [], autoM: 0, autoReal: 0, gifts: [], dps: 0, zp: 0, dip: 0, dlp: 0, hy: {} };
      const R = taxCalc(c, 1500000, "sro"); return { dppo: R.dppo, divTax: R.divTax, wageTax: R.wageTax, net: Math.round(R.net) } });
    eq(r, { dppo: 172410, divTax: 97403, wageTax: 3636, net: 972631 }, "výpočet s.r.o.");
    await page.evaluate(() => setView("tax")); await page.waitForTimeout(300);
    await ctx.close();
  },

  async "body celkem = vlastní + skupinové, skupinové rostou z bodů týmu"(env) {
    const { ctx, page } = await openApp(env, { store: STORE });
    const r0 = await page.evaluate(() => ({ cum: cumPts(), gs: groupSince("2026-06-15") }));
    eq(r0.gs, groupSinceExpected(), "body týmu za uzavřené měsíce");
    await page.click("#c_cpts"); await page.waitForTimeout(300);
    const ins = page.locator("#edBody input");
    await ins.nth(0).fill("11000"); await ins.nth(0).press("Enter");
    await ins.nth(1).fill("20500"); await ins.nth(1).press("Enter"); await page.waitForTimeout(400);
    eq(await page.evaluate(() => [cumPts(), ownPts(), groupPts()]), [31500, 11000, 20500], "uloženo");
    await ctx.close();
    function groupSinceExpected() { const now = new Date(), cur = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0"); return ["2026-07", "2026-08", "2026-09"].filter(m => m < cur).reduce((s, m) => s + ({ "2026-07": 400, "2026-08": 300, "2026-09": 200 })[m], 0) }
  },

  async "oddělovače tisíců v číselných polích"(env) {
    const { ctx, page } = await openApp(env, { store: STORE });
    await page.evaluate(() => openEdit({ name: "T", stage: "nabidka", items: [{ p: "Investice", amt: 400000, var: "ZFPI", fee: 3, mode: "jednorazove" }] }));
    await page.waitForTimeout(500);
    const amt = page.locator("#dlg input.numfmt").first();
    eq(await amt.inputValue(), "400 000", "zobrazení");
    await amt.fill(""); await amt.type("1234567,5");
    eq([await amt.inputValue(), await amt.evaluate(i => i.value)], ["1 234 567,5", "1234567.5"], "psaní a čistá hodnota");
    const left = await page.evaluate(() => { const out = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
      while (n = w.nextNode()) { const el = n.parentElement; if (!el || el.closest("script,style") || (!el.offsetParent && !el.closest("svg"))) continue;
        for (const m of n.textContent.matchAll(/(^|[^\d.:\/+\-])(\d{4,})(?![\d.:\/-])/g)) if (!/^(19|20)\d\d$/.test(m[2])) out.push(m[2]) } return out });
    eq(left, [], "čísla bez oddělovače v textu");
    await ctx.close();
  },

  async "měření času v aplikaci odesílá záznamy"(env) {
    const { ctx, page, hb } = await openApp(env, { store: STORE });
    await page.evaluate(() => { Trk.lastIn = Date.now(); for (let i = 0; i < 8; i++) Trk.tick() });
    await page.waitForTimeout(800);
    assert(hb.length >= 1 && hb[0].secs >= 120, "odeslán záznam aspoň 2 min (" + JSON.stringify(hb) + ")");
    eq(await page.evaluate(() => Trk.pend()), 0, "nic nečeká na odeslání");
    await ctx.close();
  },

  async "zámek aplikace: biometrie (virtuální) a PIN"(env) {
    const { ctx, page } = await openApp(env, { store: STORE });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true } });
    await page.evaluate(async () => { await AppLock.enableBio(); await AppLock.enablePin("1234") });
    await page.reload(); await page.waitForTimeout(1200);
    eq(await page.evaluate(() => [AppLock.isLocked(), document.documentElement.classList.contains("applocked")]), [true, true], "po otevření zamčeno");
    await page.click("#lockBio"); await page.waitForTimeout(700);
    eq(await page.evaluate(() => AppLock.isLocked()), false, "odemčeno biometrií");
    await page.evaluate(() => AppLock.show());
    await page.fill("#lockPin", "9999"); await page.waitForTimeout(400);
    eq(await page.evaluate(() => AppLock.isLocked()), true, "špatný PIN neodemkne");
    await page.fill("#lockPin", "1234"); await page.waitForTimeout(600);
    eq(await page.evaluate(() => AppLock.isLocked()), false, "správný PIN odemkne");
    await ctx.close();
  },

  async "výdělek: přepínání měsíců a pipeline nabízí minulý měsíc"(env) {
    const { ctx, page } = await openApp(env, { store: STORE });
    const prevYm = await page.evaluate(() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") });
    assert(await page.evaluate(ym => perList().includes(ym), prevYm), "minulý měsíc v nabídce Pipeline");
    await page.evaluate(() => { settings.sjetiny = { ...(settings.sjetiny || {}), "2026-01/1": 1 }; setView("money") }); await page.waitForTimeout(300);
    const now = await page.textContent("#m_qlabel");
    await page.click("#mPrevM"); await page.waitForTimeout(250);
    const prev = await page.textContent("#m_qlabel");
    assert(prev !== now && /vyplaceno|vyplatí/.test(prev), "přepnuto na minulý měsíc: " + prev);
    await page.click("#mNextM"); await page.waitForTimeout(250);
    eq(await page.textContent("#m_qlabel"), now, "zpět na aktuální");
    await ctx.close();
  },

  async "výpisy za 3 měsíce: přečtení ze souboru a přepočet"(env) {
    const { ctx, page } = await openApp(env, { store: STORE });
    await page.evaluate(() => setView("money")); await page.waitForTimeout(300);
    await page.click("#mClosingsBtn"); await page.waitForTimeout(400);
    const ym = await page.evaluate(() => lastMonths(1)[0]), per = ym + "/2";
    const end = await page.evaluate(p => perEnd(p), per);
    const d = end.split("-").reverse().map(Number).join(". ");
    const txt = `Provizní výpis\nUzávěrka do ${d}\nBody za uzávěrku 312,4\nZ toho udržovací provize 45,2\nZFP Investments udržovací 20,1\nConseq udržovací 25,1\nMeziprovize z týmu 1 250,00 Kč\nCena bodu 150 Kč\nCelkem k výplatě 48 110,00 Kč\nKariérní body celkem 9 890\nVlastní body 7 400`;
    await page.locator("#edBody input[type=file]").setInputFiles({ name: "vypis.txt", mimeType: "text/plain", buffer: Buffer.from(txt) });
    await page.waitForTimeout(600);
    assert(/sedí s výpisem/.test(await page.textContent("#edBody")), "kontrola výplaty sedí");
    await page.click("#edBody >> text=Uložit a přepočítat"); await page.waitForTimeout(600);
    const r = await page.evaluate(p => ({ sj: settings.sjetiny[p], cum: cumPts(), own: ownPts(), rate: settings.monthlyRate[p.slice(0, 7)], aum: !!settings.passive?.aum?.ZFPI }), per);
    eq(r, { sj: 312.4, cum: 9890, own: 7400, rate: 150, aum: true }, "uloženo a přepočteno");
    await ctx.close();
  },

  async "výpis: jména klientů a čísla smluv se nikam neuloží, čtou se jen příjmy"(env) {
    const { ctx, page } = await openApp(env, { store: STORE });
    await page.evaluate(() => setView("money")); await page.waitForTimeout(300);
    await page.click("#mClosingsBtn"); await page.waitForTimeout(400);
    const ym = await page.evaluate(() => lastMonths(1)[0]), [y, m] = ym.split("-").map(Number), last = new Date(y, m, 0).getDate();
    const SECRET = ["Nováková", "Dvořák", "Šťastný", "7712345678", "9988776655", "905123/4567", "jan.dvorak@seznam.cz", "+420 777 123 456"];
    const mk = (from, to, rows, sum) => [
      `PROVIZNÍ VÝPIS – uzávěrka ${from}. ${m}. ${y} – ${to}. ${m}. ${y}`,
      ...rows,
      ...sum].join("\n");
    const f1 = mk(1, 15, [
      "Nováková Jana, RČ 905123/4567, smlouva 7712345678, Životní pojištění NN, body 120,5",
      "Dvořák Jan (jan.dvorak@seznam.cz, +420 777 123 456) smlouva 9988776655 Investice ZFPI udržovací 18,0"],
      ["Body za uzávěrku 180,2", "Z toho udržovací provize celkem 19,8", "ZFP Investments udržovací celkem 9,9", "Meziprovize z týmu 800,00 Kč", "Cena bodu 150 Kč",
       "Životní pojištění celkem 120,5", "Investice celkem 40,0", "Celkem k výplatě 27 830,00 Kč"]);
    const f2 = mk(16, last, [
      "Šťastný Petr smlouva 1234567890 Investice ZFPI udržovací 11,0 body 250,0"],
      ["Body za uzávěrku 312,4", "Z toho udržovací provize celkem 45,2", "ZFP Investments udržovací celkem 20,1", "Conseq udržovací celkem 25,1",
       "Meziprovize z týmu 1 250,00 Kč", "Cena bodu 150 Kč", "Investice celkem 250,0", "Penzijní spoření celkem 10,4",
       "Celkem k výplatě 48 110,00 Kč", "Kariérní body celkem 9 890", "Vlastní body 7 400", "Skupinové body 2 490"]);
    await page.locator("#edBody input[type=file]").setInputFiles([
      { name: "vypis1.txt", mimeType: "text/plain", buffer: Buffer.from(f1) }, { name: "vypis2.txt", mimeType: "text/plain", buffer: Buffer.from(f2) }]);
    await page.waitForTimeout(800);
    const shown = await page.evaluate(() => document.getElementById("edDlg").innerText + [...document.querySelectorAll("#edDlg input")].map(i => i.value).join(" "));
    SECRET.forEach(x => assert(!shown.includes(x) && !shown.includes(x.replace(/\D/g, "")) || !/\d{6}/.test(x.replace(/\D/g, "")) && !shown.includes(x), "zobrazeno: " + x));
    await page.click("#edBody >> text=Uložit a přepočítat"); await page.waitForTimeout(700);
    const r = await page.evaluate(ym => ({ c: settings.closings[ym], cum: cumPts(), own: ownPts() }), ym);
    eq([r.c.p1, r.c.p2, r.c.udr, r.c.team, r.c.rate, r.c.pay], [180.2, 312.4, 65, 2050, 150, 75940], "měsíc sečtený z obou uzávěrek");
    eq(r.c.split, { ZFPI: 30, CQ: 25.1 }, "udržovací podle společností");
    eq(r.c.cat, { ZP: 120.5, INV: 290, DPS: 10.4 }, "z čeho je příjem");
    eq([r.cum, r.own], [9890, 7400], "kariérní body");
    const dump = await page.evaluate(() => { let s = ""; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); s += k + "=" + localStorage.getItem(k) } return s });
    for (const x of SECRET) { assert(!dump.includes(x), "uloženo v zařízení: " + x); const d = x.replace(/\D/g, ""); if (d.length >= 6) assert(!dump.includes(d), "uloženo číslo: " + d) }
    for (const x of ["Nov", "Dvo", "Šťa", "seznam"]) assert(!dump.includes(x), "zbytek jména v úložišti: " + x);
    await ctx.close();
  },

  async "6 výpisů naráz: období z názvu souboru, diagnostika a anonymizovaná struktura"(env) {
    const { ctx, page } = await openApp(env, { store: STORE });
    await page.evaluate(() => setView("money")); await page.waitForTimeout(300);
    await page.click("#mClosingsBtn"); await page.waitForTimeout(400);
    const months = await page.evaluate(() => lastMonths(3));
    const files = [];
    months.forEach((ym, i) => [1, 2].forEach(h => files.push({ name: `sjetina_${ym.replace("-", "_")}_${h}.txt`, mimeType: "text/plain",
      buffer: Buffer.from(`Novák Jan smlouva 7712345678 ŽP 50,0\nBody za uzávěrku ${100 + i * 10 + h}\nCena bodu 150 Kč\nCelkem k výplatě ${(100 + i * 10 + h) * 150} Kč`) })));
    files.push({ name: "sken.txt", mimeType: "text/plain", buffer: Buffer.from("   ") });
    await page.locator("#edBody input[type=file]").setInputFiles(files); await page.waitForTimeout(900);
    const r = await page.evaluate(() => [...document.querySelectorAll("#edBody .clcard")].slice(0, 3).map(c => [c.querySelector("select").value, ...[...c.querySelectorAll("input")].slice(0, 2).map(i => i.value)]));
    eq(r, months.map((ym, i) => [ym, String(101 + i * 10), String(102 + i * 10)]), "6 výpisů rozřazeno do 3 měsíců");
    const txt = await page.textContent("#edBody");
    assert(/bez textu/.test(txt), "hlášení u prázdného souboru");
    assert(!/null/.test(txt), "žádné null v okně");
    await page.locator("#edBody >> text=Struktura").first().click(); await page.waitForTimeout(300);
    const sk = await page.evaluate(() => document.querySelector(".skeldlg textarea").value);
    assert(!/Novák|7712345678/.test(sk) && /Body za uzávěrku/.test(sk) && /×××/.test(sk), "kostra bez jmen a čísel smluv: " + sk);
    await ctx.close();
  },

  async "provizní výpis ZFP: přesné čtení a žádné osobní údaje"(env) {
    const { ctx, page } = await openApp(env, { store: STORE });
    const ym = await page.evaluate(() => lastMonths(2)[1]);
    const raw = readFileSync(new URL("./fixtures/zfp-vypis.txt", import.meta.url), "utf8").replaceAll("2026/08", ym.replace("-", "/"));
    const r = await page.evaluate(t => parseClosingText(t, "vypis.pdf"), raw);
    eq([r.per, r.pts, r.udr, r.team, r.grp, r.bonus, r.rate, r.pay, r.cum], [ym + "/1", 35.77, 12.28, 275.27, 13.76, 2000, 150, 7640.42, 9081.02], "hodnoty z výpisu");
    eq(r.split, { ZFPI: 1.6, WI: 10.5, CQ: 0.18 }, "udržovací podle společností");
    eq(r.cat, { ZP: 2.56, INV: 33.21 }, "z čeho je příjem");
    const json = JSON.stringify(r);
    for (const x of ["Nováková", "Dvořák", "Podřízený", "7712345678", "ZW998877", "Fiktivní", "Příkop", "12.03.1990", "123456"]) assert(!json.includes(x), "ve výsledku je " + x);
    /* uložení přes okno: nic z výpisu kromě čísel */
    await page.evaluate(() => setView("money")); await page.waitForTimeout(300);
    await page.click("#mClosingsBtn"); await page.waitForTimeout(400);
    await page.locator("#edBody input[type=file]").setInputFiles({ name: "vypis.txt", mimeType: "text/plain", buffer: Buffer.from(raw) }); await page.waitForTimeout(700);
    await page.click("#edBody >> text=Uložit a přepočítat"); await page.waitForTimeout(600);
    const dump = await page.evaluate(() => { let s = ""; for (let i = 0; i < localStorage.length; i++) s += localStorage.getItem(localStorage.key(i)); return s });
    for (const x of ["Nováková", "Dvořák", "Podřízený", "7712345678", "ZW998877", "Fiktivní", "Příkop", "Tyrkysová"]) assert(!dump.includes(x), "uloženo: " + x);
    eq(await page.evaluate(ym => [settings.sjetiny[ym + "/1"], settings.monthlyBonus?.[ym], settings.monthlyTeam?.[ym]], ym), [35.77, 2000, 275.27], "uloženo do výdělku");
    await ctx.close();
  },
};
