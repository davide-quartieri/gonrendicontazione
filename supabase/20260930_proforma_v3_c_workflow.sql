-- Consolidated source of the already-applied admin workflow migration.
create function public.gon_proforma_v3(p_action text,p_payload jsonb,p_expected_user uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid;cid text;pl jsonb:=coalesce(p_payload,'{}');profile private.gon_customer_profiles;oldprofile private.gon_customer_profiles;rr private.gon_reports;result jsonb;d jsonb;before_d jsonb;data jsonb;field text;rate numeric;modify boolean:=false;
begin
 u:=private.gon_commercial_actor(p_expected_user,true);
 if jsonb_typeof(pl)<>'object' or octet_length(pl::text)>3000000 then raise exception 'Richiesta non valida';end if;
 if p_action in('profile_get','profile_save') then
 cid:=private.gon_billing_client_id(pl->>'client_id');if not exists(select 1 from public.clients where id=cid) then raise exception 'Cliente non trovato';end if;
 perform pg_advisory_xact_lock(hashtextextended('gon-customer-profile:'||cid,0));select * into oldprofile from private.gon_customer_profiles where client_id=cid for update;
 if p_action='profile_get' then return case when oldprofile.client_id is not null then to_jsonb(oldprofile) else jsonb_build_object('client_id',cid,'version',0,'cassa_rate',5,'cassa_on_expenses',true,'legal_data',jsonb_build_object('legal_name',(select main from public.clients where id=cid),'country','IT')) end;end if;
 if coalesce(oldprofile.version,0) is distinct from (pl->>'version')::integer then raise exception 'Anagrafica modificata: ricaricarla' using errcode='40001';end if;
 if jsonb_typeof(pl->'legal_data') is distinct from 'object' then raise exception 'Anagrafica non valida';end if;
 data:='{}';foreach field in array array['legal_name','vat_number','tax_code','address','postcode','city','province','country','pec','sdi_code','email','phone','contact','payment_terms'] loop
 if length(coalesce(pl->'legal_data'->>field,''))>500 then raise exception 'Campo anagrafica troppo lungo: %',field;end if;data:=data||jsonb_build_object(field,btrim(coalesce(pl->'legal_data'->>field,'')));
 end loop;
 if length(data->>'legal_name')=0 then raise exception 'Inserisci la ragione sociale';end if;
 if length(data->>'country') not in(0,2) then raise exception 'Paese: codice di due lettere';end if;
 if upper(data->>'country')='IT' and data->>'postcode'<>'' and data->>'postcode'!~'^[0-9]{5}$' then raise exception 'CAP italiano: 5 cifre';end if;data:=jsonb_set(data,'{country}',to_jsonb(upper(data->>'country')));
 rate:=(pl->>'cassa_rate')::numeric;if rate is null or rate::text in('NaN','Infinity','-Infinity') or rate<0 or rate>100 then raise exception 'Aliquota Cassa non valida';end if;
 insert into private.gon_customer_profiles(client_id,version,legal_data,cassa_rate,cassa_on_expenses,updated_by) values(cid,coalesce(oldprofile.version,0)+1,data,round(rate,4),coalesce((pl->>'cassa_on_expenses')::boolean,true),u)
 on conflict(client_id) do update set version=excluded.version,legal_data=excluded.legal_data,cassa_rate=excluded.cassa_rate,cassa_on_expenses=excluded.cassa_on_expenses,updated_by=u,updated_at=now() returning * into profile;
 insert into private.gon_commercial_audit(actor,action,before_data,after_data) values(u,'customer_profile_save',to_jsonb(oldprofile),to_jsonb(profile));return to_jsonb(profile);
 end if;
 if p_action in('overview','terms_save') then return private.gon_client_billing(p_action,pl,u);end if;
 if p_action='report_prepare' then
 result:=private.gon_client_billing(p_action,pl,u);if result->'document'->>'proforma_schema'='3' then return result;end if;if result->>'state'<>'draft' then return result;end if;
 cid:=pl->>'client_id';d:=private.gon_enrich_proforma(result->'document',cid);
 update private.gon_reports set document=d where id=(result->>'id')::uuid and state='draft' returning * into rr;
 insert into private.gon_commercial_audit(actor,action,entity_id,after_data) values(u,'proforma_prepare',rr.id,to_jsonb(rr));return to_jsonb(rr);
 end if;
 select * into rr from private.gon_reports where id=(pl->>'id')::uuid;if not found then raise exception 'Documento non trovato';end if;
 perform pg_advisory_xact_lock(hashtextextended('gon-commercial:'||rr.project_id::text,0));select * into rr from private.gon_reports where id=rr.id for update;
 if p_action in('report_get','report_remove','report_issue','report_revise','report_sent','report_discard') then return private.gon_client_billing(p_action,pl,u);end if;
 if p_action not in('report_save','report_recalculate','report_upgrade','report_teams','report_profile_refresh') then raise exception 'Operazione proforma non disponibile';end if;
 if rr.state<>'draft' or rr.removed_at is not null then raise exception 'Le copie emesse non sono modificabili';end if;
 if rr.version is distinct from (pl->>'version')::integer then raise exception 'Bozza modificata: riaprila' using errcode='40001';end if;
 select private.gon_billing_client_id(client_id) into cid from public.gon_projects where id=rr.project_id;before_d:=to_jsonb(rr);
 if p_action in('report_recalculate','report_upgrade') then
 result:=private.gon_client_billing('report_recalculate',pl,u);d:=private.gon_enrich_proforma(result->'document',cid,case when rr.document->>'proforma_schema'='3' then rr.document else null end);
 elsif p_action='report_save' then
 result:=private.gon_client_billing('report_save',pl,u);d:=result->'document';if d->>'proforma_schema'='3' then d:=private.gon_price_document(d||jsonb_build_object('cassa_rate',pl->'cassa_rate','cassa_on_expenses',coalesce((pl->>'cassa_on_expenses')::boolean,true)));end if;
 elsif p_action='report_teams' then
 if rr.document->>'proforma_schema' is distinct from '3' then raise exception 'Aggiorna prima la bozza al nuovo modello';end if;d:=private.gon_apply_teams(rr.document,pl->'decisions');modify:=true;
 else
 if rr.document->>'proforma_schema' is distinct from '3' then raise exception 'Aggiorna prima la bozza al nuovo modello';end if;
 select * into profile from private.gon_customer_profiles where client_id=cid;if not found then raise exception 'Salva prima anagrafica cliente';end if;
 d:=jsonb_set(rr.document,'{client}',rr.document->'client'||jsonb_build_object('legal',profile.legal_data,'profile_version',profile.version));modify:=true;
 end if;
 update private.gon_reports set document=d,version=version+case when modify then 1 else 0 end where id=rr.id returning * into rr;
 insert into private.gon_commercial_audit(actor,action,entity_id,before_data,after_data) values(u,'proforma_'||p_action,rr.id,before_d,to_jsonb(rr));return to_jsonb(rr);
end $$;
revoke all on function public.gon_proforma_v3(text,jsonb,uuid) from public,anon;
grant execute on function public.gon_proforma_v3(text,jsonb,uuid) to authenticated;
do $patch$
declare src text;needle text:='ELSIF p_action=''report_issue'' THEN';
begin
 src:=pg_get_functiondef('private.gon_commercial(text,jsonb,uuid)'::regprocedure);if length(src)-length(replace(src,needle,''))<>length(needle) then raise exception 'Issue marker changed';end if;src:=replace(src,needle,needle||E'\n  PERFORM private.gon_validate_proforma_issue(d);');execute src;
end $patch$;
