// Vygeneruje ikony appky z loga ZFP (stejné logo jako vodoznak kalkulačky – bere se přímo z fincalc.js).
// Použití: node tools/make-icons.mjs        (potřebuje Playwright + Chromium, viz tests/helpers.mjs)
//
// Pravidla, proč jsou ikony takhle:
//  • apple-touch-icon.png a icon-192/512.png jsou ČTVERCE přes celou plochu BEZ průhlednosti (RGB). iOS i Android si
//    rohy zaoblí samy; kdyby byly zaoblené předem, iOS by průhledné rohy vyplnil černě.
//  • icon-maskable.png má logo menší (bezpečná zóna), protože ho systém ořízne do kruhu / squircle.
//  • favicon-48.png je zaoblený (průhledné rohy) a ukazuje jen „ZFP“ + vlajku – „CONSULTING“ by v záložce byl nečitelný.
import { writeFileSync, readFileSync } from "node:fs";
import { deflateSync, inflateSync, crc32 } from "node:zlib";
import { fileURLToPath } from "node:url";
import { loadPlaywright, ROOT } from "../tests/helpers.mjs";

const BG = ["#ffffff", "#eceef1"];           // jemný přechod shora dolů (jako nativní ikony)
const RADIUS = 0.2237;                       // poloměr zaoblení iOS ikon (podíl strany)

/* RGBA PNG → RGB PNG (zahodí alfa kanál; plocha je beztak celá krytá) */
function stripAlpha(png) {
  let off = 8, w = 0, h = 0; const idat = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off), type = png.toString("ascii", off + 4, off + 8), data = png.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); if (data[8] !== 8) throw new Error("čekám 8 bit"); if (data[9] === 2) return png; /* už je RGB */ if (data[9] !== 6) throw new Error("čekám RGB nebo RGBA"); }
    if (type === "IDAT") idat.push(data);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), bpp = 4, stride = w * bpp, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), cur = px.subarray(y * stride, (y + 1) * stride), up = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = up ? up[i] : 0, c = up && i >= bpp ? up[i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
  }
  const out = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) { out[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) out[y * (w * 3 + 1) + 1 + x * 3 + k] = px[y * stride + x * 4 + k]; }
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, "ascii"); d.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + d.length)) >>> 0, 8 + d.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([png.subarray(0, 8), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(out, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
const page = await browser.newPage();
await page.setContent("<!doctype html><body></body>");
await page.addScriptTag({ path: ROOT + "fincalc.js" });
const [LW, LH] = await page.evaluate(() => [FinCalc.logo.w, FinCalc.logo.h]);

/* kind: square = celá plocha | round = zaoblená, průhledné rohy | favicon = zaoblená jen ZFP + vlajka */
const SPEC = [
  { file: "apple-touch-icon.png", size: 180, kind: "square", w: .70 },
  { file: "icon-192.png", size: 192, kind: "square", w: .70 },
  { file: "icon-512.png", size: 512, kind: "square", w: .70 },
  { file: "icon-maskable.png", size: 512, kind: "square", w: .56 },
  { file: "favicon-48.png", size: 48, kind: "favicon", w: .86 },
];
for (const sp of SPEC) {
  const S = 1024, crop = sp.kind === "favicon", lh = crop ? 96 : LH, k = sp.w * S / LW, x = (S - LW * k) / 2, y = (S - lh * k) / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sp.size}" height="${sp.size}" viewBox="0 0 ${S} ${S}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BG[0]}"/><stop offset="1" stop-color="${BG[1]}"/></linearGradient>
    <clipPath id="c"><rect width="${S}" height="${S}" rx="${sp.kind === "favicon" ? S * RADIUS : 0}"/></clipPath>
    <clipPath id="l"><rect x="-2" y="-2" width="${LW + 4}" height="${crop ? 98 : LH + 4}"/></clipPath></defs>
    <g clip-path="url(#c)"><rect width="${S}" height="${S}" fill="url(#g)"/>
    <g transform="translate(${x} ${y}) scale(${k})"><g clip-path="url(#l)">__LOGO__</g></g></g></svg>`;
  const logo = await page.evaluate(() => FinCalc.logo.svg());
  await page.setViewportSize({ width: sp.size, height: sp.size });
  await page.setContent(`<!doctype html><body style="margin:0;background:transparent">${svg.replace("__LOGO__", logo)}</body>`);
  let png = await page.screenshot({ omitBackground: true, type: "png" });
  if (sp.kind === "square") png = stripAlpha(png);
  writeFileSync(ROOT + sp.file, png);
  console.log(sp.file, sp.size + "×" + sp.size, png.length + " B", sp.kind);
}
await browser.close();
