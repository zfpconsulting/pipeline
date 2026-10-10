// Testy chytrého režimu (jarvis.js): nástroje, prompt, zvuk, chyby, textový mozek, živý hovor. Nepotřebují prohlížeč ani klíč ke Googlu.
// Knihovna Googlu (vendor/genai.min.mjs) se ověřuje skutečná – jen síť (fetch, WebSocket) je podvržená, takže se kontroluje i podoba zpráv, které by šly Googlu.
// Použití: node tests/jarvis.run.mjs
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const req = createRequire(import.meta.url);
const A = req("../assistant.js"), J = req("../jarvis.js");
const sdk = await import("../vendor/genai.min.mjs");
const sleep = ms => new Promise(r => setTimeout(r, ms));

const L = (id, name, stage = "novy", extra = {}) => ({ id, name, stage, ...extra });
const NOW = new Date(2026, 9, 10, 18, 56);   /* so 10. 10. 2026 18:56 */
const leads = [L("1", "Jan Novák", "schuzka", { phone: "777 111 222", email: "novak@example.com", nextStep: "poslat nabídku", nextDate: "2026-10-12", meetings: [{ id: "m", start: "2026-10-14T17:00:00" }] }),
  L("2", "Petr Novák", "kontaktovan"), L("3", "Eva Šikulová", "kontaktovan", { phone: "777333444" })];
const FACTS = { today: "2026-10-10", tasks: [{ text: "Zavolat bance", client: "", due: "2026-10-10", who: "" }], calls: [], meets: [{ name: "Jan Novák", start: "2026-10-14T17:00:00", online: true }], quarter: { label: "4. Q 2026", pts: 120, kc: 21600, rate: 180, nextRate: 200, nextTier: "T5", need: 30, perWeek: 5, days: 80 }, month: { pts: 40 }, pipe: { active: 5, meetings: 2, pts: 90, ptsKc: 16200, late: 1 } };

function toolHost(over = {}) {
  const h = { proposed: [], cancelled: 0, now: () => NOW, leads: () => leads, facts: () => FACTS,
    propose: async acts => { h.proposed.push(acts); return { ok: true, steps: acts.map(a => a.name) }; },
    cancelPending: async () => { h.cancelled++; return { ok: true, cancelled: true }; }, ...over };
  return h;
}

/* ---- podvržená síť pro skutečnou knihovnu Googlu ---- */
const realFetch = globalThis.fetch;
function fakeFetch(handler) {
  const log = [];
  globalThis.fetch = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : null;
    const rec = { url: String(url), method: (init && init.method) || "GET", headers: Object.fromEntries(new Headers((init && init.headers) || {})), body };
    log.push(rec);
    const out = await handler(rec, log);
    return new Response(JSON.stringify(out.body), { status: out.status || 200, headers: { "content-type": "application/json" } });
  };
  return log;
}
const gen = parts => ({ candidates: [{ content: { role: "model", parts }, finishReason: "STOP", index: 0 }] });

class FakeWS {
  static all = [];
  constructor(url) { this.url = url; this.sent = []; FakeWS.all.push(this); this.readyState = 0; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen({}); }, 0); }
  send(d) { const m = JSON.parse(d); this.sent.push(m); if (m.setup && FakeWS.autoSetup !== false) setTimeout(() => this.emit({ setupComplete: {} }), 0); if (FakeWS.onSend) FakeWS.onSend(this, m); }
  emit(o) { this.onmessage && this.onmessage({ data: JSON.stringify(o) }); }
  close(code, reason) { this.readyState = 3; this.onclose && this.onclose({ code: code || 1000, reason: reason || "" }); }
}

class FakeAC {
  constructor() { this.currentTime = 0; this.destination = {}; this.audioWorklet = { addModule: async () => {} }; this.closed = false; }
  resume() { return Promise.resolve(); } close() { this.closed = true; }
  createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
  createAnalyser() { return { fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 128, connect() {}, getByteFrequencyData(a) { a.fill(40); } }; }
  createBuffer(c, n, r) { return { duration: n / r, getChannelData: () => new Float32Array(n) }; }
  createBufferSource() { return { connect() {}, start(t) { this.t = t; }, stop() { this.stopped = true; }, onended: null }; }
  createMediaStreamSource() { return { connect() {} }; }
}
globalThis.AudioWorkletNode = class { constructor() { this.port = {}; } connect() {} disconnect() {} };
const fakeMedia = () => { const tracks = [{ stopped: false, stop() { this.stopped = true; } }]; return { tracks, getUserMedia: async () => ({ getTracks: () => tracks }) }; };
const pcmB64 = (n, rate = 24000) => ({ data: Buffer.from(new Int16Array(n).fill(1000).buffer).toString("base64"), mimeType: "audio/L16;codec=pcm;rate=" + rate });

