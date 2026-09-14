# Email SLA engine: repository audit and implementation plan

Status: additive schema and isolated, unconnected email domain services are in progress; **not connected to Microsoft Graph or deployed**.

## Verified Microsoft 365 topology (14 September 2026)

- `cs-team@solvit.co.ke` is a Microsoft 365 Group, not a shared user mailbox. The original single-shared-mailbox assumption is invalid.
- Its group has eight members but seven subscribers. `jmining@solvit.co.ke` is excluded from the email-monitoring pilot.
- The seven approved user mailboxes are `jmungasi`, `iodago`, `vmusyoka`, `bmuthama`, `modondi`, `dbwosi`, and `cmbugua` at `solvit.co.ke`. A fixed Exchange application scope was created and verified against exactly those seven; an `Application Mail.Read` assignment tests true for `modondi` and false for `jmining`.
- Entra App registrations shows only the default delegated `User.Read` permission, not an unscoped application `Mail.Read` grant. Do not add an unscoped mail grant.
- Outlook evidence shows a customer message addressed to the group and a response from an agent's personal mailbox. Incoming copies and replies must therefore be correlated across approved user mailboxes. `conversationId` alone must not be assumed stable across mailboxes; use RFC `Internet-Message-ID`, `In-Reply-To`, and `References` headers. Duplicate subscriber copies need one logical inbound record.
- The group mailbox itself is not covered by the seven-user Exchange scope. A response sent solely from Group Conversations may not be observed by this pilot. Validate actual agent workflow before claiming complete coverage.

## Current architecture

1. `server.ts` is the Express entry point and contains most API routes. It serves the Vite/React SPA in production and uses `db.ts` for PostgreSQL access via raw `pg`.
2. `migrations/*.sql` and `migrations/migrate.ts` manage schema versions. The pre-existing `agents`, `events`, `system_settings`, `settings_change_log`, and `internal_contacts` tables support call/SMS tracking. `agents` has `id`, `name`, `phone_number`, `tag`, timestamps, and archive fields; `events` belongs to calls/SMS and must not receive email records.
3. `complianceEngine.ts` calculates call/SMS obligations, agent summaries, and SLA labels from events. Its pure-function style is reusable as a pattern, but email deadlines and state need a separate engine.
4. `settingsManager.ts` reads/writes call/SMS settings and change logs. Email settings should use separate tables and validation so existing rules are untouched.
5. `src/App.tsx` is the main dashboard, with extracted call/SMS components under `src/components/`. An Email SLA section can be added after backend APIs are stable.
6. `POST /api/login` compares environment credentials but returns a constant token; the frontend stores a boolean in `localStorage`. Backend routes do **not** validate this token. This is not authorization. `app.use(cors())` allows all origins. These are release-blocking for customer email metadata and admin operations.
7. APIs are currently registered directly on `app` in `server.ts`, rather than Express routers. The email feature should use its own router mounted under `/api/email`.
8. Agent name updates use SSE (`/api/agent-updates/:id`); dashboard statistics poll every 25 seconds. Neither should be assumed to be a durable email notification channel.
9. PostgreSQL schema is migrated before app startup. `db.ts` checks a minimum schema version. The migration runner keys only on numeric prefix, and the repository has two files beginning `004_`; this naming collision should be corrected in a separate, careful migration-tool change before relying on further production migrations.

## Proposed modules and changes

Add `server/email/` with `emailTypes.ts`, `emailRepository.ts`, `emailSlaService.ts`, `emailAssignmentService.ts`, `emailAlertService.ts`, `graphClient.ts`, `graphSubscriptionService.ts`, `graphWebhookController.ts`, `emailSyncService.ts`, and `emailRoutes.ts`. Keep Graph transport behind `graphClient`, and use mocked responses for automated tests.

Add `server/auth/` for real server-side sessions or signed tokens, role checks, and a separate device-ingest credential strategy. Add `src/components/EmailSlaSection.tsx`, API client/types, and management UI only after backend synchronization and authorization tests pass. Modify `server.ts` only to mount the email router and initialize background reconciliation. Modify `.env.example` with placeholder Microsoft variables, never secrets.

`migrations/009_email_sla_foundation.sql` is the first additive email database step, following the insurance-callback migrations 007/008 now on `main`: email-specific settings, configurable team/rules/cursor, threads, messages, alerts, sync state, and assignment history. It does not modify existing call/SMS or callback data.

The first isolated code modules are `server/email/emailSlaService.ts`, `emailAssignmentService.ts`, `graphClient.ts`, and `messageIdentity.ts`, with mocked unit tests. They are not mounted on any API route yet. The Graph client requires an explicit mailbox allowlist, requests immutable IDs, validates continuation URLs, and retrieves only reply-linking headers. These services are not sufficient for live email ingestion: persistence, transactions, authenticated routes, subscription renewal, reconciliation scheduling, and the dashboard are still outstanding.

## Security and integration gates

- Replace the client-side login flag with a verifiable server session; protect **all** email and admin routes. Give employee and manager roles appropriate row-level visibility. Add CS roster identity mapping; `agents` currently represents Android/device agents, not necessarily Outlook users.
- Constrain CORS to approved origins; validate payloads and rate-limit login, webhook, and management routes. Avoid logging tokens, email bodies, and attachments.
- The Entra app and fixed seven-user Exchange RBAC scope exist, but no credential has been created. Keep the app allowlist synchronized with that scope. Scope tests do not substitute for a real Graph access test.
- Confirm direct-owner/rule semantics, business-hour policy, resolution workflow, and notification ownership before turning on live ingestion.
- Webhooks are triggers, not the source of truth. Persist folder-specific delta links; reconcile Inbox and Sent Items, use immutable message IDs where supported, and enforce `graph_message_id` uniqueness. Initial backfill scope must be agreed to avoid generating historical alerts.
- Define conversation grouping carefully: Graph conversation IDs may span multiple customer requests; the MVP should document and test whether a new inbound message reopens or joins an existing resolved thread.

## Sequence and acceptance checks

1. Verify `009` applies transactionally in a test PostgreSQL database and preserve the existing insurance-callback migrations 007/008.
2. Implement server-side authentication, roles, CORS restrictions, and protected email route tests without changing device event behavior.
3. Create a credential only after secure storage is ready; prove read-only access to one allowed and one denied mailbox, with no organization-wide grant.
4. Build idempotent message repository, per-user Inbox/Sent delta sync, webhook verification, subscription renewal, and reconciliation scheduler. Deduplicate subscriber copies by Internet Message ID and match replies using RFC headers.
5. Add configurable CS roster, direct/rule/round-robin assignment, and manual reassignment without resetting received-at or due-at timestamps.
6. Add response/resolution SLA and once-only alert stages, with unit tests for all boundary cases.
7. Expose protected employee/manager APIs, then add the Email SLA section and settings UI to the existing dashboard.
8. Test end to end with the CS mailbox: inbound, assignment, Outlook reply, resolution, warning, breach, missed webhook recovery, duplicate notification, and unauthorized access. Re-run call/SMS smoke tests before production deployment.

No Microsoft credentials or mailbox access are present in this repository; end-to-end completion requires those external prerequisites.
