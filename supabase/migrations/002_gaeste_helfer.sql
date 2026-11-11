-- Gäste: ab welchem Programmteil dabei
alter table public.guests add column if not exists from_stage text not null default 'trauung'
  check (from_stage in ('standesamt','trauung','abend'));

-- Helfer
create table if not exists public.helpers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  job         text not null default 'Aufbau',
  slot        text,                 -- wann, z. B. "Freitag 16 Uhr" oder "ab Sektempfang"
  phone       text,
  confirmed   boolean default false,
  notes       text,
  created_at  timestamptz default now()
);
alter table public.helpers enable row level security;
drop policy if exists helpers_rw on public.helpers;
create policy helpers_rw on public.helpers for all using (public.is_member()) with check (public.is_member());
