-- Trust-scoped station directory for controlled station rollout.
-- Backward compatible: existing station text fields continue to work.

CREATE TABLE IF NOT EXISTS public.stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trust_id uuid NOT NULL REFERENCES public.trusts(id) ON DELETE CASCADE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stations_name_length CHECK (char_length(btrim(name)) BETWEEN 2 AND 80)
);

CREATE UNIQUE INDEX IF NOT EXISTS stations_trust_name_unique_idx
  ON public.stations (trust_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS stations_trust_active_idx
  ON public.stations (trust_id, active);

ALTER TABLE public.stations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_read_stations_by_trust" ON public.stations;
CREATE POLICY "auth_read_stations_by_trust"
  ON public.stations
  FOR SELECT
  TO authenticated
  USING (
    trust_id IN (
      SELECT p.trust_id FROM public.profiles p WHERE p.id = auth.uid()
    )
  );

-- Backfill from historical shifts.
INSERT INTO public.stations (trust_id, name)
SELECT DISTINCT
  s.trust_id,
  btrim(s.station) AS name
FROM public.shifts s
WHERE s.trust_id IS NOT NULL
  AND s.station IS NOT NULL
  AND btrim(s.station) <> ''
ON CONFLICT (trust_id, lower(btrim(name))) DO NOTHING;

-- Backfill from historical report snapshots.
INSERT INTO public.stations (trust_id, name)
SELECT DISTINCT
  r.trust_id,
  btrim(r.session_station) AS name
FROM public.herald_reports r
WHERE r.trust_id IS NOT NULL
  AND r.session_station IS NOT NULL
  AND btrim(r.session_station) <> ''
ON CONFLICT (trust_id, lower(btrim(name))) DO NOTHING;
