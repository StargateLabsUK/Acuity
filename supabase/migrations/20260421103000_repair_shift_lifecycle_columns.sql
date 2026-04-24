-- Repair migration: ensure strict lifecycle columns exist on shifts.
-- This is idempotent so it can safely run on environments that already have them.

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS crew_status text DEFAULT 'available';

ALTER TABLE public.shifts
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

UPDATE public.shifts
SET crew_status = 'available'
WHERE crew_status IS NULL;
