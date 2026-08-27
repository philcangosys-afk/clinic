-- ============================================================================
-- 0003_billing_inventory.sql
-- المرحلة 2 (تابع) — الفوترة والمخزون والمشتريات (Billing / Inventory / Procurement)
-- يُنفَّذ يدويًا في: Supabase Dashboard > SQL Editor > New query > Run
-- يُنفَّذ بعد 0001_core_schema.sql و 0002_patients_doctors_appointments.sql مباشرة (يعتمد عليهما)
-- (لا يحتوي على أي مفاتيح أو أسرار — آمن تمامًا للرفع على Git/Builder.io)
--
-- يغطي هذا الملف:
--   1) كتالوج الأصناف/الخدمات (Items) + إعدادات ضريبة القيمة المضافة للمؤسسة
--   2) الموزعون/الموردون (بما فيهم معامل الأسنان كنوع خاص) + أدلة ألوان الأسنان
--   3) صناديق البيع (Cash Registers)
--   4) الاتفاقيات (عقود علاج متعددة الجلسات/الدفعات)
--   5) فواتير البيع (بيع/مرتجع/مؤقتة) وبنودها
--   6) فواتير الشراء وبنودها (بصلاحية لكل بند/دفعة)
--   7) المناقلات وطلبات الشراء الداخلية (Stock Transfers/Requisitions)
--   8) دفعات المخزون (Inventory Lots) وحركة المخزون الموحّدة (Inventory Movements)
--   9) الجلسات العلاجية (Treatment Sessions)
--  10) السندات المالية الموحّدة (قبض/صرف/رواتب/بنكية) + توزيع السداد على عدة فواتير
--  11) حركات محفظة المريض (تُغذّي رصيد patient_wallets من 0001 تلقائيًا)
--  12) تحديث شاشة التنبيهات الموحّدة (Expiring Alerts) لتشمل صلاحية دفعات المخزون
--  13) إصلاح ثغرة تكرار محتملة في بذر lookup_categories/lookup_values (من 0001)
--  14) تعبئة اللوائح المرجعية الأساسية (فئات الأصناف، فئات المصاريف، مصادر المرضى،
--      أنواع العملاء، المؤهلات العلمية، طرق الدفع، أنواع الموردين، أنواع الزيارة،
--      أنواع الملفات، الأحياء) — نفس البيانات الموثّقة من النظام القديم
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) إصلاح: منع تكرار اللوائح النظامية العامة عند إعادة تنفيذ seed عن طريق الخطأ
--    (organization_id = null يعني "لائحة نظامية عامة"، لكن NULL لا يمنع التكرار
--     في قيد unique(organization_id, key) — نضيف فهرس جزئي فريد لسد هذه الثغرة)
-- ---------------------------------------------------------------------------
create unique index if not exists idx_lookup_categories_global_key
  on lookup_categories (key) where organization_id is null;

-- ---------------------------------------------------------------------------
-- 1) كتالوج الأصناف/الخدمات (Items) — يوحّد: خدمة طبية + دواء + مادة مستهلكة
--    (قرار تصميمي من المراجعة: "الصنف" مفهوم واحد بعمود item_type بدل جداول منفصلة)
-- ---------------------------------------------------------------------------
create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  category_value_id uuid references lookup_values(id) on delete set null,
  item_type text not null default 'service' check (item_type in ('service','product','drug','lab_service')),
  code text not null,
  barcode text,
  name_ar text not null,
  name_en text,
  unit text,
  price numeric(12,2) not null default 0,
  cost_price numeric(12,2),
  vat_rate_override numeric(5,2),          -- إن كانت فارغة تُستخدم نسبة الفئة ثم نسبة المؤسسة الافتراضية
  is_vat_exempt boolean not null default false,
  print_price_with_vat boolean not null default false,
  track_inventory boolean not null default false,
  track_expiry boolean not null default false,
  reorder_level numeric(12,2),
  default_discount_percent numeric(5,2) not null default 0,
  is_disabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);
create index if not exists idx_items_org on items (organization_id);
create index if not exists idx_items_barcode on items (organization_id, barcode);
create index if not exists idx_items_name on items using gin (to_tsvector('simple', coalesce(name_ar,'') || ' ' || coalesce(name_en,'')));

-- ---------------------------------------------------------------------------
-- 2) إعدادات ضريبة القيمة المضافة لكل مؤسسة (لقطة 8)
--    (الرقم الضريبي ونسبة الضريبة الافتراضية موجودان أصلًا في organizations)
-- ---------------------------------------------------------------------------
create table if not exists organization_vat_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  sales_vat_enabled boolean not null default true,
  purchase_vat_enabled boolean not null default true,
  purchase_vat_editable boolean not null default false,
  dental_lab_vat_enabled boolean not null default true,
  dental_lab_vat_editable boolean not null default false,
  misc_expenses_vat_enabled boolean not null default false,
  misc_expenses_require_supplier_tax_number boolean not null default false,
  misc_expenses_require_purchase_invoice_number boolean not null default false,
  print_price_with_vat boolean not null default true,
  block_invoice_without_nationality_or_id boolean not null default false,
  vat_exempt_nationality_value_ids uuid[] not null default '{}',
  vat_exemption_disabled_for_customer_types boolean not null default false,
  vat_exemption_disabled_for_items boolean not null default false,
  vat_declaration_viewer_user_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3) الموزعون/الموردون (Distributors) — يشمل معامل الأسنان كنوع خاص بحقول إضافية
--    (قرار من المراجعة: مورد معمل الأسنان هو "مورد" عام بحقول فني/مندوب إضافية،
--     لا كيان منفصل بالكامل)
-- ---------------------------------------------------------------------------
create table if not exists distributors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  parent_distributor_id uuid references distributors(id) on delete set null,
  distributor_type_value_id uuid references lookup_values(id) on delete set null,
  is_dental_lab boolean not null default false,
  file_number bigserial,
  name_ar text not null,
  name_en text,
  sales_rep_name text,
  sales_rep_mobile text,
  lab_technician_name text,
  lab_technician_mobile text,
  nationality_value_id uuid references lookup_values(id),
  profession_value_id uuid references lookup_values(id),
  id_number text,
  tax_number text,
  gln_number text,
  phone_1 text,
  phone_2 text,
  mobile_1 text,
  mobile_2 text,
  email_1 text,
  email_2 text,
  fax text,
  city_value_id uuid references lookup_values(id),
  address text,
  note text,
  is_disabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, file_number)
);
create index if not exists idx_distributors_org on distributors (organization_id);

