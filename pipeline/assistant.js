/* Asistent v Pipeline: hlasový nebo psaný příkaz → plán akcí (schůzka, fáze, nový lead, zápis) → po krátkém okně na zrušení
   se provede stávajícími funkcemi appky a klientovi se pošle potvrzení ze šablony (e-mail přes Gmail sám, SMS jedním klepnutím).

   Základ běží přímo v zařízení: větu rozebírá pravidlový parser češtiny níže (understand), žádná AI služba, žádný server,
   žádné předplatné a z appky nic neodchází (kromě e-mailu klientovi přes tvůj Gmail). Diktování obstarává systém (Web Speech API / klávesnice).
   Volitelně chytrý režim (jarvis.js, Gemini od Googlu, vlastní bezplatný klíč): volná konverzace, živý hovor, nástroje nad daty pipeline.
   Zápisy z něj jdou stejnou cestou jako z parseru (buildPlan → karta s odpočtem → execute), model nic neprovádí sám.

   Čistá logika (párování jmen, čas, rozbor věty, plán akcí, MIME e-mail) nezávisí na prohlížeči a má testy: tests/assistant.run.mjs.
   Assistant.init(host) – host dodává funkce appky (viz konec souboru); Assistant.refresh() po změně nastavení. */
(function (root, factory) {
  const A = factory(root);
  if (typeof module === "object" && module.exports) module.exports = A; else root.Assistant = A;
})(typeof self !== "undefined" ? self : this, function (root) {
"use strict";

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const MIN = 60000;

/* ================= čistá logika ================= */
const norm = s => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const TITLE_RE = /^(prof|doc|judr|mudr|phdr|rndr|paeddr|mvdr|pharmdr|thdr|phmr|dr|ing|mgr|bc|ba|bsc|mba|phd|csc|dis|llm|msc)$/;
const words = s => norm(String(s == null ? "" : s).replace(/ph\.?\s*d\.?/gi, " ")).split(" ").filter(w => w && !TITLE_RE.test(w));

/* 2 = stejné slovo, 1 = stejný základ (Novák/Nováku/Novákem/Nováková, Svoboda/Svobodou), 0 = jiné */
function sim(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 2;
  const m = Math.min(a.length, b.length);
  let i = 0; while (i < m && a[i] === b[i]) i++;
  return m >= 4 && i >= Math.max(4, m - 2) && Math.abs(a.length - b.length) <= 4 ? 1 : 0;
}

/* leads: [{id,name,...}] → kandidáti seřazení podle shody (příjmení je poslední slovo jména) */
function matchLeads(name, leads) {
  const q = words(name);
  if (!q.length) return [];
  const qs = q[q.length - 1], qf = q.length > 1 ? q[0] : "";
  const out = [];
  for (const l of leads || []) {
    const w = words(l && l.name);
    if (!w.length) continue;
    const ls = w[w.length - 1], lf = w.length > 1 ? w[0] : "";
    const ss = sim(qs, ls);
    if (!ss) continue;
    let score = ss === 2 ? 80 : 60;
    if (qf && lf) {
      if (qf === lf) score += 15;
      else if (qf.length === 1 && lf[0] === qf) score += 5;
      else if (sim(qf, lf) === 1 && qf.length >= 4) score += 0;
      else score -= 50;
    }
    if (score >= 60) out.push({ lead: l, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

/* exact = jednoznačná přesná shoda; fuzzy = jen podobné jméno (jiný tvar/rod) → chce potvrzení; ambiguous = víc kandidátů */
function resolveClient(name, leads) {
  const c = matchLeads(name, leads);
  if (!c.length) return { kind: "none", candidates: [] };
  const cands = c.slice(0, 5).map(x => x.lead);
  if (c.length === 1 || c[0].score - c[1].score >= 20) return { kind: c[0].score >= 80 ? "exact" : "fuzzy", lead: c[0].lead, candidates: cands };
  return { kind: "ambiguous", candidates: cands };
}

function parseLocal(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(s || ""));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  if (isNaN(d) || d.getFullYear() !== +m[1] || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3] || d.getHours() !== +m[4]) return null;
  return d;
}
const z2 = n => String(n).padStart(2, "0");
const DOW_SHORT = ["ne", "po", "út", "st", "čt", "pá", "so"];
const fmtWhen = d => DOW_SHORT[d.getDay()] + " " + d.getDate() + ". " + (d.getMonth() + 1) + ". " + z2(d.getHours()) + ":" + z2(d.getMinutes());

/* kontrola času schůzky: problems = nejde provést, warnings = provést jen po potvrzení */
function checkMeeting(d, now, calEvents, minutes) {
  const problems = [], warnings = [];
  const len = (minutes || 60) * MIN;
  if (d.getTime() < now.getTime() - 5 * MIN) problems.push("Čas schůzky (" + fmtWhen(d) + ") je v minulosti.");
  else if (d.getTime() > now.getTime() + 400 * 864e5) problems.push("Schůzka je za víc než rok (" + fmtWhen(d) + ") – asi chyba v datu.");
  if (!problems.length) {
    if (d.getHours() < 7 || d.getHours() >= 21) warnings.push("Neobvyklý čas " + z2(d.getHours()) + ":" + z2(d.getMinutes()) + " – nebylo to jinak?");
    const clash = (calEvents || []).find(e => e && e.start && Math.abs(new Date(e.start).getTime() - d.getTime()) < len);
    if (clash) warnings.push("V kalendáři už v tu dobu máš „" + (clash.title || clash.name || "událost") + "“ (" + fmtWhen(new Date(clash.start)) + ").");
  }
  return { problems, warnings };
}

function normPhone(v) {
  let t = String(v || "").replace(/[^\d+]/g, "").replace(/^00/, "+");
  if (/^\d{9}$/.test(t)) t = "+420" + t;
  if (/^(420|421)\d{9}$/.test(t)) t = "+" + t;
  return /^\+(420|421)\d{9}$/.test(t) ? t : "";
}
const validEmail = v => /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(String(v || "").trim());
const hasPlaceholders = text => /\[[^\]\n]{1,60}\]/.test(String(text || ""));

/* ---- MIME e-mail pro Gmail API (users.messages.send, pole raw = base64url) ---- */
function bytesB64(bytes) { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
const enc = s => new TextEncoder().encode(s);
const b64url = b => b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const noCRLF = s => String(s == null ? "" : s).replace(/[\r\n]+/g, " ").trim();
function encodeWord(text) {
  text = noCRLF(text);
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  const parts = []; let cur = "";
  for (const ch of text) { if (enc(cur + ch).length > 42) { parts.push(cur); cur = ""; } cur += ch; }
  if (cur) parts.push(cur);
  return parts.map(p => "=?UTF-8?B?" + bytesB64(enc(p)) + "?=").join("\r\n ");
}
function mimeEmail({ to, subject, body, from }) {
  if (!validEmail(to)) throw new Error("Neplatný e-mail příjemce");
  const b = bytesB64(enc(String(body || "").replace(/\r?\n/g, "\r\n"))).replace(/(.{76})/g, "$1\r\n");
  const head = ["To: " + noCRLF(to)];
  if (from && validEmail(from)) head.push("From: " + noCRLF(from));
  head.push("Subject: " + encodeWord(subject), "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64");
  return b64url(bytesB64(enc(head.join("\r\n") + "\r\n\r\n" + b)));
}

/* která šablona potvrzení se použije: u online schůzky ta s {meet} (odkaz), u osobní ta bez něj; vždy první, co sedí na „potvrzení“ */
function pickTemplate(list, online) {
  const T = (list || []).filter(t => t && typeof t.text === "string");
  const meet = t => /\{meet\}/.test(t.text), confirm = t => /potvrz/i.test((t.name || "") + " " + (t.id || ""));
  const fit = T.filter(t => meet(t) === !!online);
  return fit.find(t => t.id === "potvrzeni") || fit.find(confirm) || (online ? fit.find(t => /online|konzult/i.test(t.name || "")) : null) || T.find(t => t.id === "potvrzeni") || T[0] || null;
}

/* schůzka u stejného klienta ve stejnou dobu už existuje (např. příkaz řečený dvakrát) → ať se nezdvojí ani neodešle druhé potvrzení */
const dupMeeting = (lead, d) => lead && (lead.meetings || []).find(m => m && m.start && Math.abs(new Date(m.start).getTime() - d.getTime()) < 30 * MIN);
const dupText = (lead, m) => "U „" + lead.name + "“ už schůzka v tu dobu je (" + fmtWhen(new Date(m.start)) + ") – nezdvojuju ji? Klient by dostal další potvrzení.";

/* ---- plán akcí z odpovědi AI ---- */
const ORDER = { add_lead: 0, meeting: 1, note: 2, stage: 3 };
const STAGE_TITLES = { novy: "Nový lead", kontaktovan: "Kontaktován", schuzka: "Schůzka domluvena", probehla: "Schůzka proběhla", nabidka: "Nabídka odeslána", podpis: "Podpis", vyplaceno: "Provize vyplacena", zamrzly: "Zamrzlý", lost: "Lost" };
const SIGNED = s => s === "podpis" || s === "vyplaceno";

/* res = {reply, actions:[{name,input}]}; env = {leads, now, calEvents, meetMinutes} */
function buildPlan(res, env) {
  const now = env.now || new Date();
  const plan = { reply: String((res && res.reply) || "").trim(), steps: [], problems: [], warnings: Array.isArray(res && res.warnings) ? res.warnings.map(String) : [], notes: Array.isArray(res && res.notes) ? res.notes.map(String) : [] };
  const acts = Array.isArray(res && res.actions) ? res.actions.slice(0, 8) : [];
  const created = new Map();   /* nové leady z téhle věty (klíč = slova jména) */

  const bind = (raw, allowCreate) => {
    const name = String(raw || "").trim();
    const mine = resolveClient(name, [...created.values()]);
    if (mine.kind === "exact" || mine.kind === "fuzzy") return { newRef: mine.lead, kind: "new" };
    const r = resolveClient(name, env.leads);
    if (r.kind === "exact" || r.kind === "fuzzy") return { lead: r.lead, kind: r.kind, candidates: r.candidates };
    if (r.kind === "ambiguous") return { lead: null, kind: "ambiguous", candidates: r.candidates };
    if (allowCreate) {
      const st = { type: "add_lead", name, phone: "", email: "", source: "", implicit: true, kind: "new" };
      plan.steps.push(st); created.set(words(name).join(" "), st);
      return { newRef: st, kind: "new" };
    }
    plan.problems.push("Klienta „" + name + "“ v pipeline nemám.");
    return null;
  };

  for (const a of acts) {
    if (!a || typeof a !== "object") continue;
    const i = a.input || {};
    if (a.name === "add_lead") {
      const name = String(i.name || "").trim(), r = resolveClient(name, env.leads), key = words(name).join(" ");
      if (!name || created.has(key) || resolveClient(name, [...created.values()]).kind === "exact") continue;
      if (r.kind === "exact") { plan.warnings.push("Kontakt „" + r.lead.name + "“ už v pipeline je – nový nezakládám."); continue; }
      const st = { type: "add_lead", name, phone: normPhone(i.phone) || String(i.phone || "").trim(), email: validEmail(i.email) ? String(i.email).trim() : "", source: i.source || "", kind: "new" };
      if (r.kind !== "none") { st.similar = r.candidates; plan.warnings.push("Podobný kontakt už v pipeline je: " + r.candidates.map(c => c.name).join(", ") + "."); }
      plan.steps.push(st); created.set(key, st);
    } else if (a.name === "schedule_meeting") {
      const d = parseLocal(i.start);
      if (!d) { plan.problems.push("Nerozumím času schůzky („" + (i.start || "") + "“)."); continue; }
      const chk = checkMeeting(d, now, env.calEvents, env.meetMinutes);
      plan.problems.push(...chk.problems); plan.warnings.push(...chk.warnings);
      const b = bind(i.client_name, true);
      if (!b) continue;
      /* tutéž schůzku dvakrát v jedné větě nezakládáme (klient by dostal dvě potvrzení) */
      if (plan.steps.some(s => s.type === "meeting" && s.start.getTime() === d.getTime() && ((s.lead && b.lead && s.lead.id === b.lead.id) || (s.newRef && s.newRef === b.newRef)))) continue;
      const dup = dupMeeting(b.lead, d);
      if (dup) plan.warnings.push(dupText(b.lead, dup));
      plan.steps.push({ type: "meeting", client_name: i.client_name, ...b, start: d, online: i.online === true, place: String(i.place || "").trim(), confirm: i.send_confirmation !== false });
    } else if (a.name === "set_stage") {
      if (!STAGE_TITLES[i.stage]) continue;
      const b = bind(i.client_name, false);
      if (!b) continue;
      if (b.lead && b.lead.stage === i.stage && b.kind !== "ambiguous") { plan.notes.push(b.lead.name + " už ve fázi „" + STAGE_TITLES[i.stage] + "“ je."); continue; }
      if (b.lead && SIGNED(b.lead.stage) && i.stage === "lost") { plan.problems.push("Podepsaný obchod (" + b.lead.name + ") nejde dát do Lost."); continue; }
      if (i.stage === "podpis") plan.notes.push("Podpis zapíšu bez produktů a bodů – doplň je v kartě klienta.");
      plan.steps.push({ type: "stage", client_name: i.client_name, ...b, stage: i.stage });
    } else if (a.name === "add_note") {
      const b = bind(i.client_name, false);
      if (!b || !String(i.text || "").trim()) continue;
      plan.steps.push({ type: "note", client_name: i.client_name, ...b, text: String(i.text).trim() });
    }
  }
  plan.steps = plan.steps.map((s, idx) => [s, idx]).sort((x, y) => ORDER[x[0].type] - ORDER[y[0].type] || x[1] - y[1]).map(x => x[0]);
  plan.notes = [...new Set(plan.notes)];
  return plan;
}

const unresolved = plan => plan.steps.filter(s => s.kind === "ambiguous" && !s.lead);
/* jde plán provést? (bez problémů, bez nevyřešených výběrů, aspoň jeden krok) */
const runnable = plan => !plan.problems.length && !unresolved(plan).length && plan.steps.length > 0;
/* automaticky po odpočtu smí běžet jen jednoznačný plán bez varování */
const autoOk = plan => runnable(plan) && !plan.warnings.length && !plan.steps.some(s => s.kind === "fuzzy" || s.kind === "ambiguous" || s.kind === "chosen" || s.implicit || s.similar);
function pickLead(plan, step, lead) {
  step.lead = lead; step.kind = "chosen";
  if (step.type === "meeting") { const dup = dupMeeting(lead, step.start); if (dup && !plan.warnings.includes(dupText(lead, dup))) plan.warnings.push(dupText(lead, dup)); }
  return plan;
}
const leadLabel = s => (s.lead && s.lead.name) || (s.newRef && s.newRef.name) || s.client_name || s.name || "";
function describeStep(s) {
  if (s.type === "add_lead") return "Nový kontakt: " + s.name + (s.source ? " · " + s.source : "") + (s.phone ? " · " + s.phone : "") + (s.email ? " · " + s.email : "");
  if (s.type === "meeting") return "Schůzka: " + leadLabel(s) + " · " + fmtWhen(s.start) + (s.online ? " · online" : "") + (s.place ? " · " + s.place : "");
  if (s.type === "stage") return leadLabel(s) + " → fáze „" + STAGE_TITLES[s.stage] + "“";
  if (s.type === "note") return "Zápis u " + leadLabel(s) + ": „" + s.text + "“";
  return "";
}

/* ================= lokální porozumění češtině (žádná AI služba, nic se neposílá ven) =================
   Pravidlový rozbor věty na stejné akce, jaké dřív vracela AI: {name:"schedule_meeting"|"set_stage"|"add_lead"|"add_note", input}.
   Jména klientů se hledají v seznamu leadů (skloňování se toleruje), nové jméno se hledá podle velkého písmene za „s / u / pro…“.
   Co si parser není jistý, vrací jako varování (plán pak nejde provést automaticky) nebo jako dotaz v reply. */
const SD = s => String(s == null ? "" : s).split("").map(c => { const x = c.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); return x.length === 1 ? x : " "; }).join("");
const blank = (s, m) => s.slice(0, m.index) + " ".repeat(m[0].length) + s.slice(m.index + m[0].length);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const NUMW = { nula: 0, jeden: 1, jedna: 1, jednu: 1, dva: 2, dve: 2, tri: 3, ctyri: 4, pet: 5, sest: 6, sedm: 7, osm: 8, devet: 9, deset: 10, jedenact: 11, dvanact: 12, trinact: 13, ctrnact: 14, patnact: 15, sestnact: 16, sedmnact: 17, osmnact: 18, devatenact: 19, dvacet: 20 };
const ORDG = { jedne: 1, druhe: 2, treti: 3, ctvrte: 4, pate: 5, seste: 6, sedme: 7, osme: 8, devate: 9, desate: 10, jedenacte: 11, dvanacte: 12 };
const num = w => /^\d+$/.test(w) ? +w : own(NUMW, w) ? NUMW[w] : own(ORDG, w) ? ORDG[w] : null;
const MONTH_MAP = { ledna: 1, leden: 1, unora: 2, unor: 2, brezna: 3, brezen: 3, dubna: 4, duben: 4, kvetna: 5, kveten: 5, cervna: 6, cerven: 6, cervence: 7, cervenec: 7, srpna: 8, srpen: 8, zari: 9, rijna: 10, rijen: 10, listopadu: 11, listopad: 11, prosince: 12, prosinec: 12 };
const MONTH_RE = Object.keys(MONTH_MAP).sort((a, b) => b.length - a.length).join("|");
const DAY_STEMS = [["pondel", 1], ["uter", 2], ["stred", 3], ["ctvrtek", 4], ["ctvrtk", 4], ["patek", 5], ["patk", 5], ["sobot", 6], ["nedel", 0]];
const DAY_NAMES = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];
const dayOf = n => { for (const [st, d] of DAY_STEMS) if (n.startsWith(st) && n.length <= st.length + 3) return d; return -1; };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const COMMON_RE = /^(dnes|dneska|zitra|pozitri|vcera|novy|nova|nove|novou|dobry|ahoj|mam|mame|mel|meli|byl|byli|byla|podep\w*|domluv\w*|volal\w*|zavol\w*|poznamk\w*|zapis\w*|pridej|zaloz\w*|schuz\w*|sejd\w*|odesl\w*|poslal\w*|nema|nechce|odmit\w*|vyplac\w*|online|pristi|dalsi|tento|tuto)$/;
const isCommon = n => dayOf(n) >= 0 || own(MONTH_MAP, n) || own(NUMW, n) || own(ORDG, n) || COMMON_RE.test(n);

/* kdy: datum a hodina z věty; vrací {date|null, h|null, m, wd|-1, info[], warn[]} */
function parseWhen(s0, now) {
  let s = s0, m;
  const out = { date: null, h: null, m: 0, wd: -1, info: [], warn: [] };
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const take = re => { m = re.exec(s); if (m) s = blank(s, m); return m; };
  const setTime = (h, mi) => { if (out.h == null && Number.isInteger(h) && h >= 0 && h <= 23 && mi >= 0 && mi < 60) { out.h = h; out.m = mi; } };
  const ordHour = (w, minute) => { const o = num(w); if (o >= 1 && o <= 12) setTime(o === 1 ? 12 : o - 1, minute); };

  /* hodina zapsaná číslicemi s dvojtečkou nebo slovy (půl páté, čtvrt na pět…) */
  if (take(/(\d{1,2})\s*:\s*(\d{2})(?!\d)/)) setTime(+m[1], +m[2]);
  else if (take(/\b(?:v|ve|kolem|okolo)\s+(\d{1,2})\.(\d{2})(?![\d.])/)) setTime(+m[1], +m[2]);
  else if (take(/\b(?:tri|3)\s+ctvrte\s+na\s+(\d{1,2}|[a-z]+)\b/)) ordHour(m[1], 45);
  else if (take(/\bctvrt\s+na\s+(\d{1,2}|[a-z]+)\b/)) ordHour(m[1], 15);
  else if (take(/\b(?:v|ve|kolem|okolo)?\s*pul\s+(\d{1,2}|jedne|druhe|treti|ctvrte|pate|seste|sedme|osme|devate|desate|jedenacte|dvanacte)\b/)) ordHour(m[1], 30);

  /* datum */
  let dd = null;
  const fromDM = (d, mo, y) => {
    if (!(d >= 1 && d <= 31 && mo >= 1 && mo <= 12)) return null;
    let yr = y ? +y : day0.getFullYear(), c = new Date(yr, mo - 1, d);
    if (c.getMonth() !== mo - 1 || c.getDate() !== d) return null;
    if (!y && c < day0) { yr++; c = new Date(yr, mo - 1, d); if (c.getMonth() !== mo - 1) return null; }
    return c;
  };
  if (take(new RegExp("\\b(\\d{1,2})\\s*\\.?\\s*(" + MONTH_RE + ")\\b(?:\\s+(\\d{4}))?"))) dd = fromDM(+m[1], MONTH_MAP[m[2]], m[3]);
  else if (take(/\b(\d{1,2})\s*\.\s*(\d{1,2})(?:\s*\.)?(?:\s+(\d{4}))?(?![\d:])/)) dd = fromDM(+m[1], +m[2], m[3]);
  else if (take(/\b(?:dnes|dneska)\b/)) dd = day0;
  else if (take(/\bzitra\b/)) dd = addDays(day0, 1);
  else if (take(/\bpozitri\b/)) dd = addDays(day0, 2);
  else if (take(/\bza\s+tyden\b/)) dd = addDays(day0, 7);
  else if (take(/\bza\s+(\d+|[a-z]+)\s+(dny|dni|dnu|den|tydny|tydnu|tydnech)\b/)) { const n = num(m[1]); if (n >= 1 && n <= 90) dd = addDays(day0, /^t/.test(m[2]) ? 7 * n : n); }
  /* den v týdnu (i s „příští / další“) */
  { const re = /[a-z]+/g; let w, prev = "";
    while ((w = re.exec(s))) {
      const d = dayOf(w[0]);
      if (d >= 0) { out.wd = d; out.next = /^(pristi|dalsi)$/.test(prev) || /\b(?:pristi|dalsi|pristim)\s+tyd/.test(s); break; }
      prev = w[0];
    } }
  if (!dd && out.wd >= 0) {
    const idx = x => (x + 6) % 7;
    if (out.next) dd = addDays(addDays(day0, 7 - idx(day0.getDay())), idx(out.wd));
    else {
      let diff = (out.wd - day0.getDay() + 7) % 7;
      if (diff === 0) { diff = 7; out.warn.push("Dnes je taky " + DAY_NAMES[out.wd] + " – beru ho za týden. Myslel jsi dnes?"); }
      dd = addDays(day0, diff);
    }
  } else if (dd && out.wd >= 0 && dd.getDay() !== out.wd && !out.next) {
    out.warn.push(dd.getDate() + ". " + (dd.getMonth() + 1) + ". není " + DAY_NAMES[out.wd] + " (je " + DAY_NAMES[dd.getDay()] + ") – je datum správně?");
  }
  out.date = dd;

  /* hodina zapsaná jinak */
  if (out.h == null) {
    if (take(/\b(\d{1,2})\s*(?:h|hod|hodin|hodiny|hodinu)\b/)) setTime(+m[1], 0);
    else if (take(/\b(?:v|ve|na|kolem|okolo)\s+(jednu|jedne|jedna|jeden|dve|tri|ctyri|pet|sest|sedm|osm|devet|deset|jedenact|dvanact)(?:\s+hodin\w*)?\b/)) setTime(num(m[1]), 0);
    else if (take(/\b(?:v\s+)?poledne\b/)) setTime(12, 0);
    else if (take(/\b(?:v|ve|na|kolem|okolo)\s+(\d{1,2})\b(?!\s*(?:[.:]|dn|tyd|mes|rok))/)) setTime(+m[1], 0);
  }
  /* dopoledne / odpoledne / večer a rozumný odhad u hodin 1–12 */
  if (out.h != null) {
    const pm = /\b(odpoledne|odpoledni|vecer\w*)\b/.test(s0), am = /\b(rano|rannich|dopoledne)\b/.test(s0);
    const had = out.h; let h = out.h;
    if (h >= 1 && h <= 12) {
      if (pm && h < 12) h += 12;
      else if (!am && !pm && h <= 6) { h += 12; out.info.push("Hodinu beru jako odpolední: " + h + ":" + String(out.m).padStart(2, "0") + "."); }
      else if (!am && !pm && (h === 7 || h === 8)) out.warn.push("Čas " + h + ":" + String(out.m).padStart(2, "0") + " beru jako ráno. Myslel jsi " + (h + 12) + ":" + String(out.m).padStart(2, "0") + "? Řekni „večer“.");
    }
    out.h = h;
  }
  return out;
}

const sameSurname = (t, l) => {
  if (t === l) return true;
  const stems = new Set([l, l.replace(/[aeiouy]$/, ""), l.replace(/ie$/, "i"), l.replace(/ek$/, "k"), l.replace(/el$/, "l"), l.replace(/ec$/, "c"), l.replace(/[aeiouy]$/, "").replace(/ek$/, "k")]);
  const ends = ["", "a", "u", "e", "i", "y", "o", "em", "ovi", "ou", "eho", "emu", "ym", "ych", "ymi", "m", "ho", "mu"];
  for (const st of stems) for (const e of ends) if (t === st + e) return true;
  return false;
};
const surnameOf = lead => String(lead && lead.name || "").replace(/,.*$/, "").trim().split(/\s+/).pop() || "";

/* skloňované jméno → základní tvar (jen odhad; u nového kontaktu si ho můžeš v plánu opravit) */
function nominative(w, first) {
  const n = SD(w), keep = (cut, add) => w.slice(0, w.length - cut) + add;
  if (first && /ou$/.test(n) && n.length >= 4) return keep(2, "a");   /* Hanou → Hana (u křestního jména) */
  if (/ovou$/.test(n)) return keep(4, "ová");
  if (/ovi$/.test(n) && n.length > 5) return keep(3, "");
  if (/ym$/.test(n) && n.length > 4) return keep(2, "ý");
  if (/(eho|emu)$/.test(n) && n.length > 5) return keep(3, "ý");
  if (/[ntl]ou$/.test(n) && n.length >= 5) return keep(2, "á");
  if (/ou$/.test(n) && n.length >= 4) return keep(2, "a");
  if (/em$/.test(n) && n.length > 4) {
    let r = keep(2, "");
    if (first && /[rv]l$/i.test(r)) r = r.slice(0, -1) + "el";            /* Karlem → Karel, Pavlem → Pavel */
    else if (first && /^mark$/i.test(r)) r = r.slice(0, -1) + "ek";       /* Markem → Marek */
    else if (!first && /[aeiouyáéíóúůýě][nlcč]k$/i.test(r)) r = r.slice(0, -1) + "ek";   /* Jelínkem → Jelínek */
    return r;
  }
  return w;
}

const NAME_PREP = new Set("s se u pro od ke k o klient klienta klientem klientovi klientka klientkou klientce pan pana panem panu pani kontakt kontaktu kontaktem zakaznik zakaznika".split(" "));
function findNewName(toks, rc) {
  const cap = w => /^\p{Lu}/u.test(w) && w.length > 1;
  const gap = (a, b) => /^[ \t]+$/.test(rc.slice(a.e, b.i));
  const take = k0 => {
    let k = k0; while (toks[k] && TITLE_RE.test(toks[k].n) && toks[k + 1] && /^\.?[ \t]+$/.test(rc.slice(toks[k].e, toks[k + 1].i))) k++;
    if (!toks[k] || !cap(toks[k].w) || isCommon(toks[k].n)) return null;
    const span = [toks[k]];
    while (span.length < 3) { const nx = toks[k + span.length]; if (nx && cap(nx.w) && !isCommon(nx.n) && gap(span[span.length - 1], nx)) span.push(nx); else break; }
    return { k, span };
  };
  const found = [];
  for (let k = 1; k < toks.length; k++) if (NAME_PREP.has(toks[k - 1].n) && gap(toks[k - 1], toks[k])) { const r = take(k); if (r && !found.some(f => f.k === r.k)) found.push({ ...r, oblique: true }); }
  if (!found.length && toks[0] && !isCommon(toks[0].n)) { const r = take(0); if (r) found.push({ ...r, oblique: false }); }
  return found;
}

const SOURCE_RES = [[/cold\s*-?\s*call|studen\w+/, "Cold call"], [/placen\w+|reklam\w+|facebook|google ads/, "Placený lead"], [/doporuc\w+/, "Doporučení"], [/vlastni kontakt|znamy|kamarad\w*/, "Vlastní kontakt"]];
const HELP = "Zkus třeba: „Co mám dneska v úkolech?“, „Jaké jsou moje výsledky?“, „Podepsal jsem smlouvu s Novákem a domluvil online schůzku ve středu v 17.“, „Schůzka s Králem 15. 10. v půl páté v Brně“, „Poznámka k Novákovi: chce zvýšit pojistku“ nebo „Nový kontakt Jan Dvořák 777 123 456“.";

function understand(text, env) {
  env = env || {};
  const now = env.now || new Date(), leads = env.leads || [];
  const raw = String(text == null ? "" : text).trim().replace(/\s+/g, " ");
  const res = { reply: "", warnings: [], notes: [], actions: [] };
  if (!raw) return res;
  let s = SD(raw), rc = raw, m;

  /* e-mail a telefon (vyřadit, ať se nepletou s časem) */
  let email = "", phone = "";
  if ((m = /[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}/.exec(s))) { email = rc.slice(m.index, m.index + m[0].length); s = blank(s, m); rc = rc.slice(0, m.index) + " ".repeat(m[0].length) + rc.slice(m.index + m[0].length); }
  if ((m = /(?:\+?\s?42[01]\s?)?\b\d{3}\s?\d{3}\s?\d{3}\b/.exec(s))) { phone = normPhone(rc.slice(m.index, m.index + m[0].length)) || ""; s = blank(s, m); rc = rc.slice(0, m.index) + " ".repeat(m[0].length) + rc.slice(m.index + m[0].length); }

  const toks = []; { const re = /[\p{L}\p{N}]+/gu; let t; while ((t = re.exec(rc))) toks.push({ w: t[0], n: SD(t[0]), i: t.index, e: t.index + t[0].length }); }
  const when = parseWhen(s, now);
  const T = re => re.test(s);

  /* ---- co se stalo ---- */
  const addLead = T(/\b(?:novy|nova|nove|novou)\s+(?:kontakt|lead|klient)\w*|\b(?:pridej|pridat|zaloz|zalozit|vytvor)\w*\s+(?:(?:novy|noveho|novou)\s+)?(?:kontakt|lead|klient)\w*/);
  const meetWord = T(/\b(?:schuz\w*|sejd\w*|setkan\w*|konzultac\w*|meeting|videohovor\w*)\b/);
  const pastMark = meetWord && T(/\b(?:meli|mel|mela|byli|byl|byla|probehl\w*|absolvoval\w*)\b/) && !T(/\bmel\w*\s+zajem\b/);
  const futureMark = T(/\b(?:domluv\w*|dalsi|nova|novou|pristi|sejdeme|sejdu|naplanoval\w*|bude|budeme|mame\s+(?:na|v|ve))\b/);
  const online = T(/\bon[- ]?line\b|\bvideo\w*|\bmeet\b|\bteams\b|\bzoom\b|\bna dalku\b|\bvzdalen\w*/);
  const wantsMeeting = meetWord && (when.date || when.h != null || futureMark) && !(pastMark && !futureMark && !when.date)
    || (!meetWord && when.date && when.h != null && T(/\bdomluv\w*|\bonline\b/));
  const stages = [];   /* [stage, varování] */
  if (T(/\bpodepsal\w*|\bpodepsali\b|\buzavrel\w*\s+(?:jsem\s+)?smlouv\w*/)) stages.push(["podpis", ""]);
  if (T(/\bvyplacen\w*|\bvyplatil\w*|\bprovize\s+(?:uz\s+)?(?:prisla|je\s+vyplacena)/)) stages.push(["vyplaceno", "Provize vyplacena – opravdu? Nejde to snadno vrátit."]);
  if (T(/\b(?:odeslal|poslal|zaslal)\w*\s+jsem\b.{0,30}?\b(?:nabidk\w*|kalkulac\w*|navrh\w*)|\bnabidk\w*\s+(?:jsem\s+)?(?:odeslal|poslal|zaslal)\w*|\bnabidka\s+odeslana/)) stages.push(["nabidka", ""]);
  if (pastMark) stages.push(["probehla", ""]);
  if (T(/\bnema\s+zajem|\bnechce\b|\bodmitl\w*|\bztratil\w*\s+jsem|\bje\s+lost\b|\bvypadl\w*/)) stages.push(["lost", "Přesunu do Lost – bylo to tak?"]);
  if (T(/\bzamrz\w*|\bodlozil\w*|\bodklada\w*|\bozve\s+se\s+(?:az\s+)?(?:pozdeji|za)/)) stages.push(["zamrzly", "Přesunu do Zamrzlých – bylo to tak?"]);
  const callMark = T(/\b(?:volal|zavolal|kontaktoval|oslovil|psal|napsal)\w*\s+jsem|\bnezvedl\w*|\bnebere\b|\bnedovolal\w*/);
  const noteKw = /\b(poznamk\w*|zapis\w*|zapamatuj\w*|pripomen\w*|napis\s+si)\b/.exec(s);

  /* ---- klient ---- */
  let clientName = "", clientIdx = new Set(), newName = "", conflict = "", knownClient = false;
  const spanName = f => f.span.map((t, i) => f.oblique ? nominative(t.w, i < f.span.length - 1) : t.w).join(" ");
  let nf = null;
  if (addLead) { const f = findNewName(toks, rc); nf = f[0] || null; if (nf) { newName = spanName(nf); clientName = newName; nf.span.forEach(t => clientIdx.add(toks.indexOf(t))); } }
  else {
    const hits = [];
    for (const l of leads) {
      const w = words(l && l.name); if (!w.length) continue;
      const ls = w[w.length - 1], lf = w.length > 1 ? w[0] : "";
      toks.forEach((t, k) => { if (t.n.length >= 3 && sim(t.n, ls) && !(own({ novy: 1, nova: 1, nove: 1, novou: 1 }, t.n) && t.w[0] === t.w[0].toLowerCase())) hits.push({ lead: l, k, ls, lf, same: sameSurname(t.n, ls) }); });
    }
    if (hits.length) {
      const keys = new Set(hits.map(h => h.ls.slice(0, 4))), ks = [...new Set(hits.map(h => h.k))];
      if (keys.size > 1 && ks.length > 1) conflict = [...new Set(hits.map(h => toks[h.k].w))].join(", ");
      const first = hits.slice().sort((a, b) => a.k - b.k)[0], k = (hits.filter(h => h.same).sort((a, b) => a.k - b.k)[0] || first).k;
      const here = hits.filter(h => h.k === k), same = here.filter(h => h.same);
      clientIdx.add(k); knownClient = true;
      if (same.length) {
        /* křestní jméno hned před příjmením: sedí na kontakt → přesná shoda; jiné → je to někdo další, ne tenhle kontakt */
        const pv = k > 0 ? toks[k - 1] : null, fn = pv ? pv.n : "";
        const isFirst = pv && /^\p{Lu}/u.test(pv.w) && pv.w.length > 1 && !isCommon(fn) && !NAME_PREP.has(fn) && /^[ \t]+$/.test(rc.slice(pv.e, toks[k].i));
        const wf = isFirst && fn.length >= 3 ? same.find(h => h.lf && sameSurname(fn, h.lf)) : null;
        if (wf) { clientIdx.add(k - 1); clientName = wf.lead.name; }
        else if (isFirst && same.every(h => h.lf)) { clientIdx.add(k - 1); clientName = nominative(pv.w, true) + " " + nominative(toks[k].w); }
        else clientName = surnameOf(same[0].lead);
      } else clientName = toks[k].w;
    } else {
      const f = findNewName(toks, rc);
      if (f.length) { nf = f[0]; newName = spanName(nf); clientName = newName; nf.span.forEach(t => clientIdx.add(toks.indexOf(t))); if (f.length > 1) res.warnings.push("V příkazu je víc jmen (" + f.map(spanName).join(", ") + ") – beru první."); }
    }
  }
  /* dotaz, ne příkaz („Co mám dneska v úkolech“, „Jaké jsou moje výsledky“) */
  { const q = detectQuery(s, when, now, knownClient ? clientName : ""); if (q) { res.query = q; return res; } }
  if (conflict) { res.reply = "Našla jsem víc různých klientů (" + conflict + "). Řekni příkazy po jednom."; return res; }

  const holdWarn = w => res.warnings.push(w);
  const A = (name, input) => { const { warn, info, ...rest } = input; res.actions.push({ name, input: rest }); if (warn) holdWarn(warn); if (info) res.notes.push(info); };
  const missing = [];

  /* nový kontakt */
  if (addLead) {
    if (!newName) missing.push("jméno nového kontaktu (např. „Nový kontakt Jan Dvořák 777 123 456“)");
    else { const src = (SOURCE_RES.find(([re]) => re.test(s)) || [])[1] || ""; A("add_lead", { name: newName, phone, email, source: src }); }
  }
  /* schůzka */
  if (wantsMeeting) {
    const lab = clientName ? " s „" + clientName + "“" : "";
    if (!clientName) missing.push("jméno klienta u schůzky");
    else if (!when.date && when.h == null) missing.push("den a hodina schůzky" + lab + " (např. „ve středu v 17“)");
    else if (!when.date) missing.push("den schůzky" + lab + " (hodinu jsem slyšela: " + when.h + ":" + String(when.m).padStart(2, "0") + ")");
    else if (when.h == null) missing.push("hodina schůzky" + lab + " (den jsem slyšela: " + when.date.getDate() + ". " + (when.date.getMonth() + 1) + ".)");
    else {
      const d = when.date, z = n => String(n).padStart(2, "0");
      let place = ""; const pm = /\b(?:v|ve)\s+(\p{Lu}\p{L}+(?:\s+\p{Lu}\p{L}+)?)/u.exec(rc) || null;
      const pl = /\b(?:v kancelari|u klienta(?: doma)?|u nas|v kavarne)\b/.exec(s);
      if (!online) place = pl ? rc.slice(pl.index, pl.index + pl[0].length) : pm ? pm[0] : "";
      A("schedule_meeting", { client_name: clientName, start: d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "T" + z(when.h) + ":" + z(when.m), online, place, send_confirmation: true });
      when.warn.forEach(holdWarn); when.info.forEach(i => res.notes.push(i));
    }
  }
  /* zápis */
  if (noteKw) {
    const kw = toks.findIndex(t => t.i >= noteKw.index && t.n.startsWith(noteKw[1].slice(0, 4)));
    let j = kw < 0 ? 0 : kw + 1;
    while (toks[j] && (/^(k|ke|u|o|pro|na|ohledne|si)$/.test(toks[j].n) || clientIdx.has(j))) j++;
    const body = toks[j] ? rc.slice(toks[j].i).trim() : "";
    if (!clientName) missing.push("jméno klienta u zápisu");
    else if (!body) missing.push("text zápisu (např. „Poznámka k Novákovi: chce zvýšit pojistku“)");
    else A("add_note", { client_name: clientName, text: body });
  } else if (callMark && clientName && !addLead) {
    A("add_note", { client_name: clientName, text: raw });
    const known = leads.filter(l => l && words(l.name).length && sim(SD(clientName).split(" ").pop(), words(l.name).pop()));
    if (known.length && known.every(l => l.stage === "novy") && !stages.length && !wantsMeeting) A("set_stage", { client_name: clientName, stage: "kontaktovan" });
  }
  /* fáze */
  for (const [st, w] of stages) {
    if (!clientName) { missing.push("jméno klienta u změny fáze"); break; }
    A("set_stage", { client_name: clientName, stage: st, warn: w });
  }

  if (missing.length) {
    res.reply = "Ještě mi chybí: " + [...new Set(missing)].join("; ") + ".";
    res.warnings.push("Příkaz nebyl úplný – prověř plán a proveď ho klepnutím.");
  }
  if (!res.actions.length && !res.reply) {
    res.reply = knownClient ? "Rozumím, že jde o „" + clientName + "“, ale nevím, co s tím mám udělat. " + HELP : "Nerozuměla jsem. " + HELP;
  }
  return res;
}

/* ================= dotazy a odpovědi (čistá logika) =================
   „Co mám dneska v úkolech“, „Jaké jsou moje výsledky“, „Kdy mám schůzku s Novákem“ → understand() vrátí res.query,
   answerQuery() z dat appky (facts) složí odpověď: lines = text do okna, speak = totéž pro hlasový výstup. */
const NB = " ";
const ymd = d => d.getFullYear() + "-" + z2(d.getMonth() + 1) + "-" + z2(d.getDate());
const plural = (n, a, b, c) => n === 1 ? a : n >= 2 && n <= 4 ? b : c;
const MONTHS_G = ["ledna", "února", "března", "dubna", "května", "června", "července", "srpna", "září", "října", "listopadu", "prosince"];
const DOW_ACC = ["v neděli", "v pondělí", "v úterý", "ve středu", "ve čtvrtek", "v pátek", "v sobotu"];
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
const hoursPrep = hh => [2, 3, 4, 12, 13, 14, 20, 21, 22, 23].includes(hh) ? "ve" : "v";
const spokenClock = d => hoursPrep(d.getHours()) + " " + d.getHours() + " " + plural(d.getHours(), "hodinu", "hodiny", "hodin") + (d.getMinutes() ? " " + d.getMinutes() + " " + plural(d.getMinutes(), "minutu", "minuty", "minut") : "");
function spokenDay(d, now) {
  const t = now || new Date(), dd = ymd(d);
  if (dd === ymd(t)) return "dnes";
  if (dd === ymd(addDays(t, 1))) return "zítra";
  return DOW_ACC[d.getDay()] + " " + d.getDate() + ". " + MONTHS_G[d.getMonth()];
}
const cnum = x => { const r = Math.round(x * 10) / 10; return String(r).replace(".", ","); };
const thou = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NB);
const korun = n => thou(n) + NB + plural(Math.round(n), "koruna", "koruny", "korun");
const bodu = x => { const r = Math.round(x * 10) / 10; return cnum(r) + NB + (Number.isInteger(r) ? plural(r, "bod", "body", "bodů") : "bodu"); };
const speechClean = t => String(t).replace(/\b(?:Ing|Mgr|Bc|MUDr|JUDr|PhDr|RNDr|MVDr|doc|prof)\.\s*/g, "").replace(/,?\s*(?:Ph\.?\s?D\.?|CSc\.|MBA|DiS\.)/g, "").replace(/(\d) (?=\d{3}(?!\d))/g, "$1").replace(/ /g, " ").replace(/[„“”"]/g, "").replace(/\s+/g, " ").trim();
const qLab = l => String(l).replace(/^(\d)\. Q (\d{4})$/, "$1. čtvrtletí $2");
const qPrep = l => (/^[234]\./.test(l) ? "Ve " : "V ") + qLab(l);
const joinList = a => a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " a " + a[a.length - 1];
const shortDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? +m[3] + ". " + MONTHS_G[+m[2] - 1] : ""; };

const Q_WH = /^(?:(?:ahoj|hej|prosim|asistentko|asistente|a|tak|no|mi|nam)\s+)*(?:co|jake|jaky|jaka|jakou|jaci|kolik|kdy|kdo|komu|koho|kde|jak|ktere|ktery|ukaz|rekni|povez|precti|vypis|zobraz|shrn|prehled|reknes|muzes|mohla|mohl)\b/;
function detectQuery(t, when, now, client) {
  t = t.replace(/\s+/g, " ").trim();
  if (!Q_WH.test(t)) return null;
  const R = /\b(?:vysledk\w*|produkc\w*|bod(?:y|u|ech|ove)?|provize|provizi|vydelal\w*|vydelek|vydelk\w*|obrat\w*|statistik\w*|tarif\w*|sazb\w*|leadu|leady|lead|pipelin\w*|na tom jsem|si vedu|se mi dari|dopadl\w*)\b/.test(t);
  const M = /\b(?:schuz\w*|kalendar\w*|sejd\w*|meeting\w*|videohovor\w*|konzultac\w*)\b/.test(t);
  const Kt = /\b(?:ukol\w*|todo|k vyrizeni|na praci|udelat|ceka|cekaji|na programu)\b/.test(t);
  const Kc = /\b(?:zavolat|volat|telefonat|zatelefonovat|ozvat|zavolej|volani)\b/.test(t);
  const K = Kt;
  const G = /\bco (?:vsechno )?(?:mam|me ceka|mame|bude)\b/.test(t);
  const kind = R && !K ? "results" : K && M ? "agenda" : K ? "tasks" : Kc ? "calls" : M ? "meetings" : G ? "agenda" : null;
  if (!kind) return null;
  let day = "today";
  if (/\bpristi tyden|\bpristim tydnu/.test(t)) day = "nextweek";
  else if (/\b(?:tento|tenhle|tohle|tomto|teto|tuhle) tyd\w*|\btyden\b|\btydnu\b/.test(t) && !when.date) day = "week";
  else if (/\bzitra\b/.test(t)) day = "tomorrow";
  else if (/\bdnes\w*/.test(t)) day = "today";
  else if (when.date) day = ymd(when.date);
  else if (kind === "meetings" && client) day = "next";
  return { kind, day, client: client || "" };
}

function dayRange(day, now) {
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (day === "week") return { from: ymd(t0), to: ymd(addDays(t0, (7 - t0.getDay()) % 7)), label: "tento týden", single: false };
  if (day === "nextweek") { const mon = addDays(t0, ((8 - t0.getDay()) % 7) || 7); return { from: ymd(mon), to: ymd(addDays(mon, 6)), label: "příští týden", single: false }; }
  const d = day === "tomorrow" ? addDays(t0, 1) : /^\d{4}-\d{2}-\d{2}$/.test(day) ? parseLocal(day + "T00:00") || t0 : t0;
  return { from: ymd(d), to: ymd(d), label: spokenDay(d, now), single: true };
}

function answerQuery(q, F, now) {
  now = now || new Date();
  const L = [], out = { lines: L, speak: "" };
  const done = () => { L.forEach((l, i) => { L[i] = l.replace(/\.{2,}$/, "."); }); out.speak = speechClean(L.join(" ")); return out; };
  if (!q) return done();
  if (!F) { L.push("K datům v appce se teď nedostanu."); return done(); }
  const today = ymd(now), R = dayRange(q.day, now), isToday = R.single && R.from === today;
  const inR = iso => iso >= R.from && iso <= R.to;
  const meetsAll = (F.meets || []).filter(m => m && m.start && !isNaN(new Date(m.start))).map(m => ({ ...m, d: new Date(m.start) })).sort((a, b) => a.d - b.d);
  const meetItem = (m, withDay) => (m.name || "Schůzka") + ", " + (withDay ? spokenDay(m.d, now) + " " : "") + spokenClock(m.d) + (m.online ? ", online" : "");

  if (q.kind === "results") {
    const Q = F.quarter, P = F.pipe;
    if (Q) {
      L.push(qPrep(Q.label) + " máš " + bodu(Q.pts) + (Q.rate ? ", to je asi " + korun(Q.kc != null ? Q.kc : Q.pts * Q.rate) + " při sazbě " + korun(Q.rate) + " za bod" : "") + ".");
      if (Q.nextRate && Q.need > 0) L.push("Do vyšší sazby " + korun(Q.nextRate) + (Q.nextTier ? " (" + Q.nextTier + ")" : "") + " ti chybí " + bodu(Q.need) + ", zhruba " + bodu(Q.perWeek) + " týdně, zbývá " + Q.days + " " + plural(Q.days, "den", "dny", "dní") + ".");
      else if (!Q.nextRate) L.push("Jsi na nejvyšší sazbě.");
    } else L.push("Čtvrtletní body se teď nepodařilo načíst.");
    if (F.month && F.month.pts != null) L.push("Tento měsíc máš " + bodu(F.month.pts) + ".");
    if (P) L.push("V jednání je " + bodu(P.pts) + (P.ptsKc ? ", zhruba " + korun(P.ptsKc) : "") + ". Rozjednaných leadů máš " + P.active + ", domluvených schůzek " + P.meetings + ", po termínu nebo bez dalšího kroku " + P.late + ".");
    return done();
  }

  if (q.client) {
    const cw = words(q.client), cl = cw[cw.length - 1] || "";
    const mine = meetsAll.filter(m => { const w = words(m.name); return w.length && cl && sim(w[w.length - 1], cl) && m.d.getTime() > now.getTime() - 60 * MIN; });
    if (!mine.length) L.push(q.client + ": žádná budoucí schůzka v kalendáři.");
    else L.push(q.client + " má " + (mine.length > 1 ? mine.length + " " + plural(mine.length, "schůzku", "schůzky", "schůzek") + ": " : "schůzku ") + joinList(mine.slice(0, 3).map(m => (mine.length > 1 ? "" : "") + spokenDay(m.d, now) + " " + spokenClock(m.d) + (m.online ? ", online" : ""))) + ".");
    return done();
  }

  const callList = () => (F.calls || []).filter(c => c && c.name && c.date && (isToday ? c.date <= today : inR(c.date) || (R.from === today && c.date < today)));
  if (q.kind === "calls") {
    const calls = callList();
    L.push(calls.length ? cap(R.label) + " zavolej: " + joinList(calls.slice(0, 6).map(c => c.name)) + (calls.length > 6 ? " a dalším " + (calls.length - 6) : "") + "." : cap(R.label) + " nemáš nikoho k zavolání.");
    return done();
  }
  const wantTasks = q.kind === "tasks" || q.kind === "agenda";
  if (wantTasks) {
    const tasks = (F.tasks || []).filter(t => t && t.text && (isToday ? t.due && t.due <= today : t.due && inR(t.due) || (R.from === today && t.due && t.due < today)));
    const undated = (F.tasks || []).filter(t => t && t.text && !t.due).length;
    const item = t => t.text + (t.client && !SD(t.text).includes(SD(t.client).slice(0, 5)) ? ", klient " + t.client : "") + (t.due && t.due < today ? ", po termínu od " + shortDate(t.due) : "") + (t.who ? ", od asistentky" : "");
    if (tasks.length) L.push(cap(R.label) + " máš " + tasks.length + " " + plural(tasks.length, "úkol", "úkoly", "úkolů") + ": " + tasks.slice(0, 5).map(item).join("; ") + (tasks.length > 5 ? "; a dalších " + (tasks.length - 5) : "") + ".");
    else L.push(cap(R.label) + " nemáš žádné úkoly" + (isToday ? " (ani po termínu)" : "") + ".");
    if (isToday && undated) L.push("Bez termínu máš ještě " + undated + " " + plural(undated, "otevřený úkol", "otevřené úkoly", "otevřených úkolů") + ".");
    const calls = callList();
    if (calls.length) L.push("K telefonování: " + joinList(calls.slice(0, 5).map(c => c.name)) + (calls.length > 5 ? " a dalších " + (calls.length - 5) : "") + ".");
  }
  if (q.kind === "meetings" || q.kind === "agenda" || wantTasks) {
    const dayMs = meetsAll.filter(m => inR(ymd(m.d))), ms = R.from === today ? dayMs.filter(m => m.d.getTime() > now.getTime() - 45 * MIN) : dayMs;
    if (isToday && !ms.length && dayMs.length) L.push("Dnešní schůzky už proběhly.");
    else if (ms.length) L.push(cap(R.label) + (isToday ? " ještě" : "") + " máš " + ms.length + " " + plural(ms.length, "schůzku", "schůzky", "schůzek") + ": " + ms.slice(0, 6).map(m => meetItem(m, !R.single)).join("; ") + (ms.length > 6 ? "; a dalších " + (ms.length - 6) : "") + ".");
    else if (q.kind !== "tasks") L.push(cap(R.label) + " nemáš žádnou schůzku.");
  }
  return done();
}

/* ---- co řekne hlas ---- */
function spokenPlan(plan, now, countdown, auto) {
  const s = [], first = x => String(x).split(/(?<=[.!?])\s/)[0];
  if (plan.reply) s.push(first(plan.reply));
  for (const st of plan.steps) {
    const who = leadLabel(st);
    if (st.type === "add_lead") s.push("Založím nový kontakt: " + who + ".");
    else if (st.type === "meeting") s.push("Schůzka: " + who + ", " + spokenDay(st.start, now) + " " + spokenClock(st.start) + ", " + (st.online ? "online" : st.place ? st.place : "osobně") + ".");
    else if (st.type === "stage") s.push(who + ": nová fáze " + STAGE_TITLES[st.stage] + ".");
    else if (st.type === "note") s.push("Zapíšu poznámku: " + who + ".");
  }
  if (plan.problems.length) s.push(plan.problems[0]);
  if (plan.warnings.length) s.push("Pozor: " + first(plan.warnings[0]));
  if (runnable(plan)) { if (!auto) s.push("Zkontroluj to a klepni na Provést."); else if (countdown > 0) s.push("Provedu to za " + countdown + " " + plural(countdown, "sekundu", "sekundy", "sekund") + ", nebo klepni na Zrušit."); }
  else if (plan.problems.length || unresolved(plan).length) s.push(unresolved(plan).length ? "Vyber prosím správného klienta." : "Řekni příkaz znovu.");
  return speechClean(s.join(" "));
}
function spokenDone(out) {
  const bad = out.lines.some(l => /^✗/.test(l)), s = [bad ? "Něco se nepovedlo, koukni na výpis." : "Hotovo."];
  if (out.smsJobs && out.smsJobs.length) s.push(out.smsJobs.length === 1 ? "SMS je připravená, klepni na Odeslat." : "SMS jsou připravené, klepni na Odeslat.");
  if (out.manuals && out.manuals.length) s.push("Potvrzení musíš poslat ručně.");
  return s.join(" ");
}

/* nejlepší český hlas: ženský, přirozenější varianty dopředu (Zuzana, Vlasta…); bez českého hlasu null (radši mlčet než číst česky anglickým hlasem) */
const FEMALE_CS = /zuzana|vlasta|iveta|eliska|klara|lenka|petra|jana|marie|zdenka|ludmila|female|zena|žena/i;
function pickVoice(voices, pref) {
  const vs = (voices || []).filter(v => v && /^cs([-_]|$)/i.test(v.lang || ""));
  if (!vs.length) return null;
  if (pref) { const p = vs.find(v => v.voiceURI === pref || v.name === pref); if (p) return p; }
  const score = v => (FEMALE_CS.test(v.name) ? 50 : 0) + (/premium|enhanced|natural|neural|siri|online|vylepšen|rozšířen/i.test(v.name) ? 25 : 0) + (v.localService === false ? 5 : 0) - (/jakub|antonin|male|muz|muž|david|pavel/i.test(v.name) && !FEMALE_CS.test(v.name) ? 100 : 0);
  return vs.slice().sort((a, b) => score(b) - score(a))[0];
}

/* ================= hlas ================= */
function voiceSupported() { return !!(root.SpeechRecognition || root.webkitSpeechRecognition); }
function listen({ onText, onEnd, onError, lang }) {
  const R = root.SpeechRecognition || root.webkitSpeechRecognition;
  if (!R) { onError && onError("unsupported"); return null; }
  const rec = new R();
  rec.lang = lang || "cs-CZ"; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
  let text = "", fin = false;
  rec.onresult = e => {
    let t = "";
    for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
    text = t.trim(); fin = !!e.results[e.results.length - 1].isFinal;
    onText && onText(text, fin);
  };
  rec.onerror = e => { onError && onError(e.error || "error"); };
  rec.onend = () => { onEnd && onEnd(text, fin); };
  try { rec.start(); } catch (e) { onError && onError("start"); return null; }
  return { stop() { try { rec.stop(); } catch (e) {} }, abort() { try { rec.abort(); } catch (e) {} } };
}
const VOICE_ERR = { "not-allowed": "Mikrofon není povolený – povol ho v nastavení prohlížeče.", "service-not-allowed": "Rozpoznávání řeči je v tomhle prohlížeči zakázané. Použij mikrofon na klávesnici.", "no-speech": "Nic jsem neslyšel.", "network": "Rozpoznávání řeči potřebuje internet.", "unsupported": "Tenhle prohlížeč neumí rozpoznávat řeč. Použij mikrofon na klávesnici." };

const api = { understand, parseWhen, nominative, sameSurname, GMAIL_SCOPE, norm, words, sim, matchLeads, resolveClient, parseLocal, fmtWhen, checkMeeting, normPhone, validEmail, hasPlaceholders, pickTemplate, mimeEmail, encodeWord, buildPlan, runnable, autoOk, unresolved, pickLead, describeStep, leadLabel, STAGE_TITLES, voiceSupported, listen, VOICE_ERR, detectQuery, answerQuery, spokenPlan, spokenDone, spokenClock, spokenDay, pickVoice, speechClean };

/* ================= část s prohlížečem (jen když existuje document) ================= */
if (typeof document === "undefined") return api;

let H = null, fab = null, busy = false, cur = null, hotkeyBound = false;
const DEFAULTS = { on: false, delay: 10, sms: true, mail: true, from: "", hotkey: true, speak: true, voice: "", smart: true, mode: "live", barge: false, gvoice: "", gspeak: true, callMe: "" };
const cfg = () => ({ ...DEFAULTS, ...((H && H.settings() && H.settings().ai) || {}) });
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else if (v != null && v !== false) e.setAttribute(k, v === true ? "" : v); }
  for (const k of kids.flat(3)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};

const CSS = `
#aiFab{position:fixed;right:16px;bottom:calc(18px + env(safe-area-inset-bottom,0px));width:52px;height:52px;border-radius:50%;background:var(--tint);color:#fff;display:grid;place-items:center;box-shadow:0 8px 24px rgba(0,122,255,.4);z-index:30;border:0;font-size:22px;line-height:1}
#aiFab[hidden]{display:none}
.aiLog{display:grid;gap:10px;max-height:46vh;overflow:auto;padding:2px}
.aiMsg{padding:9px 12px;border-radius:14px;font-size:15px;line-height:1.35;max-width:92%;white-space:pre-wrap;overflow-wrap:anywhere}
.aiMsg.me{justify-self:end;background:var(--tint);color:#fff;border-bottom-right-radius:4px}
.aiMsg.bot{justify-self:start;background:var(--fill2,rgba(120,120,128,.16));border-bottom-left-radius:4px}
.aiPlan{background:var(--bg2);border:1px solid var(--sep,rgba(120,120,128,.28));border-radius:14px;padding:10px 12px;display:grid;gap:7px;font-size:14px}
.aiPlan .st{display:flex;gap:8px;align-items:flex-start}
.aiPlan .warn{color:var(--orange);font-size:13px}.aiPlan .err{color:var(--red);font-size:13px}.aiPlan .note{color:var(--label2);font-size:13px}
.aiPlan .btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:2px}
.aiPlan .btns button{padding:8px 14px;border-radius:999px;font-weight:600;font-size:14px;background:var(--fill2,rgba(120,120,128,.16));color:var(--label)}
.aiPlan .btns button.go{background:var(--green);color:#fff}.aiPlan .btns button.no{color:var(--red)}
.aiIn{display:flex;gap:8px;align-items:flex-end;margin-top:10px}
.aiIn textarea{flex:1;min-width:0;min-height:44px;max-height:120px;border-radius:12px;padding:10px 12px;font:inherit;font-size:16px;resize:none}
.aiIn button{width:44px;height:44px;border-radius:50%;flex:none;background:var(--tint);color:#fff;font-size:18px}
.aiIn button.mic.on{background:var(--red)}
.aiHint{color:var(--label2);font-size:13px;margin:8px 2px 0}
.aiVoice{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:24px 16px calc(24px + env(safe-area-inset-bottom,0px));background:rgba(8,10,20,.38);-webkit-backdrop-filter:blur(26px) saturate(1.25);backdrop-filter:blur(26px) saturate(1.25);opacity:0;transition:opacity .18s ease;color:#fff;outline:none;overflow:auto}
.aiVoice.on{opacity:1}
.aiVoice .vbox{width:min(560px,100%);display:grid;gap:14px;justify-items:center;text-align:center}
.aiVoice .veq{height:120px;display:flex;align-items:center;justify-content:center;gap:5px}
.aiVoice .veq i{display:block;width:7px;height:100%;border-radius:4px;background:linear-gradient(180deg,#9fd0ff,#5b8cff 55%,#b08cff);box-shadow:0 0 14px rgba(110,150,255,.55);transform:scaleY(.06);transform-origin:center;will-change:transform}
.aiVoice[data-mode=speaking] .veq i{background:linear-gradient(180deg,#ffd0e8,#ff7ab8 55%,#ffb27a);box-shadow:0 0 14px rgba(255,122,184,.5)}
.aiVoice .vstate{font-size:15px;opacity:.85;letter-spacing:.01em}
.aiVoice .vcap{font-size:16px;line-height:1.35;opacity:.8;font-style:italic;max-width:100%;overflow-wrap:anywhere;min-height:1.35em}
.aiVoice .vtext{font-size:22px;font-weight:600;line-height:1.3;min-height:1.3em;overflow-wrap:anywhere;text-shadow:0 1px 12px rgba(0,0,0,.35)}
.aiVoice .vlog{width:100%;display:grid;gap:10px;text-align:left;max-height:42vh;overflow:auto;color:var(--label,#000)}
.aiVoice .vans{background:var(--bg2,#fff);border:1px solid var(--sep,rgba(120,120,128,.28));border-radius:14px;padding:12px 14px;display:grid;gap:6px;font-size:15px;line-height:1.4}
.aiVoice .vans p{margin:0}
.aiVoice .vans[hidden]{display:none}
.aiVoice .vbtns{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
.aiVoice .vbtns button{padding:10px 18px;border-radius:999px;font-weight:600;font-size:15px;background:rgba(255,255,255,.18);color:#fff;border:1px solid rgba(255,255,255,.28)}
.aiVoice .vx{position:absolute;top:calc(14px + env(safe-area-inset-top,0px));right:16px;width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.18);color:#fff;font-size:18px;border:0}
@media (prefers-reduced-motion:reduce){.aiVoice{transition:none}}
`;

function addStyle() { if (document.getElementById("aiStyle")) return; const s = h("style", { id: "aiStyle" }); s.textContent = CSS; document.head.append(s); }

function refresh() {
  if (!H) return;
  const on = cfg().on && !H.demo;
  if (!on) { if (fab) fab.hidden = true; return; }
  addStyle();
  if (!fab) { fab = h("button", { id: "aiFab", type: "button", title: "Asistent (na počítači mezerník = mluvit)", "aria-label": "Asistent", onclick: () => (api.voiceSupported() || liveOk() ? openVoice({ listen: true }) : open()) }, "🎙︎"); document.body.append(fab); }
  fab.hidden = false;
}

/* ---- odeslání zprávy klientovi ---- */
async function sendGmail(to, subject, body) {
  const raw = mimeEmail({ to, subject, body, from: cfg().from });
  await H.gfetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ raw }) });
}

