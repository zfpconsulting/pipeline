/* Jarvis: chytrý režim asistenta. Mozek, hlas a živý hovor obstarává Gemini (Google) přes oficiální knihovnu @google/genai,
   která leží ve vendor/genai.min.mjs a stahuje se až při prvním použití. Klíč (zdarma z aistudio.google.com/apikey) si vkládá uživatel
   a zůstává jen v tomhle zařízení (localStorage "gem_key"), do synchronizovaných dat se nikdy nezapisuje.

   Co je tady:
   - nástroje, kterými model sahá do pipeline (makeTools): čtení (get_overview, find_client, list_clients), zápisy (schedule_meeting, set_stage,
     add_note, add_lead, update_client, set_next_step, log_call, add_task, complete_task), pomocné (open_screen, prepare_message, calc_loan,
     calc_saving, cancel_pending_plan). Zápisové nástroje nic neprovedou, jen navrhnou plán (provede ho stejná karta s odpočtem);
   - Shield (štít soukromí): před odesláním Googlu nahradí jména klientů, telefony, e-maily a dlouhá čísla značkami [K1] [J2] [T3] [E4] [C5]
     a v odpovědích a argumentech nástrojů je zase vrátí. Tabulka značek žije jen v paměti stránky. Chrání textový mozek (soukromý režim);
     živý hovor posílá zvuk, ten maskovat nejde;
   - LiveCall: živý hlasový hovor (Gemini Live: mikrofon → model → hlas), Brain: textový mozek (stejné nástroje), synth: hlas (TTS), selfTest;
   - Usage: místní počítadlo dotazů na Gemini za den (jen v tomhle zařízení);
   - čistá pomocná logika (systémový prompt s kalendářem, zvuk PCM, překlad chyb), kterou testují tests/jarvis.run.mjs.
   Nic z toho se nespustí, dokud uživatel nevloží klíč. Bez klíče (nebo při chybě) běží dál offline parser z assistant.js. */
