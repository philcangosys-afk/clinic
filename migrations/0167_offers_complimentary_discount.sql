-- ---------------------------------------------------------------------------
-- 0167_offers_complimentary_discount.sql — عرض الخدمة، والمجانيّ، وخصم الطبيب
-- ---------------------------------------------------------------------------
-- ثلاثة أبوابٍ يُخرَج منها المال من سعر الخدمة، ولا يُمثَّل منها في القاعدة
-- إلّا الثالث ناقصًا:
--
--   • **العرض على الخدمة.** `offers` القائم (0004) عرضٌ على المنشأة بنسبةٍ
--     مئوية ونطاق تاريخ (`applies_to_all_items`)، لا عرضٌ على خدمةٍ بعينها
--     بسعرٍ بعديّ. ومن أراد «اليوم الوطني: تنظيف الأسنان بـ١٤٩ بدل ٢٠٠»
--     كان يُعدِّل سعر الخدمة نفسه — فيضيع السعر الأصلي، ولا يُعرف بعد
--     انتهاء العرض بكم كانت، ولا يُقاس ما كلّفه العرض.
--
--   • **الخدمة المجانية.** «الجلسة الخامسة مجانًا» تُكتب اليوم سطرًا بسعر
--     صفر بلا سبب ولا مانح ولا صلاحية. سطرٌ بصفرٍ يمرّ بلا أثر هو أسهل
--     طريقة لإخراج خدمةٍ من الصندوق، **ولا يُكتشَف في أيّ تقرير** لأنّه لا
--     يُميَّز عن خصمٍ كامل ولا عن خطأ إدخال.
--
--   • **خصم الطبيب.** `discount_percent` و`discount_amount` على سطر الفاتورة
--     موجودان، **ولا يُعرف مَن منح الخصم ولا لماذا**. وحدّ السعر الأدنى الذي
--     بنته 0159 يفحص `price` وحده — فخصمٌ بمئة في المئة يهبط بالسطر إلى صفر
--     ويمرّ من فوق الحدّ. الحدّ الذي يُتجاوَز بطريقٍ آخر ليس حدًّا.
--
-- **ولا تُعاد كتابة `app_create_sales_invoice`.** الدالّة ٥٣٢ سطرًا أُعيدت
-- كتابتها مرّتين في 0152 و0160، وكل إعادةٍ خطرٌ على منطق الضريبة المحمول على
-- المريض. فالعرض يُسأل عنه **قبل** الحفظ (كما تُسأل نسبة الضريبة في 0156)،
-- والحدود تُفرَض بمُحفِّزٍ على السطر — فتُفرَض على كل كاتبٍ لا على شاشةٍ
-- واحدة.
--
-- **والضريبة تتبع الوعاء بلا سطرٍ إضافيّ:** العرض يُنقص السعر، والضريبة
-- تُحسب على ما بقي بقواعد الجنسية القائمة (0147 و0152 و0156). فـ«ضريبته أو
-- لا حسب الجنسية» يعمل بحكم البناء لا بحكم شرطٍ جديد.
-- ---------------------------------------------------------------------------

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) عرض على خدمةٍ بعينها
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists item_offers (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  item_id           uuid not null references items(id) on delete cascade,
  title             text not null,
  -- **السعر بعد العرض لا نسبة الخصم:** المنشأة تُعلن «بـ١٤٩» لا «بخصم
  -- ٢٥٫٥٪»، وحسابُ النسبة من رقمٍ مُعلَن يُنتج كسورًا تُقرَّب فتخرج ١٤٩٫٠١.
  offer_price       numeric(12,2) not null check (offer_price >= 0),
  -- السعر الأصلي وقت إنشاء العرض — يُطبع «قبل/بعد» ويبقى حقيقةً تاريخية
  -- ولو عُدِّل سعر الخدمة بعد ذلك.
  list_price_at_creation numeric(12,2),
  show_before_after boolean not null default true,
  start_date        date,
  end_date          date,
  is_disabled       boolean not null default false,
  note              text,
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users(id),
  constraint item_offers_dates_check
    check (start_date is null or end_date is null or end_date >= start_date)
);

