-- Additive commercial module. Existing activities are NOT automatically assigned.
-- Financial tables are private; all writes use checked, versioned RPC operations.
CREATE TABLE public.gon_projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL REFERENCES public.clients(id),
 code text NOT NULL UNIQUE CHECK(length(btrim(code)) BETWEEN 1 AND 64),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 180),
 order_ref text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.gon_projects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gon_projects FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.gon_projects TO authenticated;
CREATE POLICY gon_projects_read ON public.gon_projects FOR SELECT TO authenticated
 USING (auth.uid() IS NOT NULL AND lower(coalesce(auth.jwt()->>'email','')) LIKE '%@gonsrl.it');
ALTER TABLE public.entries ADD COLUMN project_id uuid REFERENCES public.gon_projects(id);
CREATE INDEX entries_project_date_idx ON public.entries(project_id,date,id);

CREATE TABLE private.gon_terms (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES public.gon_projects(id),
 version integer NOT NULL, valid_from date NOT NULL, valid_to date,
 reference text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '', rules jsonb NOT NULL,
 superseded boolean NOT NULL DEFAULT false,
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,version), CHECK(valid_to IS NULL OR valid_to>=valid_from)
);
CREATE TABLE private.gon_reports (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES public.gon_projects(id),
 period_from date NOT NULL, period_to date NOT NULL, version integer NOT NULL DEFAULT 1,
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','issued','sent','superseded')),
 number text, revision integer NOT NULL DEFAULT 0,
 replaces_id uuid REFERENCES private.gon_reports(id), document jsonb NOT NULL,
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 issued_at timestamptz, sent_at timestamptz, sent_to text,
 CHECK(period_to>=period_from), UNIQUE(number,revision)
);
CREATE INDEX gon_reports_project_idx ON private.gon_reports(project_id,created_at DESC);
CREATE TABLE private.gon_report_claims (
 entry_id text PRIMARY KEY, report_id uuid NOT NULL REFERENCES private.gon_reports(id)
);
CREATE TABLE private.gon_unit_claims (
 project_id uuid NOT NULL REFERENCES public.gon_projects(id), unit_key text NOT NULL,
 report_id uuid NOT NULL REFERENCES private.gon_reports(id), PRIMARY KEY(project_id,unit_key)
);
CREATE TABLE private.gon_report_numbers (year integer PRIMARY KEY,last_number integer NOT NULL);
CREATE TABLE private.gon_commercial_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor uuid NOT NULL,
 at timestamptz NOT NULL DEFAULT now(), action text NOT NULL, entity_id uuid,
 before_data jsonb, after_data jsonb
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['gon_terms','gon_reports','gon_report_claims','gon_unit_claims','gon_report_numbers','gon_commercial_audit'] LOOP
  EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON private.%I FROM PUBLIC,anon,authenticated',t);
 END LOOP;
END $$;

CREATE FUNCTION private.gon_commercial_actor(p_expected uuid,p_admin boolean DEFAULT true)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid:=auth.uid(); BEGIN
 IF u IS NULL OR u IS DISTINCT FROM p_expected OR lower(coalesce(auth.jwt()->>'email','')) NOT LIKE '%@gonsrl.it'
 OR NOT EXISTS(SELECT 1 FROM public.user_profiles WHERE user_id=u) THEN
  RAISE EXCEPTION 'Accesso GON richiesto' USING ERRCODE='42501';
 END IF;
 IF p_admin AND NOT private.is_gon_admin() THEN
  RAISE EXCEPTION 'Funzione riservata agli amministratori' USING ERRCODE='42501';
 END IF;
 RETURN u;
END $$;
REVOKE ALL ON FUNCTION private.gon_commercial_actor(uuid,boolean) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.gon_check_entry_project() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.client IS DISTINCT FROM OLD.client AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id THEN
  -- A client change invalidates its old assignment. Never carry it into another client.
  NEW.project_id:=NULL;
 END IF;
 IF NEW.project_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.client IS DISTINCT FROM OLD.client) THEN
  IF NOT EXISTS(SELECT 1 FROM public.gon_projects p JOIN public.clients c ON c.id=p.client_id
      WHERE p.id=NEW.project_id AND p.active AND c.display=NEW.client) THEN
   RAISE EXCEPTION 'Commessa non attiva o non appartenente al cliente selezionato' USING ERRCODE='22023';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.gon_check_entry_project() FROM PUBLIC,anon,authenticated;
