-- Mark a single notification as read (RLS-safe: only works for the calling user's own notifications)
create or replace function mark_notification_read(p_id uuid)
returns void language sql security definer as $$
  update notifications set read = true
  where id = p_id and user_id = auth.uid();
$$;
