# Worker pro AI asistenta

Malý server (Cloudflare Worker, zdarma stačí), přes který appka mluví s Claude a posílá SMS.
Appka sama žádný server nemá, repozitář je veřejný, takže **klíče k AI ani k SMS nesmí být v appce** – jsou jen tady.

```
telefon (appka) ──► Worker ──► Anthropic (Claude)   převede větu na akce
                      └──────► Twilio (SMS)          volitelné
```

Co Worker dělá a nedělá:

- Z věty („podepsal jsem smlouvu s Novákem, online schůzka ve středu v 17“) udělá seznam akcí (`schedule_meeting`, `set_stage`, `add_lead`, `add_note`). **Nic neprovádí** – akce provede až appka u tebe v telefonu, stejnými funkcemi, jaké používáš ručně.
- Dostane **jen tu větu** (a časovou zónu). Seznam klientů, telefony ani e-maily se k AI neposílají; jména klientů v appce porovnává lokálně.
- Každé volání ověří přes Google: token musí být vydaný pro tuhle appku a e-mail musí být v `ALLOWED_EMAILS`. Kdokoli jiný dostane 401/403, takže ani znalost adresy Workeru nikomu nedá přístup k tvému klíči.
- CORS pustí jen adresy z `ALLOWED_ORIGINS`. Denní limity (`AI_DAILY_LIMIT`, `SMS_DAILY_LIMIT`) fungují, když přidáš KV (krok 5).

## Nasazení (jednorázově, asi 15 minut)

Potřebuješ účet na [cloudflare.com](https://dash.cloudflare.com/sign-up) (zdarma) a Node.js v počítači.

1. **Klíč k Claude.** Na [console.anthropic.com](https://console.anthropic.com) → *API keys* → vytvoř klíč a dobij pár dolarů kredit. Příkaz „podepsal jsem… schůzka ve středu“ vyjde na zlomky centu (model `claude-haiku-5-5`). Klíč nikomu neposílej a nedávej ho do gitu.
2. **Přihlášení a nasazení:**
   ```bash
   cd pipeline/worker
   npx wrangler login
   npx wrangler deploy
   ```
   Na konci se vypíše adresa typu `https://pipeline-asistent.<tvůj-účet>.workers.dev`.
3. **Tajné hodnoty** (každý příkaz se zeptá na hodnotu):
   ```bash
   npx wrangler secret put ANTHROPIC_API_KEY     # klíč z kroku 1
   npx wrangler secret put ALLOWED_EMAILS        # tvůj Google e-mail, ke kterému se přihlašuješ do appky (víc oddělíš čárkou)
   ```
   Bez `ALLOWED_EMAILS` Worker odmítá všechno (HTTP 503) – záměrně.
4. **Zapnutí v appce:** *Nastavení (✓ vpravo nahoře) → Asistent* → vlož adresu Workeru, zapni „Zapnout asistenta“. Pod adresou se ukáže, jestli Worker běží a co má nastavené. Pro e-maily klepni na „Povolit odesílání e-mailů z Gmailu“ (Google si vyžádá souhlas jen s odesíláním, pošta se nečte). Pokud Google souhlas odmítne, přidej v Google Cloud Console → *Google Auth platform / OAuth consent screen* → *Data access* scope `https://www.googleapis.com/auth/gmail.send` a zkontroluj, že tvůj účet je mezi testovacími uživateli (když je appka v režimu Testing).
5. **Denní limity (doporučeno):**
   ```bash
   npx wrangler kv namespace create LIMITS
   ```
   Vypsané `id` vlož do `wrangler.toml` místo odkomentovaného bloku `[[kv_namespaces]]` a znovu `npx wrangler deploy`. Bez KV limity neplatí (Worker je pořád chráněný přihlášením).

## SMS (volitelné)

Z webové appky (PWA) se SMS poslat nedá – iPhone to webu nedovolí. Automatické SMS tedy potřebují SMS bránu. Worker umí **Twilio**:

```bash
npx wrangler secret put TWILIO_SID
npx wrangler secret put TWILIO_TOKEN
npx wrangler secret put TWILIO_FROM     # odesílatel: číslo z Twilia nebo textové jméno (např. Kudlicka)
```

- SMS z Twilia se platí za kus (aktuální ceník pro ČR: twilio.com/sms/pricing/cz) a **odpověď klienta ti nedojde** (u textového odesílatele vůbec, u čísla jen do Twilia). Potvrzení se tedy hodí jako informace, ne jako dialog.
- Posílá se jen na čísla +420 / +421, maximálně 480 znaků, denní limit `SMS_DAILY_LIMIT` (30).
- **Napojení na Twilio není ověřené naostro** – ověř jednou SMS na vlastní číslo, než se na to spolehneš (v appce: nová schůzka s klientem, kterému jsi dal své číslo).
- Bez Twilia appka u každé schůzky nabídne ruční odeslání přes Zprávy (jako dosud) a automaticky pošle jen e-mail u online schůzek.

## Test a ladění

```bash
cd pipeline/worker && npm test            # 11 testů bez sítě
curl https://<adresa-workeru>/health      # {"ok":true,"ai":true,"sms":false}
npx wrangler tail                         # živý log chyb
```

`/health` neukazuje žádné tajné hodnoty, jen jestli jsou nastavené.

## Úpravy

- Chování AI (pravidla, co znamená „ve středu“, jak psát jména) je v `systemPrompt()` v `src/index.js`. Po změně `npm test` a `npx wrangler deploy`.
- Přidání nové akce = nový nástroj v `TOOLS` + jeho ošetření v `cleanAction()` + provedení v `assistant.js` (`buildPlan`, `execute`). Worker nikdy nepřijme akci, kterou nezná.
- Jiný model: proměnná `MODEL` v `wrangler.toml`.
