# Optional PHP backend

This backend shares the project's canonical PostgreSQL schema. It has no SQLite or MySQL fallback and never modifies tables during startup.

Requirements:

- PHP 8.1+
- PDO PostgreSQL extension
- `DATABASE_URL` pointing to the same PostgreSQL database as the Node service
- Migrations applied from the repository root with `npm run db:migrate`

`schema.sql` is retained only as a pointer to `../migrations`; it is not a second schema definition.
