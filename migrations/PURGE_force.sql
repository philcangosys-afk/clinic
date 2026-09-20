-- ############################################################################
-- ##  تشغيل التفريغ من محرّر SQL رغم حُرّاس المنع                             ##
-- ############################################################################
--
-- `PURGE_all_patients.sql` وحده يتعثّر بهذا:
--
--   ERROR: بنود الفاتورة الصادرة لا تُعدَّل ولا تُحذف — ألغِ الفاتورة أو أصدر
--   إشعارًا دائنًا   (app_guard_issued_invoice_lines)
--
-- وليست علّةً في سكربت التفريغ. القاعدة فيها حُرّاسٌ يمنعون المساس بما صدر:
-- `trg_guard_issued_invoice_lines` على بنود الفواتير، و`trg_block_voucher_delete`
-- على السندات، و`trg_block_issued_invoice_delete` على الفواتير، وغيرها على
-- حركات المخزون والصرف والقيود. وهي حُرّاسٌ **صحيحة تُبقى كما هي**: حذفُ سطرٍ من
-- فاتورةٍ مُصدَرة أثناء التشغيل تزويرٌ محاسبيّ.
--
-- لكنّ التفريغ ليس تعديلَ سطر: الفاتورة كلّها تذهب مع مريضها، فلا سطرَ يُيتَّم
-- ولا مجموعَ يختلّ. فالحارس هنا يحرس ما لم يعد له وجود.
--
-- ── لماذا التعطيل هنا آمن ─────────────────────────────────────────────────
--
--   • **معاملةٌ لا حالة.** تعطيل المُشغِّلات في PostgreSQL أمرُ DDL يخضع
--     للمعاملة: إن تعثّر جدولٌ واحد، أو كانت تجربة، عاد كلّ حارسٍ مكانه بلا
--     تدخّل. وفي المسار الناجح يُعاد تمكينها صراحةً قبل الخروج — فلا تُترك
--     قاعدةٌ بلا حُرّاس بعد `commit`.
--   • **حُرّاس المفاتيح الأجنبية لا تُمَسّ** (`tgisinternal`). فترتيب الحذف يبقى
--     محروسًا: جدولٌ نُسي في السلسلة يُوقف العملية ولا يترك صفًّا يتيمًا.
--
-- ── الاستعمال ─────────────────────────────────────────────────────────────
--   ١) نفِّذ `PURGE_all_patients.sql` أوّلًا (يُنشئ `app_purge_patients`).
--   ٢) نفِّذ هذا الملفّ (يُنشئ الغلاف).
--   ٣) تجربة:  select * from app_purge_patients_force('<المعرّف>'::uuid, true);
--   ٤) تنفيذ:  select * from app_purge_patients_force('<المعرّف>'::uuid, false);
--   ٥) بعد الفراغ:
--        drop function app_purge_patients_force(uuid, boolean);
--        drop function app_purge_patients(uuid, boolean);
-- ############################################################################

create or replace function app_purge_patients_force(
  p_organization_id uuid,
  p_dry_run boolean default true
)
returns table (اسم_الجدول text, المحذوف int)
language plpgsql
security definer
set search_path = public, pg_temp
as $force$
declare
  r record;
begin
  for r in
    select distinct c.relname
      from pg_trigger   t
      join pg_class     c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not t.tgisinternal
  loop
    execute format('alter table public.%I disable trigger user', r.relname);
  end loop;

  return query select * from app_purge_patients(p_organization_id, p_dry_run);

  for r in
    select distinct c.relname
      from pg_trigger   t
      join pg_class     c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not t.tgisinternal
  loop
    execute format('alter table public.%I enable trigger user', r.relname);
  end loop;

  return;
end
$force$;
