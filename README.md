# Solvit SMS Sender and Call Tracker V2

React/Express administration portal and ingestion API for the Solvit Android call and SMS tracker.

## Production architecture

- Node.js/Express API and React frontend
- PostgreSQL 18 as the only production database
- One canonical schema in `migrations/`
- Explicit, versioned migrations; application startup never creates or alters tables
- Fail-fast startup when `DATABASE_URL` is absent, PostgreSQL is unavailable, or migrations are behind
- Optional PHP API uses the same PostgreSQL schema and `working_hours_schedule` field

SQLite and automatic database fallback are not supported.

## Local setup

Requirements: Node.js 20 or newer and PostgreSQL.

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run dev
```

Required environment variables:

```env
DATABASE_URL=postgresql://user:password@host:5432/solvit_db
DB_SSL=false
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-this
```

Use `DB_SSL=true` for Render. Never commit the real database URL.

## Production deployment on Render

Link the `sms-sender` service to the `solvit-db` PostgreSQL database so Render supplies `DATABASE_URL`.

- Build command: `npm install && npm run build`
- Pre-deploy command: `npm run db:migrate`
- Start command: `npm start`
- Environment: `DB_SSL=true`, plus secure admin credentials

Migrations acquire a PostgreSQL transaction and record each applied file in `schema_migrations`. The first migration creates the canonical tables and preserves a legacy `working_hours_json` value by renaming it to `working_hours_schedule` when encountered.

### CS Email SLA pilot

The Email SLA tab uses the seven-mailbox Exchange application RBAC scope and the matching `MICROSOFT_MONITORED_MAILBOXES` allowlist. Do not add `jmining@solvit.co.ke`. Before enabling Email SLA, run migrations through version 012 using the Render pre-deploy command. Set `EMAIL_SLA_ENABLED=true`, `EMAIL_SLA_START_AT`, the Microsoft tenant/client/secret values, `MICROSOFT_CS_GROUP_ADDRESS`, and the explicit monitored mailbox list. For CS staff sign-in, also set `SESSION_SECRET` to a random value of at least 32 characters and `MICROSOFT_REDIRECT_URI` to the exact Web redirect registered in the Entra application, for example `https://sms-sender-7pbe.onrender.com/api/email-auth/callback`.

Admins continue using the main portal password. CS staff use Microsoft sign-in on the same portal; their Email SLA API access is restricted to their own approved mailbox. New messages are assigned to a sole direct CS recipient, then a configured rule, then round-robin among available members. Admins can reassign and adjust availability/rotation in Email SLA settings. Staff see their own awaiting-response queue and in-app notices for new or reassigned messages; they reply in Outlook. Notices are visible only while the portal is open and are not email, SMS, or Teams push notifications.

Email SLA time is Monday-Friday, 8 AM-5 PM Africa/Nairobi. Admins must enter Kenyan public holiday dates in Email SLA settings; an empty list does **not** exclude holidays. The calendar and thresholds are snapshotted for newly captured emails, so existing deadlines are not rewritten by later edits. Validate one member's sign-in, assignment notice, Outlook reply sync, and another member's denied access before widening the pilot.

## Commands

```bash
npm run db:migrate  # apply pending database migrations
npm run db:import-sqlite # one-time, idempotent legacy import from /data/solvit.db
npm run lint        # TypeScript validation
npm run build       # production build
npm start           # start built server
```

## PHP deployment

The optional PHP backend requires PHP with PDO PostgreSQL. Set the same `DATABASE_URL` and run migrations through the Node migration command before serving PHP. `php/schema.sql` is intentionally only a pointer to the canonical migration directory.
