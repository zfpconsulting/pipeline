import { readFileSync } from "node:fs";
// Testy appky Pipeline – každý test dostane env {browser,url,key} a otevře si vlastní stránku.
import { openApp, assert, eq } from "./helpers.mjs";

const TABS = ["pipe", "money", "cli", "cal", "net", "tax", "goals", "pf", "calc", "duch"];
const closeDialogs = p => p.evaluate(() => document.querySelectorAll("dialog[open]").forEach(d => d.close()));
const STORE = {
  "settings/main": { manual: {}, sign: "Test", career: { cpts: 30000, cAsOf: "2026-06-15", cBase: 0 }, tabHidden: [], _u: 1 },
  "leads/r1": { name: "Skutečný Klient", stage: "nabidka", items: [], _u: 1 },
  "team/a": { name: "A", pos: "P4", parent: null, m: { "2026-07": 400, "2026-08": 300, "2026-09": 200 }, _u: 1 },
};


/* ---------- AI asistent: Worker a Google jsou podvržené, nic neodchází ven ---------- */
const TPL_ONLINE = { id: "potvrzeni", name: "Potvrzení schůzky", text: "Dobrý den, {osloveni}, potvrzuji naši schůzku {den} {datum} {vcas}{kde}.\n{podpis}" };
const TPL_MEET = { id: "onl", name: "Potvrzení online konzultace", text: "Dobrý den, {osloveni}, potvrzuji naši schůzku {den} {datum} {vcas}{kde}. Zde Vám zasílám odkaz pro připojení: {meet}.\n{podpis}" };
const MEET_LINK = "https://meet.google.com/abc-defg-hij";
const nextDow = (dow, hour) => { const d = new Date(); d.setDate(d.getDate() + ((dow - d.getDay() + 7) % 7 || 7)); d.setHours(hour, 0, 0, 0);
  const z = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "T" + z(d.getHours()) + ":00"; };
