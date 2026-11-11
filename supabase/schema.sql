-- =====================================================================
-- Hochzeitsplaner – Datenbankschema für Supabase
-- Einmal komplett im Supabase SQL Editor ausführen.
-- Vorher unten bei "ERSTE MITGLIEDER" eure E-Mail-Adressen eintragen.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Mitglieder & Rollen ----------
create table if not exists public.members (
  id          text primary key,              -- kurzer Schlüssel, z. B. 'lukas'
  name        text not null,
  role        text not null check (role in ('paar','trauzeuge')),
  color       text default '#7d8b6a',
  created_at  timestamptz default now()
);

-- Welches Gerät (anonyme Supabase-Session) gehört zu welcher Person?
create table if not exists public.member_sessions (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  member_id   text not null references public.members(id) on update cascade on delete cascade,
  created_at  timestamptz default now()
);

create table if not exists public.login_attempts (
  at timestamptz default now()
);

-- Hilfsfunktionen (security definer, damit RLS sie nutzen kann)
create or replace function public.my_id() returns text
language sql stable security definer set search_path = public as $$
  select member_id from public.member_sessions where user_id = auth.uid()
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.members where id = public.my_id()
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_id() is not null
$$;

create or replace function public.is_couple() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'paar', false)
$$;

-- Sichtbarkeit: 'alle' | 'paar' (nur Brautpaar) | 'trauzeugen' (geheim vor dem Paar, z. B. JGA)
create or replace function public.can_see(vis text) returns boolean
language sql stable as $$
  select public.is_member() and (vis = 'alle' or (vis = 'paar' and public.my_role() = 'paar') or (vis = 'trauzeugen' and public.my_role() = 'trauzeuge'))
$$;

-- ---------- Einstellungen ----------
create table if not exists public.settings (
  id            int primary key default 1 check (id = 1),
  title         text default 'Unsere Hochzeit',
  wedding_date  date,
  location      text,
  budget_total  numeric(10,2) default 0,
  access_code_hash text,       -- optionales gemeinsames Codewort (bcrypt), null = nur Name
  updated_at    timestamptz default now()
);
insert into public.settings (id) values (1) on conflict do nothing;

-- ---------- Aufgaben ----------
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  notes       text,
  category    text default 'Allgemein',
  status      text not null default 'offen' check (status in ('offen','in_arbeit','erledigt')),
  assignee    text references public.members(id) on update cascade on delete set null,
  due_date    date,
  visibility  text not null default 'alle' check (visibility in ('alle','paar','trauzeugen')),
  created_by  text default public.my_id(),
  created_at  timestamptz default now()
);

-- ---------- Ideenboard ----------
create table if not exists public.ideas (
  id          uuid primary key default gen_random_uuid(),
  title       text,
  notes       text,
  category    text default 'Deko',
  image_path  text,           -- Pfad im Storage-Bucket "bilder"
  source_url  text,           -- z. B. Pinterest-Link
  visibility  text not null default 'alle' check (visibility in ('alle','paar','trauzeugen')),
  created_by  text default public.my_id(),
  created_at  timestamptz default now()
);

create table if not exists public.idea_likes (
  idea_id     uuid references public.ideas(id) on delete cascade,
  member      text default public.my_id(),
  primary key (idea_id, member)
);

create table if not exists public.idea_comments (
  id          uuid primary key default gen_random_uuid(),
  idea_id     uuid references public.ideas(id) on delete cascade,
  body        text not null,
  created_by  text default public.my_id(),
  created_at  timestamptz default now()
);

-- ---------- Budget & Ausgaben ----------
create table if not exists public.budget_categories (
  id       uuid primary key default gen_random_uuid(),
  name     text not null unique,
  planned  numeric(10,2) default 0,
  sort     int default 0
);

create table if not exists public.expenses (
  id            uuid primary key default gen_random_uuid(),
  description   text not null,
  amount        numeric(10,2) not null check (amount >= 0),
  spent_on      date default current_date,
  category      text,
  paid_by       text references public.members(id) on update cascade on delete set null,
  reimbursed    boolean default false,   -- vom Paar erstattet?
  receipt_path  text,
  visibility    text not null default 'alle' check (visibility in ('alle','paar','trauzeugen')),
  created_by    text default public.my_id(),
  created_at    timestamptz default now()
);

