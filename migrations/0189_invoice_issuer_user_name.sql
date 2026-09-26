-- ============================================================================
-- 0189 — الفاتورة تحمل اسم من أصدرها، والمالك اسمه admin
-- ============================================================================
--
-- ── ما كان ────────────────────────────────────────────────────────────────
--
-- تذييل الإيصال «User: …» كان يُملأ في المتصفّح، وفي أربعة مواضع بأربع طرق:
--
--   * شاشة الفواتير: اسم **من يضغط** من خطّاف أسماء الأعضاء.
--   * ملفّ المريض: نفس الفكرة بخطّافٍ آخر يُرجع شكلًا مختلفًا، فيخرج فارغًا.
--   * نافذة تفاصيل الفاتورة: `null` صراحةً ← «User:» فارغ (هذه فاتورة ASN-2).
--   * زرّ الطباعة الموحَّد: اسم **من يطبع** من 0186.
--
-- فالورقة الواحدة تحمل اسمًا مختلفًا بحسب الشاشة التي طُبعت منها، وإعادة
-- طباعتها من زميلٍ آخر **تُغيّر مُصدِرها**. والإيصال المرجعيّ يقول «User»
-- بمعنى من أصدر الفاتورة، لا من ضغط زرّ الطباعة بعد ساعة.
--
-- ── ما صار ────────────────────────────────────────────────────────────────
--
-- **المُصدِر يُقرأ من القاعدة مع الفاتورة:** `sales_invoices.created_by`
-- يكتبه `app_create_sales_invoice` بـ`auth.uid()` منذ 0160. فاسمه ورقمه
-- الوظيفي يُحسبان هنا مرّةً، وتقرؤهما كلّ مسارات الإيصال (تحميل، طباعة،
-- إرسال) من مكانٍ واحد. وإعادة الطباعة تزيد العدّاد ولا تُغيّر المُصدِر.
--
-- **اسم المستخدم** — بهذا الترتيب، أوّل ما يوجد:
--
--   ١. `organization_memberships.display_name` — ما كتبه المسؤول في
--      «المستخدمون والصلاحيات» ← «بيانات العضو» ← «اسم المستخدم»
--   ٢. اسم ملفّ الموظّف المربوط بالحساب
--   ٣. اسم بطاقة الطبيب المربوطة بالحساب
--   ٤. `admin` — لمالك المنشأة وحده
--   ٥. ما قبل @ في بريد الحساب
--
-- والرقم الوظيفي من ملفّ الموظّف المربوط، إن وُجد.
--
-- **المالك بلا اسم يُسمّى admin الآن** — لا «مستخدم 74815318» المشتقّ من
-- أوّل ثمانية محارف من معرّفه، الذي كان يظهر في جدول الأعضاء.
--
-- آمنة للتكرار، ولا تفترض تنفيذ 0186: أعمدة العدّاد تُضاف إن غابت.
-- ============================================================================

begin;

-- ── 0) أعمدة 0186 إن لم تُنفَّذ ───────────────────────────────────────────
alter table sales_invoices
  add column if not exists print_count     integer not null default 0,
  add column if not exists last_printed_at timestamptz,
  add column if not exists last_printed_by uuid references auth.users(id);

-- ── 1) المالك بلا اسم ⇒ admin ─────────────────────────────────────────────
--
-- يُكتب في العضوية نفسها لا في منظورٍ فوقها: فيظهر «admin» في جدول الأعضاء
-- وفي شريط النظام وعلى الفاتورة وفي سجلّ التدقيق — شيءٌ واحد لا أربعة.
-- ولا يمسّ مالكًا سمّاه صاحبه.
update organization_memberships
   set display_name = 'admin'
 where role_key = 'owner'
   and nullif(btrim(coalesce(display_name, '')), '') is null;

