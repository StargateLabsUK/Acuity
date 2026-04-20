-- Strict lifecycle model:
-- - explicit crew status on shifts
-- - one active incident pointer per shift
-- - safe defaults/backfill for existing rows

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS crew_status text NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS active_report_id uuid REFERENCES public.herald_reports(id) ON DELETE SET NULL;

ALTER TABLE public.shifts
  DROP CONSTRAINT IF EXISTS shifts_crew_status_check;

ALTER TABLE public.shifts
  ADD CONSTRAINT shifts_crew_status_check
  CHECK (crew_status IN ('available', 'on_incident', 'handover_only'));

CREATE INDEX IF NOT EXISTS idx_shifts_active_report_id
  ON public.shifts(active_report_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_shifts_crew_status
  ON public.shifts(crew_status)
  WHERE ended_at IS NULL;

-- Backfill open shifts with their most recent active incident.
UPDATE public.shifts s
SET active_report_id = latest.id
FROM LATERAL (
  SELECT hr.id
  FROM public.herald_reports hr
  WHERE hr.shift_id = s.id
    AND hr.status = 'active'
  ORDER BY hr.latest_transmission_at DESC NULLS LAST, hr.created_at DESC
  LIMIT 1
) latest
WHERE s.ended_at IS NULL
  AND latest.id IS NOT NULL;

-- Status derives from lifecycle state:
-- on_incident when a shift has an active incident, otherwise available.
UPDATE public.shifts
SET crew_status = CASE
  WHEN ended_at IS NOT NULL THEN 'available'
  WHEN active_report_id IS NOT NULL THEN 'on_incident'
  ELSE 'available'
END;