create index if not exists idx_item_offers_item
  on item_offers (organization_id, item_id)
  where is_disabled = false;

alter table item_offers enable row level security;
drop policy if exists item_offers_read on item_offers;
create policy item_offers_read on item_offers
  for select using (app_is_member(organization_id));
drop policy if exists item_offers_write on item_offers;
-- **المفتاح `catalog.manage` لا `services.manage`:** الثاني غير موجود في
-- `permission_catalog` أصلًا، و`app_has_permission` تُرجع false لمفتاحٍ لا
-- وجود له — فسياسةٌ تسأل عنه تمنع الجميع، وتبدو الميزة «لا تعمل» بلا خطأ.
create policy item_offers_write on item_offers
  for all
  using (app_is_member(organization_id)
         and app_has_permission(organization_id, 'catalog.manage'))
  with check (app_is_member(organization_id)
         and app_has_permission(organization_id, 'catalog.manage'));
revoke all on item_offers from anon;
grant select, insert, update on item_offers to authenticated;

comment on table item_offers is
  'عرضٌ على خدمةٍ بعينها بسعرٍ بعديّ معلَن ونطاق تاريخ. لا يمسّ سعر الخدمة الأصلي، فينتهي العرض فيعود السعر وحده.';

-- ── حارسان على العرض ──────────────────────────────────────────────────────
--
-- (أ) **عرضٌ نشط واحد لكل خدمة في أيّ يوم.** عرضان متداخلان يجعلان السعر
--     المعروض للمريض يتبع أيّهما وُجد أوّلًا في الاستعلام — أي يتغيّر بلا
--     سبب. ويُفحَص بالتداخل لا بالمساواة: عرضٌ ينتهي غدًا وآخر يبدأ اليوم
--     متداخلان وإن اختلف تاريخاهما.
--
-- (ب) **العرض يحترم الحدّ الأدنى للخدمة (0159).** عرضٌ تحت الحدّ يُقبل هنا
--     ثم يرفضه مُحفِّز سطر الفاتورة وقت الفوترة — فيبدو العرض معمولًا ثم
--     تفشل كل فاتورة تستعمله. الرفض موضعه هنا.
create or replace function app_guard_item_offer()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_min numeric;
  v_name text;
begin
  -- **ترتيب التاريخين يُفحَص أوّلًا.**
  --
  -- القيد `item_offers_dates_check` يمنع نهايةً قبل بداية، لكنّ المُحفِّز
  -- `before` يسبق القيود — فبناءُ `daterange` من تاريخين مقلوبين يُفجِّر
  -- الدالّة برسالةٍ إنجليزية داخلية («range lower bound must be less than…»)
  -- قبل أن ينطق القيد بعربيّته. والمستخدم يرى عطلًا حيث كان يجب أن يرى سببًا.
  if new.start_date is not null and new.end_date is not null
     and new.end_date < new.start_date then
    raise exception 'تاريخ نهاية العرض (%) قبل بدايته (%) — صحّح التاريخين',
      new.end_date, new.start_date;
  end if;

  if new.is_disabled then
    return new;
  end if;

  if exists (
    select 1 from item_offers o
     where o.item_id = new.item_id
       and o.id <> new.id
       and o.is_disabled = false
       and daterange(coalesce(o.start_date, '-infinity'::date),
                     coalesce(o.end_date,   'infinity'::date), '[]')
           && daterange(coalesce(new.start_date, '-infinity'::date),
                        coalesce(new.end_date,   'infinity'::date), '[]')
  ) then
    raise exception 'على هذه الخدمة عرضٌ نشطٌ يتقاطع مع هذه الفترة — عطِّله أو غيِّر التواريخ';
  end if;

  select min_price, name_ar into v_min, v_name from items where id = new.item_id;
  if v_min is not null and new.offer_price > 0 and new.offer_price < v_min then
    raise exception 'سعر العرض (%) أقلّ من الحدّ الأدنى لـ«%» (%). ارفع سعر العرض أو عدِّل الحدّ من بطاقة الصنف.',
      new.offer_price, coalesce(v_name, 'الصنف'), v_min;
  end if;

  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_guard_item_offer on item_offers;
