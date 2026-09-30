-- Consolidated source of already-applied migrations: daily rows and team forfaits.
create function private.gon_daily_lines(d jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare item jsonb;act jsonb;out_lines jsonb:='[]';qty numeric;mins numeric;rm text;ds jsonb;
begin
 for item in select value from jsonb_array_elements(d->'source_lines') loop
 if item->>'mode'='hour' then
 for act in select value from jsonb_array_elements(d->'activities') where (item->'entry_ids') ? (value->>'id') order by value->>'date',value->>'client',value->>'id' loop
 qty:=(act->>'hours')::numeric;mins:=coalesce((item->>'round_minutes')::numeric,0);rm:=item->>'round_mode';
 if mins>0 and rm in('up','nearest') then qty:=case when rm='up' then ceil(qty*60/mins) else round(qty*60/mins) end*mins/60;end if;
 out_lines:=out_lines||jsonb_build_array(item||jsonb_build_object('id',md5('DAY:'||(act->>'id')||':'||coalesce(item->>'terms_id','')),'quantity',qty,'registered_hours',(act->>'hours')::numeric,'description',act->>'description','dates',jsonb_build_array(act->>'date'),'site',coalesce(act->>'site',act->>'client'),'entry_ids',jsonb_build_array(act->>'id'),'refs',jsonb_build_array(act->'ref')));
 end loop;
 else
 select coalesce(jsonb_agg(distinct value->>'date'),'[]') into ds from jsonb_array_elements(d->'activities') where (item->'entry_ids') ? (value->>'id');out_lines:=out_lines||jsonb_build_array(item||jsonb_build_object('dates',ds));
 end if;
 end loop;return out_lines;
end $$;
create function private.gon_worker_key(a jsonb) returns text language sql immutable set search_path='' as $$ select btrim(regexp_replace(lower(coalesce(nullif(btrim(a->>'employee'),''),a->>'created_by','')),'[^[:alnum:]]+',' ','g')); $$;
create function private.gon_team_candidates(d jsonb) returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',md5(g.work_day||'|'||g.site||'|'||g.macro||'|'||g.descr),'date',g.work_day,'site',g.site,'macro',g.macro,'description',g.descr,'entry_ids',g.ids,'operators',g.ops,'hours',g.hours) order by g.work_day,g.site),'[]') from (
 select a.value->>'date' as work_day,a.value->>'client' as site,a.value->>'macro' as macro,lower(regexp_replace(btrim(a.value->>'description'),'\s+',' ','g')) as descr,jsonb_agg(a.value->>'id' order by a.value->>'id') as ids,jsonb_agg(distinct a.value->>'employee') as ops,sum((a.value->>'hours')::numeric) as hours
 from jsonb_array_elements(d->'activities') a(value)
 where a.value->>'type'='Cantiere' and exists(select 1 from jsonb_array_elements(d->'standard_lines') sl(value) where sl.value->>'mode'='hour' and (sl.value->'entry_ids') ? (a.value->>'id'))
 group by 1,2,3,4 having count(distinct private.gon_worker_key(a.value))=2 and bool_and(private.gon_worker_key(a.value)<>'')
 ) g;
