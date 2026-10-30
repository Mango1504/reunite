-- Pet photos are intentionally public only when the owner enables public_photo.
-- Restrict uploaded content and allow owners to remove old media when visibility
-- is disabled or a replacement is uploaded.
update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
where id = 'reunite-media';

drop policy if exists "owners can delete pet photos" on storage.objects;
create policy "owners can delete pet photos" on storage.objects for delete to authenticated
  using (bucket_id = 'reunite-media' and (storage.foldername(name))[1] = auth.uid()::text);
