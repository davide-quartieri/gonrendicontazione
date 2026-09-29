-- Optional activity timer. Existing manual entries and their policies stay unchanged.
-- All timer writes use authenticated RPCs, with ownership verified on the server.
ALTER TABLE public.entries ALTER COLUMN hours TYPE numeric(12,6);
ALTER TABLE public.entries
  ADD COLUMN entry_source text NOT NULL DEFAULT 'manual',
  ADD COLUMN timer_started_at timestamptz,
  ADD COLUMN timer_stopped_at timestamptz,
  ADD COLUMN duration_seconds integer,
  ADD COLUMN needs_details boolean NOT NULL DEFAULT false;
ALTER TABLE public.entries ADD CONSTRAINT entries_timer_fields_check CHECK (
  (entry_source = 'manual' AND timer_started_at IS NULL AND timer_stopped_at IS NULL
    AND duration_seconds IS NULL AND NOT needs_details)
  OR (entry_source = 'timer' AND timer_started_at IS NOT NULL AND timer_stopped_at IS NOT NULL
    AND timer_stopped_at > timer_started_at AND duration_seconds IS NOT NULL AND duration_seconds > 0)
);
CREATE INDEX entries_pending_timer_idx ON public.entries(created_by, date DESC)
  WHERE entry_source = 'timer' AND needs_details;

CREATE FUNCTION public.gon_save_timer(
  p_timer_id uuid, p_started_at timestamptz, p_stopped_at timestamptz, p_expected_user uuid,
  p_type text DEFAULT 'Cantiere', p_client text DEFAULT ''
) RETURNS public.entries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid();
  result public.entries;
  label text;
  seconds integer;
  entry_id text := 'timer_' || p_timer_id::text;
BEGIN
  IF actor IS NULL OR actor IS DISTINCT FROM p_expected_user OR lower(coalesce(auth.jwt()->>'email','')) NOT LIKE '%@gonsrl.it' THEN
    RAISE EXCEPTION 'Accesso GON richiesto' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(nullif(btrim(display_name),''),split_part(auth.jwt()->>'email','@',1))
    INTO label FROM public.user_profiles WHERE user_id = actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profilo GON non disponibile' USING ERRCODE = '42501'; END IF;
  IF p_timer_id IS NULL THEN RAISE EXCEPTION 'Identificativo timer mancante'; END IF;
  SELECT * INTO result FROM public.entries WHERE id = entry_id;
  IF FOUND THEN
    IF result.created_by IS DISTINCT FROM actor OR result.entry_source <> 'timer' THEN
      RAISE EXCEPTION 'Timer non accessibile' USING ERRCODE = '42501';
    END IF;
    RETURN result;
  END IF;
  IF p_started_at IS NULL OR p_stopped_at IS NULL OR NOT isfinite(p_started_at)
    OR NOT isfinite(p_stopped_at) OR p_stopped_at <= p_started_at
    OR p_started_at < '2000-01-01'::timestamptz
    OR p_stopped_at > now() + interval '5 minutes'
    OR p_stopped_at - p_started_at > interval '31 days' THEN
    RAISE EXCEPTION 'Orari timer non validi: controllare data e ora del dispositivo' USING ERRCODE = '22023';
  END IF;
  IF p_type IS NULL OR p_type NOT IN ('Cantiere','Viaggio','Ufficio') THEN
    RAISE EXCEPTION 'Tipo ore non valido' USING ERRCODE = '22023';
  END IF;
  p_client := coalesce(btrim(p_client),'');
  IF p_client <> '' AND NOT EXISTS (SELECT 1 FROM public.clients WHERE display=p_client AND active) THEN
    p_client := '';
  END IF;
  seconds := greatest(1,floor(extract(epoch FROM p_stopped_at-p_started_at))::integer);
  INSERT INTO public.entries(id,date,employee,client,type,macro,description,hours,created_by,
    entry_source,timer_started_at,timer_stopped_at,duration_seconds,needs_details)
  VALUES(entry_id,(p_started_at AT TIME ZONE 'Europe/Rome')::date,label,p_client,p_type,'Varie',
    'Attività da timer - dettagli da completare',round(seconds::numeric/3600,6),actor,
    'timer',p_started_at,p_stopped_at,seconds,true)
  ON CONFLICT (id) DO NOTHING;
  SELECT * INTO result FROM public.entries WHERE id = entry_id;
  IF result.created_by IS DISTINCT FROM actor OR result.entry_source <> 'timer' THEN
    RAISE EXCEPTION 'Timer non accessibile' USING ERRCODE = '42501';
  END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.gon_save_timer(uuid,timestamptz,timestamptz,uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gon_save_timer(uuid,timestamptz,timestamptz,uuid,text,text) TO authenticated;

CREATE FUNCTION public.gon_complete_timer(
  p_entry_id text, p_client text, p_type text, p_macro text, p_description text, p_expected_user uuid
) RETURNS public.entries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := auth.uid(); result public.entries;
BEGIN
  IF actor IS NULL OR actor IS DISTINCT FROM p_expected_user OR lower(coalesce(auth.jwt()->>'email','')) NOT LIKE '%@gonsrl.it' THEN
    RAISE EXCEPTION 'Accesso GON richiesto' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO result FROM public.entries WHERE id=p_entry_id FOR UPDATE;
  IF NOT FOUND OR result.entry_source <> 'timer' OR
    (result.created_by IS DISTINCT FROM actor AND NOT private.is_gon_admin()) THEN
    RAISE EXCEPTION 'Attività timer non accessibile' USING ERRCODE = '42501';
  END IF;
  p_client := coalesce(btrim(p_client),'');
  p_description := coalesce(btrim(p_description),'');
  IF p_client = '' OR NOT EXISTS (SELECT 1 FROM public.clients WHERE display=p_client AND active) THEN
    RAISE EXCEPTION 'Selezionare un cliente attivo' USING ERRCODE = '22023';
  END IF;
  IF p_type IS NULL OR p_type NOT IN ('Cantiere','Viaggio','Ufficio') OR p_macro IS NULL OR
     p_macro NOT IN ('Rilievo in campo','Elaborazione rilievo','Assistenza cliente','Attività amministrative','Corso','Varie')
     OR length(p_description) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'Completare tipo ore, macro area e descrizione' USING ERRCODE = '22023';
  END IF;
  IF NOT result.needs_details THEN
    IF result.client=p_client AND result.type=p_type AND result.macro=p_macro AND result.description=p_description THEN
      RETURN result;
    END IF;
    RAISE EXCEPTION 'Attività già completata: ricaricare i dati' USING ERRCODE = '40001';
  END IF;
  UPDATE public.entries SET client=p_client,type=p_type,macro=p_macro,
    description=p_description,needs_details=false WHERE id=p_entry_id RETURNING * INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.gon_complete_timer(text,text,text,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gon_complete_timer(text,text,text,text,text,uuid) TO authenticated;