/* podvržená knihovna pro testy samotného řízení hovoru (bez sítě) */
function fakeSdk() {
  const st = { sessions: [], configs: [], key: null };
  const ai = {
    live: { connect: async p => {
      st.configs.push(p); const sess = { sent: [], tools: [], closed: false, cb: p.callbacks, sendRealtimeInput(x) { this.sent.push(x); }, sendToolResponse(x) { this.tools.push(x); }, close() { this.closed = true; } };
      st.sessions.push(sess); await sleep(1); return sess;
    } },
  };
  return { st, sdk: { GoogleGenAI: class { constructor(o) { st.key = o.apiKey; return ai; } }, Modality: { AUDIO: "AUDIO" } } };
}
function callOpts(over = {}) {
  const f = fakeSdk(), ev = { states: [], user: [], model: [], tools: [], closed: [] }, media = fakeMedia();
  const o = { key: "AIzaTESTKEYTESTKEYTESTKEY", sdk: async () => f.sdk, voice: "Kore", system: "SYS", declarations: [{ name: "x" }], deps: { AudioContext: FakeAC, mediaDevices: media },
    onState: s => ev.states.push(s), onUser: t => ev.user.push(t), onModel: t => ev.model.push(t), onClosed: m => ev.closed.push(m),
    onTools: async calls => { ev.tools.push(calls); return calls.map(c => ({ id: c.id, name: c.name, response: { output: { ok: 1 } } })); }, ...over };
  return { o, f, ev, media };
}

