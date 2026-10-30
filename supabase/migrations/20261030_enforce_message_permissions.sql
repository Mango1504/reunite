-- Make the database enforce the same message rules as the UI.
drop policy if exists "owners can manage conversations" on public.conversations;
create policy "owners can manage conversations" on public.conversations for all
  using (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.pets p where p.id = pet_id and p.owner_id = (select auth.uid()))
  ) with check (
    (select auth.uid()) = owner_id
    and exists (select 1 from public.pets p where p.id = pet_id and p.owner_id = (select auth.uid()))
  );

drop policy if exists "owners can send replies" on public.messages;
create policy "owners can send replies" on public.messages for insert
  with check (
    sender_role = 'owner'
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and c.owner_id = (select auth.uid())
        and c.request_status = 'accepted'
        and c.blocked_at is null
        and c.expires_at > now()
    )
  );
