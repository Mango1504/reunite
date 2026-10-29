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
  expires_at timestamptz not null default (now() + interval '24 hours')
);

alter table public.conversations add column if not exists expires_at timestamptz;
alter table public.conversations alter column expires_at set default (now() + interval '24 hours');
update public.conversations set expires_at = created_at + interval '24 hours' where expires_at is null or expires_at > created_at + interval '24 hours';
alter table public.conversations alter column expires_at set not null;
alter table public.conversations add column if not exists finder_device_id text;
alter table public.conversations add column if not exists blocked_at timestamptz;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_role text not null check (sender_role in ('finder', 'owner')),
  body text not null check (char_length(body) between 1 and 2000),
  location_lat double precision,
  location_lng double precision,
  location_accuracy double precision,
  delivered_at timestamptz not null default now(),
  seen_at timestamptz,
  created_at timestamptz not null default now(),
  constraint messages_location_lat_valid check (location_lat is null or location_lat between -90 and 90),
  constraint messages_location_lng_valid check (location_lng is null or location_lng between -180 and 180),
  constraint messages_location_accuracy_valid check (location_accuracy is null or location_accuracy >= 0)
);

create table if not exists public.profile_reports (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null references public.pets(id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 500),
  created_at timestamptz not null default now()
);
alter table public.messages add column if not exists location_lat double precision;
alter table public.messages add column if not exists location_lng double precision;
alter table public.messages add column if not exists location_accuracy double precision;
alter table public.messages add column if not exists delivered_at timestamptz not null default now();
alter table public.messages alter column delivered_at set default now();
alter table public.messages add column if not exists seen_at timestamptz;
create or replace function public.ensure_message_delivery_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.delivered_at := coalesce(new.delivered_at, now());
  return new;
end;
$$;
drop trigger if exists ensure_message_delivery_status on public.messages;
create trigger ensure_message_delivery_status
before insert on public.messages
for each row execute function public.ensure_message_delivery_status();
create or replace function public.broadcast_reunite_message()
returns trigger
language plpgsql
security definer
set search_path = public, realtime
as $$
declare
  v_token text;
  v_device_id text;
begin
  select p.public_token into v_token
  from public.conversations c
  join public.pets p on p.id = c.pet_id
  where c.id = new.conversation_id;
  if v_token is not null then
    select c.finder_device_id into v_device_id from public.conversations c where c.id = new.conversation_id;
    if v_device_id is not null then
      perform realtime.broadcast_changes('pet:' || v_token || ':' || v_device_id, 'message', 'INSERT', 'messages', 'public', new, null);
    end if;
  end if;
  return new;
end;
$$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'broadcast_reunite_message' and tgrelid = 'public.messages'::regclass) then
    create trigger broadcast_reunite_message after insert on public.messages for each row execute function public.broadcast_reunite_message();
  end if;
end
$$;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'messages_location_lat_valid') then
    alter table public.messages add constraint messages_location_lat_valid check (location_lat is null or location_lat between -90 and 90);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'messages_location_lng_valid') then
    alter table public.messages add constraint messages_location_lng_valid check (location_lng is null or location_lng between -180 and 180);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'messages_location_accuracy_valid') then
    alter table public.messages add constraint messages_location_accuracy_valid check (location_accuracy is null or location_accuracy >= 0);
  end if;
end
$$;

alter table public.pets enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.profile_reports enable row level security;

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

