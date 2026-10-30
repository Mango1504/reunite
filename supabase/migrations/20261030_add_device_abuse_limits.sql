-- Add server-side friction against automated anonymous message/report abuse.
alter table public.profile_reports add column if not exists reporter_device_id text;
create index if not exists profile_reports_pet_device_created_idx
  on public.profile_reports (pet_id, reporter_device_id, created_at desc);

drop function if exists public.report_public_pet(text, text);
create or replace function public.report_public_pet_v2(p_token text, p_reason text, p_device_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pet_id uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_device text := btrim(coalesce(p_device_id, ''));
begin
  if char_length(v_reason) < 1 or char_length(v_reason) > 500 then raise exception 'Report must be between 1 and 500 characters'; end if;
  if char_length(v_device) < 16 or char_length(v_device) > 100 then raise exception 'Reporter device identity is invalid'; end if;
  select id into v_pet_id from public.pets where public_token = p_token limit 1;
  if v_pet_id is null then raise exception 'Pet profile not found'; end if;
  if (select count(*) from public.profile_reports where pet_id = v_pet_id and created_at > now() - interval '1 hour') >= 5 then raise exception 'This profile has reached its report limit for now'; end if;
  if (select count(*) from public.profile_reports where pet_id = v_pet_id and reporter_device_id = v_device and created_at > now() - interval '1 hour') >= 2 then raise exception 'This finder session has reached its report limit for now'; end if;
  insert into public.profile_reports (pet_id, reason, reporter_device_id) values (v_pet_id, v_reason, v_device);
end;
$$;
revoke all on function public.report_public_pet_v2(text, text, text) from public;
grant execute on function public.report_public_pet_v2(text, text, text) to anon, authenticated;