(function (root, factory) {
  const J = factory(root);
  if (typeof module === "object" && module.exports) module.exports = J; else root.Jarvis = J;
})(typeof self !== "undefined" ? self : typeof globalThis !== "undefined" ? globalThis : this, function (root) {
"use strict";

const MODELS = { live: "gemini-3.8-live", text: ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"], tts: "gemini-3.8-flash-tts" };
/* ženské hlasy Gemini (stejné jména platí pro živý hovor i pro TTS) */
const VOICES = [["Aoede", "Aoede – lehký"], ["Kore", "Kore – pevný"], ["Leda", "Leda – mladý"], ["Sulafat", "Sulafat – vřelý"], ["Vindemiatrix", "Vindemiatrix – jemný"], ["Gacrux", "Gacrux – zralý"], ["Despina", "Despina – hladký"]];
const DEFAULT_VOICE = "Aoede";
const KEY_STORAGE = "gem_key";
const MIN = 60000;

/* ================= klíč (jen v tomhle zařízení) ================= */
function getKey() { try { return String(root.localStorage.getItem(KEY_STORAGE) || "").trim(); } catch (e) { return ""; } }
function setKey(k) { k = String(k || "").trim(); if (!/^[\x21-\x7e]{20,}$/.test(k)) return false; try { root.localStorage.setItem(KEY_STORAGE, k); return true; } catch (e) { return false; } }
function clearKey() { try { root.localStorage.removeItem(KEY_STORAGE); } catch (e) {} }
const maskKey = k => k ? k.slice(0, 4) + "…" + k.slice(-3) : "";

/* knihovna Googlu se stahuje líně (≈70 kB po kompresi) a pak ji drží cache prohlížeče */
let sdkP = null;
const loadSdk = () => sdkP || (sdkP = import("./vendor/genai.min.mjs").catch(e => { sdkP = null; throw e; }));

/* ================= počítadlo dotazů (jen v tomhle zařízení) =================
   Google počítá limity za projekt a den podle pacifického času (půlnoc ≈ 9:00 u nás), proto se den určuje stejně. */
const USE_KEY = "gem_use";
const pacificDay = d => { try { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(d || new Date()); } catch (e) { return new Date().toISOString().slice(0, 10); } };
const Usage = {
  read() { try { const u = JSON.parse(root.localStorage.getItem(USE_KEY) || "null"); if (u && u.day === pacificDay()) return u; } catch (e) {} return { day: pacificDay(), n: 0, err: 0 }; },
  bump(failed) { const u = Usage.read(); u.n++; if (failed) u.err++; try { root.localStorage.setItem(USE_KEY, JSON.stringify(u)); } catch (e) {} return u; },
  clear() { try { root.localStorage.removeItem(USE_KEY); } catch (e) {} },
};

/* ================= štít soukromí =================
   Model nikdy nedostane jméno klienta, telefon, e-mail ani dlouhé číslo (rodné číslo, účet, smlouva). Dostane značky:
     [K1] klient, který v appce existuje (jednoznačně nalezený podle příjmení, i ve skloňovaném tvaru),
     [J2] jméno z věty uživatele, které se nepodařilo jednoznačně přiřadit (nový kontakt, dva Novákové, adresa…),
     [T3] telefon, [E4] e-mail, [C5] jiné dlouhé číslo.
   Argumenty nástrojů a text odpovědi se před použitím vrací zpátky; výsledky nástrojů se před odesláním maskují stejně.
   Co štít nezachytí: jméno napsané malými písmeny, které appka nezná (diktování obvykle jména píše s velkým), a jméno na začátku věty,
   pokud není v seznamu klientů ani mezi běžnými křestními jmény. Proto je tu ještě pojistka (isClean): zpráva, ve které by přesto
   zůstalo známé jméno nebo číslo, se vůbec neodešle.
   core = {words, norm, normPhone, nominative}; o.known() → pole jmen všech osob v appce (klienti, leady, kandidáti, tým, kalendář, úkoly). */
const TOK_RE = /\[\s*([KJTEC])\s*(\d{1,3})\s*\]/gi;
const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+/g;
/* nadiktovaný e-mail: „novak zavináč seznam tečka cz“ */
const EMAIL_SAID_RE = /[\p{L}\d._-]+(?:\s+(?:tečka|tecka)\s+[\p{L}\d_-]+)*\s+(?:zavináč|zavinac)\s+[\p{L}\d_-]+(?:\s+(?:tečka|tecka)\s+[\p{L}\d_-]+)+/giu;
const NUM_RE = /(?<!\d)(?:\d{1,6}-\d{2,10}\/\d{4}|\d{6,}(?:\/\d{2,4})?|(?:\+|00)?\d{3}(?:[  -]?\d{3}){2,3})(?!\d)/g;
const WORD_RE = /[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*/gu;
const NAME_KEYS = new Set(["name", "client", "client_name", "candidates"]);
const WL = new Set(("pondeli utery streda stredu ctvrtek ctvrtka patek patku sobota sobotu nedele nedeli ledna leden ledne unora unor unoru brezna brezen breznu dubna duben dubnu kvetna kveten kvetnu cervna cerven cervnu cervence cervenec cervenci srpna srpen srpnu zari rijna rijen rijnu listopadu listopad prosince prosinec prosinci " +
  "dnes zitra pozitri ahoj dekuji dobry dobre dobrou prosim online osobne ing mgr bc dr mudr judr phdr rndr paeddr mvdr doc prof csc phd mba bsc dis " +
  "allianz kooperativa generali csob uniqa nn conseq amundi fio raiffeisenbank moneta kb cs ceska sporitelna komercni banka slavia pojistovna zfp zfpf zfpi pipeline google gmail meet zoom teams skype whatsapp apple iphone safari chrome sms dph eur czk kc ok investika patria fondy fond dps pps zp izp ps nbs " +
  "brno brne brna brnem brnu praha praze prahy prahu prahou ostrava ostrave ostravy ostravou plzen plzni plzne olomouc olomouci liberec liberci hradec kralove pardubice pardubicich zlin zline jihlava jihlave ceske budejovice budejovicich karlovy vary usti labem opava opave frydek mistek karvina havirov kladno most mostu teplice decin trebic znojmo blansko breclav vyskov prostejov prerov kromeriz uherske hradiste vsetin valasske mezirici slovensko bratislava bratislave kosice cesko republika morava moravy morave slezsko evropa evrope evropy amerika usa").split(" "));
const FIRST = new Set(("jan petr pavel martin tomas jiri jaroslav josef michal lukas ondrej marek david vaclav filip jakub vojtech roman radek zdenek miroslav karel milan ales stanislav ladislav libor marcel marian kamil dominik adam daniel matej patrik richard robert rostislav vladimir vlastimil zbynek antonin frantisek hynek ivan ivo lubos ludvik oldrich otakar rudolf viktor stepan simon sebastian samuel igor gustav eduard emil denis dalibor bohumil bohuslav bedrich alois albert " +
  "jana eva marie hana anna lenka katerina lucie petra vera alena jaroslava martina michaela tereza veronika zuzana barbora monika marketa ivana jitka dagmar helena ludmila bozena libuse renata simona andrea klara eliska kristyna nikola adela natalie denisa sarka dana irena blanka gabriela iveta jirina milada olga romana sona vendula vlasta pavla pavlina miroslava miluse radka radmila ilona hedvika drahomira alexandra alzbeta sabina silvie stanislava svetlana vladimira zdenka zdena").split(" "));
/* příjmení, která jsou zároveň běžná slova: shodují se jen s velkým písmenem uprostřed věty */
const COMMON_SUR = new Set("novy nova maly dobry cerny bily stary velky kratky rychly mlady dlouhy tichy vesely sladky svaty hezky chytry cerveny zeleny modry zluty seda rada hora voda lev".split(" "));
/* i nepravidelné kmeny: Karel → Karlu, Marek → Markovi */
const FIRST_STEMS = new Set([...FIRST].map(f => /(el|ek)$/.test(f) ? f.slice(0, -2) + f.slice(-1) : f));
const isFirstName = n => {
  if (FIRST.has(n) || FIRST_STEMS.has(n)) return true;
  if (n.length < 4) return false;
  for (const end of ["ovi", "em", "u", "e", "i", "y", "a"]) if (n.endsWith(end) && (FIRST.has(n.slice(0, -end.length)) || FIRST_STEMS.has(n.slice(0, -end.length)))) return true;
  return n.endsWith("ou") && FIRST.has(n.slice(0, -2) + "a");
};
const firstHit = (w, f) => {
  if (!f) return false;
  if (w === f || (f.length >= 3 && w.startsWith(f) && w.length <= f.length + 3)) return true;
  if (f.length >= 4 && f.endsWith("a") && w.startsWith(f.slice(0, -1)) && w.length <= f.length + 2) return true;
  if (/(el|ek)$/.test(f)) { const st = f.slice(0, -2) + f.slice(-1); return w.startsWith(st) && w.length <= st.length + 3; }
  return false;
};
/* w = slovo z věty (bez diakritiky, malé), s = příjmení klienta v základním tvaru. Shoda jen s pádovými koncovkami, ne s jiným příjmením (Kolář ≠ Kolářík, Novák ≠ Nováková) */
const SUF = new Set(["", "a", "e", "i", "o", "u", "y", "ou", "em", "om", "ovi", "ove", "um", "ym", "ymi", "ych", "im", "ich", "imi", "ho", "mu", "eho", "emu", "iho", "imu"]);
const ADJ_SUF = new Set(["y", "eho", "emu", "ym", "em", "ymi", "ych", "e"]);
const surHit = (w, s) => {
  if (s.length < 3 || w.length < 3) return false;
  if (w === s) return true;
  if (s.length < 4) return false;
  const stems = [];
  if (/y$/.test(s)) stems.push([s.slice(0, -1), ADJ_SUF]);
  else {
    const base = /[aei]$/.test(s) ? s.slice(0, -1) : s;
    if (base.length >= 3) stems.push([base, SUF]);
    if (/ek$/.test(s)) stems.push([s.slice(0, -2) + "k", SUF]);          /* Jelínek → Jelínka */
    else if (/ec$/.test(s)) stems.push([s.slice(0, -2) + "c", SUF]);     /* Němec → Němcem */
    else if (/el$/.test(s)) stems.push([s.slice(0, -2) + "l", SUF]);     /* Havel → Havlem */
  }
  return stems.some(([st, suf]) => w.startsWith(st) && suf.has(w.slice(st.length)));
};
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

class Shield {
  constructor(core, o) {
    this.core = core; this.o = o || {};
    this.byKey = new Map(); this.byId = new Map(); this.seq = { K: 0, J: 0, T: 0, E: 0, C: 0 };
  }
  reset() { this.byKey.clear(); this.byId.clear(); this.seq = { K: 0, J: 0, T: 0, E: 0, C: 0 }; }
  _people() {
    const c = this.core, seen = new Set(), out = [];
    let list = []; try { list = (this.o.known && this.o.known()) || []; } catch (e) {}
    for (const raw of list) {
      const name = String(raw == null ? "" : raw).trim(); if (!name) continue;
      const w = c.words(name); if (!w.length || w[w.length - 1].length < 2) continue;   /* jednopísmenné „příjmení“ (A) by maskovalo spojku „a“ */
      const key = w.join(" "); if (seen.has(key)) continue; seen.add(key);
      out.push({ name, key, sur: w[w.length - 1], first: w.length > 1 ? w[0] : "" });
    }
    return out;
  }
  /* kde všude je v textu něco soukromého; nic nemění (kromě tabulky značek se nedotýká ničeho) */
  _spans(s, opt) {
    const c = this.core, spans = [], unknown = !opt || opt.unknown !== false;
    const taken = (i, e) => spans.some(x => i < x.e && e > x.i);
    const add = (i, e, type, extra) => { if (e > i && !taken(i, e)) spans.push({ i, e, type, ...extra }); };
    for (const m of s.matchAll(EMAIL_RE)) add(m.index, m.index + m[0].length, "E", { value: m[0].toLowerCase() });
    for (const m of s.matchAll(EMAIL_SAID_RE)) add(m.index, m.index + m[0].length, "E", { value: m[0].toLowerCase().replace(/\s+(?:tečka|tecka)\s+/g, ".").replace(/\s+(?:zavináč|zavinac)\s+/g, "@").replace(/\s+/g, "") });
    for (const m of s.matchAll(NUM_RE)) {
      const v = m[0].trim(), after = s.slice(m.index + m[0].length, m.index + m[0].length + 14);
      /* částka (úvěr, spoření) není identifikátor: kulatý tisícový součet nebo číslo před „Kč / korun / tisíc / milionů“ se nemaskuje */
      if (/^\d{4,8}$/.test(v) && (/000$/.test(v) || /^\s*(?:kč|kc|korun|tis|mil)/i.test(after))) continue;
      add(m.index, m.index + m[0].length, c.normPhone(m[0]) ? "T" : "C", { value: v });
    }
    /* už jednou zamaskované hodnoty (jména z dřívějších vět) se maskují vždy stejně */
    const reg = [...this.byId.values()].filter(t => (t.type === "J" || t.type === "K") && t.value.length >= 3).sort((a, b) => b.value.length - a.value.length);
    for (const t of reg) {
      let re; try { re = new RegExp("(?<![\\p{L}\\d])" + escRe(t.value).replace(/\s+/g, "\\s+") + "(?![\\p{L}\\d])", "giu"); } catch (e) { continue; }
      for (const m of s.matchAll(re)) add(m.index, m.index + m[0].length, t.type, { reg: t });
    }
    /* jména: známé osoby (podle příjmení, i skloňované) a velkým písmenem psaná neznámá slova */
    const people = this._people(), W = [];
    for (const m of s.matchAll(WORD_RE)) {
      const raw = m[0], i = m.index, e = i + raw.length;
      if (taken(i, e)) { W.push({ raw, i, e, skip: true }); continue; }
      const n = c.norm(raw), parts = n.split(" ").filter(Boolean);
      if (!parts.length) { W.push({ raw, i, e, skip: true }); continue; }
      const cap = /^\p{Lu}/u.test(raw) && raw.length > 1 && raw !== raw.toUpperCase() || (raw.length >= 6 && raw === raw.toUpperCase() && /\p{Lu}/u.test(raw));
      const start = /(^|[.!?:;\n])[\s„"“'(\[]*$/.test(s.slice(0, i));
      const acr = raw.length <= 5 && raw === raw.toUpperCase();
      const all = people.filter(p => parts.some(w => surHit(w, p.sur)));
      const hits = all.filter(p => !(COMMON_SUR.has(p.sur) || p.sur.length <= 3) || (cap && !start)), weak = all.filter(p => !hits.includes(p));
      W.push({ raw, i, e, n, parts, cap, start, acr, hits, weak, wl: parts.every(x => WL.has(x)), first: parts.length === 1 && isFirstName(parts[0]) });
    }
    const gap = (a, b) => /^[ \t ]$/.test(s.slice(W[a].e, W[b].i));
    /* příjmení, které je i běžné slovo (Nový, Malý…), platí, jen když vedle stojí odpovídající křestní jméno */
    for (let k = 0; k < W.length; k++) {
      const w = W[k]; if (w.skip || w.hits.length || !w.weak.length) continue;
      const nb = [k - 1, k + 1].filter(j => W[j] && !W[j].skip && gap(Math.min(j, k), Math.max(j, k)));
      w.hits = w.weak.filter(p => nb.some(j => W[j].parts.some(x => firstHit(x, p.first))));
    }
    const used = new Array(W.length).fill(false);
    for (let k = 0; k < W.length; k++) {
      const w = W[k]; if (w.skip || used[k] || !w.hits.length) continue;
      let a = k, b = k;
      const L = W[k - 1], R = W[k + 1];
      if (L && !L.skip && !used[k - 1] && gap(k - 1, k) && !L.hits.length && (L.first || (unknown && L.cap && !L.start && !L.wl && !L.acr))) a = k - 1;
      if (R && !R.skip && !used[k + 1] && gap(k, k + 1) && !R.hits.length && R.cap && R.first) b = k + 1;
      const fw = a < k ? W[a] : b > k ? W[b] : null;
      const ents = fw ? w.hits.filter(p => fw.parts.some(x => firstHit(x, p.first))) : w.hits;
      const i = W[a].i, e = W[b].e, surface = s.slice(i, e);
      if (ents.length === 1 && !taken(i, e)) add(i, e, "K", { person: ents[0], surface });
      else if (!taken(i, e)) add(i, e, "J", { surface });
      for (let j = a; j <= b; j++) used[j] = true;
    }
    if (unknown) {
      for (let k = 0; k < W.length; k++) {
        const w = W[k]; if (w.skip || used[k]) continue;
        const cand = x => x && !x.skip && !used[W.indexOf(x)] && !x.hits.length && !x.wl && !x.acr && ((x.cap && !x.start) || (x.cap && x.start && x.first) || (x.start && x.first && /^\p{Lu}/u.test(x.raw)));
        if (!cand(w)) continue;
        let b = k;
        while (b + 1 < W.length && b - k < 3 && cand(W[b + 1]) && gap(b, b + 1)) b++;
        add(w.i, W[b].e, "J", { surface: s.slice(w.i, W[b].e) });
        for (let j = k; j <= b; j++) used[j] = true;
      }
    }
    return spans.sort((x, y) => x.i - y.i);
  }
  _tok(type, key, value, surface) {
    const k = type + "|" + key;
    let t = this.byKey.get(k);
    if (!t) { t = { id: type + (++this.seq[type]), type, value, surface: surface || value }; this.byKey.set(k, t); this.byId.set(t.id, t); }
    else if (surface) t.surface = surface;
    return "[" + t.id + "]";
  }
  _token(sp) {
    const c = this.core;
    if (sp.reg) return "[" + sp.reg.id + "]";
    if (sp.type === "K") return this._tok("K", sp.person.key, sp.person.name, sp.surface);
    if (sp.type === "J") return this._tok("J", c.norm(sp.surface), sp.surface, sp.surface);
    if (sp.type === "T") return this._tok("T", sp.value.replace(/\D/g, ""), sp.value);
    if (sp.type === "E") return this._tok("E", sp.value, sp.value);
    return this._tok("C", sp.value.replace(/\D/g, ""), sp.value);
  }
  /* text od uživatele (unknown:true) nebo text z aplikace (unknown:false = jen známé osoby a čísla) → text se značkami */
  mask(text, opt) {
    const s = String(text == null ? "" : text); if (!s) return s;
    const spans = this._spans(s, opt);
    let out = "", p = 0;
    for (const sp of spans) { out += s.slice(p, sp.i) + this._token(sp); p = sp.e; }
    return out + s.slice(p);
  }
  /* jméno z dat appky (pole name / client …) → značka klienta, když ho appka zná, jinak značka jména */
  nameToken(name) {
    const s = String(name == null ? "" : name).trim(); if (!s) return s;
    const w = this.core.words(s).join(" "), p = w && this._people().find(x => x.key === w);
    return p ? this._tok("K", p.key, p.name, s) : this._tok("J", this.core.norm(s), s, s);
  }
  maskResult(v, key) {
    if (typeof v === "string") return NAME_KEYS.has(key) ? this.nameToken(v) : this.mask(v, { unknown: false });
    if (Array.isArray(v)) return v.map(x => this.maskResult(x, key));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, this.maskResult(x, k)]));
    return v;
  }
  _nom(value) { const w = String(value).split(/\s+/); return w.map((x, i) => this.core.nominative(x, i === 0 && w.length > 1)).join(" "); }
  /* značky v textu odpovědi → původní hodnoty (neznámá značka se vypustí) */
  unmask(text) {
    let dropped = false;
    const out = String(text == null ? "" : text).replace(TOK_RE, (m, t, n) => { const tok = this.byId.get(t.toUpperCase() + n); if (!tok) { dropped = true; return ""; } return tok.value; });
    return dropped ? out.replace(/ {2,}/g, " ").replace(/ ([,.;!?])/g, "$1") : out;
  }
  /* argumenty nástroje → původní hodnoty; nom = názvy polí, kde se zapsané jméno vrací do 1. pádu */
  unmaskArgs(v, nom) {
    const unknown = [], nomSet = new Set(nom || []);
    const walk = (x, key) => {
      if (typeof x === "string") return x.replace(TOK_RE, (m, t, n) => { const tok = this.byId.get(t.toUpperCase() + n); if (!tok) { unknown.push(t.toUpperCase() + n); return m; } return tok.type === "J" && nomSet.has(key) ? this._nom(tok.value) : tok.value; });
      if (Array.isArray(x)) return x.map(y => walk(y, key));
      if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y, k)]));
      return x;
    };
    return { value: walk(v), unknown };
  }
  /* pojistka: je v textu ještě něco, co štít maskuje? */
  isClean(text, unknown) { return this._spans(String(text == null ? "" : text), { unknown: unknown !== false }).length === 0; }
  /* pojistka pro celou zprávu (řetězec nebo části s functionResponse) a prompt; vyhodí chybu, nic neodešle */
  assertClean(message, opt) {
    const bad = [], forced = opt && opt.unknown !== undefined ? !!opt.unknown : undefined;
    const scan = (x, unknown) => {
      if (typeof x === "string") { if (!this.isClean(x, unknown)) bad.push(x.slice(0, 40)); return; }
      if (Array.isArray(x)) { x.forEach(y => scan(y, unknown)); return; }
      if (x && typeof x === "object") {
        if (x.functionResponse) { scan(x.functionResponse.response, false); return; }
        if (typeof x.text === "string") { scan(x.text, forced === undefined ? true : forced); return; }
        Object.values(x).forEach(y => scan(y, unknown));
      }
    };
    scan(message, forced === undefined ? typeof message === "string" : forced);
    if (bad.length) throw Object.assign(new Error("Štít soukromí zastavil odeslání: ve zprávě zbylo jméno nebo číslo."), { name: "ShieldError", sample: bad });
  }
  stats() { const n = { K: 0, J: 0, T: 0, E: 0, C: 0 }; for (const t of this.byId.values()) n[t.type]++; return n; }
}

