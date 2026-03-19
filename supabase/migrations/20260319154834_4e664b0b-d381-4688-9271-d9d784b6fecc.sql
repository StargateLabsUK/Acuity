
ALTER TABLE public.herald_reports ADD COLUMN IF NOT EXISTS session_callsign text;
ALTER TABLE public.herald_reports ADD COLUMN IF NOT EXISTS session_operator_id text;
ALTER TABLE public.herald_reports ADD COLUMN IF NOT EXISTS session_service text;
ALTER TABLE public.herald_reports ADD COLUMN IF NOT EXISTS session_station text;
