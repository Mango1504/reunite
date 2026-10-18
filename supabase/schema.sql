-- Reunite Phase 1 schema. Run this in Supabase SQL Editor.
-- The public QR token is random and contains no owner contact details.
create extension if not exists pgcrypto;

create table if not exists public.pets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  public_token text not null unique default encode(gen_random_bytes(12), 'hex'),
  name text not null check (char_length(name) between 1 and 80),
  species text not null default 'Dog',
  breed text not null default '',
  age text not null default '',
  note text not null default '',
  public_photo boolean not null default true,
  public_note boolean not null default true,
  missing boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  finder_email text,
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_role text not null check (sender_role in ('finder', 'owner')),
  body text not null check (char_length(body) between 1 and 2000),
  location_lat double precision,
  location_lng double precision,
  location_accuracy double precision,
  created_at timestamptz not null default now()
);
alter table public.messages add column if not exists location_lat double precision;
alter table public.messages add column if not exists location_lng double precision;
alter table public.messages add column if not exists location_accuracy double precision;

alter table public.pets enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

create policy "owners can manage their pets" on public.pets for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Do not grant anon SELECT on pets: that would expose owner_id and private notes.
-- Scanners receive only this deliberately limited response through the function.
create or replace function public.get_public_pet(p_token text)
returns table (public_token text, name text, species text, breed text, age text, note text, public_photo boolean, public_note boolean, missing boolean)
language sql security definer set search_path = public
as $$
  select p.public_token, p.name, p.species, p.breed, p.age,
    case when p.public_note then p.note else '' end,
    p.public_photo, p.public_note, p.missing
  from public.pets p where p.public_token = p_token limit 1;
$$;
revoke all on function public.get_public_pet(text) from public;
grant execute on function public.get_public_pet(text) to anon, authenticated;

drop function if exists public.send_public_message(text, text);
create or replace function public.send_public_message(p_token text, p_body text, p_lat double precision default null, p_lng double precision default null, p_accuracy double precision default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pet public.pets;
  v_conversation uuid;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'Message must be between 1 and 2000 characters';
  end if;
  select * into v_pet from public.pets where public_token = p_token limit 1;
  if v_pet.id is null then raise exception 'Pet profile not found'; end if;
  insert into public.conversations (pet_id, owner_id)
    values (v_pet.id, v_pet.owner_id) returning id into v_conversation;
  insert into public.messages (conversation_id, sender_role, body, location_lat, location_lng, location_accuracy)
    values (v_conversation, 'finder', v_body, p_lat, p_lng, p_accuracy);
  return v_conversation;
end;
$$;
revoke all on function public.send_public_message(text, text, double precision, double precision, double precision) from public;
grant execute on function public.send_public_message(text, text, double precision, double precision, double precision) to anon, authenticated;

create policy "owners can manage conversations" on public.conversations for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "scanners can start a conversation" on public.conversations for insert
  with check (true);
create policy "conversation participants can read messages" on public.messages for select
  using (exists (select 1 from public.conversations c where c.id = conversation_id and c.owner_id = auth.uid()));
create policy "scanners and owners can send messages" on public.messages for insert
  with check (exists (select 1 from public.conversations c where c.id = conversation_id));

alter publication supabase_realtime add table public.messages;
