# Excel dashboard and programmed macroareas

Version: excel-report-1.0.0 — 2026-09-30.

## User workflow
From the PC application, sign in as an administrator, open Report & export, choose date/client filters, and click **Esporta Excel con dashboard**.

The workbook has four sheets:
- Dashboard: approved GON logo, filter/period header, hours/activity/client/pending counters, horizontal macroarea chart and type-hours doughnut chart.
- Attivita: complete filtered rows with formatted dates/numeric hours, alternating bands, filters, frozen headers, origin, completion state and original measured timer hours.
- Macroaree: counts, hours, Cantiere/Viaggio/Ufficio breakdown, share and hours still needing details.
- Clienti: the equivalent client-level breakdown.

Incomplete timer records are INCLUDED in totals and explicitly flagged. Their original measured duration is not overwritten by reporting-hour corrections.

The two added categories are kept distinct from the original categories:
- Rilievo in campo - PROGRAMMATO
- Elaborazione rilievo - PROGRAMMATA

No historical category is renamed and no existing activity is reclassified automatically. The labels classify recorded work; they do not introduce forecasts or change the meaning of existing records.

## Implementation
- macroareas.json is the build-time canonical list for the main PC/mobile forms, personal-history editor, timer-detail editor and Excel export.
- report_integration.py runs after existing timer/history integration; strict marker counts and Node syntax checks prevent a partial build.
- excel_template.py uses openpyxl and Pillow ONLY at build time to generate a data-free OOXML template. It extracts the real embedded .logo image from the current application. Missing logo fails the build.
- Dependencies are installed into an isolated temporary build directory only when absent: openpyxl 3.1.5 and Pillow 12.0.0. No new web service is created.
- The browser creates the XLSX package locally using native XML/Blob/ZIP APIs. No business data is sent to a third-party export provider.
- Derived workbook values are formulas with numeric caches; native Excel charts include category/value caches. The workbook requests recalculation when opened.
- The export fetches authenticated data in pages of 500, preserving the initial filter snapshot. It rejects incomplete/changing counts and duplicate rows instead of silently exporting only the first page. Limit: 50,000 rows per file.
- Strings are literal cells, not spreadsheet formulas. Client grouping uses equality comparisons, including names containing *, ? and ~.
- Export remains PC/Admin-only. Existing RLS and ownership rules are unchanged.

## Database
supabase/20260930_programmed_macroareas.sql extends only the existing whitelist in private.gon_update_my_entry and public.gon_complete_timer. It preserves their existing authentication, ownership, conflict and validation logic.

## Checks performed
- Real database tests with ROLLBACK: both categories accepted on manual INSERT, own-history edit and timer completion; invalid category rejected. No test rows retained.
- Chromium with simulated authentication/database: new export button, 501 records over two pages, stable filters despite UI change during fetch, normal User denied before activity query, no-data error.
- Generated workbook: ZIP CRCs, all XML parts, four sheets, two native charts, logo anchors, dates, literal formula-like descriptions and cached totals checked with openpyxl.
- Numeric formula caches independently recalculated; four sheets visually rendered and inspected with fixture data. Includes empty-data model and one-second timer precision tests.
- These checks are not a signed-in end-to-end run in the user's desktop Excel installation.

## References
https://openpyxl.readthedocs.io/en/latest/charts/doughnut.html
https://openpyxl.readthedocs.io/en/stable/styles.html
https://developer.mozilla.org/en-US/docs/Web/API/DOMParser
https://developer.mozilla.org/en-US/docs/Web/API/XMLSerializer
