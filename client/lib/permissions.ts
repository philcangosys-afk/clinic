import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";

/**
 * صلاحيات المستخدم في المنشأة النشطة (0062).
 *
 * قبل هذا كانت الحماية كلها بالصفة (`role_key`): إمّا يملك «المستقبِل» كل ما
 * لكل مستقبِل أو لا شيء. وجدول `membership_permissions` — الموجود منذ 0001 —
 * لم يكن يقرؤه أحد.
 *
 * **هذا الملف للعرض لا للحماية.** إخفاء الزر يمنع الخطأ الشائع ويريح الشاشة،
 * لكنه لا يمنع شيئًا: من يفتح أدوات المطوّر يستطيع استدعاء Supabase مباشرةً.
 * المنع الحقيقي في سياسات RLS وفي فحوص الدوال، وهي المفروضة في القاعدة نفسها.
 * فلا يُبنى قرار أمني على `can()` وحده أبدًا.
 */

export type PermissionKey =
  | "appointments.view"
  | "appointments.create"
  | "appointments.update"
  | "appointments.cancel"
  | "appointments.reschedule"
  | "reception.check_in"
  | "reception.call"
  | "reception.start_visit"
  | "reception.finish"
  | "reception.transfer"
  | "reception.override"
  | "patients.view"
  | "patients.create"
  | "patients.update"
  | "patients.merge"
  | "blocked_contacts.manage"
  | "messages.resend"
  | "reports.reception"
  | "reports.financial"
  | "reports.insurance"
  | "reports.operational"
  | "reports.export"
  | "audit.view"
  | "audit.access_log"
  | "insurance.submit"
  | "insurance.settle"
  | "patients.view_medical"
  | "patients.view_financial"
  | "patients.view_identity"
  | "privacy.consents"
  | "privacy.retention"
  | "purchasing.view"
  | "purchasing.request"
  | "purchasing.approve"
  | "purchasing.order"
  | "purchasing.receive"
  | "purchasing.over_receive"
  | "purchasing.invoice"
  | "purchasing.return"
  | "suppliers.manage"
  | "suppliers.pay"
  | "inventory.transfer_request"
  | "inventory.transfer_approve"
  | "inventory.transfer_ship"
  | "inventory.transfer_receive"
  | "inventory.count"
  | "inventory.count_approve"
  | "inventory.settings"
  | "gl.view"
  | "gl.manual_entry"
  | "gl.post"
  | "gl.reverse"
  | "gl.close_period"
  | "gl.reopen_period"
  | "gl.rules"
  | "gl.reconcile"
  | "gl.cost_centers"
  | "hr.view"
  | "hr.manage"
  | "hr.attendance"
  | "hr.overtime_approve"
  | "hr.leave_approve"
  | "payroll.view"
  | "payroll.run"
  | "payroll.approve"
  | "payroll.pay"
  | "payroll.loans"
  | "assets.view"
  | "assets.manage"
  | "assets.maintenance"
  | "assets.calibration"
  | "assets.dispose"
  | "documents.view"
  | "documents.upload"
  | "documents.archive"
  | "documents.templates"
  | "consents.sign"
  | "consents.override"
  | "notifications.view"
  | "notifications.manage"
  | "patient_portal.view"
  | "portal.manage"
  | "portal.requests"
  | "doctor_workspace.view"
  /* الطبيب يرسل ملاحظةً عن مريضه إلى الاستقبال من مركز المتابعة (0173) */
  | "follow_up_center.send"
  /* استقبال طلبات الأطباء: الاطّلاع عليها وإقفالها (0138) */
  | "reception.requests"
  | "critical.acknowledge"
  | "critical.oversee"
  | "quality.view"
  | "quality.report"
  | "quality.investigate"
  | "quality.manage"
  | "policies.manage"
  | "users.view"
  | "users.manage"
  | "users.permissions"
  | "integrations.view"
  | "integrations.manage"
  | "integrations.retry"
  | "advanced_analytics.view"
  | "catalog.view"
  | "catalog.manage"
  | "catalog.pricing"
  | "structure.view"
  | "structure.manage"
  | "doctors.view"
  | "doctors.manage"
  | "exam_templates.view"
  | "exam_templates.manage"
  | "visits.view"
  | "visits.update"
  | "visits.sign"
  | "visits.close"
  | "visits.reopen"
  | "pharmacy.view"
  | "pharmacy.prescribe"
  | "pharmacy.dispense"
  | "pharmacy.dispense_controlled"
  | "pharmacy.cancel_dispensing"
  | "pharmacy.manage_drugs"
  | "inventory.view"
  | "inventory.manage"
  | "inventory.adjust"
  | "insurance.view"
  | "insurance.manage"
  | "insurance.contracts"
  | "insurance.preauth"
  | "insurance.claims"
  | "billing.view"
  | "billing.issue"
  | "billing.discount"
  | "billing.refund"
  | "billing.void"
  | "billing.manual_line"
  /* منح الخدمة المجانية — قرار الطبيب أو المدير (0167) */
  | "billing.complimentary"
  /* الخصم على سطر الفاتورة بسببٍ مكتوب (0167) */
  | "billing.line_discount"
  /* عرض اليوميات السابقة وسجلّها (0191) */
  | "billing.day_history"
  | "cashier.receive"
  | "cashier.open"
  | "cashier.close"
  | "cashier.approve";

export function usePermissions() {
  const { organization } = useOrganizationAccess();
  const organizationId = organization?.id;

  const query = useQuery({
    queryKey: ["my-permissions", organizationId],
    enabled: Boolean(organizationId),
    // الصلاحيات تتغيّر نادرًا، وإعادة جلبها مع كل تركيب مكوّن هدر: استعلام
    // واحد يخدم كل الشاشات عبر ذاكرة react-query المشتركة.
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_my_permissions")
        .select("permission_key, granted")
        .eq("organization_id", organizationId);
      if (error) throw error;
      const map: Record<string, boolean> = {};
      for (const row of (data ?? []) as { permission_key: string; granted: boolean }[]) {
        map[row.permission_key] = Boolean(row.granted);
      }
      return map;
    },
  });

  /**
   * أثناء التحميل تُعاد `false`.
   *
   * الاتجاه مقصود: زرٌّ يظهر ثم يختفي أسوأ من زرٍّ يتأخّر ظهوره جزءًا من
   * ثانية — الأول يجعل المستخدم يضغط ما لا يملكه فيرى رفضًا من القاعدة بلا
   * سبب مفهوم.
   */
  const can = (key: PermissionKey) => Boolean(query.data?.[key]);

  return { can, permissions: query.data ?? {}, isLoading: query.isLoading };
}