/* ================= prompt ================= */
const DOW =["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];
const z2 = n => String(n).padStart(2, "0");
const ymd = d => d.getFullYear() + "-" + z2(d.getMonth() + 1) + "-" + z2(d.getDate());
function calendarText(now, days) {
  const out = [];
  for (let i = 0; i < (days || 21); i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    out.push((i === 0 ? "dnes " : i === 1 ? "zítra " : "") + DOW[d.getDay()] + " " + d.getDate() + ". " + (d.getMonth() + 1) + ". = " + ymd(d));
  }
  return out.join("; ");
}
function systemPrompt(now, opt) {
  opt = opt || {};
  return [
    "Jsi hlasová asistentka finančního poradce v jeho aplikaci Pipeline (evidence klientů, schůzek, úkolů a výsledků). Mluv česky, přirozeně a stručně jako schopná kolegyně: nejčastěji jedna až dvě krátké věty, žádné výčty, žádný markdown, žádná emoji. Tykej. Mluv o sobě v ženském rodě." + (opt.callMe ? " Uživatele oslovuj „" + opt.callMe + "“ jen občas." : ""),
    "",
    "CO APLIKACE UMÍ A CO S TÍM UMÍŠ TY",
    "- Klient (lead) prochází fázemi: Nový lead → Kontaktován → Schůzka domluvena → Schůzka proběhla → Nabídka odeslána → Podpis → Provize vyplacena; mimo to Zamrzlý a Lost. U klienta je telefon, e-mail, zdroj (cold call, placený lead, doporučení, vlastní kontakt), kdo ho doporučil, další krok s termínem, zápisy a schůzky.",
    "- Čtení: get_overview (úkoly, kdo mám zavolat, schůzky, celá agenda dne, výsledky: body, provize, sazba), find_client (detail jednoho klienta), list_clients (počty klientů podle fází a jména: kdo čeká na zavolání, kdo je dlouho bez kontaktu).",
    "- Zápisy: schedule_meeting (schůzka), set_stage (změna fáze), add_note (zápis do karty), add_lead (nový kontakt), update_client (doplnit nebo opravit telefon, e-mail, zdroj, doporučitele, jméno u KTERÉHOKOLI existujícího klienta), set_next_step (další krok a jeho termín), log_call (zapsat telefonát: hovor proběhl / nezvedl), add_task a complete_task (vlastní úkoly poradce).",
    "- Ostatní: open_screen (otevřít kartu klienta, dnešní přehled nebo záložku), prepare_message (otevřít hotovou zprávu klientovi ze šablony; odeslání klepne uživatel), calc_loan (splátka úvěru), calc_saving (spoření, investice).",
    "- Neumíš: cokoli mazat, přesouvat nebo rušit schůzky, zapisovat produkty, body a provize u podpisu, nábor, daně. Řekni to na rovinu a navrhni, co má udělat ručně. Nikdy nic z toho nepředstírej.",
    "",
    "PRAVIDLA",
    "- O klientech, úkolech, schůzkách, telefonátech ani výsledcích nikdy nic nevymýšlej a netipuj. Vždy použij nástroj. Co nástroj nevrátil, nevíš, a to řekni.",
    "- Zápisy děláš jen nástroji zápisů. Nástroj plán jen připraví a ukáže ho na obrazovce; provede ho aplikace po krátkém odpočtu nebo po klepnutí. Dokud ti systém nepošle zprávu „[Systém] Provedeno“, netvrď, že je něco hotové; říkej „mám připraveno“ nebo „zapíšu“.",
    "- Všechno z jedné věty navrhni najednou v jednom kole (např. podpis smlouvy a nová schůzka = set_stage a schedule_meeting spolu; telefon a e-mail ke klientovi = jedno update_client).",
    "- Když uživatel plán opraví nebo zruší („počkej, radši ve čtvrtek“), nejdřív zavolej cancel_pending_plan a pak navrhni nový plán.",
    "- Klient: před zápisem zavolej find_client, ledaže už máš klienta jako značku [K#] (ta je jistě nalezený klient a rovnou ji použij). Při jedné shodě použij přesné jméno z výsledku. Při více shodách se zeptej, kterého myslí. Když klient neexistuje, zeptej se, jestli má založit nový kontakt, a teprve pak ho založ (nebo ho rovnou použij ve schůzce, když to uživatel řekl).",
    "- Čas a termíny: použij kalendář níže. „Ve středu“ je nejbližší budoucí středa. Když chybí den nebo hodina schůzky, zeptej se jednou krátce. Hodina bez upřesnění je pracovní doba (v 5 = 17:00). start schůzky je ve tvaru YYYY-MM-DDTHH:MM místního času, termíny úkolů a dalších kroků YYYY-MM-DD. Schůzka trvá 45 minut.",
    "- online=true jen když uživatel řekl online, videohovor nebo Meet; jinak je schůzka osobní. send_confirmation nech true, pokud uživatel neřekl, že potvrzení nechce.",
    "- Telefon a e-mail předávej tak, jak zazněl; aplikace je zkontroluje. Zdroj klienta mapuj na: Cold call, Placený lead, Doporučení, Vlastní kontakt.",
    "- Po zprávě „[Systém] Provedeno“ řekni jednou krátkou větou, že je hotovo (a když je v ní SMS, že stačí klepnout na Odeslat). Po zprávě „[Systém] Zrušeno“ řekni jen „Dobře, zrušeno.“",
    "- Nejsi poradce pro klienty: u produktů a legislativy odpovídej stručně a upozorni, že to má uživatel ověřit. Cokoli nepochopíš, se zeptej; neodpovídej nesmysly.",
    ...(opt.masked ? [
      "",
      "SOUKROMÍ (důležité)",
      "- Jména klientů, telefony, e-maily a dlouhá čísla nevidíš, aplikace je nahradila značkami v hranatých závorkách: [K1] = klient, který v pipeline existuje (jednoznačně nalezený), [J2] = jméno nebo adresa z věty uživatele, kterou aplikace nepřiřadila k jednomu klientovi (nový kontakt, dva stejná příjmení…), [T3] = telefon, [E4] = e-mail, [C5] = jiné číslo.",
      "- Značku piš přesně tak, jak ji vidíš, nikdy ji neměň, neskloňuj, nehádej, kdo za ní je. Formuluj věty tak, aby značka stála v 1. pádě (např. „Klient [K1]: schůzka je ve čtvrtek“, ne „se [K1]em“).",
      "- Do nástrojů dávej značky (client_name: „[K1]“, phone: „[T3]“, email: „[E4]“, name u nového kontaktu: „[J2]“). Aplikace je před provedením nahradí skutečnými hodnotami. Značka [J#] nemusí být v pipeline: zavolej find_client a podle výsledku jednej.",
      "- Nikdy se neptej uživatele na skutečné jméno, telefon ani e-mail, které už máš jako značku. Aplikace je doplní sama.",
    ] : []),
    "",
    "ČAS: je " + DOW[now.getDay()] + " " + now.getDate() + ". " + (now.getMonth() + 1) + ". " + now.getFullYear() + ", " + z2(now.getHours()) + ":" + z2(now.getMinutes()) + " (Praha).",
    "KALENDÁŘ: " + calendarText(now),
  ].join("\n");
}

/* ================= nástroje pro model ================= */
const STR = (description, extra) => ({ type: "STRING", description, ...(extra || {}) });
const NUM = description => ({ type: "NUMBER", description });
const OBJ = (properties, required) => ({ type: "OBJECT", properties, required: required || [] });
const trim = v => String(v == null ? "" : v).trim();
const bool = v => v === true || /^(true|ano|yes|1)$/i.test(trim(v));
function normStart(s) {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})/.exec(trim(s));
  return m ? m[1] + "T" + z2(+m[2]) + ":" + m[3] : "";
}
const DAYS_OK = /^(today|tomorrow|week|nextweek|\d{4}-\d{2}-\d{2})$/;
const normDate = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(trim(s)); if (!m) return ""; const d = new Date(+m[1], +m[2] - 1, +m[3]); return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? m[0] : ""; };
const SCREENS = { today: "dnešní přehled „Co tě dneska čeká“", client: "karta klienta (potřebuje client_name)", pipeline: "Pipeline", money: "Obrat (výdělek, body)", clients: "Klienti (servis)", calculator: "Kalkulačka úvěr/investice", pension_calculator: "Důchodová kalkulačka", calendar: "Kalendář", network: "Rozvoj sítě", taxes: "Daně", goals: "Moje cíle", portfolio: "Portfolia", rates: "Sazebník" };
const SCREEN_VIEW = { pipeline: "pipe", money: "money", clients: "cli", calculator: "calc", pension_calculator: "duch", calendar: "cal", network: "net", taxes: "tax", goals: "goals", portfolio: "pf", rates: "pp" };
const kc = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/* core = čistá logika z assistant.js (resolveClient, answerQuery, STAGE_TITLES, normPhone, validEmail, parseLocal)
   host = {now(), leads(), facts(), propose(actions) → výsledek plánu, cancelPending() → {ok, ...},
           shield (volitelně: maskování), navigate({screen, lead}) → {ok}, openMessage(lead, tplId) → {ok}} */
