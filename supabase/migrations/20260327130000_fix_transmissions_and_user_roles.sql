-- ============================================================================
-- FIX: Remove anon read on incident_transmissions
-- FIX: Lock down user_roles table (privilege escalation)
-- ============================================================================

-- ── incident_transmissions: remove anon read ─────────────────────────────────
-- Only the /command page (authenticated) queries this table directly.
-- Field devices and /incidents page do NOT subscribe to this table.
-- All writes go through edge functions (service_role), so no change needed there.

DROP POLICY IF EXISTS "anon_read_transmissions" ON public.incident_transmissions;

-- ── user_roles: enable RLS and lock down ─────────────────────────────────────
-- Without RLS, any authenticated user can grant themselves admin.

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read their own roles (needed for login role check)
CREATE POLICY "users_read_own_roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Admins can read all roles within their trust (for admin panel user management)
CREATE POLICY "admins_read_all_roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

-- Only admins can insert new roles
CREATE POLICY "admins_insert_roles" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

-- Only admins can update roles
CREATE POLICY "admins_update_roles" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

-- Only admins can delete roles
CREATE POLICY "admins_delete_roles" ON public.user_roles
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

-- No anon access to user_roles at all
