-- ============================================================================
-- TIGHTEN ANON RLS: Remove anonymous SELECT on sensitive tables
-- Pen test readiness: anonymous users should not be able to enumerate reports
--
-- Realtime subscriptions from field devices use the anon key but they
-- filter by shift_id/callsign. We keep anon SELECT on shifts (needed for
-- shift-ended polling) but remove it from reports, transmissions, and
-- dispositions. Field devices fetch data through edge functions (service_role).
-- ============================================================================

-- Remove anon read on herald_reports (field devices use fetch-incidents edge function)
DROP POLICY IF EXISTS "anon_read_reports" ON public.herald_reports;

-- Remove anon read on casualty_dispositions (field devices use sync-disposition edge function)
DROP POLICY IF EXISTS "anon_read_dispositions" ON public.casualty_dispositions;

-- Remove anon read on patient_transfers (only accessed via edge functions)
DROP POLICY IF EXISTS "anon_read_transfers" ON public.patient_transfers;

-- Keep anon_read_shifts — needed for useShiftEndedPoll on field devices
-- Keep anon_read_transmissions was already removed earlier

-- Keep shift_link_codes anon policies — needed for link code redemption
-- (actually these were already removed, redemption goes through edge function)
