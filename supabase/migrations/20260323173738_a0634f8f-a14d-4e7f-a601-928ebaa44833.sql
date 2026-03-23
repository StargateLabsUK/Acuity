CREATE TABLE public.incident_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checked_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'healthy',
  database_status text NOT NULL DEFAULT 'up',
  database_latency_ms integer,
  ai_provider_status text NOT NULL DEFAULT 'up',
  ai_provider_latency_ms integer,
  error_message text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.incident_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon read" ON public.incident_log FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon insert" ON public.incident_log FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow authenticated read" ON public.incident_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert" ON public.incident_log FOR INSERT TO authenticated WITH CHECK (true);

CREATE INDEX idx_incident_log_checked_at ON public.incident_log (checked_at DESC);