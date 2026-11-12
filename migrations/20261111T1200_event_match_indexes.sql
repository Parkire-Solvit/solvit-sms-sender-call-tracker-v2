-- Indexes on the normalised phone number and registration of call and SMS events, the same expressions the
-- callback counting uses (digits only, last 9; upper case letters and digits only). They let saving an outcome read
-- only the events for that record instead of scanning the whole history.
CREATE INDEX IF NOT EXISTS idx_events_phone_last9
  ON events ((RIGHT(regexp_replace(COALESCE(target_phone, ''), '[^0-9]', '', 'g'), 9)));
CREATE INDEX IF NOT EXISTS idx_events_reg_alnum
  ON events ((regexp_replace(UPPER(COALESCE(reg_no, '')), '[^A-Z0-9]', '', 'g')));
