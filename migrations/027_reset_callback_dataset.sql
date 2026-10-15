-- One-time approved reset of the incorrect callback dataset uploaded by Brian.
-- Deliberately preserves agents, call/SMS events, callback settings,
-- channel-partner allocations, users, Email SLA data, and system settings.

DELETE FROM callback_reopen_snapshot;
DELETE FROM callback_jobs;
DELETE FROM callback_imports;

SELECT setval(pg_get_serial_sequence('callback_jobs', 'id'), 1, false);
SELECT setval(pg_get_serial_sequence('callback_imports', 'id'), 1, false);
SELECT setval(pg_get_serial_sequence('callback_job_logs', 'id'), 1, false);
SELECT setval(pg_get_serial_sequence('callback_job_phones', 'id'), 1, false);
SELECT setval(pg_get_serial_sequence('callback_reopen_snapshot', 'id'), 1, false);
