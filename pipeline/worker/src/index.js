/* Pipeline asistent – Cloudflare Worker.
   POST /ai   { utterance, tz }          → { reply, actions:[{name,input}] }   (rozpoznání věty přes Claude, nic nevykonává)
   POST /sms  { to, text }               → { ok }                               (jen když jsou nastavené TWILIO_* tajné hodnoty)
   GET  /health                          → { ok, ai, sms }
   Oba POST vyžadují hlavičku Authorization: Bearer <Google access token> z appky; Worker ho ověří u Googlu, zkontroluje,
   že byl vydán pro klienta appky a že e-mail je v ALLOWED_EMAILS. Klientská data se neukládají ani nelogují. */

const TOOLS = [
  {
    name: "schedule_meeting",
    description: "Domluvená schůzka s klientem (zapíše se do kalendáře a pošle se potvrzení). Použij jen když zazněl den i čas.",
    input_schema: {
      type: "object",
      properties: {
        client_name: { type: "string", description: "Jméno klienta v 1. pádě, ideálně jméno + příjmení, bez titulů" },
        start: { type: "string", description: "Začátek schůzky, lokální čas ve tvaru YYYY-MM-DDTHH:mm" },
        online: { type: "boolean", description: "true jen když zazněl online / video / Meet / Teams / Zoom" },
        place: { type: "string", description: "Místo schůzky, jen když zaznělo" },
        send_confirmation: { type: "boolean", description: "false jen když poradce výslovně řekl, že potvrzení nemá jít; jinak true" },
      },
      required: ["client_name", "start", "online"],
    },
  },
  {
    name: "set_stage",
    description: "Změna fáze obchodu. Fáze: novy (nový lead), kontaktovan, schuzka (schůzka domluvena), probehla (schůzka proběhla), nabidka (nabídka odeslána), podpis (klient podepsal smlouvu), vyplaceno (provize vyplacena), zamrzly, lost (klient nechce).",
    input_schema: {
      type: "object",
      properties: {
        client_name: { type: "string", description: "Jméno klienta v 1. pádě" },
        stage: { type: "string", enum: ["novy", "kontaktovan", "schuzka", "probehla", "nabidka", "podpis", "vyplaceno", "zamrzly", "lost"] },
      },
      required: ["client_name", "stage"],
    },
  },
  {
    name: "add_lead",
    description: "Nový kontakt (lead), který ještě nemusí být v pipeline.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string", description: "Telefon, jen když zazněl" },
        email: { type: "string", description: "E-mail, jen když zazněl" },
        source: { type: "string", enum: ["Cold call", "Placený lead", "Doporučení", "Vlastní kontakt"] },
      },
      required: ["name"],
    },
  },
  {
    name: "add_note",
    description: "Zápis do historie kontaktu s klientem (např. nezvedl telefon, chce zavolat později).",
    input_schema: {
      type: "object",
      properties: {
        client_name: { type: "string", description: "Jméno klienta v 1. pádě" },
        text: { type: "string", description: "Stručný zápis česky, 1 věta" },
      },
      required: ["client_name", "text"],
    },
  },
];

const DOW = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];
const STAGES = TOOLS[1].input_schema.properties.stage.enum;
const SOURCES = TOOLS[2].input_schema.properties.source.enum;
const MAX_UTTERANCE = 800;

