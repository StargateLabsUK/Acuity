-- Allow anon to SELECT shifts for realtime sync (shift-end detection on handhelds)
CREATE POLICY "Allow anon read shifts"
ON public.shifts
FOR SELECT
TO anon
USING (true);