async function aiApp(env, { actions, reply = "", delay = 0, tpls = [TPL_ONLINE, TPL_MEET], leads = {}, ai = {}, scope = "calendar.events gmail.send" } = {}) {
  const store = { ...STORE,
    "settings/main": { ...STORE["settings/main"], calPrefix: "VK:", calId: "primary", tpls, ai: { on: true, url: "https://worker.test", delay, sms: true, mail: true, from: "", ...ai } },
    "leads/n1": { name: "Jan Novák", phone: "777 111 222", email: "novak@example.com", stage: "kontaktovan", items: [], meetings: [], log: [], _u: 1 },
    ...leads };
  const { ctx, page, errors } = await openApp(env, { store });
  const calls = { cal: [], sms: [], mail: [], ai: [] };
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
  const json = (route, obj, status = 200) => route.fulfill({ status, headers: cors, contentType: "application/json", body: JSON.stringify(obj) });
  await ctx.route("https://worker.test/**", route => {
    const r = route.request(), path = new URL(r.url()).pathname;
    if (r.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const body = r.postData() ? JSON.parse(r.postData()) : {};
    if (path === "/ai") { calls.ai.push({ body, auth: r.headers()["authorization"] }); return json(route, { reply, actions }); }
    if (path === "/sms") { calls.sms.push(body); return json(route, { ok: true }); }
    return json(route, { ok: true, ai: true, sms: true });
  });
  await ctx.route(/googleapis\.com\/(calendar|gmail)/, route => {
    const r = route.request(), u = r.url();
    if (r.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (/gmail/.test(u)) { calls.mail.push(JSON.parse(r.postData())); return json(route, { id: "m1" }); }
    if (r.method() === "POST") { calls.cal.push(JSON.parse(r.postData())); return json(route, { id: "ev1" }); }
    return json(route, { hangoutLink: MEET_LINK, description: "Připojit se přes Google Meet: " + MEET_LINK });
  });
  await page.evaluate(sc => lsSet("g_tok", { at: "test-token-123456789012345", exp: Date.now() + 36e5, scope: sc }), scope);
  await page.evaluate(() => Assistant.refresh());
  return { ctx, page, errors, calls };
}
const aiSay = async (page, text) => { await page.evaluate(() => Assistant.open()); await page.waitForSelector("dialog[open] .aiIn textarea");
  await page.fill("dialog[open] .aiIn textarea", text); await page.click('dialog[open] .aiIn button[aria-label="Odeslat"]'); };
const aiLead = (page, name) => page.evaluate(n => { const l = leads.find(x => x.name === n); return l ? JSON.parse(JSON.stringify(l)) : null }, name);

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

  async "čistý režim: prázdná appka, úpravy oddělené od skutečných dat"(env) {
    const { ctx, page, errors } = await openApp(env, { store: STORE });
    const before = await page.evaluate(() => localStorage.getItem("crm_store_v1"));
    await page.evaluate(() => demoSwitch("clean")); await page.waitForTimeout(2000); await closeDialogs(page);
    const r = await page.evaluate(() => ({ demo: DEMO, clean: CLEAN, leads: leads.length, team: team.length, clients: clientEntries().length, sj: Object.keys(settings.sjetiny || {}).length, sync: $("syncBtn").textContent }));
    eq(r, { demo: true, clean: true, leads: 0, team: 0, clients: 0, sj: 0, sync: "Čistý režim" }, "prázdná appka");
    for (const v of TABS) { await page.evaluate(v => setView(v), v); await page.waitForTimeout(250); }
    await page.evaluate(() => db.collection("leads").add({ name: "Zkušební Lead", stage: "osloven", createdAt: new Date().toISOString() })); await page.waitForTimeout(300);
    await page.evaluate(() => demoSwitch(false)); await page.waitForTimeout(1800);
    eq(await page.evaluate(() => localStorage.getItem("crm_store_v1")), before, "skutečná data beze změny");
    await page.evaluate(() => demoSwitch("clean")); await page.waitForTimeout(1800); await closeDialogs(page);
    eq(await page.evaluate(() => leads.map(l => l.name)), ["Zkušební Lead"], "vyzkoušené zůstává");
    await page.evaluate(() => demoSwitch("clean", true)); await page.waitForTimeout(1800); await closeDialogs(page);
    eq(await page.evaluate(() => leads.length), 0, "začít znovu načisto");
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

  async "import výpisu ZFP: přesné body, tým po kolezích v bodech, žádné osobní údaje"(env) {
    const store = { ...STORE, "team/k1": { name: "Jeden Podřízený", pos: "P3", parent: null, m: {}, _u: 1 } };
    const { ctx, page } = await openApp(env, { store });
    const ym = await page.evaluate(() => lastMonths(2)[1]), yp = ym.replace("-", "/");
    const raw = readFileSync(new URL("./fixtures/zfp-vypis.txt", import.meta.url), "utf8").replaceAll("2026/08", yp);
    /* záludnost ze skutečného výpisu: číslo smlouvy končící 3 číslicemi hned před body (dřív se slilo v 234 336,9) */
    const raw2 = raw.replace("2026/08/1", yp + "/2").replaceAll(yp + "/1", yp + "/2").replace("Tyrkysová Jana   ZFP realitní fond   PZ1   1112223340   17,98   150,00   2 696,84", "Tyrkysová Jana   Hypotéka ČS   PZ1   234   336,90   150,00   50 535,00")
      .replace("Tarif / statická kariéra:   Body:   35,77", "Tarif / statická kariéra:   Body:   354,69").replace("Celkem provize [Kč]:   6 222,20", "Celkem provize [Kč]:   54 060,36");
    const r2 = await page.evaluate(t => parseClosingText(t, "x.pdf"), raw2);
    const pm = await page.evaluate(ym => clShiftPer(ym + "/1", -1).slice(0, 7), ym);
    eq([r2.stmtPer, r2.per, r2.pts, r2.chk.rows, r2.chk.bad], [ym + "/2", pm + "/2", 354.69, 354.69, 0], "výpis = výplata, produkce o měsíc dřív; číslo smlouvy se neslije s body");
    /* vklady do investic pod 50 000 Kč (odhad z bodů za vstupní poplatek) = pravidelné vklady: WI 2,27 b ≈ 25 000 Kč, 0,33 b, převzaté 0,04 a 0,31 b;
       ZFP realitní fond 17,98 b ≈ 200 000 Kč je jednorázový vklad → aktivní produkce */
    const r1 = await page.evaluate(t => parseClosingText(t, "x.pdf"), raw);
    eq([r1.reg, r1.regN, r2.reg], [2.95, 4, 2.95], "pravidelné vklady");
    await page.evaluate(() => setView("money")); await page.waitForTimeout(300);
    await page.click("#mClosingsBtn"); await page.waitForTimeout(300);
    await page.locator("#edBody input[type=file]").setInputFiles([
      { name: "vypis1.pdf.txt", mimeType: "text/plain", buffer: Buffer.from(raw) }, { name: "vypis2.pdf.txt", mimeType: "text/plain", buffer: Buffer.from(raw2) }]);
    await page.waitForTimeout(800);
    const txt = await page.textContent("#edBody");
    assert(/1\. uzávěrka/.test(txt) && /2\. uzávěrka/.test(txt), "obě uzávěrky poznané");
    assert(/✓ sedí s řádky výpisu/.test(txt), "výplata sedí: " + txt.slice(0, 600));
    assert(/zapíše se k členovi Jeden Podřízený/.test(txt) && /nový člen týmu/.test(txt), "tým po kolezích");
    assert(!/Nováková|7712345678|Tyrkysová/.test(txt), "v okně nejsou klienti");
    await page.click("#edBody >> text=Uložit do výsledků"); await page.waitForTimeout(900);
    const r = await page.evaluate(ym => ({ sj1: settings.sjetiny[ym + "/1"], sj2: settings.sjetiny[ym + "/2"], bonus: settings.monthlyBonus?.[ym], kcTeam: settings.monthlyTeam?.[ym] ?? null,
      udr: settings.monthlyUdr?.[ym], rate: settings.monthlyRate?.[ym], k1: team.find(m => m.name === "Jeden Podřízený")?.m?.[ym], k2: team.find(m => m.name === "Podřízený Druhý")?.m?.[ym],
      pos2: team.find(m => m.name === "Podřízený Druhý")?.pos, cum: settings.career.cpts }), pm);
    eq(r, { sj1: 35.77, sj2: 354.69, bonus: 4000, kcTeam: null, udr: 24.56, rate: 150, k1: 0.08, k2: 27.44, pos2: "P3", cum: 9081.02 }, "uloženo do výsledků");
    const g = await page.evaluate(ym => { const row = monthRow(ym, { tot: 0, udr: 0, reg: 0 }); return { reg: settings.monthlyReg[ym], pas: settings.passive.regular, own: Math.round(mVal(row, "own")), regKc: Math.round(mVal(row, "reg")) } }, pm);
    eq(g, { reg: 5.9, pas: 5.9, own: Math.round((35.77 + 354.69 - 24.56 - 5.9) * 150 + 4000), regKc: Math.round(5.9 * 150) }, "aktivní produkce bez pravidelných vkladů, celkově v pasivním příjmu");
    const dump = await page.evaluate(() => { let s = ""; for (let i = 0; i < localStorage.length; i++) s += localStorage.getItem(localStorage.key(i)); return s });
    for (const x of ["Nováková", "Dvořák", "Tyrkysová", "7712345678", "ZW998877", "Fiktivní", "Příkop", "12.03.1990"]) assert(!dump.includes(x), "uloženo: " + x);
    await ctx.close();
  },

  async "import: body kolegy už zadané za měsíc se nepřepíšou, nečitelný soubor se nahlásí"(env) {
    const ymP = new Date(); ymP.setDate(1); ymP.setMonth(ymP.getMonth() - 2);
    const ym = ymP.getFullYear() + "-" + String(ymP.getMonth() + 1).padStart(2, "0");
    const pmD = new Date(ymP.getFullYear(), ymP.getMonth() - 1, 1), pm = pmD.getFullYear() + "-" + String(pmD.getMonth() + 1).padStart(2, "0");
    const store = { ...STORE, "team/k2": { name: "Podřízený Druhý", pos: "P3", parent: null, m: { [pm]: 99 }, _u: 1 } };
    const { ctx, page } = await openApp(env, { store });
    const raw = readFileSync(new URL("./fixtures/zfp-vypis.txt", import.meta.url), "utf8").replaceAll("2026/08", ym.replace("-", "/"));
    await page.evaluate(() => setView("money")); await page.waitForTimeout(300);
    await page.click("#mClosingsBtn"); await page.waitForTimeout(300);
    await page.locator("#edBody input[type=file]").setInputFiles([{ name: "v.txt", mimeType: "text/plain", buffer: Buffer.from(raw) }, { name: "sken.txt", mimeType: "text/plain", buffer: Buffer.from("  ") }]);
    await page.waitForTimeout(700);
    const txt = await page.textContent("#edBody");
    assert(/už zadáno 99 b/.test(txt) && /nepřepíšu/.test(txt), "hlášení u už zadaného kolegy");
    assert(/bez textu/.test(txt) && !/null/.test(txt), "nečitelný soubor nahlášen");
    await page.locator("#edBody button", { hasText: "Struktura" }).first().click(); await page.waitForTimeout(200);
    const sk = await page.evaluate(() => document.querySelector(".skeldlg textarea").value);
    assert(!/7712345678/.test(sk), "kostra bez čísel smluv");
    await page.evaluate(() => document.querySelectorAll(".skeldlg").forEach(d => { d.close(); d.remove() }));
    await page.click("#edBody >> text=Uložit do výsledků"); await page.waitForTimeout(800);
    eq(await page.evaluate(ym => team.find(m => m.name === "Podřízený Druhý").m[ym], pm), 99, "nepřepsáno");
    await ctx.close();
  },

  async "oprava dřívějšího importu zapsaného o měsíc vedle"(env) {
    const store = { ...STORE, "team/k2": { name: "Kolega", pos: "P3", parent: null, m: { "2026-08": 13.72, "2026-07": 5 }, _u: 1 },
      "settings/main": { manual: {}, tabHidden: [], sjetiny: { "2026-07/1": 35.8, "2026-08/1": 35.77, "2026-08/2": 100, "2026-09/1": 50 }, monthlyRate: { "2026-08": 150, "2026-09": 160 }, monthlyUdr: { "2026-08": 12.28, "2026-09": 3 },
        monthlyBonus: { "2026-08": 2000, "2026-09": 0 },
        closings: { "2026-08/1": { pts: 35.77, udr: 12.28, rate: 150, bonus: 2000, team: { k2: 13.72 } }, "2026-09/1": { pts: 50, udr: 3, rate: 160, bonus: 0, team: {} } }, _u: 1 } };
    const { ctx, page } = await openApp(env, { store });
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => ({ sj: settings.sjetiny, mr: settings.monthlyRate, mu: settings.monthlyUdr, mb: settings.monthlyBonus || {}, k: team.find(m => m.name === "Kolega").m, v: settings.closingsV, keys: Object.keys(settings.closings).sort() }));
    eq(r.sj, { "2026-07/1": 35.77, "2026-08/1": 50, "2026-08/2": 100 }, "body přesunuté o měsíc dřív (ruční 8/2 zůstala)");
    eq(r.mr, { "2026-07": 150, "2026-08": 160 }, "tarif");
    eq(r.mu, { "2026-07": 12.28, "2026-08": 3 }, "udržovačky");
    eq(r.mb, { "2026-07": 2000 }, "mimořádné provize");
    eq(r.k, { "2026-07": 13.72 }, "body kolegy přesunuté");
    eq([r.v, r.keys], [2, ["2026-07/1", "2026-08/1"]], "záznamy importu");
    await ctx.close();
  },

  async "pasivní příjem: proplacená investice se přičte k AUM společnosti, podepsaná zůstane zvlášť, součet se nemění"(env) {
    const inv = (amt, v) => ({ p: "Investice", amt, var: v, fee: 0, mode: "jednorazove" });
    const store = { ...STORE,
      "settings/main": { ...STORE["settings/main"], passive: { aum: { ZFPI: 3000000, WI: 0 } } },
      "leads/pod": { name: "Podepsaný", stage: "podpis", signedAt: "2026-09-01", items: [inv(1000000, "ZFPI")], _u: 1 },
      "leads/pay": { name: "Proplacený", stage: "vyplaceno", signedAt: "2026-09-01", paidAt: "2026-09-20", items: [inv(2000000, "ZFPI"), inv(500000, "WI")], _u: 1 } };
    const { ctx, page, errors } = await openApp(env, { store });
    const snap = () => page.evaluate(() => { const M = passiveModel(0), z = M.base.find(c => c.k === "ZFPI"), w = M.base.find(c => c.k === "WI");
      return { zAum: z.aum, zDeals: z.aumDeals, wAum: w.aum, dealAum: M.dealAum, total: M.aumTotal, udr: M.series[0].udr } });
    const expUdr = 6000000 * 24 / 1555200 / 12 + 500000 * 12 / 276360 / 12;
    const a = await snap();
    eq([a.zAum, a.zDeals, a.wAum, a.dealAum, a.total], [5000000, 2000000, 500000, 1000000, 6500000], "proplacené jsou v AUM společností, podepsané zvlášť");
    assert(Math.abs(a.udr - expUdr) < 1e-6, "udržovací body se proplacením nezměnily: " + a.udr + " vs " + expUdr);
    await page.evaluate(() => openAumSheet()); await page.waitForTimeout(300);
    const first = page.locator("dialog[open] input.aumin").first();
    eq(await first.evaluate(i => i.value), "5000000", "v okně je AUM včetně proplacených obchodů");
    await first.evaluate(i => { i.value = "5500000"; i.dispatchEvent(new Event("change", { bubbles: true })) }); await page.waitForTimeout(400);
    eq(await page.evaluate(() => settings.passive.aum.ZFPI), 3500000, "ruční zadání se ukládá bez proplacených obchodů");
    await closeDialogs(page);
    await page.evaluate(() => moveTo(leads.find(l => l.name === "Podepsaný"), "vyplaceno")); await page.waitForTimeout(700);
    const b = await snap();
    eq([b.zAum, b.zDeals, b.dealAum, b.total], [6500000, 3000000, 0, 7000000], "po přesunu do Vyplaceno částka přejde do AUM, součet zůstane");
    assert(Math.abs(b.udr - (7000000 - 500000) * 24 / 1555200 / 12 - 500000 * 12 / 276360 / 12) < 1e-6, "udržovací body po přesunu: " + b.udr);
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },
  async "asistent: tlačítko je vypnuté, dokud ho v nastavení nezapneš (a v prezentačním režimu nikdy)"(env) {
    const { ctx, page, errors } = await openApp(env, { store: STORE });
    eq(await page.evaluate(() => !!document.getElementById("aiFab") && !document.getElementById("aiFab").hidden), false, "bez zapnutí žádné tlačítko");
    await page.evaluate(() => db.doc("settings/main").set({ ...settings, ai: { on: true, url: "https://worker.test" } })); await page.waitForTimeout(300);
    eq(await page.evaluate(() => !document.getElementById("aiFab").hidden), true, "po zapnutí tlačítko je");
    await page.evaluate(() => demoSwitch(true, true)); await page.waitForTimeout(2500);
    eq(await page.evaluate(() => { const f = document.getElementById("aiFab"); return !f || f.hidden }), true, "v prezentačním režimu se schová");
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },

  async "asistent: podpis + online schůzka ve středu → kalendář, fáze, SMS i e-mail s odkazem na Meet"(env) {
    const start = nextDow(3, 17);
    const { ctx, page, errors, calls } = await aiApp(env, { actions: [
      { name: "set_stage", input: { client_name: "Novák", stage: "podpis" } },
      { name: "schedule_meeting", input: { client_name: "Novák", start, online: true, place: "", send_confirmation: true } }] });
    await aiSay(page, "Podepsal jsem smlouvu s Novákem a domluvil jsem si s ním online schůzku ve středu v 17h");
    await page.waitForSelector("dialog[open] .aiPlan:has-text('Potvrzení odesláno')", { timeout: 15000 });
    eq(calls.ai.length, 1, "jedno volání AI");
    eq(calls.ai[0].body.utterance, "Podepsal jsem smlouvu s Novákem a domluvil jsem si s ním online schůzku ve středu v 17h", "text příkazu");
    assert(!JSON.stringify(calls.ai[0].body).includes("Jan Novák"), "seznam klientů do AI neodchází");
    assert(/^Bearer test-token/.test(calls.ai[0].auth), "Worker dostane Google token");
    eq(calls.cal.length, 1, "jedna událost v kalendáři");
    eq(calls.cal[0].summary, "VK: Jan Novák (online)", "název události");
    eq(new Date(calls.cal[0].start.dateTime).getHours(), 17, "17:00");
    const l = await aiLead(page, "Jan Novák");
    eq(l.stage, "podpis", "fáze po schůzce zůstala Podpis");
    eq(l.meetings.length, 1, "schůzka v leadu"); eq(l.meetings[0].id, "ev1", "id události");
    eq(calls.sms.length, 1, "jedna SMS"); eq(calls.sms[0].to, "+420777111222", "číslo");
    assert(calls.sms[0].text.includes(MEET_LINK) && /pane Nováku/.test(calls.sms[0].text), "text SMS: " + calls.sms[0].text);
    eq(calls.mail.length, 1, "jeden e-mail");
    const mime = Buffer.from(calls.mail[0].raw, "base64url").toString("utf8");
    assert(/^To: novak@example\.com/.test(mime), "příjemce e-mailu");
    const body = Buffer.from(mime.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");
    assert(body.includes(MEET_LINK), "odkaz na Meet v e-mailu");
    eq(l.log.filter(x => /automaticky/.test(x.t)).length, 2, "oba odeslané kanály jsou v historii");
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },

  async "asistent: odpočet jde zrušit a nic se neprovede"(env) {
    const { ctx, page, errors, calls } = await aiApp(env, { delay: 20, actions: [{ name: "schedule_meeting", input: { client_name: "Novák", start: nextDow(3, 17), online: false } }] });
    await aiSay(page, "Schůzka s Novákem ve středu v 17");
    await page.waitForSelector("dialog[open] .aiPlan button:has-text('Zrušit')");
    await page.click("dialog[open] .aiPlan button:has-text('Zrušit')");
    await page.waitForSelector("dialog[open] .aiPlan:has-text('Zrušeno')");
    await page.waitForTimeout(500);
    eq([calls.cal.length, calls.sms.length, calls.mail.length], [0, 0, 0], "nic neodešlo");
    const l = await aiLead(page, "Jan Novák");
    eq([l.stage, l.meetings.length], ["kontaktovan", 0], "lead beze změny");
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },

  async "asistent: odpočet doběhne sám a provede jednoznačný plán; zavření okna ho zruší"(env) {
    const { ctx, page, errors, calls } = await aiApp(env, { delay: 2, actions: [{ name: "add_note", input: { client_name: "Novák", text: "Nezvedl telefon" } }] });
    await aiSay(page, "Novák nezvedl telefon");
    await page.waitForSelector("dialog[open] .aiPlan:has-text('✓ Zápis u Jan Novák')", { timeout: 10000 });
    eq((await aiLead(page, "Jan Novák")).log.map(x => x.t), ["Nezvedl telefon"], "zápis v historii");
    await aiSay(page, "Novák ještě jednou");   /* druhý příkaz; okno zavřeme dřív, než doběhne odpočet */
    await page.waitForSelector("dialog[open] .aiPlan button:has-text('Zrušit')");
    await closeDialogs(page); await page.waitForTimeout(3500);
    eq((await aiLead(page, "Jan Novák")).log.length, 1, "po zavření okna se nic dalšího nezapsalo");
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },

  async "asistent: neznámý klient, víc shod a varování se provádí až po klepnutí"(env) {
    const { ctx, page, errors, calls } = await aiApp(env, { delay: 1, leads: { "leads/n2": { name: "Petr Novák", stage: "novy", items: [], _u: 1 } },
      actions: [{ name: "schedule_meeting", input: { client_name: "Procházka", start: nextDow(4, 10), online: false } }] });
    await aiSay(page, "Schůzka s Procházkou ve čtvrtek v 10");
    await page.waitForSelector("dialog[open] .aiPlan:has-text('založím nový kontakt')");
    await page.waitForTimeout(2200);
    eq(calls.cal.length, 0, "bez klepnutí se nic nezapsalo");
    await page.click("dialog[open] .aiPlan button:has-text('Provést')");
    await page.waitForSelector("dialog[open] .aiPlan:has-text('✓ Nový kontakt Procházka')", { timeout: 10000 });
    eq(calls.cal.length, 1, "po klepnutí se zapsalo"); eq(calls.cal[0].summary, "VK: Procházka", "název události");
    eq((await aiLead(page, "Procházka")).stage, "schuzka", "nový lead je ve fázi Schůzka domluvena");
    await closeDialogs(page); await page.waitForTimeout(500);   /* okna se zavírají s animací (340 ms) */
    /* dva Novákové */
    await page.evaluate(() => Assistant.open());
    await page.evaluate(() => { window.__r = null; });
    await ctx.route("https://worker.test/ai", route => route.request().method() === "OPTIONS" ? route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" } })
      : route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: JSON.stringify({ reply: "", actions: [{ name: "add_note", input: { client_name: "Novák", text: "Volal" } }] }) }));
    await page.fill("dialog[open] .aiIn textarea", "Novák volal"); await page.click('dialog[open] .aiIn button[aria-label="Odeslat"]');
    await page.waitForSelector("dialog[open] .aiPlan:has-text('Víc kontaktů pasuje')");
    eq(await page.locator("dialog[open] .aiPlan button:has-text('Provést')").count(), 0, "dokud nevybereš, tlačítko Provést není");
    await page.click("dialog[open] .aiPlan button:has-text('Petr Novák')");
    await page.click("dialog[open] .aiPlan button:has-text('Provést')");
    await page.waitForSelector("dialog[open] .aiPlan:has-text('✓ Zápis u Petr Novák')");
    eq((await aiLead(page, "Jan Novák")).log.length, 0, "Jan Novák zůstal beze změny");
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },

  async "asistent: šablona bez {meet} u online schůzky se neodešle automaticky, nabídne se ruční odeslání"(env) {
    const { ctx, page, errors, calls } = await aiApp(env, { tpls: [TPL_ONLINE], actions: [{ name: "schedule_meeting", input: { client_name: "Novák", start: nextDow(3, 17), online: true } }] });
    await aiSay(page, "Online schůzka s Novákem ve středu v 17");
    await page.waitForSelector("dialog[open] .aiPlan:has-text('neodešlo automaticky')", { timeout: 15000 });
    assert((await page.locator("dialog[open] .aiPlan").innerText()).includes("neobsahuje {meet}"), "důvod je vidět");
    eq(calls.cal.length, 1, "schůzka v kalendáři je");
    eq([calls.sms.length, calls.mail.length], [0, 0], "klient nedostal zprávu bez odkazu");
    await page.click("dialog[open] .aiPlan button:has-text('Poslat ručně')");
    await page.waitForSelector("dialog[open] .msgbox textarea");
    const manual = await page.inputValue("dialog[open] .msgbox textarea");
    assert(manual.includes("potvrzuji naši schůzku") && !manual.includes("[odkaz"), "ruční zpráva se otevřela se šablonou: " + manual);
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },

  async "asistent: bez povolení Gmailu odejde jen SMS; osobní schůzka e-mail neposílá"(env) {
    const { ctx, page, errors, calls } = await aiApp(env, { scope: "calendar.events", tpls: [TPL_ONLINE, TPL_MEET], actions: [
      { name: "schedule_meeting", input: { client_name: "Novák", start: nextDow(3, 17), online: false, place: "Brno" } }] });
    await aiSay(page, "Osobní schůzka s Novákem ve středu v 17 v Brně");
    await page.waitForSelector("dialog[open] .aiPlan:has-text('Potvrzení odesláno: SMS')", { timeout: 15000 });
    eq([calls.sms.length, calls.mail.length], [1, 0], "jen SMS");
    assert(/\(Brno\)/.test(calls.sms[0].text) && !calls.sms[0].text.includes("meet.google"), "text osobní schůzky: " + calls.sms[0].text);
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },

  async "asistent: schůzka v minulosti nebo nesrozumitelný čas se neprovede"(env) {
    const { ctx, page, errors, calls } = await aiApp(env, { actions: [{ name: "schedule_meeting", input: { client_name: "Novák", start: "2020-01-01T10:00", online: false } }] });
    await aiSay(page, "Schůzka s Novákem loni");
    await page.waitForSelector("dialog[open] .aiPlan:has-text('v minulosti')");
    eq(await page.locator("dialog[open] .aiPlan button:has-text('Provést')").count(), 0, "není co provést");
    await page.waitForTimeout(500);
    eq([calls.cal.length, calls.sms.length], [0, 0], "nic neodešlo");
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },

  async "asistent: chyba Workeru se ukáže česky a nic se neprovede"(env) {
    const { ctx, page, errors, calls } = await aiApp(env, { actions: [] });
    await ctx.route("https://worker.test/ai", route => route.request().method() === "OPTIONS" ? route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" } })
      : route.fulfill({ status: 429, headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: JSON.stringify({ error: "Denní limit asistenta je vyčerpaný" }) }));
    await aiSay(page, "Cokoliv");
    await page.waitForSelector("dialog[open] .aiMsg:has-text('Denní limit asistenta je vyčerpaný')");
    eq(calls.cal.length, 0, "nic se neprovedlo");
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },

  async "asistent: nastavení ukáže stav Workeru a nabídne povolení Gmailu"(env) {
    const { ctx, page, errors } = await aiApp(env, { actions: [], scope: "calendar.events" });
    await page.evaluate(() => Assistant.renderSettings(document.getElementById("aiCfg"))); await page.waitForTimeout(500);
    const t = await page.locator("#aiCfg").innerText();
    assert(/Worker běží/.test(t) && /AI nastavená/.test(t) && /SMS brána nastavená/.test(t), "stav Workeru: " + t);
    assert(/Povolit odesílání e-mailů z Gmailu/.test(t), "nabídka povolení Gmailu");
    await ctx.close();
    eq(errors, [], "chyby v konzoli");
  },
};
