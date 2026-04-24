ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access"
ON companies
FOR SELECT
USING (true);
