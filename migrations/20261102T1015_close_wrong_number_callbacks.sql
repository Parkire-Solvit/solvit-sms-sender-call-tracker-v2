-- These are final callback dispositions. Earlier versions left Wrong Number
-- open, and this also repairs any older inconsistent Done Elsewhere or
-- Customer Rejected records. Preserve the original outcome time where possible.
UPDATE callback_jobs AS j
SET status = 'RED',
    closed_at = COALESCE(
      j.closed_at,
      (SELECT MAX(l.created_at)
       FROM callback_job_logs AS l
       WHERE l.callback_job_id = j.id
         AND l.outcome IN ('WRONG_NUMBER', 'DECLINED', 'VALUED_ELSEWHERE')),
      j.updated_at,
      CURRENT_TIMESTAMP
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE j.status = 'AMBER'
  AND j.latest_outcome IN ('WRONG_NUMBER', 'DECLINED', 'VALUED_ELSEWHERE');

-- Keep historical activity displays consistent with the corrected rule.
UPDATE callback_job_logs
SET resulting_status = 'RED'
WHERE outcome IN ('WRONG_NUMBER', 'DECLINED', 'VALUED_ELSEWHERE')
  AND resulting_status <> 'RED';
