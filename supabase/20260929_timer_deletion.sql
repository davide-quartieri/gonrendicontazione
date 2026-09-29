-- No activity is deleted by this migration. Deletion happens only on user action.
CREATE TABLE private.gon_timer_deletions (
  entry_id text PRIMARY KEY,
  owner_id uuid NOT NULL,
  deleted_by uuid NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.gon_timer_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.gon_timer_deletions FROM PUBLIC, anon, authenticated;

-- Retain the validated v1 save implementation, but place it behind an atomic guard.
ALTER FUNCTION public.gon_save_timer(uuid,timestamptz,timestamptz,uuid,text,text) SET SCHEMA private;
ALTER FUNCTION private.gon_save_timer(uuid,timestamptz,timestamptz,uuid,text,text) RENAME TO gon_save_timer_record_v1;
REVOKE ALL ON FUNCTION private.gon_save_timer_record_v1(uuid,timestamptz,timestamptz,uuid,text,text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.gon_save_timer(
 p_timer_id uuid, p_started_at timestamptz, p_stopped_at timestamptz, p_expected_user uuid,
 p_type text DEFAULT 'Cantiere', p_client text DEFAULT ''
) RETURNS public.entries LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); eid text:='timer_'||p_timer_id::text;
BEGIN
 IF actor IS NULL OR actor IS DISTINCT FROM p_expected_user OR lower(coalesce(auth.jwt()->>'email','')) NOT LIKE '%@gonsrl.it' THEN
  RAISE EXCEPTION 'Accesso GON richiesto' USING ERRCODE='42501'; END IF;
 IF p_timer_id IS NULL THEN RAISE EXCEPTION 'Identificativo timer mancante' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('gon.timer.'||eid,0));
 IF EXISTS(SELECT 1 FROM private.gon_timer_deletions WHERE entry_id=eid) THEN
  RAISE EXCEPTION 'GON_TIMER_DELETED' USING ERRCODE='P0002'; END IF;
 RETURN private.gon_save_timer_record_v1(p_timer_id,p_started_at,p_stopped_at,p_expected_user,p_type,p_client);
END; $$;
REVOKE ALL ON FUNCTION public.gon_save_timer(uuid,timestamptz,timestamptz,uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gon_save_timer(uuid,timestamptz,timestamptz,uuid,text,text) TO authenticated;

CREATE FUNCTION public.gon_delete_timer(p_entry_id text,p_expected_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); record public.entries; owner uuid;
BEGIN
 IF actor IS NULL OR actor IS DISTINCT FROM p_expected_user OR lower(coalesce(auth.jwt()->>'email','')) NOT LIKE '%@gonsrl.it' THEN
  RAISE EXCEPTION 'Accesso GON richiesto' USING ERRCODE='42501'; END IF;
 IF p_entry_id IS NULL OR p_entry_id !~ '^timer_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
  RAISE EXCEPTION 'Identificativo timer non valido' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_profiles WHERE user_id=actor) THEN
  RAISE EXCEPTION 'Profilo GON richiesto' USING ERRCODE='42501'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('gon.timer.'||p_entry_id,0));
 SELECT * INTO record FROM public.entries WHERE id=p_entry_id FOR UPDATE;
 IF FOUND THEN
  IF record.entry_source<>'timer' OR (record.created_by IS DISTINCT FROM actor AND NOT private.is_gon_admin()) THEN
   RAISE EXCEPTION 'Attivita timer non accessibile' USING ERRCODE='42501'; END IF;
  owner:=record.created_by;
 ELSE
  SELECT owner_id INTO owner FROM private.gon_timer_deletions WHERE entry_id=p_entry_id;
  IF FOUND AND owner IS DISTINCT FROM actor AND NOT private.is_gon_admin() THEN
   RAISE EXCEPTION 'Attivita timer non accessibile' USING ERRCODE='42501'; END IF;
  -- Also supports cancelling an offline record before its first upload.
  owner:=coalesce(owner,actor);
 END IF;
 INSERT INTO private.gon_timer_deletions(entry_id,owner_id,deleted_by)
 VALUES(p_entry_id,owner,actor) ON CONFLICT(entry_id) DO NOTHING;
 DELETE FROM public.entries WHERE id=p_entry_id AND entry_source='timer';
 RETURN jsonb_build_object('id',p_entry_id,'deleted',true);
END; $$;
REVOKE ALL ON FUNCTION public.gon_delete_timer(text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gon_delete_timer(text,uuid) TO authenticated;

-- Cover existing administrator delete buttons too, without relaxing manual-entry RLS.
CREATE FUNCTION private.gon_record_timer_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.entry_source='timer' AND OLD.created_by IS NOT NULL THEN
  INSERT INTO private.gon_timer_deletions(entry_id,owner_id,deleted_by)
  VALUES(OLD.id,OLD.created_by,coalesce(auth.uid(),OLD.created_by)) ON CONFLICT(entry_id) DO NOTHING;
 END IF;
 RETURN OLD;
END; $$;
REVOKE ALL ON FUNCTION private.gon_record_timer_delete() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER gon_record_timer_delete AFTER DELETE ON public.entries
 FOR EACH ROW EXECUTE FUNCTION private.gon_record_timer_delete();