const canMail = () => cfg().mail !== false && H.hasScope("gmail.send");
const canSms = () => cfg().sms !== false;

/* co se po provedení plánu pošle: kanály podle toho, co o klientovi víme */
function channelsFor(step, lead) {
  const l = lead || step.lead || step.newRef || {};
  const out = [];
  if (step.online && canMail() && validEmail(l.email)) out.push("e-mail automaticky");
  if (canSms() && normPhone(l.phone)) out.push("SMS připravím (odešleš jedním klepnutím)");
  return out;
}

async function sendConfirmation(step, lead, res) {
  const tpl = pickTemplate(H.tpls(), step.online);
  if (!tpl) return { ok: false, manual: { ctx: { name: lead.name, phone: lead.phone, email: lead.email, start: step.start.toISOString(), online: step.online }, tplId: null, lead }, reason: "nemáš žádnou šablonu zpráv" };
  const startISO = step.start.toISOString();
  const ctx = { name: lead.name, phone: lead.phone, email: lead.email, start: startISO, online: step.online, place: step.place || "", meetId: res.evId && !String(res.evId).startsWith("local:") ? res.evId : null };
  const manual = reason => ({ ok: false, manual: { ctx, tplId: tpl.id, lead }, reason });
  if (H.demo) return manual("prezentační režim nic neodesílá");
  if (step.online) {
    if (!ctx.meetId) return manual("schůzka není v kalendáři, odkaz na Google Meet nejde vytvořit");
    try { ctx.meetLink = await H.ensureMeet(ctx.meetId); } catch (e) { ctx.meetLink = null; }
    if (!ctx.meetLink) return manual("odkaz na Google Meet se nepodařilo vytvořit");
  }
  const text = H.fillTpl(tpl.text, ctx);
  if (step.online && !text.includes(ctx.meetLink)) return manual("šablona „" + tpl.name + "“ neobsahuje {meet}, klient by nedostal odkaz");
  if (hasPlaceholders(text)) return manual("v textu zbylo nevyplněné místo v hranatých závorkách");
  const sent = [], failed = [];
  const tel = normPhone(lead.phone);
  /* e-mail jde sám (Gmail API); SMS z webové appky sama odejít nesmí – připraví se text a odešleš ji jedním klepnutím */
  if (step.online && canMail() && validEmail(lead.email)) {
    try { await sendGmail(lead.email.trim(), "Potvrzení online konzultace", text); sent.push("e-mail"); } catch (e) { failed.push("e-mail: " + (e.code === 403 ? "chybí povolení Gmailu" : e.message)); }
  }
  for (const ch of sent) { try { await H.logLeadMsg(lead, { ch: ch + " (automaticky)", tpl: tpl.name, start: startISO, meetId: ctx.meetId }); } catch (e) {} }
  const sms = canSms() && tel ? { lead, tel, text, tpl: tpl.name, start: startISO, meetId: ctx.meetId } : null;
  if (!sent.length && !sms) return manual(failed.length ? failed.join("; ") : "klient nemá telefon ani e-mail, nebo není zapnuté odesílání");
  return { ok: true, sent, failed, sms, ctx };
}

