import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { useDemoRole } from "@/contexts/DemoRoleContext";

/**
 * هويّة الطبيب الحالي، ومتى تُحصَر الشاشات عليه.
 *
 * **العيب الذي يعالجه:** الداخل بصفة «الطبيب» كان يرى كل مرضى المنشأة وكل
 * مواعيدها — مرضى العيادات الأخرى، ومرضى زملائه، ومن لم يره قطّ. وهذا خطأ
 * في ثلاثة وجوه: سريريًّا (يفتح الملفّ الخطأ ويكتب فيه)، ومهنيًّا (السجلّ
 * الطبّي يُطَّلع عليه بعلاقة علاجية لا بعضوية منشأة)، وعمليًّا (بحثٌ يعيد
 * عشرين مطابقة لا تخصّ الباحث بحثٌ بلا معنى).
 *
 * **مصدر الهويّة اثنان بترتيب:**
 *   1. `doctors.user_id = auth.uid()` — الطبيب الحقيقي الذي يدخل بحسابه.
 *      هذا هو المصدر المعتمَد، ولا يعتمد على شيء في المتصفّح.
 *   2. طبيب المعاينة الذي اختاره المدير في شاشة الصفة — مخرجٌ للمعاينة لا
 *      بديلٌ عن الجلسة، ولذلك يأتي ثانيًا.
 *
 * **`isDoctorScope` ليست «هل هو طبيب» بل «هل يجب أن تُحصَر الشاشة».** المدير
 * الذي يعاين بعيون طبيب يجب أن يُحصَر أيضًا وإلّا فالمعاينة تكذب عليه؛
 * والطبيب الذي لم يُربط حسابه بسجلّ طبيب لا يُحصَر على «لا أحد» — يُترك على
 * حاله ويُعلَّق السبب في الشاشة، لأنّ حصره على الفراغ يمنعه من العمل.
 *
 * وهذا **حصرُ عرضٍ لا حصرُ صلاحية**: سياسات RLS فوقه كما هي. حصر القاعدة
 * نفسها على العلاقة العلاجية قرارٌ أوسع أثرًا (يمسّ الفوترة والتقارير
 * والاستقبال) ولم يُطلب.
 */
export function useSessionDoctor() {
  const { organization, session } = useOrganizationAccess();
  const { role, doctorId: previewDoctorId } = useDemoRole();
  const userId = session?.user.id;

  const linked = useQuery({
    queryKey: ["session-doctor-id", organization?.id, userId],
    enabled: Boolean(organization?.id && userId),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id")
        .eq("organization_id", organization!.id)
        .eq("user_id", userId!)
        .eq("is_enabled", true)
        .maybeSingle();
      if (error) throw error;
      return (data as { id: string } | null)?.id ?? null;
    },
  });

  const doctorId = linked.data ?? previewDoctorId ?? null;
  const isDoctorRole = role === "doctor";

  return {
    doctorId,
    /** الصفة طبيب — بصرف النظر عن نجاح تحديد هويّته. */
    isDoctorRole,
    /** تُحصَر الشاشة فعلًا: الصفة طبيب **وعُرفت هويّته**. */
    isDoctorScope: isDoctorRole && Boolean(doctorId),
    /**
     * الصفة طبيب ولم تُعرف هويّته — الشاشة تعرض الكلّ، وعليها أن تقول ذلك
     * بدل أن تصمت. الصمت هنا يجعل الطبيب يظنّ أنّ هؤلاء مرضاه.
     */
    unresolvedDoctor: isDoctorRole && !linked.isLoading && !doctorId,
    resolving: linked.isLoading,
    error: linked.error as Error | null,
  };
}

export default useSessionDoctor;