-- أدلة/ألوان الأسنان (Tooth Shade Guides) — مرجع مشترك يُستخدم عند طلب تركيبات الأسنان
create table if not exists tooth_shade_guides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);
create table if not exists tooth_shades (
  id uuid primary key default gen_random_uuid(),
  shade_guide_id uuid not null references tooth_shade_guides(id) on delete cascade,
  code text not null,
  sort_order int not null default 0
);

-- ---------------------------------------------------------------------------
-- 4) صناديق البيع (Cash Registers) — تشمل "عهدة الدكتور" كنوع خاص
-- ---------------------------------------------------------------------------
create table if not exists cash_registers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  name text not null,
  is_doctor_custody boolean not null default false,
  assigned_doctor_id uuid references doctors(id) on delete set null,
  is_disabled boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 5) الاتفاقيات (Treatment Agreements) — عقد علاج بعدة خدمات وسداد تراكمي
--    remaining_amount = total_amount - invoiced_amount (عمود محسوب تلقائيًا)
--    invoiced_amount يُحدَّث تلقائيًا عبر Trigger كلما ارتبطت بنود فاتورة بالعقد
-- ---------------------------------------------------------------------------
create table if not exists treatment_agreements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  agreement_number bigserial,
  patient_id uuid not null references patients(id) on delete cascade,
  doctor_id uuid references doctors(id) on delete set null,
  clinic_id uuid references clinics(id) on delete set null,
  agreement_date date not null default current_date,
  vat_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  invoiced_amount numeric(12,2) not null default 0,
  remaining_amount numeric(12,2) generated always as (total_amount - invoiced_amount) stored,
  note text,
  is_disabled boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, agreement_number)
);

create table if not exists treatment_agreement_items (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references treatment_agreements(id) on delete cascade,
  item_id uuid references items(id) on delete set null,
  description text,
  qty numeric(12,2) not null default 1,
  unit_price numeric(12,2) not null default 0,
  discount_percent numeric(5,2) not null default 0,
  net_amount numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 6) فواتير البيع (Sales Invoices) — بيع/مرتجع/مؤقتة (عرض سعر)، تدعم B2B وزاتكا
--    وقسم تأمين كامل (تفعيل UCAF/DCAF لاحقًا في 0005 يعتمد على هذه الحقول)
--    paid_amount يُحدَّث تلقائيًا عبر توزيع السندات (انظر قسم 10 أدناه)
-- ---------------------------------------------------------------------------
create table if not exists sales_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  clinic_id uuid references clinics(id) on delete set null,
  doctor_id uuid references doctors(id) on delete set null,
  warehouse_id uuid references warehouses(id) on delete set null,
  patient_id uuid references patients(id) on delete set null,
  appointment_id uuid references appointments(id) on delete set null,
  agreement_id uuid references treatment_agreements(id) on delete set null,
  original_invoice_id uuid references sales_invoices(id) on delete set null,   -- لفواتير المرتجع

  external_customer_name text,     -- عميل "خارجي" بلا ملف مريض
  external_customer_mobile text,
  id_number text,

  invoice_number bigserial,
  invoice_type text not null default 'sale' check (invoice_type in ('sale','return')),
  is_temporary boolean not null default false,     -- عرض سعر/فاتورة مؤقتة قبل التحول لفاتورة فعلية
  is_b2b boolean not null default false,           -- فاتورة ضريبية مبسطة أم B2B كاملة (زاتكا)
  is_favorite boolean not null default false,
  status text not null default 'unpaid' check (status in ('unpaid','partial','paid','void')),

  zatca_invoice_number text,
  zatca_qr text,

  nationality_value_id uuid references lookup_values(id),
  source_value_id uuid references lookup_values(id),
  classification_value_id uuid references lookup_values(id),

  is_insurance_invoice boolean not null default false,
  insurance_company_name text,
  insurance_policy_number text,
  insurance_class_number text,
  insurance_membership_number text,
  insurance_copay_percent numeric(5,2),
  insurance_max_amount numeric(12,2),
  insurance_consultation_limit numeric(12,2),
  insurance_approval_number text,
  insurance_eligibility text,
  insurance_auto_calc_copay boolean not null default false,

  subtotal_amount numeric(12,2) not null default 0,
  discount_percent numeric(5,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  offer_percent numeric(5,2) not null default 0,
  vat_amount numeric(12,2) not null default 0,
  exemption_amount numeric(12,2) not null default 0,
  net_amount numeric(12,2) not null default 0,
  paid_amount numeric(12,2) not null default 0,
  remaining_amount numeric(12,2) generated always as (net_amount - paid_amount) stored,

  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (patient_id is not null or external_customer_name is not null)
);
create index if not exists idx_sales_invoices_org_date on sales_invoices (organization_id, created_at desc);
create index if not exists idx_sales_invoices_patient on sales_invoices (patient_id);
create index if not exists idx_sales_invoices_status on sales_invoices (organization_id, status);

