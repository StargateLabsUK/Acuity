
-- Drop insecure anon policies
DROP POLICY IF EXISTS "Allow read from anon" ON herald_reports;
DROP POLICY IF EXISTS "Allow insert from anon" ON herald_reports;
DROP POLICY IF EXISTS "Anon insert" ON herald_reports;
DROP POLICY IF EXISTS "Read own session reports" ON herald_reports;

-- Add user_id column
ALTER TABLE herald_reports ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);

-- Authenticated insert
CREATE POLICY "Authenticated users can insert"
ON herald_reports FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Authenticated read own records
CREATE POLICY "Authenticated users can read own records"
ON herald_reports FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Authenticated update own records
CREATE POLICY "Authenticated users can update own records"
ON herald_reports FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

-- Command users can read all records (role-based)
CREATE POLICY "Command users can read all records"
ON herald_reports FOR SELECT
TO authenticated
USING (
  (auth.jwt() -> 'user_metadata' ->> 'role') = 'command'
);
