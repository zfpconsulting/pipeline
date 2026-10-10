# Knihovny třetích stran

Načítají se líně – až když je potřeba (soubor v detailu klienta, chytrý asistent). Do repozitáře jsou zkopírované z npm (min. verze).

| Soubor | Balíček | Verze | Licence | K čemu |
|---|---|---|---|---|
| pdf.min.mjs, pdf.worker.min.mjs (**legacy** build) | pdfjs-dist | 6.4.299 | Apache-2.0 | náhled PDF |
| mammoth.browser.min.js | mammoth | 1.13.0 | BSD-2-Clause | náhled Wordu (.docx) |
| read-excel-file.min.js | read-excel-file | 9.3.10 | MIT | náhled Excelu (.xlsx) |
| genai.min.mjs | @google/genai (oficiální knihovna Googlu, web build; zabalená esbuildem i s p-retry a retry) | 2.28.0 | Apache-2.0 (+ MIT) | chytrý asistent: Gemini Live, nástroje, hlas (jarvis.js) |

Aktualizace: `npm i pdfjs-dist mammoth read-excel-file` a zkopírovat stejné soubory z `node_modules` (pdfjs-dist/**legacy**/build, mammoth, read-excel-file/bundle).

PDF používá záměrně *legacy* build: standardní verze 6.x potřebuje velmi novou funkci prohlížeče (`Map.getOrInsertComputed`) a na starším iPhonu / Safari by náhled PDF nefungoval.

## genai.min.mjs (chytrý asistent)

Sestavení: `npm i @google/genai@2.28.0 esbuild`, soubor `entry.mjs` s jediným řádkem
`export { GoogleGenAI, Modality, Type, ThinkingLevel, FunctionResponseScheduling, ApiError } from "@google/genai/web";`
a `esbuild entry.mjs --bundle --minify --format=esm --target=es2020 --legal-comments=eof --platform=browser --outfile=genai.min.mjs`.
Licence všech zabalených částí je v `LICENSE.genai.txt`. Knihovna se stahuje až při prvním použití chytrého asistenta (`import()` v jarvis.js).