function makeTools(core, host) {
  const stages = Object.keys(core.STAGE_TITLES), sh = host.shield || null;
  const CLIENT = "přesné jméno z find_client" + (sh ? " nebo značka [K#]/[J#]" : "");
  const declarations = [
    { name: "get_overview", description: "Přečte z pipeline úkoly, telefonáty, schůzky nebo výsledky (body, provize, sazba, rozjednané leady). Použij vždy, když se uživatel ptá na svoje data.",
      parameters: OBJ({
        kind: STR("tasks = úkoly, calls = komu zavolat, meetings = schůzky v kalendáři, agenda = všechno na den (úkoly, telefonáty, schůzky), results = výsledky (body, provize, sazba, rozjednané leady)", { enum: ["tasks", "calls", "meetings", "agenda", "results"] }),
        day: STR("today (výchozí), tomorrow, week (do konce týdne), nextweek, nebo datum YYYY-MM-DD"),
        client: STR("jen u kind=meetings: jméno klienta, pak vrátí jeho nejbližší schůzky"),
      }, ["kind"]) },
    { name: "find_client", description: "Najde klienta nebo kontakt v pipeline podle jména (i skloňovaného) a vrátí jeho detail: fázi, další krok, zdroj, doporučitele, kdy byl poslední kontakt, nejbližší schůzku a zda je znám telefon a e-mail (ne jejich hodnoty).",
      parameters: OBJ({ name: STR("jméno nebo příjmení, jak ho uživatel řekl" + (sh ? ", nebo značka" : "")) }, ["name"]) },
    { name: "list_clients", description: "Vypíše klienty v pipeline: počty podle fází a jména (max 12) podle filtru. Použij na otázky typu kolik mám klientů v nabídce, kdo čeká na zavolání, koho jsem dlouho neoslovila, kdo podepsal.",
      parameters: OBJ({
        stage: STR("jen tahle fáze: " + stages.map(s => s + " = " + core.STAGE_TITLES[s]).join(", ") + ". Bez ní jsou to všichni rozjednaní (bez podpisů, zamrzlých a lost).", { enum: stages }),
        filter: STR("due = další krok je dnes nebo po termínu nebo chybí; cold = 14 a víc dní bez kontaktu; all = všichni v dané fázi (výchozí)", { enum: ["all", "due", "cold"] }),
      }) },
    { name: "schedule_meeting", description: "Připraví schůzku s klientem (zapíše se do pipeline a kalendáře a klientovi se pošle potvrzení). Trvá 45 minut. Neprovede se hned, uživatel ji uvidí na obrazovce.",
      parameters: OBJ({
        client_name: STR(CLIENT + ", nebo jméno nového klienta"),
        start: STR("začátek ve tvaru YYYY-MM-DDTHH:MM místního času"),
        online: { type: "BOOLEAN", description: "true jen když je schůzka online (videohovor)" },
        place: STR("místo osobní schůzky, pokud ho uživatel řekl"),
        send_confirmation: { type: "BOOLEAN", description: "poslat klientovi potvrzení (výchozí true)" },
      }, ["client_name", "start"]) },
    { name: "set_stage", description: "Připraví změnu fáze klienta v pipeline. Podepsal smlouvu = podpis. Neprovede se hned.",
      parameters: OBJ({
        client_name: STR(CLIENT),
        stage: STR("fáze: " + stages.map(s => s + " = " + core.STAGE_TITLES[s]).join(", "), { enum: stages }),
      }, ["client_name", "stage"]) },
    { name: "add_note", description: "Připraví zápis (poznámku) do karty klienta. Neprovede se hned.",
      parameters: OBJ({ client_name: STR(CLIENT), text: STR("text zápisu, věcně a stručně v 1. osobě uživatele") }, ["client_name", "text"]) },
    { name: "add_lead", description: "Připraví založení nového kontaktu v pipeline. Neprovede se hned.",
      parameters: OBJ({ name: STR("jméno a příjmení v 1. pádě" + (sh ? " (značka)" : "")), phone: STR("telefon, pokud zazněl"), email: STR("e-mail, pokud zazněl"), source: STR("odkud kontakt je (Cold call, Placený lead, Doporučení, Vlastní kontakt), pokud zazněl") }, ["name"]) },
    { name: "update_client", description: "Připraví úpravu údajů u EXISTUJÍCÍHO klienta: doplnit nebo změnit telefon, e-mail, zdroj, doporučitele nebo opravit jméno. Neprovede se hned.",
      parameters: OBJ({ client_name: STR(CLIENT), phone: STR("nový telefon"), email: STR("nový e-mail"), source: STR("Cold call, Placený lead, Doporučení nebo Vlastní kontakt"), referred_by: STR("kdo klienta doporučil"), new_name: STR("opravené jméno klienta v 1. pádě") }, ["client_name"]) },
    { name: "set_next_step", description: "Připraví nastavení dalšího kroku u klienta (např. zavolat, poslat nabídku) a jeho termínu. Podle toho se klient řadí do seznamu „komu zavolat“. Neprovede se hned.",
      parameters: OBJ({ client_name: STR(CLIENT), step: STR("co se má stát, krátce (např. Zavolat, Poslat nabídku)"), date: STR("termín YYYY-MM-DD") }, ["client_name"]) },
    { name: "log_call", description: "Připraví zápis telefonátu do historie klienta: dovolala se a hovor proběhl, nebo nezvedl (pak se další pokus naplánuje na příští pracovní den). Neprovede se hned.",
      parameters: OBJ({ client_name: STR(CLIENT), result: STR("reached = hovor proběhl, no_answer = nezvedl", { enum: ["reached", "no_answer"] }), text: STR("volitelný zápis k hovoru, pokud nějaký zazněl") }, ["client_name", "result"]) },
    { name: "add_task", description: "Připraví nový vlastní úkol poradce (do seznamu úkolů v pipeline). Neprovede se hned.",
      parameters: OBJ({ text: STR("co je potřeba udělat"), client_name: STR("klient, ke kterému se úkol vztahuje (volitelné)"), due: STR("termín YYYY-MM-DD (volitelné)") }, ["text"]) },
    { name: "complete_task", description: "Připraví označení vlastního úkolu jako hotového. Neprovede se hned.",
      parameters: OBJ({ task_text: STR("text nebo část textu úkolu, který je hotový") }, ["task_text"]) },
    { name: "open_screen", description: "Otevře v aplikaci obrazovku: kartu klienta, dnešní přehled nebo záložku. Provede se hned (nemění žádná data).",
      parameters: OBJ({ screen: STR("co otevřít: " + Object.entries(SCREENS).map(([k, v]) => k + " = " + v).join("; "), { enum: Object.keys(SCREENS) }), client_name: STR("jen u screen=client: " + CLIENT) }, ["screen"]) },
    { name: "prepare_message", description: "Otevře hotovou zprávu klientovi ze šablony (potvrzení schůzky, připomenutí zítřejší schůzky, narozeniny…). Odeslání klepne uživatel sám. Provede se hned.",
      parameters: OBJ({ client_name: STR(CLIENT), template: STR("id šablony: potvrzeni, zitra, narozeniny (nebo vlastní); bez něj se vybere podle nejbližší schůzky") }, ["client_name"]) },
    { name: "calc_loan", description: "Spočítá splátku úvěru nebo hypotéky (anuita, měsíční splátky na konci měsíce). Použij místo počítání z hlavy.",
      parameters: OBJ({ amount: NUM("výše úvěru v Kč"), rate_percent: NUM("roční úroková sazba v %"), years: NUM("doba splácení v letech") }, ["amount", "rate_percent", "years"]) },
    { name: "calc_saving", description: "Spočítá, kolik naspoří nebo investuje při pravidelném měsíčním vkladu a případném jednorázovém vkladu (připisování měsíčně, vklady na konci měsíce). Použij místo počítání z hlavy.",
      parameters: OBJ({ monthly: NUM("měsíční vklad v Kč"), rate_percent: NUM("roční zhodnocení v %"), years: NUM("doba v letech"), initial: NUM("jednorázový vklad na začátku v Kč (volitelné)") }, ["monthly", "rate_percent", "years"]) },
    { name: "cancel_pending_plan", description: "Zruší plán, který čeká na provedení (odpočet běží nebo čeká na klepnutí). Zavolej, když to uživatel zruší nebo opraví.", parameters: OBJ({}) },
  ];
  const WRITE = {
    schedule_meeting: a => { const s = normStart(a.start); if (!trim(a.client_name)) return { error: "chybí jméno klienta" }; if (!s || !core.parseLocal(s)) return { error: "neplatný čas, očekávám YYYY-MM-DDTHH:MM" }; return { action: { name: "schedule_meeting", input: { client_name: trim(a.client_name), start: s, online: bool(a.online), place: trim(a.place), send_confirmation: a.send_confirmation === undefined || a.send_confirmation === null ? true : bool(a.send_confirmation) } } }; },
    set_stage: a => { if (!trim(a.client_name)) return { error: "chybí jméno klienta" }; if (!stages.includes(trim(a.stage))) return { error: "neznámá fáze, povolené: " + stages.join(", ") }; return { action: { name: "set_stage", input: { client_name: trim(a.client_name), stage: trim(a.stage) } } }; },
    add_note: a => { if (!trim(a.client_name) || !trim(a.text)) return { error: "chybí jméno klienta nebo text" }; return { action: { name: "add_note", input: { client_name: trim(a.client_name), text: trim(a.text) } } }; },
    add_lead: a => { if (!trim(a.name)) return { error: "chybí jméno" }; return { action: { name: "add_lead", input: { name: trim(a.name), phone: trim(a.phone), email: trim(a.email), source: trim(a.source) } } }; },
    update_client: a => {
      if (!trim(a.client_name)) return { error: "chybí jméno klienta" };
      const input = { client_name: trim(a.client_name) };
      for (const k of ["phone", "email", "source", "referred_by", "new_name"]) if (trim(a[k])) input[k] = trim(a[k]);
      if (Object.keys(input).length < 2) return { error: "není co měnit: zadej phone, email, source, referred_by nebo new_name" };
      return { action: { name: "update_client", input } };
    },
    set_next_step: a => {
      if (!trim(a.client_name)) return { error: "chybí jméno klienta" };
      const date = trim(a.date) ? normDate(a.date) : "";
      if (trim(a.date) && !date) return { error: "neplatný termín, očekávám YYYY-MM-DD" };
      if (!trim(a.step) && !date) return { error: "chybí krok nebo termín" };
      return { action: { name: "set_next_step", input: { client_name: trim(a.client_name), step: trim(a.step), date } } };
    },
    log_call: a => {
      if (!trim(a.client_name)) return { error: "chybí jméno klienta" };
      const r = trim(a.result);
      if (r !== "reached" && r !== "no_answer") return { error: "result musí být reached nebo no_answer" };
      return { action: { name: "log_call", input: { client_name: trim(a.client_name), result: r, text: trim(a.text) } } };
    },
    add_task: a => {
      if (!trim(a.text)) return { error: "chybí text úkolu" };
      const due = trim(a.due) ? normDate(a.due) : "";
      if (trim(a.due) && !due) return { error: "neplatný termín, očekávám YYYY-MM-DD" };
      return { action: { name: "add_task", input: { text: trim(a.text), client_name: trim(a.client_name), due } } };
    },
    complete_task: a => { if (!trim(a.task_text)) return { error: "chybí text úkolu" }; return { action: { name: "complete_task", input: { task_text: trim(a.task_text) } } }; },
  };
  /* které argumenty se po návratu ze značek převádějí do 1. pádu (jméno zapsané ve skloňovaném tvaru) */
  const NOM = ["name", "new_name"];
  const daysSince = iso => { const t = Date.parse(iso || ""); return isNaN(t) ? null : Math.max(0, Math.floor((host.now().getTime() - t) / 864e5)); };
  const info = l => {
    const now = host.now(), next = (l.meetings || []).filter(m => m && m.start && new Date(m.start) > now).sort((x, y) => x.start.localeCompare(y.start))[0];
    const o = { name: l.name, stage: l.stage, stage_title: core.STAGE_TITLES[l.stage] || l.stage, next_step: trim(l.nextStep), next_date: trim(l.nextDate), upcoming_meeting: next ? next.start : "", has_phone: !!core.normPhone(l.phone), has_email: core.validEmail(l.email), source: trim(l.source), referred_by: trim(l.referredBy), last_contact_days: daysSince(l.lastContact || l.updatedAt || l.createdAt) };
    if (l.stage === "podpis" || l.stage === "vyplaceno") o.points = +l.points || 0;
    return o;
  };
  const mine = () => (host.leads() || []).filter(l => l && !l.example && !l.shared);
  async function read(name, a) {
    if (name === "get_overview") {
      const day = DAYS_OK.test(trim(a.day)) ? trim(a.day) : "today", kind = ["tasks", "calls", "meetings", "agenda", "results"].includes(trim(a.kind)) ? trim(a.kind) : "agenda";
      const F = host.facts();
      if (!F) return { error: "data z aplikace teď nejsou dostupná" };
      return { lines: core.answerQuery({ kind, day, client: kind === "meetings" ? trim(a.client) : "" }, F, host.now()).lines };
    }
    if (name === "find_client") {
      const r = core.resolveClient(trim(a.name), host.leads());
      return { match: r.kind, clients: (r.kind === "exact" || r.kind === "fuzzy" ? [r.lead] : r.candidates).map(info), hint: r.kind === "none" ? "Takový klient v pipeline není." : r.kind === "ambiguous" ? "Víc možných klientů, zeptej se uživatele, kterého myslí." : r.kind === "fuzzy" ? "Jen podobné jméno, potvrď s uživatelem." : "Jednoznačná shoda." };
    }
    if (name === "list_clients") {
      const all = mine(), st = trim(a.stage), flt = ["due", "cold", "all"].includes(trim(a.filter)) ? trim(a.filter) : "all";
      const today = (() => { const d = host.now(); return d.getFullYear() + "-" + z2(d.getMonth() + 1) + "-" + z2(d.getDate()); })();
      const open = l => l.stage !== "podpis" && l.stage !== "vyplaceno" && l.stage !== "zamrzly" && l.stage !== "lost";
      const counts = {}; all.forEach(l => { const t = core.STAGE_TITLES[l.stage] || l.stage; counts[t] = (counts[t] || 0) + 1; });
      let list = st ? all.filter(l => l.stage === st) : all.filter(open);
      if (flt === "due") list = list.filter(l => open(l) && (!l.nextDate || l.nextDate <= today));
      if (flt === "cold") list = list.filter(l => open(l) && (daysSince(l.lastContact || l.updatedAt || l.createdAt) ?? 0) >= 14);
      list = list.slice().sort((x, y) => String(x.nextDate || "9999").localeCompare(String(y.nextDate || "9999")));
      return { counts_by_stage: counts, matching: list.length, clients: list.slice(0, 12).map(info), note: list.length > 12 ? "Zobrazeno prvních 12 z " + list.length + "." : "" };
    }
    if (name === "calc_loan") {
      const P = +a.amount, rate = +a.rate_percent, yrs = +a.years;
      if (!(P > 0) || !isFinite(rate) || rate < 0 || rate > 60 || !(yrs > 0) || yrs > 60) return { error: "zadej výši úvěru > 0, sazbu 0–60 % a dobu 0–60 let" };
      const i = rate / 1200, n = Math.round(yrs * 12), pay = i < 1e-12 ? P / n : P * i / (1 - Math.pow(1 + i, -n));
      return { monthly_payment_czk: Math.round(pay), total_paid_czk: Math.round(pay * n), total_interest_czk: Math.round(pay * n - P), spoken: "Splátka vychází na " + kc(pay) + " Kč měsíčně, celkem zaplatí " + kc(pay * n) + " Kč, z toho na úrocích " + kc(pay * n - P) + " Kč." };
    }
    if (name === "calc_saving") {
      const m = +a.monthly, rate = +a.rate_percent, yrs = +a.years, pv = a.initial == null || a.initial === "" ? 0 : +a.initial;
      if (!(m >= 0) || !isFinite(rate) || rate < -50 || rate > 100 || !(yrs > 0) || yrs > 80 || !(pv >= 0) || (m === 0 && pv === 0)) return { error: "zadej měsíční vklad (nebo jednorázový), roční zhodnocení a dobu 0–80 let" };
      const i = rate / 1200, n = Math.round(yrs * 12), g = Math.pow(1 + i, n), ann = Math.abs(i) < 1e-12 ? n : (g - 1) / i, fv = pv * g + m * ann, dep = pv + m * n;
      return { final_value_czk: Math.round(fv), deposited_czk: Math.round(dep), gain_czk: Math.round(fv - dep), spoken: "Za " + yrs + " let by to bylo asi " + kc(fv) + " Kč, vloženo " + kc(dep) + " Kč, zhodnocení " + kc(fv - dep) + " Kč." };
    }
    if (name === "open_screen") {
      const scr = trim(a.screen);
      if (!SCREENS[scr]) return { ok: false, error: "neznámá obrazovka, povolené: " + Object.keys(SCREENS).join(", ") };
      if (!host.navigate) return { ok: false, error: "otevírání obrazovek tu není dostupné" };
      let lead = null;
      if (scr === "client") {
        const r = core.resolveClient(trim(a.client_name), host.leads());
        if (r.kind === "none") return { ok: false, error: "Takový klient v pipeline není." };
        if (r.kind === "ambiguous") return { ok: false, error: "Víc možných klientů, zeptej se uživatele, kterého myslí.", candidates: r.candidates.map(c => c.name) };
        lead = r.lead;
      }
      return Object.assign({ ok: true }, await host.navigate({ screen: scr, view: SCREEN_VIEW[scr] || "", lead }));
    }
    if (name === "prepare_message") {
      if (!host.openMessage) return { ok: false, error: "zprávy tu nejsou dostupné" };
      const r = core.resolveClient(trim(a.client_name), host.leads());
      if (r.kind === "none") return { ok: false, error: "Takový klient v pipeline není." };
      if (r.kind === "ambiguous") return { ok: false, error: "Víc možných klientů, zeptej se uživatele, kterého myslí.", candidates: r.candidates.map(c => c.name) };
      return Object.assign({ ok: true }, await host.openMessage(r.lead, trim(a.template)));
    }
    if (name === "cancel_pending_plan") return await host.cancelPending();
    return { error: "neznámý nástroj " + name };
  }
  const res = (c, output) => ({ id: c.id, name: c.name, response: { output: sh ? sh.maskResult(output) : output } });
  /* calls = [{id,name,args}] z jedné odpovědi modelu; zápisy se spojí do jediného plánu */
  async function runBatch(calls) {
    const out = new Array(calls.length), writes = [];
    for (let i = 0; i < calls.length; i++) {
      const c = calls[i];
      try {
        let a = c.args || {};
        if (sh) { const u = sh.unmaskArgs(a, NOM); if (u.unknown.length) { out[i] = res(c, { ok: false, error: "neznámá značka " + u.unknown.map(t => "[" + t + "]").join(", ") + ", použij jen značky, které vidíš ve zprávách" }); continue; } a = u.value; }
        if (WRITE[c.name]) { const w = WRITE[c.name](a); if (w.error) out[i] = res(c, { ok: false, error: w.error }); else writes.push({ i, action: w.action }); }
        else out[i] = res(c, await read(c.name, a));
      } catch (e) { out[i] = res(c, { error: String((e && e.message) || e) }); }
    }
    if (writes.length) {
      let r;
      try { r = await host.propose(writes.map(w => w.action)); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
      writes.forEach(w => { out[w.i] = res(calls[w.i], r); });
    }
    return out;
  }
  return { declarations, runBatch, WRITE_NAMES: Object.keys(WRITE) };
}

/* ================= zvuk ================= */
function b64ToBytes(b64) { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
function bytesToB64(bytes) { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
function parseWav(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 12, rate = 24000, pcm = null;
  while (p + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]), size = dv.getUint32(p + 4, true);
    if (id === "fmt ") rate = dv.getUint32(p + 12, true);
    if (id === "data") { const end = Math.min(bytes.length, p + 8 + size), n = (end - p - 8) >> 1; pcm = new Int16Array(n); for (let i = 0; i < n; i++) pcm[i] = dv.getInt16(p + 8 + i * 2, true); break; }
    p += 8 + size + (size & 1);
  }
  return { rate, pcm: pcm || new Int16Array(0) };
}
/* inlineData z Gemini (raw PCM "audio/L16;rate=24000" nebo WAV) → {rate, pcm:Int16Array} */
function decodeInline(inl) {
  const bytes = b64ToBytes(inl.data), mt = String((inl && inl.mimeType) || "");
  if (/wav/i.test(mt) || (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46)) return parseWav(bytes);
  const m = /rate=(\d+)/i.exec(mt), n = bytes.length >> 1, pcm = new Int16Array(n), dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < n; i++) pcm[i] = dv.getInt16(i * 2, true);
  return { rate: m ? +m[1] : 24000, pcm };
}

