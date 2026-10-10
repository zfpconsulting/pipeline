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


/* ---------- AI asistent: běží celý v appce; podvržený je jen Google (kalendář, Gmail) a otevření Zpráv ---------- */
const TPL_ONLINE = { id: "potvrzeni", name: "Potvrzení schůzky", text: "Dobrý den, {osloveni}, potvrzuji naši schůzku {den} {datum} {vcas}{kde}.\n{podpis}" };
const TPL_MEET = { id: "onl", name: "Potvrzení online konzultace", text: "Dobrý den, {osloveni}, potvrzuji naši schůzku {den} {datum} {vcas}{kde}. Zde Vám zasílám odkaz pro připojení: {meet}.\n{podpis}" };
const MEET_LINK = "https://meet.google.com/abc-defg-hij";
const DAY_PH = ["v neděli", "v pondělí", "v úterý", "ve středu", "ve čtvrtek", "v pátek", "v sobotu"];
/* „za n dní“ jako česká věta a jako ISO čas – n = 2…6, ať se nikdy netrefí na dnešek ani na „zítra“ */
const inDays = (n, hour) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(hour, 0, 0, 0);
  const z = x => String(x).padStart(2, "0"); return { say: DAY_PH[d.getDay()], iso: d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "T" + z(hour) + ":00" }; };
