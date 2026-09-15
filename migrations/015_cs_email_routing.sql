ALTER TABLE email_threads
  ADD COLUMN IF NOT EXISTS assignment_reason TEXT,
  ADD COLUMN IF NOT EXISTS outlook_web_link TEXT;

ALTER TABLE email_team_members ADD COLUMN IF NOT EXISTS routing_names TEXT[] NOT NULL DEFAULT '{}';

UPDATE email_team_members SET display_name='Joyce Mungasi', routing_names=ARRAY['Joyce','Joyce Mungasi'] WHERE email='jmungasi@solvit.co.ke';
UPDATE email_team_members SET display_name='Irene Odago', routing_names=ARRAY['Irene','Irene Odago'] WHERE email='iodago@solvit.co.ke';
UPDATE email_team_members SET display_name='Virginia Musyoka', routing_names=ARRAY['Virginia','Virginia Musyoka'] WHERE email='vmusyoka@solvit.co.ke';
UPDATE email_team_members SET display_name='Brian Muthama', routing_names=ARRAY['Brian','Brian Muthama'] WHERE email='bmuthama@solvit.co.ke';
UPDATE email_team_members SET display_name='Mercy Odondi', routing_names=ARRAY['Mercy','Mercy Odondi'] WHERE email='modondi@solvit.co.ke';
UPDATE email_team_members SET display_name='Dorcas Bwosi', routing_names=ARRAY['Dorcas','Dorcas Bwosi'] WHERE email='dbwosi@solvit.co.ke';
UPDATE email_team_members SET display_name='Caroline Mbugua', routing_names=ARRAY['Caroline','Carol','Caroline Mbugua'] WHERE email='cmbugua@solvit.co.ke';

-- Existing delta cursors were created without bodyPreview/webLink in $select.
-- Restart each folder from a fresh delta query; message IDs prevent duplicates.
UPDATE email_sync_state SET delta_link=NULL, updated_at=now();

ALTER TABLE email_threads DROP CONSTRAINT IF EXISTS email_threads_assignment_method_check;
ALTER TABLE email_threads ADD CONSTRAINT email_threads_assignment_method_check
  CHECK (assignment_method IN ('DIRECT','NAME_MATCH','RULE','DEFAULT','ROUND_ROBIN','MANUAL'));

ALTER TABLE email_assignment_history DROP CONSTRAINT IF EXISTS email_assignment_history_method_check;
ALTER TABLE email_assignment_history ADD CONSTRAINT email_assignment_history_method_check
  CHECK (method IN ('DIRECT','NAME_MATCH','RULE','DEFAULT','ROUND_ROBIN','MANUAL'));
