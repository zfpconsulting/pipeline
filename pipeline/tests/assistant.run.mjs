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
    assert.equal(r.actions.length, 0); assert.match(r.reply, /Nerozuměl jsem/);
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
