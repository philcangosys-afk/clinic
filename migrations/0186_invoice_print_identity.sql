-- ============================================================================
-- 0186 — ورقة الفاتورة تعرف من طبعها وكم مرّة طُبعت
-- ============================================================================
--
-- الإيصال المعتمد في المجمع يحمل في تذييله ثلاثة أشياء: اسم المستخدم الذي
-- طبع، ووقت الطباعة، وعدد مرّات الطباعة. الأولان كانا في الشيفرة، والثالث لم
-- يكن له مصدرٌ أصلًا.
--
-- **العدّاد في القاعدة لا في المتصفّح:** «طُبعت مرّة» يجب أن تعني مرّةً واحدة
-- في المجمع كلّه لا في هذا الجهاز. وعدٌّ في `localStorage` يُعيد الرقم إلى ١
-- على كل جهازٍ جديد، فتخرج ورقتان تقولان «Printed Count : 1» لفاتورةٍ واحدة
-- — وهذا بالضبط ما يُستعمل العدّاد لكشفه.
--
-- والدالّة تُرجع مع العدّاد **اسم الطابع ورقمه الوظيفي**، فلا تُكتب الورقة
-- باسمٍ يخمّنه المتصفّح: من دخل بحسابه هو من يظهر على الورقة.
--
-- آمنة للتكرار.
-- ============================================================================

begin;

alter table sales_invoices
  add column if not exists print_count integer not null default 0,
  add column if not exists last_printed_at timestamptz,
  add column if not exists last_printed_by uuid references auth.users(id);

comment on column sales_invoices.print_count is
  'عدد مرّات طباعة الفاتورة — يُعرض في تذييل الورقة (Printed Count).';

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
     set print_count     = coalesce(print_count, 0) + 1,
         last_printed_at = now(),
         last_printed_by = auth.uid()
   where id = p_invoice_id
  returning sales_invoices.print_count into v_n;

  return query
  select v_n,
         coalesce(
           (select d.display_name from v_organization_members_directory d
             where d.user_id = auth.uid() and d.organization_id = v_org),
           'مستخدم'),
         (select e.job_number from employees e
           where e.user_id = auth.uid() and e.organization_id = v_org
           limit 1);
end $$;

revoke all on function app_register_invoice_print(uuid) from public, anon;
grant execute on function app_register_invoice_print(uuid) to authenticated;

-- رمز المرحلة الثانية وعدّاد الطباعة تقرؤهما الواجهة من `sales_invoices`
-- مباشرةً: منظور 0157 مبنيٌّ بتعريفٍ مطوّل، وإعادةُ بنائه هنا لأجل عمودين
-- تخاطر بكسر ما يقرؤه سلفًا.

commit;