create trigger trg_guard_item_offer
  before insert or update on item_offers
  for each row execute function app_guard_item_offer();

-- ── السعر الساري ──────────────────────────────────────────────────────────
--
-- تُسأل عنه الشاشة **قبل** إضافة السطر، كما تُسأل نسبة الضريبة في 0156.
-- والبديل — أن يحسب المتصفّح العرض — يعني تعريفًا ثانيًا للسعر يفترق عن
-- الأوّل عند أوّل تعديل.
create or replace function app_item_effective_price(
  p_organization_id uuid,
  p_item_id         uuid,
  p_on_date         date default current_date
)
returns table (
  list_price        numeric,
  effective_price   numeric,
  offer_id          uuid,
  offer_title       text,
  show_before_after boolean,
  min_price         numeric,
  max_price         numeric
)
language sql
stable
security invoker
as $$
  select
    i.price                                   as list_price,
    coalesce(o.offer_price, i.price)           as effective_price,
    o.id                                      as offer_id,
    o.title                                   as offer_title,
    coalesce(o.show_before_after, false)      as show_before_after,
    i.min_price,
    i.max_price
  from items i
  left join item_offers o
    on o.item_id = i.id
   and o.organization_id = i.organization_id
   and o.is_disabled = false
   and (o.start_date is null or o.start_date <= p_on_date)
   and (o.end_date   is null or o.end_date   >= p_on_date)
  where i.id = p_item_id
    and i.organization_id = p_organization_id
    and coalesce(i.is_disabled, false) = false
    and coalesce(i.is_archived, false) = false;
$$;

comment on function app_item_effective_price(uuid, uuid, date) is
  'السعر الساري للخدمة في تاريخٍ معيّن: سعر العرض النشط إن وُجد وإلّا سعر القائمة، مع عنوان العرض وعلم «إظهار قبل/بعد» وحدَّي السعر.';

revoke all on function app_item_effective_price(uuid, uuid, date) from public, anon;
grant execute on function app_item_effective_price(uuid, uuid, date) to authenticated;

-- منظور لشاشة الخدمات: العرض النشط بجانب كل خدمة
create or replace view v_item_offers as
select
  o.id,
  o.organization_id,
  o.item_id,
  i.name_ar          as item_name,
  i.price            as current_list_price,
  o.title,
  o.offer_price,
  o.list_price_at_creation,
  o.show_before_after,
  o.start_date,
  o.end_date,
  o.is_disabled,
  o.note,
  -- نشطٌ **اليوم**: الحقل `is_disabled` يقول «مسموح»، والتاريخ يقول «الآن»
  (o.is_disabled = false
     and (o.start_date is null or o.start_date <= current_date)
     and (o.end_date   is null or o.end_date   >= current_date))      as is_active_now,
  case when coalesce(i.price, 0) = 0 then 0
       else round((i.price - o.offer_price) * 100.0 / i.price, 1) end as discount_percent_equivalent,
  o.created_at
from item_offers o
join items i on i.id = o.item_id;

alter view v_item_offers set (security_invoker = on);
revoke all on v_item_offers from anon;
grant select on v_item_offers to authenticated;

comment on view v_item_offers is
  'عروض الخدمات: السعر قبل وبعد، وما يعادله بالنسبة المئوية، وهل العرض نشطٌ اليوم.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) الخدمة المجانية
--
-- **علمٌ على الخدمة يبيح منحها، وعلمٌ على السطر يقول إنّها مُنحت.** الأوّل
-- يمنع أن تُمنح استشارةٌ جراحية مجانًا بضغطة، والثاني يجعل المنح واقعةً
-- تُعَدّ في تقرير لا سطرَ صفرٍ بلا هويّة.
-- ═══════════════════════════════════════════════════════════════════════════
alter table items
  add column if not exists allow_complimentary boolean not null default false,
  add column if not exists complimentary_note  text;