-- ---------- Gäste ----------
create table if not exists public.guests (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  grp         text default 'Familie',
  side        text default 'beide',
  persons     int default 1,
  rsvp        text default 'offen' check (rsvp in ('offen','zugesagt','abgesagt')),
  diet        text,
  notes       text,
  created_at  timestamptz default now()
);

-- ---------- Dienstleister ----------
create table if not exists public.vendors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  category    text,
  contact     text,
  phone       text,
  email       text,
  website     text,
  price       numeric(10,2),
  deposit     numeric(10,2),
  status      text default 'angefragt' check (status in ('angefragt','angebot','gebucht','abgesagt')),
  notes       text,
  created_at  timestamptz default now()
);

-- ---------- Tagesablauf ----------
create table if not exists public.timeline (
  id          uuid primary key default gen_random_uuid(),
  time        time not null,
  title       text not null,
  place       text,
  responsible text references public.members(id) on update cascade on delete set null,
  notes       text,
  visibility  text not null default 'alle' check (visibility in ('alle','paar','trauzeugen')),
  created_at  timestamptz default now()
);

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.members           enable row level security;
alter table public.member_sessions   enable row level security;
alter table public.login_attempts    enable row level security;
alter table public.settings          enable row level security;
alter table public.tasks             enable row level security;
alter table public.ideas             enable row level security;
alter table public.idea_likes        enable row level security;
alter table public.idea_comments     enable row level security;
alter table public.budget_categories enable row level security;
alter table public.expenses          enable row level security;
alter table public.guests            enable row level security;
alter table public.vendors           enable row level security;
alter table public.timeline          enable row level security;

-- Mitglieder: alle Mitglieder sehen sich, nur das Paar verwaltet
drop policy if exists m_sel on public.members;
create policy m_sel on public.members for select using (public.is_member());
drop policy if exists m_all on public.members;
create policy m_all on public.members for all using (public.is_couple()) with check (public.is_couple());

-- Einstellungen: alle lesen, nur das Paar ändert
drop policy if exists s_sel on public.settings;
create policy s_sel on public.settings for select using (public.is_member());
drop policy if exists s_upd on public.settings;
create policy s_upd on public.settings for update using (public.is_couple());
-- Hash des Codeworts ist für niemanden lesbar
revoke select on public.settings from anon, authenticated;
grant select (id, title, wedding_date, location, budget_total, updated_at) on public.settings to authenticated;

-- =====================================================================
-- Login ohne Passwort
-- =====================================================================
-- Namen für die Login-Buttons (öffentlich, nur Name & Farbe)
create or replace function public.login_names()
returns table(id text, name text, color text)
language sql stable security definer set search_path = public as $$
  select id, name, color from public.members order by case role when 'paar' then 0 else 1 end, name
$$;

create or replace function public.login_needs_code() returns boolean
language sql stable security definer set search_path = public as $$
  select access_code_hash is not null from public.settings where id = 1
$$;

-- Verknüpft die aktuelle (anonyme) Session mit einer Person
create or replace function public.claim_member(p_member text, p_code text default null)
returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare h text;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  if (select count(*) from public.login_attempts where at > now() - interval '15 minutes') >= 20 then
    raise exception 'Zu viele Versuche, bitte in 15 Minuten nochmal probieren';
  end if;
  if not exists (select 1 from public.members where id = p_member) then return false; end if;
  select access_code_hash into h from public.settings where id = 1;
  if h is not null and (p_code is null or crypt(p_code, h) <> h) then
    insert into public.login_attempts default values;
    return false;
  end if;
  insert into public.member_sessions (user_id, member_id) values (auth.uid(), p_member)
  on conflict (user_id) do update set member_id = excluded.member_id;
  return true;
end $$;

