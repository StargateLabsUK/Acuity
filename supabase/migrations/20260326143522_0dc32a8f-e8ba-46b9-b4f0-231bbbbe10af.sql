-- Allow anon to SELECT casualty_dispositions for realtime
CREATE POLICY "Allow anon read casualty_dispositions"
ON public.casualty_dispositions
FOR SELECT
TO anon
USING (true);

-- Enable realtime on casualty_dispositions
ALTER PUBLICATION supabase_realtime ADD TABLE public.casualty_dispositions;