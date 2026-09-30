-- Deterministic money calculations and immutable report snapshots.
CREATE FUNCTION private.gon_price_document(d jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE l jsonb; a jsonb:='[]'; ex jsonb:='[]'; q numeric; p numeric; n numeric;
 subtotal numeric:=0; expenses numeric:=0; missing integer:=0; discount numeric; deduction numeric;
BEGIN
 IF jsonb_typeof(d->'lines')<>'array' OR jsonb_array_length(d->'lines')>1500 THEN
  RAISE EXCEPTION 'Righe economiche non valide' USING ERRCODE='22023'; END IF;
 FOR l IN SELECT value FROM jsonb_array_elements(d->'lines') LOOP
  q:=(l->>'quantity')::numeric; p:=(l->>'price')::numeric;
  IF q IS NULL OR q::text IN ('NaN','Infinity','-Infinity') OR q<0 OR q>1000000
   OR (p IS NOT NULL AND (p::text IN ('NaN','Infinity','-Infinity') OR p<0 OR p>10000000))
   OR length(btrim(coalesce(l->>'description',''))) NOT BETWEEN 1 AND 4000 THEN
   RAISE EXCEPTION 'Quantita, tariffa o descrizione non valida' USING ERRCODE='22023'; END IF;
  q:=round(q,6); p:=round(p,4); n:=round(q*p,2);
  IF p IS NULL THEN missing:=missing+1; ELSE subtotal:=subtotal+n; END IF;
  a:=a||jsonb_build_array(l||jsonb_build_object('quantity',q,'price',p,'amount',n));
 END LOOP;
 IF jsonb_typeof(coalesce(d->'expenses','[]'))<>'array' OR jsonb_array_length(coalesce(d->'expenses','[]'))>100 THEN
  RAISE EXCEPTION 'Spese non valide' USING ERRCODE='22023'; END IF;
 FOR l IN SELECT value FROM jsonb_array_elements(coalesce(d->'expenses','[]')) LOOP
  n:=(l->>'amount')::numeric;
  IF n IS NULL OR n::text IN ('NaN','Infinity','-Infinity') OR n<0 OR n>10000000
    OR length(btrim(coalesce(l->>'description',''))) NOT BETWEEN 1 AND 1000 THEN
   RAISE EXCEPTION 'Importo o descrizione spesa non valido' USING ERRCODE='22023'; END IF;
  n:=round(n,2); expenses:=expenses+n;
  ex:=ex||jsonb_build_array(jsonb_build_object('description',btrim(l->>'description'),'reference',left(coalesce(l->>'reference',''),500),'amount',n));
 END LOOP;
 discount:=coalesce((d->>'discount_percent')::numeric,0);
 IF discount::text IN ('NaN','Infinity','-Infinity') OR discount<0 OR discount>100 THEN
  RAISE EXCEPTION 'Sconto non valido: indicare una percentuale da 0 a 100' USING ERRCODE='22023'; END IF;
 discount:=round(discount,4);deduction:=round(subtotal*discount/100,2);
 RETURN d||jsonb_build_object('lines',a,'expenses',ex,'discount_percent',discount,'currency','EUR',
  'totals',jsonb_build_object('services',subtotal,'discount',deduction,'expenses',expenses,
   'net',CASE WHEN missing=0 THEN subtotal-deduction+expenses ELSE NULL END,'missing_rates',missing));
END $$;
REVOKE ALL ON FUNCTION private.gon_price_document(jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.gon_report_build(pid uuid,df date,dt date,ids jsonb,head jsonb,replaces uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE proj public.gon_projects; customer public.clients; e public.entries; term private.gon_terms;
 r jsonb; g jsonb; groups jsonb:='{}'; acts jsonb:='[]'; lines jsonb;
 k text; billing_key text; mode text; price numeric; qty numeric; minutes integer; rounding text; idx integer:=0;
 expected integer; doc jsonb; logo text;
BEGIN
 IF df IS NULL OR dt IS NULL OR NOT isfinite(df) OR NOT isfinite(dt) OR dt<df OR df<'2000-01-01' OR dt>'2100-12-31'
 OR jsonb_typeof(ids)<>'array' OR jsonb_array_length(ids) NOT BETWEEN 1 AND 1500 THEN
  RAISE EXCEPTION 'Seleziona periodo e da 1 a 1500 attivita complete' USING ERRCODE='22023'; END IF;
 expected:=jsonb_array_length(ids);
 IF expected<>(SELECT count(DISTINCT value) FROM jsonb_array_elements_text(ids)) THEN RAISE EXCEPTION 'Attivita duplicate nella selezione'; END IF;
 SELECT * INTO proj FROM public.gon_projects WHERE id=pid;
 IF NOT FOUND THEN RAISE EXCEPTION 'Commessa non trovata'; END IF;
 SELECT * INTO customer FROM public.clients WHERE id=proj.client_id;
 FOR e IN SELECT * FROM public.entries WHERE id IN (SELECT value FROM jsonb_array_elements_text(ids)) ORDER BY date,id LOOP
  IF e.project_id IS DISTINCT FROM pid OR e.client IS DISTINCT FROM customer.display OR e.date<df OR e.date>dt
   OR e.needs_details OR btrim(e.description)='' THEN
   RAISE EXCEPTION 'La selezione contiene attivita incomplete, fuori periodo o di altra commessa' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM private.gon_report_claims c WHERE c.entry_id=e.id AND c.report_id IS DISTINCT FROM replaces) THEN
   RAISE EXCEPTION 'Attivita gia rendicontata. Preparare una revisione del documento esistente' USING ERRCODE='23505'; END IF;
  idx:=idx+1;
  acts:=acts||jsonb_build_array(to_jsonb(e)||jsonb_build_object('ref',idx));
  SELECT * INTO term FROM private.gon_terms WHERE project_id=pid AND NOT superseded AND valid_from<=e.date
   AND (valid_to IS NULL OR valid_to>=e.date) ORDER BY valid_from DESC,version DESC LIMIT 1;
  r:=NULL;
  IF FOUND THEN SELECT value INTO r FROM jsonb_array_elements(term.rules) WHERE value->>'macro'=e.macro AND value->>'type'=e.type; END IF;
  mode:=coalesce(r->>'mode','hour'); price:=(r->>'price')::numeric;
  minutes:=coalesce((r->>'round_minutes')::integer,0);rounding:=coalesce(r->>'round_mode','none');
  qty:=e.hours;
  IF mode='hour' AND minutes>0 AND rounding<>'none' THEN
   qty:=CASE WHEN rounding='up' THEN ceil(e.hours*60/minutes) ELSE round(e.hours*60/minutes) END*minutes/60;
  END IF;
  billing_key:=CASE mode WHEN 'fixed' THEN 'F:'||md5(e.macro||'|'||e.type)
    WHEN 'monthly' THEN 'M:'||to_char(e.date,'YYYY-MM')||':'||md5(e.macro||'|'||e.type) ELSE NULL END;
  IF billing_key IS NOT NULL AND EXISTS(SELECT 1 FROM private.gon_unit_claims c WHERE c.project_id=pid AND c.unit_key=billing_key AND c.report_id IS DISTINCT FROM replaces) THEN
   RAISE EXCEPTION 'Forfait o canone del periodo gia rendicontato. Usare una revisione, non un secondo addebito' USING ERRCODE='23505'; END IF;
  k:=CASE WHEN mode='hour' THEN 'H:'||coalesce(term.id::text,'missing')||':'||md5(e.macro||'|'||e.type) ELSE billing_key END;
  g:=groups->k;
  IF g IS NULL THEN
   g:=jsonb_build_object('id',md5(k),'mode',mode,'macro',e.macro,'type',e.type,'unit_key',billing_key,
    'description',e.macro||' - '||e.type||CASE WHEN mode='monthly' THEN ' ('||to_char(e.date,'MM/YYYY')||')' ELSE '' END,
    'unit',CASE mode WHEN 'hour' THEN 'h' WHEN 'fixed' THEN 'forfait' ELSE 'mese' END,
    'quantity',CASE mode WHEN 'hour' THEN qty ELSE 1 END,'price',price,'registered_hours',e.hours,
    'refs',jsonb_build_array(idx),'entry_ids',jsonb_build_array(e.id),'terms_id',term.id,'terms_version',term.version,
    'terms_reference',coalesce(term.reference,''),'round_minutes',minutes,'round_mode',rounding,'reason','');
  ELSE
   IF mode='hour' THEN g:=g||jsonb_build_object('quantity',(g->>'quantity')::numeric+qty); END IF;
   IF (g->>'price')::numeric IS DISTINCT FROM price THEN
    g:=g||jsonb_build_object('price',NULL,'warning','Condizioni diverse nella stessa quota: definire l importo concordato');
   END IF;
   g:=g||jsonb_build_object('refs',(g->'refs')||jsonb_build_array(idx),'entry_ids',(g->'entry_ids')||jsonb_build_array(e.id),'registered_hours',(g->>'registered_hours')::numeric+e.hours);
  END IF;
  groups:=jsonb_set(groups,ARRAY[k],g,true);
 END LOOP;
 IF idx<>expected THEN RAISE EXCEPTION 'Una o piu attivita selezionate non sono piu disponibili' USING ERRCODE='40001'; END IF;
 SELECT coalesce(jsonb_agg(value ORDER BY (value->'refs'->>0)::integer),'[]') INTO lines FROM jsonb_each(groups);
 head:=coalesce(head,'{}');logo:=coalesce(head->>'logo','');
 IF length(logo)>250000 OR (logo<>'' AND logo !~ '^data:image/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$') THEN RAISE EXCEPTION 'Logo non valido'; END IF;
 doc:=jsonb_build_object('schema_version',1,'model','economic-v2','project',to_jsonb(proj),
  'client',jsonb_build_object('id',customer.id,'name',customer.main,'site',customer.site,'display',customer.display),
  'period_from',df,'period_to',dt,'activities',acts,'source_lines',lines,'lines',lines,'expenses','[]'::jsonb,'discount_percent',0,
  'header',jsonb_build_object('summary',left(coalesce(head->>'summary',''),4000),'deliverables',left(coalesce(head->>'deliverables',''),4000),
    'notes',left(coalesce(head->>'notes',''),4000),'contact',left(coalesce(head->>'contact',''),500),
    'recipient_contact',left(coalesce(head->>'recipient_contact',''),500),'recipient_address',left(coalesce(head->>'recipient_address',''),1000),
    'issuer',left(coalesce(head->>'issuer','GON srl'),1000),'logo',logo));
 doc:=private.gon_price_document(doc);
 RETURN doc||jsonb_build_object('source_lines',doc->'lines');
END $$;
REVOKE ALL ON FUNCTION private.gon_report_build(uuid,date,date,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated;
