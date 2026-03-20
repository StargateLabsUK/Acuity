-- Allow anon users to read all herald_reports (Command dashboard is an internal ops tool)
CREATE POLICY "Anon users can read all reports"
ON public.herald_reports
FOR SELECT
TO anon
USING (true);
