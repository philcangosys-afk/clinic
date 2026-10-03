-- ============================================================================
-- 0217 — اتفاقيات Kizen ببنودها الحقيقية، وتنشيط أيّ اتفاقيةٍ من الأرشيف
-- ----------------------------------------------------------------------------
-- طلب المالك (03/10/2026، بعد إيقاف Kizen):
--   • أرشيف الاتفاقيات يحمل بنود كلّ اتفاقية كما في Kizen (الخدمة، العدد،
--     السعر، الخصم، الضريبة، الصافي) — عمود `items` في legacy_agreements،
--     بلا جدولٍ جديد. وتُعلَّم الاتفاقية التي حُذفت في Kizen (`kizen_deleted`).
--   • `app_kizen_build_agreement(legacy_id, activate)` — يبني الاتفاقية الحيّة من
--     الأرشيف بخدماتٍ حقيقية بما بقي منها:
--       - المفوتَر في Kizen يُوزَّع على البنود: أوّلًا بأكواد الأعمال في فواتير
--         الاتفاقية (الأرشيف المالي)، ثمّ الباقي بترتيب البنود.
--       - بندٌ لم يُفوتَر منه شيء ⇐ بعدده وسعره وخصمه. وما فُوتر منه وحداتٌ
--         كاملة ⇐ بما بقي من العدد. وما فُوتر منه جزء ⇐ سطرٌ بالمبلغ الباقي
--         (والفوترة بالمبلغ تعمل عليه، 0213).
--       - «اتفاقية - Agreement» (الكود 426) أو خدمةٌ لا صنف لها في الكتالوج ⇐
--         سطر «رصيد اتفاقية Kizen».
--       - لا يُمسّ ما عليه حركة في ZainCare (فوترة، أو عروضٌ وبنودٌ أُضيفت بعد
--         البناء): يُترك كما هو.
--   • `app_activate_legacy_agreement(legacy_id)` — زرّ «تنشيط» في أرشيف
--     الاتفاقيات: اتفاقيةٌ قديمة (مفوترة بالكامل، أو معطّلة، أو أُلغيت
--     مديونيتها) تصير حيّة في ملفّ المريض برقمها في Kizen، فتُعدَّل ويُضاف لها
--     عرضٌ وتُفوتَر. إن كانت حيّةً من قبل فُعِّلت وفُتحت.
--
-- لا يمسّ الفواتير ولا ZATCA. معاملة واحدة، آمنة للتكرار.
-- ============================================================================

begin;
set local lock_timeout = '8s';

alter table legacy_agreements
  add column if not exists items         jsonb,
  add column if not exists invoices      jsonb,
  add column if not exists kizen_deleted boolean not null default false;

comment on column legacy_agreements.items is
  'بنود الاتفاقية كما في Kizen (0217): quote, date, doctor, clinic, code, service, qty, price, gross, discount, taxable, vat, net, ord.';
comment on column legacy_agreements.invoices is
  'فواتير Kizen التي صدرت من الاتفاقية (0217): seq, zatca, date, kind, works, net.';

create table if not exists public.import_agreement_rebuild (
  organization_id uuid not null,
  legacy_number   bigint not null,
  agreement_id    uuid not null,
  fingerprint     text not null,
  method          text,
  rebuilt_at      timestamptz not null default now(),
  primary key (organization_id, legacy_number)
);
alter table public.import_agreement_rebuild enable row level security;
revoke all on public.import_agreement_rebuild from anon, authenticated;

create or replace function app_kizen_norm(p text)
returns text language sql immutable as $$
  select btrim(regexp_replace(
           regexp_replace(
             translate(
               regexp_replace(btrim(coalesce(p, '')), '^(دكتورة\s+|دكتور\s+|د\s*\.\s*|د\s+)', ''),
               'أإآٱةىـ', 'ااااهي'),
             '[ً-ْ]', '', 'g'),
           '\s+', ' ', 'g'));
$$;