create table if not exists sales_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references sales_invoices(id) on delete cascade,
  item_id uuid references items(id) on delete set null,
  agreement_item_id uuid references treatment_agreement_items(id) on delete set null,
  doctor_id uuid references doctors(id) on delete set null,     -- إسناد البند لطبيب محدد
  source_barcode text,
  description text,
  line_type text not null default 'normal' check (line_type in ('normal','follow_up','agreement')),
  price numeric(12,2) not null default 0,
  qty numeric(12,2) not null default 1,
  discount_percent numeric(5,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  vat_rate numeric(5,2) not null default 0,
  vat_amount numeric(12,2) not null default 0,
  exemption_amount numeric(12,2) not null default 0,
  net_amount numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_sales_invoice_items_invoice on sales_invoice_items (invoice_id);
create index if not exists idx_sales_invoice_items_agreement on sales_invoice_items (agreement_item_id);

-- ---------------------------------------------------------------------------
-- 7) فواتير الشراء (Purchase Invoices) — بصلاحية وكمية مجانية لكل بند
-- ---------------------------------------------------------------------------
create table if not exists purchase_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  warehouse_id uuid not null references warehouses(id) on delete restrict,
  distributor_id uuid references distributors(id) on delete set null,
  invoice_number text,
  invoice_date date not null default current_date,
  source_document text,
  source_number text,
  supplier_tax_number text,
  payment_term text not null default 'cash' check (payment_term in ('cash','credit')),
  general_discount_amount numeric(12,2) not null default 0,
  vat_enabled boolean not null default true,
  subtotal_amount numeric(12,2) not null default 0,
  vat_amount numeric(12,2) not null default 0,
  net_amount numeric(12,2) not null default 0,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_purchase_invoices_org_date on purchase_invoices (organization_id, invoice_date desc);

create table if not exists purchase_invoice_items (
  id uuid primary key default gen_random_uuid(),
  purchase_invoice_id uuid not null references purchase_invoices(id) on delete cascade,
  item_id uuid not null references items(id) on delete restrict,
  source_barcode text,
  purchase_price numeric(12,2) not null default 0,
  sale_price numeric(12,2),                          -- تحديث سعر البيع من نفس شاشة الشراء
  update_item_sale_price boolean not null default false,
  qty numeric(12,2) not null default 1,
  free_qty numeric(12,2) not null default 0,          -- كمية مجانية من المورد
  discount_percent numeric(5,2) not null default 0,
  line_discount_amount numeric(12,2) not null default 0,
  vat_rate numeric(5,2) not null default 0,
  vat_amount numeric(12,2) not null default 0,
  net_amount numeric(12,2) not null default 0,
  expiry_date date,                                   -- صلاحية هذا البند/الدفعة تحديدًا
  lot_number text,
  created_at timestamptz not null default now()
);
create index if not exists idx_purchase_invoice_items_invoice on purchase_invoice_items (purchase_invoice_id);

-- ---------------------------------------------------------------------------
-- 8) المناقلات وطلبات الشراء الداخلية (Stock Transfers / Requisitions)
--    (دورة موافقات: طلب → اعتماد → تنفيذ)
-- ---------------------------------------------------------------------------
create table if not exists stock_transfers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  transfer_type text not null default 'transfer' check (transfer_type in ('transfer','purchase_requisition','disbursement')),
  status text not null default 'pending' check (status in ('pending','approved','rejected','completed')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  from_warehouse_id uuid references warehouses(id) on delete set null,
  to_warehouse_id uuid references warehouses(id) on delete set null,
  note text,
  requested_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists stock_transfer_items (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references stock_transfers(id) on delete cascade,
  item_id uuid not null references items(id) on delete restrict,
  qty numeric(12,2) not null default 1,
  unit_cost numeric(12,2),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 9) دفعات المخزون (Inventory Lots) وحركة المخزون الموحّدة (Inventory Movements)
--    منطق تسعير: متوسط صافي الشراء (Weighted Average) يُحسب من inventory_lots
--    ملاحظة تصميم: هذا الملف لا يُنشئ دفعات/حركات تلقائيًا من فواتير الشراء/البيع —
--    يجب على طبقة التطبيق إدراجها ضمن نفس المعاملة (Transaction) عند حفظ الفاتورة،
--    لإتاحة المرونة (بيع خدمة لا يستهلك مخزونًا، تعديل يدوي، مناقلة داخلية...).
--    ما يُنفَّذ تلقائيًا هنا فقط: تحديث qty_remaining في الدفعة عند إدراج حركة مرتبطة بها.
-- ---------------------------------------------------------------------------
create table if not exists inventory_lots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  warehouse_id uuid not null references warehouses(id) on delete cascade,
  item_id uuid not null references items(id) on delete restrict,
  purchase_invoice_item_id uuid references purchase_invoice_items(id) on delete set null,
  lot_number text,
  unit_cost numeric(12,2) not null default 0,
  qty_received numeric(12,2) not null default 0,
  qty_remaining numeric(12,2) not null default 0,
  expiry_date date,
  received_at timestamptz not null default now()
);
create index if not exists idx_inventory_lots_item_wh on inventory_lots (item_id, warehouse_id);
create index if not exists idx_inventory_lots_expiry on inventory_lots (organization_id, expiry_date) where expiry_date is not null;

create table if not exists inventory_movements (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  warehouse_id uuid not null references warehouses(id) on delete cascade,
  item_id uuid not null references items(id) on delete restrict,
  lot_id uuid references inventory_lots(id) on delete set null,
  movement_type text not null check (movement_type in (
    'purchase_in','sale_out','return_in','return_out',
    'transfer_in','transfer_out','adjustment_in','adjustment_out','consumption_out'
  )),
  qty numeric(12,2) not null,
  unit_price numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  related_purchase_invoice_id uuid references purchase_invoices(id) on delete set null,
  related_sales_invoice_id uuid references sales_invoices(id) on delete set null,
  related_stock_transfer_id uuid references stock_transfers(id) on delete set null,
  doctor_id uuid references doctors(id) on delete set null,      -- استهلاك مخزون منسوب لطبيب أثناء العلاج
  patient_id uuid references patients(id) on delete set null,
  clinic_id uuid references clinics(id) on delete set null,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_inventory_movements_item on inventory_movements (item_id, warehouse_id, created_at desc);
create index if not exists idx_inventory_movements_org on inventory_movements (organization_id, created_at desc);
create index if not exists idx_inventory_movements_doctor on inventory_movements (doctor_id) where doctor_id is not null;

-- ---------------------------------------------------------------------------
-- 10) الجلسات العلاجية (Treatment Sessions) — لخطط العلاج متعددة الجلسات
-- ---------------------------------------------------------------------------
create table if not exists treatment_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  doctor_id uuid references doctors(id) on delete set null,
  agreement_id uuid references treatment_agreements(id) on delete set null,
  agreement_item_id uuid references treatment_agreement_items(id) on delete set null,
  sales_invoice_item_id uuid references sales_invoice_items(id) on delete set null,
  session_number int not null default 1,
  scheduled_date date,
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled')),
  note text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 11) السندات المالية الموحّدة (Financial Vouchers)
