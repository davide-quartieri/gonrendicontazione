-- Applied live on 2026-10-13 after business clarification:
-- Montiriam and Cassola are operational sites of SYSTEMA AMBIENTE S.p.A., not billing customers.
do $$
declare
  v_systema text;
  v_montiriam text;
  v_cassola text;
begin
  select billing_client_id into strict v_systema
  from private.gon_billing_groups
  where name='SYSTEMA AMBIENTE S.p.A.';

  select id into strict v_montiriam from public.clients where display='Montiriam';
  select id into strict v_cassola from public.clients where display='Cassola - Vicenza';

  if exists (
    select 1 from private.gon_terms t join public.gon_projects p on p.id=t.project_id
    where p.client_id in (v_montiriam,v_cassola)
  ) or exists (
    select 1 from private.gon_reports r join public.gon_projects p on p.id=r.project_id
    where p.client_id in (v_montiriam,v_cassola)
  ) then
    raise exception 'Montiriam/Cassola have independent commercial history; manual reconciliation required';
  end if;

  update public.clients
     set main='SYSTEMA AMBIENTE S.p.A.',
         site=case id when v_montiriam then 'Montiriam' when v_cassola then 'Cassola' end
   where id in (v_montiriam,v_cassola);

  delete from private.gon_customer_profiles where client_id in (v_montiriam,v_cassola);

  insert into private.gon_billing_members(site_client_id,billing_client_id)
  values (v_montiriam,v_systema),(v_cassola,v_systema)
  on conflict (site_client_id) do update set billing_client_id=excluded.billing_client_id;
end $$;
