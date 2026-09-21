import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/**
 * تحديثٌ فوريّ لما يقرأ المواعيد (0175).
 *
 * ما يضغطه الطبيب («دخل»، «خرج») يظهر في لوحة الاستقبال خلال ثانية، وما
 * يضغطه الاستقبال («وصل»، «نداء») يظهر في قائمة الطبيب — بلا انتظار دورة
 * التحديث. والدورة تبقى احتياطًا إن انقطع البثّ أو لم يُفعَّل النشر.
 *
 * يُبطل المفاتيح المعطاة كما هي، فكلّ شاشةٍ تسمّي ما تعرضه هي.
 */
export function useAppointmentsLive(
  organizationId: string | null | undefined,
  queryKeys: readonly (readonly unknown[])[],
  channelName: string,
) {
  const queryClient = useQueryClient();
  // المفاتيح مصفوفةٌ جديدة في كلّ تصيير؛ نصّها ثابتٌ فيُستعمل للمقارنة
  const keysSignature = JSON.stringify(queryKeys);

  useEffect(() => {
    if (!organizationId) return;
    const keys = JSON.parse(keysSignature) as unknown[][];
    const refresh = () => keys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
    const channel = supabase
      .channel(`${channelName}-${organizationId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "appointments", filter: `organization_id=eq.${organizationId}` },
        refresh,
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [organizationId, keysSignature, channelName, queryClient]);
}
