# Timer 1.1.0 — 29/09/2026

This document supersedes the recorder/deletion behavior described for timer 1.0.

## User-visible behavior

The optional recorder (clock, Start, Stop and timer-specific input fields) is mounted only when MODE === 'mobile'. It is not mounted on pc.html, irrespective of viewport size. The existing manual insertion form is unchanged.

PC and mobile retain management of already recorded timer activities: complete details later or delete. The timer management panel lists the latest 250 accessible timer activities, both incomplete and complete. Every row has an Elimina button; incomplete synchronized rows also have Completa dettagli. A confirmation is required before recording any deletion intent.

User may delete their own timer activities; Admin may delete accessible timer activities created by other users. These permissions are checked by the server. No general DELETE or UPDATE permission for manual entries has been granted to User. Existing administrator deletion buttons for timer IDs route to the same operation.

## Persistence and synchronization

The per-account local state continues to use gon.activityTimer.v1.<user-id> and version 1, adding a deletions array. This preserves previous active and queued timers.

A delete first persists its intent locally and removes the matching upload from the queue. If offline, it remains pending until the app is open with connectivity. Reconnect processes deletions before uploads and again after in-flight uploads. The API checks expected user ID to guard against account switches.

The database stores a private tombstone containing only entry ID, owner ID, deleting actor and deletion timestamp. gon_save_timer and gon_delete_timer serialize by timer ID using transaction advisory locks. A stale upload of a deleted timer receives SQLSTATE P0002 / GON_TIMER_DELETED and is removed from the local outbox, not recreated. A trigger also records tombstones for timer rows removed through pre-existing admin controls. Business details and measured hours are removed from entries when the deletion succeeds.

The migration does not delete any pre-existing business activity automatically. Actual deletions require user action.

## Deployment

Apply supabase/20260929_timer_deletion.sql once after the initial optional-timer migration. It preserves the previous validated save implementation in private.gon_save_timer_record_v1 and keeps public.gon_save_timer compatible with the existing arguments. The private helper and tombstone table are not directly callable/readable by anon or authenticated clients.

The existing python build.py command remains unchanged. timer_integration.py versions the shared asset URL and emits timer-build.json with recorder_pages=[mobile.html] and management_pages=[pc.html,mobile.html]. It checks the asset version and generated inline JavaScript syntax when Node is available.

## Checks performed before merge

- JavaScript syntax check passed with Node.
- 22 Chromium DOM assertions passed using Playwright page.set_content fixtures. Auth, database, storage and network status were simulated. They cover PC recorder absence, manual-form preservation and manual delete delegation, mobile start/stop, restoration from saved state, confirmation cancellation, incomplete/completed deletion, offline deletion before upload, reconnection, deletion while upload is in flight, and account isolation.
- Database transactional checks passed for own incomplete/completed deletion, admin cross-user deletion, rejected User cross-user and manual deletions, expected-account mismatch, duplicate deletion, cancelled-upload rejection and anonymous RPC denial. Test rows were rolled back.
- RPC privileges were inspected: public timer RPCs require authenticated; private helpers deny anon and authenticated execution.

These checks are not an end-to-end login test on a physical phone. In-browser fixtures used mocked localStorage/network because real page navigation was unavailable in the testing environment. Offline recording still requires an already available application page; this is not a service-worker/PWA cold-start implementation.

Legacy open tabs should be reloaded to load timer-1.1.0. A v1 upload retry cannot resurrect a deleted record because the server guard applies independently of the page version.