/* ---- provedení plánu ---- */
async function execute(plan) {
  const lines = [], manuals = [], smsJobs = [];
  const fresh = l => (l && H.leads().find(x => x.id === l.id)) || l;
  for (const s of plan.steps) {
    try {
      if (s.type === "add_lead") {
        const l = await H.addLead({ name: s.name, phone: s.phone, email: s.email, source: s.source });
        s.created = l; lines.push("✓ Nový kontakt " + l.name);
      } else if (s.type === "meeting") {
        const lead = fresh(s.lead || (s.newRef && s.newRef.created));
        if (!lead) throw new Error("klient nenalezen");
        const res = await H.saveMeeting(lead, s.start, s.online, { moveStage: lead.stage === "novy" || lead.stage === "kontaktovan" });
        lines.push("✓ Schůzka " + lead.name + " · " + fmtWhen(s.start) + (s.online ? " · online" : "") + (res.evId && !String(res.evId).startsWith("local:") ? " · zapsáno do kalendáře" : " · jen v pipeline (kalendář nedostupný)"));
        s.result = res; s.leadResolved = lead;
      } else if (s.type === "note") {
        const lead = fresh(s.lead || (s.newRef && s.newRef.created));
        await H.addNote(lead, s.text); lines.push("✓ Zápis u " + lead.name);
      } else if (s.type === "stage") {
        const lead = fresh(s.lead || (s.newRef && s.newRef.created));
        await H.moveTo(lead, s.stage); lines.push("✓ " + lead.name + " → " + STAGE_TITLES[s.stage]);
      }
    } catch (e) { lines.push("✗ " + describeStep(s) + " – " + (e.message || "chyba")); }
  }
  for (const s of plan.steps) {
    if (s.type !== "meeting" || !s.result || !s.confirm) continue;
    const lead = fresh(s.leadResolved);
    const r = await sendConfirmation(s, lead, s.result);
    if (r.ok) {
      const parts = [];
      if (r.sent.length) parts.push("odesláno: " + r.sent.join(" + "));
      if (r.sms) { parts.push("SMS je připravená"); smsJobs.push(r.sms); }
      lines.push("✓ Potvrzení (" + lead.name + "): " + parts.join(" · ") + (r.failed.length ? " · nepovedlo se: " + r.failed.join("; ") : ""));
    }
    else { lines.push("⚠ Potvrzení pro " + lead.name + " neodešlo automaticky: " + r.reason + "."); manuals.push(r.manual); }
  }
  return { lines, manuals, smsJobs };
}

