-- Permanently delete the signed-in owner's Reunite data and Auth account.
-- The caller can only delete the account represented by auth.uid().
drop function if exists public.delete_my_reunite_data();
drop function if exists public.delete_my_reunite_account();

create or replace function public.delete_my_reunite_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'You must be signed in';
  end if;

  delete from storage.objects
    where bucket_id = 'reunite-media'
      and owner_id = v_user_id;

  delete from public.owner_profiles where id = v_user_id;
  delete from public.pets where owner_id = v_user_id;
  delete from auth.users where id = v_user_id;
end;
$$;

revoke all on function public.delete_my_reunite_account() from public;
grant execute on function public.delete_my_reunite_account() to authenticated;
