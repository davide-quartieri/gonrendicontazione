-- Consolidated source of already-applied migrations. Do not rerun on the live project.
-- Requires the existing GON commercial/monthly billing schema. Apply a, b, c in order on a matching pre-v3 database.
-- No existing entries, terms or issued reports are rewritten.
set lock_timeout='5s';
create table public.gon_macroareas (
 id uuid primary key default gen_random_uuid(),name text not null,allowed_types text[] not null,billing_kind text not null check(billing_kind in ('hour','monthly')),builtin boolean not null default false,created_by uuid references auth.users(id),created_at timestamptz not null default now(),check(length(btrim(name)) between 1 and 120),check(cardinality(allowed_types) between 1 and 3 and allowed_types <@ array['Cantiere','Viaggio','Ufficio']::text[]));
create unique index gon_macroareas_name_ci on public.gon_macroareas(lower(btrim(name)));
insert into public.gon_macroareas(name,allowed_types,billing_kind,builtin) values ('Rilievo in campo',array['Cantiere','Viaggio'],'hour',true),('Elaborazione rilievo',array['Ufficio'],'hour',true),('Assistenza cliente',array['Cantiere','Viaggio','Ufficio'],'hour',true),('Attività amministrative',array['Ufficio'],'hour',true),('Corso',array['Ufficio'],'hour',true),('Varie',array['Ufficio'],'hour',true),('Rilievo in campo - PROGRAMMATO',array['Cantiere'],'monthly',true),('Elaborazione rilievo - PROGRAMMATA',array['Ufficio'],'monthly',true);
alter table public.gon_macroareas enable row level security;
revoke all on public.gon_macroareas from public,anon,authenticated;
grant select on public.gon_macroareas to authenticated;
create policy gon_macroareas_read on public.gon_macroareas for select to authenticated using ((select auth.uid()) is not null and lower(coalesce(auth.jwt()->>'email','')) like '%@gonsrl.it');
create table private.gon_customer_profiles(client_id text primary key references public.clients(id),version integer not null default 1,legal_data jsonb not null default '{}',cassa_rate numeric not null default 5,cassa_on_expenses boolean not null default true,updated_at timestamptz not null default now(),updated_by uuid not null references auth.users(id),check(jsonb_typeof(legal_data)='object'),check(cassa_rate>=0 and cassa_rate<=100 and cassa_rate::text not in('NaN','Infinity','-Infinity')));
alter table private.gon_customer_profiles enable row level security;
revoke all on private.gon_customer_profiles from public,anon,authenticated;
create or replace function private.gon_tariff_kind(m text,t text) returns text language sql stable security definer set search_path='' as $$ select billing_kind from public.gon_macroareas where name=m and t=any(allowed_types); $$;
create function public.gon_catalog(p_action text,p_payload jsonb,p_expected_user uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid;nm text;types text[];kind text;item public.gon_macroareas;
begin
 u:=private.gon_commercial_actor(p_expected_user,p_action IS DISTINCT FROM 'list');
 if p_action='list' then return(select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at,m.name),'[]') from public.gon_macroareas m);end if;
 if p_action IS DISTINCT FROM 'create' then raise exception 'Operazione catalogo non valida';end if;
 nm:=btrim(coalesce(p_payload->>'name',''));kind:=p_payload->>'billing_kind';
 if jsonb_typeof(p_payload->'allowed_types') is distinct from 'array' then raise exception 'Seleziona i tipi di ore';end if;
 select array_agg(distinct value order by value) into types from jsonb_array_elements_text(p_payload->'allowed_types');
 if length(nm) not between 1 and 120 or cardinality(types) is null or kind is null or kind not in('hour','monthly') then raise exception 'Nome, tipi o modalita non validi';end if;
 if upper(nm) like '%PROGRAMMAT%' and kind<>'monthly' then raise exception 'Le macroaree programmate devono essere a forfait';end if;
 insert into public.gon_macroareas(name,allowed_types,billing_kind,created_by) values(nm,types,kind,u) returning * into item;
 insert into private.gon_commercial_audit(actor,action,entity_id,after_data) values(u,'macroarea_create',item.id,to_jsonb(item));return to_jsonb(item);
