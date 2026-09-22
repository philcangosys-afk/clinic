-- ============================================================================
-- 0182 — إزالة «صندوق الاستقبال التجريبي» وإنشاء صندوق الاستقبال الحقيقي
-- ============================================================================
--
-- بيانات العرض (0118) أنشأت صندوقًا باسم «صندوق الاستقبال التجريبي» (الرمز
-- DEMO-RECEPTION) ومعه مناوبةٌ مفتوحة برصيد افتتاحيّ 500 — فكان يظهر في
-- الصناديق والمناوبات كأنه صندوقٌ عامل، ويُقبض عليه نقدٌ حقيقي.
--
-- لكل صندوقٍ تجريبي:
--   * إن لم يُقبض عليه شيءٌ قط (لا سند على الصندوق ولا على مناوباته): يُحذف
--     هو ومناوباته — لا بيانات مالية فيه.
--   * وإن قُبض عليه: لا يُحذف (السندات بيانات مالية)، بل تُغلق مناوبته
--     المفتوحة ويُعطَّل، ويُسمّى باسمٍ يدلّ على حاله.
-- ثم إن لم يبقَ للمنشأة صندوقٌ نشط غيره يُنشأ «صندوق الاستقبال» الحقيقي
-- (الرمز RECEPTION) بلا مناوبة: المناوبة يفتحها الموظّف برصيده الفعلي.
--
-- آمنة للتكرار.
-- ============================================================================

begin;

do $$
declare
  r        record;
  v_used   boolean;
  v_shifts uuid[];
  v_n_del  integer := 0;
  v_n_off  integer := 0;
  v_n_new  integer := 0;
begin
  for r in
    select id, organization_id, branch_id
      from cash_registers
     where code = 'DEMO-RECEPTION'
  loop
    select coalesce(array_agg(id), '{}') into v_shifts
      from cash_register_shifts where cash_register_id = r.id;

    select exists (
      select 1 from financial_vouchers v
       where v.cash_register_id = r.id
          or v.cash_shift_id = any(v_shifts)
    ) into v_used;

    if not v_used then
      delete from cash_register_shifts where cash_register_id = r.id;
      delete from cash_registers where id = r.id;
      v_n_del := v_n_del + 1;
    else
      update cash_register_shifts
         set status = 'closed',
             closed_at = now(),
             note = coalesce(note || ' — ', '') || 'أُغلقت عند إيقاف الصندوق التجريبي (0182)'
       where cash_register_id = r.id and status = 'open';
      update cash_registers
         set is_disabled = true,
             name = 'صندوق تجريبي (موقوف)',
             updated_at = now()
       where id = r.id;
      v_n_off := v_n_off + 1;
    end if;

    if not exists (
      select 1 from cash_registers c
       where c.organization_id = r.organization_id
         and not c.is_disabled
         and coalesce(c.code, '') <> 'DEMO-RECEPTION'
    ) then
      -- صندوقٌ حقيقيّ بالرمز نفسه عُطّل سابقًا يُعاد تفعيله بدل تكراره
      update cash_registers set is_disabled = false, updated_at = now()
       where organization_id = r.organization_id and code = 'RECEPTION';
      if not found then
        insert into cash_registers (organization_id, branch_id, name, code, requires_shift, allow_negative)
        values (r.organization_id, r.branch_id, 'صندوق الاستقبال', 'RECEPTION', true, false);
      end if;
      v_n_new := v_n_new + 1;
    end if;
  end loop;

  raise notice '0182: حُذف % صندوقًا تجريبيًّا، وأُوقف %، وأُنشئ % صندوقًا حقيقيًّا', v_n_del, v_n_off, v_n_new;
end $$;

-- تحقّق: لا مناوبة مفتوحة على صندوقٍ تجريبي
do $$
begin
  if exists (
    select 1 from cash_register_shifts s
      join cash_registers c on c.id = s.cash_register_id
     where c.code = 'DEMO-RECEPTION' and s.status = 'open'
  ) then
    raise exception '0182: بقيت مناوبة مفتوحة على صندوقٍ تجريبي';
  end if;
end $$;

commit;