/* ---------- čas ---------- */
function nowIn(tz, at = new Date()) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  } catch (e) {
    return nowIn("Europe/Prague", at);
  }
  const g = t => +parts.find(p => p.type === t).value;
  return { y: g("year"), m: g("month"), d: g("day"), h: g("hour"), min: g("minute"), tz };
}
const z2 = n => String(n).padStart(2, "0");
const ymd = (y, m, d) => y + "-" + z2(m) + "-" + z2(d);
function calendarHint(n) {
  const base = new Date(Date.UTC(n.y, n.m - 1, n.d));
  const rows = [];
  for (let i = 0; i < 15; i++) {
    const t = new Date(base.getTime() + i * 864e5);
    const label = i === 0 ? "dnes" : i === 1 ? "zítra" : i === 2 ? "pozítří" : "";
    rows.push(ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()) + " " + DOW[t.getUTCDay()] + (label ? " (" + label + ")" : ""));
  }
  return rows.join("\n");
}
export function systemPrompt(n) {
  const wd = DOW[new Date(Date.UTC(n.y, n.m - 1, n.d)).getUTCDay()];
  return [
    "Jsi asistent v CRM aplikaci českého finančního poradce. Z českého diktátu nebo textu (může obsahovat chyby rozpoznávání řeči) vytvoř akce voláním nástrojů. Nikdy nevymýšlej údaje, které nezazněly.",
    "Teď je " + wd + " " + ymd(n.y, n.m, n.d) + ", " + z2(n.h) + ":" + z2(n.min) + " (časové pásmo " + n.tz + ").",
    "Kalendář na dalších 15 dní:\n" + calendarHint(n),
    "Pravidla:",
    "- Jméno klienta piš v 1. pádě (Novákem → Novák, s Petrou Svobodovou → Petra Svobodová), bez titulů. Když zazněl jen příjmení, nech jen příjmení.",
    "- „ve středu“ = nejbližší budoucí středa z kalendáře výše (když je dnes středa, myslí se příští týden, pokud výslovně neřekl „dnes“). „příští týden v pondělí“ = pondělí následujícího týdne.",
    "- Čas zapisuj v 24h tvaru: „v 17h“ = 17:00, „v půl páté odpoledne“ = 16:30, „v 5“ odpoledne = 17:00. Když nezazněl den nebo čas, schůzku NEZAKLÁDEJ a zeptej se krátce česky.",
    "- online = true jen když zazněl online / video / Meet / Teams / Zoom, jinak false.",
    "- „podepsal jsem smlouvu s X“ = set_stage podpis. „domluvil jsem schůzku“ = schedule_meeting. „nezvedl telefon“, „chce zavolat později“ = add_note. Jedna věta může vyvolat víc nástrojů.",
    "- Zprávy klientům neposíláš a nepíšeš – potvrzení schůzky odešle aplikace sama ze šablony.",
    "- Když je věta nejasná, nebo to není příkaz pro aplikaci, odpověz jednou krátkou českou větou bez nástrojů.",
  ].join("\n");
}

/* ---------- ověření vstupu z modelu ---------- */
const str = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
export function cleanAction(name, i) {
  i = i && typeof i === "object" ? i : {};
  if (name === "schedule_meeting") {
    const start = str(i.start, 16);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start) || !str(i.client_name, 80)) return null;
    return { name, input: { client_name: str(i.client_name, 80), start, online: i.online === true, place: str(i.place, 120), send_confirmation: i.send_confirmation !== false } };
  }
  if (name === "set_stage") {
    if (!STAGES.includes(i.stage) || !str(i.client_name, 80)) return null;
    return { name, input: { client_name: str(i.client_name, 80), stage: i.stage } };
  }
  if (name === "add_lead") {
    if (!str(i.name, 80)) return null;
    return { name, input: { name: str(i.name, 80), phone: str(i.phone, 30), email: str(i.email, 120), source: SOURCES.includes(i.source) ? i.source : "" } };
  }
  if (name === "add_note") {
    if (!str(i.client_name, 80) || !str(i.text, 400)) return null;
    return { name, input: { client_name: str(i.client_name, 80), text: str(i.text, 400) } };
  }
  return null;
}

