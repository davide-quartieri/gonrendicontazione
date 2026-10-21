-- Vals.eco periodic services. Applied live before merge; versioned here for reproducibility.
alter table public.entries add column if not exists periodic_units integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='entries_periodic_units_check'
      and conrelid='public.entries'::regclass
  ) then
    alter table public.entries
      add constraint entries_periodic_units_check
      check (periodic_units is null or periodic_units between 1 and 100);
  end if;
end $$;

alter table public.gon_periodic_packages drop constraint if exists gon_periodic_packages_code_check;
alter table public.gon_periodic_packages
  add constraint gon_periodic_packages_code_check
  check (code = any(array[
    'calcinato_vasca3_meta','calcinato_vasche1_2','vighizzolo_tre_lotti',
    'valseco_alt_22','valseco_rif_1','valseco_rif_2','valseco_rif_3','valseco_rif_4plus'
  ]::text[]));

insert into public.gon_periodic_packages(code,site_client_id,label,active)
select v.code,c.id,v.label,true
from public.clients c
cross join (values
  ('valseco_alt_22','Controllo altimetrico di 22 centrini in sommità alla copertura erbosa e ritracciamento satellitare, compresi elaborazione dati e relazione'),
  ('valseco_rif_1','Rilievo semestrale del rifiuto con forfait per numero di lotti, compresa elaborazione prevista - 1 LOTTO'),
  ('valseco_rif_2','Rilievo semestrale del rifiuto con forfait per numero di lotti, compresa elaborazione prevista - 2 LOTTI'),
  ('valseco_rif_3','Rilievo semestrale del rifiuto con forfait per numero di lotti, compresa elaborazione prevista - 3 LOTTI'),
  ('valseco_rif_4plus','Rilievo semestrale del rifiuto con forfait per numero di lotti, compresa elaborazione prevista - 4 O PIÙ LOTTI')
) as v(code,label)
where c.main='SYSTEMA AMBIENTE S.p.A.' and c.site='Vighizzolo'
on conflict (code) do update
set site_client_id=excluded.site_client_id,label=excluded.label,active=true;

create or replace function private.gon_validate_entry_package()
returns trigger language plpgsql set search_path='' as $$
begin
  new.periodic_package_code:=nullif(btrim(new.periodic_package_code),'');
  if new.periodic_package_code is null then new.periodic_units:=null; return new; end if;
  if new.macro !~* 'PROGRAMMAT[OAIE]' or not exists(
    select 1 from public.gon_periodic_packages p join public.clients c on c.id=p.site_client_id
    where p.code=new.periodic_package_code and p.active and (c.display=new.client or c.id=new.client)
  ) then
    raise exception 'Pacchetto non compatibile con cliente/cantiere o macroarea PROGRAMMATA' using errcode='22023';
  end if;
  if new.periodic_package_code='valseco_rif_4plus' then
    if new.periodic_units is null or new.periodic_units<4 or new.periodic_units>100 then
      raise exception 'Per Vals.eco 4 o più lotti indicare il numero effettivo di lotti (minimo 4)' using errcode='22023';
    end if;
  else new.periodic_units:=null;
  end if;
  return new;
end $$;

create or replace function private.gon_entry_with_package(p_action text,p_payload jsonb,p_expected_user uuid)
returns public.entries language plpgsql security definer set search_path='' as $$
declare
  u uuid; old_row public.entries; result public.entries; cd text; units integer;
  cl text; typ text; mac text; descr text; dat date; hrs numeric;
begin
  u:=private.gon_commercial_actor(p_expected_user,false);
  if jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>30000
     or p_action not in ('edit','complete','classify') then raise exception 'Richiesta non valida'; end if;
  select * into old_row from public.entries where id=p_payload->>'entry_id' for update;
  if not found or (old_row.created_by is distinct from u and not private.is_gon_admin()) then
    raise exception 'Attivita non accessibile' using errcode='42501';
  end if;
  cd:=nullif(btrim(p_payload->>'periodic_package_code'),'');
  units:=case when nullif(btrim(p_payload->>'periodic_units'),'') is null then null else (p_payload->>'periodic_units')::integer end;
  if p_action='complete' then
    if old_row.entry_source<>'timer' then raise exception 'Attivita non proveniente da timer'; end if;
  elsif (p_payload->>'expected_version')::integer is distinct from old_row.edit_version then
    raise exception 'Attivita modificata: ricaricare prima di salvare' using errcode='40001';
  end if;
  if p_action='classify' then
    if old_row.needs_details then raise exception 'Completare prima i dettagli del timer'; end if;
    if old_row.periodic_package_code is not distinct from cd and old_row.periodic_units is not distinct from units then return old_row; end if;
    update public.entries set periodic_package_code=cd,periodic_units=units where id=old_row.id returning * into result;
    return result;
  end if;
  cl:=btrim(coalesce(p_payload->>'client','')); typ:=p_payload->>'type'; mac:=p_payload->>'macro';
  descr:=btrim(coalesce(p_payload->>'description',''));
  dat:=case when p_action='complete' then old_row.date else (p_payload->>'date')::date end;
  hrs:=case when p_action='complete' then old_row.hours else (p_payload->>'hours')::numeric end;
  if dat is null or not isfinite(dat) or dat<'2000-01-01'::date or dat>'2100-12-31'::date or cl=''
     or (cl is distinct from old_row.client and not exists(select 1 from public.clients where display=cl and active))
     or typ is null or typ not in ('Cantiere','Viaggio','Ufficio')
     or mac is null or not exists(select 1 from public.gon_macroareas where name=mac)
     or length(descr) not between 1 and 4000 or hrs is null or hrs::text in ('NaN','Infinity','-Infinity') or hrs<=0 or hrs>744 then
    raise exception 'Controllare data, cliente, tipo ore, macroarea, descrizione e ore' using errcode='22023';
  end if;
  if p_action='complete' and not old_row.needs_details then
    if old_row.client=cl and old_row.type=typ and old_row.macro=mac and old_row.description=descr
       and old_row.periodic_package_code is not distinct from cd and old_row.periodic_units is not distinct from units then return old_row; end if;
    raise exception 'Timer gia completato: ricaricare i dati' using errcode='40001';
  end if;
  update public.entries set date=dat,client=cl,type=typ,macro=mac,description=descr,hours=round(hrs,6),
    needs_details=false,periodic_package_code=cd,periodic_units=units
  where id=old_row.id returning * into result;
  return result;
end $$;