-- Alphabetical order before the existing edit/audit trigger.
CREATE TRIGGER gon_00_check_entry_project BEFORE INSERT OR UPDATE ON public.entries
 FOR EACH ROW EXECUTE FUNCTION private.gon_check_entry_project();

CREATE FUNCTION public.gon_assign_projects(p_links jsonb,p_expected_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid; x jsonb; e public.entries; pid uuid; answer jsonb:='[]'; BEGIN
 u:=private.gon_commercial_actor(p_expected_user,false);
 IF jsonb_typeof(p_links)<>'array' OR jsonb_array_length(p_links) NOT BETWEEN 1 AND 500 THEN
  RAISE EXCEPTION 'Seleziona da 1 a 500 attivita' USING ERRCODE='22023'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_links) ORDER BY value->>'id' LOOP
  SELECT * INTO e FROM public.entries WHERE id=x->>'id' FOR UPDATE;
  IF NOT FOUND OR (e.created_by IS DISTINCT FROM u AND NOT private.is_gon_admin()) THEN
   RAISE EXCEPTION 'Attivita non accessibile' USING ERRCODE='42501'; END IF;
  IF e.edit_version IS DISTINCT FROM (x->>'version')::integer THEN
   RAISE EXCEPTION 'Attivita modificata: aggiorna elenco prima di assegnare' USING ERRCODE='40001'; END IF;
  pid:=nullif(x->>'project_id','')::uuid;
  IF e.project_id IS DISTINCT FROM pid THEN
   UPDATE public.entries SET project_id=pid WHERE id=e.id RETURNING * INTO e;
  END IF;
  answer:=answer||jsonb_build_array(jsonb_build_object('id',e.id,'project_id',e.project_id,'edit_version',e.edit_version));
 END LOOP;
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION public.gon_assign_projects(jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gon_assign_projects(jsonb,uuid) TO authenticated;

CREATE FUNCTION private.gon_commercial_rules(p_rules jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE r jsonb; seen text[]:='{}'; k text; n numeric; BEGIN
 IF jsonb_typeof(p_rules)<>'array' OR jsonb_array_length(p_rules)>24 THEN
  RAISE EXCEPTION 'Tariffario non valido' USING ERRCODE='22023'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_rules) LOOP
  k:=concat(r->>'macro','|',r->>'type');
  IF r->>'macro' IS NULL OR r->>'macro' NOT IN ('Rilievo in campo','Elaborazione rilievo','Assistenza cliente','Attività amministrative','Corso','Varie','Rilievo in campo - PROGRAMMATO','Elaborazione rilievo - PROGRAMMATA')
    OR r->>'type' IS NULL OR r->>'type' NOT IN ('Cantiere','Viaggio','Ufficio') OR k=ANY(seen)
    OR coalesce(r->>'mode','') NOT IN ('hour','fixed','monthly')
    OR coalesce(r->>'round_mode','none') NOT IN ('none','up','nearest')
    OR coalesce((r->>'round_minutes')::integer,0) NOT IN (0,5,10,15,30,60) THEN
   RAISE EXCEPTION 'Controlla macroarea, tipo ore, modalita e arrotondamento' USING ERRCODE='22023'; END IF;
  n:=(r->>'price')::numeric;
  IF n IS NOT NULL AND (n::text IN ('NaN','Infinity','-Infinity') OR n<0 OR n>10000000) THEN
   RAISE EXCEPTION 'Tariffa non valida' USING ERRCODE='22023'; END IF;
  seen:=array_append(seen,k);
 END LOOP;
 RETURN p_rules;
END $$;
REVOKE ALL ON FUNCTION private.gon_commercial_rules(jsonb) FROM PUBLIC,anon,authenticated;