/* přehrávač PCM: kousky se řadí těsně za sebe; analyser dává ekvalizéru skutečnou hlasitost */
class Player {
  constructor(ctx) {
    this.ctx = ctx; this.next = 0; this.src = new Set();
    this.gain = ctx.createGain(); this.an = ctx.createAnalyser(); this.an.fftSize = 256; this.an.smoothingTimeConstant = 0.6;
    this.gain.connect(this.an); this.an.connect(ctx.destination);
    this.data = new Uint8Array(this.an.frequencyBinCount);
  }
  enqueue(pcm, rate) {
    const n = pcm.length; if (!n) return 0;
    const buf = this.ctx.createBuffer(1, n, rate || 24000), ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = pcm[i] / 32768;
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.connect(this.gain);
    const now = this.ctx.currentTime, t = Math.max(now + (this.next > now ? 0.02 : 0.12), this.next);
    s.start(t); this.next = t + buf.duration; this.src.add(s); s.onended = () => this.src.delete(s);
    return buf.duration;
  }
  stop() { for (const s of this.src) { try { s.onended = null; s.stop(); } catch (e) {} } this.src.clear(); this.next = 0; }
  get playing() { return this.ctx.currentTime < this.next - 0.01; }
  get endsInMs() { return Math.max(0, (this.next - this.ctx.currentTime) * 1000); }
  levels() { this.an.getByteFrequencyData(this.data); return this.data; }
}

