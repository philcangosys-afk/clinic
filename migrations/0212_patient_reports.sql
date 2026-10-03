-- ============================================================================
-- 0212 — تقارير المريض (نموذج Kizen): نصّ الإقرار، وعدّاد الطباعة
-- ----------------------------------------------------------------------------
-- • نصّ الإقرار في «ملف المريض» قابلٌ للتعديل لكلّ منشأة — عمودٌ في
--   organization_policies القائم (لا جدول جديد). فارغٌ = النصّ الافتراضيّ.
-- • «Printed Count» على كرت المريض ولصاقته وكشفه: يُحسب من سجلّ التدقيق
--   القائم — كل طباعةٍ سطرٌ فيه، والعدد = عدد أسطر هذا التقرير لهذا المريض.
-- لا يمسّ الفواتير ولا ZATCA. آمنة للتكرار. معاملةٌ واحدة بمهلة قفل 8 ثوانٍ.
-- ============================================================================

begin;
set local lock_timeout = '8s';

alter table organization_policies
  add column if not exists patient_file_acknowledgment text;

comment on column organization_policies.patient_file_acknowledgment is
  'نصّ إقرار المريض المطبوع في تقرير «ملف المريض» (0212). فارغ = النصّ الافتراضيّ.';

create or replace function app_set_patient_file_acknowledgment(p_organization_id uuid, p_text text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app_has_role(p_organization_id, array['owner', 'organization_admin', 'branch_manager']) then
    raise exception 'تعديل نصّ الإقرار للمالك أو مدير المنشأة أو مدير الفرع';
  end if;
  if length(coalesce(p_text, '')) > 4000 then
    raise exception 'النصّ أطول من 4000 حرف';
  end if;
  insert into organization_policies (organization_id, patient_file_acknowledgment)
  values (p_organization_id, nullif(btrim(coalesce(p_text, '')), ''))
  on conflict (organization_id) do update
     set patient_file_acknowledgment = excluded.patient_file_acknowledgment,
         updated_at = now();
  insert into audit_log (organization_id, user_id, module, action_type, entity_title, details)
  values (p_organization_id, auth.uid(), 'settings', 'update', 'نصّ إقرار ملف المريض',
          case when nullif(btrim(coalesce(p_text, '')), '') is null then 'أُعيد النصّ الافتراضيّ' else 'عُدِّل النصّ' end);
end;
$$;
revoke all on function app_set_patient_file_acknowledgment(uuid, text) from public, anon;
grant execute on function app_set_patient_file_acknowledgment(uuid, text) to authenticated;

-- قراءة النصّ لكلّ عضو (السياسات قد تكون مقيّدة القراءة)
create or replace function app_patient_file_acknowledgment(p_organization_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when app_is_member(p_organization_id)
              then (select patient_file_acknowledgment from organization_policies
                     where organization_id = p_organization_id) end;
$$;
revoke all on function app_patient_file_acknowledgment(uuid) from public, anon;
grant execute on function app_patient_file_acknowledgment(uuid) to authenticated;

/**
 * يسجّل طباعة تقريرٍ لمريض ويعيد عددها (هذه منها) — «Printed Count».
 */
create or replace function app_log_patient_print(p_patient_id uuid, p_report text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org   uuid;
  v_title text := 'طباعة: ' || left(btrim(coalesce(p_report, 'تقرير')), 80);
  v_n     integer;
begin
  select organization_id into v_org from patients where id = p_patient_id;
  if v_org is null or not app_is_member(v_org) then
    raise exception 'المريض غير موجود';
  end if;
  insert into audit_log (organization_id, user_id, module, action_type, entity_id, entity_title, details)
  values (v_org, auth.uid(), 'patients', 'export', p_patient_id, v_title, 'تقرير المريض');
  select count(*) into v_n from audit_log
   where organization_id = v_org and entity_id = p_patient_id and entity_title = v_title;
  return v_n;
end;
$$;
revoke all on function app_log_patient_print(uuid, text) from public, anon;
grant execute on function app_log_patient_print(uuid, text) to authenticated;

commit;