comment on column items.allow_complimentary is
  'يجوز منح هذه الخدمة مجانًا (جلسة مكافأة مثلًا). الخدمة غير المؤشَّرة لا تُمنَح مجانًا ولو ملك المستخدم الصلاحية.';

alter table sales_invoice_items
  add column if not exists is_complimentary      boolean not null default false,
  add column if not exists complimentary_reason  text,
  add column if not exists granted_by            uuid references auth.users(id),
  add column if not exists discount_reason       text,
  add column if not exists discount_granted_by   uuid references auth.users(id);

do $$ begin
  -- سطرٌ مجانيّ بلا سببٍ لا يُعَدّ ولا يُراجَع — ولا يُفرَّق عن خطأ إدخال
  if not exists (select 1 from pg_constraint where conname = 'sales_invoice_items_complimentary_check') then
    alter table sales_invoice_items
      add constraint sales_invoice_items_complimentary_check
      check (
        is_complimentary = false
        or (coalesce(btrim(complimentary_reason), '') <> ''
            and coalesce(price, 0) = 0
            and coalesce(net_amount, 0) = 0
            and coalesce(vat_amount, 0) = 0)
      );
  end if;
end $$;

create index if not exists idx_invoice_items_complimentary
  on sales_invoice_items (organization_id, created_at)
  where is_complimentary = true;

create index if not exists idx_items_allow_complimentary
  on items (organization_id)
  where allow_complimentary = true;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) صلاحيتان جديدتان
--
-- المنح والخصم قرارٌ ماليّ لا إدخال بيانات: من يكتب الفاتورة ليس بالضرورة
-- من يتنازل عن قيمتها.
-- ═══════════════════════════════════════════════════════════════════════════
insert into permission_catalog (permission_key, name_ar, module_key, description_ar, display_order)
select v.k, v.n, 'billing', v.d, v.o
from (values
  ('billing.complimentary', 'منح خدمة مجانية', 'إضافة خدمة مجانية إلى الفاتورة بسبب مسجَّل', 1810),
  ('billing.line_discount', 'خصم على سطر الفاتورة', 'منح خصم على خدمة بعينها داخل الفاتورة بسبب مسجَّل', 1811)
) as v(k, n, d, o)
where not exists (select 1 from permission_catalog c where c.permission_key = v.k);

insert into role_default_permissions (role_key, permission_key)
select r, p from (values
  -- الطبيب يمنح الخصم والمجانيّ: هو من يقدّر الحالة أمامه
  ('doctor',           'billing.complimentary'), ('doctor', 'billing.line_discount'),
  ('branch_manager',   'billing.complimentary'), ('branch_manager', 'billing.line_discount'),
  -- الاستقبال يخصم ولا يمنح مجانًا: المجانيّ قرار الطبيب أو المدير
  ('receptionist',     'billing.line_discount'),
  ('accountant',       'billing.line_discount')
) as v(r, p)
where not exists (
  select 1 from role_default_permissions d
   where d.role_key = v.r and d.permission_key = v.p
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) حارس سطر الفاتورة — موسَّعٌ لا مُستبدَل
--
-- نصّ 0159 محفوظٌ كما هو (الحدّ الأدنى والأقصى على `price`)، ويُضاف إليه:
--
--   (أ) **المجانيّ يحتاج إباحةً وصلاحية.** خدمةٌ غير مؤشَّرة `allow_complimentary`
--       لا تُمنَح، ومن لا يملك `billing.complimentary` لا يمنح. والقيد على
--       الجدول يفرض السبب والأصفار سلفًا.
--
--   (ب) **الخصم يحتاج سببًا ومانحًا وصلاحية**، ويُسجَّل مَن منحه — وهو ما
--       يجعل السؤال «من خصم؟» قابلًا للجواب بعد شهر.
--
--   (ج) **الحدّ الأدنى يُفحَص على صافي الوحدة لا على السعر وحده.** كان
--       الخصم يهبط بالسطر إلى ما تحت الحدّ ويمرّ، فالحدّ الذي يُتجاوَز
--       بطريقٍ آخر ليس حدًّا. والمجانيّ مستثنى صراحةً: صفرُه مقصودٌ مأذونٌ
--       فيه بسببٍ مكتوب.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app_guard_invoice_item_price()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_item   items%rowtype;
  v_type   text;
  v_org    uuid;
  v_unit   numeric;
