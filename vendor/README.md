# Knihovny pro náhled souborů (docs.js)

Načítají se líně – až když si v detailu klienta otevřeš soubor daného typu. Do repozitáře jsou zkopírované z npm beze změn (min. verze).

| Soubor | Balíček | Verze | Licence | K čemu |
|---|---|---|---|---|
| pdf.min.mjs, pdf.worker.min.mjs (**legacy** build) | pdfjs-dist | 6.4.299 | Apache-2.0 | náhled PDF |
| mammoth.browser.min.js | mammoth | 1.13.0 | BSD-2-Clause | náhled Wordu (.docx) |
| read-excel-file.min.js | read-excel-file | 9.3.10 | MIT | náhled Excelu (.xlsx) |

Aktualizace: `npm i pdfjs-dist mammoth read-excel-file` a zkopírovat stejné soubory z `node_modules` (pdfjs-dist/**legacy**/build, mammoth, read-excel-file/bundle).

PDF používá záměrně *legacy* build: standardní verze 6.x potřebuje velmi novou funkci prohlížeče (`Map.getOrInsertComputed`) a na starším iPhonu / Safari by náhled PDF nefungoval.
