-- Remove superseded anonymous APIs. The live client uses only the v2/v3/v5
-- device-scoped functions retained in schema.sql.
drop function if exists public.get_public_messages(text);
drop function if exists public.get_public_pet(text);
drop function if exists public.get_public_pet_v2(text);
drop function if exists public.get_public_messages_v2(text);
drop function if exists public.get_public_messages_v3(text, text);
drop function if exists public.get_public_messages_v4(text, text, text);
drop function if exists public.send_public_message(text, text, double precision, double precision, double precision);
drop function if exists public.send_public_reply(text, uuid, text, double precision, double precision, double precision);
drop function if exists public.mark_public_messages_seen(text);
