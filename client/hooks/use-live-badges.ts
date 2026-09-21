import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// كل دالة هنا تُرجع عددًا حقيقيًا من قاعدة البيانات بدل الأرقام الثابتة التي
// كانت موضوعة كعرض توضيحي في module-registry.ts. أي استعلام يفشل (جدول/عرض
// غير موجود بعد، أو لا صلاحية) يُعاد له null بصمت بدل كسر الشريط الجانبي كله.

async function safeCount(
  query: Promise<{ count: number | null; error: unknown }>,
): Promise<number | null> {
  try {
    const { count, error } = await query;
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

function todayBounds() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

async function fetchLiveBadges(
  organizationId: string,
  userId?: string,
  /**
   * حصرُ العدّادات على طبيبٍ بعينه.
   *
   * ثلاثة عدّادات وحدها تُحصَر — المواعيد والمرضى والزيارات — لأنّها وحدها
   * التي تُقابل شاشاتٍ محصورة. وعدّادات المختبر والأشعة والصيدلية تبقى على
   * المنشأة: طوابيرُ عملٍ مشتركة لا ملكيّة فيها لطبيب.
   */
  scopedDoctorId?: string | null,
): Promise<Record<string, number | null>> {
  const { startIso, endIso } = todayBounds();

  const receptionQuery = supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .gte("scheduled_start", startIso)
    .lt("scheduled_start", endIso);

  // مصدرٌ مختلف لا مرشَّحٌ مضاف: `v_doctor_patients` (0164) هو ما يُعرّف
  // «مريض الطبيب»، وهو نفسه مصدر شاشة المرضى — فلا يفترق الرقمان.
  const patientsQuery = scopedDoctorId
    ? supabase
        .from("v_doctor_patients")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("doctor_id", scopedDoctorId)
    : supabase
        .from("patients")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId);

  const visitsQuery = supabase
    .from("patient_visits")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .gte("visit_date", startIso)
    .lt("visit_date", endIso);

  const entries: [string, Promise<number | null>][] = [
    [
      "reception",
      safeCount(
        (scopedDoctorId
          ? receptionQuery.eq("doctor_id", scopedDoctorId)
          : receptionQuery) as any,
      ),
    ],
    ["patients", safeCount(patientsQuery as any)],
    [
      "medical-records",
      safeCount(
        (scopedDoctorId ? visitsQuery.eq("doctor_id", scopedDoctorId) : visitsQuery) as any,
      ),
    ],
    [
      "services",
      safeCount(
        supabase
          .from("items")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .in("item_type", ["service", "lab_service"])
          .eq("is_disabled", false) as any,
      ),
    ],
    [
      "departments",
      safeCount(
        supabase
          .from("clinics")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("is_disabled", false) as any,
      ),
    ],
    [
      "doctors",
      safeCount(
        supabase
          .from("doctors")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("is_enabled", true) as any,
      ),
    ],
    [
      "laboratory",
      safeCount(
        supabase
          .from("v_lab_pending_orders")
          // مفتاح هذا العرض اسمه `lab_order_id` لا `id` — طلب عمود
          // غير موجود كان يُفشل العدّاد بصمت فيبقى الشارة صفرًا دائمًا.
          .select("lab_order_id", { count: "exact", head: true })
          .eq("organization_id", organizationId) as any,
      ),
    ],
    [
      "radiology",
      safeCount(
        supabase
          .from("v_radiology_unreported_orders")
          // مفتاح هذا العرض اسمه `radiology_order_id` لا `id` — طلب عمود
          // غير موجود كان يُفشل العدّاد بصمت فيبقى الشارة صفرًا دائمًا.
          .select("radiology_order_id", { count: "exact", head: true })
          .eq("organization_id", organizationId) as any,
      ),
    ],
    [
      "pharmacy",
      safeCount(
        supabase
          .from("items")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("item_type", "drug")
          .eq("is_disabled", false) as any,
      ),
    ],
    [
      "dispensing",
      safeCount(
        supabase
          .from("v_prescriptions_pending_dispensing")
          // مفتاح هذا العرض اسمه `prescription_id` لا `id` — طلب عمود
          // غير موجود كان يُفشل العدّاد بصمت فيبقى الشارة صفرًا دائمًا.
          .select("prescription_id", { count: "exact", head: true })
          .eq("organization_id", organizationId) as any,
      ),
    ],
    [
      "employees",
      safeCount(
        supabase
          .from("employees")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("status", "active") as any,
      ),
    ],
    [
      "attendance",
      safeCount(
        supabase
          .from("v_today_attendance")
          .select("employee_id", { count: "exact", head: true })
          .eq("organization_id", organizationId) as any,
      ),
    ],
    [
      "leave",
      safeCount(
        supabase
          .from("leave_requests")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("status", "pending") as any,
      ),
    ],
    [
      "contracts",
      safeCount(
        supabase
          .from("v_employee_contracts_status")
          .select("employee_id", { count: "exact", head: true })
          .eq("organization_id", organizationId) as any,
      ),
    ],
    [
      "recruitment",
      safeCount(
        supabase
          .from("job_postings")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId) as any,
      ),
    ],
    [
      "training",
      safeCount(
        supabase
          .from("training_programs")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId) as any,
      ),
    ],
    [
      "shifts",
      safeCount(
        supabase
          .from("shift_templates")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId) as any,
      ),
    ],
    [
      "audit",
      safeCount(
        supabase
          .from("audit_log")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .gte("occurred_at", startIso)
          .lt("occurred_at", endIso) as any,
      ),
    ],
    [
      // ما ينتظر السداد لا عدد كلّ الفواتير: العدد الذي يستدعي عملًا
      "purchase-invoices",
      safeCount(
        supabase
          .from("purchase_invoices")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .in("status", ["unpaid", "partial"]) as any,
      ),
    ],
    [
      // طلبات تنتظر الاعتماد
      "purchase-requests",
      safeCount(
        supabase
          .from("purchase_requests")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("status", "submitted") as any,
      ),
    ],
    [
      "follow-up-center",
      // للاستقبال: ما وصل اليوم ولم يُطَّلع عليه — العدد الذي ينتظر عملًا.
      // وللطبيب: ما أرسله اليوم.
      safeCount(
        (scopedDoctorId
          ? supabase
              .from("v_follow_up_center")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId)
              .eq("doctor_id", scopedDoctorId)
              .gte("requested_at", startIso)
              .lt("requested_at", endIso)
          : supabase
              .from("v_follow_up_center")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId)
              .is("seen_at", null)
              .eq("status", "pending")
              .gte("requested_at", startIso)
              .lt("requested_at", endIso)) as any,
      ),
    ],
  ];

  if (userId) {
    entries.push([
      "messaging",
      safeCount(
        supabase
          .from("v_internal_unread_counts")
          .select("conversation_id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("user_id", userId) as any,
      ),
    ]);
  }

  const results = await Promise.all(entries.map(([, p]) => p));
  const out: Record<string, number | null> = {};
  entries.forEach(([key], i) => {
    out[key] = results[i];
  });
  return out;
}

/**
 * أعداد حقيقية من قاعدة البيانات لاستخدامها كبديل للأرقام الثابتة في
 * module-registry.ts. أي موديول غير مذكور هنا (مثل "رحلة المريض" أو
 * "حركات المخزون" التي تحتاج عرضًا خاصًا بالمخزون المنخفض) يبقى على شارته
 * الثابتة الأصلية أو بلا شارة.
 */
export function useLiveBadgeCounts(
  organizationId?: string | null,
  userId?: string | null,
  scopedDoctorId?: string | null,
) {
  return useQuery({
    queryKey: ["live-badge-counts", organizationId, userId, scopedDoctorId ?? ""],
    queryFn: () =>
      fetchLiveBadges(organizationId as string, userId ?? undefined, scopedDoctorId ?? null),
    enabled: Boolean(organizationId),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

export function formatBadgeNumber(n: number): string {
  if (n <= 0) return "0";
  return n > 999 ? `${Math.floor(n / 1000)}k+` : String(n);
}
