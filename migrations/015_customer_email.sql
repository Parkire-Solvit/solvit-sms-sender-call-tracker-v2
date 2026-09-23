-- 015_customer_email.sql
ALTER TABLE callback_jobs ADD COLUMN IF NOT EXISTS customer_email TEXT;
