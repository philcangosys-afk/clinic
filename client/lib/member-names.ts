import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";

/**
 * أسماء أعضاء المنشأة مفهرسةً بمعرّف المستخدم.
 *
 * الأعمدة `created_by` و`updated_by` و`sent_by_user_id` منتشرة في الجداول،
 * وعرضها معرّفاتٍ خامًا لا يفيد أحدًا. هذا الخطّاف يحوّلها إلى أسماء بقراءةٍ
 * واحدة تُخزَّن في ذاكرة react-query فلا تتكرّر مع كل صفّ.
 *
 * **مكتوبٌ هنا لا في كل شاشة:** النسخة نفسها مكرَّرة في أربع شاشات
 * (الفواتير، المخزون، ملفّ المريض، الاستقبال)، وكل نسخةٍ تفترق عن أخواتها
 * عند أوّل تعديل. الشاشات الجديدة تستعمل هذه، والقديمة تُحوَّل إليها حين
 * تُمَسّ — لا دفعةً واحدة بلا حاجة.
 */
export function useMemberNames(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["member-names", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_organization_members_directory")
        .select("user_id, display_name")
        .eq("organization_id", organizationId);
      if (error) throw error;
      return new Map(
        ((data ?? []) as { user_id: string; display_name: string }[]).map((row) => [
          row.user_id,
          row.display_name,
        ]),
      );
    },
  });
}

export default useMemberNames;
