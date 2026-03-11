-- Add friend_code to profiles
ALTER TABLE profiles ADD COLUMN friend_code TEXT UNIQUE
  DEFAULT substr(md5(random()::text), 1, 8);
UPDATE profiles SET friend_code = substr(md5(random()::text), 1, 8)
  WHERE friend_code IS NULL;
ALTER TABLE profiles ALTER COLUMN friend_code SET NOT NULL;

-- Friendships table (both directions stored for easy querying)
CREATE TABLE friendships (
  user_id    UUID REFERENCES profiles(id) ON DELETE CASCADE,
  friend_id  UUID REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, friend_id),
  CHECK (user_id <> friend_id)
);
ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_own" ON friendships FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "insert_own" ON friendships FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own" ON friendships FOR DELETE USING (auth.uid() = user_id);

-- RPC: add friend by code (bidirectional, idempotent)
CREATE OR REPLACE FUNCTION add_friend_by_code(p_friend_code TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_friend_id UUID;
  v_user_id UUID := auth.uid();
BEGIN
  SELECT id INTO v_friend_id FROM profiles WHERE friend_code = p_friend_code;
  IF v_friend_id IS NULL THEN RETURN json_build_object('error', 'not_found'); END IF;
  IF v_friend_id = v_user_id THEN RETURN json_build_object('error', 'self'); END IF;
  INSERT INTO friendships (user_id, friend_id) VALUES (v_user_id, v_friend_id) ON CONFLICT DO NOTHING;
  INSERT INTO friendships (user_id, friend_id) VALUES (v_friend_id, v_user_id) ON CONFLICT DO NOTHING;
  RETURN json_build_object('ok', true, 'friend_id', v_friend_id);
END; $$;
