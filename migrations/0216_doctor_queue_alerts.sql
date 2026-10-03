-- ============================================================================
-- 0216 — «نداء» و«دخل» و«خرج» من الطبيب ⇐ تنبيهٌ فوريّ للاستقبال
-- ----------------------------------------------------------------------------
-- طلب المالك (03/10/2026): حين يضغط الطبيب نداء أو دخل أو خرج من «مرضى اليوم»
-- ينتبه الاستقبال — نافذة وصوت (LiveNotifier، 0210).
--
--   • «نداء» صار للطبيب أيضًا على مرضاه: يطلب المريض إلى غرفته (وإعادة النداء
--     إن لم يصل). يُمنح `reception.call` لصفة الطبيب الافتراضية ولصفات المنشأة
--     المبنيّة عليها. «وصل» يبقى للاستقبال وحده.
--   • `app_doctor_queue_step` — الطبيب ينفّذ الخطوة بالدالّة القائمة نفسها
--     (`app_reception_transition`: الصلاحية والفرع والحالة والزيارة)، ثمّ يُنبَّه
--     كلّ من يسجّل وصول المرضى (صلاحية reception.check_in) — بلا المالك ومدير
--     المنشأة ولا الأطباء. «نداء» بخطورة «تحذير» (نغمة أطول)، والباقي «معلومة».
--   • على مرضاه وحدهم: الموعد لطبيبٍ حسابُه هو المستخدم.
--   • فشل كتابة التنبيه لا يُفشل الخطوة نفسها.
--
-- لا يمسّ الفواتير ولا ZATCA. معاملة واحدة، آمنة للتكرار.
-- ============================================================================

begin;
set local lock_timeout = '8s';

-- ── ١) «نداء» للطبيب ─────────────────────────────────────────────────────────
insert into role_default_permissions (role_key, permission_key)
select 'doctor', 'reception.call'
 where exists (select 1 from permission_catalog where permission_key = 'reception.call')
on conflict (role_key, permission_key) do nothing;

with targets as (
  select r.organization_id, r.id as role_id, r.name_ar
    from organization_roles r
   where r.base_role_key = 'doctor'
     and r.is_active
     and not r.is_archived
     and exists (select 1 from permission_catalog where permission_key = 'reception.call')
     and not exists (select 1 from organization_role_permissions x
                      where x.role_id = r.id and x.permission_key = 'reception.call')
),
granted as (
  insert into organization_role_permissions (organization_id, role_id, permission_key)
  select organization_id, role_id, 'reception.call' from targets
  returning organization_id, role_id
)
insert into audit_log (organization_id, user_id, module, action_type, entity_title, details)
select t.organization_id, null, 'users', 'update', 'صلاحية نداء المريض',
       'مُنح «نداء المريض» لـ: ' || string_agg(distinct coalesce(t.name_ar, 'طبيب'), '، ') || ' (0216)'
  from targets t
 where exists (select 1 from granted g where g.role_id = t.role_id)
 group by t.organization_id;

-- ── ٢) خطوة الطبيب + تنبيه الاستقبال ────────────────────────────────────────
create or replace function app_doctor_queue_step(p_appointment_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a        appointments%rowtype;
  v_status text;
  v_visit  uuid;
  v_doc    text;
  v_title  text;
  v_body   text;
  v_sev    text;
  v_key    text;
  v_u      uuid;
  v_n      integer := 0;
begin
  if p_action not in ('call', 'recall', 'start', 'finish') then
    raise exception 'الإجراء % غير متاح للطبيب', p_action;
  end if;

  select * into a from appointments where id = p_appointment_id;
  if a.id is null then
    raise exception 'الموعد غير موجود';
  end if;
  if a.doctor_id is null or app_doctor_user_id(a.doctor_id) is distinct from auth.uid() then
    raise exception 'هذا المريض ليس من مرضاك';
  end if;

  -- الخطوة نفسها بقاعدة الاستقبال (الصلاحية، الفرع، الحالة، فتح الزيارة)
  select t.appointment_status, t.visit_id into v_status, v_visit
    from app_reception_transition(p_appointment_id, p_action, null) t;

  begin
    select d.name_ar into v_doc from doctors d where d.id = a.doctor_id;
    v_doc := coalesce(v_doc, 'الطبيب');
    v_title := case p_action
      when 'call'   then 'نداء من ' || v_doc
      when 'recall' then 'إعادة نداء من ' || v_doc
      when 'start'  then 'دخل المريض عند ' || v_doc
      else               'خرج المريض من عند ' || v_doc
    end;
    v_body := concat_ws(' · ',
      app_patient_label(a.patient_id),
      case when a.queue_number is not null then 'رقم الدور ' || a.queue_number end,
      case p_action
        when 'call'   then 'أرسِله إلى غرفة الطبيب'
        when 'recall' then 'لم يصل بعد — نادِه مرّةً أخرى'
        when 'finish' then 'للمحاسبة أو موعد المتابعة'
      end);
    v_sev := case when p_action in ('call', 'recall') then 'warning' else 'info' end;
    -- النداء والدخول والخروج مرّةً لكلّ موعد؛ إعادة النداء كلّ مرّة
    v_key := 'doc_' || p_action || ':' || a.id::text
             || case when p_action = 'recall' then ':' || floor(extract(epoch from clock_timestamp()))::bigint::text else '' end;

    for v_u in
      select distinct e.user_id
        from v_user_effective_permissions e
       where e.organization_id = a.organization_id
         and e.permission_key = 'reception.check_in'
         and e.is_allowed
         and e.role_key not in ('owner', 'organization_admin')
         and e.user_id is distinct from auth.uid()
         and not exists (select 1 from doctors d
                          where d.organization_id = a.organization_id and d.user_id = e.user_id)
    loop
      if app_notify(a.organization_id, v_u, 'doctor_queue_' || p_action, v_title, v_key, v_body,
                    'operational', v_sev, 'appointment', a.id, '/reception', a.branch_id) is not null then
        v_n := v_n + 1;
      end if;
    end loop;
  exception when others then
    raise warning 'تنبيه الاستقبال لم يُكتب (موعد %): %', a.id, sqlerrm;
  end;

  return jsonb_build_object('status', v_status, 'visit_id', v_visit, 'notified', v_n);
end $$;

revoke all on function app_doctor_queue_step(uuid, text) from public, anon;
grant execute on function app_doctor_queue_step(uuid, text) to authenticated;

comment on function app_doctor_queue_step(uuid, text) is
  'نداء/إعادة نداء/دخل/خرج من الطبيب على مرضاه بقاعدة app_reception_transition، مع تنبيه الاستقبال (0216).';

commit;

-- ── النتيجة: من يُنبَّه، ومن من الأطباء يستطيع «نداء» ────────────────────────
select app_member_user_name(e.organization_id, e.user_id) as "المستخدم",
       case when e.permission_key = 'reception.check_in' then 'يصله تنبيه الطبيب'
            else 'طبيب: ' || case when e.is_allowed then 'يستطيع النداء' else 'لا يستطيع النداء' end end as "الحالة"
  from v_user_effective_permissions e
 where (e.permission_key = 'reception.check_in' and e.is_allowed
        and e.role_key not in ('owner', 'organization_admin')
        and not exists (select 1 from doctors d where d.organization_id = e.organization_id and d.user_id = e.user_id))
    or (e.permission_key = 'reception.call'
        and exists (select 1 from doctors d where d.organization_id = e.organization_id and d.user_id = e.user_id))
 order by 2, 1;
