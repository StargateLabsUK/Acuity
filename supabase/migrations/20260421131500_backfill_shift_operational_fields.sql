-- Backfill shift operational fields so admin/device views have data.
-- Safe to run multiple times.
-- Workflow touch: ensures migration deployment workflow reruns after CI fix.

-- Ensure future inserts always get a shift start timestamp.
ALTER TABLE public.shifts
  ALTER COLUMN started_at SET DEFAULT now();

-- Fill missing started_at values from created_at where available.
UPDATE public.shifts
SET started_at = COALESCE(created_at, now())
WHERE started_at IS NULL;

-- Backfill missing station from linked incident reports.
UPDATE public.shifts s
SET station = src.session_station
FROM (
  SELECT
    hr.shift_id,
    MAX(NULLIF(BTRIM(hr.session_station), '')) AS session_station
  FROM public.herald_reports hr
  WHERE hr.shift_id IS NOT NULL
  GROUP BY hr.shift_id
) src
WHERE s.id = src.shift_id
  AND (s.station IS NULL OR BTRIM(s.station) = '')
  AND src.session_station IS NOT NULL;

-- Backfill missing operator_id from linked incident reports.
UPDATE public.shifts s
SET operator_id = src.session_operator_id
FROM (
  SELECT
    hr.shift_id,
    MAX(NULLIF(BTRIM(hr.session_operator_id), '')) AS session_operator_id
  FROM public.herald_reports hr
  WHERE hr.shift_id IS NOT NULL
  GROUP BY hr.shift_id
) src
WHERE s.id = src.shift_id
  AND (s.operator_id IS NULL OR BTRIM(s.operator_id) = '')
  AND src.session_operator_id IS NOT NULL;
