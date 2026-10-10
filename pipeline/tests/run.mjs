// Spustí všechny testy appky v Chromiu. Použití: PP_KEY=XXXXX-XXXXX-XXXXX-XXXXX node tests/run.mjs [filtr]
import { loadPlaywright, startServer } from "./helpers.mjs";
import tests from "./app.test.mjs";

const key = process.env.PP_KEY;
if (!key) {
  const msg = "Chybí PP_KEY (přístupový kód k provizní příloze) – bez něj appka nenaběhne, testy přeskakuji.";
  console.log(process.env.GITHUB_ACTIONS ? `::warning::${msg} Přidej ho v GitHubu: Settings → Secrets and variables → Actions → New repository secret „PP_KEY“.` : msg);
  process.exit(0);
}
const filter = process.argv[2] || "";
const { chromium } = await loadPlaywright();
const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
const { srv, url } = await startServer();
const env = { browser, url, key };
let ok = 0, bad = 0;
for (const [name, fn] of Object.entries(tests)) {
  if (filter && !name.includes(filter)) continue;
  const t0 = Date.now();
  try { await fn(env); ok++; console.log(`✓ ${name} (${Date.now() - t0} ms)`); }
  catch (e) { bad++; console.log(`✗ ${name}\n    ${String(e && e.stack || e).split("\n").slice(0, +process.env.BT_LINES || 4).join("\n    ")}`); }
}
await browser.close(); srv.close();
console.log(`\n${ok} prošlo, ${bad} selhalo`);
process.exit(bad ? 1 : 0);
