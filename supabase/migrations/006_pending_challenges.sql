-- Persistent challenge storage so challenges survive socket disconnects
CREATE TABLE pending_challenges (
  id            UUID PRIMARY KEY,
  from_user_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  to_user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  from_username TEXT NOT NULL,
  mode          TEXT NOT NULL CHECK (mode IN ('ranked', 'unranked')),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE pending_challenges ENABLE ROW LEVEL SECURITY;

-- Target can see challenges sent to them
CREATE POLICY "target can view" ON pending_challenges
  FOR SELECT USING (to_user_id = auth.uid());

-- Participants can delete (accept or decline)
CREATE POLICY "participants can delete" ON pending_challenges
  FOR DELETE USING (to_user_id = auth.uid() OR from_user_id = auth.uid());

-- Enable realtime so the target gets notified instantly
ALTER PUBLICATION supabase_realtime ADD TABLE pending_challenges;
