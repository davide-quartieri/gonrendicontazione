# Proforma v3

This additive release implements the five requested changes. It is not an SdI/electronic invoicing service.

## Workflow

The administrator opens `Rendiconti / Proforma`, selects the billing customer, then uses `Anagrafica completa cliente` and `Condizioni economiche`. Gedit retains one legal profile and one billing customer for the two operational sites.

New reports use snapshot schema `proforma_schema: 3`. Existing draft reports are NOT silently changed. `Aggiorna bozza a proforma con Cassa` explicitly rereads activity/rates and replaces line-level commercial overrides. Existing issued documents keep the old renderer and stored values; a revision is required for changes.

Customer legal data is versioned and stored privately. Fields: legal name, VAT number, tax code, address, postcode, city, province, country, PEC, destination code, email, phone, contact, payment terms. A report stores a copy, not a live lookup. `Aggiorna anagrafica nella bozza` refreshes only that copy and leaves money unchanged. Minimum identity/address fields and VAT number or tax code are required before a v3 report can be issued. No real tax identifiers were invented.

## Cassa

Requested default: 5%, editable by admin per customer and on a draft. The base can include or exclude taxable expenses via an explicit checkbox. Monetary calculations occur in PostgreSQL numeric arithmetic:

- net services = sum of rounded line amounts minus rounded discount;
- net = net services + expenses;
- Cassa = round(selected base * Cassa percent / 100, 2);
- IVA taxable = net + Cassa;
- IVA = round(IVA taxable * IVA percent / 100, 2);
- gross = IVA taxable + IVA.

This is a configured calculation, not a legal determination of a particular operation. Old snapshots without `cassa_rate` keep their old calculation. Missing prices and missing IVA stay unknown rather than becoming zero.

## Daily document

Ordinary hourly economic rows are split by actual activity entry, carrying date, site and performed description. Monthly forfaits stay a single quote for the month, with underlying daily activities shown separately. A confirmed two-technician intervention is one economic row. Raw operator-hours are preserved in the daily detail table, not double billed.

The printable HTML/PDF and economic XLSX identify `FATTURA PROFORMA` and `Documento non valido ai fini fiscali`. XLSX retains cached values and formulas, including Cassa and IVA. Existing document numbering is unchanged and is not fiscal invoice numbering. PDF saving remains the browser print workflow; no automatic email transmission is added.

## Two technicians

Candidates use the same date, operational site (not just billing group), macroarea, normalized description and exactly two distinct recorded operator labels. This uses recorded employee labels, since an administrator may record both technicians under their account. User confirmation is required; names do not provide a definitive identity system.

The administrator confirms half day (450 EUR) or full day (900 EUR), excluding Cassa and IVA. No four/eight-hour threshold is invented. Identical-looking but separate work can be kept hourly with a reason. Different descriptions can be grouped using the explicit multi-select, with server checks for date/site/macroarea/two workers. No cross-site Gedit merging. Overlapping selections, unknown entries and additional billing over existing monthly/programmed forfaits are rejected.

Applying/removing a team decision rebuilds the economic lines and replaces line overrides, after explicit confirmation. The original activity records never change. Pending detected groups block issue. Standard report/unit claims remain in effect to prevent duplicate billing.

## Macroareas

`Nuova macroarea` is admin-only. The name, allowed rate types and hourly/monthly mode are configurable. PROGRAMMATO-style names require forfait mode. Existing builtins retain the user's approved 11 rate combinations. Creation does not assign a tariff to every customer; administrators must configure customer prices.

The shared catalog feeds manual PC/mobile entry, own-history editing, timer completion and rate editing without replacing in-flight select values. Existing Excel grouping already includes macroareas found in activity rows and dynamically sizes native chart ranges. Renaming/removing categories is not part of this first release.

## Database and isolation

The production migrations were applied through the Supabase connector, with successful names:
`proforma_v3_catalog_profiles_cassa`, `proforma_v3_daily_candidates`, `proforma_v3_team_pricing`, `proforma_v3_admin_workflow`, `proforma_v3_catalog_fail_closed`.

The three `20260930_proforma_v3_[abc]_*.sql` files consolidate the applied source for a matching pre-v3 database; do not reapply them to production. Failed attempts were rolled back. RLS protects the public read-only macroarea catalog and private legal profiles. Authenticated GON users can list categories; only administrators can create categories or access financial/profile endpoints. NULL catalog actions fail closed. No service keys are shipped in the frontend.

## Verified scope

- PostgreSQL pure calculation: 2695 + Cassa 134.75 = IVA base 2829.75; IVA 622.55; gross 3452.30. Legacy without Cassa stays gross 3287.90.
- Full synthetic transaction rolled back: custom category creation, two daily worker entries, pending-group issue rejection, half-day gross 576.45 and full-day gross 1152.90, missing-client-data rejection, profile snapshot, issuance, issued immutability, regular User denial, NULL action denial.
- Additional rolled-back transaction: cross-date rejection, team save/recalculate roundtrip, 10% discount, expenses excluded from Cassa, stale-version rejection.
- Node renderer suite: 13 document/XLSX-model checks; a fourteenth verifies generated admin integration tokens when run during build. SheetJS is simulated, not Excel desktop.
- Chromium admin UI: 10 checks with mocked base shell and RPC, including Cassa fields, party snapshot, team confirmation, profile save, macro creation and logout cleanup.
- Synthetic proforma PDF rendered and inspected at two pages. Production logo comes from the existing saved image; no new company identity invented.

The existing monthly, Gedit grouping, pricing/removal and diagnostics build suites remain enabled before the final v3 stage. Build and deployed-commit checks still need to be confirmed by the release operator; do not infer deployment success from this file alone.