const tests = {
  "prompt: čas a kalendář na 21 dní"() {
    const p = J.systemPrompt(NOW, { callMe: "Vojto" });
    assert.match(p, /sobota 10\. 10\. 2026, 18:56/);
    assert.match(p, /dnes sobota 10\. 10\. = 2026-10-10/);
    assert.match(p, /zítra neděle 11\. 10\. = 2026-10-11/);
    assert.match(p, /středa 14\. 10\. = 2026-10-14/);
    assert.match(p, /pátek 30\. 10\. = 2026-10-30/);
    assert.match(p, /oslovuj „Vojto“/);
    assert.doesNotMatch(J.systemPrompt(NOW), /oslovuj/);
    assert.match(p, /ženském rodě/);
  },
  "normStart: sekundy, časové pásmo, jednociferná hodina"() {
    assert.equal(J.normStart("2026-10-14T17:00:00+02:00"), "2026-10-14T17:00");
    assert.equal(J.normStart("2026-10-14 9:30"), "2026-10-14T09:30");
    assert.equal(J.normStart("ve středu"), "");
  },
  async "nástroje: seznam, find_client neprozradí kontakty"() {
    const t = J.makeTools(A, toolHost());
    assert.deepEqual(t.declarations.map(d => d.name), ["get_overview", "find_client", "schedule_meeting", "set_stage", "add_note", "add_lead", "cancel_pending_plan"]);
    const st = t.declarations.find(d => d.name === "set_stage").parameters.properties.stage;
    assert.ok(st.enum.includes("podpis") && st.enum.includes("lost"));
    const [r] = await t.runBatch([{ id: "a", name: "find_client", args: { name: "Šikulová" } }]);
    const o = r.response.output;
    assert.equal(o.match, "exact"); assert.equal(o.clients[0].name, "Eva Šikulová"); assert.equal(o.clients[0].has_phone, true); assert.equal(o.clients[0].has_email, false);
    assert.ok(!JSON.stringify(r).includes("777"), "telefon se nesmí poslat modelu");
    const [n] = await t.runBatch([{ id: "b", name: "find_client", args: { name: "Novák" } }]);
    assert.equal(n.response.output.match, "ambiguous"); assert.equal(n.response.output.clients.length, 2);
    assert.ok(!JSON.stringify(n).includes("novak@example.com"));
    assert.equal(n.response.output.clients.find(c => c.name === "Jan Novák").upcoming_meeting, "2026-10-14T17:00:00");
    const [f] = await t.runBatch([{ id: "d", name: "find_client", args: { name: "Šikulovou" } }]);
    assert.equal(f.response.output.match, "fuzzy"); assert.match(f.response.output.hint, /potvrď/);
    const [z] = await t.runBatch([{ id: "c", name: "find_client", args: { name: "Zeman" } }]);
    assert.equal(z.response.output.match, "none");
  },
  async "nástroje: get_overview čte data appky"() {
    const t = J.makeTools(A, toolHost());
    const [a, b, c] = await t.runBatch([{ id: "1", name: "get_overview", args: { kind: "tasks", day: "today" } }, { id: "2", name: "get_overview", args: { kind: "results" } }, { id: "3", name: "get_overview", args: { kind: "meetings", client: "Novák", day: "nesmysl" } }]);
    assert.match(a.response.output.lines.join(" "), /Zavolat bance/);
    assert.match(b.response.output.lines.join(" ").replace(/\u00a0/g, " "), /120 bodů/);
    assert.match(c.response.output.lines.join(" "), /Novák/);
    const t2 = J.makeTools(A, toolHost({ facts: () => null }));
    assert.match((await t2.runBatch([{ id: "1", name: "get_overview", args: { kind: "tasks" } }]))[0].response.output.error, /nejsou dostupná/);
  },
  async "nástroje: zápisy se spojí do jednoho plánu a každé volání dostane výsledek"() {
    const h = toolHost(), t = J.makeTools(A, h);
    const out = await t.runBatch([
      { id: "1", name: "set_stage", args: { client_name: "Jan Novák", stage: "podpis" } },
      { id: "2", name: "find_client", args: { name: "Novák" } },
      { id: "3", name: "schedule_meeting", args: { client_name: "Jan Novák", start: "2026-10-14T17:00:00", online: "true" } },
    ]);
    assert.equal(h.proposed.length, 1, "jediný návrh plánu");
    assert.deepEqual(h.proposed[0].map(a => a.name), ["set_stage", "schedule_meeting"]);
    assert.deepEqual(h.proposed[0][1].input, { client_name: "Jan Novák", start: "2026-10-14T17:00", online: true, place: "", send_confirmation: true });
    assert.deepEqual(out.map(o => o.id), ["1", "2", "3"]);
    assert.equal(out[0].response.output.ok, true); assert.equal(out[2].response.output.ok, true);
    assert.equal(out[1].response.output.match, "ambiguous");
  },
  async "nástroje: špatné argumenty vrátí chybu modelu, nic nenavrhnou"() {
    const h = toolHost(), t = J.makeTools(A, h);
    const out = await t.runBatch([{ id: "1", name: "schedule_meeting", args: { client_name: "Novák", start: "ve středu" } }, { id: "2", name: "set_stage", args: { client_name: "Novák", stage: "hotovo" } }, { id: "3", name: "add_note", args: { client_name: "Novák" } }, { id: "4", name: "neexistuje", args: {} }, { id: "5", name: "schedule_meeting", args: { start: "2026-10-14T17:00" } }]);
    assert.equal(h.proposed.length, 0);
    assert.match(out[0].response.output.error, /neplatný čas/); assert.match(out[1].response.output.error, /neznámá fáze/); assert.match(out[2].response.output.error, /chybí/);
    assert.match(out[3].response.output.error, /neznámý nástroj/); assert.match(out[4].response.output.error, /chybí jméno/);
  },
  async "nástroje: cancel_pending_plan a výjimka při návrhu plánu"() {
    const h = toolHost({ propose: async () => { throw new Error("boom"); } }), t = J.makeTools(A, h);
    const out = await t.runBatch([{ id: "1", name: "cancel_pending_plan", args: {} }, { id: "2", name: "add_lead", args: { name: "Karel Nový", phone: "777 000 111" } }]);
    assert.equal(h.cancelled, 1); assert.equal(out[0].response.output.cancelled, true);
    assert.equal(out[1].response.output.ok, false); assert.match(out[1].response.output.error, /boom/);
  },
  "zvuk: base64, surové PCM i WAV"() {
    const b = Uint8Array.from([1, 2, 3, 250, 255]);
    assert.deepEqual([...J.b64ToBytes(J.bytesToB64(b))], [...b]);
    const raw = J.decodeInline({ data: Buffer.from(new Int16Array([100, -200, 300]).buffer).toString("base64"), mimeType: "audio/L16;codec=pcm;rate=16000" });
    assert.equal(raw.rate, 16000); assert.deepEqual([...raw.pcm], [100, -200, 300]);
    const wav = Buffer.alloc(44 + 6); wav.write("RIFF", 0); wav.writeUInt32LE(38, 4); wav.write("WAVE", 8); wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(6, 40);
    wav.writeInt16LE(7, 44); wav.writeInt16LE(-8, 46); wav.writeInt16LE(9, 48);
    const w = J.decodeInline({ data: wav.toString("base64"), mimeType: "audio/wav" });
    assert.equal(w.rate, 24000); assert.deepEqual([...w.pcm], [7, -8, 9]);
    assert.equal(J.decodeInline({ data: Buffer.from(new Int16Array([5]).buffer).toString("base64"), mimeType: "audio/pcm" }).rate, 24000, "bez rate = 24 kHz");
  },
  "zvuk: Player řadí kousky za sebe a umí ztichnout"() {
    const ac = new FakeAC(), p = new J.Player(ac);
    assert.equal(p.playing, false);
    const d = p.enqueue(new Int16Array(2400), 24000);
    assert.ok(Math.abs(d - 0.1) < 1e-9); assert.equal(p.playing, true);
    const first = p.next; p.enqueue(new Int16Array(2400), 24000);
    assert.ok(Math.abs(p.next - (first + 0.1)) < 1e-9, "druhý kousek navazuje");
    p.stop(); assert.equal(p.playing, false); assert.equal(p.src.size, 0);
    assert.equal(p.levels().length, 128);
  },
  "chyby: srozumitelné české hlášky"() {
    const f = J.friendlyError;
    assert.match(f({ status: 429, message: "x" }), /limit/);
    assert.match(f(new Error("Quota exceeded for metric")), /limit/);
    assert.match(f({ code: 1007, reason: "API key not valid. Please pass a valid API key." }), /Klíč Gemini není platný/);
    assert.match(f({ status: 400, message: '{"error":{"message":"API key not valid"}}' }), /Klíč Gemini není platný/);
    assert.match(f({ status: 403, message: "PERMISSION_DENIED" }), /odmítl přístup/);
    assert.match(f({ status: 404, message: "models/x is not found" }), /Model Gemini není dostupný/);
    assert.match(f(Object.assign(new Error("Permission denied"), { name: "NotAllowedError" })), /Mikrofon není povolený/);
    assert.match(f(Object.assign(new Error("x"), { name: "NotFoundError" })), /Nenašel jsem mikrofon/);
    assert.match(f(new TypeError("Failed to fetch")), /spojit s Googlem/);
    assert.match(f({ status: 503, message: "overloaded" }), /přetížený/);
    assert.match(f(new Error("něco divného")), /^Gemini: něco divného/);
  },
  "klíč: tvar a uložení jen lokálně"() {
    const store = {}; globalThis.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
    assert.equal(J.setKey("krátký"), false); assert.equal(J.setKey("AIza SyAbcdefghijklmnopqrstuvwxyz"), false, "mezera = špatně");
    assert.equal(J.setKey("  AIzaSyAbcdefghijklmnopqrstuvwxyz012  "), true);
    assert.equal(J.getKey(), "AIzaSyAbcdefghijklmnopqrstuvwxyz012"); assert.equal(store.gem_key, "AIzaSyAbcdefghijklmnopqrstuvwxyz012");
    assert.equal(J.maskKey(J.getKey()), "AIza…012");
    J.clearKey(); assert.equal(J.getKey(), ""); delete globalThis.localStorage;
  },

  /* ---------- textový mozek přes skutečnou knihovnu a podvržený fetch ---------- */
  async "Brain: nástroj → odpověď, podpis myšlení se vrací zpátky, správná podoba požadavku"() {
    const log = fakeFetch((rec, all) => all.length === 1
      ? { body: gen([{ functionCall: { name: "find_client", args: { name: "Šikulová" }, id: "fc1" }, thoughtSignature: "SIG123" }]) }
      : { body: gen([{ text: "**Paní Šikulová** je v pipeline, ve fázi Kontaktován." }]) });
    try {
      const t = J.makeTools(A, toolHost());
      const b = new J.Brain({ key: "AIzaTESTKEYTESTKEYTESTKEY", sdk: async () => sdk, system: () => "SYS PROMPT", declarations: t.declarations, onTools: t.runBatch });
      const r = await b.ask("Co víš o Šikulové?");
      assert.equal(r.text, "Paní Šikulová je v pipeline, ve fázi Kontaktován.", "markdown pryč");
      assert.deepEqual(r.tools, ["find_client"]); assert.equal(r.model, "gemini-3.8-flash");
      assert.equal(log.length, 2);
      assert.match(log[0].url, /\/v1beta\/models\/gemini-3\.8-flash:generateContent$/);
      assert.equal(log[0].headers["x-goog-api-key"], "AIzaTESTKEYTESTKEYTESTKEY");
      const b0 = log[0].body;
      assert.equal((b0.systemInstruction || b0.system_instruction).parts[0].text, "SYS PROMPT");
      assert.equal(b0.tools[0].functionDeclarations.length, 7);
      assert.equal(b0.generationConfig.thinkingConfig.thinkingLevel, "LOW");
      assert.equal(b0.contents.at(-1).parts[0].text, "Co víš o Šikulové?");
      const c1 = log[1].body.contents;
      assert.equal(c1.at(-2).role, "model"); assert.equal(c1.at(-2).parts[0].thoughtSignature, "SIG123", "podpis myšlení musí zpátky");
      const fr = c1.at(-1).parts[0].functionResponse;
      assert.equal(fr.name, "find_client"); assert.equal(fr.response.output.match, "exact");
    } finally { globalThis.fetch = realFetch; }
  },
  async "Brain: při limitu přejde na další model a zachová text konverzace"() {
    const log = fakeFetch((rec, all) => /gemini-3\.8-flash:/.test(rec.url) ? (all.filter(x => /3\.8-flash:/.test(x.url)).length === 1 ? { body: gen([{ text: "Ahoj." }]) } : { status: 429, body: { error: { code: 429, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" } } }) : { body: gen([{ text: "Jsem tu." }]) });
    try {
      const b = new J.Brain({ key: "k".repeat(24), sdk: async () => sdk, system: "S", declarations: [], onTools: async () => [] });
      assert.equal((await b.ask("Ahoj")).text, "Ahoj.");
      const r = await b.ask("Jsi tu?");
      assert.equal(r.text, "Jsem tu."); assert.equal(r.model, "gemini-3.6-flash");
      const last = log.at(-1);
      assert.match(last.url, /gemini-3\.6-flash:/);
      assert.deepEqual(last.body.contents.map(c => c.role), ["user", "model", "user"], "historie převedena jako text");
      assert.equal(last.body.contents[1].parts[0].text, "Ahoj.");
    } finally { globalThis.fetch = realFetch; }
  },
  async "Brain: chyba 400 kvůli myšlení → zopakuje bez thinkingConfig; poslední chyba se vyhodí česky"() {
    let n = 0;
    const log = fakeFetch(rec => { n++; return n === 1 ? { status: 400, body: { error: { code: 400, message: "thinking_level is not supported", status: "INVALID_ARGUMENT" } } } : { body: gen([{ text: "OK" }]) }; });
    try {
      const b = new J.Brain({ key: "k".repeat(24), sdk: async () => sdk, system: "S", declarations: [], onTools: async () => [] });
      assert.equal((await b.ask("test")).text, "OK");
      assert.ok(log[0].body.generationConfig && log[0].body.generationConfig.thinkingConfig);
      assert.ok(!(log[1].body.generationConfig && log[1].body.generationConfig.thinkingConfig), "bez thinkingConfig");
    } finally { globalThis.fetch = realFetch; }
    fakeFetch(() => ({ status: 429, body: { error: { code: 429, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" } } }));
    try {
      const b = new J.Brain({ key: "k".repeat(24), sdk: async () => sdk, system: "S", declarations: [], onTools: async () => [] });
      await assert.rejects(() => b.ask("x"), e => { assert.equal(J.isQuota(e), true); assert.match(J.friendlyError(e), /limit/); return true; });
    } finally { globalThis.fetch = realFetch; }
  },
  async "hlas (TTS): požadavek na zvuk s vybraným hlasem, PCM se dekóduje a cachuje"() {
    const pcm = pcmB64(4800);
    const log = fakeFetch(() => ({ body: gen([{ inlineData: pcm }]) }));
    try {
      const d = await J.synth({ key: "k".repeat(24), sdk: async () => sdk, voice: "Kore" }, "Dobrý den");
      assert.equal(d.rate, 24000); assert.equal(d.pcm.length, 4800); assert.equal(d.pcm[0], 1000);
      assert.match(log[0].url, /gemini-3\.8-flash-tts:generateContent$/);
      const g = log[0].body.generationConfig;
      assert.deepEqual(g.responseModalities, ["AUDIO"]); assert.equal(g.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Kore");
      assert.equal(log[0].body.contents[0].parts[0].text, "Dobrý den");
      await J.synth({ key: "k".repeat(24), sdk: async () => sdk, voice: "Kore" }, "Dobrý den");
      assert.equal(log.length, 1, "druhé stejné věty se nepošle znovu");
    } finally { globalThis.fetch = realFetch; }
    fakeFetch(() => ({ body: gen([{ text: "žádný zvuk" }]) }));
    try { await assert.rejects(() => J.synth({ key: "k".repeat(24), sdk: async () => sdk, voice: "Leda" }, "Jiná věta"), /nevrátil zvuk/); } finally { globalThis.fetch = realFetch; }
  },

  /* ---------- živý hovor: skutečná knihovna + podvržený WebSocket ---------- */
  async "Live: podoba zpráv, které by šly Googlu (setup, zvuk z mikrofonu, odpověď nástroje, text)"() {
    const realWS = globalThis.WebSocket; globalThis.WebSocket = FakeWS; FakeWS.all.length = 0; FakeWS.onSend = null; FakeWS.autoSetup = true;
    try {
      const t = J.makeTools(A, toolHost());
      const calls = []; let call;
      call = new J.LiveCall({ key: "AIzaTESTKEYTESTKEYTESTKEY", sdk: async () => sdk, voice: "Aoede", system: J.systemPrompt(NOW), declarations: t.declarations,
        deps: { AudioContext: FakeAC, mediaDevices: fakeMedia() }, onTools: async c => { calls.push(c); return t.runBatch(c); } });
      await call.start();
      assert.equal(call.state, "listening");
      const ws = FakeWS.all[0];
      assert.match(ws.url, /^wss:\/\/generativelanguage\.googleapis\.com\/{1,2}ws\/google\.ai\.generativelanguage\.v1beta\.GenerativeService\.BidiGenerateContent\?key=AIzaTESTKEYTESTKEYTESTKEY$/);
      const s = ws.sent[0].setup, cfg = s.generationConfig || s;
      assert.equal(s.model, "models/gemini-3.8-live");
      assert.deepEqual(cfg.responseModalities, ["AUDIO"]);
      assert.equal(cfg.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Aoede");
      assert.match(s.systemInstruction.parts[0].text, /hlasová asistentka/);
      assert.equal(s.tools[0].functionDeclarations.length, 7);
      assert.ok("inputAudioTranscription" in s && "outputAudioTranscription" in s && "sessionResumption" in s);
      /* mikrofon → realtimeInput.audio */
      call.onChunk(new Int16Array(512).buffer);
      const au = ws.sent.find(m => m.realtimeInput && m.realtimeInput.audio).realtimeInput.audio;
      assert.equal(au.mimeType, "audio/pcm;rate=16000"); assert.equal(Buffer.from(au.data, "base64").length, 1024);
      /* model zavolá nástroj → toolResponse se stejným id */
      ws.emit({ toolCall: { functionCalls: [{ id: "fcA", name: "find_client", args: { name: "Šikulová" } }] } });
      await sleep(20);
      const tr = ws.sent.find(m => m.toolResponse).toolResponse.functionResponses[0];
      assert.equal(tr.id, "fcA"); assert.equal(tr.name, "find_client"); assert.equal(tr.response.output.match, "exact");
      assert.equal(calls[0][0].name, "find_client");
      /* text od systému */
      assert.equal(call.sendText("[Systém] Provedeno: x"), true);
      assert.equal(ws.sent.at(-1).realtimeInput.text, "[Systém] Provedeno: x");
      call.stop();
      assert.equal(call.state, "closed");
    } finally { globalThis.WebSocket = realWS; }
  },
  async "Live: odmítnutý klíč při spojení → srozumitelná chyba a úklid"() {
    const realWS = globalThis.WebSocket; globalThis.WebSocket = FakeWS; FakeWS.all.length = 0; FakeWS.autoSetup = false;
    FakeWS.onSend = ws => setTimeout(() => ws.close(1007, "API key not valid. Please pass a valid API key."), 0);
    try {
      const media = fakeMedia();
      const call = new J.LiveCall({ key: "AIzaBAD" + "x".repeat(20), sdk: async () => sdk, system: "S", declarations: [], deps: { AudioContext: FakeAC, mediaDevices: media } });
      await assert.rejects(() => call.start(), e => { assert.match(J.friendlyError(e), /Klíč Gemini není platný/); return true; });
      assert.equal(media.tracks[0].stopped, true, "mikrofon se uvolnil");
      assert.equal(call.state, "closed");
    } finally { globalThis.WebSocket = realWS; FakeWS.autoSetup = true; FakeWS.onSend = null; }
  },
  async "Live: zamítnutý mikrofon neotevře spojení s Googlem"() {
    const { o, f } = callOpts({ deps: { AudioContext: FakeAC, mediaDevices: { getUserMedia: async () => { throw Object.assign(new Error("Permission denied"), { name: "NotAllowedError" }); } } } });
    const call = new J.LiveCall(o);
    await assert.rejects(() => call.start(), e => /Mikrofon není povolený/.test(J.friendlyError(e)));
    assert.equal(f.st.sessions.length, 0);
  },

  /* ---------- řízení hovoru bez sítě ---------- */
  async "Live: stavy mluvím → poslouchám, přepis a hlas modelu"() {
    const { o, f, ev } = callOpts({ bargeIn: false });
    const call = new J.LiveCall(o); await call.start();
    assert.deepEqual(ev.states, ["connecting", "listening"]); assert.equal(f.st.configs[0].model, "gemini-3.8-live");
    const cb = f.st.sessions[0].cb;
    cb.onmessage({ serverContent: { inputTranscription: { text: "Co mám " } } }); cb.onmessage({ serverContent: { inputTranscription: { text: "dneska?" } } });
    assert.equal(ev.user.at(-1), "Co mám dneska?");
    cb.onmessage({ serverContent: { modelTurn: { parts: [{ inlineData: pcmB64(2400) }] } } });
    assert.equal(call.state, "speaking"); cb.onmessage({ serverContent: { outputTranscription: { text: "Dnes máš" } } }); cb.onmessage({ serverContent: { outputTranscription: { text: " jednu schůzku." } } });
    assert.equal(ev.model.at(-1), "Dnes máš jednu schůzku.");
    cb.onmessage({ serverContent: { turnComplete: true } });
    assert.equal(call.state, "speaking", "dokud audio hraje, poslouchat nezačne");
    call.ctx.currentTime = 5; await sleep(400);
    assert.equal(call.state, "listening");
    /* další otázka začíná od nuly */
    cb.onmessage({ serverContent: { inputTranscription: { text: "A zítra?" } } });
    assert.equal(ev.user.at(-1), "A zítra?");
    call.stop();
  },
  async "Live: bez přerušování se mikrofon při řeči modelu nepřeposílá, s přerušováním ano"() {
    for (const barge of [false, true]) {
      const { o, f } = callOpts({ bargeIn: barge });
      const call = new J.LiveCall(o); await call.start();
      const s = f.st.sessions[0], n0 = s.sent.length;
      call.onChunk(new Int16Array(512).buffer); assert.equal(s.sent.length, n0 + 1, "poslouchá");
      s.cb.onmessage({ serverContent: { modelTurn: { parts: [{ inlineData: pcmB64(2400) }] } } });
      call.onChunk(new Int16Array(512).buffer);
      assert.equal(s.sent.length, n0 + (barge ? 2 : 1), barge ? "s přerušováním jde mikrofon dál" : "při řeči modelu mikrofon mlčí");
      call.setMuted(true); call.onChunk(new Int16Array(512).buffer);
      assert.equal(s.sent.length, n0 + (barge ? 2 : 1), "ztlumený mikrofon nic neposílá");
      call.stop();
    }
  },
  async "Live: přerušení modelem i ručně (mezerník) ztiší přehrávání"() {
    const { o, f } = callOpts();
    const call = new J.LiveCall(o); await call.start();
    const cb = f.st.sessions[0].cb;
    cb.onmessage({ serverContent: { modelTurn: { parts: [{ inlineData: pcmB64(24000) }] } } });
    assert.equal(call.state, "speaking"); assert.equal(call.player.playing, true);
    cb.onmessage({ serverContent: { interrupted: true } });
    assert.equal(call.state, "listening"); assert.equal(call.player.playing, false);
    cb.onmessage({ serverContent: { modelTurn: { parts: [{ inlineData: pcmB64(24000) }] } } });
    call.interrupt(); assert.equal(call.state, "listening"); assert.equal(call.player.playing, false);
    cb.onmessage({ serverContent: { modelTurn: { parts: [{ inlineData: pcmB64(24000) }] } } });
    assert.equal(call.player.playing, false, "zbytek přerušené odpovědi se zahodí");
    cb.onmessage({ serverContent: { turnComplete: true } });
    cb.onmessage({ serverContent: { modelTurn: { parts: [{ inlineData: pcmB64(2400) }] } } });
    assert.equal(call.player.playing, true, "další odpověď už hraje");
    call.stop();
  },
  async "Live: volání nástrojů vrací odpovědi, výjimka nástroje nezabije hovor"() {
    let boom = false;
    const { o, f, ev } = callOpts({ onTools: async calls => { if (boom) throw new Error("kaboom"); return calls.map(c => ({ id: c.id, name: c.name, response: { output: { ok: true } } })); } });
    const call = new J.LiveCall(o); await call.start();
    const s = f.st.sessions[0];
    s.cb.onmessage({ toolCall: { functionCalls: [{ id: "1", name: "a", args: { x: 1 } }, { id: "2", name: "b" }] } });
    assert.equal(call.state, "thinking"); await sleep(10);
    assert.deepEqual(s.tools[0].functionResponses.map(r => r.id), ["1", "2"]);
    boom = true; s.cb.onmessage({ toolCall: { functionCalls: [{ id: "3", name: "c" }] } }); await sleep(10);
    assert.equal(s.tools[1].functionResponses[0].response.error, "kaboom");
    call.stop();
  },
  async "Live: goAway nebo spadlé spojení → navázání s uchovaným řízením, po vyčerpání pokusů hlášení"() {
    const { o, f, ev } = callOpts();
    const call = new J.LiveCall(o); await call.start();
    const s1 = f.st.sessions[0];
    s1.cb.onmessage({ sessionResumptionUpdate: { newHandle: "H1", resumable: true } });
    s1.cb.onmessage({ goAway: { timeLeft: "30s" } }); await sleep(20);
    assert.equal(f.st.sessions.length, 2); assert.equal(s1.closed, true);
    assert.equal(f.st.configs[1].config.sessionResumption.handle, "H1");
    assert.equal(call.state, "listening");
    /* staré spojení už nic nemění */
    s1.cb.onclose({ code: 1000 }); assert.equal(ev.closed.length, 0);
    /* nečekané zavření: dva pokusy, třetí už hlásí chybu */
    for (let i = 0; i < 2; i++) { const cur = f.st.sessions.at(-1); cur.cb.onclose({ code: 1006, reason: "" }); await sleep(20); }
    assert.equal(f.st.sessions.length, 4);
    f.st.sessions.at(-1).cb.onclose({ code: 1006, reason: "network" }); await sleep(20);
    assert.equal(ev.closed.length, 1); assert.equal(call.state, "closed");
  },
  async "Live: bez uchovaného řízení spadlé spojení hlásí hned; stop uvolní mikrofon a zvuk"() {
    const { o, f, ev, media } = callOpts();
    const call = new J.LiveCall(o); await call.start();
    f.st.sessions[0].cb.onclose({ code: 1011, reason: "RESOURCE_EXHAUSTED quota" }); await sleep(10);
    assert.match(ev.closed[0], /limit/); assert.equal(media.tracks[0].stopped, true); assert.equal(call.ctx.closed, true);
    assert.equal(call.state, "closed");
  },
  async "Live: po nečinnosti se hovor sám ukončí"() {
    const { o, ev } = callOpts({ idleMs: 30 });
    let idle = 0; o.onIdle = () => idle++;
    const call = new J.LiveCall(o); await call.start();
    call.lastAct = Date.now() - 100;
    await sleep(5200);
    assert.equal(idle, 1); assert.equal(call.state, "closed");
  },
  async "zkouška spojení: text, hlas i živý hovor přes skutečnou knihovnu"() {
    const realWS = globalThis.WebSocket; globalThis.WebSocket = FakeWS; FakeWS.all.length = 0; FakeWS.autoSetup = true;
    FakeWS.onSend = (ws, m) => { if (m.realtimeInput && m.realtimeInput.text) setTimeout(() => { ws.emit({ serverContent: { modelTurn: { parts: [{ inlineData: pcmB64(4800) }] } } }); ws.emit({ serverContent: { turnComplete: true } }); }, 5); };
    const log = fakeFetch(rec => /tts/.test(rec.url) ? { body: gen([{ inlineData: pcmB64(2400) }]) } : { body: gen([{ text: "Ahoj." }]) });
    const lines = [];
    try {
      const r = await J.selfTest({ key: "AIzaTESTKEYTESTKEYTESTKEY", sdk: async () => sdk, voice: "Leda" }, (ok, t) => lines.push((ok ? "✓ " : "✗ ") + t));
      assert.deepEqual([r.text, r.tts, r.live], [true, true, true]);
      assert.equal(lines.length, 3); assert.ok(lines.every(l => l.startsWith("✓")), lines.join("\n"));
      assert.match(lines[0], /gemini-3\.8-flash/); assert.match(lines[2], /gemini-3\.8-live/);
      assert.equal(FakeWS.all[0].sent[0].setup.model, "models/gemini-3.8-live");
      assert.equal(FakeWS.all[0].readyState, 3, "spojení se po zkoušce zavře");
    } finally { globalThis.WebSocket = realWS; globalThis.fetch = realFetch; FakeWS.onSend = null; }
  },
  async "zkouška spojení: neplatný klíč se ohlásí u všech tří částí"() {
    const realWS = globalThis.WebSocket; globalThis.WebSocket = FakeWS; FakeWS.all.length = 0; FakeWS.autoSetup = false;
    FakeWS.onSend = ws => setTimeout(() => ws.close(1007, "API key not valid. Please pass a valid API key."), 0);
    fakeFetch(() => ({ status: 400, body: { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } } }));
    const lines = [];
    try {
      const r = await J.selfTest({ key: "AIzaBAD" + "x".repeat(20), sdk: async () => sdk, voice: "Leda" }, (ok, t) => lines.push((ok ? "✓ " : "✗ ") + t));
      assert.deepEqual([r.text, r.tts, r.live], [false, false, false]);
      assert.ok(lines.length >= 3 && lines.every(l => l.startsWith("✗") && /Klíč Gemini není platný/.test(l)), lines.join("\n"));
    } finally { globalThis.WebSocket = realWS; globalThis.fetch = realFetch; FakeWS.autoSetup = true; FakeWS.onSend = null; }
  },
};

let ok = 0, bad = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { await fn(); ok++; console.log("✓ " + name); }
  catch (e) { bad++; console.log("✗ " + name + "\n    " + String(e && e.stack || e).split("\n").slice(0, 6).join("\n    ")); }
}
console.log(`\n${ok} prošlo, ${bad} selhalo`);
process.exit(bad ? 1 : 0);