create or replace function public.mark_public_messages_seen(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.messages m
    set delivered_at = coalesce(m.delivered_at, now()),
        seen_at = coalesce(m.seen_at, now())
    where m.sender_role = 'owner'
      and exists (
        select 1 from public.conversations c
        join public.pets p on p.id = c.pet_id
        where c.id = m.conversation_id and p.public_token = p_token
      );
$$;
revoke all on function public.mark_public_messages_seen(text) from public;
grant execute on function public.mark_public_messages_seen(text) to anon, authenticated;

create or replace function public.mark_public_messages_seen_v2(p_token text, p_device_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.messages m
    set delivered_at = coalesce(m.delivered_at, now()), seen_at = coalesce(m.seen_at, now())
    where m.sender_role = 'owner'
      and exists (select 1 from public.conversations c join public.pets p on p.id = c.pet_id where c.id = m.conversation_id and p.public_token = p_token and c.finder_device_id = p_device_id);
$$;
revoke all on function public.mark_public_messages_seen_v2(text, text) from public;
grant execute on function public.mark_public_messages_seen_v2(text, text) to anon, authenticated;

create or replace function public.get_public_messages_v2(p_token text)
returns table(id uuid, conversation_id uuid, sender_role text, body text, created_at timestamptz, delivered_at timestamptz, seen_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select m.id, m.conversation_id, m.sender_role, m.body, m.created_at, m.delivered_at, m.seen_at
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  join public.pets p on p.id = c.pet_id
  where p.public_token = p_token
    and c.expires_at > now()
  order by m.created_at asc;
$$;
revoke all on function public.get_public_messages_v2(text) from public;
grant execute on function public.get_public_messages_v2(text) to anon, authenticated;

create or replace function public.send_public_reply(p_token text, p_conversation uuid, p_body text, p_lat double precision default null, p_lng double precision default null, p_accuracy double precision default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pet_id uuid;
begin
  if char_length(btrim(coalesce(p_body, ''))) < 1 or char_length(btrim(coalesce(p_body, ''))) > 2000 then
    raise exception 'Message must be between 1 and 2000 characters';
  end if;
  select p.id into v_pet_id
  from public.pets p
  join public.conversations c on c.pet_id = p.id
  where p.public_token = p_token and c.id = p_conversation and c.expires_at > now();
  if v_pet_id is null then raise exception 'Conversation not found or expired'; end if;
  if (select count(*) from public.messages m where m.conversation_id = p_conversation and m.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Message limit reached for this conversation';
  end if;
  insert into public.messages (conversation_id, sender_role, body, location_lat, location_lng, location_accuracy)
    values (p_conversation, 'finder', btrim(p_body), p_lat, p_lng, p_accuracy);
end;
$$;
revoke all on function public.send_public_reply(text, uuid, text, double precision, double precision, double precision) from public;
grant execute on function public.send_public_reply(text, uuid, text, double precision, double precision, double precision) to anon, authenticated;

create or replace function public.send_public_message_v2(p_token text, p_device_id text, p_body text, p_lat double precision default null, p_lng double precision default null, p_accuracy double precision default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pet public.pets;
  v_conversation uuid;
  v_body text := btrim(coalesce(p_body, ''));
  v_device text := btrim(coalesce(p_device_id, ''));
begin
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then raise exception 'Message must be between 1 and 2000 characters'; end if;
  if char_length(v_device) < 16 or char_length(v_device) > 100 then raise exception 'Finder device identity is invalid'; end if;
  select * into v_pet from public.pets where public_token = p_token limit 1;
  if v_pet.id is null then raise exception 'Pet profile not found'; end if;
  if (select count(*) from public.messages m join public.conversations c on c.id = m.conversation_id where c.pet_id = v_pet.id and m.sender_role = 'finder' and m.created_at > now() - interval '1 hour') >= 20 then raise exception 'This profile has reached its message limit for now. Please try again later.'; end if;
  if exists (select 1 from public.conversations where pet_id = v_pet.id and finder_device_id = v_device and blocked_at is not null) then raise exception 'This finder has been blocked by the owner'; end if;
  select id into v_conversation from public.conversations where pet_id = v_pet.id and finder_device_id = v_device and blocked_at is null and expires_at > now() order by created_at desc limit 1;
  if v_conversation is null then
    insert into public.conversations (pet_id, owner_id, finder_device_id) values (v_pet.id, v_pet.owner_id, v_device) returning id into v_conversation;
  end if;
  insert into public.messages (conversation_id, sender_role, body, location_lat, location_lng, location_accuracy) values (v_conversation, 'finder', v_body, p_lat, p_lng, p_accuracy);
  return v_conversation;
end;
$$;
revoke all on function public.send_public_message_v2(text, text, text, double precision, double precision, double precision) from public;
grant execute on function public.send_public_message_v2(text, text, text, double precision, double precision, double precision) to anon, authenticated;

create or replace function public.send_public_reply_v2(p_token text, p_device_id text, p_conversation uuid, p_body text, p_lat double precision default null, p_lng double precision default null, p_accuracy double precision default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
begin
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then raise exception 'Message must be between 1 and 2000 characters'; end if;
  if not exists (select 1 from public.conversations c join public.pets p on p.id = c.pet_id where c.id = p_conversation and p.public_token = p_token and c.finder_device_id = p_device_id and c.blocked_at is null and c.expires_at > now()) then raise exception 'Conversation not found, blocked, or expired'; end if;
  insert into public.messages (conversation_id, sender_role, body, location_lat, location_lng, location_accuracy) values (p_conversation, 'finder', v_body, p_lat, p_lng, p_accuracy);
end;
$$;
revoke all on function public.send_public_reply_v2(text, text, uuid, text, double precision, double precision, double precision) from public;
grant execute on function public.send_public_reply_v2(text, text, uuid, text, double precision, double precision, double precision) to anon, authenticated;

create or replace function public.get_public_messages_v3(p_token text, p_device_id text)
returns table(id uuid, conversation_id uuid, sender_role text, body text, created_at timestamptz, delivered_at timestamptz, seen_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select m.id, m.conversation_id, m.sender_role, m.body, m.created_at, m.delivered_at, m.seen_at
  from public.messages m join public.conversations c on c.id = m.conversation_id join public.pets p on p.id = c.pet_id
  where p.public_token = p_token and c.finder_device_id = p_device_id and c.expires_at > now()
  order by m.created_at asc;
$$;
revoke all on function public.get_public_messages_v3(text, text) from public;
grant execute on function public.get_public_messages_v3(text, text) to anon, authenticated;

create or replace function public.get_public_messages_v4(p_token text, p_device_id text, p_session_id text default null)
returns table(id uuid, conversation_id uuid, sender_role text, body text, created_at timestamptz, delivered_at timestamptz, seen_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_session_id is not null and p_session_id <> p_device_id then
    update public.conversations set expires_at = now() where finder_device_id = p_session_id and exists (select 1 from public.pets p where p.id = pet_id and p.public_token = p_token) and expires_at > now();
    return;
  end if;
  return query
    select m.id, m.conversation_id, m.sender_role, m.body, m.created_at, m.delivered_at, m.seen_at
    from public.messages m join public.conversations c on c.id = m.conversation_id join public.pets p on p.id = c.pet_id
    where p.public_token = p_token and c.finder_device_id = p_device_id and c.blocked_at is null and c.expires_at > now()
    order by m.created_at asc;
end;
$$;
revoke all on function public.get_public_messages_v4(text, text, text) from public;
grant execute on function public.get_public_messages_v4(text, text, text) to anon, authenticated;

create or replace function public.report_public_pet(p_token text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pet_id uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if char_length(v_reason) < 1 or char_length(v_reason) > 500 then
    raise exception 'Report must be between 1 and 500 characters';
  end if;
  select id into v_pet_id from public.pets where public_token = p_token limit 1;
  if v_pet_id is null then raise exception 'Pet profile not found'; end if;
  if (select count(*) from public.profile_reports where pet_id = v_pet_id and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'This profile has reached its report limit for now';
  end if;
  insert into public.profile_reports (pet_id, reason) values (v_pet_id, v_reason);
end;
$$;
revoke all on function public.report_public_pet(text, text) from public;
grant execute on function public.report_public_pet(text, text) to anon, authenticated;

create policy "owners can manage conversations" on public.conversations for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "scanners can start a conversation" on public.conversations;
drop policy if exists "scanners and owners can send messages" on public.messages;
drop policy if exists "conversation participants can read messages" on public.messages;
drop policy if exists "owners can send replies" on public.messages;
create policy "conversation participants can read messages" on public.messages for select
  using (exists (select 1 from public.conversations c where c.id = conversation_id and c.owner_id = auth.uid()));
create policy "owners can send replies" on public.messages for insert
  with check (sender_role = 'owner' and exists (
    select 1 from public.conversations c where c.id = conversation_id and c.owner_id = auth.uid()
  ));

create index if not exists conversations_owner_created_idx
  on public.conversations (owner_id, created_at desc);
create index if not exists conversations_pet_device_idx
  on public.conversations (pet_id, finder_device_id, created_at desc);
create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at);

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

create or replace function public.delete_my_reunite_pet(p_pet_id uuid)
returns void
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_photo_url text;
  v_photo_path text;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select photo_url into v_photo_url
  from public.pets
  where id = p_pet_id and owner_id = auth.uid();
  if v_photo_url is null then
    delete from public.pets where id = p_pet_id and owner_id = auth.uid();
    return;
  end if;
  v_photo_path := regexp_replace(v_photo_url, '^.*/storage/v1/object/public/reunite-media/', '');
  delete from storage.objects
    where bucket_id = 'reunite-media'
      and name = v_photo_path
      and (storage.foldername(name))[1] = auth.uid()::text;
  delete from public.pets where id = p_pet_id and owner_id = auth.uid();
end;
$$;
revoke all on function public.delete_my_reunite_pet(uuid) from public;
grant execute on function public.delete_my_reunite_pet(uuid) to authenticated;

create or replace function public.regenerate_pet_qr(p_pet_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_token text;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  update public.pets
    set public_token = replace(gen_random_uuid()::text, '-', '')
    where id = p_pet_id and owner_id = auth.uid()
    returning public_token into v_new_token;
  if v_new_token is null then raise exception 'Pet profile not found'; end if;
  return v_new_token;
end;
$$;
revoke all on function public.regenerate_pet_qr(uuid) from public;
grant execute on function public.regenerate_pet_qr(uuid) to authenticated;

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
