
-- Create shifts table for tracking operator shift sessions
CREATE TABLE public.shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id text,
  callsign text NOT NULL,
  service text NOT NULL,
  station text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  device_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

-- Anyone can read shifts (command dashboard needs this)
CREATE POLICY "Anon users can read all shifts"
  ON public.shifts FOR SELECT TO anon
  USING (true);

CREATE POLICY "Authenticated users can read all shifts"
  ON public.shifts FOR SELECT TO authenticated
  USING (true);

-- Anon can insert shifts (field app is unauthenticated)
CREATE POLICY "Anon users can insert shifts"
  ON public.shifts FOR INSERT TO anon
  WITH CHECK (true);

-- Anon can update shifts (to set ended_at)
CREATE POLICY "Anon users can update shifts"
  ON public.shifts FOR UPDATE TO anon
  USING (true);

-- Add shift_id to herald_reports
ALTER TABLE public.herald_reports
  ADD COLUMN shift_id uuid REFERENCES public.shifts(id);

-- Index for fast lookups
CREATE INDEX idx_shifts_callsign ON public.shifts(callsign);
CREATE INDEX idx_shifts_operator_id ON public.shifts(operator_id);
CREATE INDEX idx_shifts_service ON public.shifts(service);
CREATE INDEX idx_shifts_started_at ON public.shifts(started_at DESC);
CREATE INDEX idx_reports_shift_id ON public.herald_reports(shift_id);

-- Anon insert policy for herald_reports (field app inserts without auth)
CREATE POLICY "Anon users can insert reports"
  ON public.herald_reports FOR INSERT TO anon
  WITH CHECK (true);
