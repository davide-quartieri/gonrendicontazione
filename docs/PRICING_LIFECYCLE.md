# Compact tariffs and report history removal

Release: pricing-lifecycle-1.0.0

## Tariffs
The editor now has exactly 11 rows, matching the user's two annotated screenshots:

| Macroarea | Type | Pricing |
|---|---|---|
| Rilievo in campo | Cantiere | Hourly |
| Rilievo in campo | Viaggio | Hourly |
| Elaborazione rilievo | Ufficio | Hourly |
| Assistenza cliente | Cantiere | Hourly |
| Assistenza cliente | Viaggio | Hourly |
| Assistenza cliente | Ufficio | Hourly |
| Attivita amministrative | Ufficio | Hourly |
| Corso | Ufficio | Hourly |
| Varie | Ufficio | Hourly |
| Rilievo in campo - PROGRAMMATO | Cantiere | Monthly forfait |
| Elaborazione rilievo - PROGRAMMATA | Ufficio | Monthly forfait |

The 13 crossed-out combinations cannot be saved in a new tariff version.
Operational activities are not deleted or automatically reclassified. In an hourly report, an old activity with a removed combination is flagged for classification correction rather than silently charged at zero.

Given the already agreed monthly customer billing cycle, each programmed forfait is interpreted as **one fee per billing customer, macroarea and calendar month with selected activity**, regardless of hours, employees or number of sites. It is not a price per intervention. Gedit's two sites share the same billing scope. No automatic proration. Changes to programmed conditions within a month require review rather than silently mixing versions.

A global monthly customer forfait already covers these activities and does not add the two separate programmed fees. The normal global monthly fee can still exist without recorded hours; the separate programmed fees require selected activities.

Old hourly programmed prices are NEVER silently reused as monthly fees. The editor leaves them undefined until administration enters the agreed amount. Explicit zero remains distinguishable from an undefined amount. Historical terms and issued snapshots are not rewritten.

New drafts use the updated builder. Old drafts containing programmed or removed combinations must explicitly recalculate before issue. Snapshot-based revisions of documents previously issued retain their original pricing unless explicitly recalculated. VAT, discounts and original recorded hours remain independent of this change.

## History removal
The archive and report dialog expose an administrator-only **Elimina** action:
- Draft: confirmation, optimistic version check, existing draft deletion plus audit. Activities remain.
- Issued/sent: confirmation explaining cancellation/rebilling, required reason, state `cancelled`, hidden from normal history via `removed_at`. Stored document, number, timestamps and removal audit remain.
- Superseded revision: hidden but kept internally; the current successor's claims remain intact.
- A pending draft revision blocks removal of its parent until that draft is removed.
- Only claims belonging to the removed report are released. Removing the current issued report makes its activities/fee units eligible again; no automatic restoration of an older revision.
- Number counters are never decremented. External invoices, emails and downloaded documents are not recalled or deleted.

The mutation is behind the existing administrator/expected-user checks, per-scope advisory lock and row lock. No direct table grants are broadened. The private helper is not executable by anon or authenticated roles; the checked API calls it as owner.

## Validation scope
- Migration applied successfully with exact function-boundary checks.
- Six read-only live checks passed: 11 allowed pairs, 9 hourly, 2 programmed forfait, validator accepts compact catalog, anon RPC denied, private deletion helper not directly exposed.
- Live read-only negative test rejected programmed/hour mode with SQLSTATE 22023.
- Pure price calculation returned net 960, VAT 211.20, gross 1171.20 for synthetic lines; no rows written.
- 17 Node regressions are installed as blocking build checks on the generated frontend. These use isolated functions and mock RPC, not real user credentials.
- The previously installed monthly document and Gedit grouping checks run before this stage.
- A proposed transactional end-to-end database test was blocked by the tool safety check. It was not retried or represented as passed. No test reports, clients or actual cancellations were left by that test.
- Final live read confirmed zero removed reports and zero QA clients at verification time. No customer document was deleted, issued or sent by this implementation.

A full interactive test using an administration-owned disposable draft remains distinct from the above checks. Production data must not be used for destructive tests.