--     يوحّد: سندات القبض + سندات الصرف/المصاريف + صرف الرواتب + التعاملات البنكية
--     (قرار تصميمي: جدول عام واحد بعمود voucher_type بدل 4 جداول منفصلة، يطابق
--      نمط "الصنف الموحّد" و"اللوائح المرجعية الموحّدة" المعتمد سابقًا)
-- ---------------------------------------------------------------------------
create table if not exists financial_vouchers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  voucher_number bigserial,
  voucher_type text not null check (voucher_type in ('receipt','expense','salary','bank_deposit','bank_withdrawal','bank_transfer')),
  voucher_date date not null default current_date,
  amount numeric(12,2) not null default 0,

  payment_method_value_id uuid references lookup_values(id),
  cash_register_id uuid references cash_registers(id) on delete set null,
  bank_transfer_ref text,
  transfer_to_account_value_id uuid references lookup_values(id),   -- لتحويل بين حسابين (لقطة 51)

  related_sales_invoice_id uuid references sales_invoices(id) on delete set null,   -- اختصار للحالة الشائعة (فاتورة واحدة)
  patient_id uuid references patients(id) on delete set null,
  distributor_id uuid references distributors(id) on delete set null,
  employee_name text,
  employee_ref_id uuid,      -- سيُربط لاحقًا بجدول employees عند تنفيذ 0008 (الموارد البشرية)

  expense_category_value_id uuid references lookup_values(id),
  expense_source_document text,
  expense_source_number text,
  payee_name text,           -- "يصرف لـ"
  description text,          -- "البيان"

  vat_rate numeric(5,2),
  vat_amount numeric(12,2),
  requires_vat boolean not null default false,
  supplier_tax_number text,

  clinic_id uuid references clinics(id) on delete set null,        -- توزيع تكلفة المصروف على مركز تكلفة
  doctor_id uuid references doctors(id) on delete set null,

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, voucher_number)
);
create index if not exists idx_vouchers_org_date on financial_vouchers (organization_id, voucher_date desc);
create index if not exists idx_vouchers_type on financial_vouchers (organization_id, voucher_type);

