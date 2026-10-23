-- Progeco: record the number of lots worked for site surveys.
-- Applied live first with execute_sql; versioned here for reproducibility.

alter table public.entries
  add column if not exists lot_count integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='entries_lot_count_check'
      and conrelid='public.entries'::regclass
  ) then
    alter table public.entries
      add constraint entries_lot_count_check
      check (lot_count is null or lot_count between 1 and 100);
  end if;
end $$;

create or replace function private.gon_validate_entry_lot_count()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  progeco boolean;
begin
  select exists(
    select 1
    from public.clients c
    where (c.display=new.client or c.id=new.client)
      and c.main='PROGECO AMBIENTE S.p.A.'
      and c.active
  ) into progeco;

  if progeco
     and new.type='Cantiere'
     and new.macro ~* '^Rilievo in campo' then
    if new.lot_count is null or new.lot_count<1 or new.lot_count>100 then
      raise exception 'Per i rilievi in cantiere Progeco indicare il numero di lotti lavorati'
        using errcode='22023';
    end if;
  else
    new.lot_count:=null;
  end if;

  return new;
end $$;

drop trigger if exists gon_02_validate_entry_lot_count on public.entries;
create trigger gon_02_validate_entry_lot_count
before insert or update of client,type,macro,lot_count
on public.entries
for each row execute function private.gon_validate_entry_lot_count();

create or replace function private.gon_entry_with_package(
  p_action text,
  p_payload jsonb,
  p_expected_user uuid
) returns public.entries
language plpgsql
security definer
set search_path=''
as $$
declare
  u uuid;
  old_row public.entries;
  result public.entries;
  cd text;
  units integer;
  lots integer;
  cl text;
  typ text;
  mac text;
  descr text;
  dat date;
  hrs numeric;
begin
  u:=private.gon_commercial_actor(p_expected_user,false);
  if jsonb_typeof(p_payload)<>'object'
     or octet_length(p_payload::text)>30000
     or p_action not in ('edit','complete','classify') then
    raise exception 'Richiesta non valida';
  end if;

  select * into old_row
  from public.entries
  where id=p_payload->>'entry_id'
  for update;

  if not found or (old_row.created_by is distinct from u and not private.is_gon_admin()) then
    raise exception 'Attivita non accessibile' using errcode='42501';
  end if;

  cd:=nullif(btrim(p_payload->>'periodic_package_code'),'');
  units:=case
    when nullif(btrim(p_payload->>'periodic_units'),'') is null then null
    else (p_payload->>'periodic_units')::integer
  end;

  if p_action='complete' then
    if old_row.entry_source<>'timer' then
      raise exception 'Attivita non proveniente da timer';
    end if;
  else
    if (p_payload->>'expected_version')::integer is distinct from old_row.edit_version then
      raise exception 'Attivita modificata: ricaricare prima di salvare' using errcode='40001';
    end if;
  end if;

  if p_action='classify' then
    if old_row.needs_details then
      raise exception 'Completare prima i dettagli del timer';
    end if;
    if old_row.periodic_package_code is not distinct from cd
       and old_row.periodic_units is not distinct from units then
      return old_row;
    end if;
    update public.entries
      set periodic_package_code=cd,
          periodic_units=units
    where id=old_row.id
    returning * into result;
    return result;
  end if;

  lots:=case
    when nullif(btrim(p_payload->>'lot_count'),'') is null then null
    else (p_payload->>'lot_count')::integer
  end;

  cl:=btrim(coalesce(p_payload->>'client',''));
  typ:=p_payload->>'type';
  mac:=p_payload->>'macro';
  descr:=btrim(coalesce(p_payload->>'description',''));
  dat:=case when p_action='complete' then old_row.date else (p_payload->>'date')::date end;
  hrs:=case when p_action='complete' then old_row.hours else (p_payload->>'hours')::numeric end;

  if dat is null or not isfinite(dat)
     or dat<'2000-01-01'::date or dat>'2100-12-31'::date
     or cl=''
     or (cl is distinct from old_row.client and not exists(
          select 1 from public.clients where display=cl and active
        ))
     or typ is null or typ not in ('Cantiere','Viaggio','Ufficio')
     or mac is null or not exists(select 1 from public.gon_macroareas where name=mac)
     or length(descr) not between 1 and 4000
     or hrs is null or hrs::text in ('NaN','Infinity','-Infinity')
     or hrs<=0 or hrs>744 then
    raise exception 'Controllare data, cliente, tipo ore, macroarea, descrizione e ore'
      using errcode='22023';
  end if;

  if p_action='complete' and not old_row.needs_details then
    if old_row.client=cl
       and old_row.type=typ
       and old_row.macro=mac
       and old_row.description=descr
       and old_row.periodic_package_code is not distinct from cd
       and old_row.periodic_units is not distinct from units
       and old_row.lot_count is not distinct from lots then
      return old_row;
    end if;
    raise exception 'Timer gia completato: ricaricare i dati' using errcode='40001';
  end if;

  update public.entries
  set date=dat,
      client=cl,
      type=typ,
      macro=mac,
      description=descr,
      hours=round(hrs,6),
      needs_details=false,
      periodic_package_code=cd,
      periodic_units=units,
      lot_count=lots
  where id=old_row.id
  returning * into result;

  return result;
end $$;