/* ---- karta s plánem (společná pro psací okno i hlasový překryv) ---- */
function planCard(plan, hooks) {
  hooks = hooks || {};
  const card = h("div", { class: "aiPlan" });
  let timer = null, phase = "pending";
  const stopTimer = () => { clearInterval(timer); timer = null; };
  const cancelNote = () => card.replaceChildren(h("div", { class: "note" }, "Zrušeno – nic se neprovedlo."));
  const delay = Math.max(0, Math.min(60, +cfg().delay || 0));
  const auto = runnable(plan) && autoOk(plan);
  const draw = (countdown) => {
    card.replaceChildren();
    plan.steps.forEach(s => {
      card.append(h("div", { class: "st" }, h("span", {}, s.type === "meeting" ? "📅" : s.type === "stage" ? "➡️" : s.type === "note" ? "📝" : "➕"), h("span", {}, describeStep(s))));
      if (s.type === "add_lead" && countdown == null) {
        const nm = h("input", { value: s.name, "aria-label": "Jméno nového kontaktu", autocomplete: "off", style: "margin-left:26px;width:calc(100% - 26px)" }); nm.value = s.name;
        nm.onchange = () => { const v = nm.value.trim(); if (v) s.name = v; draw(); };
        card.append(h("div", { class: "note" }, "Jméno ve správném tvaru (1. pád):"), nm);
      }
      if (s.kind === "fuzzy") card.append(h("div", { class: "warn" }, "Jen podobné jméno: „" + s.lead.name + "“ – je to on?"));
      if (s.kind === "ambiguous" && !s.lead) {
        card.append(h("div", { class: "warn" }, "Víc kontaktů pasuje na „" + s.client_name + "“ – vyber:"));
        card.append(h("div", { class: "btns" }, s.candidates.map(c => h("button", { type: "button", onclick: () => { pickLead(plan, s, c); draw(); } }, c.name + (c.stage ? " · " + (STAGE_TITLES[c.stage] || c.stage) : "")))));
      }
      if (s.implicit) card.append(h("div", { class: "warn" }, "„" + s.name + "“ v pipeline není – založím nový kontakt."));
      if (s.type === "meeting" && s.confirm) {
        const ch = channelsFor(s, s.lead || s.newRef);
        card.append(h("div", { class: ch.length ? "note" : "warn" }, ch.length ? "Potvrzení klientovi: " + ch.join(" + ") : "Potvrzení nejde poslat automaticky (chybí telefon / e-mail / nastavení) – nabídnu ruční odeslání."));
      }
    });
    plan.problems.forEach(p => card.append(h("div", { class: "err" }, "✗ " + p)));
    plan.warnings.forEach(p => card.append(h("div", { class: "warn" }, "⚠ " + p)));
    plan.notes.forEach(p => card.append(h("div", { class: "note" }, p)));
    if (!runnable(plan)) { if (plan.problems.length) card.append(h("div", { class: "note" }, "Oprav příkaz a řekni ho znovu.")); return; }
    const go = () => { stopTimer(); run(); };
    const no = () => { stopTimer(); phase = "cancelled"; cancelNote(); hooks.afterCancel && hooks.afterCancel(); };
    if (countdown != null) card.append(h("div", { class: "btns" }, h("button", { type: "button", class: "go", onclick: go }, "Provést hned"), h("button", { type: "button", class: "no", onclick: no }, "Zrušit (" + countdown + " s)")));
    else card.append(h("div", { class: "btns" }, h("button", { type: "button", class: "go", onclick: go }, "Provést"), h("button", { type: "button", class: "no", onclick: no }, "Zrušit")));
  };
  async function run() {
    phase = "running";
    card.replaceChildren(h("div", { class: "note" }, "Provádím…"));
    busy = true;
    let out;
    try { out = await execute(plan); } catch (e) { out = { lines: ["✗ " + e.message], manuals: [], smsJobs: [] }; }
    busy = false; phase = "done";
    card.replaceChildren(...out.lines.map(l => h("div", { class: /^✓/.test(l) ? "st" : /^⚠/.test(l) ? "warn" : "err" }, l)));
    out.smsJobs.forEach(job => {
      const b = h("button", { type: "button", class: "go", onclick: () => { H.openSms(job.tel, job.text); H.logLeadMsg(job.lead, { ch: "SMS", tpl: job.tpl, start: job.start, meetId: job.meetId }); b.disabled = true; b.textContent = "✓ SMS otevřená: " + job.lead.name; } }, "💬 Odeslat SMS: " + job.lead.name);
      card.append(h("div", { class: "btns" }, b));
    });
    out.manuals.forEach(mn => card.append(h("div", { class: "btns" }, h("button", { type: "button", onclick: () => { hooks.beforeManual ? hooks.beforeManual() : H.closeSheet(); H.openMsg(mn.ctx, mn.tplId, r => H.logLeadMsg(mn.lead, r)); } }, "Poslat ručně: " + mn.lead.name))));
    hooks.afterRun && hooks.afterRun(out);
  }
  return {
    card, auto, countdown: auto && delay > 0 ? delay : 0,
    start() {
      draw();
      if (!auto) return;
      let left = delay;
      if (left === 0) { run(); return; }
      draw(left);
      timer = setInterval(() => { left--; if (left <= 0) { stopTimer(); run(); } else draw(left); }, 1000);
    },
    stop: stopTimer,
    phase: () => phase,
    cancel() { if (phase === "pending") { stopTimer(); phase = "cancelled"; cancelNote(); return true; } return false; },
  };
}