-- توزيع سند قبض واحد على أكثر من فاتورة لنفس ملف المريض (لقطة 47: "دفعة لأكثر من فاتورة")
create table if not exists voucher_invoice_allocations (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references financial_vouchers(id) on delete cascade,
  sales_invoice_id uuid not null references sales_invoices(id) on delete cascade,
  amount numeric(12,2) not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_voucher_allocations_invoice on voucher_invoice_allocations (sales_invoice_id);

-- ---------------------------------------------------------------------------
-- 12) حركات محفظة المريض (Patient Wallet Transactions)
--     تُغذّي رصيد patient_wallets (من 0001) تلقائيًا عبر Trigger — بدل التعديل
--     المباشر غير الموثّق على الرصيد، لضمان سجل تدقيق كامل لكل حركة محفظة
-- ---------------------------------------------------------------------------
create table if not exists patient_wallet_transactions (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  transaction_type text not null check (transaction_type in ('top_up','deduction','refund','adjustment')),
  amount numeric(12,2) not null,
  related_voucher_id uuid references financial_vouchers(id) on delete set null,
  related_invoice_id uuid references sales_invoices(id) on delete set null,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_wallet_tx_patient on patient_wallet_transactions (patient_id, created_at desc);

-- ============================================================================
-- الدوال والمشغّلات (Functions & Triggers)
-- ============================================================================

-- تحديث رصيد محفظة المريض تلقائيًا عند إضافة حركة محفظة جديدة
create or replace function app_apply_wallet_transaction()
returns trigger
language plpgsql
security definer
as $$
declare
  delta numeric(12,2);
begin
  if new.transaction_type in ('top_up','refund') then
    delta := new.amount;
  else
    delta := -new.amount;
  end if;

  update patient_wallets
    set balance = balance + delta, updated_at = now()
    where patient_id = new.patient_id;

  if not found then
    insert into patient_wallets (patient_id, organization_id, balance)
    values (new.patient_id, new.organization_id, delta);
  end if;

  return new;
end;
$$;
drop trigger if exists trg_wallet_transaction_apply on patient_wallet_transactions;
create trigger trg_wallet_transaction_apply
  after insert on patient_wallet_transactions
  for each row execute function app_apply_wallet_transaction();

-- تحديث qty_remaining في دفعة المخزون تلقائيًا عند إدراج حركة مرتبطة بها
create or replace function app_apply_inventory_movement()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.lot_id is not null then
    if new.movement_type in ('purchase_in','return_in','transfer_in','adjustment_in') then
      update inventory_lots set qty_remaining = qty_remaining + new.qty where id = new.lot_id;
    elsif new.movement_type in ('sale_out','return_out','transfer_out','adjustment_out','consumption_out') then
      update inventory_lots set qty_remaining = qty_remaining - new.qty where id = new.lot_id;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_inventory_movement_apply on inventory_movements;
create trigger trg_inventory_movement_apply
  after insert on inventory_movements
  for each row execute function app_apply_inventory_movement();

-- إعادة حساب "المفوتر" في الاتفاقية تلقائيًا كلما ارتبطت/تغيّرت/حُذفت بنود فاتورة بها
-- ملاحظة أمان مهمة: في PL/pgSQL، الوصول لحقل NEW داخل DELETE Trigger (أو حقل OLD
-- داخل INSERT Trigger) يسبب خطأ تشغيلي "record is not assigned yet" — لذلك تُفرَّع
-- كل الدوال أدناه صراحةً حسب TG_OP قبل أي وصول لحقول NEW/OLD، بدل استخدام
-- coalesce(new.x, old.x) الذي يبدو آمنًا لكنه ينهار فعليًا عند التنفيذ الحقيقي.
create or replace function app_recalc_agreement_invoiced_amount(target_agreement_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  if target_agreement_id is null then
    return;
  end if;
  update treatment_agreements ta
    set invoiced_amount = coalesce((
          select sum(sii.net_amount)
          from sales_invoice_items sii
          join treatment_agreement_items tai on tai.id = sii.agreement_item_id
          where tai.agreement_id = target_agreement_id
        ), 0),
        updated_at = now()
    where ta.id = target_agreement_id;
end;
$$;

create or replace function app_recalc_agreement_invoiced()
returns trigger
language plpgsql
security definer
as $$
declare
  old_agreement_item_id uuid;
  new_agreement_item_id uuid;
  old_target uuid;
  new_target uuid;
begin
  if tg_op in ('DELETE','UPDATE') then
    old_agreement_item_id := old.agreement_item_id;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    new_agreement_item_id := new.agreement_item_id;
  end if;

  if old_agreement_item_id is not null then
    select agreement_id into old_target from treatment_agreement_items where id = old_agreement_item_id;
    perform app_recalc_agreement_invoiced_amount(old_target);
  end if;

  if new_agreement_item_id is not null and new_agreement_item_id is distinct from old_agreement_item_id then
    select agreement_id into new_target from treatment_agreement_items where id = new_agreement_item_id;
    perform app_recalc_agreement_invoiced_amount(new_target);
  end if;

  if tg_op = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$$;
drop trigger if exists trg_sales_invoice_items_agreement_sync on sales_invoice_items;
create trigger trg_sales_invoice_items_agreement_sync
  after insert or update or delete on sales_invoice_items
  for each row execute function app_recalc_agreement_invoiced();

-- إعادة حساب "المدفوع" وحالة الفاتورة تلقائيًا من مجموع توزيعات سندات القبض عليها
-- (هذا ما يُمكّن مؤشرات "نسبة التحصيل %" الموثّقة في شاشة الفواتير القديمة)
create or replace function app_recalc_invoice_paid_amount(target_invoice uuid)
returns void
language plpgsql
security definer
as $$
declare
  total_paid numeric(12,2);
  invoice_net numeric(12,2);
begin
  if target_invoice is null then
    return;
  end if;

  select coalesce(sum(a.amount), 0) into total_paid
    from voucher_invoice_allocations a
    join financial_vouchers v on v.id = a.voucher_id
    where a.sales_invoice_id = target_invoice and v.voucher_type = 'receipt';

  select net_amount into invoice_net from sales_invoices where id = target_invoice;

  update sales_invoices
    set paid_amount = total_paid,
        status = case
          when total_paid <= 0 then 'unpaid'
          when total_paid >= coalesce(invoice_net, 0) then 'paid'
          else 'partial'
        end,
        updated_at = now()
    where id = target_invoice;
end;
$$;

create or replace function app_apply_voucher_allocation()
returns trigger
language plpgsql
security definer
as $$
begin
  if tg_op in ('DELETE','UPDATE') then
    perform app_recalc_invoice_paid_amount(old.sales_invoice_id);
  end if;
  if tg_op in ('INSERT','UPDATE') then
    perform app_recalc_invoice_paid_amount(new.sales_invoice_id);
  end if;

  if tg_op = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$$;
drop trigger if exists trg_voucher_allocation_apply on voucher_invoice_allocations;
create trigger trg_voucher_allocation_apply
  after insert or update or delete on voucher_invoice_allocations
  for each row execute function app_apply_voucher_allocation();

-- ============================================================================
-- تحديث شاشة التنبيهات الموحّدة (Expiring Alerts من 0001) لتشمل صلاحية دفعات المخزون
-- ============================================================================
create or replace view expiring_alerts as
  select organization_id, 'facility_license'::text as alert_type, authority_name as title, end_date as expires_on
  from facility_licenses
  where is_disabled = false
  union all
  select organization_id, 'inventory_lot_expiry'::text as alert_type,
         coalesce(lot_number, 'دفعة بلا رقم') as title, expiry_date as expires_on
  from inventory_lots
  where expiry_date is not null and qty_remaining > 0;

-- ============================================================================
-- تفعيل Row Level Security (RLS) على كل الجداول أعلاه
-- ============================================================================
alter table items enable row level security;
alter table organization_vat_settings enable row level security;
alter table distributors enable row level security;
alter table tooth_shade_guides enable row level security;
alter table tooth_shades enable row level security;
alter table cash_registers enable row level security;
alter table treatment_agreements enable row level security;
alter table treatment_agreement_items enable row level security;
alter table sales_invoices enable row level security;
alter table sales_invoice_items enable row level security;
alter table purchase_invoices enable row level security;
alter table purchase_invoice_items enable row level security;
alter table stock_transfers enable row level security;
alter table stock_transfer_items enable row level security;
alter table inventory_lots enable row level security;
alter table inventory_movements enable row level security;
alter table treatment_sessions enable row level security;
alter table financial_vouchers enable row level security;
alter table voucher_invoice_allocations enable row level security;
alter table patient_wallet_transactions enable row level security;

create policy "items_all_members" on items
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "vat_settings_read_members" on organization_vat_settings
  for select using (app_is_member(organization_id));
create policy "vat_settings_insert_admins" on organization_vat_settings
  for insert with check (app_is_org_admin(organization_id));
create policy "vat_settings_update_admins" on organization_vat_settings
  for update using (app_is_org_admin(organization_id));

create policy "distributors_all_members" on distributors
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "shade_guides_all_members" on tooth_shade_guides
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));
create policy "shades_all_members" on tooth_shades
  for all using (exists (select 1 from tooth_shade_guides g where g.id = tooth_shades.shade_guide_id and app_is_member(g.organization_id)))
  with check (exists (select 1 from tooth_shade_guides g where g.id = tooth_shades.shade_guide_id and app_is_member(g.organization_id)));

