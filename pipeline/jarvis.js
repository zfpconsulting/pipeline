/* Jarvis: chytrý režim asistenta. Mozek, hlas a živý hovor obstarává Gemini (Google) přes oficiální knihovnu @google/genai,
   která leží ve vendor/genai.min.mjs a stahuje se až při prvním použití. Klíč (zdarma z aistudio.google.com/apikey) si vkládá uživatel
   a zůstává jen v tomhle zařízení (localStorage "gem_key"), do synchronizovaných dat se nikdy nezapisuje.

   Co je tady:
   - nástroje, kterými model sahá do pipeline (makeTools): get_overview, find_client, schedule_meeting, set_stage, add_note, add_lead, cancel_pending_plan.
     Zápisové nástroje nic neprovedou, jen navrhnou plán (provede ho stejná karta s odpočtem jako dřív);
   - LiveCall: živý hlasový hovor (Gemini Live: mikrofon → model → hlas), Brain: textový mozek (stejné nástroje), synth: hlas (TTS), selfTest;
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

/* ================= prompt ================= */
const DOW = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];
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
    "DATA A AKCE",
    "- O klientech, úkolech, schůzkách, telefonátech ani výsledcích nikdy nic nevymýšlej a netipuj. Vždy použij nástroj (get_overview, find_client). Co nástroj nevrátil, nevíš, a to řekni.",
    "- Zápisy (schůzka, změna fáze, poznámka, nový kontakt) děláš jen nástroji schedule_meeting, set_stage, add_note, add_lead. Nástroj plán jen připraví a ukáže ho na obrazovce; provede ho aplikace po krátkém odpočtu nebo po klepnutí. Dokud ti systém nepošle zprávu „[Systém] Provedeno“, netvrď, že je něco hotové; říkej „mám připraveno“ nebo „zapíšu“.",
    "- Všechno z jedné věty navrhni najednou v jednom kole (např. podpis smlouvy a nová schůzka = set_stage a schedule_meeting spolu).",
    "- Když uživatel plán opraví nebo zruší („počkej, radši ve čtvrtek“), nejdřív zavolej cancel_pending_plan a pak navrhni nový plán.",
    "- Klient: před zápisem zavolej find_client. Při jedné shodě použij přesné jméno z výsledku. Při více shodách se zeptej, kterého myslí (řekni jména). Když klient neexistuje, zeptej se, jestli má založit nový kontakt, a teprve pak ho založ (nebo ho rovnou použij ve schůzce, když to uživatel řekl).",
    "- Čas schůzky: použij kalendář níže. „Ve středu“ je nejbližší budoucí středa. Když chybí den nebo hodina, zeptej se jednou krátce. Hodina bez upřesnění je pracovní doba (v 5 = 17:00). start je ve tvaru YYYY-MM-DDTHH:MM místního času.",
    "- online=true jen když uživatel řekl online, videohovor nebo Meet; jinak je schůzka osobní. send_confirmation nech true, pokud uživatel neřekl, že potvrzení nechce.",
    "- Po zprávě „[Systém] Provedeno“ řekni jednou krátkou větou, že je hotovo (a když je v ní SMS, že stačí klepnout na Odeslat). Po zprávě „[Systém] Zrušeno“ řekni jen „Dobře, zrušeno.“",
    "- Nejsi poradce pro klienty: u produktů a legislativy odpovídej stručně a upozorni, že to má uživatel ověřit. Cokoli nepochopíš, se zeptej; neodpovídej nesmysly.",
    "",
    "ČAS: je " + DOW[now.getDay()] + " " + now.getDate() + ". " + (now.getMonth() + 1) + ". " + now.getFullYear() + ", " + z2(now.getHours()) + ":" + z2(now.getMinutes()) + " (Praha).",
    "KALENDÁŘ: " + calendarText(now),
  ].join("\n");
}

/* ================= nástroje pro model ================= */
const STR = (description, extra) => ({ type: "STRING", description, ...(extra || {}) });
const OBJ = (properties, required) => ({ type: "OBJECT", properties, required: required || [] });
const trim = v => String(v == null ? "" : v).trim();
const bool = v => v === true || /^(true|ano|yes|1)$/i.test(trim(v));
function normStart(s) {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})/.exec(trim(s));
  return m ? m[1] + "T" + z2(+m[2]) + ":" + m[3] : "";
}
const DAYS_OK = /^(today|tomorrow|week|nextweek|\d{4}-\d{2}-\d{2})$/;

