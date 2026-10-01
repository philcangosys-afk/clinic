-- ============================================================================
-- 0200 — الإبلاغ التلقائيّ لـZATCA وقائمة «فواتير لم تُبلَّغ»
-- ============================================================================
--
-- الإرسال كان يدويًّا فاتورةً فاتورة بعبارة تأكيد. والفاتورة المبسّطة يجب
-- إبلاغ ZATCA بها خلال 24 ساعة من إصدارها — فمع عشرات الفواتير يوميًّا تتأخّر
-- فاتورةٌ أو تُنسى.
--
-- ما يضيفه (يحتاج 0179):
--   * إعدادان في `organization_vat_settings`:
--       `zatca_auto_report`  — تُبلَّغ الفاتورة تلقائيًّا بعد إصدارها، ويُعاد
--                              ما تعذّر كلّ بضع دقائق ما دام التطبيق مفتوحًا
--                              عند مستخدمٍ يملك `billing.issue`.
--       `zatca_report_from` — تُبلَّغ الفواتير الصادرة من هذه اللحظة فقط، فلا
--                              تُرسل فواتير التجربة قبل التشغيل الحقيقيّ.
--   * `app_set_zatca_auto_report(org, enabled, report_from)` — بصلاحية
--     `integrations.manage` وسطر تدقيق.
--   * `app_zatca_pending_invoices(org, limit)` — الصادرة غير الملغاة منذ
--     `zatca_report_from` ولم تُقبل في الإنتاج بعد، بآخر خطأٍ وعمرها بالساعات.
--
-- الإرسال نفسه يبقى في الدالّة الطرفية `zatca-invoice` بكلّ حراساتها — هنا
-- الإعداد والقائمة فقط. آمنٌ لإعادة التنفيذ.
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.zatca_invoice_submission_logs') is null then
    raise exception 'نفّذ ترقيات الربط مع ZATCA أوّلًا (0178 ← 0179 ← 0180)';
  end if;
end $$;

alter table organization_vat_settings
  add column if not exists zatca_auto_report boolean not null default false,
  add column if not exists zatca_report_from timestamptz;

comment on column organization_vat_settings.zatca_auto_report is
  'تُبلَّغ ZATCA (الإنتاج) بالفاتورة تلقائيًّا بعد إصدارها، ويُعاد ما تعذّر. 0200.';
comment on column organization_vat_settings.zatca_report_from is
  'تُبلَّغ الفواتير الصادرة من هذه اللحظة فقط — ما قبلها تجربةٌ لا تُرسل. 0200.';

-- ── الإعداد ─────────────────────────────────────────────────────────────────
create or replace function app_set_zatca_auto_report(
  p_organization_id uuid,
  p_enabled         boolean,
  p_report_from     timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app_has_permission(p_organization_id, 'integrations.manage') then
    raise exception 'صلاحيتك لا تسمح بإعدادات الربط (integrations.manage)';
  end if;
  if coalesce(p_enabled, false) and p_report_from is null then
    raise exception 'حدّد تاريخ بدء الإبلاغ قبل تفعيل الإبلاغ التلقائيّ';
  end if;

  insert into organization_vat_settings (organization_id, zatca_auto_report, zatca_report_from)
  values (p_organization_id, coalesce(p_enabled, false), p_report_from)
  on conflict (organization_id) do update
     set zatca_auto_report = excluded.zatca_auto_report,
         zatca_report_from = excluded.zatca_report_from;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id, entity_title, details)
  values (p_organization_id, auth.uid(), 'integrations', 'update', p_organization_id,
          case when coalesce(p_enabled, false) then 'تفعيل الإبلاغ التلقائيّ لـZATCA'
               else 'إيقاف الإبلاغ التلقائيّ لـZATCA' end,
          jsonb_build_object('report_from', p_report_from)::text);
end $$;

revoke all on function app_set_zatca_auto_report(uuid, boolean, timestamptz) from public, anon;
grant execute on function app_set_zatca_auto_report(uuid, boolean, timestamptz) to authenticated;

-- ── فواتير لم تُبلَّغ ─────────────────────────────────────────────────────────
create or replace function app_zatca_pending_invoices(p_organization_id uuid, p_limit int default 300)
returns table (
  invoice_id      uuid,
  label           text,
  document_type   text,
  issued_at       timestamptz,
  customer_name   text,
  net_amount      numeric,
  zatca_status    text,
  zatca_mode      text,
  last_error      text,
  attempt_count   int,
  hours_pending   numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_from timestamptz;
begin
  if not (app_has_permission(p_organization_id, 'billing.view')
          or app_has_permission(p_organization_id, 'billing.issue')) then
    raise exception 'صلاحيتك لا تسمح بعرض الفواتير (billing.view)';
  end if;
  select s.zatca_report_from into v_from
    from organization_vat_settings s where s.organization_id = p_organization_id;
  if v_from is null then
    return;  -- لم يُحدَّد بدء الإبلاغ بعد
  end if;

  return query
  select si.id,
         coalesce(nullif(si.document_prefix, '') || '-' || si.document_number::text,
                  si.invoice_number::text, si.id::text)::text,
         coalesce(si.document_type, 'invoice')::text,
         si.issued_at,
         coalesce(p.name_ar, si.external_customer_name)::text,
         si.net_amount,
         case when si.zatca_mode = 'production' then si.zatca_status else 'pending' end::text,
         si.zatca_mode::text,
         lg.last_error,
         coalesce(lg.attempt_count, 0),
         round(extract(epoch from (now() - si.issued_at)) / 3600.0, 1)
    from sales_invoices si
    left join patients p on p.id = si.patient_id
    left join lateral (
      select l.last_error, l.attempt_count
        from zatca_invoice_submission_logs l
       where l.invoice_id = si.id and l.mode = 'production'
       order by l.updated_at desc
       limit 1
    ) lg on true
   where si.organization_id = p_organization_id
     and si.issued_at is not null
     and si.issued_at >= v_from
     and coalesce(si.status, '') not in ('draft', 'void')
     and not coalesce(si.is_temporary, false)
     and not (si.zatca_mode = 'production' and si.zatca_status in ('reported', 'cleared'))
   order by si.issued_at
   limit greatest(1, least(coalesce(p_limit, 300), 1000));
end $$;

revoke all on function app_zatca_pending_invoices(uuid, int) from public, anon;
grant execute on function app_zatca_pending_invoices(uuid, int) to authenticated;

commit;

notify pgrst, 'reload schema';

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'app_zatca_pending_invoices')
     or not exists (select 1 from pg_proc where proname = 'app_set_zatca_auto_report') then
    raise exception '0200 لم تكتمل';
  end if;
end $$;