create policy "cash_registers_all_members" on cash_registers
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "agreements_all_members" on treatment_agreements
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));
create policy "agreement_items_all_members" on treatment_agreement_items
  for all using (exists (select 1 from treatment_agreements a where a.id = treatment_agreement_items.agreement_id and app_is_member(a.organization_id)))
  with check (exists (select 1 from treatment_agreements a where a.id = treatment_agreement_items.agreement_id and app_is_member(a.organization_id)));

create policy "sales_invoices_all_members" on sales_invoices
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));
create policy "sales_invoice_items_all_members" on sales_invoice_items
  for all using (exists (select 1 from sales_invoices i where i.id = sales_invoice_items.invoice_id and app_is_member(i.organization_id)))
  with check (exists (select 1 from sales_invoices i where i.id = sales_invoice_items.invoice_id and app_is_member(i.organization_id)));

create policy "purchase_invoices_all_members" on purchase_invoices
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));
create policy "purchase_invoice_items_all_members" on purchase_invoice_items
  for all using (exists (select 1 from purchase_invoices p where p.id = purchase_invoice_items.purchase_invoice_id and app_is_member(p.organization_id)))
  with check (exists (select 1 from purchase_invoices p where p.id = purchase_invoice_items.purchase_invoice_id and app_is_member(p.organization_id)));

create policy "stock_transfers_all_members" on stock_transfers
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));
create policy "stock_transfer_items_all_members" on stock_transfer_items
  for all using (exists (select 1 from stock_transfers t where t.id = stock_transfer_items.transfer_id and app_is_member(t.organization_id)))
  with check (exists (select 1 from stock_transfers t where t.id = stock_transfer_items.transfer_id and app_is_member(t.organization_id)));

create policy "inventory_lots_all_members" on inventory_lots
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));
create policy "inventory_movements_all_members" on inventory_movements
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "treatment_sessions_all_members" on treatment_sessions
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

create policy "financial_vouchers_all_members" on financial_vouchers
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));
create policy "voucher_allocations_all_members" on voucher_invoice_allocations
  for all using (exists (select 1 from financial_vouchers v where v.id = voucher_invoice_allocations.voucher_id and app_is_member(v.organization_id)))
  with check (exists (select 1 from financial_vouchers v where v.id = voucher_invoice_allocations.voucher_id and app_is_member(v.organization_id)));

create policy "wallet_tx_all_members" on patient_wallet_transactions
  for all using (app_is_member(organization_id)) with check (app_is_member(organization_id));

-- ============================================================================
-- 13) تعبئة اللوائح المرجعية الأساسية (Lookup Categories + Values)
--     كل القيم أدناه موثّقة حرفيًا من مراجعة النظام القديم (كايزن) — organization_id
--     = null يعني "لائحة نظامية عامة" تظهر لكل المؤسسات، وقابلة للتوسعة من كل مؤسسة
--     بإضافة قيمها الخاصة عبر لائحة جديدة بنفس المفتاح (key) ومعرّف مؤسستها.
-- ============================================================================
insert into lookup_categories (organization_id, key, name_ar, name_en) values
  (null, 'item_categories', 'فئات الأصناف والخدمات', 'Item & Service Categories'),
  (null, 'expense_categories', 'فئات المصاريف', 'Expense Categories'),
  (null, 'distributor_types', 'أنواع الموردين', 'Distributor Types'),
  (null, 'patient_sources', 'مصادر المرضى', 'Patient Sources'),
  (null, 'customer_types', 'أنواع العملاء', 'Customer Types'),
  (null, 'educational_qualifications', 'المؤهلات العلمية', 'Educational Qualifications'),
  (null, 'payment_methods', 'طرق الدفع', 'Payment Methods'),
  (null, 'visit_types', 'أنواع الزيارة', 'Visit Types'),
  (null, 'file_types', 'أنواع الملفات', 'File Types'),
  (null, 'districts', 'الأحياء والعناوين', 'Districts / Addresses')
on conflict (key) where organization_id is null do nothing;

-- منع تكرار القيم داخل نفس اللائحة عند إعادة تنفيذ seed عن طريق الخطأ
alter table lookup_values add constraint uq_lookup_values_category_name unique (category_id, name_ar);

-- فئات الأصناف والخدمات (لقطة 10) — شجرة هرمية: خدمات الأسنان (أب) + فئات موازية مستقلة
do $$
declare
  cat_id uuid;
  dental_parent_id uuid;
