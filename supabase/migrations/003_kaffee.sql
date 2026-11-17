-- Gäste: zusätzlicher Programmteil Kaffee & Kuchen
alter table public.guests drop constraint if exists guests_from_stage_check;
alter table public.guests add constraint guests_from_stage_check
  check (from_stage in ('standesamt','trauung','kaffee','abend'));
