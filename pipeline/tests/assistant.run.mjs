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
  /* ---------- lokální porozumění češtině ---------- */
  "understand: hlavní scénář – podpis + online schůzka ve středu v 17h → bez klepnutí"() {
    for (const t of ["Podepsal jsem smlouvu s Dvořákem a domluvil jsem si s ním online schůzku ve středu v 17h",
      "podepsal jsem smlouvu s dvorakem a domluvil si s nim online schuzku na stredu v 17h",
      "Dvořák podepsal smlouvu, online schůzka ve středu v 17:00", "domluvil jsem online schůzku s Dvořákem na středu v 17 hodin a podepsal smlouvu"]) {
      const r = A.understand(t, { now: NOW, leads }), p = A.buildPlan(r, { leads, now: NOW, calEvents: [] });
      assert.deepEqual(r.actions.map(a => a.name).sort(), ["schedule_meeting", "set_stage"], t);
      const m = r.actions.find(a => a.name === "schedule_meeting").input;
      assert.equal(m.start, "2026-10-14T17:00", t); assert.equal(m.online, true, t); assert.equal(m.client_name, "Dvořák", t);
      assert.equal(r.actions.find(a => a.name === "set_stage").input.stage, "podpis", t);
      assert.ok(A.autoOk(p), "auto: " + t); assert.deepEqual(p.steps.map(x => x.type), ["meeting", "stage"], t);
    }
  },
  "understand: hodiny – půl páté, čtvrt na čtyři, tři čtvrtě na pět, 14.30, v pět, poledne, odpoledne"() {
    const at = (t, want, extra = {}) => { const r = A.understand(t, { now: NOW, leads }); const m = r.actions.find(a => a.name === "schedule_meeting"); assert.ok(m, t + " → " + r.reply); assert.equal(m.input.start, want, t); return r; };
    at("schůzka s Dvořákem ve čtvrtek v půl páté", "2026-10-15T16:30");
    at("schůzka s Dvořákem ve čtvrtek ve čtvrt na čtyři", "2026-10-15T15:15");
    at("schůzka s Dvořákem ve čtvrtek ve tři čtvrtě na pět", "2026-10-15T16:45");
    at("schůzka s Dvořákem ve čtvrtek ve 14.30", "2026-10-15T14:30");
    at("schůzka s Dvořákem ve čtvrtek v pět", "2026-10-15T17:00");
    at("schůzka s Dvořákem ve čtvrtek v 10", "2026-10-15T10:00");
    at("schůzka s Dvořákem ve čtvrtek v poledne", "2026-10-15T12:00");
    at("schůzka s Dvořákem ve čtvrtek v 6 večer", "2026-10-15T18:00");
    at("schůzka s Dvořákem ve čtvrtek v 9 dopoledne", "2026-10-15T09:00");
    at("schůzka s Dvořákem ve čtvrtek ve 14 hodin", "2026-10-15T14:00");
    at("schůzka s Dvořákem ve čtvrtek 17:45", "2026-10-15T17:45");
    const eight = A.understand("schůzka s Dvořákem ve čtvrtek v 8", { now: NOW, leads });   /* 8 = ráno nebo večer? → ptá se (varování) */
    assert.match(eight.warnings.join(" "), /19:00|20:00/); assert.ok(!A.autoOk(A.buildPlan(eight, { leads, now: NOW })));
  },
  "understand: data – zítra, pozítří, za týden, 14. října, 20.10.2026, příští pátek, stejný den týdne"() {
    const at = (t, want) => { const r = A.understand(t, { now: NOW, leads }); const m = r.actions.find(a => a.name === "schedule_meeting"); assert.ok(m, t + " → " + r.reply); assert.equal(m.input.start, want, t); return r; };
    at("schůzka s Dvořákem zítra v 9:00", "2026-10-11T09:00");
    at("schůzka s Dvořákem pozítří v 9:00", "2026-10-12T09:00");
    at("schůzka s Dvořákem za týden v 9:00", "2026-10-17T09:00");
    at("schůzka s Dvořákem za 3 dny v 9:00", "2026-10-13T09:00");
    at("schůzka s Dvořákem 14. října v 17:00", "2026-10-14T17:00");
    at("schůzka s Dvořákem 20.10.2026 v 18 hodin", "2026-10-20T18:00");
    at("schůzka s Dvořákem 3. 1. v 10:00", "2027-01-03T10:00");   /* leden už byl → příští rok */
    at("schůzka s Dvořákem příští pátek v 10", "2026-10-16T10:00");
    at("schůzka s Dvořákem příští týden v pondělí v 10", "2026-10-12T10:00");
    at("schůzka s Dvořákem v pondělí v 10", "2026-10-12T10:00");
    const sat = at("schůzka s Dvořákem v sobotu v 10", "2026-10-17T10:00");   /* dnes je sobota → za týden + varování */
    assert.match(sat.warnings.join(" "), /taky sobota/);
    const mis = at("schůzka s Dvořákem ve čtvrtek 14. října v 17:00", "2026-10-14T17:00");   /* 14. 10. je středa */
    assert.match(mis.warnings.join(" "), /není čtvrtek/);
  },
  "understand: chybí den nebo hodina → ptá se a nic neprovede automaticky"() {
    const noTime = A.understand("schůzka s Dvořákem ve středu", { now: NOW, leads });
    assert.equal(noTime.actions.length, 0); assert.match(noTime.reply, /hodina/); assert.match(noTime.reply, /14\. 10\./);
    const noDay = A.understand("schůzka s Dvořákem v 17:00", { now: NOW, leads });
    assert.equal(noDay.actions.length, 0); assert.match(noDay.reply, /den/);
    const noClient = A.understand("domluvil jsem schůzku ve středu v 17", { now: NOW, leads });
    assert.equal(noClient.actions.length, 0); assert.match(noClient.reply, /jméno klienta/);
    const part = A.understand("Podepsal jsem smlouvu s Dvořákem a domluvil schůzku ve středu", { now: NOW, leads });
    assert.deepEqual(part.actions.map(a => a.name), ["set_stage"]); assert.ok(!A.autoOk(A.buildPlan(part, { leads, now: NOW })));   /* nic se nespustí samo, když chybí část příkazu */
  },
  "understand: jména – skloňování, křestní jméno, víc Nováků, jiné křestní jméno, nový klient, titul"() {
    const two = [...leads, L("5", "Petr Novák", "probehla")];
    const nm = (t, ls = leads) => A.understand(t, { now: NOW, leads: ls }).actions[0].input.client_name;
    assert.equal(nm("schůzka s Novákem ve středu v 17"), "Novák");
    assert.equal(nm("schůzka s Janem Novákem ve středu v 17", two), "Jan Novák");
    assert.equal(nm("schůzka s Petrem Novákem ve středu v 17", two), "Petr Novák");
    assert.ok(!A.autoOk(A.buildPlan(A.understand("schůzka s Novákem ve středu v 17", { now: NOW, leads: two }), { leads: two, now: NOW })), "dva Novákové → vybrat");
    assert.equal(nm("schůzka s Marií Svobodovou ve středu v 17"), "Marie Svobodová");
    /* jiné křestní jméno než u kontaktu = někdo další → nový kontakt, ne Eva Černá */
    const lu = A.buildPlan(A.understand("schůzka s Lucií Černou v pátek v 10", { now: NOW, leads }), { leads, now: NOW });
    assert.deepEqual(lu.steps.map(x => x.type), ["add_lead", "meeting"]); assert.ok(!A.autoOk(lu));
    /* nový klient: základní tvar jména se odhadne, titul se zahodí */
    const nw = (t) => A.buildPlan(A.understand(t, { now: NOW, leads }), { leads, now: NOW }).steps[0].name;
    assert.equal(nw("schůzka s Procházkou ve středu v 17"), "Procházka");
    assert.equal(nw("schůzka s Hanou Procházkovou ve středu v 17"), "Hana Procházková");
    assert.equal(nw("schůzka s Ing. Zemanem ve středu v 17"), "Zeman");
    assert.equal(nw("schůzka s Janem Novotným ve středu v 17"), "Jan Novotný");
    assert.equal(nw("schůzka s Karlem Jelínkem ve středu v 17".replace("Jelínkem", "Hrubým")), "Karel Hrubý");
    assert.equal(A.nominative("Jelínkem"), "Jelínek"); assert.equal(A.nominative("Svobodovou"), "Svobodová"); assert.equal(A.nominative("Novákovi"), "Novák");
    /* místo ve větě není jméno */
    assert.equal(nw("schůzka s Procházkou ve středu v 17 v Brně"), "Procházka");
    /* dva různí klienti ve větě → po jednom */
    const multi = A.understand("schůzka s Dvořákem a Černou ve středu v 17", { now: NOW, leads });
    assert.equal(multi.actions.length, 0); assert.match(multi.reply, /po jednom/);
  },
  "understand: místo, online, osobně"() {
    const g = t => A.understand(t, { now: NOW, leads }).actions.find(a => a.name === "schedule_meeting").input;
    assert.equal(g("schůzka s Dvořákem ve středu v 17 v Brně").place, "v Brně");
    assert.equal(g("schůzka s Dvořákem ve středu v 17 u klienta doma").place, "u klienta doma");
    assert.deepEqual([g("schůzka s Dvořákem ve středu v 17 online").online, g("schůzka s Dvořákem ve středu v 17 přes video").online, g("schůzka s Dvořákem ve středu v 17").online], [true, true, false]);
    assert.equal(g("schůzka s Dvořákem ve středu v 17 online v Brně").place, "");
  },
  "understand: fáze – nabídka, schůzka proběhla, podepsáno jen v minulém čase, Lost a Zamrzlý chtějí klepnutí"() {
    const st = (t, ls = leads) => { const r = A.understand(t, { now: NOW, leads: ls }); return r.actions.filter(a => a.name === "set_stage").map(a => a.input.stage); };
    const kral = [...leads, L("8", "Karel Král", "kontaktovan")];
    assert.deepEqual(st("Poslal jsem Královi nabídku", kral), ["nabidka"]);
    assert.deepEqual(st("Odeslal jsem nabídku Královi", kral), ["nabidka"]);
    assert.deepEqual(st("Měli jsme schůzku s Králem", kral), ["probehla"]);
    assert.deepEqual(st("Byl jsem na schůzce s Králem", kral), ["probehla"]);
    assert.deepEqual(st("Král podepsal smlouvu", kral), ["podpis"]);
    assert.deepEqual(st("Král chce podepsat smlouvu příští týden", kral), []);
    assert.deepEqual(st("Král nepodepsal smlouvu", kral), []);
    assert.deepEqual(st("Podepsal jsem smlouvu na schůzce s Králem", kral), ["podpis"]);
    for (const [t, stage] of [["Král nemá zájem", "lost"], ["Král odložil rozhodnutí", "zamrzly"], ["Královi byla vyplacena provize", "vyplaceno"]]) {
      const r = A.understand(t, { now: NOW, leads: kral }), p = A.buildPlan(r, { leads: kral, now: NOW });
      assert.equal(r.actions[0].input.stage, stage, t); assert.ok(A.runnable(p) && !A.autoOk(p), "klepnutí: " + t);
    }
    /* podepsal bez schůzky nezakládá schůzku */
    assert.ok(!A.understand("Podepsal jsem smlouvu s Dvořákem", { now: NOW, leads }).actions.some(a => a.name === "schedule_meeting"));
    /* zpětný skok: „volal jsem“ u klienta, který je dál než Nový lead, fázi nemění */
    assert.deepEqual(st("Volal jsem Dvořákovi, nezvedl"), []);
    assert.deepEqual(st("Volal jsem Černé, nezvedla"), ["kontaktovan"]);   /* Eva Černá je Nový lead */
  },
  "understand: zápis, nový kontakt, telefon a e-mail se nepletou s časem"() {
    const n = A.understand("Poznámka k Dvořákovi: chce zvýšit pojistku na 5 000 Kč", { now: NOW, leads }).actions[0];
    assert.deepEqual(n, { name: "add_note", input: { client_name: "Dvořák", text: "chce zvýšit pojistku na 5 000 Kč" } });
    assert.equal(A.understand("zapiš si u Dvořáka že volal", { now: NOW, leads }).actions[0].input.text, "že volal");
    assert.match(A.understand("poznámka k Dvořákovi", { now: NOW, leads }).reply, /text zápisu/);
    const a = A.understand("Nový kontakt Jan Kolář 777 123 456 doporučení", { now: NOW, leads }).actions[0];
    assert.deepEqual(a, { name: "add_lead", input: { name: "Jan Kolář", phone: "+420777123456", email: "", source: "Doporučení" } });
    const b = A.understand("Přidej kontakt Marek Veselý, marek.vesely@seznam.cz, cold call", { now: NOW, leads }).actions[0].input;
    assert.deepEqual([b.name, b.email, b.source], ["Marek Veselý", "marek.vesely@seznam.cz", "Cold call"]);
    /* nový kontakt a hned schůzka: jedno jméno, žádné zdvojení */
    const c = A.buildPlan(A.understand("Nový kontakt Karel Král 777123456, schůzka s ním v pátek v 10", { now: NOW, leads }), { leads, now: NOW });
    assert.deepEqual(c.steps.map(x => x.type), ["add_lead", "meeting"]); assert.equal(c.steps[1].newRef, c.steps[0]);
    /* telefon uprostřed věty neukradne hodinu */
    const d = A.understand("schůzka s Dvořákem ve středu v 17, telefon 777 123 456", { now: NOW, leads }).actions[0].input;
    assert.equal(d.start, "2026-10-14T17:00");
  },
  "understand: nesmysl a prázdno nic neprovedou, pomůžou příkladem"() {
    for (const t of ["", "   "]) assert.equal(A.understand(t, { now: NOW, leads }).actions.length, 0);
    const r = A.understand("Jak se dneska máš?", { now: NOW, leads });
    assert.equal(r.actions.length, 0); assert.match(r.reply, /Nerozuměla jsem/);
    const only = A.understand("Dvořák", { now: NOW, leads });
    assert.equal(only.actions.length, 0); assert.match(only.reply, /Dvořák/);
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
  "buildPlan: telefon a e-mail k existujícímu klientovi (to, co dřív nešlo)"() {
    const p = A.buildPlan({ actions: [{ name: "update_client", input: { client_name: "Jan Novák", phone: "777 123 456", email: "novak@firma.cz" } }] }, { leads, now: NOW });
    assert.equal(p.steps.length, 1); assert.equal(p.steps[0].type, "update");
    assert.deepEqual(p.steps[0].patch, { phone: "+420777123456", email: "novak@firma.cz" });
    assert.ok(A.runnable(p) && A.autoOk(p), "doplnění prázdných údajů se provede samo po odpočtu");
    assert.match(A.describeStep(p.steps[0]), /telefon → \+420777123456/);
    const over = A.buildPlan({ actions: [{ name: "update_client", input: { client_name: "Eva Černá", phone: "602 111 222" } }] }, { leads, now: NOW });
    assert.match(over.warnings.join(" "), /už je telefon 777111222/); assert.ok(!A.autoOk(over), "přepsání telefonu chce klepnutí");
    const same = A.buildPlan({ actions: [{ name: "update_client", input: { client_name: "Eva Černá", phone: "777 111 222" } }] }, { leads, now: NOW });
    assert.equal(same.steps.length, 0); assert.match(same.notes.join(" "), /už tenhle telefon má/);
    const bad = A.buildPlan({ actions: [{ name: "update_client", input: { client_name: "Jan Novák", phone: "12345", email: "bez-zavinace" } }] }, { leads, now: NOW });
    assert.equal(bad.steps.length, 0); assert.ok(bad.problems.length >= 1 && !A.runnable(bad));
    const src = A.buildPlan({ actions: [{ name: "update_client", input: { client_name: "Jan Novák", source: "doporučení", referred_by: "Eva Černá" } }] }, { leads, now: NOW });
    assert.equal(src.steps[0].patch.source, "Doporučení"); assert.equal(src.steps[0].patch.referredBy, "Eva Černá");
    assert.equal(A.buildPlan({ actions: [{ name: "update_client", input: { client_name: "Zeman Karel", phone: "777123456" } }] }, { leads, now: NOW }).steps.length, 0, "neexistující klient se tichou úpravou nezaloží");
  },
  "buildPlan: další krok, hovor, úkol a odškrtnutí úkolu"() {
    const tasks = [{ id: "t1", text: "Zavolat bance", client: "", due: "2026-10-10" }, { id: "t2", text: "Poslat podklady Černé", client: "Eva Černá", due: "" }];
    const p = A.buildPlan({ actions: [
      { name: "log_call", input: { client_name: "Eva Černá", result: "no_answer" } },
      { name: "set_next_step", input: { client_name: "Eva Černá", step: "Zavolat", date: "2026-10-15" } },
      { name: "add_task", input: { text: "Připravit nabídku", client_name: "Jan Novák", due: "2026-10-16" } },
      { name: "complete_task", input: { task_text: "zavolat bance" } },
    ] }, { leads, now: NOW, tasks });
    assert.deepEqual(p.steps.map(s => s.type), ["call", "next", "task", "task_done"], "pořadí: hovor (naplánuje další pokus) a až potom výslovně řečený další krok, úkoly na konci");
    assert.deepEqual(p.steps[1].patch, { nextStep: "Zavolat", nextDate: "2026-10-15" });
    assert.equal(p.steps[0].result, "no_answer"); assert.equal(p.steps[2].client, "Jan Novák"); assert.equal(p.steps[3].task.id, "t1");
    assert.ok(A.runnable(p));
    const past = A.buildPlan({ actions: [{ name: "set_next_step", input: { client_name: "Eva Černá", date: "2026-10-01" } }] }, { leads, now: NOW });
    assert.match(past.problems.join(" "), /v minulosti/);
    const dup = A.buildPlan({ actions: [{ name: "add_task", input: { text: "zavolat bance" } }] }, { leads, now: NOW, tasks });
    assert.equal(dup.steps.length, 0); assert.match(dup.notes.join(" "), /už v seznamu je/);
    const none = A.buildPlan({ actions: [{ name: "complete_task", input: { task_text: "koupit slona" } }] }, { leads, now: NOW, tasks });
    assert.match(none.problems.join(" "), /nemám/);
    for (const st of p.steps) assert.ok(A.describeStep(st).length > 5);
  },
  "checkMeeting: schůzka trvá 45 minut, kolize jen v tomhle okně"() {
    const ev = [{ start: new Date(2026, 9, 14, 17, 0).toISOString(), title: "VK: Test" }];
    assert.equal(A.checkMeeting(new Date(2026, 9, 14, 17, 40), NOW, ev, 45).warnings.length, 1, "17:40 se s 17:00 (do 17:45) potkává");
    assert.equal(A.checkMeeting(new Date(2026, 9, 14, 17, 45), NOW, ev, 45).warnings.length, 0, "17:45 už je volné");
    assert.equal(A.checkMeeting(new Date(2026, 9, 14, 17, 50), NOW, ev, 60).warnings.length, 1, "u starých 60 minut by kolidovalo");
  },
  "buildPlan: prázdná nebo rozbitá odpověď"() {
    assert.equal(A.buildPlan(null, { leads, now: NOW }).steps.length, 0);
    assert.equal(A.buildPlan({ reply: "Kdy to bylo?", actions: [] }, { leads, now: NOW }).reply, "Kdy to bylo?");
    assert.equal(A.buildPlan({ actions: [{ name: "smaž_vše", input: {} }, null] }, { leads, now: NOW }).steps.length, 0);
  },

  "příkaz z hlasu: „S paní Šikulovou jsem domluvený na schůzku 1.11. v 15h“"() {
    const ls = [...leads, L("8", "Eva Šikulová", "kontaktovan")];
    for (const t of ["S paní Šikulovou jsem domluvený na schůzku 1.11. v 15h", "S paní Šikulovou jsem domluvená na schůzku 1. 11. v 15h", "S paní Šikulovou mám schůzku 1.11. v 15h"]) {
      const r = A.understand(t, { leads: ls, now: NOW });
      assert.equal(r.query, undefined, t);
      assert.equal(r.actions.length, 1, t);
      assert.deepEqual(r.actions[0].input, { client_name: "Šikulová", start: "2026-11-01T15:00", online: false, place: "", send_confirmation: true }, t);
    }
  },
  "dotazy: úkoly, schůzky, výsledky se poznají a nejsou to příkazy"() {
    const q = t => A.understand(t, { leads, now: NOW });
    assert.deepEqual(q("Co mám dneska v úkolech").query, { kind: "tasks", day: "today", client: "" });
    assert.equal(q("Co mám dneska v úkolech").actions.length, 0);
    assert.equal(q("Jaké jsou moje aktuální výsledky").query.kind, "results");
    assert.equal(q("Řekni mi, jak na tom jsem").query.kind, "results");
    assert.equal(q("Kolik mám bodů").query.kind, "results");
    assert.deepEqual(q("Co mám zítra v kalendáři").query, { kind: "meetings", day: "tomorrow", client: "" });
    assert.deepEqual(q("Kdy mám schůzku s Novákem").query, { kind: "meetings", day: "next", client: "Novák" });
    assert.equal(q("Kolik mám schůzek tento týden").query.day, "week");
    assert.equal(q("Jaké mám schůzky příští týden").query.day, "nextweek");
    assert.equal(q("Jaké mám schůzky 1.11.").query.day, "2026-11-01");
    assert.equal(q("Komu mám dneska zavolat").query.kind, "calls");
    assert.equal(q("Co mám dneska").query.kind, "agenda");
    assert.equal(q("Co mám dneska v úkolech a v kalendáři").query.kind, "agenda");
  },
  "dotazy se nepletou s příkazy a běžnou řečí"() {
    const q = t => A.understand(t, { leads, now: NOW });
    const m = q("Mám zítra schůzku s Novákem v 15");
    assert.equal(m.query, undefined); assert.equal(m.actions[0].name, "schedule_meeting");
    assert.equal(q("Domluvil jsem schůzku s Novákem na zítra v 10").query, undefined);
    assert.equal(q("Podepsal jsem smlouvu s Novákem").query, undefined);
    assert.equal(q("Poznámka k Novákovi: chce vědět výsledky").query, undefined);
    const x = q("Jak se máš"); assert.equal(x.query, undefined); assert.match(x.reply, /Nerozuměla jsem/);
  },
  "answerQuery: úkoly a telefonáty na dnešek, česky a se správnými tvary"() {
    const F = { today: "2026-10-10", tasks: [{ text: "Marcinčákovi call schůzku", client: "Marcinčák", due: "2026-10-05" }, { text: "Poslat podklady", client: "", due: "2026-10-10" }, { text: "Zítřejší věc", due: "2026-10-11" }, { text: "Bez termínu", due: "" }],
      calls: [{ name: "Veronika Kudličková", date: "2026-10-10" }, { name: "Aleš Pospíšil", date: "2026-10-08" }, { name: "Jan Novák", date: "" }, { name: "Eva Černá", date: "2026-10-12" }], meets: [] };
    const a = A.answerQuery({ kind: "tasks", day: "today", client: "" }, F, NOW);
    const t = a.lines.join(" ");
    assert.match(t, /Dnes máš 2 úkoly: Marcinčákovi call schůzku, po termínu od 5\. října; Poslat podklady\./);
    assert.ok(!/Zítřejší/.test(t), "zítřejší úkol tu být nemá");
    assert.match(t, /Bez termínu máš ještě 1 otevřený úkol\./);
    assert.match(t, /K telefonování: Veronika Kudličková a Aleš Pospíšil\./);
    assert.ok(!/Eva Černá|Jan Novák/.test(t));
    const c = A.answerQuery({ kind: "calls", day: "today", client: "" }, F, NOW).lines.join(" ");
    assert.equal(c, "Dnes zavolej: Veronika Kudličková a Aleš Pospíšil.");
    assert.equal(A.answerQuery({ kind: "tasks", day: "tomorrow", client: "" }, F, NOW).lines[0], "Zítra máš 1 úkol: Zítřejší věc.");
    const last = A.answerQuery({ kind: "tasks", day: "today", client: "" }, { tasks: [{ text: "Marcinčákovi call", due: "2026-10-05" }], calls: [{ name: "Ing. Aleš Pospíšil", date: "2026-10-08" }, { name: "Veronika Kudličková, MBA", date: "2026-10-10" }], meets: [] }, NOW);
    assert.equal(last.lines[0], "Dnes máš 1 úkol: Marcinčákovi call, po termínu od 5. října.", "bez dvou teček na konci");
    assert.match(last.speak, /K telefonování: Aleš Pospíšil a Veronika Kudličková\./, "tituly se nečtou: " + last.speak);
    assert.match(last.lines[1], /Ing\. Aleš Pospíšil/, "v textu zůstanou");
    assert.equal(A.answerQuery({ kind: "tasks", day: "today", client: "" }, { today: "2026-10-10", tasks: [], calls: [], meets: [] }, NOW).lines[0], "Dnes nemáš žádné úkoly (ani po termínu).");
  },
  "answerQuery: schůzky – dnes zbývající, konkrétní klient, týden"() {
    const at = (dd, hh, mm = 0) => new Date(2026, 9, dd, hh, mm).toISOString();
    const F = { meets: [{ name: "Ranní Klient", start: at(10, 9) }, { name: "Jan Novák", start: at(10, 19), online: true }, { name: "Marie Svobodová", start: at(14, 14, 30) }, { name: "Jan Novák", start: at(20, 8) }] };
    assert.equal(A.answerQuery({ kind: "meetings", day: "today", client: "" }, F, NOW).lines[0], "Dnes ještě máš 1 schůzku: Jan Novák, v 19 hodin, online.");
    assert.equal(A.answerQuery({ kind: "meetings", day: "today", client: "" }, { meets: [F.meets[0]] }, NOW).lines[0], "Dnešní schůzky už proběhly.");
    assert.equal(A.answerQuery({ kind: "meetings", day: "tomorrow", client: "" }, F, NOW).lines[0], "Zítra nemáš žádnou schůzku.");
    assert.equal(A.answerQuery({ kind: "meetings", day: "week", client: "" }, F, NOW).lines[0], "Tento týden máš 1 schůzku: Jan Novák, dnes v 19 hodin, online.");
    assert.equal(A.answerQuery({ kind: "meetings", day: "nextweek", client: "" }, F, NOW).lines[0], "Příští týden máš 1 schůzku: Marie Svobodová, ve středu 14. října ve 14 hodin 30 minut.");
    assert.equal(A.answerQuery({ kind: "meetings", day: "next", client: "Novák" }, F, NOW).lines[0], "Novák má 2 schůzky: dnes v 19 hodin, online a v úterý 20. října v 8 hodin.");
    assert.equal(A.answerQuery({ kind: "meetings", day: "next", client: "Černá" }, F, NOW).lines[0], "Černá: žádná budoucí schůzka v kalendáři.");
  },
  "answerQuery: výsledky – čtvrtletí, sazba, chybějící body; do řeči bez mezer v číslech"() {
    const F = { quarter: { label: "4. Q 2026", pts: 162.4, kc: 24365, rate: 150, nextRate: 160, nextTier: "P5", need: 535, perWeek: 41.2, days: 82 }, month: { pts: 100 }, pipe: { active: 10, meetings: 6, pts: 811.9, ptsKc: 121785, late: 0 } };
    const a = A.answerQuery({ kind: "results", day: "today", client: "" }, F, NOW);
    const nb = x => x.replace(/\u00a0/g, " ");
    assert.equal(nb(a.lines[0]), "Ve 4. čtvrtletí 2026 máš 162,4 bodu, to je asi 24 365 korun při sazbě 150 korun za bod.");
    assert.match(nb(a.lines[1]), /Do vyšší sazby 160 korun \(P5\) ti chybí 535 bodů, zhruba 41,2 bodu týdně, zbývá 82 dní\./);
    assert.match(nb(a.lines.join(" ")), /V jednání je 811,9 bodu, zhruba 121 785 korun\. Rozjednaných leadů máš 10, domluvených schůzek 6/);
    assert.match(a.speak, /24365 korun/); assert.ok(!/ /.test(a.speak), "v řeči žádné pevné mezery");
    assert.match(A.answerQuery({ kind: "results", day: "today", client: "" }, { pipe: F.pipe }, NOW).lines[0], /Čtvrtletní body se teď nepodařilo načíst/);
    assert.match(A.answerQuery({ kind: "results" }, null, NOW).lines[0], /nedostanu/);
  },
  "spokenPlan / spokenDone: co řekne hlas"() {
    const ls = [...leads, L("8", "Eva Šikulová", "kontaktovan", { phone: "777333444" })];
    const plan = A.buildPlan(A.understand("S paní Šikulovou jsem domluvený na schůzku 1.11. v 15h", { leads: ls, now: NOW }), { leads: ls, now: NOW });
    assert.equal(A.spokenPlan(plan, NOW, 10, true), "Schůzka: Eva Šikulová, v neděli 1. listopadu v 15 hodin, osobně. Provedu to za 10 sekund, nebo klepni na Zrušit.");
    assert.equal(A.spokenPlan(plan, NOW, 0, true), "Schůzka: Eva Šikulová, v neděli 1. listopadu v 15 hodin, osobně.");
    assert.match(A.spokenPlan(plan, NOW, 0, false), /Zkontroluj to a klepni na Provést\.$/);
    const odd = A.buildPlan(A.understand("Nová schůzka s Novákem v pondělí v 7", { leads, now: NOW }), { leads, now: NOW });
    assert.match(A.spokenPlan(odd, NOW, 0, false), /Pozor: /);
    assert.equal(A.spokenDone({ lines: ["✓ Schůzka"], smsJobs: [{}], manuals: [] }), "Hotovo. SMS je připravená, klepni na Odeslat.");
    assert.equal(A.spokenDone({ lines: ["✗ Schůzka – chyba"], smsJobs: [], manuals: [{}] }), "Něco se nepovedlo, koukni na výpis. Potvrzení musíš poslat ručně.");
    assert.equal(A.spokenClock(new Date(2026, 9, 10, 14, 5)), "ve 14 hodin 5 minut");
    assert.equal(A.spokenClock(new Date(2026, 9, 10, 17, 30)), "v 17 hodin 30 minut");
    assert.equal(A.spokenClock(new Date(2026, 9, 10, 3, 0)), "ve 3 hodiny");
  },
  "pickVoice: český ženský hlas dopředu, bez českého žádný"() {
    const V = (name, lang, extra = {}) => ({ name, lang, voiceURI: name, ...extra });
    const vs = [V("Daniel", "en-GB"), V("Jakub", "cs-CZ"), V("Zuzana", "cs-CZ"), V("Zuzana (Enhanced)", "cs-CZ"), V("Samantha", "en-US")];
    assert.equal(A.pickVoice(vs, "").name, "Zuzana (Enhanced)");
    assert.equal(A.pickVoice(vs.filter(v => !/Enhanced/.test(v.name)), "").name, "Zuzana");
    assert.equal(A.pickVoice([V("Microsoft Antonin Online (Natural)", "cs-CZ"), V("Microsoft Vlasta Online (Natural)", "cs-CZ")], "").name, "Microsoft Vlasta Online (Natural)");
    assert.equal(A.pickVoice(vs, "Jakub").name, "Jakub", "vlastní volba má přednost");
    assert.equal(A.pickVoice([V("Daniel", "en-GB")], ""), null);
    assert.equal(A.pickVoice([], ""), null);
    assert.equal(A.pickVoice([V("Alena", "cs_CZ")], "").name, "Alena");
  },
};

let ok = 0, bad = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); ok++; console.log("✓ " + name); }
  catch (e) { bad++; console.log("✗ " + name + "\n    " + String(e && e.stack || e).split("\n").slice(0, 5).join("\n    ")); }
}
console.log(`\n${ok} prošlo, ${bad} selhalo`);
process.exit(bad ? 1 : 0);
