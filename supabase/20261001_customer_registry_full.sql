CREATE OR REPLACE FUNCTION public.gon_customer_registry(p_action text, p_payload jsonb, p_expected_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  u uuid;
  pl jsonb:=coalesce(p_payload,'{}'::jsonb);
  cid text;
  main_name text;
  site jsonb;
  site_id text;
  site_name text;
  site_display text;
  current_ids text[]:=array[]::text[];
  payload_ids text[]:=array[]::text[];
  sites_out jsonb:='[]'::jsonb;
  legal jsonb:='{}'::jsonb;
  fld text;
  rate numeric;
  old_profile private.gon_customer_profiles;
  new_profile private.gon_customer_profiles;
  existing public.clients;
  before_snapshot jsonb;
  result jsonb;
  profile_version integer;
  country text;
  row_count integer;
  scope uuid;
begin
  u:=private.gon_commercial_actor(p_expected_user,true);
  if jsonb_typeof(pl)<>'object' or octet_length(pl::text)>3000000 then
    raise exception 'Richiesta non valida';
  end if;

  if p_action='list' then
    select coalesce(jsonb_agg(x.item order by x.sort_name,x.client_id),'[]'::jsonb)
    into result
    from (
      select c.id client_id,
             lower(coalesce(g.name,c.main,c.display)) sort_name,
             private.gon_billing_client_info(c.id)
             || jsonb_build_object(
                  'sites',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'site',s.site,'display',s.display) order by s.site,s.display),'[]'::jsonb) from public.clients s where private.gon_billing_client_id(s.id)=c.id),
                  'profile',coalesce(
                    to_jsonb(p),
                    jsonb_build_object(
                      'client_id',c.id,'version',0,'legal_data',jsonb_build_object('legal_name',c.main,'country','IT'),
                      'cassa_rate',5,'cassa_on_expenses',true
                    )
                  ),
                  'usage',jsonb_build_object(
                    'entries',(select count(*) from public.entries e where private.gon_billing_contains(c.id,e.client)),
                    'reports',(select count(*) from private.gon_reports r join public.gon_projects gp on gp.id=r.project_id where private.gon_billing_client_id(gp.client_id)=c.id),
                    'terms',(select count(*) from private.gon_terms t join public.gon_projects gp on gp.id=t.project_id where private.gon_billing_client_id(gp.client_id)=c.id)
                  )
                ) item
      from public.clients c
      left join private.gon_billing_groups g on g.billing_client_id=c.id
      left join private.gon_customer_profiles p on p.client_id=c.id
      where private.gon_billing_client_id(c.id)=c.id
    ) x;
    return result;
  end if;

  if p_action not in ('save','delete') then
    raise exception 'Operazione anagrafica non disponibile';
  end if;

  if p_action='delete' then
    cid:=private.gon_billing_client_id(pl->>'client_id');
    if cid is null or not exists(select 1 from public.clients where id=cid) then raise exception 'Cliente non trovato'; end if;
    perform pg_advisory_xact_lock(hashtextextended('gon-customer-registry:'||cid,0));

    if exists(select 1 from public.entries e where private.gon_billing_contains(cid,e.client)) then
      raise exception 'Cliente già usato nelle attività: non può essere eliminato';
    end if;
    if exists(select 1 from private.gon_reports r join public.gon_projects gp on gp.id=r.project_id where private.gon_billing_client_id(gp.client_id)=cid) then
      raise exception 'Cliente già usato nei rendiconti/proforme: non può essere eliminato';
    end if;
    if exists(select 1 from private.gon_terms t join public.gon_projects gp on gp.id=t.project_id where private.gon_billing_client_id(gp.client_id)=cid) then
      raise exception 'Cliente con condizioni economiche salvate: non può essere eliminato';
    end if;

    select coalesce(array_agg(c.id order by c.id),'{}'::text[]) into current_ids
    from public.clients c where private.gon_billing_client_id(c.id)=cid;

    select jsonb_build_object('client',private.gon_billing_client_info(cid),'profile',to_jsonb(p))
      into before_snapshot
    from private.gon_customer_profiles p where p.client_id=cid;
    if before_snapshot is null then before_snapshot:=jsonb_build_object('client',private.gon_billing_client_info(cid)); end if;

    delete from private.gon_customer_profiles where client_id=cid;
    delete from private.gon_billing_members where billing_client_id=cid;
    delete from private.gon_billing_groups where billing_client_id=cid;
    select scope_id into scope from private.gon_client_billing_accounts where client_id=cid;
    delete from private.gon_client_billing_accounts where client_id=cid;
    if scope is not null and not exists(select 1 from public.entries where project_id=scope)
       and not exists(select 1 from private.gon_reports where project_id=scope)
       and not exists(select 1 from private.gon_terms where project_id=scope) then
      delete from public.gon_projects where id=scope;
    end if;
    delete from public.gon_projects gp where gp.client_id=cid
      and not exists(select 1 from public.entries e where e.project_id=gp.id)
      and not exists(select 1 from private.gon_reports r where r.project_id=gp.id)
      and not exists(select 1 from private.gon_terms t where t.project_id=gp.id);
    delete from public.clients c where c.id=any(current_ids);

    insert into private.gon_commercial_audit(actor,action,before_data,after_data)
    values(u,'customer_registry_delete',before_snapshot,jsonb_build_object('client_id',cid,'deleted',true));
    return jsonb_build_object('client_id',cid,'deleted',true);
  end if;

  main_name:=btrim(coalesce(pl->>'main',''));
  if length(main_name) not between 1 and 200 then raise exception 'Inserisci il cliente principale'; end if;
  if jsonb_typeof(pl->'sites') is distinct from 'array' or jsonb_array_length(pl->'sites')<1 or jsonb_array_length(pl->'sites')>50 then
    raise exception 'Inserisci almeno una sede/cantiere';
  end if;
  if jsonb_typeof(pl->'legal_data') is distinct from 'object' then raise exception 'Anagrafica fiscale non valida'; end if;

  foreach fld in array array['legal_name','vat_number','tax_code','address','postcode','city','province','country','pec','sdi_code','email','phone','contact','payment_terms'] loop
    if length(coalesce(pl->'legal_data'->>fld,''))>500 then raise exception 'Campo anagrafica troppo lungo: %',fld; end if;
    legal:=legal||jsonb_build_object(fld,btrim(coalesce(pl->'legal_data'->>fld,'')));
  end loop;
  if length(legal->>'legal_name')=0 then legal:=jsonb_set(legal,'{legal_name}',to_jsonb(main_name)); end if;
  country:=upper(coalesce(legal->>'country',''));
  if country='' then country:='IT'; end if;
  if length(country)<>2 then raise exception 'Paese: codice di due lettere'; end if;
  if country='IT' and legal->>'postcode'<>'' and legal->>'postcode'!~'^[0-9]{5}$' then raise exception 'CAP italiano: 5 cifre'; end if;
  legal:=jsonb_set(legal,'{country}',to_jsonb(country));
  rate:=(pl->>'cassa_rate')::numeric;
  if rate is null or rate::text in('NaN','Infinity','-Infinity') or rate<0 or rate>100 then raise exception 'Aliquota Cassa non valida'; end if;

  cid:=nullif(pl->>'client_id','');
  if cid is not null then cid:=private.gon_billing_client_id(cid); end if;
  if cid is not null then
    perform pg_advisory_xact_lock(hashtextextended('gon-customer-registry:'||cid,0));
    select * into existing from public.clients where id=cid for update;
    if not found then raise exception 'Cliente non trovato'; end if;
    select coalesce(array_agg(c.id order by c.id),'{}'::text[]) into current_ids
    from public.clients c where private.gon_billing_client_id(c.id)=cid;
    select * into old_profile from private.gon_customer_profiles where client_id=cid for update;
    profile_version:=coalesce((pl->>'profile_version')::integer,0);
    if coalesce(old_profile.version,0) is distinct from profile_version then
      raise exception 'Anagrafica modificata: ricarica prima di salvare' using errcode='40001';
    end if;
    before_snapshot:=jsonb_build_object('client',private.gon_billing_client_info(cid),'profile',to_jsonb(old_profile));
  else
    profile_version:=0;
  end if;

  row_count:=0;
  for site in select value from jsonb_array_elements(pl->'sites') loop
    row_count:=row_count+1;
    site_id:=nullif(site->>'id','');
    site_name:=btrim(coalesce(site->>'site',''));
    site_display:=btrim(coalesce(site->>'display',''));
    if site_display='' then site_display:=case when site_name='' then main_name else main_name||' - '||site_name end; end if;
    if length(site_name)>200 or length(site_display) not between 1 and 250 then raise exception 'Sede/cantiere o nome visualizzato non valido'; end if;

    if cid is null and row_count=1 then
      site_id:='cl_'||substr(replace(gen_random_uuid()::text,'-',''),1,20);
      cid:=site_id;
      perform pg_advisory_xact_lock(hashtextextended('gon-customer-registry:'||cid,0));
      insert into public.clients(id,main,site,display,active,created_by)
      values(site_id,main_name,site_name,site_display,true,u);
    elsif site_id is null then
      site_id:='cl_'||substr(replace(gen_random_uuid()::text,'-',''),1,20);
      insert into public.clients(id,main,site,display,active,created_by)
      values(site_id,main_name,site_name,site_display,true,u);
    else
      if cid is null then raise exception 'Cliente principale non valido'; end if;
      if not (site_id=cid or site_id=any(current_ids)) then raise exception 'Sede/cantiere non appartenente al cliente'; end if;
      if exists(select 1 from public.entries e join public.clients c on c.id=site_id where e.client=c.display)
         and exists(select 1 from public.clients c where c.id=site_id and (c.display is distinct from site_display or c.site is distinct from site_name)) then
        raise exception 'Sede/cantiere già usato nelle attività: nome e sede non possono essere rinominati';
      end if;
      update public.clients set main=main_name,site=site_name,display=site_display,active=true where id=site_id;
    end if;
    if site_id=any(payload_ids) then raise exception 'Sede/cantiere duplicato'; end if;
    payload_ids:=array_append(payload_ids,site_id);
  end loop;

  if cid is null then raise exception 'Cliente non creato'; end if;

  if current_ids is not null and cardinality(current_ids)>0 then
    foreach site_id in array current_ids loop
      if not (site_id=any(payload_ids)) then
        if site_id=cid then raise exception 'La sede principale non può essere rimossa; modifica la riga principale'; end if;
        select * into existing from public.clients where id=site_id;
        if exists(select 1 from public.entries where client=existing.display) then raise exception 'Sede/cantiere già usato nelle attività: non può essere rimosso'; end if;
        delete from private.gon_billing_members where site_client_id=site_id;
        delete from public.clients where id=site_id;
      end if;
    end loop;
  end if;

  if cardinality(payload_ids)>1 then
    insert into private.gon_billing_groups(billing_client_id,name) values(cid,main_name)
    on conflict(billing_client_id) do update set name=excluded.name;
    delete from private.gon_billing_members where billing_client_id=cid;
    foreach site_id in array payload_ids loop
      insert into private.gon_billing_members(site_client_id,billing_client_id) values(site_id,cid);
    end loop;
  else
    delete from private.gon_billing_members where billing_client_id=cid;
    delete from private.gon_billing_groups where billing_client_id=cid;
  end if;

  select * into old_profile from private.gon_customer_profiles where client_id=cid for update;
  if coalesce(old_profile.version,0) is distinct from profile_version then
    raise exception 'Anagrafica modificata: ricarica prima di salvare' using errcode='40001';
  end if;
  insert into private.gon_customer_profiles(client_id,version,legal_data,cassa_rate,cassa_on_expenses,updated_by)
  values(cid,profile_version+1,legal,round(rate,4),coalesce((pl->>'cassa_on_expenses')::boolean,true),u)
  on conflict(client_id) do update set version=excluded.version,legal_data=excluded.legal_data,cassa_rate=excluded.cassa_rate,
    cassa_on_expenses=excluded.cassa_on_expenses,updated_by=u,updated_at=now()
  returning * into new_profile;

  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'site',c.site,'display',c.display) order by c.site,c.display),'[]'::jsonb)
  into sites_out from public.clients c where private.gon_billing_client_id(c.id)=cid;
  result:=jsonb_build_object(
    'id',cid,'main',main_name,'display',main_name,'sites',sites_out,
    'profile',to_jsonb(new_profile)
  );
  insert into private.gon_commercial_audit(actor,action,before_data,after_data)
  values(u,'customer_registry_save',before_snapshot,result);
  return result;
end $function$


revoke all on function public.gon_customer_registry(text,jsonb,uuid) from public;
revoke all on function public.gon_customer_registry(text,jsonb,uuid) from anon;
grant execute on function public.gon_customer_registry(text,jsonb,uuid) to authenticated;
