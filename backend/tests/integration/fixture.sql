do $$
begin
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;
grant usage on schema auth to authenticated;

drop table if exists public.rls_probe;
create table public.rls_probe (
  id serial primary key,
  user_id uuid not null,
  note text not null
);
alter table public.rls_probe enable row level security;
create policy rls_probe_owner on public.rls_probe for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert on public.rls_probe to authenticated;
grant usage on sequence public.rls_probe_id_seq to authenticated;

insert into public.rls_probe (user_id, note) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b1');