async function aiApp(env, { delay = 0, tpls = [TPL_ONLINE, TPL_MEET], leads = {}, ai = {}, scope = "calendar.events gmail.send" } = {}) {
  const store = { ...STORE,
    "settings/main": { ...STORE["settings/main"], calPrefix: "VK:", calId: "primary", tpls, ai: { on: true, delay, sms: true, mail: true, from: "", ...ai } },
    "leads/n1": { name: "Jan Novák", phone: "777 111 222", email: "novak@example.com", stage: "kontaktovan", items: [], meetings: [], log: [], _u: 1 },
    ...leads };
  const { ctx, page, errors } = await openApp(env, { store });
  const calls = { cal: [], mail: [], outside: [] };
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
  const json = (route, obj, status = 200) => route.fulfill({ status, headers: cors, contentType: "application/json", body: JSON.stringify(obj) });
  ctx.on("request", r => { const u = r.url(); if (!/^(http:\/\/localhost|data:|blob:|about:)/.test(u)) calls.outside.push(u); });
  await ctx.route(/googleapis\.com\/(calendar|gmail)/, route => {
    const r = route.request(), u = r.url();
    if (r.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (/gmail/.test(u)) { calls.mail.push(JSON.parse(r.postData())); return json(route, { id: "m1" }); }
    if (r.method() === "POST") { calls.cal.push(JSON.parse(r.postData())); return json(route, { id: "ev1" }); }
    return json(route, { hangoutLink: MEET_LINK, description: "Připojit se přes Google Meet: " + MEET_LINK });
  });
  await page.evaluate(sc => { lsSet("g_tok", { at: "test-token-123456789012345", exp: Date.now() + 36e5, scope: sc }); window.__sms = []; window.aiOpenSms = (tel, text) => window.__sms.push({ tel, text }); }, scope);
  await page.evaluate(() => Assistant.refresh());
  return { ctx, page, errors, calls };
}
const aiSay = async (page, text) => { await page.evaluate(() => Assistant.open()); await page.waitForSelector("dialog[open] .aiIn textarea");
  await page.fill("dialog[open] .aiIn textarea", text); await page.click('dialog[open] .aiIn button[aria-label="Odeslat"]'); };
const aiLead = (page, name) => page.evaluate(n => { const l = leads.find(x => x.name === n); return l ? JSON.parse(JSON.stringify(l)) : null }, name);
const aiSms = page => page.evaluate(() => window.__sms.slice());
/* podvržené rozpoznávání řeči: start() jen počítá, stop() „doslyší“ window.__say a skončí */
const fakeSpeech = (page, say) => page.evaluate(t => {
  window.__say = t; window.__recStarts = 0;
  window.SpeechRecognition = class {
    start() { window.__recStarts++; }
    stop() { const x = window.__say; if (x) this.onresult({ results: [Object.assign([{ transcript: x }], { isFinal: true })] }); this.onend && this.onend(); }
    abort() { this.onend = null; }
  };
}, say);

/* podvržený hlasový výstup: speak() si jen zapíše text a hlas a hned „domluví“ */
const fakeVoice = (page, voices = [{ name: "Daniel", lang: "en-GB" }, { name: "Jakub", lang: "cs-CZ" }, { name: "Zuzana", lang: "cs-CZ" }]) => page.evaluate(vs => {
  window.__spoken = [];
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
    getVoices: () => vs.map(v => ({ ...v, voiceURI: v.name, localService: true })), cancel() {}, addEventListener() {},
    speak(u) { window.__spoken.push({ text: u.text, voice: u.voice && u.voice.name, lang: u.lang }); setTimeout(() => u.onend && u.onend(), 30); } } });
}, voices);
const ymdIn = n => { const d = new Date(); d.setDate(d.getDate() + n); const z = x => String(x).padStart(2, "0"); return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()); };
const dmIn = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.getDate() + "." + (d.getMonth() + 1) + "."; };
const SIKULOVA = { "leads/s1": { name: "Eva Šikulová", phone: "777 333 444", email: "", stage: "kontaktovan", items: [], meetings: [], log: [], _u: 1 } };
const noFocus = page => page.evaluate(() => document.activeElement && document.activeElement.blur());
const voiceBars = page => page.evaluate(() => [...document.querySelectorAll(".aiVoice .veq i")].map(i => i.style.transform).join());

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
    await page.evaluate(() => db.doc("settings/main").set({ ...settings, ai: { on: true } })); await page.waitForTimeout(300);
    eq(await page.evaluate(() => !document.getElementById("aiFab").hidden), true, "po zapnutí tlačítko je");
    await page.evaluate(() => demoSwitch(true, true)); await page.waitForTimeout(2500);
    eq(await page.evaluate(() => { const f = document.getElementById("aiFab"); return !f || f.hidden }), true, "v prezentačním režimu se schová");
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },

  async "asistent: podpis + online schůzka ve středu → kalendář, fáze, e-mail sám, SMS jedním klepnutím, nic jiného nejde ven"(env) {
    const w = inDays(3, 17);
    const { ctx, page, errors, calls } = await aiApp(env);
    await aiSay(page, "Podepsal jsem smlouvu s Novákem a domluvil jsem si s ním online schůzku " + w.say + " v 17h");
    await page.waitForSelector("dialog[open] .aiPlan:has-text('Potvrzení (Jan Novák)')", { timeout: 15000 });
    eq(calls.cal.length, 1, "jedna událost v kalendáři");
    eq(calls.cal[0].summary, "VK: Jan Novák (online)", "název události");
    eq(new Date(calls.cal[0].start.dateTime).getHours(), 17, "17:00");
    const l = await aiLead(page, "Jan Novák");
    eq(l.stage, "podpis", "fáze po schůzce zůstala Podpis");
    eq(l.meetings.length, 1, "schůzka v leadu"); eq(l.meetings[0].id, "ev1", "id události");
    eq(calls.mail.length, 1, "jeden e-mail, odešel sám");
    const mime = Buffer.from(calls.mail[0].raw, "base64url").toString("utf8");
    assert(/^To: novak@example\.com/.test(mime), "příjemce e-mailu");
    const body = Buffer.from(mime.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");
    assert(body.includes(MEET_LINK), "odkaz na Meet v e-mailu");
    eq(await aiSms(page), [], "SMS sama neodešla – čeká na klepnutí");
    await page.click("dialog[open] .aiPlan button:has-text('Odeslat SMS: Jan Novák')");
    const sms = await aiSms(page);
    eq(sms.length, 1, "po klepnutí se otevřely Zprávy"); eq(sms[0].tel, "+420777111222", "číslo");
    assert(sms[0].text.includes(MEET_LINK) && /pane Nováku/.test(sms[0].text), "text SMS: " + sms[0].text);
    const after = await aiLead(page, "Jan Novák");
    eq([after.log.filter(x => /automaticky/.test(x.t)).length, after.log.filter(x => /\(SMS\)/.test(x.t)).length], [1, 1], "e-mail i SMS jsou v historii");
    eq(calls.outside.filter(u => !/googleapis\.com\/(calendar|gmail)/.test(u) && !/script\.google\.com|frankfurter|accounts\.google/.test(u)), [], "kromě Googlu nic neodešlo ven");
    assert(!calls.outside.some(u => /anthropic|workers\.dev|worker\.test|twilio/.test(u)), "žádná AI služba ani Worker");
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },

  async "asistent: odpočet jde zrušit a nic se neprovede"(env) {
    const { ctx, page, errors, calls } = await aiApp(env, { delay: 20 });
    await aiSay(page, "Schůzka s Novákem " + inDays(3, 17).say + " v 17");
    await page.waitForSelector("dialog[open] .aiPlan button:has-text('Zrušit')");
    await page.click("dialog[open] .aiPlan button:has-text('Zrušit')");
    await page.waitForSelector("dialog[open] .aiPlan:has-text('Zrušeno')");
    await page.waitForTimeout(500);
    eq([calls.cal.length, calls.mail.length, (await aiSms(page)).length], [0, 0, 0], "nic neodešlo");
    const l = await aiLead(page, "Jan Novák");
    eq([l.stage, l.meetings.length], ["kontaktovan", 0], "lead beze změny");
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },

  async "asistent: odpočet doběhne sám a provede jednoznačný příkaz, funguje i offline; zavření okna ho zruší"(env) {
    const { ctx, page, errors } = await aiApp(env, { delay: 2 });
    await ctx.setOffline(true);
    await aiSay(page, "Poznámka k Novákovi: nezvedl telefon");
    await page.waitForSelector("dialog[open] .aiPlan:has-text('✓ Zápis u Jan Novák')", { timeout: 10000 });
    eq((await aiLead(page, "Jan Novák")).log.map(x => x.t), ["nezvedl telefon"], "zápis v historii, bez internetu");
    await aiSay(page, "Poznámka k Novákovi: ještě jednou");   /* druhý příkaz; okno zavřeme dřív, než doběhne odpočet */
    await page.waitForSelector("dialog[open] .aiPlan button:has-text('Zrušit')");
    await closeDialogs(page); await page.waitForTimeout(3500);
    eq((await aiLead(page, "Jan Novák")).log.length, 1, "po zavření okna se nic dalšího nezapsalo");
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },

  async "asistent: neznámý klient (jde opravit jméno) a víc Nováků se provádí až po klepnutí"(env) {
    const w = inDays(4, 10);
    const { ctx, page, errors, calls } = await aiApp(env, { delay: 1, leads: { "leads/n2": { name: "Petr Novák", stage: "novy", items: [], _u: 1 } } });
    await aiSay(page, "Schůzka s Hanou Procházkovou " + w.say + " v 10");
    await page.waitForSelector("dialog[open] .aiPlan:has-text('založím nový kontakt')");
    eq(await page.inputValue("dialog[open] .aiPlan input[aria-label='Jméno nového kontaktu']"), "Hana Procházková", "jméno v 1. pádu");
    await page.fill("dialog[open] .aiPlan input[aria-label='Jméno nového kontaktu']", "Hana Procházková-Nováková"); await page.keyboard.press("Tab");
    await page.waitForTimeout(2200);
    eq(calls.cal.length, 0, "bez klepnutí se nic nezapsalo");
    await page.click("dialog[open] .aiPlan button:has-text('Provést')");
    await page.waitForSelector("dialog[open] .aiPlan:has-text('✓ Nový kontakt Hana Procházková-Nováková')", { timeout: 10000 });
    eq(calls.cal.length, 1, "po klepnutí se zapsalo"); assert(/Procházková-Nováková/.test(calls.cal[0].summary), "název události: " + calls.cal[0].summary);
    eq((await aiLead(page, "Hana Procházková-Nováková")).stage, "schuzka", "nový lead je ve fázi Schůzka domluvena");
    await closeDialogs(page); await page.waitForTimeout(500);   /* okna se zavírají s animací (340 ms) */
    /* dva Novákové */
    await aiSay(page, "Poznámka k Novákovi: volal");
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
    const { ctx, page, errors, calls } = await aiApp(env, { tpls: [TPL_ONLINE] });
    await aiSay(page, "Online schůzka s Novákem " + inDays(3, 17).say + " v 17");
    await page.waitForSelector("dialog[open] .aiPlan:has-text('neodešlo automaticky')", { timeout: 15000 });
    assert((await page.locator("dialog[open] .aiPlan").innerText()).includes("neobsahuje {meet}"), "důvod je vidět");
    eq(calls.cal.length, 1, "schůzka v kalendáři je");
    eq([calls.mail.length, (await aiSms(page)).length], [0, 0], "klient nedostal zprávu bez odkazu");
    await page.click("dialog[open] .aiPlan button:has-text('Poslat ručně')");
    await page.waitForSelector("dialog[open] .msgbox textarea");
    const manual = await page.inputValue("dialog[open] .msgbox textarea");
    assert(manual.includes("potvrzuji naši schůzku") && !manual.includes("[odkaz"), "ruční zpráva se otevřela se šablonou: " + manual);
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },

  async "asistent: bez povolení Gmailu se u osobní schůzky připraví jen SMS s místem"(env) {
    const { ctx, page, errors, calls } = await aiApp(env, { scope: "calendar.events" });
    await aiSay(page, "Osobní schůzka s Novákem " + inDays(3, 17).say + " v 17 v Brně");
    await page.waitForSelector("dialog[open] .aiPlan button:has-text('Odeslat SMS: Jan Novák')", { timeout: 15000 });
    await page.click("dialog[open] .aiPlan button:has-text('Odeslat SMS: Jan Novák')");
    const sms = await aiSms(page);
    eq([calls.mail.length, sms.length], [0, 1], "jen SMS");
    assert(/\(v Brně\)/.test(sms[0].text) && !sms[0].text.includes("meet.google"), "text osobní schůzky: " + sms[0].text);
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },

  async "asistent: chybí hodina nebo je schůzka v minulosti → ptá se / neprovede se"(env) {
    const { ctx, page, errors, calls } = await aiApp(env);
    await aiSay(page, "Schůzka s Novákem " + inDays(3, 17).say);
    await page.waitForSelector("dialog[open] .aiMsg:has-text('chybí')");
    eq(await page.locator("dialog[open] .aiPlan").count(), 0, "bez hodiny žádný plán");
    await page.fill("dialog[open] .aiIn textarea", "Schůzka s Novákem 1. 1. 2020 v 10:00"); await page.click('dialog[open] .aiIn button[aria-label="Odeslat"]');
    await page.waitForSelector("dialog[open] .aiPlan:has-text('v minulosti')");
    eq(await page.locator("dialog[open] .aiPlan button:has-text('Provést')").count(), 0, "není co provést");
    await page.fill("dialog[open] .aiIn textarea", "Jak se máš"); await page.click('dialog[open] .aiIn button[aria-label="Odeslat"]');
    await page.waitForSelector("dialog[open] .aiMsg:has-text('Nerozuměla jsem')");
    await page.waitForTimeout(500);
    eq([calls.cal.length, calls.mail.length, (await aiSms(page)).length], [0, 0, 0], "nic neodešlo");
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },

  async "asistent: mezerník rozmaže appku, ukáže ekvalizér, po diktátu provede příkaz a odpoví ženským hlasem"(env) {
    const { ctx, page, errors, calls } = await aiApp(env, { leads: SIKULOVA });
    await fakeSpeech(page, "S paní Šikulovou jsem domluvený na schůzku " + dmIn(20) + " v 15h");
    await fakeVoice(page); await noFocus(page);
    await page.keyboard.press("Space");
    await page.waitForSelector(".aiVoice.on");
    eq(await page.evaluate(() => /blur/.test(getComputedStyle(document.querySelector(".aiVoice")).backdropFilter)), true, "celá appka je rozmazaná");
    eq(await page.locator(".aiVoice .veq i").count(), 25, "ekvalizér má sloupce");
    eq(await page.evaluate(() => window.__recStarts), 1, "poslech se spustil sám");
    assert(/Poslouchám/.test(await page.locator(".aiVoice .vstate").innerText()), "stav: poslouchá");
    const b1 = await voiceBars(page); await page.waitForTimeout(350);
    assert(b1 !== await voiceBars(page), "ekvalizér se hýbe");
    await page.keyboard.press("Space");   /* druhý stisk = konec poslechu → příkaz se zpracuje */
    await page.waitForSelector(".aiVoice .aiPlan:has-text('✓ Schůzka Eva Šikulová')", { timeout: 10000 });
    eq(calls.cal.length, 1, "schůzka je v kalendáři");
    assert(/VK: Eva Šikulová/.test(calls.cal[0].summary), "název události: " + calls.cal[0].summary);
    assert(/Šikulovou/.test(await page.locator(".aiVoice .vtext").innerText()), "přepis je vidět");
    await page.waitForFunction(() => window.__spoken.length >= 1);
    const sp = await page.evaluate(() => window.__spoken);
    assert(/^Schůzka: Eva Šikulová, (v|ve) \S+ \d+\. \S+ v 15 hodin, osobně\. Hotovo\. SMS je připravená, klepni na Odeslat\.$/.test(sp[0].text), "řekla: " + sp[0].text);
    eq([sp[0].voice, sp[0].lang], ["Zuzana", "cs-CZ"], "ženský český hlas");
    await page.waitForFunction(() => /Mezerník = další příkaz/.test(document.querySelector(".aiVoice .vstate").textContent));
    eq((await aiSms(page)).length, 0, "SMS sama neodešla");
    await page.click(".aiVoice button:has-text('Odeslat SMS')");
    eq((await aiSms(page)).length, 1, "SMS se otevřela po klepnutí");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".aiVoice"));
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },

  async "asistent: příkaz s odpočtem se novým mezerníkem zruší a nic se neprovede"(env) {
    const { ctx, page, errors, calls } = await aiApp(env, { delay: 30, leads: SIKULOVA });
    await fakeSpeech(page, "S paní Šikulovou jsem domluvený na schůzku " + dmIn(20) + " v 15h");
    await fakeVoice(page); await noFocus(page);
    await page.keyboard.press("Space"); await page.waitForSelector(".aiVoice.on");
    await page.keyboard.press("Space");
    await page.waitForSelector(".aiVoice .aiPlan:has-text('Zrušit (')", { timeout: 10000 });
    await page.waitForFunction(() => window.__spoken.length >= 1);
    assert(/Provedu to za 30 sekund, nebo klepni na Zrušit\.$/.test((await page.evaluate(() => window.__spoken))[0].text), "řekla odpočet");
    await page.keyboard.press("Space");   /* nový poslech ruší čekající příkaz – a je to vidět */
    await page.waitForSelector(".aiVoice .aiPlan:has-text('Zrušeno – nic se neprovedlo.')");
    eq(await page.evaluate(() => window.__recStarts), 2, "poslouchá znovu");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    eq([calls.cal.length, calls.mail.length, (await aiSms(page)).length], [0, 0, 0], "nic neodešlo");
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },

  async "asistent: odpovídá na dotazy z dat appky – úkoly, schůzky, výsledky (klepnutím na tlačítko i mezerníkem)"(env) {
    const tmr = new Date(); tmr.setDate(tmr.getDate() + 1); tmr.setHours(10, 0, 0, 0);
    const { ctx, page, errors } = await aiApp(env, { leads: {
      "mytasks/t1": { text: "Marcinčákovi call schůzku", client: "Marcinčák", due: ymdIn(-5), createdAt: "2026-10-01T10:00:00Z" },
      "mytasks/t2": { text: "Poslat podklady", due: ymdIn(0), createdAt: "2026-10-02T10:00:00Z" },
      "leads/c1": { name: "Veronika Kudličková", stage: "kontaktovan", nextDate: ymdIn(0), nextStep: "Zavolat", items: [], meetings: [], log: [], _u: 1 },
      "leads/m1": { name: "Petr Dvořák", stage: "schuzka", items: [], meetings: [{ id: "local:7", start: tmr.toISOString(), title: "Petr Dvořák", online: true }], log: [], _u: 1 } } });
    await page.evaluate(() => {   /* výpočet provizí je v testovací kopii zaslepený – dosadí se pevná čísla */
      window.goalInfo = () => ({ cq: "2026-Q4", cur: { total: 162.4, earned: 24365, rate: 150 }, nx: { rate: 160, t: "P5" }, need: 535, perWeek: 41.2, days: 82 });
      window.quarterRow = () => ({ rate: 150 }); window.monthPoints = () => ({ total: 100 });
    });
    await fakeSpeech(page, "Co mám dneska v úkolech"); await fakeVoice(page);
    await page.click("#aiFab"); await page.waitForSelector(".aiVoice.on");
    eq(await page.evaluate(() => window.__recStarts), 1, "tlačítko rovnou poslouchá");
    await page.keyboard.press("Space");
    await page.waitForSelector(".aiVoice .vans");
    const t1 = await page.locator(".aiVoice .vans").innerText();
    assert(/Dnes máš 2 úkoly: Marcinčákovi call schůzku, po termínu od .*; Poslat podklady\./.test(t1), "úkoly: " + t1);
    assert(/K telefonování: Veronika Kudličková\./.test(t1), "telefonáty: " + t1);
    await page.waitForFunction(() => window.__spoken.length >= 1);
    assert(/^Dnes máš 2 úkoly: Marcinčákovi call schůzku/.test((await page.evaluate(() => window.__spoken))[0].text), "hlas čte odpověď");
    await page.waitForFunction(() => /Mezerník = další příkaz/.test(document.querySelector(".aiVoice .vstate").textContent));
    /* další dotaz: mezerník znovu poslouchá, odpověď nahradí předchozí */
    await page.evaluate(() => { window.__say = "Co mám zítra v kalendáři"; });
    await page.keyboard.press("Space"); await page.waitForFunction(() => window.__recStarts === 2);
    await page.keyboard.press("Space");
    await page.waitForSelector(".aiVoice .vans:has-text('Petr Dvořák, v 10 hodin, online')");
    await page.waitForFunction(() => window.__spoken.length >= 2);
    await page.waitForFunction(() => /Mezerník = další příkaz/.test(document.querySelector(".aiVoice .vstate").textContent));
    await page.evaluate(() => { window.__say = "Jaké jsou moje aktuální výsledky"; });
    await page.keyboard.press("Space"); await page.waitForFunction(() => window.__recStarts === 3);
    await page.keyboard.press("Space");
    await page.waitForSelector(".aiVoice .vans:has-text('čtvrtletí')");
    const t3 = (await page.locator(".aiVoice .vans").innerText()).replace(/ /g, " ");
    assert(/Ve 4\. čtvrtletí 2026 máš 162,4 bodu, to je asi 24 365 korun při sazbě 150 korun za bod\./.test(t3), "výsledky: " + t3);
    await page.waitForFunction(() => window.__spoken.length >= 3);
    assert(/24365 korun/.test((await page.evaluate(() => window.__spoken))[2].text), "čísla se čtou bez mezer");
    eq((await page.evaluate(() => window.__spoken)).every(x => x.voice === "Zuzana"), true, "pořád stejný ženský hlas");
    await page.keyboard.press("Escape");
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },

  async "asistent: bez českého hlasu odpověď jen zobrazí a nemluví"(env) {
    const { ctx, page, errors } = await aiApp(env);
    await fakeSpeech(page, "Co mám zítra v kalendáři"); await fakeVoice(page, [{ name: "Daniel", lang: "en-GB" }]); await noFocus(page);
    await page.keyboard.press("Space"); await page.waitForSelector(".aiVoice.on"); await page.keyboard.press("Space");
    await page.waitForSelector(".aiVoice .vans:has-text('Zítra nemáš žádnou schůzku.')");
    await page.waitForTimeout(300);
    eq(await page.evaluate(() => window.__spoken.length), 0, "cizím hlasem česky nemluví");
    assert(/Mezerník = další příkaz/.test(await page.locator(".aiVoice .vstate").innerText()), "vrátí se do klidu");
    await page.keyboard.press("Escape");
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },

  async "asistent: mezerník nepřebíjí psaní, jiná okna ani klávesnicí vybraná tlačítka a jde vypnout"(env) {
    const { ctx, page, errors } = await aiApp(env);
    await fakeSpeech(page, "");
    await page.evaluate(() => Assistant.open()); await page.waitForSelector("dialog[open] .aiIn textarea");
    await page.click("dialog[open] .aiIn textarea"); await page.keyboard.type("ahoj světe");
    eq(await page.inputValue("dialog[open] .aiIn textarea"), "ahoj světe", "do pole se píšou mezery normálně");
    eq(await page.evaluate(() => window.__recStarts || 0), 0, "při psaní se nediktuje");
    await page.fill("dialog[open] .aiIn textarea", ""); await page.keyboard.press("Space");
    await page.waitForFunction(() => window.__recStarts === 1);   /* prázdné pole asistenta: mezerník spustí diktování */
    await page.keyboard.press("Space");
    await closeDialogs(page); await page.waitForTimeout(500);
    /* jiné okno (např. karta klienta) – mezerník ho nesmí přebít */
    await page.evaluate(() => openSheet("Něco jiného", [])); await page.waitForTimeout(100);
    await page.keyboard.press("Space"); await page.waitForTimeout(200);
    eq(await page.evaluate(() => [window.__recStarts, document.getElementById("edTitle").textContent]), [1, "Něco jiného"], "jiné okno zůstalo");
    await closeDialogs(page); await page.waitForTimeout(500);
    /* tlačítko vybrané klávesnicí (Tab) dál reaguje na mezerník jako dřív (první je právě tlačítko asistenta: jednou ho aktivuje) */
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press("Tab"); await page.keyboard.press("Space"); await page.waitForTimeout(300);
    eq(await page.evaluate(() => [window.__recStarts, document.querySelectorAll(".aiVoice").length]), [2, 1], "Tab + mezerník: tlačítko se aktivuje jednou (otevře hlasové okno), mezerník ho nepřebíjí");
    await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.querySelector(".aiVoice")); await page.waitForTimeout(300);
    /* vypnuto v nastavení */
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.evaluate(() => db.doc("settings/main").set({ ...settings, ai: { ...settings.ai, hotkey: false } })); await page.waitForTimeout(300);
    await page.keyboard.press("Space"); await page.waitForTimeout(200);
    eq(await page.evaluate(() => [window.__recStarts, !!document.querySelector(".aiVoice")]), [2, false], "po vypnutí mezerník nic nedělá");
    eq(errors, [], "chyby v konzoli");
    await ctx.close();
  },

  async "asistent: nastavení neobsahuje žádný server ani klíč, nabídne povolení Gmailu a vybere český hlas"(env) {
    const { ctx, page, errors } = await aiApp(env, { scope: "calendar.events" });
    await fakeVoice(page);
    await page.evaluate(() => Assistant.renderSettings(document.getElementById("aiCfg"))); await page.waitForTimeout(300);
    const t = await page.locator("#aiCfg").innerText();
    assert(/Žádná AI služba/.test(t) && !/Worker|Anthropic|klíč/.test(t), "texty nastavení: " + t);
    assert(/Chrome a Edge posílají nahrávku/.test(t), "upozornění, kam jde diktování: " + t);
    assert(/Odpovídat hlasem/.test(t), "přepínač hlasu");
    assert(/Povolit odesílání e-mailů z Gmailu/.test(t), "nabídka povolení Gmailu");
    eq(await page.locator("#aiCfg input[placeholder*='workers.dev']").count(), 0, "žádné pole pro adresu serveru");
    eq(await page.locator("#aiCfg select option").allInnerTexts(), ["Hlas: automaticky (Zuzana)", "Jakub", "Zuzana"], "nabídka českých hlasů");
    await page.evaluate(() => [...document.querySelectorAll("#aiCfg button")].find(b => /Vyzkoušet/.test(b.textContent)).click()); await page.waitForFunction(() => window.__spoken.length === 1);
    eq((await page.evaluate(() => window.__spoken))[0].voice, "Zuzana", "ukázka mluví vybraným hlasem");
    await ctx.close();
    eq(errors, [], "chyby v konzoli");
  },
};