end $$;
revoke all on function public.gon_catalog(text,jsonb,uuid) from public,anon;
grant execute on function public.gon_catalog(text,jsonb,uuid) to authenticated;
do $patch$
declare f regprocedure;src text;old_text text:='p_macro NOT IN (''Rilievo in campo'',''Elaborazione rilievo'',''Assistenza cliente'',''Attività amministrative'',''Corso'',''Varie'',''Rilievo in campo - PROGRAMMATO'',''Elaborazione rilievo - PROGRAMMATA'')';
begin
 foreach f in array array['private.gon_update_my_entry(text,uuid,integer,date,text,text,text,text,numeric)'::regprocedure,'public.gon_complete_timer(text,text,text,text,text,uuid)'::regprocedure] loop
 src:=pg_get_functiondef(f);if strpos(src,old_text)=0 then raise exception 'Catalog marker changed: %',f;end if;src:=replace(src,old_text,'NOT EXISTS(SELECT 1 FROM public.gon_macroareas macro_item WHERE macro_item.name=p_macro)');execute src;end loop;
 src:=pg_get_functiondef('private.gon_commercial_rules(jsonb)'::regprocedure);if strpos(src,'jsonb_array_length(p_rules)>11')=0 then raise exception 'Tariff validator marker changed';end if;
 src:=replace(src,'jsonb_array_length(p_rules)>11','jsonb_array_length(p_rules)>600');src:=replace(src,'Tariffario aggiornato: ricarica la pagina e usa le 11 voci disponibili','Tariffario non valido: aggiorna il catalogo');src:=replace(src,' IMMUTABLE',' STABLE');execute src;
end $patch$;
create function private.gon_check_macro() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='UPDATE' and new.macro is not distinct from old.macro then return new;end if;
 if not exists(select 1 from public.gon_macroareas m where m.name=new.macro) then raise exception 'Macroarea non presente nel catalogo' using errcode='22023';end if;return new;
end $$;
create trigger gon_check_macro before insert or update of macro on public.entries for each row execute function private.gon_check_macro();
revoke all on function private.gon_check_macro() from public,anon,authenticated;
create or replace function private.gon_price_document(d jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare r jsonb;t jsonb;vr numeric;cr numeric;net numeric;cb numeric;ca numeric;taxable numeric;va numeric;
begin
 r:=private.gon_price_document_net(d);if not(d?'vat_rate') then return r;end if;
 t:=r->'totals';net:=(t->>'net')::numeric;vr:=(d->>'vat_rate')::numeric;
 if vr is not null and(vr::text in('NaN','Infinity','-Infinity') or vr<0 or vr>100) then raise exception 'Aliquota IVA non valida' using errcode='22023';end if;vr:=round(vr,4);
 if vr=0 and length(btrim(coalesce(d->>'vat_note','')))<3 then raise exception 'Indicare il trattamento IVA per aliquota zero';end if;
 taxable:=net;
 if d?'cassa_rate' then
 cr:=(d->>'cassa_rate')::numeric;if cr is null or cr::text in('NaN','Infinity','-Infinity') or cr<0 or cr>100 then raise exception 'Aliquota Cassa non valida';end if;
 cr:=round(cr,4);cb:=case when coalesce((d->>'cassa_on_expenses')::boolean,true) then net else net-(t->>'expenses')::numeric end;ca:=round(cb*cr/100,2);taxable:=net+ca;
 r:=r||jsonb_build_object('cassa_rate',cr,'cassa_on_expenses',coalesce((d->>'cassa_on_expenses')::boolean,true));t:=t||jsonb_build_object('cassa_base',cb,'cassa',ca);
 end if;
 va:=round(taxable*vr/100,2);
 return r||jsonb_build_object('vat_rate',vr,'vat_note',left(coalesce(d->>'vat_note',''),1000),'totals',t||jsonb_build_object('taxable',taxable,'vat',va,'gross',taxable+va,'missing_vat',vr is null));
end $$;