begin
  if new.item_id is null then
    return new;
  end if;

  select invoice_type, organization_id into v_type, v_org
    from sales_invoices where id = new.invoice_id;
  if coalesce(v_type, 'sale') <> 'sale' then
    return new;
  end if;

  select * into v_item from items where id = new.item_id;
  if not found then
    return new;
  end if;

  -- ── (أ) المجانيّ ────────────────────────────────────────────────────────
  if new.is_complimentary then
    if not coalesce(v_item.allow_complimentary, false) then
      raise exception '«%» غير مسموح منحها مجانًا — أشِّر «تُمنَح مجانًا» في بطاقة الصنف أوّلًا.',
        coalesce(v_item.name_ar, 'هذه الخدمة');
    end if;
    if v_org is not null and not app_has_permission(v_org, 'billing.complimentary') then
      raise exception 'لا تملك صلاحية منح خدمة مجانية';
    end if;
    if new.granted_by is null then
      new.granted_by := auth.uid();
    end if;
    -- الأصفار والسبب يفرضهما القيد على الجدول؛ ولا فحص حدودٍ على صفرٍ مقصود.
    return new;
  end if;

  -- ── (ب) الخصم ───────────────────────────────────────────────────────────
  if coalesce(new.discount_amount, 0) > 0 or coalesce(new.discount_percent, 0) > 0 then
    if v_org is not null and not app_has_permission(v_org, 'billing.line_discount') then
      raise exception 'لا تملك صلاحية الخصم على سطر الفاتورة';
    end if;
    if coalesce(btrim(new.discount_reason), '') = '' then
      raise exception 'سبب الخصم مطلوب على «%»', coalesce(v_item.name_ar, 'هذا السطر');
    end if;
    if new.discount_granted_by is null then
      new.discount_granted_by := auth.uid();
    end if;
  end if;

  -- ── حدود 0159 على السعر — نصًّا كما كانت ────────────────────────────────
  if v_item.min_price is not null
     and coalesce(new.price, 0) > 0
     and new.price < v_item.min_price then
    raise exception 'سعر «%» أقلّ من حدّه الأدنى (%). عدِّل الحدّ من بطاقة الصنف أو ارفع السعر.',
      coalesce(v_item.name_ar, 'الصنف'), v_item.min_price;
  end if;

  if v_item.max_price is not null and coalesce(new.price, 0) > v_item.max_price then
    raise exception 'سعر «%» أعلى من حدّه الأقصى (%). عدِّل الحدّ من بطاقة الصنف أو اخفض السعر.',
      coalesce(v_item.name_ar, 'الصنف'), v_item.max_price;
  end if;

  -- ── (ج) الحدّ الأدنى على صافي الوحدة بعد الخصم ──────────────────────────
  if v_item.min_price is not null
     and coalesce(new.qty, 0) > 0
     and (coalesce(new.discount_amount, 0) > 0 or coalesce(new.discount_percent, 0) > 0) then
    -- **الخصم بالريال هو `discount_amount` إن وُجد، وإلّا يُشتقّ من النسبة.**
    --
    -- الجمع بينهما يُحاسِب الخصم مرّتين: `app_create_sales_invoice` (0160)
    -- تكتب النسبة في `discount_percent` **وقيمتها بالريال** في
    -- `discount_amount` معًا، فطرحُ الاثنين يُنقص ضعف الخصم فيُرفض سطرٌ
    -- مشروع. والعمود المحسوب في القاعدة هو المرجع، والنسبة بيانُ كيف حُسب.
    v_unit := (coalesce(new.price, 0) * new.qty
               - case when coalesce(new.discount_amount, 0) > 0
                      then new.discount_amount
                      else coalesce(new.price, 0) * new.qty
                           * coalesce(new.discount_percent, 0) / 100.0 end)
              / new.qty;
    if v_unit < v_item.min_price then
      raise exception 'الخصم يُنزل «%» إلى % للوحدة، وحدّها الأدنى %. اخفض الخصم أو عدِّل الحدّ.',
        coalesce(v_item.name_ar, 'الصنف'), round(v_unit, 2), v_item.min_price;
    end if;
  end if;

  return new;