$$;
create function private.gon_apply_teams(d jsonb,decisions jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare decision jsonb;ids jsonb;used jsonb:='[]';excluded jsonb:='[]';fees jsonb:='[]';normal jsonb;selection jsonb;candidates jsonb;pending jsonb;cnt integer;ops integer;days integer;sites integer;macros integer;kind text;descr text;refs jsonb;hrs numeric;first_act jsonb;label text;candidate jsonb;keytext text;result jsonb;
begin
 if decisions is null or jsonb_typeof(decisions)<>'array' or jsonb_array_length(decisions)>100 then raise exception 'Elenco interventi non valido';end if;
 for decision in select value from jsonb_array_elements(decisions) loop
 ids:=decision->'entry_ids';kind:=decision->>'duration';
 if jsonb_typeof(ids) is distinct from 'array' or jsonb_array_length(ids)<2 or kind is null or kind not in('half','full','separate') then raise exception 'Seleziona due tecnici e mezza giornata o giornata intera';end if;
 if exists(select 1 from jsonb_array_elements_text(ids) x where used ? x.value) or jsonb_array_length(ids)<>(select count(distinct value) from jsonb_array_elements_text(ids)) then raise exception 'Registrazioni duplicate tra interventi';end if;
 select jsonb_agg(a.value order by a.value->>'id'),count(*),count(distinct private.gon_worker_key(a.value)),count(distinct a.value->>'date'),count(distinct a.value->>'client'),count(distinct a.value->>'macro'),jsonb_agg(a.value->'ref'),sum((a.value->>'hours')::numeric) into selection,cnt,ops,days,sites,macros,refs,hrs from jsonb_array_elements(d->'activities') a(value) where ids ? (a.value->>'id');
 if cnt<>jsonb_array_length(ids) or ops<>2 or days<>1 or sites<>1 or macros<>1 or exists(select 1 from jsonb_array_elements(selection) a(value) where a.value->>'type'<>'Cantiere' or private.gon_worker_key(a.value)='') then raise exception 'Un intervento richiede esattamente due operatori distinti, stessa data, cantiere e macroarea';end if;
 if exists(select 1 from jsonb_array_elements_text(ids) x where not exists(select 1 from jsonb_array_elements(d->'standard_lines') sl(value) where sl.value->>'mode'='hour' and (sl.value->'entry_ids') ? x.value)) then raise exception 'Attivita gia incluse in forfait: nessun secondo addebito per squadra';end if;
 used:=used||ids;
 if kind='separate' then if length(btrim(coalesce(decision->>'reason','')))<3 then raise exception 'Motivare perche si tratta di interventi distinti';end if;continue;end if;
 first_act:=selection->0;descr:=btrim(coalesce(nullif(decision->>'description',''),first_act->>'description'));
 if length(descr) not between 1 and 4000 then raise exception 'Descrizione intervento non valida';end if;
 label:=case when kind='half' then '2 tecnici - mezza giornata' else '2 tecnici - giornata intera' end;
 keytext:='TEAM:'||(first_act->>'date')||':'||md5((first_act->>'client')||'|'||(first_act->>'macro')||'|'||lower(regexp_replace(descr,'\s+',' ','g')));
 if exists(select 1 from jsonb_array_elements(fees) f(value) where f.value->>'unit_key'=keytext) then raise exception 'Intervento ripetuto';end if;
 fees:=fees||jsonb_build_array(jsonb_build_object('id',md5(keytext),'mode','fixed','macro',first_act->>'macro','type','Cantiere','unit_key',keytext,'description',descr||' - '||label,'unit','intervento','quantity',1,'price',case when kind='half' then 450 else 900 end,'registered_hours',hrs,'entry_ids',ids,'refs',refs,'dates',jsonb_build_array(first_act->>'date'),'site',coalesce(first_act->>'site',first_act->>'client'),'terms_reference',label,'round_minutes',0,'round_mode','none','reason','Forfait squadra confermato dall amministratore'));excluded:=excluded||ids;
 end loop;
 select coalesce(jsonb_agg(sl.value),'[]') into normal from jsonb_array_elements(d->'standard_lines') sl(value) where not exists(select 1 from jsonb_array_elements_text(coalesce(sl.value->'entry_ids','[]')) x where excluded ? x.value);
 candidates:=private.gon_team_candidates(d);pending:='[]';
 for candidate in select value from jsonb_array_elements(candidates) loop
 if not exists(select 1 from jsonb_array_elements(decisions) dc(value) where (dc.value->'entry_ids') @> (candidate->'entry_ids')) then pending:=pending||jsonb_build_array(candidate);end if;
 end loop;
 result:=private.gon_price_document(d||jsonb_build_object('team_decisions',decisions,'team_candidates',candidates,'team_pending',pending,'lines',normal||fees,'source_lines',normal||fees));return result||jsonb_build_object('source_lines',result->'lines');
end $$;
create function private.gon_enrich_proforma(d jsonb,cid text,previous jsonb default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p private.gon_customer_profiles;legal jsonb;daily jsonb;result jsonb;
begin
 cid:=private.gon_billing_client_id(cid);select * into p from private.gon_customer_profiles where client_id=cid;
 legal:=coalesce(previous->'client'->'legal',p.legal_data,jsonb_build_object('legal_name',d->'client'->>'name','country','IT'));daily:=private.gon_daily_lines(d);
 result:=d||jsonb_build_object('proforma_schema',3,'document_kind','proforma','standard_lines',daily,'cassa_rate',coalesce((previous->>'cassa_rate')::numeric,p.cassa_rate,5),'cassa_on_expenses',coalesce((previous->>'cassa_on_expenses')::boolean,p.cassa_on_expenses,true),'client',(d->'client')||jsonb_build_object('legal',legal,'profile_version',coalesce((previous->'client'->>'profile_version')::integer,p.version,0)));
 return private.gon_apply_teams(result,coalesce(previous->'team_decisions','[]'));
end $$;
create function private.gon_validate_proforma_issue(d jsonb) returns void language plpgsql immutable set search_path='' as $$
declare legal jsonb;
begin
 if coalesce((d->>'proforma_schema')::integer,0)<>3 then return;end if;
 if not(d?'cassa_rate') then raise exception 'Conferma la Cassa geometri prima di emettere';end if;
 if jsonb_array_length(coalesce(d->'team_pending','[]'))>0 then raise exception 'Conferma gli interventi con due tecnici: mezza giornata, giornata intera o interventi distinti';end if;
 legal:=d->'client'->'legal';
 if length(btrim(coalesce(legal->>'legal_name','')))=0 or length(btrim(coalesce(legal->>'address','')))=0 or length(btrim(coalesce(legal->>'city','')))=0 or length(btrim(coalesce(legal->>'postcode','')))=0 or length(btrim(coalesce(legal->>'country','')))=0 or(length(btrim(coalesce(legal->>'vat_number','')))=0 and length(btrim(coalesce(legal->>'tax_code','')))=0) then raise exception 'Completa anagrafica cliente: ragione sociale, indirizzo, CAP, comune, paese e partita IVA o codice fiscale';end if;
end $$;
revoke all on function private.gon_daily_lines(jsonb),private.gon_worker_key(jsonb),private.gon_team_candidates(jsonb),private.gon_apply_teams(jsonb,jsonb),private.gon_enrich_proforma(jsonb,text,jsonb),private.gon_validate_proforma_issue(jsonb) from public,anon,authenticated;