/* ================= chytrý režim (jarvis.js, Gemini) =================
   Model nic neprovádí sám: zápisové nástroje jen předají akce do buildPlan → planCard (odpočet / klepnutí) → execute.
   sink = kam se karta s plánem zobrazí a co se má dít po provedení / zrušení: {owner, show(node, ui), beforeManual, onRun(out), onCancel()} */
const JV = () => root.Jarvis || null;
const smartOn = () => !!(JV() && H && !H.demo && cfg().smart !== false && JV().getKey());
function liveOk() {
  if (!smartOn() || cfg().mode === "rest") return false;
  const nav = root.navigator || {};
  return !!(nav.mediaDevices && nav.mediaDevices.getUserMedia && (root.AudioContext || root.webkitAudioContext) && root.AudioWorkletNode && root.WebSocket);
}
let pend = null;   /* plán, který čeká na odpočet / klepnutí: {ui, owner} */
const pendingPlan = () => (pend && pend.ui.phase() === "pending" ? pend : null);
function cancelPending() {
  const p = pendingPlan();
  if (!p) return { ok: true, cancelled: false, note: "Nic nečeká na provedení." };
  p.ui.cancel(); pend = null;
  return { ok: true, cancelled: true };
}
function proposePlan(actions, sink) {
  const now = new Date();
  const plan = buildPlan({ reply: "", actions }, { leads: H.leads(), now, calEvents: H.calEvents(), meetMinutes: 60 });
  const prev = pendingPlan();
  if (prev) prev.ui.cancel();   /* nový návrh nahrazuje starý, který ještě nebyl proveden */
  if (!plan.steps.length && !plan.problems.length) return { ok: false, error: "Není co provést – klienta jsem v pipeline nenašla.", notes: plan.notes };
  const ui = planCard(plan, {
    beforeManual: sink.beforeManual,
    afterRun: out => { if (pend && pend.ui === ui) pend = null; sink.onRun && sink.onRun(out); },
    afterCancel: () => { if (pend && pend.ui === ui) pend = null; sink.onCancel && sink.onCancel(); },
  });
  pend = { ui, owner: sink.owner };
  sink.show(ui.card, ui);
  ui.start();
  const amb = unresolved(plan), r = { ok: runnable(plan), steps: plan.steps.map(describeStep), problems: plan.problems, warnings: plan.warnings, notes: plan.notes };
  if (amb.length) r.ambiguous = amb.map(s => ({ client: s.client_name, candidates: (s.candidates || []).map(c => c.name) }));
  if (!runnable(plan)) r.instruction = amb.length ? "Víc klientů pasuje, zeptej se uživatele, kterého myslí (řekni jména). Uživatel může vybrat i klepnutím na obrazovce." : "Plán nejde provést. Řekni uživateli stručně, co je špatně, a zeptej se, jak dál.";
  else if (ui.auto) { r.runs_automatically = true; r.seconds = ui.countdown; r.instruction = ui.countdown ? "Plán je na obrazovce a provede se sám za " + ui.countdown + " s, pokud ho uživatel nezruší. Řekni jednou větou, co se chystá (kdo, kdy, online nebo osobně). Výsledek ti pošle systém." : "Plán se právě provádí. Řekni jednou větou, co se děje. Výsledek ti pošle systém."; }
  else { r.needs_tap = true; r.instruction = "Plán je na obrazovce, ale kvůli varování nebo nejistotě ho musí uživatel potvrdit klepnutím na Provést. Řekni mu to a přečti varování."; }
  return r;
}