begin
  select id into cat_id from lookup_categories where key = 'item_categories' and organization_id is null;

  insert into lookup_values (category_id, name_ar, name_en, sort_order)
  values (cat_id, 'خدمات الأسنان', 'Dental Services', 10)
  on conflict (category_id, name_ar) do nothing
  returning id into dental_parent_id;

  if dental_parent_id is null then
    select id into dental_parent_id from lookup_values where category_id = cat_id and name_ar = 'خدمات الأسنان';
  end if;

  insert into lookup_values (category_id, parent_value_id, name_ar, name_en, sort_order) values
    (cat_id, dental_parent_id, 'كشفيات', 'Consultations', 11),
    (cat_id, dental_parent_id, 'أشعة الأسنان X-Ray', 'Dental X-Ray', 12),
    (cat_id, dental_parent_id, 'صحة الفم والأسنان الوقائية', 'Preventive Oral Health', 13),
    (cat_id, dental_parent_id, 'تركيبات', 'Prosthodontics', 14),
    (cat_id, dental_parent_id, 'أطفال Pediatric', 'Pediatric Dentistry', 15),
    (cat_id, dental_parent_id, 'علاج تحفظي', 'Conservative Treatment', 16),
    (cat_id, dental_parent_id, 'تقويم Orthodontic', 'Orthodontics', 17),
    (cat_id, dental_parent_id, 'جراحة Surgical', 'Oral Surgery', 18),
    (cat_id, dental_parent_id, 'إجازة مرضية', 'Sick Leave', 19)
  on conflict (category_id, name_ar) do nothing;

  insert into lookup_values (category_id, name_ar, name_en, sort_order, extra) values
    (cat_id, 'أصناف المستودع', 'Store Materials', 20, '{}'),
    (cat_id, 'مستودع الأسنان', 'Dental Store', 21, '{}'),
    (cat_id, 'أصناف مواد استهلاكية', 'Consumable Materials', 22, '{}'),
    (cat_id, 'خدمات معامل الأسنان D-Lab', 'Dental Lab Services', 23, '{}'),
    (cat_id, 'الصيدلية', 'Pharmacy', 24, '{}'),
    (cat_id, 'VAT 0%', 'VAT 0%', 25, '{"default_vat_rate": 0}'),
    (cat_id, 'VAT 15%', 'VAT 15%', 26, '{"default_vat_rate": 15}'),
    (cat_id, 'المواد والأدوات', 'Materials & Tools', 27, '{}'),
    (cat_id, 'مواد التقويم', 'Orthodontic Materials', 28, '{}'),
    (cat_id, 'الأدوات والأجهزة الطبية', 'Medical Tools & Devices', 29, '{}'),
    (cat_id, 'مصاريف متفرقة', 'Miscellaneous Expenses', 30, '{}'),
    (cat_id, 'مواد زراعة أسنان وعظم', 'Dental & Bone Implant Materials', 31, '{}'),
    (cat_id, 'مواد تحميل', 'Loading Materials', 32, '{}'),
    (cat_id, 'معدات وأدوات تجميل (جلدية)', 'Cosmetic Dermatology Equipment', 33, '{}'),
    (cat_id, 'خدمات الجلدية', 'Dermatology Services', 34, '{}'),
    (cat_id, 'BOTOX', 'BOTOX', 35, '{}'),
    (cat_id, 'COSMETIC', 'COSMETIC', 36, '{}'),
    (cat_id, 'DERMA', 'DERMA', 37, '{}')
  on conflict (category_id, name_ar) do nothing;
end $$;

-- فئات المصاريف (لقطة 12)
do $$
declare cat_id uuid;
begin
  select id into cat_id from lookup_categories where key = 'expense_categories' and organization_id is null;
  insert into lookup_values (category_id, name_ar, name_en, sort_order) values
    (cat_id, 'مصاريف متنوعة ومتفرقة', 'Miscellaneous Expenses', 10),
    (cat_id, 'فواتير كهرباء', 'Electricity Bills', 20),
    (cat_id, 'فواتير مياه', 'Water Bills', 30),
    (cat_id, 'فواتير هاتف وانترنت', 'Phone & Internet Bills', 40),
    (cat_id, 'ايجارات', 'Rent', 50),
    (cat_id, 'رواتب موظفين', 'Employee Salaries', 60),
    (cat_id, 'مكافآت موظفين', 'Employee Bonuses', 70),
    (cat_id, 'قرطاسية ومكتبات', 'Stationery', 80),
    (cat_id, 'أدوات نظافة ومواد تنظيف', 'Cleaning Supplies', 90),
    (cat_id, 'مسحوبات إدارية', 'Administrative Withdrawals', 100),
    (cat_id, 'أجهزة كمبيوتر وملحقاتها', 'Computers & Accessories', 110),
    (cat_id, 'صيانة أجهزة طبية', 'Medical Equipment Maintenance', 120),
    (cat_id, 'صيانة الكهرباء', 'Electrical Maintenance', 130),
    (cat_id, 'صيانة الديكور', 'Interior Maintenance', 140),
    (cat_id, 'التأمينات الاجتماعية', 'Social Insurance', 150),
    (cat_id, 'رسوم دوائر حكومية', 'Government Fees', 160),
    (cat_id, 'دعاية واعلان', 'Advertising', 170),
    (cat_id, 'فواتير بنزين سيارة', 'Vehicle Fuel', 180),
    (cat_id, 'شراء معدات طبية', 'Medical Equipment Purchase', 190),
    (cat_id, 'التأمينات الطبية', 'Medical Insurance', 200),
    (cat_id, 'مشتريات طبية', 'Medical Purchases', 210),
    (cat_id, 'وسائل نقل وتنقلات', 'Transportation', 220),
    (cat_id, 'مصاريف معقب', 'Government Liaison Fees', 230),
    (cat_id, 'مرتجع علاج للمرضى القدماء', 'Treatment Refunds (Existing Patients)', 240),
    (cat_id, 'مسحوبات شخصية', 'Personal Withdrawals', 250),
    (cat_id, 'عمولات بنكية', 'Bank Commissions', 260),
    (cat_id, 'صيانة ساكة', 'POS / Terminal Maintenance', 270)
  on conflict (category_id, name_ar) do nothing;
end $$;

-- أنواع الموردين
insert into lookup_values (category_id, name_ar, name_en, sort_order)
select c.id, v.name_ar, v.name_en, v.sort_order
from lookup_categories c
cross join (values
  ('مورد عام','General Supplier',10),
  ('موزع أدوية','Pharmaceutical Distributor',20),
  ('معمل أسنان','Dental Lab',30),
  ('مورد مستلزمات طبية','Medical Supplies Vendor',40),
  ('خدمات صيانة','Maintenance Services',50)
) as v(name_ar, name_en, sort_order)
where c.key = 'distributor_types' and c.organization_id is null
on conflict (category_id, name_ar) do nothing;

-- مصادر المرضى (لقطة 21)
insert into lookup_values (category_id, name_ar, name_en, sort_order)
select c.id, v.name_ar, v.name_en, v.sort_order
from lookup_categories c
cross join (values
  ('الموقع الالكتروني','Website',10),
  ('لوحة المركز/الطريق','Roadside Sign',20),
  ('عن طريق مريض قديم','Existing Patient Referral',30),
  ('بحث جوجل','Google Search',40),
  ('تطبيق الجوال','Mobile App',50),
  ('طلب باسم دكتور معين','Requested a Specific Doctor',60),
  ('فيسبوك','Facebook',70),
  ('تويتر','Twitter / X',80),
  ('SMS','SMS',90),
  ('Email','Email',100),
  ('مجهول المصدر','Unknown',110),
  ('شركة عهود تسويق','Marketing Agency',120),
  ('سناب شات','Snapchat',130),
  ('انستقرام','Instagram',140),
  ('عضويات VIP المجمع','Complex VIP Membership',150)
) as v(name_ar, name_en, sort_order)
where c.key = 'patient_sources' and c.organization_id is null
on conflict (category_id, name_ar) do nothing;

