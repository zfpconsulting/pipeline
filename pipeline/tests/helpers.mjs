// Pomocné funkce pro testy v prohlížeči (Playwright + Chromium).
// Spuštění: PP_KEY=… node tests/run.mjs   (PP_KEY = přístupový kód k provizní příloze; bez něj appka nenaběhne)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const ADMIN = "kudlicka.vojtech2002@gmail.com";

export async function loadPlaywright() {
  try { return await import("playwright"); }
  catch { return await import(process.env.PLAYWRIGHT_MODULE || "/opt/node22/lib/node_modules/playwright/index.mjs"); }
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".jpg": "image/jpeg" };
export function startServer() {
  return new Promise(res => {
    const srv = createServer(async (req, rsp) => {
      try {
        let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
        if (p.endsWith("/")) p += "index.html";
        const f = normalize(join(ROOT, p));
        if (!f.startsWith(ROOT)) throw 0;
        const body = await readFile(f);
        rsp.writeHead(200, { "Content-Type": TYPES[extname(f)] || "application/octet-stream" }); rsp.end(body);
      } catch { rsp.writeHead(404); rsp.end("not found"); }
    });
    srv.listen(0, "127.0.0.1", () => res({ srv, url: `http://localhost:${srv.address().port}/index.html` }));
  });
}

export class AssertionError extends Error {}
export function assert(cond, msg) { if (!cond) throw new AssertionError(msg); }
const canon = v => JSON.stringify(v, (k, x) => x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : a > b)) : x);
export function eq(a, b, msg) { if (canon(a) !== canon(b)) throw new AssertionError(`${msg}: čekáno ${canon(b)}, je ${canon(a)}`); }

/* nová stránka s přihlášeným (fiktivně) adminem, bez sítě ke Googlu; store = počáteční data appky */
export async function openApp(env, { store = null, width = 430, height = 900, extra = null } = {}) {
  const ctx = await env.browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const hb = [];
  await ctx.route(/script\.google\.com/, r => { const d = r.request().postData() || ""; if (/"t":"hb"/.test(d)) hb.push(JSON.parse(d)); return r.fulfill({ status: 200, contentType: "application/json", body: '{"status":"aktivní","list":[]}' }); });
  await ctx.route(/googleapis\.com|frankfurter|accounts\.google/, r => r.abort());
  await ctx.addInitScript(([key, admin, store, extra]) => {
    if (sessionStorage.getItem("t_init")) return; sessionStorage.setItem("t_init", "1");
    localStorage.setItem("g_owner", JSON.stringify(admin));
    localStorage.setItem("acc", JSON.stringify({ st: "aktivní", email: admin, at: Date.now() }));
    localStorage.setItem("pp_key", key);
    localStorage.setItem("today_seen", JSON.stringify(new Date().toISOString().slice(0, 10)));
    if (store) localStorage.setItem("crm_store_v1", JSON.stringify({ docs: store }));
    if (extra) for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
  }, [env.key, ADMIN, store, extra]);
  await page.goto(env.url);
  await page.waitForFunction(() => typeof setView === "function" && typeof LStore !== "undefined", null, { timeout: 15000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelectorAll("dialog[open]").forEach(d => d.close()));
  return { ctx, page, errors, hb };
}
