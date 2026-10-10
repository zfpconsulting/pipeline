import test from "node:test";
import assert from "node:assert/strict";
import worker, { cleanAction, systemPrompt } from "../src/index.js";

const CLIENT = "client-id.apps.googleusercontent.com";
const ORIGIN = "https://zfpconsulting.github.io";
const baseEnv = () => ({
  ALLOWED_ORIGINS: ORIGIN + ",https://kudla2002.github.io",
  GOOGLE_CLIENT_ID: CLIENT,
  ALLOWED_EMAILS: "Vojta@Example.com",
  ANTHROPIC_API_KEY: "sk-test",
});

/* podvržený fetch: zaznamenává volání a odpovídá podle URL */
function mockFetch(handlers) {
  const calls = [];
  globalThis.fetch = async (url, opt = {}) => {
    calls.push({ url: String(url), opt });
    for (const [re, fn] of handlers) if (re.test(String(url))) return fn(String(url), opt);
    throw new Error("nečekané volání " + url);
  };
  return calls;
}
const jres = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
const google = (over = {}) => [/tokeninfo/, () => jres({ azp: CLIENT, email: "vojta@example.com", email_verified: "true", expires_in: "3000", ...over })];
const req = (path, body, { token = "t".repeat(30), origin = ORIGIN, method = "POST" } = {}) =>
  new Request("https://w.example" + path, { method, headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}), ...(token ? { Authorization: "Bearer " + token } : {}) }, body: method === "POST" ? JSON.stringify(body) : undefined });
let tokenN = 0;
const fresh = () => "tok" + String(++tokenN).padStart(3, "0") + "x".repeat(25);   /* každý test jiný token, ať nezasahuje cache */

test("health: bez přihlášení, ukazuje co je nastavené", async () => {
  const r = await worker.fetch(new Request("https://w.example/health", { method: "GET", headers: { Origin: ORIGIN } }), baseEnv());
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, ai: true, sms: false });
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), ORIGIN);
});

test("preflight: povolený původ projde, cizí ne", async () => {
  const ok = await worker.fetch(new Request("https://w.example/ai", { method: "OPTIONS", headers: { Origin: ORIGIN } }), baseEnv());
  assert.equal(ok.status, 204);
  const bad = await worker.fetch(new Request("https://w.example/ai", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }), baseEnv());
  assert.equal(bad.status, 403);
});

test("cizí původ dostane 403 ještě před ověřením tokenu", async () => {
  const calls = mockFetch([google()]);
  const r = await worker.fetch(req("/ai", { utterance: "x" }, { origin: "https://evil.example", token: fresh() }), baseEnv());
  assert.equal(r.status, 403);
  assert.equal(calls.length, 0);
});

test("bez ALLOWED_EMAILS Worker odmítá všechno (503)", async () => {
  mockFetch([google()]);
  const env = baseEnv(); delete env.ALLOWED_EMAILS;
  const r = await worker.fetch(req("/ai", { utterance: "x" }, { token: fresh() }), env);
  assert.equal(r.status, 503);
});

test("bez tokenu 401; token pro jinou appku 401; cizí účet 403", async () => {
  mockFetch([google()]);
  assert.equal((await worker.fetch(req("/ai", { utterance: "x" }, { token: null }), baseEnv())).status, 401);
  mockFetch([google({ azp: "jiny-klient" })]);
  assert.equal((await worker.fetch(req("/ai", { utterance: "x" }, { token: fresh() }), baseEnv())).status, 401);
  mockFetch([google({ email: "cizi@example.com" })]);
  assert.equal((await worker.fetch(req("/ai", { utterance: "x" }, { token: fresh() }), baseEnv())).status, 403);
  mockFetch([google({ email_verified: "false" })]);
  assert.equal((await worker.fetch(req("/ai", { utterance: "x" }, { token: fresh() }), baseEnv())).status, 401);
});

test("/ai: pošle do Claude systémový prompt s kalendářem a vrátí očištěné akce", async () => {
  const calls = mockFetch([google(), [/api\.anthropic\.com/, () => jres({ content: [
    { type: "text", text: "Hotovo." },
    { type: "tool_use", name: "set_stage", input: { client_name: " Novák ", stage: "podpis" } },
    { type: "tool_use", name: "schedule_meeting", input: { client_name: "Novák", start: "2026-10-14T17:00", online: true } },
    { type: "tool_use", name: "schedule_meeting", input: { client_name: "Novák", start: "ve středu", online: true } },   /* špatný formát → zahodit */
    { type: "tool_use", name: "set_stage", input: { client_name: "Novák", stage: "smazat" } },                          /* neplatná fáze → zahodit */
    { type: "tool_use", name: "delete_everything", input: {} },                                                         /* neznámý nástroj → zahodit */
  ] })]]);
  const r = await worker.fetch(req("/ai", { utterance: "Podepsal jsem smlouvu s Novákem a domluvili jsme online schůzku ve středu v 17h", tz: "Europe/Prague" }, { token: fresh() }), baseEnv());
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.equal(out.reply, "Hotovo.");
  assert.deepEqual(out.actions, [
    { name: "set_stage", input: { client_name: "Novák", stage: "podpis" } },
    { name: "schedule_meeting", input: { client_name: "Novák", start: "2026-10-14T17:00", online: true, place: "", send_confirmation: true } },
  ]);
  const a = calls.find(c => /anthropic/.test(c.url));
  assert.equal(a.opt.headers["x-api-key"], "sk-test");
  const body = JSON.parse(a.opt.body);
  assert.equal(body.model, "claude-haiku-5-5");
  assert.equal(body.temperature, 0);
  assert.equal(body.messages[0].content, "Podepsal jsem smlouvu s Novákem a domluvili jsme online schůzku ve středu v 17h");
  assert.match(body.system, /\d{4}-\d{2}-\d{2} (pondělí|úterý|středa|čtvrtek|pátek|sobota|neděle) \(dnes\)/);
  assert.deepEqual(body.tools.map(t => t.name), ["schedule_meeting", "set_stage", "add_lead", "add_note"]);
});

