-- ============================================================================
-- 0238_voucher_number_per_org.sql — رقم السند متسلسلٌ لكلّ منشأة بلا تصادم
-- ============================================================================
-- شكوى المالك (10/10/2026): حفظ فاتورة المشتريات مع «دُفعت الآن» يفشل:
--   duplicate key value violates unique constraint
--   "financial_vouchers_organization_id_voucher_number_key" (…, 3) already exists
--
-- السبب: رقم السند فريدٌ لكلّ منشأة، ويُعطى بطريقتين متعارضتين:
--   • سند القبض والاسترداد: `max(voucher_number) + 1` للمنشأة — فبلغت 1…182.
--   • سداد المورد (وسداد الرواتب): القيمة الافتراضية للعمود، أي تسلسلٌ عامّ
--     `financial_vouchers_voucher_number_seq` لم يتقدّم مع سندات القبض (آخره 3).
--   فأعطى سدادُ المورد الرقم 3 — وهو لسند قبضٍ قائم. وكلّ محاولةٍ تالية تأخذ
--   4 ثمّ 5… وكلّها مأخوذة حتى 182.
--   (فشل الحفظ كلّه ذرّيًّا: لم تُنشأ فاتورة مشتريات ناقصة ولا سند.)
--
-- الإصلاح: طريقةٌ واحدة للرقم في القاعدة نفسها.
--   • يُزال التسلسل العامّ قيمةً افتراضية للعمود.
--   • محفّز BEFORE INSERT يعطي السند بلا رقم `max + 1` لمنشأته، ويعيد ترقيم
--     السند الذي جاء برقمٍ مأخوذ — تحت قفلٍ استشاريّ لكلّ منشأة، فلا يتصادم
--     سندان يُحفظان في اللحظة نفسها (وكان ذلك ممكنًا في القبض أيضًا).
--   • سندات القبض تبقى تحسب رقمها كما هي، فرقمها هو نفسه ما لم يتصادم.
--
-- لا يُغيَّر رقم أيّ سندٍ قائم. آمنة للتكرار.
-- ============================================================================

begin;
set local lock_timeout = '8s';

lock table public.financial_vouchers in share row exclusive mode;

create or replace function public.app_assign_voucher_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- سندٌ واحد يُرقَّم في المنشأة في كلّ لحظة؛ القفل يُحرَّر مع نهاية المعاملة
  perform pg_advisory_xact_lock(hashtextextended('financial_vouchers.voucher_number:' || new.organization_id::text, 0));

  if new.voucher_number is null
     or exists (select 1 from financial_vouchers
                 where organization_id = new.organization_id
                   and voucher_number = new.voucher_number) then
    select coalesce(max(voucher_number), 0) + 1
      into new.voucher_number
      from financial_vouchers
     where organization_id = new.organization_id;
  end if;
  return new;
end $$;

comment on function public.app_assign_voucher_number() is
  'رقم السند max+1 لكلّ منشأة تحت قفل استشاريّ — للسند بلا رقم أو برقمٍ مأخوذ. 0238.';

-- `aa` ليعمل أوّل محفّزات BEFORE INSERT (تُنفَّذ أبجديًّا)
drop trigger if exists trg_aa_assign_voucher_number on public.financial_vouchers;
create trigger trg_aa_assign_voucher_number
  before insert on public.financial_vouchers
  for each row execute function public.app_assign_voucher_number();

-- التسلسل العامّ لم يعد مصدر الرقم: بقاؤه قيمةً افتراضية هو ما أعطى «3»
alter table public.financial_vouchers alter column voucher_number drop default;

commit;

-- ── تحقّق ──────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'financial_vouchers'
                and column_name = 'voucher_number' and column_default is not null) then
    raise exception 'voucher_number ما زال بقيمةٍ افتراضية';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgname = 'trg_aa_assign_voucher_number'
                    and tgrelid = 'public.financial_vouchers'::regclass) then
    raise exception 'محفّز ترقيم السندات غير موجود';
  end if;
  raise notice '0238 ✓ رقم السند يُعطى لكلّ منشأة بلا تصادم';
end $$;
