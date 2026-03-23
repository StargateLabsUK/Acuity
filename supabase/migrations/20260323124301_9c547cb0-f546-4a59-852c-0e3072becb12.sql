-- Allow anon read access for the command dashboard
CREATE POLICY "Allow anon read" ON public.herald_reports FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon read" ON public.incident_transmissions FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon read" ON public.shifts FOR SELECT TO anon USING (true);

-- Allow anon insert for field app sync (uses anon key via edge function headers)
CREATE POLICY "Allow anon insert" ON public.herald_reports FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon insert" ON public.incident_transmissions FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon insert" ON public.shifts FOR INSERT TO anon WITH CHECK (true);

-- Allow anon update for follow-up transmission updates
CREATE POLICY "Allow anon update" ON public.herald_reports FOR UPDATE TO anon USING (true);
CREATE POLICY "Allow anon update" ON public.incident_transmissions FOR UPDATE TO anon USING (true);
CREATE POLICY "Allow anon update" ON public.shifts FOR UPDATE TO anon USING (true);