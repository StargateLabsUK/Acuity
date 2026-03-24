
CREATE TABLE public.casualty_dispositions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid REFERENCES public.herald_reports(id) ON DELETE CASCADE NOT NULL,
  casualty_key text NOT NULL,
  casualty_label text NOT NULL,
  priority text NOT NULL,
  disposition text NOT NULL,
  fields jsonb DEFAULT '{}'::jsonb,
  incident_number text,
  closed_at timestamptz NOT NULL,
  trust_id uuid REFERENCES public.trusts(id),
  session_callsign text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(report_id, casualty_key)
);

ALTER TABLE public.casualty_dispositions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated insert casualty_dispositions"
  ON public.casualty_dispositions FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated read casualty_dispositions"
  ON public.casualty_dispositions FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated update casualty_dispositions"
  ON public.casualty_dispositions FOR UPDATE TO authenticated
  USING (true);
