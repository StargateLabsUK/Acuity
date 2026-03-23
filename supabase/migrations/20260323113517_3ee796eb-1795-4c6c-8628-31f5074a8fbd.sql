
-- Add columns to herald_reports
ALTER TABLE public.herald_reports
  ADD COLUMN IF NOT EXISTS incident_number text,
  ADD COLUMN IF NOT EXISTS transmission_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS latest_transmission_at timestamptz;

-- Create incident_transmissions table
CREATE TABLE public.incident_transmissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.herald_reports(id) ON DELETE CASCADE,
  timestamp timestamptz NOT NULL,
  transcript text,
  assessment jsonb,
  priority text,
  headline text,
  operator_id text,
  session_callsign text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS policies matching herald_reports open access
ALTER TABLE public.incident_transmissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon users can read transmissions"
  ON public.incident_transmissions FOR SELECT TO anon USING (true);

CREATE POLICY "Anon users can insert transmissions"
  ON public.incident_transmissions FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Authenticated users can read transmissions"
  ON public.incident_transmissions FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert transmissions"
  ON public.incident_transmissions FOR INSERT TO authenticated WITH CHECK (true);

-- Allow anon to update herald_reports (for follow-up updates from field devices)
CREATE POLICY "Anon users can update reports"
  ON public.herald_reports FOR UPDATE TO anon USING (true);