end;
$$;

-- المُحفِّز نفسه يُعاد ربطه بأعمدةٍ أوسع: كان مقصورًا على `price` و`item_id`،
-- فتغييرُ الخصم أو علم المجانيّ وحده كان يمرّ بلا فحص.
drop trigger if exists trg_guard_invoice_item_price on sales_invoice_items;
create trigger trg_guard_invoice_item_price
  before insert or update of
    price, item_id, qty, discount_amount, discount_percent,
    is_complimentary, complimentary_reason
  on sales_invoice_items
  for each row execute function app_guard_invoice_item_price();

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) منظور المجانيّات — ما مُنح ولمن ومن منحه
--
-- الميزة التي لا تُقاس تُستنزف. وهذا هو التقرير الذي يجعل «أربع جلسات
-- والخامسة مجانًا» سياسةً تُراجَع لا بابًا مفتوحًا.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace view v_complimentary_lines as
select
  li.id,
  li.organization_id,
  li.invoice_id,
  s.invoice_number,
  s.created_at              as invoice_created_at,
  s.status                  as invoice_status,
  li.patient_id,
  p.name_ar                 as patient_name,
  p.file_number,
  li.item_id,
  coalesce(li.item_name_snapshot, i.name_ar, li.description) as item_name,
  -- قيمة ما تُنازِل عنه: سعر القائمة لا الصفر المكتوب في السطر
  coalesce(i.price, 0) * coalesce(li.qty, 1)                 as forgone_value,
  li.qty,
  li.complimentary_reason,
  li.granted_by,
  dir.display_name          as granted_by_name,
  d.name_ar                 as doctor_name,
  li.created_at
from sales_invoice_items li
join sales_invoices s on s.id = li.invoice_id
left join patients p  on p.id = li.patient_id
left join items i     on i.id = li.item_id
left join doctors d   on d.id = li.doctor_id
left join v_organization_members_directory dir
       on dir.user_id = li.granted_by
      and dir.organization_id = li.organization_id
where li.is_complimentary = true;

alter view v_complimentary_lines set (security_invoker = on);
revoke all on v_complimentary_lines from anon;
grant select on v_complimentary_lines to authenticated;

comment on view v_complimentary_lines is
  'الخدمات المجانية الممنوحة: لمن، وأيّ خدمة، وبأيّ سبب، ومن منحها، وقيمة ما تُنازِل عنه بسعر القائمة.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) منظور خصومات السطور — «من خصم ولماذا»
-- ═══════════════════════════════════════════════════════════════════════════
create or replace view v_line_discounts as
select
  li.id,
  li.organization_id,
  li.invoice_id,
  s.invoice_number,
  s.created_at              as invoice_created_at,
  li.patient_id,
  p.name_ar                 as patient_name,
  coalesce(li.item_name_snapshot, i.name_ar, li.description) as item_name,
  li.price,
  li.qty,
  li.discount_percent,
  li.discount_amount,
  -- الخصم بالريال: العمود المحسوب في القاعدة هو المرجع، والنسبة تفسيرٌ له.
  -- جمعُهما كان يُظهر ضعف الخصم لأنّ 0160 تكتبهما معًا للسطر الواحد.
  round(case when coalesce(li.discount_amount, 0) > 0
             then li.discount_amount
             else coalesce(li.price, 0) * coalesce(li.qty, 1)
                  * coalesce(li.discount_percent, 0) / 100.0 end, 2) as discount_value,
  li.net_amount,
  li.discount_reason,
  li.discount_granted_by,
  dir.display_name          as discount_granted_by_name,
  d.name_ar                 as doctor_name,
  li.created_at
