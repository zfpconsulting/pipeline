// Testy čisté logiky asistenta (assistant.js): párování jmen, kontrola času, plán akcí, MIME e-mail. Nepotřebují prohlížeč ani PP_KEY.
// Použití: node tests/assistant.run.mjs
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const A = createRequire(import.meta.url)("../assistant.js");

const L = (id, name, stage = "novy", extra = {}) => ({ id, name, stage, ...extra });
const leads = [L("1", "Jan Novák", "schuzka"), L("2", "Marie Svobodová", "kontaktovan"), L("3", "Ing. Petr Dvořák", "nabidka"), L("4", "Eva Černá", "novy", { phone: "777111222", email: "eva@example.com" })];
const NOW = new Date(2026, 9, 10, 16, 53);   /* so 10. 10. 2026 16:53 */

const tests = {
  "norm a words: diakritika, tituly, interpunkce"() {
    assert.equal(A.norm("  Příliš Žluťoučký, kůň! "), "prilis zlutoucky kun");
    assert.deepEqual(A.words("Ing. Mgr. Petr Dvořák, Ph.D."), ["petr", "dvorak"]);
  },
  "sim: stejné slovo, stejný základ, jiné"() {
    assert.equal(A.sim("novak", "novak"), 2);
    assert.equal(A.sim("novakem", "novak"), 1);
    assert.equal(A.sim("novakova", "novak"), 1);
    assert.equal(A.sim("svobodou", "svoboda"), 1);
    assert.equal(A.sim("novotny", "novak"), 0);
    assert.equal(A.sim("nov", "novak"), 0);
  },
  "resolveClient: přesná shoda"() {
    const r = A.resolveClient("Novák", leads);
    assert.equal(r.kind, "exact"); assert.equal(r.lead.id, "1");
    assert.equal(A.resolveClient("Jan Novák", leads).kind, "exact");
  },
  "resolveClient: skloňování a tituly"() {
    assert.equal(A.resolveClient("Novákem", leads).lead.id, "1");
    assert.equal(A.resolveClient("Marie Svobodová", leads).lead.id, "2");
    assert.equal(A.resolveClient("Petr Dvořák", leads).lead.id, "3");
    assert.equal(A.resolveClient("Dvořák", leads).lead.id, "3");
  },
  "resolveClient: jen podobné jméno je fuzzy (potvrdit)"() {
    const r = A.resolveClient("Nováková", leads);
    assert.equal(r.kind, "fuzzy"); assert.equal(r.lead.id, "1");
  },
  "resolveClient: jiné křestní jméno shodu vyloučí"() {
    assert.equal(A.resolveClient("Petr Novák", leads).kind, "none");
  },
  "resolveClient: víc Nováků = ambiguous, křestní jméno rozhodne"() {
    const two = [...leads, L("5", "Petr Novák", "probehla")];
    const r = A.resolveClient("Novák", two);
    assert.equal(r.kind, "ambiguous"); assert.deepEqual(r.candidates.map(c => c.id).sort(), ["1", "5"]);
    assert.equal(A.resolveClient("Petr Novák", two).lead.id, "5");
    assert.equal(A.resolveClient("Jan Novák", two).lead.id, "1");
  },
  "resolveClient: neznámý klient"() {
    assert.equal(A.resolveClient("Procházka", leads).kind, "none");
    assert.equal(A.resolveClient("", leads).kind, "none");
  },
  "parseLocal: platné a neplatné datum"() {
    const d = A.parseLocal("2026-10-14T17:00");
    assert.equal(d.getFullYear(), 2026); assert.equal(d.getMonth(), 9); assert.equal(d.getDate(), 14); assert.equal(d.getHours(), 17);
    assert.equal(A.parseLocal("2026-02-30T10:00"), null);
    assert.equal(A.parseLocal("2026-10-14T25:00"), null);
    assert.equal(A.parseLocal("ve středu v 17"), null);
    assert.equal(A.parseLocal(""), null);
  },
  "fmtWhen"() {
    assert.equal(A.fmtWhen(new Date(2026, 9, 14, 17, 0)), "st 14. 10. 17:00");
    assert.equal(A.fmtWhen(new Date(2026, 9, 5, 9, 5)), "po 5. 10. 09:05");
  },
  "checkMeeting: minulost, daleká budoucnost, neobvyklý čas, kolize"() {
    assert.equal(A.checkMeeting(new Date(2026, 9, 9, 10, 0), NOW, [], 60).problems.length, 1);
    assert.equal(A.checkMeeting(new Date(2028, 0, 1, 10, 0), NOW, [], 60).problems.length, 1);
    assert.equal(A.checkMeeting(new Date(2026, 9, 14, 17, 0), NOW, [], 60).warnings.length, 0);
    assert.match(A.checkMeeting(new Date(2026, 9, 14, 5, 0), NOW, [], 60).warnings[0], /Neobvyklý čas/);
    const clash = A.checkMeeting(new Date(2026, 9, 14, 17, 30), NOW, [{ start: new Date(2026, 9, 14, 17, 0).toISOString(), title: "VK: Král" }], 60);
    assert.match(clash.warnings[0], /VK: Král/);
    assert.equal(A.checkMeeting(new Date(2026, 9, 14, 19, 0), NOW, [{ start: new Date(2026, 9, 14, 17, 0).toISOString() }], 60).warnings.length, 0);
  },
  "normPhone, validEmail, hasPlaceholders"() {
    assert.equal(A.normPhone("777 111 222"), "+420777111222");
    assert.equal(A.normPhone("+420 777-111-222"), "+420777111222");
    assert.equal(A.normPhone("00421 900 123 456"), "+421900123456");
    assert.equal(A.normPhone("123"), "");
    assert.equal(A.normPhone("+49 170 1234567"), "");
    assert.ok(A.validEmail("a@b.cz")); assert.ok(!A.validEmail("a@b")); assert.ok(!A.validEmail("a b@c.cz")); assert.ok(!A.validEmail("a@b.cz,c@d.cz"));
    assert.ok(A.hasPlaceholders("v [čas]")); assert.ok(A.hasPlaceholders("[odkaz na Google Meet se generuje…]"));
    assert.ok(!A.hasPlaceholders("Dobrý den, potvrzuji schůzku ve středu 14. 10. v 17:00 (online)."));
  },
  "mimeEmail: hlavičky, UTF-8 předmět a tělo se dají dekódovat"() {
    const raw = A.mimeEmail({ to: "klient@example.com", subject: "Potvrzení online konzultace", body: "Dobrý den, pane Nováku,\nzde je odkaz: https://meet.google.com/abc-defg-hij", from: "vojtech@zfpa.cz" });
    assert.match(raw, /^[A-Za-z0-9_-]+$/);
    const msg = Buffer.from(raw, "base64url").toString("utf8");
    const [head, body] = msg.split("\r\n\r\n");
    assert.match(head, /^To: klient@example\.com\r\nFrom: vojtech@zfpa\.cz\r\nSubject: =\?UTF-8\?B\?/);
    assert.match(head, /Content-Transfer-Encoding: base64/);
    const subj = head.match(/Subject: ((?:=\?UTF-8\?B\?[^?]+\?=\r?\n? ?)+)/)[1];
    const decoded = subj.split(/\r\n /).map(w => Buffer.from(w.match(/=\?UTF-8\?B\?([^?]+)\?=/)[1], "base64").toString("utf8")).join("");
    assert.equal(decoded, "Potvrzení online konzultace");
    assert.equal(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8"), "Dobrý den, pane Nováku,\r\nzde je odkaz: https://meet.google.com/abc-defg-hij");
  },
  "mimeEmail: odmítne neplatného příjemce a nepustí vložení hlaviček"() {
    assert.throws(() => A.mimeEmail({ to: "špatně", subject: "x", body: "y" }));
    assert.throws(() => A.mimeEmail({ to: "a@b.cz\r\nBcc: x@y.cz", subject: "x", body: "y" }));
    const raw = A.mimeEmail({ to: "a@b.cz", subject: "Ahoj\r\nBcc: x@y.cz", body: "y" });
    const head = Buffer.from(raw, "base64url").toString("utf8").split("\r\n\r\n")[0];
    assert.doesNotMatch(head, /^Bcc:/m);
  },
  "pickTemplate: online bere šablonu s {meet}, osobní bez ní"() {
    const T = [
      { id: "potvrzeni", name: "Potvrzení schůzky", text: "Potvrzuji schůzku {den} {datum} {vcas}{kde}.\n{podpis}" },
      { id: "x1", name: "Potvrzení online konzultace", text: "Potvrzuji. Zde Vám zasílám odkaz pro připojení: {meet}.\n{podpis}" },
      { id: "zitra", name: "Připomenutí", text: "Zítra {vcas}" },
    ];
    assert.equal(A.pickTemplate(T, false).id, "potvrzeni");
    assert.equal(A.pickTemplate(T, true).id, "x1");
    /* jediná šablona „potvrzeni“ bez {meet} se vrací i pro online (volající pak pozná, že chybí odkaz) */
    assert.equal(A.pickTemplate([T[0], T[2]], true).id, "potvrzeni");
    /* jediná šablona s {meet} pro osobní schůzku: vrátí se, ale volající ji odmítne kvůli zbylé závorce */
    assert.equal(A.pickTemplate([T[1]], false).id, "x1");
    assert.equal(A.pickTemplate([], true), null);
  },
  "buildPlan: podpis + online schůzka ve středu → schůzka PŘED fází, jednoznačné = automatické"() {
    const res = { reply: "", actions: [
      { name: "set_stage", input: { client_name: "Novák", stage: "podpis" } },
      { name: "schedule_meeting", input: { client_name: "Novák", start: "2026-10-14T17:00", online: true, place: "", send_confirmation: true } },
    ] };
    const p = A.buildPlan(res, { leads, now: NOW, calEvents: [] });
    assert.deepEqual(p.steps.map(s => s.type), ["meeting", "stage"]);
    assert.equal(p.steps[0].lead.id, "1"); assert.equal(p.steps[0].online, true); assert.equal(p.steps[0].confirm, true);
    assert.equal(p.steps[1].stage, "podpis");
    assert.ok(A.runnable(p)); assert.ok(A.autoOk(p));
    assert.match(p.notes.join(" "), /bez produktů/);
    assert.deepEqual(p.steps.map(A.describeStep), ["Schůzka: Jan Novák · st 14. 10. 17:00 · online", "Jan Novák → fáze „Podpis“"]);
  },
  "buildPlan: neznámý klient u schůzky = nový lead, chce potvrzení klepnutím"() {
    const p = A.buildPlan({ actions: [{ name: "schedule_meeting", input: { client_name: "Procházka", start: "2026-10-14T17:00", online: false } }] }, { leads, now: NOW });
    assert.deepEqual(p.steps.map(s => s.type), ["add_lead", "meeting"]);
    assert.equal(p.steps[0].implicit, true); assert.equal(p.steps[1].newRef, p.steps[0]);
    assert.ok(A.runnable(p)); assert.ok(!A.autoOk(p));
  },
  "buildPlan: výslovný add_lead + schůzka se stejným jménem se spojí a může běžet automaticky"() {
    const p = A.buildPlan({ actions: [
      { name: "add_lead", input: { name: "Karel Král", phone: "777 123 456", email: "bad", source: "Doporučení" } },
      { name: "schedule_meeting", input: { client_name: "Král", start: "2026-10-15T10:00", online: false } },
    ] }, { leads, now: NOW });
    assert.deepEqual(p.steps.map(s => s.type), ["add_lead", "meeting"]);
    assert.equal(p.steps[0].phone, "+420777123456"); assert.equal(p.steps[0].email, "");
    assert.equal(p.steps[1].newRef, p.steps[0]);
  },
  "buildPlan: neznámý klient u změny fáze nebo zápisu = problém, nic se nezaloží"() {
    const p = A.buildPlan({ actions: [{ name: "set_stage", input: { client_name: "Procházka", stage: "lost" } }, { name: "add_note", input: { client_name: "Procházka", text: "nezvedl" } }] }, { leads, now: NOW });
    assert.equal(p.steps.length, 0); assert.equal(p.problems.length, 2); assert.ok(!A.runnable(p));
  },
  "buildPlan: víc Nováků – plán nejde provést, dokud nevybereš"() {
    const two = [...leads, L("5", "Petr Novák", "probehla")];
    const p = A.buildPlan({ actions: [{ name: "add_note", input: { client_name: "Novák", text: "nezvedl telefon" } }] }, { leads: two, now: NOW });
    assert.ok(!A.runnable(p)); assert.equal(A.unresolved(p).length, 1);
    A.pickLead(p, p.steps[0], two[4]);
    assert.ok(A.runnable(p)); assert.ok(!A.autoOk(p));   /* po ručním výběru se provádí až klepnutím */
    assert.equal(p.steps[0].lead.id, "5");
  },
  "buildPlan: schůzka v minulosti nebo v nesmyslném čase"() {
    const past = A.buildPlan({ actions: [{ name: "schedule_meeting", input: { client_name: "Novák", start: "2026-10-09T10:00", online: false } }] }, { leads, now: NOW });
    assert.ok(!A.runnable(past)); assert.match(past.problems[0], /v minulosti/);
    const bad = A.buildPlan({ actions: [{ name: "schedule_meeting", input: { client_name: "Novák", start: "středa", online: false } }] }, { leads, now: NOW });
    assert.ok(!A.runnable(bad));
    const odd = A.buildPlan({ actions: [{ name: "schedule_meeting", input: { client_name: "Novák", start: "2026-10-14T05:00", online: false } }] }, { leads, now: NOW });
    assert.ok(A.runnable(odd)); assert.ok(!A.autoOk(odd));   /* varování → jen po klepnutí */
  },
  "buildPlan: kolize v kalendáři vyžaduje klepnutí"() {
    const p = A.buildPlan({ actions: [{ name: "schedule_meeting", input: { client_name: "Novák", start: "2026-10-14T17:00", online: false } }] }, { leads, now: NOW, calEvents: [{ start: new Date(2026, 9, 14, 17, 15).toISOString(), title: "VK: Král" }] });
    assert.ok(A.runnable(p)); assert.ok(!A.autoOk(p));
  },
  "buildPlan: stejná schůzka už u klienta je (příkaz řečený dvakrát) → varování, nikdy automaticky"() {
    const when = new Date(2026, 9, 14, 17, 0);
    const have = [L("1", "Jan Novák", "schuzka", { meetings: [{ id: "e1", start: when.toISOString(), title: "VK: Novák" }] })];
    const act = { name: "schedule_meeting", input: { client_name: "Novák", start: "2026-10-14T17:00", online: true } };
    const p = A.buildPlan({ actions: [act] }, { leads: have, now: NOW, calEvents: [] });
    assert.ok(A.runnable(p)); assert.ok(!A.autoOk(p)); assert.match(p.warnings[0], /už schůzka v tu dobu je/);
    /* jiný čas téhož dne je v pořádku */
    const other = A.buildPlan({ actions: [{ ...act, input: { ...act.input, start: "2026-10-14T19:00" } }] }, { leads: have, now: NOW, calEvents: [] });
    assert.ok(A.autoOk(other));
    /* dvakrát totéž v jedné větě = jedna schůzka */
    const twice = A.buildPlan({ actions: [act, act] }, { leads, now: NOW, calEvents: [] });
    assert.equal(twice.steps.filter(s => s.type === "meeting").length, 1);
    const twiceNew = A.buildPlan({ actions: [{ ...act, input: { ...act.input, client_name: "Procházka" } }, { ...act, input: { ...act.input, client_name: "Procházka" } }] }, { leads, now: NOW, calEvents: [] });
    assert.equal(twiceNew.steps.filter(s => s.type === "meeting").length, 1); assert.equal(twiceNew.steps.filter(s => s.type === "add_lead").length, 1);
    /* ruční výběr z víc Nováků: kontrola proběhne až po výběru */
    const two = [...have, L("5", "Petr Novák", "probehla")];
    const amb = A.buildPlan({ actions: [act] }, { leads: two, now: NOW, calEvents: [] });
    assert.equal(amb.warnings.length, 0);
    A.pickLead(amb, amb.steps[0], two[0]);
    assert.match(amb.warnings[0], /už schůzka v tu dobu je/);
  },
  "buildPlan: změna fáze na tu samou se přeskočí, podepsaný nejde do Lost"() {
    const p = A.buildPlan({ actions: [{ name: "set_stage", input: { client_name: "Novák", stage: "schuzka" } }] }, { leads, now: NOW });
    assert.equal(p.steps.length, 0); assert.match(p.notes[0], /už ve fázi/);
    const signed = [L("9", "Karel Král", "podpis")];
    const q = A.buildPlan({ actions: [{ name: "set_stage", input: { client_name: "Král", stage: "lost" } }] }, { leads: signed, now: NOW });
    assert.ok(!A.runnable(q));
  },
  "buildPlan: fuzzy shoda a existující add_lead"() {
    const p = A.buildPlan({ actions: [{ name: "add_note", input: { client_name: "Nováková", text: "volala" } }] }, { leads, now: NOW });
    assert.equal(p.steps[0].kind, "fuzzy"); assert.ok(A.runnable(p)); assert.ok(!A.autoOk(p));
    const dup = A.buildPlan({ actions: [{ name: "add_lead", input: { name: "Jan Novák" } }] }, { leads, now: NOW });
    assert.equal(dup.steps.length, 0); assert.match(dup.warnings[0], /už v pipeline je/);
    const sim = A.buildPlan({ actions: [{ name: "add_lead", input: { name: "Nováková" } }] }, { leads, now: NOW });
    assert.equal(sim.steps.length, 1); assert.ok(!A.autoOk(sim));
  },
  "buildPlan: prázdná nebo rozbitá odpověď"() {
    assert.equal(A.buildPlan(null, { leads, now: NOW }).steps.length, 0);
    assert.equal(A.buildPlan({ reply: "Kdy to bylo?", actions: [] }, { leads, now: NOW }).reply, "Kdy to bylo?");
    assert.equal(A.buildPlan({ actions: [{ name: "smaž_vše", input: {} }, null] }, { leads, now: NOW }).steps.length, 0);
  },
};

let ok = 0, bad = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); ok++; console.log("✓ " + name); }
  catch (e) { bad++; console.log("✗ " + name + "\n    " + String(e && e.stack || e).split("\n").slice(0, 5).join("\n    ")); }
}
console.log(`\n${ok} prošlo, ${bad} selhalo`);
process.exit(bad ? 1 : 0);
