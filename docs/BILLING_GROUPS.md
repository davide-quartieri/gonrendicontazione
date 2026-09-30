# Billing groups v1

User correction: Gedit Vighizzolo and Gedit Calcinato are sites of the same billing customer, Gedit.

## Behaviour

- Manual entry, mobile timer and personal history keep the original operational client/site labels.
- The administrative billing selector uses the authenticated `gon_billing_customers` RPC. Gedit appears once.
- For Gedit, the monthly overview reads both verified sites within the selected date interval. No changes to activity IDs, dates, hours or source labels.
- Every new grouped report has one client recipient and a snapshot of the included site membership. The activity detail retains its site; the economic Excel adds a Cantiere column without moving the hour or monetary formula columns.
- Hourly rules apply to the billing customer. A monthly flat fee is a single customer/month quota, never multiplied by the number of sites.
- The existing canonical Vighizzolo agreement/scope is retained. No tariff, VAT rate or previously emitted amount is inferred or overwritten. Legacy conditions still require confirmation through the existing monthly workflow.
- Existing emitted/sent documents keep their original snapshots. Already claimed activities remain marked as reported and are not automatically charged again. The administration must explicitly prepare a revision or select only remaining activities.

## Boundaries

Grouping is explicit, not a heuristic based on similar names. Only the two Gedit sites verified in the live database are configured by this migration. Other customers remain unchanged. The mapping is private and not writable by operational users.

The canonical ID is an internal compatibility detail, not the name shown to the recipient. Both site IDs resolve to the same billing scope and the same transaction lock. Operational anagraphics are not merged or deleted.

The internal Excel dashboard still analyses operational customer/site entries. The grouped customer document and economic Excel are the billing outputs.

## Checks

Database test transaction completed with ROLLBACK: one Gedit selector option; same combined overview through either site ID; existing archive unchanged; one shared tariff account; two-site hourly subtotal/VAT/total; grouped issuance; prevention of repeated hour and monthly-fee claims; rejection of unrelated customers; User/anonymous isolation.

Build gates run the existing 12 monthly document tests plus 10 grouping checks on generated document code and a simulated customer selector/SheetJS adapter. They check combined recipient and sites, unchanged monetary formulas, immutable input, unchanged non-grouped and legacy outputs, flat fee with no hours, text escaping, and administrative selector behaviour.

These checks are not a real-user browser session or an Excel desktop test. The deployment log must confirm them before claiming the new interface is published.