from sales_invoice_items li
join sales_invoices s on s.id = li.invoice_id
left join patients p  on p.id = li.patient_id
left join items i     on i.id = li.item_id
left join doctors d   on d.id = li.doctor_id
left join v_organization_members_directory dir
       on dir.user_id = li.discount_granted_by
      and dir.organization_id = li.organization_id
where coalesce(li.discount_amount, 0) > 0 or coalesce(li.discount_percent, 0) > 0;

alter view v_line_discounts set (security_invoker = on);
revoke all on v_line_discounts from anon;
grant select on v_line_discounts to authenticated;

comment on view v_line_discounts is
  'خصومات سطور الفواتير: الخصم بالريال، وسببه، ومن منحه، وأيّ طبيب على السطر.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 7) `app_save_service` تُسلّم الحدّين والإذن بالمجانيّ
--
-- 0159 أضافت `items.min_price` و`items.max_price` ومُحفِّزًا يفرضهما، وأضافت
-- الحقلين إلى شاشة تعديل الخدمة، والعميل يرسلهما في `p_payload` منذ ذلك
-- الحين. لكنّ الحفظ يمرّ عبر `app_save_service` (0077) — وهي **تُسمّي أعمدتها
-- صراحةً ولا يوجد العمودان فيها**. فالقيمة تُرسَل وتُهمَل بصمت.
--
-- وأثرُ ذلك أنّ `min_price` تبقى NULL أبدًا، فمُحفِّز 0159 لا يُفعَّل قطّ،
-- وفحصُ «سعر العرض تحت الحدّ الأدنى» في هذه الترقية عاطلٌ مثله. حقلان
-- يُدخلهما المستخدم فلا يُحفظان أسوأ من حقلين غير موجودين: الأوّل يكذب.
--
-- والتصحيح ترقيعُ نصّ الدالّة عند ثلاثة مرابط لا إعادة كتابتها: هي 120 سطرًا
-- تحمل توليد الكود والتحقّق من الأعمار والفئة، وإعادة كتابتها هنا تُخفي
-- التغيير الحقيقيّ في ضجيج النقل. وإن تغيّر مربطٌ في المستقبل تتعطّل الترقية
-- بخطأٍ صريح بدل أن تنجح ناقصةً.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_src text;
  v_new text;
  v_before text;
  -- **المرابط والبدائل متغيّراتٌ تُجرَّد من \r لا نصوصٌ حرفية.**
  --
  -- هنا كان العطل: المربط نصٌّ متعدّد الأسطر مكتوبٌ في هذا الملفّ. والملفّ
  -- يُنسَخ ويُلصَق في محرّر SQL، وطريقُ اللصق (PowerShell ثم المتصفّح) قد
  -- يُحوّل نهاياته إلى CRLF — فيصير في داخل النصّ المطلوب البحث عنه `\r\n`
  -- بينما نصُّ الدالّة المخزَّن جُرِّد من `\r` سطرًا أعلاه. فلا يتطابقان،
  -- وتتعطّل الترقية عند مربطٍ موجودٍ فعلًا.
  --
  -- والجانبان يُجرَّدان الآن: المخزَّن والمكتوب. فالترقية تعمل من ملفٍّ
  -- بنهايات لينكس أو ويندوز سواءً بسواء.
  v_a1 text := 'requires_preauthorization, requires_referral, preauthorization_note
    )';
  v_r1 text := 'requires_preauthorization, requires_referral, preauthorization_note,
      min_price, max_price, allow_complimentary, complimentary_note
    )';
  v_a2 text := 'nullif(btrim(coalesce(p_payload ->> ''preauthorization_note'', '''')), '''')
    )
    returning id into v_id;';
  v_r2 text := 'nullif(btrim(coalesce(p_payload ->> ''preauthorization_note'', '''')), ''''),
      nullif(p_payload ->> ''min_price'', '''')::numeric,
      nullif(p_payload ->> ''max_price'', '''')::numeric,
      coalesce((p_payload ->> ''allow_complimentary'')::boolean, false),
      nullif(btrim(coalesce(p_payload ->> ''complimentary_note'', '''')), '''')
    )
    returning id into v_id;';
  v_a3 text := 'preauthorization_note = nullif(btrim(coalesce(p_payload ->> ''preauthorization_note'', '''')), ''''),
      updated_at = now()';
  v_r3 text := 'preauthorization_note = nullif(btrim(coalesce(p_payload ->> ''preauthorization_note'', '''')), ''''),
      min_price = nullif(p_payload ->> ''min_price'', '''')::numeric,
      max_price = nullif(p_payload ->> ''max_price'', '''')::numeric,
      allow_complimentary = coalesce((p_payload ->> ''allow_complimentary'')::boolean, false),
      complimentary_note = nullif(btrim(coalesce(p_payload ->> ''complimentary_note'', '''')), ''''),
      updated_at = now()';
begin
  -- **`limit 1` مع ترتيبٍ صريح:** `select into` بلا حدٍّ يأخذ صفًّا عشوائيًّا
  -- لو وُجد أكثر من توقيعٍ للدالّة، فيُرقَّع غيرُ المقصود أو يتعطّل البحث.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_save_service'
   order by p.oid desc
   limit 1;
  if v_src is null then
    raise exception 'app_save_service غير موجودة — نفِّذ 0077 أوّلًا';
  end if;

  -- تجريد الجانبين من \r
  v_src := replace(v_src, chr(13), '');
  v_a1  := replace(v_a1,  chr(13), '');
  v_r1  := replace(v_r1,  chr(13), '');
  v_a2  := replace(v_a2,  chr(13), '');
  v_r2  := replace(v_r2,  chr(13), '');
  v_a3  := replace(v_a3,  chr(13), '');
  v_r3  := replace(v_r3,  chr(13), '');

  if position('allow_complimentary' in v_src) > 0 then
    return; -- مُرقَّعة سلفًا
  end if;

  v_new := v_src;

  -- المربط ١: قائمة أعمدة الإدراج
  v_before := v_new;
  v_new := replace(v_new, v_a1, v_r1);
  if v_new = v_before then
    raise exception 'app_save_service: تعذّر العثور على قائمة أعمدة الإدراج';
  end if;

  -- المربط ٢: قائمة قيم الإدراج
  v_before := v_new;
  v_new := replace(v_new, v_a2, v_r2);
  if v_new = v_before then
    raise exception 'app_save_service: تعذّر العثور على قائمة قيم الإدراج';
  end if;

  -- المربط ٣: قائمة التحديث
  v_before := v_new;
  v_new := replace(v_new, v_a3, v_r3);
  if v_new = v_before then
    raise exception 'app_save_service: تعذّر العثور على قائمة التحديث';
  end if;

  execute v_new;
end $$;

-- حرسٌ ختاميّ: الدالّة المخزَّنة تحمل الأعمدة الأربعة فعلًا
do $$
declare
  v_src text;
begin
  select replace(pg_get_functiondef(p.oid), chr(13), '') into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_save_service';
  if position('min_price' in v_src) = 0
     or position('max_price' in v_src) = 0
     or position('allow_complimentary' in v_src) = 0
     or position('complimentary_note' in v_src) = 0 then
    raise exception 'app_save_service ما زالت لا تكتب الحدّين أو الإذن بالمجانيّ';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- نهاية 0167_offers_complimentary_discount.sql
-- ---------------------------------------------------------------------------
