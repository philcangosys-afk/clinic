import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { useSessionDoctor } from "@/lib/session-doctor";

/**
 * هل المريض من مرضى الطبيب الداخل؟ (0218)
 *
 * «مريض الطبيب» كما في `v_doctor_patients` (0164): طبيبه المعالج، أو شارك
 * في علاجه، أو له معه موعدٌ أو زيارة. الطبيب يرى أشعة مرضاه وصورهم كلّها —
 * ولو طلبها زميل — ولا يرى أشعة مريضٍ ليس عنده.
 *
 * لغير الطبيب (الاستقبال، الإدارة، قسم الأشعة) لا حصر: `allowed` صحيحة دائمًا.
 */
export function useIsMyPatient(patientId: string | null | undefined) {
  const { doctorId, isDoctorScope, resolving } = useSessionDoctor();

  const query = useQuery({
    queryKey: ["is-my-patient", doctorId, patientId],
    enabled: isDoctorScope && Boolean(doctorId && patientId),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_doctor_patients")
        .select("id")
        .eq("doctor_id", doctorId!)
        .eq("id", patientId!)
        .limit(1);
      if (error) throw error;
      return (data ?? []).length > 0;
    },
  });

  if (!isDoctorScope) return { allowed: true, checking: false };
  return { allowed: query.data === true, checking: resolving || query.isLoading };
}

/** من مجموعة مرضى: من منهم من مرضى الطبيب الداخل؟ (`null` = لا حصر) */
export async function filterMyPatientIds(doctorId: string, patientIds: string[]): Promise<Set<string>> {
  const unique = Array.from(new Set(patientIds.filter(Boolean)));
  const mine = new Set<string>();
  for (let start = 0; start < unique.length; start += 200) {
    const { data, error } = await supabase
      .from("v_doctor_patients")
      .select("id")
      .eq("doctor_id", doctorId)
      .in("id", unique.slice(start, start + 200));
    if (error) throw error;
    for (const row of (data ?? []) as { id: string }[]) mine.add(row.id);
  }
  return mine;
}
