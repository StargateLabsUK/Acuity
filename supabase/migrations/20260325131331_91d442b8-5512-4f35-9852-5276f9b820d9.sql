-- Patient transfer events table — immutable audit trail
CREATE TABLE public.patient_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.herald_reports(id) ON DELETE CASCADE,
  casualty_key text NOT NULL,
  casualty_label text NOT NULL,
  priority text NOT NULL,

  -- From crew
  from_callsign text NOT NULL,
  from_operator_id text,
  from_shift_id uuid REFERENCES public.shifts(id),

  -- To crew
  to_callsign text NOT NULL,
  to_shift_id uuid REFERENCES public.shifts(id),

  -- Lifecycle timestamps
  initiated_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  declined_at timestamptz,
  declined_reason text,

  -- Clinical snapshot at point of transfer (frozen, never edited)
  clinical_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Status: pending, accepted, declined
  status text NOT NULL DEFAULT 'pending',

  -- Trust and metadata
  trust_id uuid REFERENCES public.trusts(id),
  created_at timestamptz DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX idx_patient_transfers_report ON public.patient_transfers(report_id);
CREATE INDEX idx_patient_transfers_to_callsign ON public.patient_transfers(to_callsign, status);
CREATE INDEX idx_patient_transfers_from_callsign ON public.patient_transfers(from_callsign);
CREATE INDEX idx_patient_transfers_status ON public.patient_transfers(status) WHERE status = 'pending';

-- RLS policies
ALTER TABLE public.patient_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read patient_transfers"
  ON public.patient_transfers FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated insert patient_transfers"
  ON public.patient_transfers FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated update patient_transfers"
  ON public.patient_transfers FOR UPDATE
  TO authenticated
  USING (true);