-- ── 2) اسم المستخدم لحسابٍ في منشأة ──────────────────────────────────────
create or replace function app_member_user_name(p_org uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select nullif(btrim(m.display_name), '')
       from organization_memberships m
      where m.organization_id = p_org and m.user_id = p_user
      limit 1),
    (select nullif(btrim(e.name_ar), '')
       from employees e
      where e.organization_id = p_org and e.user_id = p_user
      limit 1),
    (select nullif(btrim(d.name_ar), '')
       from doctors d
      where d.organization_id = p_org and d.user_id = p_user
      limit 1),
    (select 'admin'
       from organization_memberships m
      where m.organization_id = p_org and m.user_id = p_user
        and m.role_key = 'owner'
      limit 1),
    (select nullif(split_part(u.email, '@', 1), '')
       from auth.users u
      where u.id = p_user)
  );
$$;

-- داخليّة: تقرأ `auth.users`، فلا تُنادى من المتصفّح بمعرّف أيّ حساب.
-- تستدعيها الدوالّ التالية (definer) فتعمل بصلاحية مالكها.
revoke all on function app_member_user_name(uuid, uuid) from public, anon, authenticated;

-- ── 3) مُصدِر الفاتورة ────────────────────────────────────────────────────
create or replace function app_invoice_issuer(p_invoice_id uuid)
returns table (user_name text, job_number text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_uid uuid;
begin
  select organization_id, created_by into v_org, v_uid
    from sales_invoices
   where id = p_invoice_id;

  if v_org is null then
    raise exception 'الفاتورة غير موجودة';
  end if;
  if not app_is_member(v_org) then
    raise exception 'لا صلاحية على هذه الفاتورة';
  end if;

  -- فاتورةٌ بلا مُصدِرٍ مسجَّل (أقدم من 0160 أو من استيراد) تبقى بلا اسم —
  -- ولا يُكتب عليها اسم من يطبعها الآن، فذلك نسبةُ فاتورةٍ لمن لم يُصدرها.
  if v_uid is null then
    return query select null::text, null::text;
    return;
  end if;

  return query
  select app_member_user_name(v_org, v_uid),
         (select nullif(btrim(e.job_number), '')
            from employees e
           where e.organization_id = v_org and e.user_id = v_uid
           limit 1);
end $$;

revoke all on function app_invoice_issuer(uuid) from public, anon;
grant execute on function app_invoice_issuer(uuid) to authenticated;

-- ── 4) تسجيل الطباعة: العدّاد يزيد، والاسم اسم المُصدِر ────────────────────
--
-- كانت (0186) تُرجع اسم **من يطبع** — فإعادة الطباعة من زميلٍ تُغيّر اسم
-- المُصدِر على الورقة. التوقيع نفسه، فلا يتغيّر ما تناديه الواجهة.
create or replace function app_register_invoice_print(p_invoice_id uuid)
returns table (print_count integer, user_name text, job_number text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_n   integer;
begin
  select organization_id into v_org from sales_invoices where id = p_invoice_id;
  if v_org is null then
    raise exception 'الفاتورة غير موجودة';
  end if;
  if not app_is_member(v_org) then
    raise exception 'لا صلاحية على هذه الفاتورة';
  end if;

  update sales_invoices
     set print_count     = coalesce(sales_invoices.print_count, 0) + 1,
         last_printed_at = now(),
         last_printed_by = auth.uid()
   where id = p_invoice_id
  returning sales_invoices.print_count into v_n;

  return query
  select v_n, i.user_name, i.job_number
    from app_invoice_issuer(p_invoice_id) i;
end $$;

revoke all on function app_register_invoice_print(uuid) from public, anon;
grant execute on function app_register_invoice_print(uuid) to authenticated;

commit;

-- ── تحقّق ──────────────────────────────────────────────────────────────────
do $$
declare
  v_missing text;
  v_unnamed int;
begin
  select string_agg(f, '، ')
    into v_missing
    from unnest(array['app_member_user_name','app_invoice_issuer','app_register_invoice_print']) f
   where not exists (
     select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = f);
  if v_missing is not null then
    raise exception 'دوالّ ناقصة: %', v_missing;
  end if;

  select count(*) into v_unnamed
    from organization_memberships
   where role_key = 'owner'
     and nullif(btrim(coalesce(display_name, '')), '') is null;
  if v_unnamed > 0 then
    raise exception 'بقي % مالكًا بلا اسم', v_unnamed;
  end if;

  raise notice '0189 ✓ مُصدِر الفاتورة من القاعدة، والمالك بلا اسم صار admin';
end $$;
