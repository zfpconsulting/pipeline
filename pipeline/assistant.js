/* Asistent v Pipeline: hlasový nebo psaný příkaz → plán akcí (schůzka, fáze, nový lead, zápis) → po krátkém okně na zrušení
   se provede stávajícími funkcemi appky a klientovi se pošle potvrzení ze šablony (e-mail přes Gmail sám, SMS jedním klepnutím).

   Všechno běží přímo v telefonu: větu rozebírá pravidlový parser češtiny níže (understand), žádná AI služba, žádný server,
   žádné předplatné a z appky nic neodchází (kromě e-mailu klientovi přes tvůj Gmail). Diktování obstarává systém (Web Speech API / klávesnice).

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
const HELP = "Zkus třeba: „Podepsal jsem smlouvu s Novákem a domluvil online schůzku ve středu v 17.“, „Schůzka s Králem 15. 10. v půl páté v Brně“, „Poznámka k Novákovi: chce zvýšit pojistku“ nebo „Nový kontakt Jan Dvořák 777 123 456“.";

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
  if (conflict) { res.reply = "Našel jsem víc různých klientů (" + conflict + "). Řekni příkazy po jednom."; return res; }

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
    else if (!when.date) missing.push("den schůzky" + lab + " (hodinu jsem slyšel: " + when.h + ":" + String(when.m).padStart(2, "0") + ")");
    else if (when.h == null) missing.push("hodina schůzky" + lab + " (den jsem slyšel: " + when.date.getDate() + ". " + (when.date.getMonth() + 1) + ".)");
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
    res.reply = knownClient ? "Rozumím, že jde o „" + clientName + "“, ale nevím, co s tím mám udělat. " + HELP : "Nerozuměl jsem. " + HELP;
  }
  return res;
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

const api = { understand, parseWhen, nominative, sameSurname, GMAIL_SCOPE, norm, words, sim, matchLeads, resolveClient, parseLocal, fmtWhen, checkMeeting, normPhone, validEmail, hasPlaceholders, pickTemplate, mimeEmail, encodeWord, buildPlan, runnable, autoOk, unresolved, pickLead, describeStep, leadLabel, STAGE_TITLES, voiceSupported, listen, VOICE_ERR };

/* ================= část s prohlížečem (jen když existuje document) ================= */
if (typeof document === "undefined") return api;