-- Codewort ändern (nur Brautpaar). Leer = kein Codewort.
create or replace function public.set_access_code(p_code text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_couple() then raise exception 'Nur das Brautpaar'; end if;
  update public.settings set access_code_hash =
    case when coalesce(trim(p_code), '') = '' then null else crypt(trim(p_code), gen_salt('bf')) end
  where id = 1;
end $$;

-- Abmelden: Verknüpfung dieses Geräts lösen
create or replace function public.release_member() returns void
language sql security definer set search_path = public as $$
  delete from public.member_sessions where user_id = auth.uid()
$$;

grant execute on function public.login_names() to anon, authenticated;
grant execute on function public.login_needs_code() to anon, authenticated;
grant execute on function public.claim_member(text, text) to authenticated;
grant execute on function public.set_access_code(text) to authenticated;
grant execute on function public.release_member() to authenticated;

-- Geräte-Sessions: das Paar sieht, welche Geräte angemeldet sind
drop policy if exists ms_sel on public.member_sessions;
create policy ms_sel on public.member_sessions for select using (public.is_couple() or user_id = auth.uid());
drop policy if exists ms_del on public.member_sessions;
create policy ms_del on public.member_sessions for delete using (public.is_couple());

-- Tabellen mit Sichtbarkeit
do $$
declare t text;
begin
  foreach t in array array['tasks','ideas','expenses','timeline'] loop
    execute format('drop policy if exists %1$s_rw on public.%1$s', t);
    execute format('create policy %1$s_rw on public.%1$s for all using (public.can_see(visibility)) with check (public.can_see(visibility))', t);
  end loop;
end $$;

-- Likes & Kommentare: sichtbar, wenn die Idee sichtbar ist
drop policy if exists il_rw on public.idea_likes;
create policy il_rw on public.idea_likes for all
  using (exists(select 1 from public.ideas i where i.id = idea_id))
  with check (member = public.my_id() and exists(select 1 from public.ideas i where i.id = idea_id));
drop policy if exists ic_rw on public.idea_comments;
create policy ic_rw on public.idea_comments for all
  using (exists(select 1 from public.ideas i where i.id = idea_id))
  with check (exists(select 1 from public.ideas i where i.id = idea_id));

-- Gemeinsame Tabellen: alle Mitglieder lesen & schreiben
do $$
declare t text;
begin
  foreach t in array array['budget_categories','guests','vendors'] loop
    execute format('drop policy if exists %1$s_rw on public.%1$s', t);
    execute format('create policy %1$s_rw on public.%1$s for all using (public.is_member()) with check (public.is_member())', t);
  end loop;
end $$;

-- =====================================================================
-- Storage: privater Bucket "bilder"
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('bilder','bilder', false)
on conflict (id) do nothing;

drop policy if exists bilder_rw on storage.objects;
create policy bilder_rw on storage.objects for all
  using (bucket_id = 'bilder' and public.is_member())
  with check (bucket_id = 'bilder' and public.is_member());

-- =====================================================================
-- Keepalive (für die GitHub Action, verhindert das Pausieren)
-- =====================================================================
create or replace function public.ping() returns text
language sql stable as $$ select 'pong' $$;
grant execute on function public.ping() to anon;

-- =====================================================================
-- Startdaten
-- =====================================================================
insert into public.budget_categories (name, planned, sort) values
  ('Location', 0, 1), ('Essen & Getränke', 0, 2), ('Fotograf & Video', 0, 3),
  ('Musik / DJ', 0, 4), ('Outfit & Styling', 0, 5), ('Ringe', 0, 6),
  ('Deko & Blumen', 0, 7), ('Papeterie', 0, 8), ('JGA', 0, 9), ('Sonstiges', 0, 10)
on conflict (name) do nothing;

-- =====================================================================
-- MITGLIEDER (Namen/Rollen bei Bedarf anpassen, später auch in der App)
-- =====================================================================
insert into public.members (id, name, role, color) values
  ('johanna', 'Johanna', 'paar',      '#c08b7a'),
  ('lukas',   'Lukas',   'paar',      '#7d8b6a'),
  ('peter',   'Peter',   'trauzeuge', '#5d8aa8'),
  ('eva',     'Eva',     'trauzeuge', '#c9a44c')
on conflict (id) do nothing;

-- OPTIONAL: gemeinsames Codewort (einmal pro Gerät einzugeben).
-- Zeile einkommentieren und Wort ersetzen. Später auch in der App änderbar.
-- update public.settings set access_code_hash = extensions.crypt('DEIN-CODEWORT', extensions.gen_salt('bf')) where id = 1;
