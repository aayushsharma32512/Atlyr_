-- RLS for user_neutral_poses
ALTER TABLE user_neutral_poses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own neutral poses"
ON user_neutral_poses FOR ALL 
TO authenticated 
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Anonymous users can manage their neutral poses"
ON user_neutral_poses FOR ALL 
TO anon 
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id);

-- RLS for user_generations
ALTER TABLE user_generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own generations"
ON user_generations FOR SELECT 
TO authenticated, anon 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own generations"
ON user_generations FOR INSERT 
TO authenticated, anon 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own generations"
ON user_generations FOR UPDATE 
TO authenticated, anon 
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own generations"
ON user_generations FOR DELETE 
TO authenticated, anon 
USING (auth.uid() = user_id);