-- Pin every privileged function to an empty search path. All relations and
-- privileged calls in these functions are already explicitly schema-qualified.
alter function public.ensure_message_delivery_status() set search_path = '';
alter function public.broadcast_reunite_message() set search_path = '';
alter function public.get_public_pet_v3(text) set search_path = '';
alter function public.mark_public_messages_seen_v2(text, text) set search_path = '';
alter function public.send_public_message_v2(text, text, text, double precision, double precision, double precision) set search_path = '';
alter function public.send_public_reply_v2(text, text, uuid, text, double precision, double precision, double precision) set search_path = '';
alter function public.get_public_messages_v5(text, text, text) set search_path = '';
alter function public.report_public_pet(text, text) set search_path = '';
alter function public.delete_expired_reunite_conversations() set search_path = '';
alter function public.delete_my_reunite_data() set search_path = '';
alter function public.delete_my_reunite_pet(uuid) set search_path = '';
alter function public.regenerate_pet_qr(uuid) set search_path = '';