/* textový mozek: jedna konverzace na zařízení, nový klíč = nová konverzace */
let brain = null, brainKey = "", brainSink = null;
function getBrain() {
  const J = JV(), key = J.getKey();
  if (brain && brainKey === key) return brain;
  const tools = J.makeTools(api, { now: () => new Date(), leads: () => H.leads(), facts: () => (H.facts ? H.facts() : null), propose: actions => proposePlan(actions, brainSink || { show() {}, owner: null }), cancelPending });
  brainKey = key;
  return (brain = new J.Brain({ key, sdk: J.loadSdk, system: () => J.systemPrompt(new Date(), { callMe: cfg().callMe }), declarations: tools.declarations, onTools: tools.runBatch }));
}
function smartAsk(text, sink) { const b = getBrain(); brainSink = sink; return b.ask(text); }

/* hlas Gemini pro rychlý režim; bez úspěchu (limit, síť) se použije systémový hlas */
let ttsToken = 0;
function ensurePlayer(v) {
  if (v.player) return v.player;
  try { const AC = root.AudioContext || root.webkitAudioContext, ctx = new AC(); ctx.resume && ctx.resume(); v.player = new (JV().Player)(ctx); } catch (e) { v.player = null; }
  return v.player;
}
function stopSmartSpeech() { ttsToken++; if (V && V.player) V.player.stop(); }
async function speakSmart(text, done) {
  const v = V, J = JV(), tok = ++ttsToken;
  text = speechClean(text);
  if (!text) { done && done(); return false; }
  if (v && smartOn() && cfg().speak !== false && ensurePlayer(v)) {
    try {
      const d = await J.synth({ key: J.getKey(), sdk: J.loadSdk, voice: cfg().gvoice || J.DEFAULT_VOICE }, text);
      if (V !== v || tok !== ttsToken) return true;
      v.player.enqueue(d.pcm, d.rate);
      setTimeout(() => { if (V === v && tok === ttsToken) done && done(); }, v.player.endsInMs + 80);
      return true;
    } catch (e) { /* hlas Gemini teď nejde → systémový hlas */ }
  }
  return speak(text, done);
}

/* ---- okno asistenta (psaní; diktování tlačítkem 🎙︎) ---- */
function open(opts) {
  if (!H) return;
  if (!cfg().on) { H.toast("Asistent je vypnutý – zapni ho v nastavení."); return; }
  closeVoice();
  addStyle();
  const log = h("div", { class: "aiLog" });
  const ta = h("textarea", { rows: 1, placeholder: "Řekni nebo napiš, co se stalo…", "aria-label": "Příkaz pro asistenta", enterkeyhint: "send" });
  let rec = null;
  const uis = [];
  const say = (cls, ...kids) => { const m = h("div", { class: "aiMsg " + cls }, ...kids); log.append(m); log.scrollTop = log.scrollHeight; return m; };
  const dlg = document.getElementById("edDlg");
  const ctl = { ta, listening: () => !!rec, toggleMic: () => {} };
  const onClose = () => { uis.forEach(u => u.stop()); if (pend && pend.owner === ctl) { pend.ui.cancel(); pend = null; } try { rec && rec.abort(); } catch (e) {} stopSpeech(); if (cur === ctl) cur = null; dlg && dlg.removeEventListener("close", onClose); };
  dlg && dlg.addEventListener("close", onClose);

  const mic = api.voiceSupported() ? h("button", { type: "button", class: "mic", "aria-label": "Diktovat", onclick: () => toggleMic() }, "🎙︎") : null;
  const send = h("button", { type: "button", "aria-label": "Odeslat", onclick: () => submit(ta.value) }, "↑");

  function toggleMic() {
    if (rec) { rec.stop(); return; }
    mic.classList.add("on");
    rec = listen({
      onText: (t, fin) => { ta.value = t; },
      onEnd: (t, fin) => { rec = null; mic.classList.remove("on"); if (t && t.trim()) submit(t); },
      onError: e => { rec = null; mic.classList.remove("on"); if (e !== "aborted") H.toast(VOICE_ERR[e] || "Mikrofon: " + e); },
    });
    if (!rec) mic.classList.remove("on");
  }

  /* základní režim: pravidlový parser v zařízení */
  function offline(text, note) {
    try {
      if (note) say("bot", note);
      const res = understand(text, { leads: H.leads(), now: new Date() });
      if (res.query) { const a = answerQuery(res.query, H.facts ? H.facts() : null, new Date()); say("bot", a.lines.join("\n")); return; }
      const plan = buildPlan(res, { leads: H.leads(), now: new Date(), calEvents: H.calEvents(), meetMinutes: 60 });
      if (plan.reply) say("bot", plan.reply);
      if (plan.steps.length || plan.problems.length) {
        const ui = planCard(plan, {});
        uis.push(ui);
        log.append(h("div", { class: "aiMsg bot", style: "max-width:100%;width:100%;padding:0;background:none" }, ui.card)); log.scrollTop = log.scrollHeight;
        ui.start();
      }
    } catch (e) { say("bot", "⚠ " + (e.message || "Něco se pokazilo")); }
  }
  let asking = false;
  function submit(text) {
    text = String(text || "").trim();
    if (!text || busy || asking) return;
    ta.value = ""; say("me", text);
    if (!smartOn()) { offline(text); return; }
    /* chytrý režim: odpověď Gemini; karty s plánem se řadí pod její bublinu */
    asking = true;
    const wait = say("bot", "…");
    let anchor = wait;
    const sink = { owner: ctl, show: (node, ui) => { uis.push(ui); const w = h("div", { class: "aiMsg bot", style: "max-width:100%;width:100%;padding:0;background:none" }, node); anchor.after(w); anchor = w; log.scrollTop = log.scrollHeight; } };
    smartAsk(text, sink).then(r => {
      asking = false;
      if (r.text) wait.textContent = r.text; else wait.remove();
      log.scrollTop = log.scrollHeight;
    }, e => { asking = false; wait.remove(); offline(text, "⚠ " + JV().friendlyError(e) + " Zkouším základní režim."); });
  }

  H.openSheet("Asistent", [
    log,
    h("div", { class: "aiIn" }, ta, mic, send),
    h("p", { class: "aiHint" }, "Např.: „Podepsal jsem smlouvu s Novákem a domluvil jsem si s ním online schůzku ve středu v 17h.“ Nebo se zeptej: „Co mám dneska v úkolech?“ " + (smartOn() ? "Odpovídá chytrý režim (Gemini)." : "Vyhodnocuje se přímo v zařízení.") + (mic ? " Na počítači: mezerník (když nepíšeš) spustí hlasového asistenta." : " Mikrofon v tomhle prohlížeči nejde – diktuj mikrofonem na klávesnici.")),
  ]);
  ta.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(ta.value); } });
  ctl.toggleMic = mic ? toggleMic : () => H.toast("Mikrofon v tomhle prohlížeči nejde – diktuj mikrofonem na klávesnici.");
  cur = ctl;
  if (opts && opts.listen) { if (mic) toggleMic(); else H.toast("Mikrofon v tomhle prohlížeči nejde – piš, nebo diktuj mikrofonem na klávesnici."); }
  /* kurzor: hned pryč z křížku okna (jinak by mezerník okno zavřel místo diktování), za chvíli do pole – jen když se nediktuje */
  log.tabIndex = -1; log.focus({ preventScroll: true });
  setTimeout(() => { if (!rec) ta.focus(); }, 80);
}

/* ---- hlasový výstup (systémový hlas zařízení – žádná služba, žádné poplatky) ---- */
let speakToken = 0;
const speakOn = () => cfg().speak !== false && !!(root.speechSynthesis && root.SpeechSynthesisUtterance);
function stopSpeech() { speakToken++; try { root.speechSynthesis && root.speechSynthesis.cancel(); } catch (e) {} }
/* iOS pustí hlas jen po „odemčení“ v rámci klepnutí – jinak by odpověď po rozpoznání řeči (mimo gesto) mlčela */
let speechUnlocked = false;
function unlockSpeech() {
  if (speechUnlocked || !speakOn()) return;
  const ua = navigator.userAgent || "";
  if (!(/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1))) return;
  speechUnlocked = true;
  try { const u = new root.SpeechSynthesisUtterance(" "); u.volume = 0; root.speechSynthesis.speak(u); } catch (e) {}
}
function speak(text, done) {
  const ss = root.speechSynthesis;
  if (!ss || !root.SpeechSynthesisUtterance || !text) { done && done(); return false; }
  const vs = ss.getVoices ? ss.getVoices() : [], v = pickVoice(vs, cfg().voice);
  if (vs.length && !v) { done && done(); return false; }   /* žádný český hlas → radši mlčet než číst česky cizím hlasem */
  const tok = ++speakToken;
  try { ss.cancel(); } catch (e) {}
  const u = new root.SpeechSynthesisUtterance(text);
  u.lang = (v && v.lang) || "cs-CZ"; if (v) u.voice = v; u.rate = 1; u.pitch = 1; u.volume = 1;
  const fin = () => { if (tok === speakToken) done && done(); };
  u.onend = fin; u.onerror = fin;
  u.onboundary = () => { if (V) V.pulse = 1; };
  setTimeout(() => { if (tok !== speakToken) return; try { ss.speak(u); } catch (e) { fin(); } }, 40);   /* Chrome někdy zahodí speak() hned po cancel() */
  return true;
}

