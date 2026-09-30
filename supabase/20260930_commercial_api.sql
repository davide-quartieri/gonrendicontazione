CREATE FUNCTION private.gon_commercial(p_action text,p_payload jsonb,p_expected_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid; pid uuid; entity uuid; proj public.gon_projects; previous_proj public.gon_projects;
 t private.gon_terms; old_t private.gon_terms; r private.gon_reports; old_r private.gon_reports;
 x jsonb; a jsonb; base_line jsonb; edited jsonb; lines jsonb; d jsonb; before_d jsonb; result jsonb;
 df date; dt date; n integer; v integer; changes integer; counter integer; y integer;
 q numeric; price numeric; h text; s text; expected integer;
BEGIN
 u:=private.gon_commercial_actor(p_expected_user,true);
 p_payload:=coalesce(p_payload,'{}');
 IF jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>3000000 THEN RAISE EXCEPTION 'Richiesta non valida'; END IF;
 IF p_action='project_save' THEN
  entity:=coalesce(nullif(p_payload->>'id','')::uuid,gen_random_uuid());
  PERFORM pg_advisory_xact_lock(hashtextextended('gon-commercial:'||entity::text,0));
  SELECT * INTO previous_proj FROM public.gon_projects WHERE id=entity FOR UPDATE;
  IF FOUND THEN
   IF previous_proj.version IS DISTINCT FROM (p_payload->>'version')::integer THEN RAISE EXCEPTION 'Commessa modificata da un altro operatore' USING ERRCODE='40001'; END IF;
   IF previous_proj.client_id IS DISTINCT FROM p_payload->>'client_id' AND
     (EXISTS(SELECT 1 FROM public.entries WHERE project_id=entity) OR EXISTS(SELECT 1 FROM private.gon_terms WHERE project_id=entity) OR EXISTS(SELECT 1 FROM private.gon_reports WHERE project_id=entity)) THEN
    RAISE EXCEPTION 'Cliente non modificabile per una commessa gia utilizzata'; END IF;
   UPDATE public.gon_projects SET client_id=p_payload->>'client_id',code=btrim(p_payload->>'code'),name=btrim(p_payload->>'name'),
    order_ref=left(coalesce(p_payload->>'order_ref',''),500),active=coalesce((p_payload->>'active')::boolean,true),version=version+1,updated_at=now()
    WHERE id=entity RETURNING * INTO proj;
  ELSE
   INSERT INTO public.gon_projects(id,client_id,code,name,order_ref,active) VALUES(entity,p_payload->>'client_id',btrim(p_payload->>'code'),btrim(p_payload->>'name'),
     left(coalesce(p_payload->>'order_ref',''),500),coalesce((p_payload->>'active')::boolean,true)) RETURNING * INTO proj;
  END IF;
  INSERT INTO private.gon_commercial_audit(actor,action,entity_id,before_data,after_data) VALUES(u,p_action,entity,to_jsonb(previous_proj),to_jsonb(proj));
  RETURN to_jsonb(proj);
 END IF;
 IF p_action='overview' THEN
  pid:=(p_payload->>'project_id')::uuid;df:=(p_payload->>'from')::date;dt:=(p_payload->>'to')::date;
  SELECT * INTO proj FROM public.gon_projects WHERE id=pid;
  IF NOT FOUND OR df IS NULL OR dt IS NULL OR df>dt THEN RAISE EXCEPTION 'Seleziona commessa e periodo'; END IF;
  SELECT count(*) INTO n FROM public.entries e JOIN public.clients c ON c.display=e.client
   WHERE c.id=proj.client_id AND e.date BETWEEN df AND dt AND (e.project_id IS NULL OR e.project_id=pid);
  IF n>5000 THEN RAISE EXCEPTION 'Periodo troppo ampio: massimo 5000 attivita per verifica'; END IF;
  SELECT jsonb_build_object('project',to_jsonb(proj),
    'terms',coalesce((SELECT jsonb_agg(to_jsonb(z) ORDER BY z.version DESC) FROM private.gon_terms z WHERE z.project_id=pid),'[]'::jsonb),
    'entries',coalesce((SELECT jsonb_agg(to_jsonb(e)||jsonb_build_object('billed_report_id',c.report_id,'billed_number',rr.number) ORDER BY e.date,e.id)
      FROM public.entries e JOIN public.clients cl ON cl.display=e.client
      LEFT JOIN private.gon_report_claims c ON c.entry_id=e.id LEFT JOIN private.gon_reports rr ON rr.id=c.report_id
      WHERE cl.id=proj.client_id AND e.date BETWEEN df AND dt AND (e.project_id IS NULL OR e.project_id=pid)),'[]'::jsonb),
    'reports',coalesce((SELECT jsonb_agg(z.info ORDER BY z.created_at DESC) FROM (
      SELECT rr.created_at,jsonb_build_object('id',rr.id,'number',rr.number,'revision',rr.revision,'state',rr.state,'version',rr.version,
       'from',rr.period_from,'to',rr.period_to,'created_at',rr.created_at,'issued_at',rr.issued_at,'sent_at',rr.sent_at,'sent_to',rr.sent_to,
       'totals',rr.document->'totals','source_changes',(SELECT count(*) FROM jsonb_array_elements(rr.document->'activities') src(value)
          LEFT JOIN public.entries e ON e.id=src.value->>'id' WHERE e.id IS NULL OR e.edit_version IS DISTINCT FROM (src.value->>'edit_version')::integer)) info
      FROM private.gon_reports rr WHERE rr.project_id=pid ORDER BY rr.created_at DESC LIMIT 100) z),'[]'::jsonb)) INTO result;
  RETURN result;
 END IF;
 IF p_action='terms_save' THEN
  pid:=(p_payload->>'project_id')::uuid;entity:=(p_payload->>'id')::uuid;df:=(p_payload->>'valid_from')::date;dt:=nullif(p_payload->>'valid_to','')::date;
  IF entity IS NULL OR df IS NULL OR NOT isfinite(df) OR df<'2000-01-01' OR df>'2100-12-31' OR (dt IS NOT NULL AND (NOT isfinite(dt) OR dt<df OR dt>'2100-12-31')) THEN RAISE EXCEPTION 'Validita condizioni non corretta'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('gon-commercial:'||pid::text,0));
  SELECT * INTO t FROM private.gon_terms WHERE id=entity;
  IF FOUND THEN RETURN to_jsonb(t); END IF;
  SELECT * INTO proj FROM public.gon_projects WHERE id=pid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commessa non trovata'; END IF;
  SELECT * INTO old_t FROM private.gon_terms WHERE project_id=pid AND NOT superseded ORDER BY version DESC LIMIT 1 FOR UPDATE;
  IF old_t.id IS DISTINCT FROM nullif(p_payload->>'expected_terms_id','')::uuid THEN RAISE EXCEPTION 'Condizioni modificate: aggiorna prima di salvare' USING ERRCODE='40001'; END IF;
  IF old_t.id IS NOT NULL THEN
   IF df<old_t.valid_from THEN RAISE EXCEPTION 'La nuova decorrenza precede l ultima versione. Rettificare il rendiconto senza riscrivere lo storico'; END IF;
   IF df=old_t.valid_from THEN UPDATE private.gon_terms SET superseded=true WHERE id=old_t.id;
   ELSE UPDATE private.gon_terms SET valid_to=least(coalesce(valid_to,df-1),df-1) WHERE id=old_t.id; END IF;
  END IF;
  SELECT coalesce(max(version),0)+1 INTO v FROM private.gon_terms WHERE project_id=pid;
  INSERT INTO private.gon_terms(id,project_id,version,valid_from,valid_to,reference,notes,rules,created_by)
   VALUES(entity,pid,v,df,dt,left(coalesce(p_payload->>'reference',''),500),left(coalesce(p_payload->>'notes',''),4000),private.gon_commercial_rules(p_payload->'rules'),u) RETURNING * INTO t;
  INSERT INTO private.gon_commercial_audit(actor,action,entity_id,before_data,after_data) VALUES(u,p_action,entity,to_jsonb(old_t),to_jsonb(t));
  RETURN to_jsonb(t);
 END IF;
 IF p_action='report_prepare' THEN
  pid:=(p_payload->>'project_id')::uuid;entity:=(p_payload->>'id')::uuid;df:=(p_payload->>'from')::date;dt:=(p_payload->>'to')::date;
  IF entity IS NULL THEN RAISE EXCEPTION 'Identificativo richiesta mancante'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('gon-commercial:'||pid::text,0));
  SELECT * INTO r FROM private.gon_reports WHERE id=entity;
  IF FOUND THEN
   IF r.document->>'request_hash' IS DISTINCT FROM md5(p_payload::text) THEN RAISE EXCEPTION 'Richiesta gia usata con parametri diversi'; END IF;
   RETURN to_jsonb(r);
  END IF;
  SELECT * INTO old_r FROM private.gon_reports WHERE id=nullif(p_payload->>'replaces_id','')::uuid FOR UPDATE;
  IF p_payload->>'replaces_id' IS NOT NULL AND p_payload->>'replaces_id'<>'' AND
    (old_r.id IS NULL OR old_r.project_id<>pid OR old_r.state NOT IN ('issued','sent')) THEN RAISE EXCEPTION 'Revisione di un documento non disponibile'; END IF;
  d:=private.gon_report_build(pid,df,dt,p_payload->'entry_ids',p_payload->'header',old_r.id)||jsonb_build_object('request_hash',md5(p_payload::text),'revision_snapshot',false);
  INSERT INTO private.gon_reports(id,project_id,period_from,period_to,replaces_id,revision,document,created_by)
   VALUES(entity,pid,df,dt,old_r.id,CASE WHEN old_r.id IS NULL THEN 0 ELSE old_r.revision+1 END,d,u) RETURNING * INTO r;
  INSERT INTO private.gon_commercial_audit(actor,action,entity_id,after_data) VALUES(u,p_action,entity,to_jsonb(r));
  RETURN to_jsonb(r);
 END IF;
 entity:=(p_payload->>'id')::uuid;
 SELECT project_id INTO pid FROM private.gon_reports WHERE id=entity;
 IF NOT FOUND THEN RAISE EXCEPTION 'Rendiconto non trovato'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gon-commercial:'||pid::text,0));
 SELECT * INTO r FROM private.gon_reports WHERE id=entity FOR UPDATE;
 IF p_action='report_get' THEN
  SELECT count(*) INTO changes FROM jsonb_array_elements(r.document->'activities') src(value) LEFT JOIN public.entries e ON e.id=src.value->>'id'
   WHERE e.id IS NULL OR e.edit_version IS DISTINCT FROM (src.value->>'edit_version')::integer;
  RETURN to_jsonb(r)||jsonb_build_object('source_changes',changes);
 END IF;
 IF p_action='report_revise' THEN
  IF r.state NOT IN ('issued','sent') THEN RAISE EXCEPTION 'Si puo revisionare solo l ultima versione emessa'; END IF;
  SELECT * INTO old_r FROM private.gon_reports WHERE id=(p_payload->>'new_id')::uuid;
  IF FOUND THEN IF old_r.replaces_id=r.id THEN RETURN to_jsonb(old_r); ELSE RAISE EXCEPTION 'Identificativo gia usato'; END IF; END IF;
  d:=(r.document-'number'-'revision'-'issued_at')||jsonb_build_object('revision_snapshot',true);
  INSERT INTO private.gon_reports(id,project_id,period_from,period_to,replaces_id,revision,document,created_by)
    VALUES((p_payload->>'new_id')::uuid,r.project_id,r.period_from,r.period_to,r.id,r.revision+1,d,u) RETURNING * INTO old_r;
  INSERT INTO private.gon_commercial_audit(actor,action,entity_id,before_data,after_data) VALUES(u,p_action,old_r.id,to_jsonb(r),to_jsonb(old_r));
  RETURN to_jsonb(old_r);
 END IF;
 IF p_action='report_issue' AND r.state IN ('issued','sent') THEN RETURN to_jsonb(r); END IF;
 IF r.version IS DISTINCT FROM (p_payload->>'version')::integer THEN RAISE EXCEPTION 'Bozza modificata da un altro operatore. Riaprirla prima di continuare' USING ERRCODE='40001'; END IF;
 before_d:=to_jsonb(r);d:=r.document;
 IF p_action IN ('report_save','report_recalculate','report_discard','report_issue') AND r.state<>'draft' THEN RAISE EXCEPTION 'Documento emesso non modificabile: creare una revisione'; END IF;
 IF p_action='report_discard' THEN
  DELETE FROM private.gon_reports WHERE id=r.id;
  INSERT INTO private.gon_commercial_audit(actor,action,entity_id,before_data) VALUES(u,p_action,entity,before_d);
  RETURN jsonb_build_object('id',entity,'discarded',true);
 ELSIF p_action='report_save' THEN
  a:=p_payload->'lines';lines:='[]';
  IF jsonb_typeof(a)<>'array' OR jsonb_array_length(a)<>jsonb_array_length(d->'source_lines') THEN RAISE EXCEPTION 'Elenco prestazioni non coerente con la bozza'; END IF;
  IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(a))<>jsonb_array_length(a) THEN RAISE EXCEPTION 'Prestazioni duplicate'; END IF;
  FOR base_line IN SELECT value FROM jsonb_array_elements(d->'source_lines') LOOP
   SELECT value INTO edited FROM jsonb_array_elements(a) WHERE value->>'id'=base_line->>'id';
   IF NOT FOUND THEN RAISE EXCEPTION 'Prestazione mancante'; END IF;
   q:=(edited->>'quantity')::numeric;price:=(edited->>'price')::numeric;
   IF (q IS DISTINCT FROM (base_line->>'quantity')::numeric OR price IS DISTINCT FROM (base_line->>'price')::numeric)
     AND length(btrim(coalesce(edited->>'reason','')))<3 THEN
    RAISE EXCEPTION 'Indicare il motivo delle rettifiche di quantita o tariffa (anche se mancante)'; END IF;
   lines:=lines||jsonb_build_array(base_line||jsonb_build_object('description',left(coalesce(edited->>'description',''),4000),
     'quantity',q,'price',price,'reason',left(coalesce(edited->>'reason',''),1000)));
  END LOOP;
  a:=d->'header';
  FOREACH s IN ARRAY ARRAY['summary','deliverables','notes','contact','recipient_contact','recipient_address','issuer'] LOOP
   IF p_payload->'header' ? s THEN a:=jsonb_set(a,ARRAY[s],to_jsonb(left(coalesce(p_payload->'header'->>s,''),4000)),true); END IF;
  END LOOP;
  d:=private.gon_price_document(d||jsonb_build_object('lines',lines,'header',a,'expenses',coalesce(p_payload->'expenses','[]'),'discount_percent',p_payload->'discount_percent'));
 ELSIF p_action='report_recalculate' THEN
  SELECT jsonb_agg(value->>'id') INTO a FROM jsonb_array_elements(d->'activities');
  d:=private.gon_report_build(r.project_id,r.period_from,r.period_to,a,d->'header',r.replaces_id)
    ||jsonb_build_object('expenses',r.document->'expenses','discount_percent',r.document->'discount_percent','revision_snapshot',false);
  d:=private.gon_price_document(d);
 ELSIF p_action='report_issue' THEN
  d:=private.gon_price_document(d);
  IF (d->'totals'->>'missing_rates')::integer>0 THEN RAISE EXCEPTION 'Tariffe da definire: impossibile emettere il rendiconto'; END IF;
  IF length(btrim(coalesce(d->'header'->>'summary','')))=0 THEN RAISE EXCEPTION 'Inserire la sintesi delle attivita prima di emettere'; END IF;
  IF r.replaces_id IS NOT NULL THEN
   SELECT * INTO old_r FROM private.gon_reports WHERE id=r.replaces_id FOR UPDATE;
   IF old_r.state NOT IN ('issued','sent') THEN RAISE EXCEPTION 'Esiste gia una revisione successiva' USING ERRCODE='40001'; END IF;
  END IF;
  -- Lock all live source entries in stable order. A deleted source is a conflict
  -- except for an explicitly copied issued snapshot revision.
  PERFORM 1 FROM public.entries e WHERE id IN (SELECT value->>'id' FROM jsonb_array_elements(d->'activities')) ORDER BY id FOR UPDATE;
  IF NOT coalesce((d->>'revision_snapshot')::boolean,false) THEN
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(d->'activities') src(value) LEFT JOIN public.entries e ON e.id=src.value->>'id'
      WHERE e.id IS NULL OR e.edit_version IS DISTINCT FROM (src.value->>'edit_version')::integer OR e.project_id IS DISTINCT FROM r.project_id OR e.needs_details) THEN
    RAISE EXCEPTION 'Registrazioni modificate dopo la bozza. Verificare e ricalcolare esplicitamente' USING ERRCODE='40001'; END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(d->'activities') src(value) JOIN private.gon_report_claims c ON c.entry_id=src.value->>'id'
    WHERE c.report_id IS DISTINCT FROM r.replaces_id) THEN RAISE EXCEPTION 'Attivita gia incluse in un altro rendiconto' USING ERRCODE='23505'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(d->'lines') src(value) JOIN private.gon_unit_claims c ON c.project_id=r.project_id AND c.unit_key=src.value->>'unit_key'
    WHERE c.report_id IS DISTINCT FROM r.replaces_id) THEN RAISE EXCEPTION 'Forfait o canone gia addebitato: usare una revisione' USING ERRCODE='23505'; END IF;
  IF r.replaces_id IS NULL THEN
   y:=extract(year FROM (now() AT TIME ZONE 'Europe/Rome'))::integer;
   INSERT INTO private.gon_report_numbers(year,last_number) VALUES(y,1) ON CONFLICT(year) DO UPDATE
     SET last_number=private.gon_report_numbers.last_number+1 RETURNING last_number INTO counter;
   r.number:='RC-'||y||'-'||lpad(counter::text,4,'0');
  ELSE
   r.number:=old_r.number;
   DELETE FROM private.gon_report_claims WHERE report_id=old_r.id;
   DELETE FROM private.gon_unit_claims WHERE report_id=old_r.id;
   UPDATE private.gon_reports SET state='superseded',version=version+1 WHERE id=old_r.id;
  END IF;
  INSERT INTO private.gon_report_claims(entry_id,report_id) SELECT value->>'id',r.id FROM jsonb_array_elements(d->'activities');
  INSERT INTO private.gon_unit_claims(project_id,unit_key,report_id) SELECT r.project_id,value->>'unit_key',r.id
    FROM jsonb_array_elements(d->'lines') WHERE value->>'unit_key' IS NOT NULL;
  r.state:='issued';r.issued_at:=now();
  d:=d||jsonb_build_object('number',r.number,'revision',r.revision,'issued_at',r.issued_at);
 ELSIF p_action='report_sent' THEN
  IF r.state NOT IN ('issued','sent') OR length(btrim(coalesce(p_payload->>'sent_to',''))) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'Emettere il documento e indicare il destinatario'; END IF;
  r.state:='sent';r.sent_at:=now();r.sent_to:=btrim(p_payload->>'sent_to');
 ELSE RAISE EXCEPTION 'Operazione commerciale non riconosciuta' USING ERRCODE='22023';
 END IF;
 UPDATE private.gon_reports SET document=d,state=r.state,number=r.number,issued_at=r.issued_at,sent_at=r.sent_at,sent_to=r.sent_to,version=version+1
  WHERE id=r.id RETURNING * INTO r;
 INSERT INTO private.gon_commercial_audit(actor,action,entity_id,before_data,after_data) VALUES(u,p_action,entity,before_d,to_jsonb(r));
 RETURN to_jsonb(r);
END $$;
REVOKE ALL ON FUNCTION private.gon_commercial(text,jsonb,uuid) FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.gon_commercial(text,jsonb,uuid) TO authenticated;
CREATE FUNCTION public.gon_commercial(p_action text,p_payload jsonb,p_expected_user uuid) RETURNS jsonb
 LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.gon_commercial(p_action,p_payload,p_expected_user); $$;
REVOKE ALL ON FUNCTION public.gon_commercial(text,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gon_commercial(text,jsonb,uuid) TO authenticated;
