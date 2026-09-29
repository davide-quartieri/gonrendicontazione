-- GON Rendicontazione: ruoli User / Amministratore
-- Applicare su Supabase prima di distribuire il frontend con controllo ruoli.

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;

drop policy if exists "profiles_select_own" on public.user_profiles;
create policy "profiles_select_own"
on public.user_profiles for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "profiles_insert_own_user" on public.user_profiles;
create policy "profiles_insert_own_user"
on public.user_profiles for insert
to authenticated
with check (user_id = auth.uid() and role = 'user');

create or replace function public.is_gon_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles
    where user_id = auth.uid() and role = 'admin'
  );
$$;
revoke all on function public.is_gon_admin() from public;
grant execute on function public.is_gon_admin() to authenticated;

alter table public.clients enable row level security;
drop policy if exists "gon_clients_select" on public.clients;
drop policy if exists "gon_clients_insert" on public.clients;
drop policy if exists "gon_clients_update" on public.clients;
drop policy if exists "gon_clients_delete" on public.clients;
drop policy if exists "gon_clients_insert_admin" on public.clients;
drop policy if exists "gon_clients_update_admin" on public.clients;
drop policy if exists "gon_clients_delete_admin" on public.clients;
create policy "gon_clients_select" on public.clients for select to authenticated using (true);
create policy "gon_clients_insert_admin" on public.clients for insert to authenticated with check (public.is_gon_admin());
create policy "gon_clients_update_admin" on public.clients for update to authenticated using (public.is_gon_admin()) with check (public.is_gon_admin());
create policy "gon_clients_delete_admin" on public.clients for delete to authenticated using (public.is_gon_admin());

alter table public.entries enable row level security;
drop policy if exists "gon_entries_select" on public.entries;
drop policy if exists "gon_entries_insert" on public.entries;
drop policy if exists "gon_entries_update" on public.entries;
drop policy if exists "gon_entries_delete" on public.entries;
drop policy if exists "gon_entries_select_role" on public.entries;
drop policy if exists "gon_entries_insert_own" on public.entries;
drop policy if exists "gon_entries_update_admin" on public.entries;
drop policy if exists "gon_entries_delete_admin" on public.entries;
create policy "gon_entries_select_role" on public.entries for select to authenticated
using (public.is_gon_admin() or created_by = auth.uid());
create policy "gon_entries_insert_own" on public.entries for insert to authenticated
with check (created_by = auth.uid());
create policy "gon_entries_update_admin" on public.entries for update to authenticated
using (public.is_gon_admin()) with check (public.is_gon_admin());
create policy "gon_entries_delete_admin" on public.entries for delete to authenticated
using (public.is_gon_admin());

-- Dopo l'applicazione, promuovere il primo amministratore:
-- update public.user_profiles set role='admin' where user_id = '<UUID UTENTE>';