/* mikrofon → 16 kHz mono PCM po 512 vzorcích (32 ms); převzorkování průměrováním přímo v audio vlákně */
const CAP_WORKLET = `class PlCap extends AudioWorkletProcessor{constructor(){super();this.r=sampleRate/16000;this.ph=0;this.sum=0;this.cnt=0;this.out=new Int16Array(512);this.n=0}
process(inputs){const ch=inputs[0]&&inputs[0][0];if(!ch)return true;for(let i=0;i<ch.length;i++){this.sum+=ch[i];this.cnt++;this.ph+=1;if(this.ph>=this.r){this.ph-=this.r;let v=this.sum/this.cnt;this.sum=0;this.cnt=0;v=v<-1?-1:v>1?1:v;this.out[this.n++]=v<0?v*32768:v*32767;if(this.n===this.out.length){const b=this.out.buffer.slice(0);this.port.postMessage(b,[b]);this.n=0}}}return true}}
registerProcessor("pl-cap",PlCap);`;

/* ================= chyby česky ================= */
function friendlyError(e) {
  const o = e || {}, status = o.status || o.code;
  const msg = String(o.message || o.reason || (o.error && o.error.message) || (typeof e === "string" ? e : "") || "");
  if (o.name === "ShieldError") return "Štít soukromí zastavil odeslání (ve zprávě by zůstalo jméno nebo číslo).";
  if (o.name === "NotAllowedError" || o.name === "SecurityError") return "Mikrofon není povolený – povol ho v nastavení prohlížeče.";
  if (o.name === "NotFoundError" || /Requested device not found/i.test(msg)) return "Nenašel jsem mikrofon.";
  if (/API key not valid|API_KEY_INVALID|invalid api key|API key expired|API key.*(?:invalid|not found)/i.test(msg)) return "Klíč Gemini není platný – zkontroluj ho v nastavení.";
  if (status === 429 || /quota|RESOURCE_EXHAUSTED|rate.?limit|too many requests/i.test(msg)) return "Došel bezplatný limit Gemini (za minutu nebo za den). Zkus to za chvíli.";
  if (status === 401 || status === 403 || /PERMISSION_DENIED|unauthorized|forbidden|location is not supported/i.test(msg)) return "Gemini odmítl přístup (klíč nebo oblast). Zkontroluj klíč v AI Studiu.";
  if (status === 404 || /not found|is not supported for|unsupported model/i.test(msg)) return "Model Gemini není dostupný (název se mohl změnit).";
  if (/timeout|timed out|nedorazil/i.test(msg)) return "Google neodpověděl včas.";
  if (/Failed to fetch|NetworkError|network|offline|ERR_/i.test(msg)) return "Nepodařilo se spojit s Googlem – zkontroluj internet.";
  if (status === 503 || status === 500) return "Gemini je teď přetížený, zkus to za chvíli.";
  return "Gemini: " + (msg.replace(/\s+/g, " ").slice(0, 140) || "neznámá chyba");
}
const isQuota = e => { const s = e && (e.status || e.code); return s === 429 || /quota|RESOURCE_EXHAUSTED/i.test(String((e && e.message) || "")); };