-- ── البنّاء ──────────────────────────────────────────────────────────────────
create or replace function app_kizen_build_agreement(p_legacy_id uuid, p_activate boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  la          legacy_agreements%rowtype;
  v_org       uuid;
  v_agr       uuid;
  v_quote     uuid;
  v_qn        bigint;
  v_item_agr  uuid;
  v_rate      numeric;
  v_pexempt   boolean;
  v_doc       uuid;
  v_clinic    uuid;
  v_live      boolean;
  v_touched   boolean;
  v_built_at  timestamptz;
  v_status    text;
  v_items     jsonb;
  v_n         int;
  v_i         int;
  v_alloc     numeric[];
  v_net       numeric[];
  v_cap       numeric;
  v_left      numeric;
  v_take      numeric;
  v_code      text;
  v_line      jsonb;
  v_r         numeric;
  v_q         numeric;
  v_k         numeric;
  v_unit      numeric;
  v_ratio     numeric;
  v_tax       numeric;
  v_disc      numeric;
  v_qty       numeric;
  v_price     numeric;
  v_vat       numeric;
  v_exemp     numeric;
  v_item      uuid;
  v_item_vx   boolean;
  v_desc      text;
  v_sum       numeric := 0;
  v_lines     int := 0;
  v_rec       record;
  v_note      text;
  v_seq       text;
begin
  select * into la from legacy_agreements where id = p_legacy_id;
  if la.id is null then
    raise exception 'الاتفاقية غير موجودة في الأرشيف';
  end if;
  v_org := la.organization_id;
  if la.patient_id is null then
    return jsonb_build_object('status', 'no_patient', 'number', la.legacy_number);
  end if;

  v_live := la.remaining_amount >= 0.5 and not la.is_disabled and not la.debt_cancelled and not la.kizen_deleted;
  if not v_live and not p_activate then
    return jsonb_build_object('status', 'not_live', 'number', la.legacy_number);
  end if;

  select id into v_item_agr from items where organization_id = v_org and code = 'KZ-AGR';
  if v_item_agr is null then
    raise exception 'الصنف KZ-AGR غير موجود — يُنشئه استيراد Kizen الأوّل';
  end if;

  -- ── اتفاقيةٌ حيّة قائمة: عليها حركة في ZainCare؟
  v_agr := la.migrated_agreement_id;
  if v_agr is not null and not exists (select 1 from treatment_agreements where id = v_agr) then
    v_agr := null;
  end if;
  if v_agr is not null then
    select r.rebuilt_at into v_built_at from import_agreement_rebuild r
     where r.organization_id = v_org and r.agreement_id = v_agr;
    select exists (select 1 from v_agreement_item_balances b where b.agreement_id = v_agr and b.invoiced_amount <> 0)
        or exists (select 1 from sales_invoices si where si.agreement_id = v_agr)
        or v_built_at is null
        or exists (select 1 from agreement_quotes q where q.agreement_id = v_agr and q.created_at > v_built_at + interval '2 minutes')
        or exists (select 1 from treatment_agreement_items ai where ai.agreement_id = v_agr and ai.created_at > v_built_at + interval '2 minutes')
      into v_touched;
    if v_touched then
      if p_activate then
        update treatment_agreements
           set is_disabled = false, disabled_reason = null, updated_at = now(), updated_by = auth.uid()
         where id = v_agr and is_disabled;
        return jsonb_build_object('status', 'opened', 'agreement_id', v_agr, 'number', la.legacy_number);
      end if;
      return jsonb_build_object('status', 'kept', 'agreement_id', v_agr, 'number', la.legacy_number);
    end if;
  end if;

  -- ── الطبيب والعيادة بالاسم كما في Kizen
  select case when count(*) = 1 then min(d.id::text)::uuid end into v_doc
    from doctors d
   where d.organization_id = v_org and app_kizen_norm(la.doctor_name) <> ''
     and app_kizen_norm(d.name_ar) = app_kizen_norm(la.doctor_name);
  if v_doc is null and v_agr is not null then
    select doctor_id into v_doc from treatment_agreements where id = v_agr;
  end if;
  select c.id into v_clinic from clinics c
   where c.organization_id = v_org and btrim(c.name) = btrim(coalesce(la.clinic_name, '')) limit 1;
  if v_clinic is null and v_doc is not null then
    select clinic_id into v_clinic from doctors where id = v_doc;
  end if;

  -- ── الضريبة وإعفاء المريض — بقاعدة الاستيراد
  select coalesce(o.default_vat_rate, 0) into v_rate from organizations o where o.id = v_org;
  if exists (select 1 from organization_vat_settings s where s.organization_id = v_org and s.sales_vat_enabled = false) then
    v_rate := 0;
  end if;
  select exists (
           select 1 from patients p
           join organization_vat_settings s on s.organization_id = v_org
          where p.id = la.patient_id and p.nationality_value_id is not null
            and p.nationality_value_id = any (coalesce(s.vat_exempt_nationality_value_ids, '{}'))
            and not coalesce(s.vat_exemption_disabled_for_customer_types, false)
            and (not coalesce(s.vat_exempt_requires_id, true) or nullif(btrim(coalesce(p.id_number, '')), '') is not null))
    into v_pexempt;
  v_pexempt := coalesce(v_pexempt, false) and v_rate > 0;

  v_note := format('من Kizen: اتفاقية رقم %s — الإجمالي %s، المفوتر %s، المتبقّي %s',
                   la.legacy_number, la.total_amount, la.invoiced_amount, la.remaining_amount);

  -- ── الرأس
  if v_agr is null then
    insert into treatment_agreements (organization_id, agreement_number, patient_id, doctor_id, clinic_id, agreement_date,
                                      agreement_text, note, created_at, created_by, registrar_id)
    values (v_org,
            case when exists (select 1 from treatment_agreements x where x.organization_id = v_org and x.agreement_number = la.legacy_number)
                 then nextval(pg_get_serial_sequence('public.treatment_agreements', 'agreement_number'))
                 else la.legacy_number end,
            la.patient_id, v_doc, v_clinic,
            coalesce((la.agreement_date at time zone 'Asia/Riyadh')::date, current_date),
            la.agreement_text, la.note, coalesce(la.legacy_created_at, la.agreement_date, now()),
            auth.uid(), auth.uid())
    returning id into v_agr;
    v_status := case when p_activate and not v_live then 'activated' else 'created' end;
  else
    delete from treatment_agreement_items where agreement_id = v_agr;
    update agreement_quotes set is_cancelled = true, cancelled_at = now(),
           cancel_reason = 'أُعيد بناؤه من بنود Kizen (0217)', updated_at = now()
     where agreement_id = v_agr and not is_cancelled;
    update treatment_agreements
       set patient_id = la.patient_id, doctor_id = coalesce(v_doc, doctor_id), clinic_id = coalesce(v_clinic, clinic_id),
           agreement_date = coalesce((la.agreement_date at time zone 'Asia/Riyadh')::date, agreement_date),
           agreement_text = la.agreement_text, note = la.note,
           is_disabled = false, disabled_reason = null, updated_at = now()
     where id = v_agr;
    v_status := case when p_activate then 'activated' else 'rebuilt' end;
  end if;

  -- ── البنود: ما بقي من كلّ خدمة
  if la.remaining_amount >= 0.5 then
    v_items := coalesce(la.items, '[]'::jsonb);
    v_n := jsonb_array_length(v_items);
    v_alloc := array_fill(0::numeric, array[greatest(v_n, 1)]);
    v_net := array_fill(0::numeric, array[greatest(v_n, 1)]);
    for v_i in 1..v_n loop
      v_net[v_i] := coalesce((v_items->(v_i - 1)->>'net')::numeric, 0);
    end loop;
    v_left := least(greatest(la.invoiced_amount, 0), la.total_amount);

    -- (أ) بأكواد الأعمال في فواتير الاتفاقية
    for v_rec in
      select li.code, sum(case when i.kind = 'return' then -li.net_amount else li.net_amount end) as amt
        from legacy_invoices i
        join legacy_invoice_items li on li.legacy_invoice_id = i.id
       where i.organization_id = v_org and i.agreement_number = la.legacy_number
       group by li.code
      having sum(case when i.kind = 'return' then -li.net_amount else li.net_amount end) > 0
    loop
      v_take := v_rec.amt;
      for v_i in 1..v_n loop
        exit when v_take <= 0 or v_left <= 0;
        if coalesce(v_items->(v_i - 1)->>'code', '') = coalesce(v_rec.code, '#') then
          v_cap := least(v_net[v_i] - v_alloc[v_i], v_take, v_left);
          if v_cap > 0 then
            v_alloc[v_i] := v_alloc[v_i] + v_cap;
            v_take := v_take - v_cap;
            v_left := v_left - v_cap;
          end if;
        end if;
      end loop;
    end loop;
    -- (ب) الباقي بترتيب البنود
    for v_i in 1..v_n loop
      exit when v_left <= 0;
      v_cap := least(v_net[v_i] - v_alloc[v_i], v_left);
      if v_cap > 0 then
        v_alloc[v_i] := v_alloc[v_i] + v_cap;
        v_left := v_left - v_cap;
      end if;
    end loop;

    select coalesce(max(quote_number), 0) + 1 into v_qn from agreement_quotes where organization_id = v_org;
    insert into agreement_quotes (organization_id, agreement_id, quote_number, quote_date, doctor_id, clinic_id, note, created_by)
    values (v_org, v_agr, v_qn, coalesce(la.agreement_date, now()), v_doc, v_clinic, v_note, auth.uid())
    returning id into v_quote;

    -- مجموع البنود الباقية يجب أن يساوي متبقّي Kizen، وإلّا سطر رصيدٍ واحد
    v_sum := 0;
    for v_i in 1..v_n loop
      v_sum := v_sum + (v_net[v_i] - v_alloc[v_i]);
    end loop;
    if v_n = 0 or abs(v_sum - la.remaining_amount) > 0.05 then
      v_ratio := case when la.total_amount > 0 then 1 - la.vat_amount / la.total_amount else 1 end;
      v_tax := round(la.remaining_amount * v_ratio, 2);
      v_vat := case when v_pexempt or v_rate = 0 or la.vat_amount = 0 then 0 else round(v_tax * v_rate / 100, 2) end;
      v_exemp := case when v_pexempt then round(v_tax * v_rate / 100, 2) else 0 end;
      insert into treatment_agreement_items (agreement_id, quote_id, item_id, description, qty, unit_price,
        discount_percent, discount_amount, taxable_amount, vat_rate, vat_amount, exemption_amount, net_amount, sort_order)
      values (v_agr, v_quote, v_item_agr,
              left(format('رصيد اتفاقية Kizen رقم %s: %s', la.legacy_number, coalesce(la.services, 'اتفاقية')), 500),
              1, v_tax, 0, 0, v_tax, v_rate, v_vat, v_exemp, v_tax + v_vat, 1);
      v_lines := 1;
    else
      for v_i in 1..v_n loop
        v_line := v_items->(v_i - 1);
        v_r := round(v_net[v_i] - v_alloc[v_i], 2);
        continue when v_r < 0.01;
        v_code := nullif(v_line->>'code', '');
        v_item := null;
        v_item_vx := false;
        -- الكود في Kizen رقمُ الصنف الداخليّ؛ والكود الذي تعرفه العيادة (وكتالوج
        -- ZainCare) «باركود المصدر» — يُعرف من بنود فواتير Kizen بالكود نفسه
        if v_code is not null and v_code <> '426' then
          select i.id, coalesce(i.is_vat_exempt, false) into v_item, v_item_vx
            from items i
           where i.organization_id = v_org
             and i.code = (select li.source_code from legacy_invoice_items li
                            where li.organization_id = v_org and li.code = v_code
                              and nullif(btrim(li.source_code), '') is not null
                            group by li.source_code order by count(*) desc limit 1)
           order by coalesce(i.is_disabled, false), i.created_at limit 1;
        end if;
        v_q := coalesce((v_line->>'qty')::numeric, 1);
        v_price := coalesce((v_line->>'price')::numeric, 0);
        v_disc := coalesce((v_line->>'discount')::numeric, 0);
        v_tax := coalesce((v_line->>'taxable')::numeric, v_net[v_i]);
        v_ratio := case when v_net[v_i] > 0 then v_tax / v_net[v_i] else 1 end;
        v_unit := case when v_q > 0 then v_net[v_i] / v_q else 0 end;
        v_k := case when v_unit > 0 then round(v_r / v_unit, 4) end;

        if abs(v_r - v_net[v_i]) < 0.01 then
          v_qty := v_q;                                       -- لم يُفوتَر منه شيء
        elsif v_k is not null and v_k >= 1 and abs(v_k - round(v_k)) < 0.0001 and v_q > 1 then
          v_qty := round(v_k);                                -- فُوترت منه وحداتٌ كاملة
          v_disc := round(v_disc * v_qty / v_q, 2);
          v_tax := round(v_tax * v_qty / v_q, 2);
        else
          v_qty := 1;                                         -- فُوتر منه جزء: الباقي بالمبلغ
          v_tax := round(v_r * v_ratio, 2);
          v_price := v_tax;
          v_disc := 0;
        end if;
        if v_item is null then
          v_desc := format('رصيد اتفاقية Kizen رقم %s: %s', la.legacy_number, coalesce(v_line->>'service', 'خدمة'));
          if v_qty <> 1 then
            v_price := v_tax; v_disc := 0; v_qty := 1;
          end if;
        else
          v_desc := coalesce(v_line->>'service', 'خدمة');
        end if;
        -- ضريبة Kizen على البند صفرٌ (مواطنٌ معفى أو خدمةٌ معفاة) ⇐ صفر هنا أيضًا
        v_vat := case when v_pexempt or v_rate = 0 or v_item_vx or coalesce((v_line->>'vat')::numeric, 0) = 0
                      then 0 else round(v_tax * v_rate / 100, 2) end;
        v_exemp := case when v_pexempt and not v_item_vx then round(v_tax * v_rate / 100, 2) else 0 end;
        v_lines := v_lines + 1;
        insert into treatment_agreement_items (agreement_id, quote_id, item_id, description, qty, unit_price,
          discount_percent, discount_amount, taxable_amount, vat_rate, vat_amount, exemption_amount, net_amount, sort_order)
        values (v_agr, v_quote, coalesce(v_item, v_item_agr), left(v_desc, 500), v_qty, v_price,
                case when v_qty * v_price > 0 then round(v_disc * 100 / (v_qty * v_price), 2) else 0 end,
                v_disc, v_tax, v_rate, v_vat, v_exemp, v_tax + v_vat, v_lines);
      end loop;
    end if;
  end if;

  perform app_agreement_refresh(v_agr);
  update legacy_agreements set migrated_agreement_id = v_agr where id = la.id;
  insert into import_agreement_rebuild (organization_id, legacy_number, agreement_id, fingerprint, method)
  values (v_org, la.legacy_number, v_agr, case when p_activate then 'activate' else 'kizen_final_1003' end, v_status)
  on conflict (organization_id, legacy_number) do update
     set agreement_id = excluded.agreement_id, fingerprint = excluded.fingerprint,
         method = excluded.method, rebuilt_at = now();

  -- الترقيم يكمل بعد أكبر رقم
  v_seq := pg_get_serial_sequence('public.treatment_agreements', 'agreement_number');
  if v_seq is not null then
    perform setval(v_seq, greatest((select max(agreement_number) from treatment_agreements where agreement_number < 900000000), 1), true);
  end if;

  return jsonb_build_object('status', v_status, 'agreement_id', v_agr, 'number', la.legacy_number, 'lines', v_lines);
end $$;

revoke all on function app_kizen_build_agreement(uuid, boolean) from public, anon, authenticated;

-- ── زرّ «تنشيط» في أرشيف الاتفاقيات ─────────────────────────────────────────
create or replace function app_activate_legacy_agreement(p_legacy_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  la  legacy_agreements%rowtype;
  v   jsonb;
begin
  select * into la from legacy_agreements where id = p_legacy_id;
  if la.id is null then
    raise exception 'الاتفاقية غير موجودة في الأرشيف';
  end if;
  if not app_has_permission(la.organization_id, 'agreements.manage') then
    raise exception 'صلاحيتك لا تسمح بتنشيط الاتفاقيات (agreements.manage)';
  end if;
  if la.patient_id is null then
    raise exception 'الاتفاقية % غير مربوطة بمريض في ZainCare', la.legacy_number;
  end if;

  -- لها اتفاقيةٌ حيّة: تُفعَّل إن كانت معطّلة وتُفتح كما هي (لا يُعاد بناؤها)
  if la.migrated_agreement_id is not null
     and exists (select 1 from treatment_agreements where id = la.migrated_agreement_id) then
    update treatment_agreements
       set is_disabled = false, disabled_reason = null, updated_at = now(), updated_by = auth.uid()
     where id = la.migrated_agreement_id and is_disabled;
    v := jsonb_build_object('status', 'opened', 'agreement_id', la.migrated_agreement_id);
  else
    v := app_kizen_build_agreement(p_legacy_id, true);
  end if;

  insert into audit_log (organization_id, user_id, module, action_type, entity_id, entity_title, details)
  values (la.organization_id, auth.uid(), 'agreements', 'update', (v->>'agreement_id')::uuid,
          'تنشيط اتفاقية من أرشيف Kizen رقم ' || la.legacy_number,
          case v->>'status' when 'opened' then 'كانت حيّة — فُعِّلت وفُتحت'
                            else format('أصبحت حيّة في ملفّ المريض (%s بندًا بما بقي)', coalesce(v->>'lines', '0')) end);
  return (v->>'agreement_id')::uuid;
end $$;

revoke all on function app_activate_legacy_agreement(uuid) from public, anon;
grant execute on function app_activate_legacy_agreement(uuid) to authenticated;

-- ── حفظ عرض السعر: بندٌ قائم لم يتغيّر سعره لا يُرفض بالحدّ الأدنى ───────────
-- بنود Kizen ودفعاتها الجزئية قد تكون دون الحدّ الأدنى للصنف في ZainCare، فكان
-- تعديل أيّ شيءٍ في العرض (ملاحظة، طبيب، بندٌ آخر) يُرفض بسببها. الحدّ يبقى
-- لكلّ سعرٍ جديد أو مخفَّض. تعديلٌ موضعيّ بنمطٍ مرن؛ إن لم يُطابق: تنبيهٌ فقط.
do $$
declare
  r      record;
  v_src  text;
  v_new  text;
  v_p1   text := 'if\s+v_item\.min_price\s+is\s+not\s+null\s+and\s+v_price\s*>\s*0\s+and\s+v_price\s*<\s*v_item\.min_price\s+then';
  v_r1   text := 'if v_item.min_price is not null and v_price > 0 and v_price < v_item.min_price' || E'\n' ||
                 '       and not (v_line_id is not null and exists (select 1 from treatment_agreement_items x0217' || E'\n' ||
                 '                 where x0217.id = v_line_id and x0217.unit_price <= v_price)) then';
  v_p2   text := 'if\s+v_item\.min_price\s+is\s+not\s+null\s+and\s+v_disc\s*>\s*0\s+and\s+\(\s*v_gross\s*-\s*v_disc\s*\)\s*/\s*v_qty\s*<\s*v_item\.min_price\s+then';
  v_r2   text := 'if v_item.min_price is not null and v_disc > 0' || E'\n' ||
                 '       and (v_gross - v_disc) / v_qty < v_item.min_price' || E'\n' ||
                 '       and not (v_line_id is not null and exists (select 1 from treatment_agreement_items x0217' || E'\n' ||
                 '                 where x0217.id = v_line_id and x0217.qty > 0' || E'\n' ||
                 '                   and (x0217.qty * x0217.unit_price - x0217.discount_amount) / x0217.qty <= (v_gross - v_disc) / v_qty + 0.005)) then';
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'app_save_agreement_quote' loop
    v_src := replace(pg_get_functiondef(r.oid), chr(13), '');
    if position('x0217' in v_src) > 0 then
      continue;
    end if;
    v_new := regexp_replace(regexp_replace(v_src, v_p1, v_r1), v_p2, v_r2);
    if v_new = v_src then
      raise notice 'حدّا السعر في app_save_agreement_quote لم يُطابقا النمط — لم يُعدَّل';
      continue;
    end if;
    execute v_new;
  end loop;
end $$;

commit;

select count(*) as "اتفاقيات الأرشيف", count(items) as "ببنود Kizen", count(migrated_agreement_id) as "لها اتفاقية حيّة"
  from legacy_agreements;