-- أنواع العملاء (لقطة 21)
insert into lookup_values (category_id, name_ar, name_en, sort_order)
select c.id, v.name_ar, v.name_en, v.sort_order
from lookup_categories c
cross join (values
  ('عميل عادي','Regular Customer',10),
  ('عميل VIP','VIP Customer',20),
  ('عميل مشكوك بأمره','Suspicious Customer',30),
  ('عميل جمعية','Association / Charity Customer',40)
) as v(name_ar, name_en, sort_order)
where c.key = 'customer_types' and c.organization_id is null
on conflict (category_id, name_ar) do nothing;

-- المؤهلات العلمية (لقطة 20)
insert into lookup_values (category_id, name_ar, name_en, sort_order)
select c.id, v.name_ar, v.name_en, v.sort_order
from lookup_categories c
cross join (values
  ('روضة/تمهيدي','Kindergarten',10),
  ('ابتدائية','Elementary',20),
  ('متوسطة/اعدادية','Middle School',30),
  ('ثانوية عامة/بكالوريا','High School / Baccalaureate',40),
  ('ثانوية تجارية/مهنية','Vocational High School',50),
  ('دبلوم معاهد مهنية','Vocational Institute Diploma',60),
  ('دبلوم معاهد فنية','Technical Institute Diploma',70),
  ('ليسانس/إجازة جامعية','Bachelor License (Licence)',80),
  ('بكالوريوس','Bachelor''s Degree',90),
  ('دبلوم عالي','Higher Diploma',100),
  ('ماجستير','Master''s Degree',110),
  ('دكتوراه','PhD',120),
  ('بروفسور','Professor',130),
  ('استاذ','Professor (Full)',140),
  ('استاذ مساعد','Assistant Professor',150),
  ('معيد','Teaching Assistant',160)
) as v(name_ar, name_en, sort_order)
where c.key = 'educational_qualifications' and c.organization_id is null
on conflict (category_id, name_ar) do nothing;

-- طرق الدفع (لقطة 25) — نسب العمولة/الحدود القصوى محفوظة داخل extra (jsonb)
insert into lookup_values (category_id, name_ar, name_en, sort_order, extra)
select c.id, v.name_ar, v.name_en, v.sort_order, v.extra::jsonb
from lookup_categories c
cross join (values
  ('نقدي', 'Cash', 10, '{"is_cash": true}'),
  ('ATM-MADA', 'ATM - MADA', 20, '{"is_atm": true, "commission_percent": 0.80}'),
  ('ATM-VISA/MasterCard', 'ATM - VISA/MasterCard', 30, '{"is_atm": true, "commission_percent": 2.50, "max_amount": 1000}'),
  ('American Express', 'American Express', 40, '{"is_atm": true}'),
  ('Cheque Payment', 'Cheque Payment', 50, '{}'),
  ('خدمة تابي', 'Tabby (Installments)', 60, '{"is_installment": true}'),
  ('رصيد عهدة خارجية', 'External Custody Balance', 70, '{}'),
  ('بنك الراجحي', 'Al Rajhi Bank', 80, '{"is_bank": true}'),
  ('بنك الإنماء', 'Alinma Bank', 90, '{"is_bank": true}'),
  ('بنك الجزيرة', 'Bank AlJazira', 100, '{"is_bank": true}')
) as v(name_ar, name_en, sort_order, extra)
where c.key = 'payment_methods' and c.organization_id is null
on conflict (category_id, name_ar) do nothing;

-- أنواع الزيارة (مستخدمة في appointments.visit_type_value_id)
insert into lookup_values (category_id, name_ar, name_en, sort_order)
select c.id, v.name_ar, v.name_en, v.sort_order
from lookup_categories c
cross join (values
  ('جديد','New',10),
  ('مراجعة (Follow up)','Follow-up',20),
  ('أول زيارة','First Visit',30)
) as v(name_ar, name_en, sort_order)
where c.key = 'visit_types' and c.organization_id is null
on conflict (category_id, name_ar) do nothing;

-- أنواع الملفات (مستخدمة في patients.file_type_value_id)
insert into lookup_values (category_id, name_ar, name_en, sort_order)
select c.id, v.name_ar, v.name_en, v.sort_order
from lookup_categories c
cross join (values
  ('ملف عادي','Standard File',10),
  ('ملف مولود جديد','Newborn File',20),
  ('ملف مؤقت','Temporary File',30),
  ('ملف خارجي','External File',40)
) as v(name_ar, name_en, sort_order)
where c.key = 'file_types' and c.organization_id is null
on conflict (category_id, name_ar) do nothing;

-- عيّنة أولية من الأحياء (قابلة للتوسعة من كل مؤسسة حسب مدينتها الخاصة)
insert into lookup_values (category_id, name_ar, name_en, sort_order)
select c.id, v.name_ar, v.name_en, v.sort_order
from lookup_categories c
cross join (values
  ('أبحر الشمالية','North Obhur',10),
  ('إسكان الجامعة','University Housing',20),
  ('اجواد','Ajwad',30),
  ('الأميرة','Al Ameera',40),
  ('الأندلس','Al Andalus',50)
) as v(name_ar, name_en, sort_order)
where c.key = 'districts' and c.organization_id is null
on conflict (category_id, name_ar) do nothing;

-- ============================================================================
-- نهاية 0003_billing_inventory.sql
-- الخطوة التالية: 0004_tax_discounts_offers.sql
--   (دوال resolve_vat_rate()/resolve_discount()، جدول العروض الزمنية، حدود الخصم
--    المطبَّقة فعليًا، إعدادات كشفية المريض)
-- ============================================================================
