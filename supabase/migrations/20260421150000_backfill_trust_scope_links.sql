-- Backfill trust scoping links for historical data.
-- Safe to run multiple times.

-- Normalize older shifts that were created without trust_id by matching
-- service text to active trust name/slug.
WITH candidate_shift_trust AS (
  SELECT
    s.id AS shift_id,
    t.id AS trust_id,
    ROW_NUMBER() OVER (
      PARTITION BY s.id
      ORDER BY
        CASE
          WHEN lower(btrim(s.service)) = lower(btrim(t.name)) THEN 0
          ELSE 1
        END,
        t.created_at ASC
    ) AS rn
  FROM public.shifts s
  JOIN public.trusts t
    ON t.active = true
   AND (
     lower(btrim(s.service)) = lower(btrim(t.name))
     OR lower(regexp_replace(btrim(s.service), '[^a-z0-9]+', '-', 'g')) = lower(btrim(t.slug))
   )
  WHERE s.trust_id IS NULL
    AND s.service IS NOT NULL
)
UPDATE public.shifts s
SET trust_id = c.trust_id
FROM candidate_shift_trust c
WHERE s.id = c.shift_id
  AND c.rn = 1;

-- Additional shift trust backfill from linked reports where trust mapping is unambiguous.
WITH shift_report_trust AS (
  SELECT
    r.shift_id,
    MIN(r.trust_id) AS trust_id
  FROM public.herald_reports r
  WHERE r.shift_id IS NOT NULL
    AND r.trust_id IS NOT NULL
  GROUP BY r.shift_id
  HAVING COUNT(DISTINCT r.trust_id) = 1
)
UPDATE public.shifts s
SET trust_id = src.trust_id
FROM shift_report_trust src
WHERE s.trust_id IS NULL
  AND s.id = src.shift_id;

-- Backfill reports from owning shift.
UPDATE public.herald_reports r
SET trust_id = s.trust_id
FROM public.shifts s
WHERE r.trust_id IS NULL
  AND r.shift_id = s.id
  AND s.trust_id IS NOT NULL;

-- Fallback: backfill reports by session_service -> trust name/slug.
WITH candidate_report_trust AS (
  SELECT
    r.id AS report_id,
    t.id AS trust_id,
    ROW_NUMBER() OVER (
      PARTITION BY r.id
      ORDER BY
        CASE
          WHEN lower(btrim(r.session_service)) = lower(btrim(t.name)) THEN 0
          ELSE 1
        END,
        t.created_at ASC
    ) AS rn
  FROM public.herald_reports r
  JOIN public.trusts t
    ON t.active = true
   AND (
     lower(btrim(r.session_service)) = lower(btrim(t.name))
     OR lower(regexp_replace(btrim(r.session_service), '[^a-z0-9]+', '-', 'g')) = lower(btrim(t.slug))
   )
  WHERE r.trust_id IS NULL
    AND r.session_service IS NOT NULL
)
UPDATE public.herald_reports r
SET trust_id = c.trust_id
FROM candidate_report_trust c
WHERE r.id = c.report_id
  AND c.rn = 1;

-- Backfill transmissions/dispositions from report trust.
UPDATE public.incident_transmissions tx
SET trust_id = r.trust_id
FROM public.herald_reports r
WHERE tx.trust_id IS NULL
  AND tx.report_id = r.id
  AND r.trust_id IS NOT NULL;

UPDATE public.casualty_dispositions d
SET trust_id = r.trust_id
FROM public.herald_reports r
WHERE d.trust_id IS NULL
  AND d.report_id = r.id
  AND r.trust_id IS NOT NULL;

-- Backfill transfers first from report trust, then from linked shifts.
UPDATE public.patient_transfers pt
SET trust_id = r.trust_id
FROM public.herald_reports r
WHERE pt.trust_id IS NULL
  AND pt.report_id = r.id
  AND r.trust_id IS NOT NULL;

WITH transfer_shift_trust AS (
  SELECT
    pt.id,
    COALESCE(s_from.trust_id, s_to.trust_id) AS trust_id
  FROM public.patient_transfers pt
  LEFT JOIN public.shifts s_from
    ON s_from.id = pt.from_shift_id
  LEFT JOIN public.shifts s_to
    ON s_to.id = pt.to_shift_id
  WHERE pt.trust_id IS NULL
)
UPDATE public.patient_transfers pt
SET trust_id = src.trust_id
FROM transfer_shift_trust src
WHERE pt.id = src.id
  AND src.trust_id IS NOT NULL;

-- Backfill shift link codes from the parent shift.
UPDATE public.shift_link_codes slc
SET trust_id = s.trust_id
FROM public.shifts s
WHERE slc.trust_id IS NULL
  AND slc.shift_id = s.id
  AND s.trust_id IS NOT NULL;

-- Backfill audit trust_id using report/shift references in details JSON.
WITH audit_resolved AS (
  SELECT
    a.id,
    COALESCE(
      r.trust_id,
      s_direct.trust_id,
      s_from.trust_id,
      s_to.trust_id
    ) AS resolved_trust_id
  FROM public.audit_log a
  LEFT JOIN public.herald_reports r
    ON (a.details ->> 'report_id') ~* '^[0-9a-f-]{36}$'
   AND r.id = (a.details ->> 'report_id')::uuid
  LEFT JOIN public.shifts s_direct
    ON (a.details ->> 'shift_id') ~* '^[0-9a-f-]{36}$'
   AND s_direct.id = (a.details ->> 'shift_id')::uuid
  LEFT JOIN public.shifts s_from
    ON (a.details ->> 'from_shift_id') ~* '^[0-9a-f-]{36}$'
   AND s_from.id = (a.details ->> 'from_shift_id')::uuid
  LEFT JOIN public.shifts s_to
    ON (a.details ->> 'to_shift_id') ~* '^[0-9a-f-]{36}$'
   AND s_to.id = (a.details ->> 'to_shift_id')::uuid
  WHERE a.trust_id IS NULL
)
UPDATE public.audit_log a
SET trust_id = ar.resolved_trust_id
FROM audit_resolved ar
WHERE a.id = ar.id
  AND ar.resolved_trust_id IS NOT NULL;

-- Backfill profiles trust_id for trust-scoped users where it is missing.
-- Uses the most recent audit trust match by user_id/email.
WITH profile_candidates AS (
  SELECT
    p.id AS profile_id,
    a.trust_id,
    ROW_NUMBER() OVER (
      PARTITION BY p.id
      ORDER BY a.created_at DESC
    ) AS rn
  FROM public.profiles p
  JOIN public.audit_log a
    ON a.trust_id IS NOT NULL
   AND (
     (a.user_id IS NOT NULL AND a.user_id = p.id)
     OR (
       a.user_email IS NOT NULL
       AND p.email IS NOT NULL
       AND lower(a.user_email) = lower(p.email)
     )
   )
  WHERE p.trust_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = p.id
        AND ur.role IN ('admin', 'command')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = p.id
        AND ur.role = 'owner'
    )
)
UPDATE public.profiles p
SET trust_id = c.trust_id
FROM profile_candidates c
WHERE p.id = c.profile_id
  AND c.rn = 1;