/* ---------- pomocné ---------- */
const json = (obj, status, cors) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...(cors || {}) } });
function corsFor(req, env) {
  const origin = req.headers.get("Origin") || "";
  const ok = String(env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  return ok.includes(origin) ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Max-Age": "86400" } : null;
}

const tokenCache = new Map();
async function authorize(req, env) {
  const allowed = String(env.ALLOWED_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length) return { status: 503, error: "Worker není nastavený (chybí ALLOWED_EMAILS)" };
  const m = /^Bearer (.{20,})$/.exec(req.headers.get("Authorization") || "");
  if (!m) return { status: 401, error: "Chybí přihlášení" };
  const tok = m[1];
  let info = tokenCache.get(tok);
  if (!info || info.exp < Date.now()) {
    let r;
    try { r = await fetch("https://oauth2.googleapis.com/tokeninfo?access_token=" + encodeURIComponent(tok)); } catch (e) { return { status: 502, error: "Google je nedostupný" }; }
    if (!r.ok) return { status: 401, error: "Přihlášení vypršelo" };
    const j = await r.json();
    const aud = j.azp || j.aud;
    if (env.GOOGLE_CLIENT_ID && aud !== env.GOOGLE_CLIENT_ID) return { status: 401, error: "Token nepatří téhle appce" };
    if (String(j.email_verified) !== "true" || !j.email) return { status: 401, error: "Chybí ověřený e-mail" };
    info = { email: String(j.email).toLowerCase(), exp: Date.now() + Math.min(300, +j.expires_in || 60) * 1000 };
    if (tokenCache.size > 200) tokenCache.clear();
    tokenCache.set(tok, info);
  }
  if (!allowed.includes(info.email)) return { status: 403, error: "Tenhle účet asistenta používat nesmí" };
  return { email: info.email };
}

/* denní limit na účet; bez KV (binding LIMITS) se limit nehlídá */
async function underLimit(env, kind, email, max) {
  if (!env.LIMITS || !(max > 0)) return true;
  const day = new Date().toISOString().slice(0, 10), key = kind + ":" + email + ":" + day;
  const n = +(await env.LIMITS.get(key)) || 0;
  if (n >= max) return false;
  await env.LIMITS.put(key, String(n + 1), { expirationTtl: 172800 });
  return true;
}

async function readBody(req, max) {
  const t = await req.text();
  if (t.length > max) throw Object.assign(new Error("Požadavek je moc dlouhý"), { status: 413 });
  try { return JSON.parse(t || "{}"); } catch (e) { throw Object.assign(new Error("Neplatný JSON"), { status: 400 }); }
}

/* ---------- /ai ---------- */
async function handleAi(req, env, who, cors) {
  const b = await readBody(req, 4000);
  const utterance = str(b.utterance, MAX_UTTERANCE);
  if (!utterance) return json({ error: "Prázdný příkaz" }, 400, cors);
  if (!env.ANTHROPIC_API_KEY) return json({ error: "Worker nemá nastavený ANTHROPIC_API_KEY" }, 503, cors);
  if (!(await underLimit(env, "ai", who.email, +env.AI_DAILY_LIMIT || 200))) return json({ error: "Denní limit asistenta je vyčerpaný" }, 429, cors);
  const n = nowIn(typeof b.tz === "string" && b.tz.length < 60 ? b.tz : "Europe/Prague");
  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: env.MODEL || "claude-haiku-5-5", max_tokens: 700, temperature: 0, system: systemPrompt(n), tools: TOOLS, tool_choice: { type: "auto" }, messages: [{ role: "user", content: utterance }] }),
    });
  } catch (e) { return json({ error: "AI je nedostupná" }, 502, cors); }
  if (!r.ok) return json({ error: "AI odpověděla chybou " + r.status }, 502, cors);
  const j = await r.json();
  const blocks = Array.isArray(j.content) ? j.content : [];
  const reply = blocks.filter(x => x.type === "text").map(x => String(x.text || "")).join(" ").trim().slice(0, 600);
  const actions = blocks.filter(x => x.type === "tool_use").map(x => cleanAction(x.name, x.input)).filter(Boolean).slice(0, 8);
  return json({ reply, actions }, 200, cors);
}

/* ---------- /sms (Twilio) ---------- */
const smsConfigured = env => !!(env.TWILIO_SID && env.TWILIO_TOKEN && env.TWILIO_FROM);
async function handleSms(req, env, who, cors) {
  if (!smsConfigured(env)) return json({ error: "SMS brána není nastavená" }, 503, cors);
  const b = await readBody(req, 3000);
  const to = String(b.to || "").replace(/[\s()-]/g, ""), text = typeof b.text === "string" ? b.text.trim() : "";
  if (!/^\+(420|421)\d{9}$/.test(to)) return json({ error: "Telefon musí být české nebo slovenské číslo ve tvaru +420…" }, 400, cors);
  if (!text || text.length > 480) return json({ error: "Text SMS musí mít 1–480 znaků" }, 400, cors);
  if (!(await underLimit(env, "sms", who.email, +env.SMS_DAILY_LIMIT || 30))) return json({ error: "Denní limit SMS je vyčerpaný" }, 429, cors);
  const form = new URLSearchParams({ To: to, From: env.TWILIO_FROM, Body: text });
  let r;
  try {
    r = await fetch("https://api.twilio.com/2010-04-01/Accounts/" + encodeURIComponent(env.TWILIO_SID) + "/Messages.json", {
      method: "POST",
      headers: { Authorization: "Basic " + btoa(env.TWILIO_SID + ":" + env.TWILIO_TOKEN), "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
  } catch (e) { return json({ error: "SMS brána je nedostupná" }, 502, cors); }
  if (!r.ok) return json({ error: "SMS brána odmítla zprávu (" + r.status + ")" }, 502, cors);
  return json({ ok: true }, 200, cors);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsFor(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: cors ? 204 : 403, headers: cors || {} });
    if (url.pathname === "/health") return json({ ok: true, ai: !!env.ANTHROPIC_API_KEY, sms: smsConfigured(env) }, 200, cors || {});
    if (req.method !== "POST" || !["/ai", "/sms"].includes(url.pathname)) return json({ error: "Nenalezeno" }, 404, cors || {});
    if (!cors) return json({ error: "Nepovolený původ požadavku" }, 403);
    try {
      const who = await authorize(req, env);
      if (who.error) return json({ error: who.error }, who.status, cors);
      return url.pathname === "/ai" ? await handleAi(req, env, who, cors) : await handleSms(req, env, who, cors);
    } catch (e) {
      return json({ error: e && e.status ? e.message : "Chyba Workeru" }, (e && e.status) || 500, cors);
    }
  },
};
