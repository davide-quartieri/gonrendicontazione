-- Applied migration: add capabilities, never remove existing business data.
CREATE OR REPLACE FUNCTION private.gon_tariff_kind(m text,t text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE
 WHEN (m='Rilievo in campo' AND t IN('Cantiere','Viaggio'))
   OR (m='Elaborazione rilievo' AND t='Ufficio')
   OR (m='Assistenza cliente' AND t IN('Cantiere','Viaggio','Ufficio'))
   OR (m IN('Attività amministrative','Corso','Varie') AND t='Ufficio') THEN 'hour'
 WHEN (m='Rilievo in campo - PROGRAMMATO' AND t='Cantiere')
   OR (m='Elaborazione rilievo - PROGRAMMATA' AND t='Ufficio') THEN 'monthly'
 ELSE NULL END;
$$;
REVOKE ALL ON FUNCTION private.gon_tariff_kind(text,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.gon_commercial_rules(p_rules jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE r jsonb;k text;kind text;seen text[]:='{}';n numeric;mins integer;rm text;
BEGIN
 IF p_rules IS NULL OR jsonb_typeof(p_rules)<>'array' OR jsonb_array_length(p_rules)>11 THEN RAISE EXCEPTION 'Tariffario aggiornato: ricarica la pagina e usa le 11 voci disponibili' USING ERRCODE='22023'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_rules) LOOP
  k:=concat(r->>'macro','|',r->>'type');kind:=private.gon_tariff_kind(r->>'macro',r->>'type');
  IF kind IS NULL OR k=ANY(seen) OR (r->>'mode') IS DISTINCT FROM kind THEN RAISE EXCEPTION 'Combinazione tariffaria non disponibile oppure attivita PROGRAMMATA non a forfait' USING ERRCODE='22023'; END IF;
  n:=(r->>'price')::numeric;mins:=coalesce((r->>'round_minutes')::integer,0);rm:=coalesce(r->>'round_mode','none');
  IF n IS NOT NULL AND(n::text IN('NaN','Infinity','-Infinity') OR n<0 OR n>10000000) THEN RAISE EXCEPTION 'Tariffa non valida' USING ERRCODE='22023'; END IF;
  IF rm NOT IN('none','up','nearest') OR mins NOT IN(0,5,10,15,30,60) OR (rm<>'none' AND mins=0) OR (kind='monthly' AND(rm<>'none' OR mins<>0)) THEN RAISE EXCEPTION 'Arrotondamento non valido: non applicabile ai forfait' USING ERRCODE='22023'; END IF;
  seen:=array_append(seen,k);
 END LOOP;
 RETURN p_rules;
END $$;

ALTER TABLE private.gon_reports ADD COLUMN IF NOT EXISTS removed_at timestamptz,
 ADD COLUMN IF NOT EXISTS removed_by uuid, ADD COLUMN IF NOT EXISTS removal_reason text;
ALTER TABLE private.gon_reports DROP CONSTRAINT gon_reports_state_check;
ALTER TABLE private.gon_reports ADD CONSTRAINT gon_reports_state_check CHECK(state IN('draft','issued','sent','superseded','cancelled'));

CREATE OR REPLACE FUNCTION private.gon_remove_report(p_id uuid,p_version integer,p_reason text,p_expected_user uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid;pid uuid;r private.gon_reports;before_r jsonb;reason text;
BEGIN
 u:=private.gon_commercial_actor(p_expected_user,true);
 SELECT project_id INTO pid FROM private.gon_reports WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Rendiconto non trovato: aggiorna lo storico' USING ERRCODE='P0002'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('gon-commercial:'||pid::text,0));
 SELECT * INTO r FROM private.gon_reports WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Rendiconto non piu disponibile' USING ERRCODE='40001'; END IF;
 IF r.removed_at IS NOT NULL THEN RETURN jsonb_build_object('id',r.id,'removed',true,'state',r.state); END IF;
 IF r.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'Il rendiconto e cambiato. Aggiorna lo storico prima di eliminarlo' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM private.gon_reports WHERE replaces_id=r.id AND state='draft') THEN RAISE EXCEPTION 'Elimina prima la bozza di revisione collegata a questo documento' USING ERRCODE='22023'; END IF;
 IF r.state='draft' THEN
  RETURN private.gon_commercial('report_discard',jsonb_build_object('id',r.id,'version',r.version),u)||jsonb_build_object('removed',true,'removal','draft_deleted');
 END IF;
 IF r.state NOT IN('issued','sent','superseded') THEN RAISE EXCEPTION 'Stato del rendiconto non eliminabile' USING ERRCODE='22023'; END IF;
 reason:=btrim(coalesce(p_reason,''));
 IF length(reason) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'Indica un motivo di eliminazione (3-1000 caratteri)' USING ERRCODE='22023'; END IF;
 before_r:=to_jsonb(r);
 DELETE FROM private.gon_report_claims WHERE report_id=r.id;
 DELETE FROM private.gon_unit_claims WHERE report_id=r.id;
 UPDATE private.gon_reports SET state=CASE WHEN state IN('issued','sent') THEN 'cancelled' ELSE state END,
  removed_at=clock_timestamp(),removed_by=u,removal_reason=reason,version=version+1
 WHERE id=r.id RETURNING * INTO r;
 INSERT INTO private.gon_commercial_audit(actor,action,entity_id,before_data,after_data)
 VALUES(u,'report_remove',r.id,before_r,to_jsonb(r));
 RETURN jsonb_build_object('id',r.id,'removed',true,'state',r.state,'number',r.number,'removal','archived');
END $$;
REVOKE ALL ON FUNCTION private.gon_remove_report(uuid,integer,text,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION pg_temp.gon_patch_once(s text,a text,b text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN IF a='' OR (length(s)-length(replace(s,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Migration marker mismatch: %',left(a,120); END IF;RETURN replace(s,a,b);END $$;
DO $migration$
DECLARE s text;a text;b text;
BEGIN
 s:=pg_get_functiondef('private.gon_client_billing(text,jsonb,uuid)'::regprocedure);
 s:=pg_temp.gon_patch_once(s,$a$ u:=private.gon_commercial_actor(p_expected_user,true);$a$,$b$ u:=private.gon_commercial_actor(p_expected_user,true);
 IF p_action='report_remove' THEN
  RETURN private.gon_remove_report((pl->>'id')::uuid,(pl->>'version')::integer,pl->>'reason',u);
 END IF;$b$);
 s:=pg_temp.gon_patch_once(s,$a$IF EXISTS(SELECT 1 FROM jsonb_array_elements(pl->'rules') z WHERE coalesce(z->>'mode','')<>'hour') THEN RAISE EXCEPTION 'Il tariffario orario ammette solo tariffe a ore'; END IF;$a$,$b$PERFORM private.gon_commercial_rules(pl->'rules');$b$);
 s:=pg_temp.gon_patch_once(s,$a$WHERE private.gon_billing_client_id(p.client_id)=cid ORDER BY r.created_at DESC LIMIT 100$a$,$b$WHERE private.gon_billing_client_id(p.client_id)=cid AND r.removed_at IS NULL ORDER BY r.created_at DESC LIMIT 100$b$);
 EXECUTE s;

 s:=pg_get_functiondef('private.gon_client_report_build(uuid,date,date,jsonb,jsonb,uuid)'::regprocedure);
 a:=$a$  price:=(rule->>'price')::numeric;qty:=e.hours;minutes:=coalesce((rule->>'round_minutes')::integer,0);rounding:=coalesce(rule->>'round_mode','none');
  IF minutes>0 AND rounding<>'none' THEN qty:=CASE WHEN rounding='up' THEN ceil(e.hours*60/minutes) ELSE round(e.hours*60/minutes) END*minutes/60; END IF;
  k:='H:'||coalesce(t.id::text,'missing')||':'||md5(e.macro||'|'||e.type);g:=groups->k;
  IF g IS NULL THEN g:=jsonb_build_object('id',md5(k),'mode','hour','macro',e.macro,'type',e.type,'unit_key',NULL,'description',e.macro||' - '||e.type,'unit','h','quantity',qty,'price',price,'registered_hours',e.hours,'refs',jsonb_build_array(idx),'entry_ids',jsonb_build_array(e.id),'terms_id',t.id,'terms_version',t.version,'terms_reference',coalesce(t.reference,''),'round_minutes',minutes,'round_mode',rounding,'reason','');
  ELSE g:=g||jsonb_build_object('quantity',(g->>'quantity')::numeric+qty,'registered_hours',(g->>'registered_hours')::numeric+e.hours,'refs',(g->'refs')||jsonb_build_array(idx),'entry_ids',(g->'entry_ids')||jsonb_build_array(e.id)); END IF;$a$;
 b:=$b$  IF private.gon_tariff_kind(e.macro,e.type) IS NULL THEN
   RAISE EXCEPTION 'Voce tariffaria rimossa: % / %. Correggere la classificazione nello storico, senza perdere le ore',e.macro,e.type USING ERRCODE='22023';
  END IF;
  IF private.gon_tariff_kind(e.macro,e.type)='monthly' THEN
   price:=CASE WHEN rule->>'mode'='monthly' THEN (rule->>'price')::numeric ELSE NULL END;
   k:='PROGRAMMED_MONTH:'||md5(e.macro||'|'||e.type)||':'||to_char(e.date,'YYYY-MM');g:=groups->k;
   IF EXISTS(SELECT 1 FROM private.gon_unit_claims cl WHERE cl.project_id=pid AND cl.unit_key=k AND cl.report_id IS DISTINCT FROM replaces) THEN
    RAISE EXCEPTION 'Forfait programmato del mese gia rendicontato: usare una revisione' USING ERRCODE='23505';
   END IF;
   IF g IS NULL THEN
    g:=jsonb_build_object('id',md5(k),'mode','monthly','macro',e.macro,'type',e.type,'unit_key',k,'description',e.macro||' - Forfait '||to_char(e.date,'MM/YYYY'),'unit','mese','quantity',1,'price',price,'registered_hours',e.hours,'refs',jsonb_build_array(idx),'entry_ids',jsonb_build_array(e.id),'terms_id',t.id,'terms_version',t.version,'terms_reference',coalesce(t.reference,''),'round_minutes',0,'round_mode','none','reason','');
   ELSE
    IF (g->>'terms_id') IS DISTINCT FROM t.id::text OR (g->>'price')::numeric IS DISTINCT FROM price THEN RAISE EXCEPTION 'Condizioni diverse nello stesso mese per il forfait programmato: verificare la decorrenza' USING ERRCODE='22023'; END IF;
    g:=g||jsonb_build_object('registered_hours',(g->>'registered_hours')::numeric+e.hours,'refs',(g->'refs')||jsonb_build_array(idx),'entry_ids',(g->'entry_ids')||jsonb_build_array(e.id));
   END IF;
  ELSE
   price:=(rule->>'price')::numeric;qty:=e.hours;minutes:=coalesce((rule->>'round_minutes')::integer,0);rounding:=coalesce(rule->>'round_mode','none');
   IF minutes>0 AND rounding<>'none' THEN qty:=CASE WHEN rounding='up' THEN ceil(e.hours*60/minutes) ELSE round(e.hours*60/minutes) END*minutes/60; END IF;
   k:='H:'||coalesce(t.id::text,'missing')||':'||md5(e.macro||'|'||e.type);g:=groups->k;
   IF g IS NULL THEN g:=jsonb_build_object('id',md5(k),'mode','hour','macro',e.macro,'type',e.type,'unit_key',NULL,'description',e.macro||' - '||e.type,'unit','h','quantity',qty,'price',price,'registered_hours',e.hours,'refs',jsonb_build_array(idx),'entry_ids',jsonb_build_array(e.id),'terms_id',t.id,'terms_version',t.version,'terms_reference',coalesce(t.reference,''),'round_minutes',minutes,'round_mode',rounding,'reason','');
   ELSE g:=g||jsonb_build_object('quantity',(g->>'quantity')::numeric+qty,'registered_hours',(g->>'registered_hours')::numeric+e.hours,'refs',(g->'refs')||jsonb_build_array(idx),'entry_ids',(g->'entry_ids')||jsonb_build_array(e.id)); END IF;
  END IF;$b$;
 s:=pg_temp.gon_patch_once(s,a,b);
 s:=pg_temp.gon_patch_once(s,$a$'schema_version',2,'model','economic-v2'$a$,$b$'schema_version',2,'pricing_catalog_version','tariffs-1.0.0','model','economic-v2'$b$);
 EXECUTE s;

 s:=pg_get_functiondef('private.gon_commercial(text,jsonb,uuid)'::regprocedure);
 s:=pg_temp.gon_patch_once(s,$a$ ELSIF p_action='report_issue' THEN
  d:=private.gon_price_document(d);$a$,$b$ ELSIF p_action='report_issue' THEN
  IF NOT coalesce((d->>'revision_snapshot')::boolean,false)
   AND d->>'pricing_catalog_version' IS DISTINCT FROM 'tariffs-1.0.0'
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(d->'activities') a
    WHERE private.gon_tariff_kind(a->>'macro',a->>'type') IS DISTINCT FROM 'hour') THEN
   RAISE EXCEPTION 'Tariffario aggiornato: usa Aggiorna da attivita e listino prima di emettere la bozza' USING ERRCODE='22023';
  END IF;
  d:=private.gon_price_document(d);$b$);
 EXECUTE s;
END $migration$;
