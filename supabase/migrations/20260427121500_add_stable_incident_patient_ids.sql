-- Stable server-side patient identity for multi-transmission incidents.
-- Adds canonical incident_patients and wires dispositions/transfers to patient_id.

CREATE TABLE IF NOT EXISTS public.incident_patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.herald_reports(id) ON DELETE CASCADE,
  casualty_key text NOT NULL,
  casualty_label text NOT NULL,
  priority text NOT NULL,
  patient_name text,
  age_sex text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  trust_id uuid REFERENCES public.trusts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, casualty_key)
);

CREATE INDEX IF NOT EXISTS idx_incident_patients_report_id
  ON public.incident_patients(report_id);

CREATE INDEX IF NOT EXISTS idx_incident_patients_trust_id
  ON public.incident_patients(trust_id);

CREATE INDEX IF NOT EXISTS idx_incident_patients_priority
  ON public.incident_patients(priority);

ALTER TABLE public.incident_patients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_read_incident_patients_by_trust" ON public.incident_patients;
CREATE POLICY "auth_read_incident_patients_by_trust" ON public.incident_patients
  FOR SELECT TO authenticated
  USING (
    trust_id IN (
      SELECT p.trust_id FROM public.profiles p WHERE p.id = auth.uid()
    )
  );

ALTER TABLE public.casualty_dispositions
  ADD COLUMN IF NOT EXISTS patient_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'casualty_dispositions_patient_id_fkey'
  ) THEN
    ALTER TABLE public.casualty_dispositions
      ADD CONSTRAINT casualty_dispositions_patient_id_fkey
      FOREIGN KEY (patient_id)
      REFERENCES public.incident_patients(id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'casualty_dispositions_report_patient_unique'
  ) THEN
    ALTER TABLE public.casualty_dispositions
      ADD CONSTRAINT casualty_dispositions_report_patient_unique
      UNIQUE (report_id, patient_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_casualty_dispositions_patient_id
  ON public.casualty_dispositions(patient_id);

ALTER TABLE public.patient_transfers
  ADD COLUMN IF NOT EXISTS patient_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'patient_transfers_patient_id_fkey'
  ) THEN
    ALTER TABLE public.patient_transfers
      ADD CONSTRAINT patient_transfers_patient_id_fkey
      FOREIGN KEY (patient_id)
      REFERENCES public.incident_patients(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_patient_transfers_patient_id
  ON public.patient_transfers(patient_id);

-- Backfill canonical patients from reports/dispositions/transfers.
WITH report_patients AS (
  SELECT
    hr.id AS report_id,
    atm.key AS casualty_key,
    COALESCE(
      NULLIF(TRIM(atm.value->>'name'), ''),
      atm.key || CASE
        WHEN NULLIF(TRIM(atm.value->>'A'), '') IS NOT NULL
          THEN ' — ' || NULLIF(TRIM(atm.value->>'A'), '')
        ELSE ''
      END
    ) AS casualty_label,
    COALESCE((regexp_match(atm.key, '^(P[0-9]+)'))[1], atm.key) AS priority,
    NULLIF(TRIM(atm.value->>'name'), '') AS patient_name,
    NULLIF(TRIM(atm.value->>'A'), '') AS age_sex,
    hr.trust_id
  FROM public.herald_reports hr
  CROSS JOIN LATERAL jsonb_each(COALESCE(hr.assessment->'atmist', '{}'::jsonb)) AS atm(key, value)
),
disposition_patients AS (
  SELECT
    cd.report_id,
    cd.casualty_key,
    cd.casualty_label,
    cd.priority,
    NULL::text AS patient_name,
    NULL::text AS age_sex,
    cd.trust_id
  FROM public.casualty_dispositions cd
),
transfer_patients AS (
  SELECT
    pt.report_id,
    pt.casualty_key,
    pt.casualty_label,
    pt.priority,
    NULL::text AS patient_name,
    NULL::text AS age_sex,
    pt.trust_id
  FROM public.patient_transfers pt
),
combined AS (
  SELECT * FROM report_patients
  UNION ALL
  SELECT * FROM disposition_patients
  UNION ALL
  SELECT * FROM transfer_patients
),
deduped AS (
  SELECT DISTINCT ON (report_id, casualty_key)
    report_id,
    casualty_key,
    casualty_label,
    priority,
    patient_name,
    age_sex,
    trust_id
  FROM combined
  WHERE report_id IS NOT NULL
    AND casualty_key IS NOT NULL
    AND casualty_key <> ''
  ORDER BY report_id, casualty_key, (patient_name IS NOT NULL) DESC, (age_sex IS NOT NULL) DESC
)
INSERT INTO public.incident_patients (
  report_id,
  casualty_key,
  casualty_label,
  priority,
  patient_name,
  age_sex,
  trust_id,
  first_seen_at,
  last_seen_at
)
SELECT
  d.report_id,
  d.casualty_key,
  COALESCE(NULLIF(TRIM(d.casualty_label), ''), d.casualty_key),
  COALESCE(NULLIF(TRIM(d.priority), ''), COALESCE((regexp_match(d.casualty_key, '^(P[0-9]+)'))[1], d.casualty_key)),
  d.patient_name,
  d.age_sex,
  d.trust_id,
  now(),
  now()
FROM deduped d
ON CONFLICT (report_id, casualty_key)
DO UPDATE SET
  casualty_label = EXCLUDED.casualty_label,
  priority = EXCLUDED.priority,
  patient_name = COALESCE(EXCLUDED.patient_name, public.incident_patients.patient_name),
  age_sex = COALESCE(EXCLUDED.age_sex, public.incident_patients.age_sex),
  trust_id = COALESCE(EXCLUDED.trust_id, public.incident_patients.trust_id),
  last_seen_at = now(),
  updated_at = now();

UPDATE public.casualty_dispositions cd
SET patient_id = ip.id
FROM public.incident_patients ip
WHERE cd.patient_id IS NULL
  AND ip.report_id = cd.report_id
  AND ip.casualty_key = cd.casualty_key;

UPDATE public.patient_transfers pt
SET patient_id = ip.id
FROM public.incident_patients ip
WHERE pt.patient_id IS NULL
  AND ip.report_id = pt.report_id
  AND ip.casualty_key = pt.casualty_key;