test("/ai: bez klíče 503, prázdný příkaz 400, limit 429", async () => {
  mockFetch([google()]);
  const env = baseEnv(); delete env.ANTHROPIC_API_KEY;
  assert.equal((await worker.fetch(req("/ai", { utterance: "ahoj" }, { token: fresh() }), env)).status, 503);
  assert.equal((await worker.fetch(req("/ai", { utterance: "   " }, { token: fresh() }), baseEnv())).status, 400);

  const kv = new Map();
  const env2 = { ...baseEnv(), AI_DAILY_LIMIT: "2", LIMITS: { get: async k => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v) } } };
  mockFetch([google(), [/anthropic/, () => jres({ content: [{ type: "text", text: "ok" }] })]]);
  const tok = fresh();
  assert.equal((await worker.fetch(req("/ai", { utterance: "a" }, { token: tok }), env2)).status, 200);
  assert.equal((await worker.fetch(req("/ai", { utterance: "b" }, { token: tok }), env2)).status, 200);
  assert.equal((await worker.fetch(req("/ai", { utterance: "c" }, { token: tok }), env2)).status, 429);
});

test("/ai: chyba Anthropicu se přeloží na 502 a nic neuniká", async () => {
  mockFetch([google(), [/anthropic/, () => jres({ error: { message: "tajná zpráva" } }, 500)]]);
  const r = await worker.fetch(req("/ai", { utterance: "ahoj" }, { token: fresh() }), baseEnv());
  assert.equal(r.status, 502);
  assert.doesNotMatch(await r.text(), /tajná/);
});

test("/sms: nenastavená brána 503; špatné číslo 400; platná SMS jde přes Twilio", async () => {
  mockFetch([google()]);
  assert.equal((await worker.fetch(req("/sms", { to: "+420777111222", text: "Ahoj" }, { token: fresh() }), baseEnv())).status, 503);

  const env = { ...baseEnv(), TWILIO_SID: "ACxxx", TWILIO_TOKEN: "tok", TWILIO_FROM: "Kudlicka" };
  const calls = mockFetch([google(), [/api\.twilio\.com/, () => jres({ sid: "SM1" }, 201)]]);
  assert.equal((await worker.fetch(req("/sms", { to: "+49123456789", text: "Ahoj" }, { token: fresh() }), env)).status, 400);
  assert.equal((await worker.fetch(req("/sms", { to: "+420777111222", text: "" }, { token: fresh() }), env)).status, 400);
  const r = await worker.fetch(req("/sms", { to: "+420 777 111 222", text: "Dobrý den, potvrzuji schůzku." }, { token: fresh() }), env);
  assert.equal(r.status, 200);
  const t = calls.find(c => /twilio/.test(c.url));
  assert.match(t.url, /Accounts\/ACxxx\/Messages\.json$/);
  assert.equal(t.opt.headers.Authorization, "Basic " + btoa("ACxxx:tok"));
  const f = new URLSearchParams(String(t.opt.body));
  assert.equal(f.get("To"), "+420777111222");
  assert.equal(f.get("From"), "Kudlicka");
  assert.equal(f.get("Body"), "Dobrý den, potvrzuji schůzku.");
});

test("systemPrompt: správný den v týdnu a kalendář", () => {
  const p = systemPrompt({ y: 2026, m: 10, d: 10, h: 16, min: 53, tz: "Europe/Prague" });
  assert.match(p, /Teď je sobota 2026-10-10, 16:53/);
  assert.match(p, /2026-10-14 středa/);
  assert.match(p, /2026-10-11 neděle \(zítra\)/);
});

test("cleanAction: ořezává a odmítá nesmysly", () => {
  assert.equal(cleanAction("add_lead", { name: "  " }), null);
  assert.deepEqual(cleanAction("add_lead", { name: "Jan Novák", source: "Facebook" }).input.source, "");
  assert.equal(cleanAction("add_note", { client_name: "Novák", text: "" }), null);
  assert.equal(cleanAction("schedule_meeting", { client_name: "Novák", start: "2026-10-14T17:00" }).input.online, false);
});