/* ================= živý hovor ================= */
function liveConfig(sdk, o) {
  return {
    responseModalities: [sdk.Modality.AUDIO],
    systemInstruction: o.system,
    ...(o.declarations && o.declarations.length ? { tools: [{ functionDeclarations: o.declarations }] } : {}),
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: o.voice || DEFAULT_VOICE } } },
    inputAudioTranscription: {}, outputAudioTranscription: {},
    sessionResumption: o.handle ? { handle: o.handle } : {},
  };
}

class LiveCall {
  /* o: {key, sdk(), model, voice, system, declarations, bargeIn, idleMs, onTools(calls)→responses, onState(s), onUser(text), onModel(text), onClosed(msg), onIdle(), deps:{AudioContext,mediaDevices}} */
  constructor(o) {
    this.o = o; this.state = "idle"; this.closed = false; this.muted = false; this.handle = ""; this.gen = 0; this.retries = 0;
    this.turnDone = true; this.dropAudio = false; this.guardUntil = 0; this.lastAct = Date.now(); this.userBuf = ""; this.modelBuf = ""; this.newTurn = false;
  }
  setState(s) { if (this.state === s) return; this.state = s; this.o.onState && this.o.onState(s); }
  touch() { this.lastAct = Date.now(); }
  async start() {
    const o = this.o, deps = o.deps || {};
    /* AudioContext se musí založit hned v klepnutí / stisku klávesy (než se čeká na cokoli jiného), jinak ho prohlížeč nespustí */
    const AC = deps.AudioContext || root.AudioContext || root.webkitAudioContext;
    this.ctx = new AC({ latencyHint: "interactive" });
    const resume = this.ctx.resume && this.ctx.resume();
    this.player = new Player(this.ctx);
    this.setState("connecting");
    try {
      const md = deps.mediaDevices || (root.navigator && root.navigator.mediaDevices);
      if (!md || !md.getUserMedia) throw Object.assign(new Error("getUserMedia není k dispozici"), { name: "NotFoundError" });
      const [stream] = await Promise.all([md.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }), resume]);
      this.stream = stream;
      if (this.closed) { this.stop(); return; }
      this.workUrl = URL.createObjectURL(new Blob([CAP_WORKLET], { type: "application/javascript" }));
      await this.ctx.audioWorklet.addModule(this.workUrl);
      this.srcNode = this.ctx.createMediaStreamSource(stream);
      this.micAn = this.ctx.createAnalyser(); this.micAn.fftSize = 256; this.micAn.smoothingTimeConstant = 0.55; this.micData = new Uint8Array(this.micAn.frequencyBinCount);
      this.capNode = new AudioWorkletNode(this.ctx, "pl-cap");
      this.mute0 = this.ctx.createGain(); this.mute0.gain.value = 0;
      this.srcNode.connect(this.micAn); this.srcNode.connect(this.capNode); this.capNode.connect(this.mute0); this.mute0.connect(this.ctx.destination);
      this.capNode.port.onmessage = e => this.onChunk(e.data);
      this.sdk = await o.sdk();
      this.ai = new this.sdk.GoogleGenAI({ apiKey: o.key });
      if (this.closed) { this.stop(); return; }
      await this.connect();
      if (this.closed) return;
      this.touch(); this.setState("listening");
      this.idleTimer = setInterval(() => { if (this.state === "listening" && Date.now() - this.lastAct > (o.idleMs || 2 * MIN)) { this.stop(); o.onIdle && o.onIdle(); } }, 5000);
    } catch (e) { this.stop(); throw e; }
  }
  connect() {
    const o = this.o, gen = ++this.gen;
    let rejectEarly;
    const early = new Promise((_, rej) => { rejectEarly = rej; });
    this.earlyFail = rejectEarly;
    const timeout = new Promise((_, rej) => { this.cTimer = setTimeout(() => rej(Object.assign(new Error("timeout připojení"), { name: "TimeoutError" })), 15000); });
    const sess = this.ai.live.connect({
      model: o.model || MODELS.live, config: liveConfig(this.sdk, { ...o, handle: this.handle }),
      callbacks: { onmessage: m => { if (gen === this.gen) this.onMsg(m); }, onerror: e => { if (gen === this.gen) this.onErr(e); }, onclose: e => { if (gen === this.gen) this.onCls(e); } },
    });
    sess.catch(() => {});
    return Promise.race([sess, early, timeout]).then(s => { clearTimeout(this.cTimer); this.earlyFail = null; this.session = s; if (this.closed) { try { s.close(); } catch (e) {} } }, e => { clearTimeout(this.cTimer); this.earlyFail = null; throw e; });
  }
  get micOpen() { return !this.muted && !this.closed && (this.o.bargeIn || (!this.player.playing && this.ctx.currentTime >= this.guardUntil)); }
  onChunk(buf) {
    if (!this.session || !this.micOpen) return;
    try { this.session.sendRealtimeInput({ audio: { data: bytesToB64(new Uint8Array(buf)), mimeType: "audio/pcm;rate=16000" } }); } catch (e) {}
  }
  onMsg(m) {
    const o = this.o;
    if (m.sessionResumptionUpdate && m.sessionResumptionUpdate.newHandle) this.handle = m.sessionResumptionUpdate.newHandle;
    if (m.goAway) { this.reconnect(); }
    if (m.toolCall && m.toolCall.functionCalls && m.toolCall.functionCalls.length) this.handleTools(m.toolCall.functionCalls);
    const sc = m.serverContent;
    if (!sc) return;
    if (sc.interrupted) { this.player.stop(); this.dropAudio = false; this.turnDone = true; this.newTurn = true; this.setState("listening"); }
    const parts = sc.modelTurn && sc.modelTurn.parts;
    if (parts) for (const p of parts) {
      if (!p.inlineData || !p.inlineData.data || this.dropAudio) continue;
      this.turnDone = false; this.touch(); this.setState("speaking");
      const d = decodeInline(p.inlineData); this.player.enqueue(d.pcm, d.rate); this.armDrain();
    }
    if (sc.inputTranscription && sc.inputTranscription.text) {
      if (this.newTurn) { this.userBuf = ""; this.modelBuf = ""; this.newTurn = false; }
      this.userBuf += sc.inputTranscription.text; this.touch(); o.onUser && o.onUser(this.userBuf.trim());
    }
    if (sc.outputTranscription && sc.outputTranscription.text && !this.dropAudio) { this.modelBuf += sc.outputTranscription.text; o.onModel && o.onModel(this.modelBuf.trim()); }
    if (sc.turnComplete || sc.generationComplete) { this.turnDone = true; this.dropAudio = false; this.newTurn = true; this.armDrain(); }
  }
  armDrain() {
    clearTimeout(this.drainT);
    this.drainT = setTimeout(() => {
      if (this.closed) return;
      if (this.turnDone && !this.player.playing) { this.guardUntil = this.ctx.currentTime + 0.3; if (this.state === "speaking" || this.state === "thinking") this.setState("listening"); }
      else if (this.player.playing) this.armDrain();
    }, this.player.endsInMs + 80);
  }
  async handleTools(calls) {
    this.touch(); this.setState("thinking");
    const list = calls.map(c => ({ id: c.id, name: c.name, args: c.args || {} }));
    let responses;
    try { responses = await this.o.onTools(list); } catch (e) { responses = list.map(c => ({ id: c.id, name: c.name, response: { error: String((e && e.message) || e) } })); }
    if (this.closed || !this.session) return;
    try { this.session.sendToolResponse({ functionResponses: responses }); } catch (e) {}
    /* kdyby model po nástroji mlčel, ať ekvalizér nezůstane viset v „přemýšlím“ */
    clearTimeout(this.thinkT); this.thinkT = setTimeout(() => { if (!this.closed && this.state === "thinking") this.setState("listening"); }, 12000);
  }
  sendText(text) { this.touch(); try { this.session && this.session.sendRealtimeInput({ text: String(text) }); return true; } catch (e) { return false; } }
  /* uživatel skočil do řeči rukou (mezerník / tlačítko): ztichnout hned a zahodit, co model ještě dogeneruje */
  interrupt() {
    this.player.stop(); this.guardUntil = 0; this.dropAudio = !this.turnDone;
    if (this.state === "speaking") this.setState("listening");
  }
  setMuted(m) { this.muted = !!m; }
  micLevels() { if (!this.micAn) return null; this.micAn.getByteFrequencyData(this.micData); return this.micData; }
  outLevels() { return this.player ? this.player.levels() : null; }
  onErr(e) { if (this.earlyFail) this.earlyFail(e); else this.fail(e); }
  onCls(e) {
    if (this.closed) return;
    if (this.earlyFail) { this.earlyFail(e); return; }
    if (this.handle && this.retries < 2 && !this.reconnecting) { this.retries++; this.reconnect(); return; }
    this.fail(e);
  }
  async reconnect() {
    if (this.closed || this.reconnecting) return;
    this.reconnecting = true;
    try { const old = this.session; this.session = null; try { old && old.close(); } catch (e) {} await this.connect(); if (!this.closed) this.setState("listening"); }
    catch (e) { this.fail(e); }
    finally { this.reconnecting = false; }
  }
  fail(e) { if (this.closed) return; const msg = friendlyError(e); this.stop(); this.o.onClosed && this.o.onClosed(msg, e); }
  stop() {
    if (this.closed && this.state === "closed") return;
    this.closed = true; clearInterval(this.idleTimer); clearTimeout(this.drainT); clearTimeout(this.cTimer); clearTimeout(this.thinkT); this.gen++;
    try { this.session && this.session.close(); } catch (e) {}
    try { this.player && this.player.stop(); } catch (e) {}
    try { this.stream && this.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
    try { this.capNode && (this.capNode.port.onmessage = null, this.capNode.disconnect()); } catch (e) {}
    try { this.ctx && this.ctx.close(); } catch (e) {}
    try { this.workUrl && URL.revokeObjectURL(this.workUrl); } catch (e) {}
    this.session = null; this.state = "closed";
  }
}

