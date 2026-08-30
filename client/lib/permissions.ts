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
  | "catalog.view"
  | "catalog.manage"
  | "catalog.pricing";

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
