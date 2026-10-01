-- ============================================================================
-- 0198 — ربط حساب الدخول ببطاقة الطبيب (`doctors.user_id`)
-- ============================================================================
--
-- النظام يعرف «أيّ طبيبٍ أنت» من `doctors.user_id = auth.uid()`: عليه تُحصَر
-- شاشات الطبيب (مرضاه ومواعيده)، ويعمل «يومي» و«زيارات لم تُغلق» في مساحة
-- الطبيب، ويُعرف الطبيب المُصدِر للفاتورة. ولم تكن شاشةٌ تضبط هذا العمود —
-- الحساب يُنشأ من الموظفين أو المستخدمين ويبقى غير مربوطٍ إلّا بـSQL يدويّ.
--
-- ما يضيفه:
--   * `app_doctor_account_candidates(org)` — حسابات المنشأة النشطة بالاسم
--     والبريد والدور والطبيب المربوط بها إن وُجد. معرّفة بصلاحية المالك
--     (security definer) لأنّ البريد في `auth.users` لا يقرؤه المتصفّح.
--   * `app_set_doctor_user(doctor, user)` — ربطٌ أو فكٌّ (user = null) ذرّيّ:
--     صلاحية `users.manage`، والحساب عضوٌ نشط في منشأة الطبيب، ولا يُربط
--     حسابٌ واحد بطبيبين، وسطر تدقيق بالقديم والجديد.
--   * فهرس تفرّدٍ جزئيّ (منشأة، حساب) — يُتخطّى برسالةٍ إن وُجد تكرارٌ قديم،
--     والدالّة تمنع التكرار في الحالين.
--
-- آمنٌ لإعادة التنفيذ.
-- ============================================================================

begin;

-- ── فهرس التفرّد ────────────────────────────────────────────────────────────
do $$
declare v_dups text;
begin
  select string_agg(format('%s ← %s', user_id, names), '؛ ')
    into v_dups
    from (select user_id, string_agg(name_ar, ' و') as names
            from doctors
           where user_id is not null
           group by organization_id, user_id
          having count(*) > 1) d;
  if v_dups is not null then
    raise notice 'لم يُنشأ فهرس التفرّد: حسابٌ مربوط بأكثر من طبيب (%). افكك الزائد من شاشة الأطباء ثمّ أعد تنفيذ 0198.', v_dups;
  else
    create unique index if not exists uq_doctors_org_user
      on doctors (organization_id, user_id) where user_id is not null;
  end if;
end $$;

-- ── الحسابات المرشّحة ───────────────────────────────────────────────────────
create or replace function app_doctor_account_candidates(p_organization_id uuid)
returns table (
  user_id            uuid,
  display_name       text,
  email              text,
  role_key           text,
  custom_role_name   text,
  member_kind        text,
  linked_doctor_id   uuid,
  linked_doctor_name text
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if not app_has_permission(p_organization_id, 'users.manage') then
    raise exception 'صلاحيتك لا تسمح بربط حسابات الدخول (users.manage)';
  end if;

  return query
  select m.user_id,
         coalesce(nullif(btrim(m.display_name), ''), e.name_ar, d.name_ar,
                  'مستخدم ' || substring(m.user_id::text, 1, 8))::text,
         u.email::text,
         m.role_key::text,
         r.name_ar::text,
         m.member_kind::text,
         d.id,
         d.name_ar::text
    from organization_memberships m
    left join auth.users u on u.id = m.user_id
    left join organization_roles r on r.id = m.custom_role_id
    left join lateral (
      select x.id, x.name_ar from doctors x
       where x.organization_id = m.organization_id and x.user_id = m.user_id
       order by x.is_enabled desc, x.file_number
       limit 1
    ) d on true
    left join lateral (
      select y.name_ar from employees y
       where y.organization_id = m.organization_id and y.user_id = m.user_id
       limit 1
    ) e on true
   where m.organization_id = p_organization_id
     and m.is_active
   order by 2;
end $$;

revoke all on function app_doctor_account_candidates(uuid) from public, anon;
grant execute on function app_doctor_account_candidates(uuid) to authenticated;

-- ── الربط والفكّ ────────────────────────────────────────────────────────────
create or replace function app_set_doctor_user(p_doctor_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_doc   doctors%rowtype;
  v_other text;
  v_old   text;
  v_new   text;
begin
  select * into v_doc from doctors where id = p_doctor_id for update;
  if v_doc.id is null then raise exception 'الطبيب غير موجود'; end if;
  if not app_has_permission(v_doc.organization_id, 'users.manage') then
    raise exception 'صلاحيتك لا تسمح بربط حسابات الدخول (users.manage)';
  end if;
  if v_doc.user_id is not distinct from p_user_id then
    return;  -- لا تغيير
  end if;

  if p_user_id is not null then
    if not exists (select 1 from organization_memberships m
                    where m.organization_id = v_doc.organization_id
                      and m.user_id = p_user_id and m.is_active) then
      raise exception 'الحساب ليس عضوًا نشطًا في هذه المنشأة';
    end if;
    select name_ar into v_other from doctors
     where organization_id = v_doc.organization_id
       and user_id = p_user_id and id <> v_doc.id
     limit 1;
    if v_other is not null then
      raise exception 'هذا الحساب مربوطٌ بالطبيب «%» — افكك ربطه هناك أوّلًا', v_other;
    end if;
  end if;

  select email into v_old from auth.users where id = v_doc.user_id;
  select email into v_new from auth.users where id = p_user_id;

  update doctors set user_id = p_user_id where id = v_doc.id;

  insert into audit_log (organization_id, user_id, action_type, module, entity_id, entity_title, details)
  values (v_doc.organization_id, auth.uid(), 'update', 'doctors', v_doc.id,
          case when p_user_id is null then 'فكّ حساب الدخول عن الطبيب ' else 'ربط حساب الدخول بالطبيب ' end
            || v_doc.name_ar,
          jsonb_build_object('from', coalesce(v_old, v_doc.user_id::text),
                             'to',   coalesce(v_new, p_user_id::text))::text);
end $$;

revoke all on function app_set_doctor_user(uuid, uuid) from public, anon;
grant execute on function app_set_doctor_user(uuid, uuid) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ── تحقّق ──────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'app_set_doctor_user')
     or not exists (select 1 from pg_proc where proname = 'app_doctor_account_candidates') then
    raise exception '0198 لم تكتمل';
  end if;
end $$;

-- المعاينة: الأطباء المربوطون الآن
select d.name_ar as "الطبيب", u.email as "حساب الدخول"
  from doctors d
  left join auth.users u on u.id = d.user_id
 where d.is_enabled
 order by d.user_id is null, d.name_ar;
