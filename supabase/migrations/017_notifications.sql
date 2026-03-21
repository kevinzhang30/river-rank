-- Persistent notification inbox
CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  data       JSONB NOT NULL DEFAULT '{}',
  read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_unread
  ON notifications (user_id, read, created_at DESC);

-- RLS: users see and update only their own
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_own" ON notifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "update_own" ON notifications
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Realtime delivery
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- Trigger: notify when someone adds you as a friend
CREATE OR REPLACE FUNCTION notify_friend_added()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_adder_username TEXT;
BEGIN
  -- The add_friend_by_code RPC inserts two rows: (adder, friend) and (friend, adder).
  -- auth.uid() is the adder. Only notify the row where user_id != adder.
  IF NEW.user_id = auth.uid() THEN
    RETURN NEW;
  END IF;

  SELECT username INTO v_adder_username
  FROM profiles WHERE id = NEW.friend_id;

  INSERT INTO notifications (user_id, type, data)
  VALUES (
    NEW.user_id,
    'friend_added',
    jsonb_build_object(
      'from_user_id', NEW.friend_id,
      'from_username', COALESCE(v_adder_username, 'Unknown')
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_friend_added
  AFTER INSERT ON friendships
  FOR EACH ROW EXECUTE FUNCTION notify_friend_added();

-- Trigger: notify when someone challenges you
CREATE OR REPLACE FUNCTION notify_challenge_received()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO notifications (user_id, type, data)
  VALUES (
    NEW.to_user_id,
    'challenge_received',
    jsonb_build_object(
      'from_user_id', NEW.from_user_id,
      'from_username', NEW.from_username,
      'mode', NEW.mode,
      'challenge_id', NEW.id
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_challenge_received
  AFTER INSERT ON pending_challenges
  FOR EACH ROW EXECUTE FUNCTION notify_challenge_received();

-- RPC: mark all unread notifications as read
CREATE OR REPLACE FUNCTION mark_notifications_read()
RETURNS VOID LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE notifications SET read = TRUE
  WHERE user_id = auth.uid() AND read = FALSE;
$$;
