-- ============================================================================
-- 0181 — ضبط اليومية: بداية يوم العمل ونهايته، والإقفال التلقائي
-- ============================================================================
--
-- كانت اليومية تُفتح بأوّل فاتورة وتبقى مفتوحة حتى يضغط أحدٌ «تقفيل» — فإن
-- نُسي الإقفال امتدّت يومية الأحد إلى الثلاثاء، وجُرد صندوقان بيومية واحدة.
--
-- الآن لكل منشأة «ضبط اليومية»:
--   * وقت بداية يوم العمل ووقت نهايته (بتوقيت الرياض). النهاية قد تقع بعد
--     منتصف الليل (مثلًا من 08:00 إلى 02:00) فيُحسب ما بعد منتصف الليل لليوم
--     السابق، وهذا ما يطابق عمل العيادات المسائية.
--   * «الإقفال التلقائي»: تُقفل اليومية عند نهايتها وحدها، وأوّل فاتورة بعدها
--     تفتح يومية التاريخ الجديد.
--
-- الإقفال التلقائي يحدث بطريقين معًا فلا يتوقّف على أحدهما:
--   * عند أوّل عملية بعد موعد الإقفال (فاتورة، سند، فتح شاشة اليومية).
--   * وكل خمس دقائق عبر pg_cron إن كان مفعّلًا في المشروع.
--
-- منشأةٌ لم تضبط يوميتها تبقى على السلوك القديم: إقفالٌ يدويّ فقط.
-- آمنة للتكرار.
-- ============================================================================

begin;

-- ── 1) الإعداد ─────────────────────────────────────────────────────────────
create table if not exists business_day_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  day_start       time not null default '08:00',
  day_end         time not null default '00:00',
  auto_close      boolean not null default true,
  timezone        text not null default 'Asia/Riyadh',
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id)
);

alter table business_day_settings enable row level security;
drop policy if exists business_day_settings_read on business_day_settings;
create policy business_day_settings_read on business_day_settings
  for select using (app_is_member(organization_id));
-- الكتابة عبر `app_set_business_day_settings` وحدها
revoke insert, update, delete on business_day_settings from anon, authenticated;
grant select on business_day_settings to authenticated;

comment on table business_day_settings is
  'ضبط اليومية لكل منشأة (0181): بداية يوم العمل ونهايته بتوقيت المنشأة، والإقفال التلقائي.';

-- ── 2) موعد الإقفال على اليومية نفسها ──────────────────────────────────────
alter table business_days
  add column if not exists scheduled_close_at timestamptz,
  add column if not exists auto_closed        boolean not null default false;

create index if not exists idx_business_days_due
  on business_days (scheduled_close_at)
  where closed_at is null and scheduled_close_at is not null;

-- ── 3) نافذة يوم العمل لأيّ لحظة ───────────────────────────────────────────
/**
 * أيّ يوم عملٍ تقع فيه اللحظة؟ وموعد إقفاله؟
 *
 * يوم العمل D يبدأ عند D+البداية وينتهي عند D+النهاية — أو في اليوم التالي
 * إن كانت النهاية لا تزيد على البداية (عملٌ بعد منتصف الليل). واللحظة التي
 * تقع بين نهاية يومٍ وبداية الذي يليه تُحسب لليوم التالي: من يعمل مبكّرًا
 * يعمل ليوم الغد لا لأمس المُقفل.
 */
create or replace function app_business_day_window(p_organization_id uuid, p_at timestamptz default now())
returns table (business_date date, opens_at timestamptz, closes_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_s     business_day_settings%rowtype;
  v_local timestamp;
  v_d     date;
  v_open  timestamp;
  v_close timestamp;
begin
  select * into v_s from business_day_settings where organization_id = p_organization_id;
  if v_s.organization_id is null then
    v_s.day_start := '00:00';
    v_s.day_end := '00:00';
    v_s.timezone := 'Asia/Riyadh';
  end if;
  v_local := p_at at time zone v_s.timezone;

  foreach v_d in array array[v_local::date - 1, v_local::date]
  loop
    v_open := v_d + v_s.day_start;
    v_close := case when v_s.day_end > v_s.day_start
                    then v_d + v_s.day_end
                    else (v_d + 1) + v_s.day_end end;
    if v_local >= v_open and v_local < v_close then
      return query select v_d, v_open at time zone v_s.timezone, v_close at time zone v_s.timezone;
      return;
    end if;
  end loop;

  -- بين نهاية يومٍ وبداية الذي يليه: لليوم القادم
  v_d := case when v_local < v_local::date + v_s.day_start then v_local::date else v_local::date + 1 end;
  v_open := v_d + v_s.day_start;
  v_close := case when v_s.day_end > v_s.day_start
                  then v_d + v_s.day_end
                  else (v_d + 1) + v_s.day_end end;
  return query select v_d, v_open at time zone v_s.timezone, v_close at time zone v_s.timezone;
end;
$$;

revoke all on function app_business_day_window(uuid, timestamptz) from public, anon;
grant execute on function app_business_day_window(uuid, timestamptz) to authenticated;

-- ── 4) الإقفال التلقائي ─────────────────────────────────────────────────────
/**
 * يُقفل كل يوميةٍ حلّ موعدها في منشأةٍ فعّلت الإقفال التلقائي.
 * `closed_at` هو الموعد المضبوط لا لحظة التنفيذ: اليومية أُقفلت «عند
 * النهاية» ولو اكتُشف ذلك بعد دقائق.
 */
