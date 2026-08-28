-- 0043: تسجيل اسم الجهاز في سجل التدقيق (لقطة 81)
--
-- `audit_log.device_name` موجود منذ 0001، وشاشة سجل التدقيق تعرضه وتصفّي به
-- منذ إضافتها — لكن لم يكن يُكتب فيه شيء إطلاقًا، فكان العمود يظهر "—" في كل
-- صف والفلتر يبقى فارغًا أبدًا.
--
-- الطريقة: العميل يرسل ترويسة `x-device-name` في كل طلب (مضبوطة مرة واحدة في
-- إنشاء عميل Supabase من إعدادات الجهاز المحلية)، و PostgREST يتيح الترويسات
-- للمُحفِّزات عبر `current_setting('request.headers')`.
--
-- لماذا ترويسة لا عمود يمرّره كل استدعاء: التسجيل يتم في مُحفِّز داخل القاعدة
-- لا في كود العميل، فلا يوجد في الاستدعاء مكان يمرَّر فيه اسم الجهاز — وإضافته
-- كانت ستتطلب تعديل كل عملية كتابة في المشروع.

-- ---------------------------------------------------------------------------
-- دالة مساعدة: اسم الجهاز من ترويسة الطلب.
--
-- `current_setting(..., true)` بالوسيط الثاني `true` تُعيد NULL بدل رمي خطأ
-- حين لا يكون الإعداد موجودًا — وهذا هو الحال في أي تنفيذ خارج طلب PostgREST
-- (psql، مهمة مجدولة، ترحيل). بدونها كان أي إدراج من خارج التطبيق سيفشل.
--
-- الاسم يصل مُرمَّزًا بـ encodeURIComponent لأن ترويسات HTTP لا تقبل إلا
-- ASCII، والأسماء عربية. `convert_from(decode(...))` يفكّ الترميز إلى UTF-8.
-- ---------------------------------------------------------------------------
create or replace function app_request_device_name()
returns text
language plpgsql
stable
as $$
declare
  v_headers text;
  v_raw text;
begin
  v_headers := current_setting('request.headers', true);
  if v_headers is null then
    return null;
  end if;

  v_raw := (v_headers::json ->> 'x-device-name');
  if v_raw is null or v_raw = '' then
    return null;
  end if;

  -- فكّ ترميز النسبة المئوية (%D8%A7...) إلى نص عربي.
  --
  -- الطريقة: تحويل السلسلة كلها إلى ست عشري ثم `decode(..., 'hex')` دفعةً
  -- واحدة. المحاولة الأبسط `regexp_replace` + `decode(...,'escape')` لا تعمل:
  -- 'escape' يفهم `\ooo` الثماني لا `\xHH` الست عشري، فتخرج السلسلة كما هي.
  begin
    declare
      v_hex text := '';
      v_i int := 1;
      v_len int := length(v_raw);
      v_ch text;
    begin
      while v_i <= v_len loop
        v_ch := substr(v_raw, v_i, 1);
        if v_ch = '%' and v_i + 2 <= v_len and substr(v_raw, v_i + 1, 2) ~ '^[0-9A-Fa-f]{2}$' then
          v_hex := v_hex || substr(v_raw, v_i + 1, 2);
          v_i := v_i + 3;
        else
          -- الحرف العادي يتحوّل لبايتاته كما هي
          v_hex := v_hex || encode(convert_to(v_ch, 'UTF8'), 'hex');
          v_i := v_i + 1;
        end if;
      end loop;
      return convert_from(decode(v_hex, 'hex'), 'UTF8');
    end;
  exception when others then
    -- ترويسة مشوّهة يجب ألّا تُفشل عملية الحفظ نفسها — الاسم الخام أفضل من
    -- فقدان السجل كله.
    return left(v_raw, 100);
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- تحديث مُحفِّز التدقيق العام ليملأ device_name.
-- باقي جسم الدالة كما هو في 0025 حرفيًا — التغيير الوحيد هو العمود الجديد.
-- ---------------------------------------------------------------------------
create or replace function app_audit_log_auto()
returns trigger
language plpgsql
security definer
as $$
declare
  v_row jsonb;
  v_title text;
  v_action text;
begin
  v_row := case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;

  if TG_NARGS > 0 then
    v_title := v_row ->> TG_ARGV[0];
  end if;

  v_action := case TG_OP when 'INSERT' then 'add' when 'UPDATE' then 'update' when 'DELETE' then 'delete' end;

  insert into audit_log (organization_id, user_id, action_type, module, entity_id, entity_title, device_name)
  values (
    (v_row ->> 'organization_id')::uuid,
    auth.uid(),
    v_action,
    TG_TABLE_NAME,
    (v_row ->> 'id')::uuid,
    v_title,
    app_request_device_name()
  );

  return coalesce(NEW, OLD);
end;
$$;

comment on function app_audit_log_auto() is
  'Trigger عام يُسجِّل كل إضافة/تعديل/حذف في audit_log تلقائيًا، مع اسم الجهاز من ترويسة x-device-name إن وُجدت. يُستخدَم بتمرير اسم عمود العنوان كوسيط: for each row execute function app_audit_log_auto(''name_ar'').';