/* ---- hlasový asistent: rozmazaná appka, uprostřed ekvalizér, odpovídá hlasem ---- */
let V = null;
const EQ_BARS = 25, IDLE_HINT = "Mezerník = další příkaz · Esc = zavřít";
const liveBtn = () => { const c = V && V.call; return !c || c.state === "closed" ? "🎙︎ Mluvit" : c.state === "speaking" ? "✋ Přerušit" : c.muted ? "🎙︎ Zapnout mikrofon" : "🔇 Ztlumit"; };
function setMode(mode, text) {
  if (!V) return;
  V.mode = mode; V.el.dataset.mode = mode; V.stateEl.textContent = text || "";
  V.micBtn.textContent = V.live ? liveBtn() : mode === "listening" ? "■ Hotovo" : "🎙︎ Mluvit";
}
function startMeter(v) {
  /* skutečná hlasitost z mikrofonu jen v Chromu/Edgi na počítači (jinde by druhý přístup k mikrofonu mohl rušit rozpoznávání) – jinak se ekvalizér jen animuje */
  const ua = navigator.userAgent || "";
  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) || !/Chrome|Edg\//.test(ua) || /Android|iPhone|iPad|iPod|Mobile/.test(ua)) return;
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    if (V !== v || !v.rec) { stream.getTracks().forEach(t => t.stop()); return; }
    try {
      const AC = root.AudioContext || root.webkitAudioContext, ctx = new AC(), an = ctx.createAnalyser();
      an.fftSize = 256; an.smoothingTimeConstant = 0.55;
      ctx.createMediaStreamSource(stream).connect(an); ctx.resume && ctx.resume();
      v.meter = { stream, ctx, an, data: new Uint8Array(an.frequencyBinCount) };
    } catch (e) { stream.getTracks().forEach(t => t.stop()); }
  }).catch(() => {});
}
function stopMeter(v) {
  const m = v && v.meter; if (!m) return; v.meter = null;
  try { m.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
  try { m.ctx.close(); } catch (e) {}
}
/* skutečná hlasitost pro ekvalizér: živý hovor (mikrofon / hlas modelu), hlas Gemini v rychlém režimu, mikrofon při diktování; jinak null → animace */
function eqLevels(v, mode) {
  if (v.call && v.call.state !== "closed") return mode === "speaking" ? v.call.outLevels() : mode === "listening" && !v.call.muted ? v.call.micLevels() : null;
  if (mode === "speaking" && v.player && v.player.playing) return v.player.levels();
  if (mode === "listening" && v.meter) { v.meter.an.getByteFrequencyData(v.meter.data); return v.meter.data; }
  return null;
}
function tick(ts) {
  const v = V; if (!v) return;
  v.raf = requestAnimationFrame(tick);
  if (v.reduce) return;
  const t = ts / 1000, n = v.bars.length, mode = v.mode, d = eqLevels(v, mode);
  v.pulse = Math.max(0, v.pulse - 0.04);
  for (let i = 0; i < n; i++) {
    const w = 0.5 + 0.5 * Math.sin(Math.PI * (i + 0.5) / n);
    const real = d ? Math.pow(d[1 + Math.floor(i * 22 / n)] / 255, 1.1) * 1.5 * w : 0;
    let tgt;
    if (mode === "listening") tgt = d ? real : (0.12 + 0.5 * v.pulse) * (0.55 + 0.45 * Math.sin(t * 7 + i * 0.9)) * w + 0.06;
    else if (mode === "speaking") tgt = d ? real + 0.05 : (0.35 + 0.45 * v.pulse + 0.2 * Math.sin(t * 3.1)) * (0.5 + 0.5 * Math.sin(t * 9 + i * 1.3) * Math.cos(t * 4.3 + i * 0.5)) * w + 0.05;
    else if (mode === "thinking") tgt = 0.1 + 0.35 * Math.max(0, Math.sin(t * 6 - i * 0.55));
    else tgt = 0.05 + 0.04 * Math.sin(t * 1.6 + i * 0.4);
    const c = v.hs[i]; v.hs[i] = c + (tgt - c) * (tgt > c ? 0.55 : 0.16);
    v.bars[i].style.transform = "scaleY(" + Math.max(0.06, Math.min(1, v.hs[i])).toFixed(3) + ")";
  }
}
function openVoice(opts) {
  if (!H) return;
  if (!cfg().on) { H.toast("Asistent je vypnutý – zapni ho v nastavení."); return; }
  const live = liveOk();
  if (!api.voiceSupported() && !live) { open(); return; }
  if (V) { if (opts && opts.listen) voiceToggle(); return; }
  unlockSpeech();
  addStyle();
  if (document.getElementById("edDlg") && document.getElementById("edDlg").open && cur) document.getElementById("edDlg").close();
  const bars = Array.from({ length: EQ_BARS }, () => h("i"));
  const stateEl = h("div", { class: "vstate", "aria-live": "polite" }), textEl = h("div", { class: "vtext", "aria-live": "polite" }), capEl = h("div", { class: "vcap", "aria-live": "polite" }), logEl = h("div", { class: "vlog" });
  const micBtn = h("button", { type: "button", class: "vmic", onclick: () => (V && V.live ? liveButton() : voiceToggle()) }, "🎙︎ Mluvit");
  const el = h("div", { class: "aiVoice", id: "aiVoice", role: "dialog", "aria-modal": "true", "aria-label": "Hlasový asistent", tabindex: "-1" },
    h("button", { type: "button", class: "vx", "aria-label": "Zavřít", onclick: () => closeVoice() }, "✕"),
    h("div", { class: "vbox" }, h("div", { class: "veq", "aria-hidden": "true" }, bars), stateEl, textEl, capEl, logEl,
      h("div", { class: "vbtns" }, micBtn, h("button", { type: "button", onclick: () => { closeVoice(); open(); } }, "⌨︎ Psát"))));
  document.body.append(el);
  const reduce = !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
  V = { el, bars, stateEl, textEl, capEl, logEl, micBtn, mode: "idle", rec: null, meter: null, ui: null, pulse: 0, hs: bars.map(() => 0.06), reduce, raf: 0, err: "", live, call: null, player: null };
  if (reduce) bars.forEach(b => { b.style.transform = "scaleY(.3)"; });
  requestAnimationFrame(() => { if (el.isConnected) el.classList.add("on"); });
  el.focus({ preventScroll: true });
  V.raf = requestAnimationFrame(tick);
  setMode("idle", live ? "Připojuju se…" : IDLE_HINT);
  if (live) vLive(); else if (!opts || opts.listen !== false) vListen();
}
function closeVoice() {
  if (!V) return;
  const v = V; V = null;
  try { v.rec && v.rec.abort(); } catch (e) {}
  try { v.call && v.call.stop(); } catch (e) {}
  stopMeter(v); stopSpeech(); ttsToken++;
  if (v.player) { try { v.player.stop(); v.player.ctx.close(); } catch (e) {} }
  v.ui && v.ui.stop();
  if (pend && pend.owner === v) { pend.ui.cancel(); pend = null; }
  cancelAnimationFrame(v.raf);
  v.el.classList.remove("on"); setTimeout(() => v.el.remove(), 200);
  if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) document.activeElement.blur();   /* ať mezerník po zavření nemačká dřívější tlačítko */
}
function voiceToggle() {
  if (!V || busy) return;
  unlockSpeech();
  if (V.live) { liveSpace(); return; }
  if (V.rec) { V.rec.stop(); return; }
  stopSpeech(); stopSmartSpeech(); vListen();
}
function vListen() {
  const v = V; if (!v || v.rec) return;
  v.ui && v.ui.cancel();   /* čekající příkaz s odpočtem se novou větou ruší – a je to vidět */
  v.textEl.textContent = ""; v.capEl.textContent = ""; v.err = "";
  setMode("listening", "Poslouchám… (mezerník = hotovo)");
  const handle = listen({
    onText: t => { if (V === v) { v.textEl.textContent = t; v.pulse = 1; } },
    onEnd: t => {
      if (V !== v || v.rec !== handle) return;
      v.rec = null; stopMeter(v);
      if (t && t.trim()) { vHandle(t.trim()); return; }
      setMode("idle", v.err && v.err !== "aborted" ? (VOICE_ERR[v.err] || "Mikrofon: " + v.err) : "Nic jsem neslyšela. Stiskni mezerník a řekni to znovu.");
    },
    onError: e => { if (V === v) v.err = e; },
  });
  if (!handle) { setMode("idle", VOICE_ERR[v.err] || VOICE_ERR.unsupported); return; }
  v.rec = handle; startMeter(v);
}
function vSay(text) {
  const v = V; if (!v) return;
  if (!text || cfg().speak === false) { setMode("idle", IDLE_HINT); return; }
  const smart = smartOn();
  if (!smart && !speakOn()) { setMode("idle", IDLE_HINT); return; }
  setMode("speaking", "Odpovídám…");
  const fin = () => { if (V === v && v.mode === "speaking") setMode("idle", IDLE_HINT); };
  Promise.resolve(smart ? speakSmart(text, fin) : speak(text, fin)).then(ok => { if (!ok) fin(); });
}

/* ---- živý hovor (Gemini Live): mluvíš volně, mikrofon běží, odpovídá přirozeným hlasem ---- */
function liveMode(v, st) {
  const c = v.call;
  if (st === "listening") setMode("listening", c && c.muted ? "Mikrofon je ztlumený." : "Poslouchám… (mluv volně)");
  else if (st === "thinking" || st === "connecting") setMode("thinking", st === "connecting" ? "Připojuju se…" : "Zpracovávám…");
  else if (st === "speaking") setMode("speaking", "Odpovídám… (mezerník = přeruš)");
}
function liveSink(v, call) {
  return {
    owner: v,
    show: (node, ui) => { v.ui = ui; v.logEl.append(node); while (v.logEl.children.length > 3) v.logEl.firstChild.remove(); },
    beforeManual: () => closeVoice(),
    onRun: out => {
      const bad = out.lines.some(l => /^✗/.test(l));
      call.sendText("[Systém] " + (bad ? "Chyba při provedení: " : "Provedeno: ") + out.lines.join(" | ").slice(0, 600)
        + (out.smsJobs.length ? " SMS klientovi je připravená, stačí klepnout na Odeslat." : "") + (out.manuals.length ? " Potvrzení klientovi je nutné poslat ručně (tlačítko na obrazovce)." : "") + (bad ? " Řekni uživateli, že se něco nepovedlo." : ""));
    },
    onCancel: () => call.sendText("[Systém] Zrušeno. Uživatel plán zrušil, nic se neprovedlo."),
  };
}
function vLive() {
  const v = V, J = JV(); if (!v || !J || v.call) return;
  v.live = true; v.textEl.textContent = ""; v.capEl.textContent = "";
  setMode("thinking", "Připojuju se…");
  const tools = J.makeTools(api, { now: () => new Date(), leads: () => H.leads(), facts: () => (H.facts ? H.facts() : null), propose: actions => proposePlan(actions, liveSink(v, call)), cancelPending });
  const call = new J.LiveCall({
    key: J.getKey(), sdk: J.loadSdk, voice: cfg().gvoice || J.DEFAULT_VOICE, system: J.systemPrompt(new Date(), { callMe: cfg().callMe }), declarations: tools.declarations,
    bargeIn: cfg().barge === true, idleMs: 2 * 60000,
    onTools: calls => tools.runBatch(calls),
    onState: st => { if (V === v && v.call === call) liveMode(v, st); },
    onUser: t => { if (V === v && v.call === call) { v.textEl.textContent = t; v.capEl.textContent = ""; } },
    onModel: t => { if (V === v && v.call === call) v.capEl.textContent = t; },
    onClosed: msg => liveEnded(v, call, msg),
    onIdle: () => { if (V === v && v.call === call) { v.call = null; setMode("idle", "Spím. Stiskni mezerník a vzbudím se."); } },
  });
  v.call = call;
  call.start().catch(e => liveEnded(v, call, J.friendlyError(e)));
}
function liveEnded(v, call, msg) {
  if (V !== v || v.call !== call) return;
  v.call = null; v.live = false;   /* další příkaz půjde rychlým režimem (rozpoznávání řeči prohlížeče), pokud ho prohlížeč umí */
  setMode("idle", msg + (api.voiceSupported() ? " Přepnula jsem na rychlý režim – stiskni mezerník." : ""));
}
function liveSpace() {
  const v = V, c = v.call;
  if (v.ui && v.ui.auto && v.ui.phase() === "pending") {   /* běží odpočet → mezerník plán zruší */
    v.ui.cancel(); if (pend && pend.ui === v.ui) pend = null;
    if (c) c.sendText("[Systém] Zrušeno. Uživatel plán zrušil, nic se neprovedlo.");
    return;
  }
  if (!c) { vLive(); return; }
  if (c.state === "speaking") c.interrupt();
}
function liveButton() {
  const v = V, c = v.call;
  if (!c || c.state === "closed") { vLive(); return; }
  if (c.state === "speaking") { c.interrupt(); return; }
  c.setMuted(!c.muted); liveMode(v, c.state);
}

/* ---- rychlý režim: rozpoznávání řeči prohlížeče → mozek Gemini → hlas Gemini ---- */
function vHandle(text) { if (smartOn()) vSmart(text); else vHandleOffline(text); }
function vSmart(text) {
  const v = V; if (!v) return;
  v.textEl.textContent = text; v.capEl.textContent = ""; v.logEl.replaceChildren(); v.ui = null;
  setMode("thinking", "Přemýšlím…");
  const ans = h("div", { class: "vans", hidden: true }); v.logEl.append(ans);
  const sink = { owner: v, show: (node, ui) => { v.ui = ui; v.logEl.append(node); }, beforeManual: () => closeVoice(), onRun: out => { if (V === v) vSay(spokenDone(out)); } };
  smartAsk(text, sink).then(r => {
    if (V !== v) return;
    if (r.text) { ans.hidden = false; ans.append(h("p", {}, r.text)); vSay(r.text); } else setMode("idle", IDLE_HINT);
  }, e => { if (V === v) vHandleOffline(text, JV().friendlyError(e) + " Používám základní režim."); });
}

/* ---- základní režim: pravidlový parser v zařízení ---- */
function vHandleOffline(text, note) {
  const v = V; if (!v) return;
  v.textEl.textContent = text; v.logEl.replaceChildren(); v.ui = null;
  setMode("thinking", "Zpracovávám…");
  const now = new Date(), say = (...lines) => v.logEl.append(h("div", { class: "vans" }, lines.map(l => h("p", {}, l))));
  if (note) say("⚠ " + note);
  try {
    const res = understand(text, { leads: H.leads(), now });
    if (res.query) { const a = answerQuery(res.query, H.facts ? H.facts() : null, now); say(...a.lines); vSay(a.speak); return; }
    const plan = buildPlan(res, { leads: H.leads(), now, calEvents: H.calEvents(), meetMinutes: 60 });
    if (plan.reply) say(plan.reply);
    if (!plan.steps.length && !plan.problems.length) { vSay(spokenPlan(plan, now, 0)); return; }
    let pre = "";
    const ui = planCard(plan, { beforeManual: () => closeVoice(), afterRun: out => { if (V === v) vSay((pre ? pre + " " : "") + spokenDone(out)); } });
    v.ui = ui; v.logEl.append(ui.card);
    const said = spokenPlan(plan, now, ui.countdown, ui.auto);
    if (ui.auto && !ui.countdown) pre = said;   /* provede se hned: nahlas řekne, co udělala, až po provedení */
    ui.start();
    if (!pre) vSay(said);
  } catch (e) { say("⚠ " + (e.message || "Něco se pokazilo")); setMode("idle", IDLE_HINT); }
}

/* ---- mezerník na počítači: otevře hlasového asistenta / spustí a zastaví poslech; Esc ho zavře ---- */
const assistantOpen = () => { const d = document.getElementById("edDlg"), t = document.getElementById("edTitle"); return !!(cur && d && d.open && t && t.textContent === "Asistent"); };
const INTERACTIVE = "input,textarea,select,summary,a[href],button,[contenteditable],[role='button'],[role='tab'],[role='switch'],[role='checkbox'],[role='menuitem'],[role='option'],[role='link']";
let swallowUp = false;
function onHotkey(e) {
  if (!H) return;
  if (V && e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); closeVoice(); return; }
  if ((e.code !== "Space" && e.key !== " ") || e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.defaultPrevented) return;
  const c = cfg();
  if (!c.on || c.hotkey === false || H.demo) return;
  const voice = !!V, open_ = assistantOpen();
  const hit = (document.activeElement && document.activeElement.closest) ? document.activeElement.closest(INTERACTIVE) : null;
  if (hit) {
    if (voice) {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(hit.tagName) || hit.isContentEditable) return;   /* píšeš (např. jméno nového kontaktu v kartě) */
      if (hit.matches(":focus-visible")) return;                                          /* tlačítko vybrané klávesnicí: mezerník ho aktivuje */
    }
    else if (open_ && cur.listening()) { /* diktuje se → mezerník zastaví, ať je kurzor kdekoli */ }
    else if (open_ && hit === cur.ta && !hit.value.trim()) { /* prázdné pole asistenta: mezerník nic nepíše, spustí diktování */ }
    else if (/^(INPUT|TEXTAREA|SELECT)$/.test(hit.tagName) || hit.isContentEditable) return;   /* píšeš / přepínáš pole */
    else if (hit.matches(":focus-visible")) return;                                          /* tlačítko vybrané klávesnicí: mezerník ho aktivuje */
  }
  const od = document.querySelector("dialog[open]");
  if (od && !open_) return;   /* jiné okno (editace, zámek, …) – nerušit */
  e.preventDefault(); swallowUp = true;
  if (open_) cur.toggleMic(); else if (voice) voiceToggle(); else openVoice({ listen: true });
}
function onHotkeyUp(e) { if (swallowUp && (e.code === "Space" || e.key === " ")) { swallowUp = false; e.preventDefault(); } }

