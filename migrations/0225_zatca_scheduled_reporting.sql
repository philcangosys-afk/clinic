-- ============================================================================
-- 0225_zatca_scheduled_reporting.sql
-- ============================================================================
-- طلب المالك (04/10/2026): «يعيد إرسال التي تذهب لقائمة لم تُبلَّغ ZATCA
-- تلقائيًا لأنّ الموظف يمكن أن ينسى».
--
-- المُبلِّغ في المتصفّح لا يعمل إلّا والنظام مفتوح. هذه الترقية تجعل القاعدة
-- نفسها تُبلِّغ كلّ 5 دقائق عبر pg_cron + pg_net ⇐ الدالّة الطرفية
-- `zatca-auto-report` ⇐ `zatca-invoice` (نداء نظام):
--
--   • مفتاح تشغيل عشوائيّ يُولَّد هنا داخل Vault (`zatca_cron_secret`) — لا
--     يظهر في هذا الملفّ ولا لأحد. مهمّة pg_cron تقرؤه من Vault، والدالّتان
--     تتحقّقان منه بـ `zatca_cron_secret_valid` (service_role فقط).
--   • `app_zatca_cron_queue(limit)`: ما لم يُبلَّغ في الإنتاج، لكلّ منشأةٍ فعّلت
--     الإبلاغ التلقائيّ ومنذ تاريخ بدئه — بشروط «فواتير لم تُبلَّغ» نفسها
--     (0200)، و«غير محسومة» أوّلًا. service_role فقط.
--   • مهمّة `zaincare-zatca-auto-report` كلّ 5 دقائق.
--
-- يتطلّب 0179 و0200 و0224، ونشر الدالّتين بـ --no-verify-jwt (لهما حمايتهما).
-- لا يمسّ أرقام الفواتير ولا محتواها.
-- ============================================================================

begin;
set local lock_timeout = '8s';

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── ١) مفتاح التشغيل في Vault (يُولَّد مرّةً، لا يُعرض) ─────────────────────
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'zatca_cron_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'zatca_cron_secret',
      'ZainCare: مفتاح تشغيل الإبلاغ المجدول لـZATCA (0225)');
  end if;
end $$;

create or replace function public.zatca_cron_secret_valid(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(length(p_secret) >= 32, false)
     and exists (select 1 from vault.decrypted_secrets s
                  where s.name = 'zatca_cron_secret' and s.decrypted_secret = p_secret);
$$;

revoke all on function public.zatca_cron_secret_valid(text) from public, anon, authenticated;
grant execute on function public.zatca_cron_secret_valid(text) to service_role;

-- ── ٢) طابور الإبلاغ المجدول ────────────────────────────────────────────────
create or replace function public.app_zatca_cron_queue(p_limit int default 60)
returns table (
  organization_id uuid,
  invoice_id      uuid,
  label           text,
  zatca_status    text,
  attempt_count   int,
  issued_at       timestamptz,
  last_try        timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select si.organization_id,
         si.id,
         coalesce(nullif(si.document_prefix, '') || '-' || si.document_number::text,
                  si.invoice_number::text, si.id::text)::text,
         (case when si.zatca_mode = 'production' then coalesce(si.zatca_status, 'pending') else 'pending' end)::text,
         coalesce(lg.attempt_count, 0),
         si.issued_at,
         lg.updated_at
    from sales_invoices si
    join organization_vat_settings s
      on s.organization_id = si.organization_id
     and s.zatca_auto_report
     and s.zatca_report_from is not null
    left join lateral (
      select l.attempt_count, l.updated_at
        from zatca_invoice_submission_logs l
       where l.invoice_id = si.id and l.mode = 'production'
       order by l.updated_at desc
       limit 1
    ) lg on true
   where si.issued_at is not null
     and si.issued_at >= s.zatca_report_from
     and coalesce(si.status, '') not in ('draft', 'void')
     and not coalesce(si.is_temporary, false)
     and not (si.zatca_mode = 'production' and si.zatca_status in ('reported', 'cleared'))
   order by si.organization_id,
            (si.zatca_mode = 'production' and si.zatca_status = 'ambiguous') desc,
            si.issued_at
   limit greatest(1, least(coalesce(p_limit, 60), 500));
$$;

revoke all on function public.app_zatca_cron_queue(int) from public, anon, authenticated;
grant execute on function public.app_zatca_cron_queue(int) to service_role;

comment on function public.app_zatca_cron_queue(int) is
  'ما لم يُبلَّغ ZATCA (إنتاج) لكلّ منشأةٍ فعّلت الإبلاغ التلقائيّ — «غير محسومة» أوّلًا. للإبلاغ المجدول (service_role). 0225.';

-- ── ٣) المهمّة المجدولة: كلّ 5 دقائق ────────────────────────────────────────
do $$
declare
  v_job bigint;
begin
  for v_job in select jobid from cron.job where jobname = 'zaincare-zatca-auto-report' loop
    perform cron.unschedule(v_job);
  end loop;
end $$;

select cron.schedule(
  'zaincare-zatca-auto-report',
  '*/5 * * * *',
  $cmd$
  select net.http_post(
    url := 'https://rgzdvrluwbwoutvuejmz.supabase.co/functions/v1/zatca-auto-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-zatca-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'zatca_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000);
  $cmd$);

commit;

notify pgrst, 'reload schema';

-- ── النتيجة ─────────────────────────────────────────────────────────────────
select 'المهمّة المجدولة' as "البند",
       coalesce((select schedule || case when active then ' — تعمل' else ' — موقوفة' end
                   from cron.job where jobname = 'zaincare-zatca-auto-report'), 'غير موجودة') as "القيمة"
union all
select 'مفتاح التشغيل في Vault',
       case when exists (select 1 from vault.secrets where name = 'zatca_cron_secret') then 'موجود' else 'مفقود' end
union all
select 'منشآت فعّلت الإبلاغ التلقائيّ',
       (select count(*)::text from organization_vat_settings where zatca_auto_report and zatca_report_from is not null)
union all
select 'فواتير في الطابور الآن', (select count(*)::text from public.app_zatca_cron_queue(500));