let H = null, fab = null, busy = false;
const DEFAULTS = { on: false, delay: 10, sms: true, mail: true, from: "" };
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
`;

function addStyle() { if (document.getElementById("aiStyle")) return; const s = h("style", { id: "aiStyle" }); s.textContent = CSS; document.head.append(s); }

function refresh() {
  if (!H) return;
  const on = cfg().on && !H.demo;
  if (!on) { if (fab) fab.hidden = true; return; }
  addStyle();
  if (!fab) { fab = h("button", { id: "aiFab", type: "button", title: "Asistent", "aria-label": "Asistent", onclick: () => open() }, "🎙︎"); document.body.append(fab); }
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

/* ---- okno asistenta ---- */
function open() {
  if (!H) return;
  if (!cfg().on) { H.toast("Asistent je vypnutý – zapni ho v nastavení."); return; }
  addStyle();
  const log = h("div", { class: "aiLog" });
  const ta = h("textarea", { rows: 1, placeholder: "Řekni nebo napiš, co se stalo…", "aria-label": "Příkaz pro asistenta", enterkeyhint: "send" });
  let rec = null, timer = null;
  const say = (cls, ...kids) => { const m = h("div", { class: "aiMsg " + cls }, ...kids); log.append(m); log.scrollTop = log.scrollHeight; return m; };
  const stopTimer = () => { clearInterval(timer); timer = null; };
  const dlg = document.getElementById("edDlg");
  const onClose = () => { stopTimer(); try { rec && rec.abort(); } catch (e) {} dlg && dlg.removeEventListener("close", onClose); };
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

  function submit(text) {
    text = String(text || "").trim();
    if (!text || busy) return;
    ta.value = ""; say("me", text);
    try {
      const res = understand(text, { leads: H.leads(), now: new Date() });
      const plan = buildPlan(res, { leads: H.leads(), now: new Date(), calEvents: H.calEvents(), meetMinutes: 60 });
      if (plan.reply) say("bot", plan.reply);
      if (plan.steps.length || plan.problems.length) showPlan(plan);
    } catch (e) { say("bot", "⚠ " + (e.message || "Něco se pokazilo")); }
  }

  function showPlan(plan) {
    const card = h("div", { class: "aiPlan" });
    const m = h("div", { class: "aiMsg bot", style: "max-width:100%;width:100%;padding:0;background:none" }, card);
    log.append(m);
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
      if (countdown != null) card.append(h("div", { class: "btns" }, h("button", { type: "button", class: "go", onclick: go }, "Provést hned"), h("button", { type: "button", class: "no", onclick: () => { stopTimer(); card.replaceChildren(h("div", { class: "note" }, "Zrušeno – nic se neprovedlo.")); } }, "Zrušit (" + countdown + " s)")));
      else card.append(h("div", { class: "btns" }, h("button", { type: "button", class: "go", onclick: go }, "Provést"), h("button", { type: "button", class: "no", onclick: () => card.replaceChildren(h("div", { class: "note" }, "Zrušeno – nic se neprovedlo.")) }, "Zrušit")));
    };
    async function run() {
      card.replaceChildren(h("div", { class: "note" }, "Provádím…"));
      busy = true;
      let out;
      try { out = await execute(plan); } catch (e) { out = { lines: ["✗ " + e.message], manuals: [] }; }
      busy = false;
      card.replaceChildren(...out.lines.map(l => h("div", { class: /^✓/.test(l) ? "st" : /^⚠/.test(l) ? "warn" : "err" }, l)));
      out.smsJobs.forEach(job => {
        const b = h("button", { type: "button", class: "go", onclick: () => { H.openSms(job.tel, job.text); H.logLeadMsg(job.lead, { ch: "SMS", tpl: job.tpl, start: job.start, meetId: job.meetId }); b.disabled = true; b.textContent = "✓ SMS otevřená: " + job.lead.name; } }, "💬 Odeslat SMS: " + job.lead.name);
        card.append(h("div", { class: "btns" }, b));
      });
      out.manuals.forEach(mn => card.append(h("div", { class: "btns" }, h("button", { type: "button", onclick: () => { H.closeSheet(); H.openMsg(mn.ctx, mn.tplId, r => H.logLeadMsg(mn.lead, r)); } }, "Poslat ručně: " + mn.lead.name))));
    }
    draw();
    if (runnable(plan) && autoOk(plan)) {
      let left = Math.max(0, Math.min(60, +cfg().delay || 0));
      if (left === 0) { run(); return; }
      draw(left);
      timer = setInterval(() => { left--; if (left <= 0) { stopTimer(); run(); } else draw(left); }, 1000);
    }
  }

  H.openSheet("Asistent", [
    log,
    h("div", { class: "aiIn" }, ta, mic, send),
    h("p", { class: "aiHint" }, "Např.: „Podepsal jsem smlouvu s Novákem a domluvil jsem si s ním online schůzku ve středu v 17h.“ Vyhodnocuje se přímo v telefonu." + (mic ? "" : " Mikrofon v tomhle prohlížeči nejde – diktuj mikrofonem na klávesnici.")),
  ]);
  ta.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(ta.value); } });
  setTimeout(() => ta.focus(), 80);
}

/* ---- nastavení ---- */
function renderSettings(box) {
  if (!box || !H) return;
  const c = cfg(), save = async patch => { try { await H.saveSettings({ ai: { ...cfg(), ...patch } }); refresh(); } catch (e) { H.toast("Nepodařilo se uložit"); } };
  const sw = (checked, on) => { const i = h("input", { type: "checkbox", class: "switch" }); i.checked = checked; i.onchange = () => on(i.checked); return i; };
  const delay = h("input", { type: "number", min: 0, max: 60, style: "width:70px" }); delay.value = c.delay;
  delay.onchange = () => save({ delay: Math.max(0, Math.min(60, +delay.value || 0)) });
  const from = h("input", { type: "email", placeholder: "vojtech.kudlicka@zfpa.cz (volitelné)", autocomplete: "off" }); from.value = c.from || "";
  from.onchange = () => save({ from: from.value.trim() });
  const gm = H.hasScope("gmail.send");
  box.replaceChildren(
    h("label", {}, "Asistent (psaní a hlas)"),
    h("label", { class: "frow" }, h("span", {}, "Zapnout asistenta"), sw(c.on, v => save({ on: v }))),
    h("p", { class: "hint" }, "Běží celý v telefonu: žádná AI služba, žádné předplatné, věta se nikam neposílá. Rozumí příkazům typu schůzka / podpis / nabídka / zápis / nový kontakt. Diktování dělá systém (Safari nebo klávesnice iPhonu), asistent jen zpracuje výsledný text."),
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

function init(host) { H = host; refresh(); }

return Object.assign(api, { init, refresh, open, renderSettings });
});

/* Host (dodává index.html):
   settings()                 → objekt nastavení (settings.ai = {on,url,delay,sms,mail,from})
   saveSettings(patch)        → uloží do settings/main
   leads(), calEvents()       → aktuální leady a události z kalendáře
   hasScope(s), requestScope(scope), gfetch(url,opt)
   addLead(data) → lead;  saveMeeting(lead,Date,online,{moveStage}) → {evId,...};  addNote(lead,text);  moveTo(lead,stage)
   tpls(), fillTpl(text,ctx), ensureMeet(eventId) → odkaz;  logLeadMsg(lead,{ch,tpl,start,meetId});  openMsg(ctx,tplId,onSent),  openSms(tel,text) → otevře Zprávy s předvyplněným textem
   openSheet(title,nodes), closeSheet(), toast(msg), demo (prezentační režim – nikdy neodesílá) */