/* ---- nastavení ---- */
/* ---- nastavení chytrého režimu (klíč, režim, hlas, zkouška spojení) ---- */
function smartSettings(c, save, sw) {
  const J = JV();
  if (!J) return [h("label", {}, "Chytrý režim (Gemini)"), h("p", { class: "hint" }, "Chytrý režim se nenačetl (chybí jarvis.js). Obnov stránku.")];
  const status = h("p", { class: "hint", id: "aiKeyStatus" });
  const upd = () => { const k = J.getKey(); status.textContent = k ? "Klíč je uložený jen v tomhle zařízení (" + J.maskKey(k) + ")." : "Klíč není vložený – asistentka používá základní režim."; };
  const key = h("input", { type: "password", placeholder: "Vlož klíč z AI Studia (AIza…)", autocomplete: "off", spellcheck: "false", "aria-label": "Klíč Gemini", name: "gem-key-field" });
  const saveKey = h("button", { type: "button", class: "dbtn", onclick: () => { if (J.setKey(key.value)) { key.value = ""; upd(); H.toast("Klíč uložen jen v tomhle zařízení"); refresh(); } else H.toast("Tohle nevypadá jako klíč (bez mezer, aspoň 20 znaků)."); } }, "Uložit klíč");
  const delKey = h("button", { type: "button", class: "dbtn", onclick: () => { J.clearKey(); upd(); refresh(); H.toast("Klíč smazán"); } }, "Smazat klíč");
  upd();
  const modeSel = h("select", { "aria-label": "Režim chytrého asistenta" }, h("option", { value: "live" }, "Živý hovor – mluvíš volně, mikrofon poslouchá"), h("option", { value: "rest" }, "Rychlý – diktování prohlížeče + hlas Gemini"));
  modeSel.value = c.mode === "rest" ? "rest" : "live"; modeSel.onchange = () => save({ mode: modeSel.value });
  const voiceSel = h("select", { "aria-label": "Hlas Gemini" }, J.VOICES.map(([id, label]) => h("option", { value: id }, label)));
  voiceSel.value = J.VOICES.some(v => v[0] === c.gvoice) ? c.gvoice : J.DEFAULT_VOICE; voiceSel.onchange = () => save({ gvoice: voiceSel.value });
  const play = h("button", { type: "button", class: "dbtn", onclick: async () => {
    if (!J.getKey()) { H.toast("Nejdřív vlož klíč."); return; }
    let ctx; try { const AC = root.AudioContext || root.webkitAudioContext; ctx = new AC(); ctx.resume && ctx.resume(); } catch (e) { H.toast("Přehrávání zvuku tu nejde."); return; }
    play.disabled = true;
    try { const d = await J.synth({ key: J.getKey(), sdk: J.loadSdk, voice: voiceSel.value, noCache: true }, "Dobrý den, tady vaše asistentka. Schůzka s paní Šikulovou je v neděli prvního listopadu v patnáct hodin."); const pl = new J.Player(ctx); pl.enqueue(d.pcm, d.rate); setTimeout(() => { try { ctx.close(); } catch (e) {} }, pl.endsInMs + 600); }
    catch (e) { H.toast(J.friendlyError(e)); try { ctx.close(); } catch (e2) {} }
    play.disabled = false;
  } }, "▶ Vyzkoušet hlas Gemini");
  const callMe = h("input", { placeholder: "např. Vojto (volitelné)", autocomplete: "off", "aria-label": "Oslovení" }); callMe.value = c.callMe || ""; callMe.onchange = () => save({ callMe: callMe.value.trim().slice(0, 30) });
  const out = h("div", { class: "hint", id: "aiTestOut" });
  const test = h("button", { type: "button", class: "dbtn", onclick: async () => {
    if (!J.getKey()) { H.toast("Nejdřív vlož klíč."); return; }
    let ctx; try { const AC = root.AudioContext || root.webkitAudioContext; ctx = new AC(); ctx.resume && ctx.resume(); } catch (e) { ctx = null; }
    test.disabled = true; out.replaceChildren(h("div", {}, "Zkouším spojení s Gemini…"));
    const r = await J.selfTest({ key: J.getKey(), sdk: J.loadSdk, voice: voiceSel.value }, (ok, t) => out.append(h("div", { style: "color:var(--" + (ok ? "green" : "red") + ")" }, (ok ? "✓ " : "✗ ") + t))).catch(e => { out.append(h("div", { style: "color:var(--red)" }, "✗ " + J.friendlyError(e))); return {}; });
    if (ctx) { if (r.ttsAudio) { const pl = new J.Player(ctx); pl.enqueue(r.ttsAudio.pcm, r.ttsAudio.rate); setTimeout(() => { try { ctx.close(); } catch (e) {} }, pl.endsInMs + 600); } else try { ctx.close(); } catch (e) {} }
    test.disabled = false;
  } }, "Otestovat spojení s Gemini");
  return [
    h("label", {}, "Chytrý režim (Gemini od Googlu)"),
    h("p", { class: "hint" }, "Volná konverzace jako s Jarvisem: asistentka rozumí běžné češtině, doptává se, čte ti data z pipeline a navrhuje zápisy (provádí je stejná karta s odpočtem jako dřív). Zdarma: klíč si vytvoříš na aistudio.google.com/apikey (účet Google, bez karty) a vložíš sem."),
    key, h("div", { class: "btns", style: "display:flex;gap:8px;flex-wrap:wrap;margin:6px 0" }, saveKey, delKey), status,
    h("label", { class: "frow" }, h("span", {}, "Použít chytrý režim"), sw(c.smart !== false, v => save({ smart: v }))),
    h("label", {}, "Režim"), modeSel,
    h("label", {}, "Hlas asistentky (Gemini)"), voiceSel, play,
    h("label", { class: "frow" }, h("span", {}, "Skákání do řeči (doporučena sluchátka)"), sw(c.barge === true, v => save({ barge: v }))),
    h("p", { class: "hint" }, "Vypnuto: když asistentka mluví, mikrofon mlčí (nezachytí vlastní hlas z reproduktorů); přerušíš ji mezerníkem nebo tlačítkem. Zapnuto: můžeš jí skočit do řeči hlasem, ale na reproduktorech se může slyšet sama."),
    h("label", {}, "Oslovení", callMe),
    test, out,
    h("p", { class: "hint" }, "Soukromí: Googlu jde to, co řekneš nebo napíšeš, a data z pipeline, na která se asistentka zeptá (jména klientů, termíny, úkoly, tvoje body a provize). Telefony, e-maily ani poznámky o klientech se modelu neposílají (kromě toho, co sám nadiktuješ). Podle podmínek Gemini API (ai.google.dev/gemini-api/terms) platí pro vývojáře z EU, Švýcarska a Británie i u bezplatné kvóty pravidla placených služeb: obsah se nepoužívá ke zlepšování produktů, jen se krátce loguje kvůli zneužití. Jestli smíš jména klientů takhle zpracovávat, si ověř u ZFP (GDPR). Klíč smaž, kdybys zařízení ztratil/a (a zruš ho v AI Studiu). Bez klíče nebo při výpadku funguje základní režim v zařízení."),
  ];
}

function renderSettings(box) {
  if (!box || !H) return;
  const c = cfg(), save = async patch => { try { await H.saveSettings({ ai: { ...cfg(), ...patch } }); refresh(); } catch (e) { H.toast("Nepodařilo se uložit"); } };
  const sw = (checked, on) => { const i = h("input", { type: "checkbox", class: "switch" }); i.checked = checked; i.onchange = () => on(i.checked); return i; };
  const delay = h("input", { type: "number", min: 0, max: 60, style: "width:70px" }); delay.value = c.delay;
  delay.onchange = () => save({ delay: Math.max(0, Math.min(60, +delay.value || 0)) });
  const from = h("input", { type: "email", placeholder: "vojtech.kudlicka@zfpa.cz (volitelné)", autocomplete: "off" }); from.value = c.from || "";
  from.onchange = () => save({ from: from.value.trim() });
  const gm = H.hasScope("gmail.send");
  const voiceSel = h("select", { "aria-label": "Hlas asistentky" });
  const fillVoices = () => {
    const vs = (root.speechSynthesis && root.speechSynthesis.getVoices ? root.speechSynthesis.getVoices() : []).filter(v => /^cs([-_]|$)/i.test(v.lang || ""));
    const best = pickVoice(vs, "");
    voiceSel.replaceChildren(h("option", { value: "" }, "Hlas: automaticky" + (best ? " (" + best.name + ")" : "")), ...vs.map(v => h("option", { value: v.voiceURI || v.name }, v.name)));
    voiceSel.value = c.voice && vs.some(v => (v.voiceURI || v.name) === c.voice) ? c.voice : "";
    const hint = document.getElementById("aiVoiceHint");
    if (hint) hint.textContent = vs.length ? "Hlas dodává systém zařízení (zdarma, bez internetu). Na Macu a iPhonu je to Zuzana; kvalitnější verzi stáhneš v nastavení systému (Zpřístupnění → Mluvený obsah → Systémový hlas → Spravovat hlasy). V Edgi může být k dispozici přirozenější hlas (Vlasta)." : (root.speechSynthesis ? "V tomhle zařízení není nainstalovaný žádný český hlas – odpovědi se jen zobrazí. Český hlas se přidává v nastavení systému (Mluvený obsah / Řeč)." : "Tenhle prohlížeč neumí mluvit – odpovědi se jen zobrazí.");
  };
  voiceSel.onchange = () => save({ voice: voiceSel.value });
  fillVoices();
  renderSettings.fill = fillVoices;
  if (root.speechSynthesis && root.speechSynthesis.addEventListener && !renderSettings.bound) { renderSettings.bound = true; root.speechSynthesis.addEventListener("voiceschanged", () => { if (document.getElementById("aiVoiceHint") && renderSettings.fill) renderSettings.fill(); }); }
  setTimeout(() => { if (document.getElementById("aiVoiceHint") && renderSettings.fill === fillVoices) fillVoices(); }, 300);
  box.replaceChildren(
    h("label", {}, "Asistent (psaní a hlas)"),
    h("label", { class: "frow" }, h("span", {}, "Zapnout asistenta"), sw(c.on, v => save({ on: v }))),
    h("p", { class: "hint" }, "Základní režim (bez klíče): větu vyhodnocuje appka přímo v zařízení, žádná AI služba ani předplatné. Rozumí pevným příkazům (schůzka, podpis, nabídka, zápis, nový kontakt) a dotazům („Co mám dneska v úkolech?“, „Jaké jsou moje výsledky?“, „Kdy mám schůzku s Novákem?“). Pozor: převod hlasu na text dělá prohlížeč – Chrome a Edge posílají nahrávku svému rozpoznávání řeči (Google, Microsoft), Safari Applu. Jména klientů tak při diktování mohou opustit zařízení; co napíšeš, zůstává jen tady."),
    ...smartSettings(c, save, sw),
    h("label", { class: "frow" }, h("span", {}, "Mezerník spustí hlasového asistenta (počítač)"), sw(c.hotkey !== false, v => save({ hotkey: v }))),
    h("p", { class: "hint" }, "Když zrovna nic nepíšeš a není otevřené jiné okno, mezerník rozmaže appku, otevře ekvalizér a začne poslouchat; druhým stiskem poslech skončí a příkaz se zpracuje, dalším začneš nový. Esc zavře. Potřebuje Chrome, Edge nebo Safari s povoleným mikrofonem."),
    h("label", { class: "frow" }, h("span", {}, "Odpovídat hlasem"), sw(c.speak !== false, v => save({ speak: v }))),
    voiceSel, h("button", { type: "button", class: "dbtn", onclick: () => { stopSpeech(); if (!speak("Dobrý den, tady vaše asistentka. Schůzka s paní Šikulovou je v neděli prvního listopadu v patnáct hodin.")) H.toast("V tomhle zařízení není český hlas."); } }, "▶ Vyzkoušet hlas"),
    h("p", { class: "hint", id: "aiVoiceHint" }),
    h("label", {}, "Počkat před provedením (s) ", delay),
    h("p", { class: "hint" }, "Po rozpoznání příkazu máš tuhle chvíli na zrušení. Příkazy s jiným než jednoznačným jménem, varováním nebo novým kontaktem se vždy provádějí až po tvém klepnutí."),
    h("label", { class: "frow" }, h("span", {}, "Připravit SMS klientovi po schůzce"), sw(c.sms !== false, v => save({ sms: v }))),
    h("p", { class: "hint" }, "Z webové appky na iPhonu SMS sama odejít nemůže (to neumí žádná zdarma). Asistent otevře Zprávy s hotovým textem – stačí klepnout na Odeslat."),
    h("label", { class: "frow" }, h("span", {}, "Potvrzení e-mailem u online schůzek (samo)"), sw(c.mail !== false, v => save({ mail: v }))),
    gm ? h("p", { class: "hint" }, "Odesílání e-mailů z Gmailu je povolené.") : h("button", { type: "button", class: "dbtn", onclick: () => H.requestScope(GMAIL_SCOPE) }, "Povolit odesílání e-mailů z Gmailu"),
    h("label", {}, "Odesílat jako (alias v Gmailu)", from),
    h("p", { class: "hint" }, "Gmail odešle e-mail z tvé adresy v Gmailu. Chceš-li odesílat z jiné adresy (např. @zfpa.cz), musí být v Gmailu nastavená jako „Odesílat jako“ – jinak ji Gmail tiše nahradí.")
  );
}

function init(host) {
  H = host; refresh();
  if (!hotkeyBound) { hotkeyBound = true; document.addEventListener("keydown", onHotkey, true); document.addEventListener("keyup", onHotkeyUp, true); }
}

return Object.assign(api, { init, refresh, open, openVoice, closeVoice, renderSettings });
});

/* Host (dodává index.html):
   settings()                 → objekt nastavení (settings.ai = {on,url,delay,sms,mail,from})
   saveSettings(patch)        → uloží do settings/main
   leads(), calEvents()       → aktuální leady a události z kalendáře
   hasScope(s), requestScope(scope), gfetch(url,opt)
   addLead(data) → lead;  saveMeeting(lead,Date,online,{moveStage}) → {evId,...};  addNote(lead,text);  moveTo(lead,stage)
   tpls(), fillTpl(text,ctx), ensureMeet(eventId) → odkaz;  logLeadMsg(lead,{ch,tpl,start,meetId});  openMsg(ctx,tplId,onSent),  openSms(tel,text) → otevře Zprávy s předvyplněným textem
   facts() → data pro odpovědi na dotazy: {today, tasks:[{text,client,due,who}], calls:[{name,date,step}], meets:[{name,start,online}],
                quarter:{label,pts,kc,rate,nextRate,nextTier,need,perWeek,days}, month:{pts}, pipe:{active,meetings,pts,ptsKc,late}}
   openSheet(title,nodes), closeSheet(), toast(msg), demo (prezentační režim – nikdy neodesílá) */