/* core = čistá logika z assistant.js (resolveClient, answerQuery, STAGE_TITLES, normPhone, validEmail, parseLocal)
   host = {now(), leads(), facts(), propose(actions) → výsledek plánu, cancelPending() → {ok, ...}} */
function makeTools(core, host) {
  const stages = Object.keys(core.STAGE_TITLES);
  const declarations = [
    { name: "get_overview", description: "Přečte z pipeline úkoly, telefonáty, schůzky nebo výsledky (body, provize, sazba, rozjednané leady). Použij vždy, když se uživatel ptá na svoje data.",
      parameters: OBJ({
        kind: STR("tasks = úkoly, calls = komu zavolat, meetings = schůzky v kalendáři, agenda = všechno na den (úkoly, telefonáty, schůzky), results = výsledky (body, provize, sazba, rozjednané leady)", { enum: ["tasks", "calls", "meetings", "agenda", "results"] }),
        day: STR("today (výchozí), tomorrow, week (do konce týdne), nextweek, nebo datum YYYY-MM-DD"),
        client: STR("jen u kind=meetings: jméno klienta, pak vrátí jeho nejbližší schůzky"),
      }, ["kind"]) },
    { name: "find_client", description: "Najde klienta nebo kontakt v pipeline podle jména (i skloňovaného). Vrací jméno, fázi, další krok a zda je znám telefon a e-mail (ne jejich hodnoty).",
      parameters: OBJ({ name: STR("jméno nebo příjmení, jak ho uživatel řekl") }, ["name"]) },
    { name: "schedule_meeting", description: "Připraví schůzku s klientem (zapíše se do pipeline a kalendáře a klientovi se pošle potvrzení). Neprovede se hned, uživatel ji uvidí na obrazovce.",
      parameters: OBJ({
        client_name: STR("přesné jméno z find_client, nebo jméno nového klienta"),
        start: STR("začátek ve tvaru YYYY-MM-DDTHH:MM místního času"),
        online: { type: "BOOLEAN", description: "true jen když je schůzka online (videohovor)" },
        place: STR("místo osobní schůzky, pokud ho uživatel řekl"),
        send_confirmation: { type: "BOOLEAN", description: "poslat klientovi potvrzení (výchozí true)" },
      }, ["client_name", "start"]) },
    { name: "set_stage", description: "Připraví změnu fáze klienta v pipeline. Podepsal smlouvu = podpis. Neprovede se hned.",
      parameters: OBJ({
        client_name: STR("přesné jméno z find_client"),
        stage: STR("fáze: " + stages.map(s => s + " = " + core.STAGE_TITLES[s]).join(", "), { enum: stages }),
      }, ["client_name", "stage"]) },
    { name: "add_note", description: "Připraví zápis (poznámku) do karty klienta. Neprovede se hned.",
      parameters: OBJ({ client_name: STR("přesné jméno z find_client"), text: STR("text zápisu, věcně a stručně v 1. osobě uživatele") }, ["client_name", "text"]) },
    { name: "add_lead", description: "Připraví založení nového kontaktu v pipeline. Neprovede se hned.",
      parameters: OBJ({ name: STR("jméno a příjmení v 1. pádě"), phone: STR("telefon, pokud zazněl"), email: STR("e-mail, pokud zazněl"), source: STR("odkud kontakt je (doporučení, cold call, …), pokud zazněl") }, ["name"]) },
    { name: "cancel_pending_plan", description: "Zruší plán, který čeká na provedení (odpočet běží nebo čeká na klepnutí). Zavolej, když to uživatel zruší nebo opraví.", parameters: OBJ({}) },
  ];
  const WRITE = {
    schedule_meeting: a => { const s = normStart(a.start); if (!trim(a.client_name)) return { error: "chybí jméno klienta" }; if (!s || !core.parseLocal(s)) return { error: "neplatný čas, očekávám YYYY-MM-DDTHH:MM" }; return { action: { name: "schedule_meeting", input: { client_name: trim(a.client_name), start: s, online: bool(a.online), place: trim(a.place), send_confirmation: a.send_confirmation === undefined || a.send_confirmation === null ? true : bool(a.send_confirmation) } } }; },
    set_stage: a => { if (!trim(a.client_name)) return { error: "chybí jméno klienta" }; if (!stages.includes(trim(a.stage))) return { error: "neznámá fáze, povolené: " + stages.join(", ") }; return { action: { name: "set_stage", input: { client_name: trim(a.client_name), stage: trim(a.stage) } } }; },
    add_note: a => { if (!trim(a.client_name) || !trim(a.text)) return { error: "chybí jméno klienta nebo text" }; return { action: { name: "add_note", input: { client_name: trim(a.client_name), text: trim(a.text) } } }; },
    add_lead: a => { if (!trim(a.name)) return { error: "chybí jméno" }; return { action: { name: "add_lead", input: { name: trim(a.name), phone: trim(a.phone), email: trim(a.email), source: trim(a.source) } } }; },
  };
  const info = l => {
    const now = host.now(), next = (l.meetings || []).filter(m => m && m.start && new Date(m.start) > now).sort((x, y) => x.start.localeCompare(y.start))[0];
    return { name: l.name, stage: l.stage, stage_title: core.STAGE_TITLES[l.stage] || l.stage, next_step: trim(l.nextStep), next_date: trim(l.nextDate), upcoming_meeting: next ? next.start : "", has_phone: !!core.normPhone(l.phone), has_email: core.validEmail(l.email) };
  };
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
    if (name === "cancel_pending_plan") return await host.cancelPending();
    return { error: "neznámý nástroj " + name };
  }
  const res = (c, output) => ({ id: c.id, name: c.name, response: { output } });
  /* calls = [{id,name,args}] z jedné odpovědi modelu; zápisy se spojí do jediného plánu */
  async function runBatch(calls) {
    const out = new Array(calls.length), writes = [];
    for (let i = 0; i < calls.length; i++) {
      const c = calls[i], a = c.args || {};
      try {
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
  /* o: {key, sdk(), models, system(), declarations, onTools(calls)→responses} */
  constructor(o) { this.o = o; this.mi = 0; this.chat = null; this.turns = 0; this.noThink = false; }
  models() { return this.o.models || MODELS.text; }
  async init() {
    if (!this.ai) { this.sdk = await this.o.sdk(); this.ai = new this.sdk.GoogleGenAI({ apiKey: this.o.key }); }
  }
  newChat(history) {
    const config = { systemInstruction: typeof this.o.system === "function" ? this.o.system() : this.o.system, tools: [{ functionDeclarations: this.o.declarations }] };
    if (!this.noThink) config.thinkingConfig = { thinkingLevel: "LOW" };
    return this.ai.chats.create({ model: this.models()[this.mi], config, ...(history && history.length ? { history } : {}) });
  }
  reset() { this.chat = null; this.turns = 0; }
  /* jen text z dosavadní konverzace (funkční volání a podpisy myšlení se mezi modely nepřenášejí) */
  textHistory() {
    try { return this.chat.getHistory(true).map(c => ({ role: c.role, parts: (c.parts || []).filter(p => p.text).map(p => ({ text: p.text })) })).filter(c => c.parts.length); } catch (e) { return []; }
  }
  async send(message) {
    for (let guard = 0; guard < 6; guard++) {
      if (!this.chat) this.chat = this.newChat();
      try { return await this.chat.sendMessage({ message }); }
      catch (e) {
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
    let resp = await this.send(String(text)), used = [];
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
    return { text: said.replace(/[*_#`]+/g, "").replace(/\s+/g, " ").trim(), tools: used, model: this.models()[this.mi] };
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

return { MODELS, VOICES, DEFAULT_VOICE, KEY_STORAGE, getKey, setKey, clearKey, maskKey, loadSdk, calendarText, systemPrompt, normStart, makeTools, b64ToBytes, bytesToB64, parseWav, decodeInline, Player, CAP_WORKLET, friendlyError, isQuota, liveConfig, LiveCall, Brain, synth, selfTest };
});
