-- Dashboard insights cache table
-- Stores NIM-generated insights per user with 24h TTL
CREATE TABLE IF NOT EXISTS dashboard_insights (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  insights jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT dashboard_insights_user_id_key UNIQUE (user_id)
);

-- RLS policies
ALTER TABLE dashboard_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own insights"
  ON dashboard_insights FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own insights"
  ON dashboard_insights FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own insights"
  ON dashboard_insights FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own insights"
  ON dashboard_insights FOR DELETE
  USING (auth.uid() = user_id);
