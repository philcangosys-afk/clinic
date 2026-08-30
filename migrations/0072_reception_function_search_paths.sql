begin;

alter function app_normalize_mobile(text)
  set search_path = public, pg_temp;

alter function app_queue_rank(text)
  set search_path = public, pg_temp;

commit;
