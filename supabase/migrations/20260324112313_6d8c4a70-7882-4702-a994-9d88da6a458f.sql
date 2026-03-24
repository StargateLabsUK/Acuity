
-- 1. Create trusts table
CREATE TABLE public.trusts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  trust_pin_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true
);

ALTER TABLE public.trusts ENABLE ROW LEVEL SECURITY;

-- Trusts: only authenticated can read, only admins can modify (via edge functions with service role)
CREATE POLICY "Allow authenticated read trusts" ON public.trusts
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow anon read trusts" ON public.trusts
  FOR SELECT TO anon USING (true);

-- 2. Add trust_id to herald_reports
ALTER TABLE public.herald_reports ADD COLUMN trust_id uuid REFERENCES public.trusts(id);

-- 3. Add trust_id to incident_transmissions
ALTER TABLE public.incident_transmissions ADD COLUMN trust_id uuid REFERENCES public.trusts(id);

-- 4. Add trust_id to shifts
ALTER TABLE public.shifts ADD COLUMN trust_id uuid REFERENCES public.trusts(id);

-- 5. Create audit_log table
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email text,
  action text NOT NULL,
  details jsonb,
  trust_id uuid REFERENCES public.trusts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read audit_log" ON public.audit_log
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated insert audit_log" ON public.audit_log
  FOR INSERT TO authenticated WITH CHECK (true);

-- 6. Create profiles table for user management
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  trust_id uuid REFERENCES public.trusts(id),
  locked boolean NOT NULL DEFAULT false,
  failed_login_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read profiles" ON public.profiles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id);

CREATE POLICY "Allow authenticated insert profiles" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (true);

-- 7. Create trigger to auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 8. Create has_role function (security definer)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;
