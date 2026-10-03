-- ============================================================================
-- 0214 — العيادة الرئيسية للطبيب: مصدرٌ واحد بين بطاقته وربط العيادات
-- ----------------------------------------------------------------------------
-- المشكلة (المالك، 03/10/2026):
--   «حجز جديد» على عيادة الجلدية لا يُظهر إلّا نوف، و«الأخصائية فاطمة» عيادتها
--   في بطاقة الطبيب «عيادة الجلدية». السبب مصدران للعيادة لا يتزامنان:
--     • `doctors.clinic_id` — حقل «العيادة» في نموذج الطبيب وعمود القائمة؛
--     • `doctor_clinics` (0081) — ربط العيادات الذي يقرؤه الحجز
--       (`app_doctors_for_clinic`) وحارس الموعد.
--   تعديل العيادة من نموذج الطبيب كان يغيّر الأوّل وحده، فبقيت فاطمة في
--   الحجز مربوطةً بعيادة الأسنان (ربط الاستيراد) ولا تظهر في الجلدية.
--
-- الإصلاح:
--   ١) عيادة البطاقة = العيادة الرئيسية في الربط. تغييرها من النموذج (أو
--      الإدراج) يربط الطبيب بها نشِطًا ورئيسيًّا، ويوقف ربط الرئيسية السابقة
--      (نقلٌ لا إضافة). الروابط الإضافية من «العيادات والخدمات» لا تُمسّ.
--   ٢) والعكس: تعيين «الرئيسية» من نافذة العيادات يكتب البطاقة.
--   ٣) تصحيح القائم: كلّ طبيب عيادته في البطاقة غير مربوطة رئيسيةً نشطة يُصحَّح
--      بالقاعدة نفسها، وتُعرض النتيجة قبل/بعد.
--
-- لا حذف (إيقاف الربط فقط). لا يمسّ المواعيد ولا الفواتير ولا ZATCA.
-- معاملة واحدة، آمنة للتكرار.
-- ============================================================================

begin;
set local lock_timeout = '8s';

-- ── أداة واحدة: اجعل عيادةً رئيسيةً نشطة للطبيب ─────────────────────────────
create or replace function app_doctor_set_primary_clinic(
  p_doctor_id   uuid,
  p_clinic_id   uuid,
  p_move        boolean default true   -- أوقف ربط الرئيسية السابقة
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org  uuid;
  v_old  uuid;
begin
  if p_doctor_id is null or p_clinic_id is null then
    return;
  end if;
  select organization_id into v_org from doctors where id = p_doctor_id;
  if v_org is null then
    return;
  end if;
  -- العيادة من المنشأة نفسها وحدها
  if not exists (select 1 from clinics where id = p_clinic_id and organization_id = v_org) then
    return;
  end if;

  select clinic_id into v_old
    from doctor_clinics
   where doctor_id = p_doctor_id and is_primary;

  if v_old is not distinct from p_clinic_id then
    update doctor_clinics set is_active = true, updated_at = now()
     where doctor_id = p_doctor_id and clinic_id = p_clinic_id and not is_active;
    return;
  end if;

  -- الرئيسية السابقة: تفقد صفة الرئيسية، ويُوقف ربطها إن كان نقلًا
  if v_old is not null then
    update doctor_clinics
       set is_primary = false,
           is_active  = case when p_move then false else is_active end,
           updated_at = now()
     where doctor_id = p_doctor_id and clinic_id = v_old;
  end if;

  update doctor_clinics
     set is_primary = true, is_active = true, updated_at = now()
   where doctor_id = p_doctor_id and clinic_id = p_clinic_id;
  if not found then
    insert into doctor_clinics (organization_id, doctor_id, clinic_id, branch_id, is_primary, is_active)
    select v_org, p_doctor_id, c.id, c.branch_id, true, true
      from clinics c where c.id = p_clinic_id;
  end if;
end $$;

revoke all on function app_doctor_set_primary_clinic(uuid, uuid, boolean) from public, anon, authenticated;

-- ── ١) البطاقة ← الربط ──────────────────────────────────────────────────────
create or replace function app_doctor_clinic_from_card()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if pg_trigger_depth() > 1 then
    return null;   -- أتى من مزامنة الاتّجاه الآخر
  end if;
  if new.clinic_id is not null
     and (tg_op = 'INSERT' or new.clinic_id is distinct from old.clinic_id) then
    perform app_doctor_set_primary_clinic(new.id, new.clinic_id, true);
  end if;
  return null;
end $$;

revoke all on function app_doctor_clinic_from_card() from public, anon, authenticated;

drop trigger if exists trg_doctor_clinic_from_card on doctors;
create trigger trg_doctor_clinic_from_card
  after insert or update of clinic_id on doctors
  for each row execute function app_doctor_clinic_from_card();

-- ── ٢) الربط ← البطاقة ──────────────────────────────────────────────────────
create or replace function app_doctor_card_from_primary()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  if new.is_primary and new.is_active then
    update doctors set clinic_id = new.clinic_id
     where id = new.doctor_id and clinic_id is distinct from new.clinic_id;
  end if;
  return null;
end $$;

revoke all on function app_doctor_card_from_primary() from public, anon, authenticated;

drop trigger if exists trg_doctor_card_from_primary on doctor_clinics;
create trigger trg_doctor_card_from_primary
  after insert or update of is_primary, is_active on doctor_clinics
  for each row execute function app_doctor_card_from_primary();

-- ── ٣) تصحيح القائم ─────────────────────────────────────────────────────────
drop table if exists _dc_before;
drop table if exists _dc_result;
create temp table _dc_before as
select d.id,
       d.name_ar,
       c.name as card_clinic,
       (select string_agg(c2.name || case when dc.is_primary then ' ★' else '' end
                                  || case when dc.is_active then '' else ' (موقوف)' end, '، ' order by c2.name)
          from doctor_clinics dc join clinics c2 on c2.id = dc.clinic_id
         where dc.doctor_id = d.id) as links_before
  from doctors d
  left join clinics c on c.id = d.clinic_id
 where d.clinic_id is not null
   and not exists (select 1 from doctor_clinics dc
                    where dc.doctor_id = d.id and dc.clinic_id = d.clinic_id
                      and dc.is_primary and dc.is_active);

do $$
declare r record;
begin
  for r in select d.id, d.clinic_id from doctors d join _dc_before b on b.id = d.id loop
    perform app_doctor_set_primary_clinic(r.id, r.clinic_id, true);
  end loop;
end $$;

create temp table _dc_result as
select b.name_ar  as "الطبيب",
       b.card_clinic as "عيادة البطاقة",
       coalesce(b.links_before, '— لا ربط') as "الربط قبل",
       (select string_agg(c2.name || case when dc.is_primary then ' ★' else '' end
                                  || case when dc.is_active then '' else ' (موقوف)' end, '، ' order by c2.name)
          from doctor_clinics dc join clinics c2 on c2.id = dc.clinic_id
         where dc.doctor_id = b.id) as "الربط بعد"
  from _dc_before b;

insert into audit_log (organization_id, user_id, module, action_type, entity_title, details)
select d.organization_id, auth.uid(), 'settings', 'update', 'مزامنة عيادة الطبيب الرئيسية (0214)',
       count(*) || ' طبيبًا صُحِّح ربطه بعيادة بطاقته'
  from doctors d join _dc_before b on b.id = d.id
 group by d.organization_id;

commit;

-- ── النتيجة: من صُحِّح ربطه (فارغة = لا شيء يحتاج تصحيحًا) ─────────────────
select * from _dc_result order by 1;
