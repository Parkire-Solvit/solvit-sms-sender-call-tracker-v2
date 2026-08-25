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

## Commands

```bash
npm run db:migrate  # apply pending database migrations
npm run lint        # TypeScript validation
npm run build       # production build
npm start           # start built server
```

## PHP deployment

The optional PHP backend requires PHP with PDO PostgreSQL. Set the same `DATABASE_URL` and run migrations through the Node migration command before serving PHP. `php/schema.sql` is intentionally only a pointer to the canonical migration directory.
