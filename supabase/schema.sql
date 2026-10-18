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
  photo_url text,
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
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

alter table public.conversations add column if not exists expires_at timestamptz;
alter table public.conversations alter column expires_at set default (now() + interval '30 days');
update public.conversations set expires_at = created_at + interval '30 days' where expires_at is null;
alter table public.conversations alter column expires_at set not null;

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

alter table public.pets add column if not exists photo_url text;
insert into storage.buckets (id, name, public) values ('reunite-media', 'reunite-media', true) on conflict (id) do nothing;
create policy "owners can upload pet photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'reunite-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owners can update pet photos" on storage.objects for update to authenticated
  using (bucket_id = 'reunite-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "public can view Reunite pet photos" on storage.objects for select to public
  using (bucket_id = 'reunite-media');

create or replace function public.get_public_pet_v2(p_token text)
returns table (public_token text, name text, species text, breed text, age text, note text, public_photo boolean, public_note boolean, missing boolean, photo_url text)
language sql security definer set search_path = public
as $$
  select p.public_token, p.name, p.species, p.breed, p.age,
    case when p.public_note then p.note else '' end,
    p.public_photo, p.public_note, p.missing,
    case when p.public_photo then p.photo_url else null end
  from public.pets p where p.public_token = p_token limit 1;
$$;
revoke all on function public.get_public_pet_v2(text) from public;
grant execute on function public.get_public_pet_v2(text) to anon, authenticated;

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
  if (select count(*) from public.messages m join public.conversations c on c.id = m.conversation_id
      where c.pet_id = v_pet.id and m.sender_role = 'finder' and m.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'This profile has reached its message limit for now. Please try again later.';
  end if;
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

-- Retain finder conversations for 30 days, then remove the conversation and its
-- messages together through the existing ON DELETE CASCADE relationship.
create or replace function public.delete_expired_reunite_conversations()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.conversations where expires_at <= now();
$$;
revoke all on function public.delete_expired_reunite_conversations() from public;

create or replace function public.delete_my_reunite_data()
returns void
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  delete from storage.objects where bucket_id = 'reunite-media' and owner_id = auth.uid();
  delete from public.pets where owner_id = auth.uid();
end;
$$;
revoke all on function public.delete_my_reunite_data() from public;
grant execute on function public.delete_my_reunite_data() to authenticated;

-- Supabase projects include pg_cron. Run cleanup hourly without exposing a
-- public RPC that could be abused to delete data.
create extension if not exists pg_cron with schema extensions;
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'reunite-delete-expired-conversations') then
    perform cron.schedule('reunite-delete-expired-conversations', '0 * * * *', 'select public.delete_expired_reunite_conversations();');
  end if;
end
$$;