/* ================= textový mozek (psaní a rychlý režim) ================= */
class Brain {
  /* o: {key, sdk(), models, system(), declarations, onTools(calls)→responses, shield (volitelně: maskování), onRequest(failed)} */
  constructor(o) { this.o = o; this.mi = 0; this.chat = null; this.turns = 0; this.noThink = false; this.shield = o.shield || null; }
  models() { return this.o.models || MODELS.text; }
  async init() {
    if (!this.ai) { this.sdk = await this.o.sdk(); this.ai = new this.sdk.GoogleGenAI({ apiKey: this.o.key }); }
  }
  newChat(history) {
    const system = typeof this.o.system === "function" ? this.o.system() : this.o.system;
    const config = { systemInstruction: system, tools: [{ functionDeclarations: this.o.declarations }] };
    if (!this.noThink) config.thinkingConfig = { thinkingLevel: "LOW" };
    return this.ai.chats.create({ model: this.models()[this.mi], config, ...(history && history.length ? { history } : {}) });
  }
  reset() { this.chat = null; this.turns = 0; }
  /* jen text z dosavadní konverzace (funkční volání a podpisy myšlení se mezi modely nepřenášejí) */
  textHistory() {
    try { return this.chat.getHistory(true).map(c => ({ role: c.role, parts: (c.parts || []).filter(p => p.text).map(p => ({ text: p.text })) })).filter(c => c.parts.length); } catch (e) { return []; }
  }
  async send(message) {
    if (this.shield) this.shield.assertClean(message);   /* poslední pojistka: co by prozradilo jméno nebo číslo, se neodešle */
    for (let guard = 0; guard < 6; guard++) {
      if (!this.chat) this.chat = this.newChat();
      try { const r = await this.chat.sendMessage({ message }); Usage.bump(false); if (this.o.onRequest) this.o.onRequest(false); return r; }
      catch (e) {
        Usage.bump(true); if (this.o.onRequest) this.o.onRequest(true);
        const st = e && e.status, txt = String((e && e.message) || "");
        if (st === 400 && /thinking/i.test(txt) && !this.noThink) { this.noThink = true; const h = this.textHistory(); this.chat = this.newChat(h); continue; }
        if ((st === 404 || st === 429 || st === 503 || st === 500) && this.mi < this.models().length - 1) { const h = this.textHistory(); this.mi++; this.noThink = false; this.chat = this.newChat(h); continue; }
        throw e;
      }
    }
    throw new Error("Gemini neodpovídá");
  }
  async ask(text) {
    await this.init();
    if (this.turns > 40) { const h = this.textHistory().slice(-12); this.chat = this.newChat(h); this.turns = 0; }
    this.turns++;
    const sent = this.shield ? this.shield.mask(String(text)) : String(text);
    let resp = await this.send(sent), used = [];
    for (let i = 0; i < 6; i++) {
      const calls = resp.functionCalls;
      if (!calls || !calls.length) break;
      const list = calls.map(c => ({ id: c.id, name: c.name, args: c.args || {} }));
      used.push(...list.map(c => c.name));
      const out = await this.o.onTools(list);
      resp = await this.send(out.map(r => ({ functionResponse: { id: r.id, name: r.name, response: r.response } })));
    }
    let said = "";
    try { said = (resp.candidates && resp.candidates[0] && resp.candidates[0].content && resp.candidates[0].content.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join(" "); } catch (e) {}
    said = said.replace(/[*_#`]+/g, "").replace(/\s+/g, " ").trim();
    return { text: this.shield ? this.shield.unmask(said) : said, tools: used, model: this.models()[this.mi], sent };
  }
}

/* ================= hlas (TTS) ================= */
const ttsCache = new Map();
async function synth(o, text) {
  const key = (o.voice || DEFAULT_VOICE) + "|" + text;
  if (!o.noCache && ttsCache.has(key)) return ttsCache.get(key);
  const sdk = await o.sdk(), ai = new sdk.GoogleGenAI({ apiKey: o.key });
  const resp = await ai.models.generateContent({
    model: o.model || MODELS.tts, contents: [{ role: "user", parts: [{ text }] }],
    config: { responseModalities: [sdk.Modality.AUDIO], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: o.voice || DEFAULT_VOICE } } } },
  });
  const part = ((resp.candidates && resp.candidates[0] && resp.candidates[0].content && resp.candidates[0].content.parts) || []).find(p => p.inlineData && p.inlineData.data);
  if (!part) throw new Error("Hlas Gemini nevrátil zvuk");
  const d = decodeInline(part.inlineData);
  if (!o.noCache) { if (ttsCache.size > 30) ttsCache.delete(ttsCache.keys().next().value); ttsCache.set(key, d); }
  return d;
}

/* ================= zkouška spojení (nastavení) ================= */
async function selfTest(o, log) {
  const line = (ok, text) => log && log(ok, text), out = { text: false, tts: false, live: false };
  let sdk;
  try { sdk = await o.sdk(); } catch (e) { line(false, "Knihovnu Gemini se nepodařilo načíst: " + ((e && e.message) || e)); return out; }
  const ai = new sdk.GoogleGenAI({ apiKey: o.key });
  /* 1) textový model */
  for (const m of (o.models || MODELS.text)) {
    try { const t0 = Date.now(), r = await ai.models.generateContent({ model: m, contents: "Odpověz jedním slovem: Ahoj." }); const t = (r.text || "").trim(); out.text = true; line(true, "Text (" + m + "): odpověděl za " + (Date.now() - t0) + " ms – „" + t.slice(0, 30) + "“"); break; }
    catch (e) { line(false, "Text (" + m + "): " + friendlyError(e)); if (!/404|not found|přetížený|limit/i.test(friendlyError(e))) break; }
  }
  /* 2) hlas */
  try { const t0 = Date.now(), d = await synth({ ...o, sdk: async () => sdk, noCache: true }, "Dobrý den, tady vaše asistentka."); out.tts = true; out.ttsAudio = d; line(true, "Hlas (" + MODELS.tts + "): " + (d.pcm.length / d.rate).toFixed(1) + " s zvuku za " + (Date.now() - t0) + " ms"); }
  catch (e) { line(false, "Hlas: " + friendlyError(e)); }
  /* 3) živý hovor bez mikrofonu: textová otázka, čekám na zvukovou odpověď */
  const r = await new Promise(resolve => {
    let bytes = 0, done = false, session = null;
    const finish = (ok, text) => { if (done) return; done = true; clearTimeout(timer); try { session && session.close(); } catch (e) {} resolve({ ok, text }); };
    const timer = setTimeout(() => finish(false, "Bez odpovědi do 20 s"), 20000);
    const t0 = Date.now();
    ai.live.connect({
      model: o.liveModel || MODELS.live, config: liveConfig(sdk, { system: "Odpovídej česky, jedním krátkým slovem.", voice: o.voice }),
      callbacks: {
        onmessage: m => { const sc = m.serverContent; if (!sc) return; const ps = sc.modelTurn && sc.modelTurn.parts; if (ps) for (const p of ps) if (p.inlineData && p.inlineData.data) bytes += p.inlineData.data.length * 0.75; if (sc.turnComplete || sc.generationComplete) finish(bytes > 0, bytes > 0 ? "odpověděl hlasem za " + (Date.now() - t0) + " ms (" + Math.round(bytes / 1024) + " kB zvuku)" : "turn skončil bez zvuku"); },
        onerror: e => finish(false, friendlyError(e)), onclose: e => finish(false, friendlyError(e)),
      },
    }).then(s => { session = s; if (done) { try { s.close(); } catch (e) {} return; } s.sendRealtimeInput({ text: "Řekni česky jedno slovo: ahoj." }); }, e => finish(false, friendlyError(e)));
  });
  out.live = r.ok; line(r.ok, "Živý hovor (" + (o.liveModel || MODELS.live) + "): " + r.text);
  return out;
}

return { MODELS, VOICES, DEFAULT_VOICE, KEY_STORAGE, getKey, setKey, clearKey, maskKey, loadSdk, calendarText, systemPrompt, normStart, makeTools, Shield, Usage, pacificDay, b64ToBytes, bytesToB64, parseWav, decodeInline, Player, CAP_WORKLET, friendlyError, isQuota, liveConfig, LiveCall, Brain, synth, selfTest };
});
