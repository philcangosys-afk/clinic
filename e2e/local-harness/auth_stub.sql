create schema if not exists auth;
-- البريد varchar(255) كما في Supabase الحقيقي، لا text: الفرق ليس تجميليًّا،
-- فترحيل 0062 يعيد بناء عرض التدقيق بنوع varchar(255) فيفشل على text.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email character varying(255),
  raw_user_meta_data jsonb,
  created_at timestamptz default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated')
$$;
create or replace function auth.email() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.email', true), '')
$$;
create extension if not exists pgcrypto;

-- محاكاة إعداد Supabase الحقيقي: المنصّة تمنح anon و authenticated كل
-- الصلاحيات على جداول public وتترك الحماية الفعلية لسياسات RLS. بدون هذا
-- تفشل الفحوص بـ«permission denied» فتُخفي الأخطاء الحقيقية. تُضبط قبل تنفيذ
-- الترحيلات حتى تسري على كل جدول يُنشأ لاحقًا، فتبقى أي revoke داخل ترحيل
-- سارية كما هي على الإنتاج.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