create or replace function app_close_due_business_days_internal(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_n   integer := 0;
begin
  for v_row in
    select d.id, d.organization_id, d.branch_id, d.day_number, d.scheduled_close_at
      from business_days d
      join business_day_settings s on s.organization_id = d.organization_id and s.auto_close
     where d.closed_at is null
       and d.scheduled_close_at is not null
       and d.scheduled_close_at <= now()
       and (p_organization_id is null or d.organization_id = p_organization_id)
     for update of d skip locked
  loop
    update business_days
       set closed_at = v_row.scheduled_close_at,
           auto_closed = true,
           note = coalesce(note, 'أُقفلت تلقائيًا عند نهاية يوم العمل المضبوطة')
     where id = v_row.id;

    insert into audit_log (organization_id, user_id, module, action_type, entity_id,
                           entity_title, details, branch_id)
    values (v_row.organization_id, null, 'billing', 'update', v_row.id,
            'إقفال اليومية تلقائيًا',
            format('اليومية رقم %s أُقفلت عند %s حسب ضبط اليومية', v_row.day_number,
                   to_char(v_row.scheduled_close_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI')),
            v_row.branch_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke all on function app_close_due_business_days_internal(uuid) from public, anon, authenticated;

/** للواجهة: يُقفل ما حلّ موعده في منشأة المستخدم وحدها. */
create or replace function app_close_due_business_days(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app_is_member(p_organization_id) then
    raise exception 'لست عضوًا في هذه المنشأة';
  end if;
  return app_close_due_business_days_internal(p_organization_id);
end;
$$;

revoke all on function app_close_due_business_days(uuid) from public, anon;
grant execute on function app_close_due_business_days(uuid) to authenticated;

/** لـpg_cron: كل المنشآت. */
create or replace function app_close_due_business_days_all()
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  select app_close_due_business_days_internal(null);
$$;

revoke all on function app_close_due_business_days_all() from public, anon, authenticated;

-- ── 5) فتح اليومية بتاريخها وموعد إقفالها ──────────────────────────────────
create or replace function app_ensure_business_day(p_organization_id uuid, p_branch_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id     uuid;
  v_num    bigint;
  v_window record;
begin
  -- يومية حلّ موعدها تُقفل قبل أن تُنسب إليها عملية جديدة
  perform app_close_due_business_days_internal(p_organization_id);

  select id into v_id
    from business_days
   where organization_id = p_organization_id
     and coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and closed_at is null
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  -- قفل على مستوى المنشأة والفرع: فاتورتان في اللحظة نفسها كانتا ستفتحان
  -- يوميتَين، ويرفض الفهرس الثانية فتفشل فاتورة صحيحة.
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':day:' || coalesce(p_branch_id::text, '-'), 0));

  select id into v_id
    from business_days
   where organization_id = p_organization_id
     and coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and closed_at is null
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  select coalesce(max(day_number), 0) + 1 into v_num
    from business_days where organization_id = p_organization_id;

  select * into v_window from app_business_day_window(p_organization_id, now());

  insert into business_days (organization_id, branch_id, day_number, business_date,
                             opened_by, scheduled_close_at)
  values (p_organization_id, p_branch_id, v_num, v_window.business_date, auth.uid(),
          case when exists (select 1 from business_day_settings s
                             where s.organization_id = p_organization_id)
               then v_window.closes_at end)
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function app_ensure_business_day(uuid, uuid) from public, anon;
grant execute on function app_ensure_business_day(uuid, uuid) to authenticated;

-- ── 6) حفظ الضبط ───────────────────────────────────────────────────────────
create or replace function app_set_business_day_settings(
  p_organization_id uuid,
  p_day_start       time,
  p_day_end         time,
  p_auto_close      boolean default true)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_open record;
  v_w    record;
begin
  if not app_has_role(p_organization_id,
        array['owner','organization_admin','branch_manager','accountant']) then
    raise exception 'صلاحيتك لا تسمح بضبط اليومية';
  end if;
  if p_day_start is null or p_day_end is null then
    raise exception 'حدّد وقت بداية اليومية ووقت نهايتها';
  end if;

  insert into business_day_settings (organization_id, day_start, day_end, auto_close,
                                     updated_at, updated_by)
  values (p_organization_id, p_day_start, p_day_end, coalesce(p_auto_close, true),
          now(), auth.uid())
  on conflict (organization_id) do update
     set day_start = excluded.day_start,
         day_end = excluded.day_end,
         auto_close = excluded.auto_close,
         updated_at = now(),
         updated_by = auth.uid();

  -- اليومية المفتوحة تأخذ موعد إقفالها من الضبط الجديد: نهاية يوم عملها
  for v_open in
    select id, business_date from business_days
     where organization_id = p_organization_id and closed_at is null
  loop
    select * into v_w
      from app_business_day_window(p_organization_id,
             ((v_open.business_date + p_day_start) at time zone
               (select timezone from business_day_settings where organization_id = p_organization_id)));
    update business_days set scheduled_close_at = v_w.closes_at where id = v_open.id;
  end loop;

  insert into audit_log (organization_id, user_id, module, action_type, entity_title, details)
  values (p_organization_id, auth.uid(), 'billing', 'update', 'ضبط اليومية',
          format('بداية %s — نهاية %s — الإقفال التلقائي %s',
                 to_char(p_day_start, 'HH24:MI'), to_char(p_day_end, 'HH24:MI'),
                 case when coalesce(p_auto_close, true) then 'مفعّل' else 'معطّل' end));
end;
$$;

revoke all on function app_set_business_day_settings(uuid, time, time, boolean) from public, anon;
grant execute on function app_set_business_day_settings(uuid, time, time, boolean) to authenticated;

-- ── 7) الملخّص يحمل موعد الإقفال وطريقته ───────────────────────────────────
create or replace view v_business_day_summary as
select
  d.id                                    as business_day_id,
  d.organization_id,
  d.branch_id,
  d.day_number,
  d.business_date,
  d.opened_at,
  d.closed_at,
  d.closed_by,
  d.note,
  (d.closed_at is null)                   as is_open,
  coalesce(inv.invoices_count, 0)         as invoices_count,
  coalesce(inv.gross_amount, 0)           as gross_amount,
  coalesce(inv.discount_amount, 0)        as discount_amount,
  coalesce(inv.vat_amount, 0)             as vat_amount,
  coalesce(inv.exemption_amount, 0)       as exemption_amount,
  coalesce(inv.net_amount, 0)             as net_amount,
  coalesce(vch.collected_amount, 0)       as collected_amount,
  coalesce(vch.refunded_amount, 0)        as refunded_amount,
  coalesce(vch.collected_amount, 0) - coalesce(vch.refunded_amount, 0) as net_collected_amount,
  coalesce(inv.net_amount, 0) - (coalesce(vch.collected_amount, 0) - coalesce(vch.refunded_amount, 0))
                                          as outstanding_amount,
  d.scheduled_close_at,
  d.auto_closed
from business_days d
left join lateral (
  select count(*)                                     as invoices_count,
         sum(i.subtotal_amount)                       as gross_amount,
         sum(i.discount_amount)                       as discount_amount,
         sum(i.vat_amount)                            as vat_amount,
         sum(i.exemption_amount)                      as exemption_amount,
         sum(i.net_amount)                            as net_amount
    from sales_invoices i
   where i.business_day_id = d.id
     and i.status <> 'void'
     and not coalesce(i.is_temporary, false)
) inv on true
left join lateral (
  select sum(case when v.voucher_type = 'receipt' then v.amount else 0 end) as collected_amount,
         sum(case when v.voucher_type <> 'receipt' then v.amount else 0 end) as refunded_amount
    from financial_vouchers v
   where v.business_day_id = d.id
     and not coalesce(v.is_void, false)
) vch on true;

alter view v_business_day_summary set (security_invoker = on);
grant select on v_business_day_summary to authenticated;

-- ── 8) pg_cron إن وُجد: فحصٌ كل خمس دقائق ──────────────────────────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'zaincare-close-due-business-days';
    perform cron.schedule('zaincare-close-due-business-days', '*/5 * * * *',
                          'select public.app_close_due_business_days_all()');
  end if;
end $$;

commit;
