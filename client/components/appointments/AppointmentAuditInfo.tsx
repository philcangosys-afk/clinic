import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Info } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useMemberNames } from "@/lib/member-names";
import { formatDateTime, useLocaleSettings } from "@/lib/locale";
import { errorMessage } from "@/lib/error-message";

/**
 * «اضغط هنا لتفاصيل أكثر» في نموذج موعد Kizen — للقراءة: من أنشأ الموعد
 * ومتى، ومن عدّله آخر مرّة ومتى، ومن أكّده ومتى، وجنس المريض. الأعمدة من
 * 0197 (`updated_by`، `confirmed_at`، `confirmed_by`) يملؤها مُحفِّزٌ في القاعدة.
 */
type AuditRow = {
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  overlap_overridden_by: string | null;
  overlap_overridden_at: string | null;
  series_id: string | null;
  patient: { gender: string | null } | null;
};

export default function AppointmentAuditInfo({
  organizationId,
  appointmentId,
}: {
  organizationId: string | undefined;
  appointmentId: string;
}) {
  const [open, setOpen] = useState(false);
  const { calendarDisplay } = useLocaleSettings();
  const memberNames = useMemberNames(organizationId);
  const row = useQuery({
    queryKey: ["appointment-audit-info", appointmentId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select(
          "created_by, created_at, updated_by, updated_at, confirmed_by, confirmed_at, overlap_overridden_by, " +
            "overlap_overridden_at, series_id, patient:patients!appointments_patient_tenant_fk(gender)",
        )
        .eq("id", appointmentId)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as AuditRow | null;
    },
  });

  const who = (id: string | null) => (id ? memberNames.data?.get(id) ?? "مستخدم غير معروف" : "—");
  const when = (value: string | null) => (value ? formatDateTime(value, calendarDisplay) : "—");
  const data = row.data;

  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs text-muted-foreground hover:bg-muted/40"
      >
        <span className="flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5" />
          تفاصيل أكثر: من أنشأ الموعد ومن عدّله ومن أكّده
        </span>
        <ChevronDown className={`h-3.5 w-3.5 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="grid gap-x-4 gap-y-1 border-t px-3 py-2 text-xs sm:grid-cols-2">
          {row.isLoading && <span>جارٍ القراءة…</span>}
          {row.isError && <span className="text-destructive">{errorMessage(row.error)}</span>}
          {data && (
            <>
              <span>
                <b>أنشأه:</b> {who(data.created_by)} · {when(data.created_at)}
              </span>
              <span>
                <b>آخر تعديل:</b> {data.updated_by ? `${who(data.updated_by)} · ${when(data.updated_at)}` : "لم يُعدَّل بعد إنشائه"}
              </span>
              <span>
                <b>تأكيد الموعد:</b> {data.confirmed_at ? `${who(data.confirmed_by)} · ${when(data.confirmed_at)}` : "غير مؤكَّد"}
              </span>
              <span>
                <b>الجنس:</b> {data.patient?.gender === "male" ? "ذكر" : data.patient?.gender === "female" ? "أنثى" : "—"}
              </span>
              {data.overlap_overridden_at && (
                <span className="sm:col-span-2">
                  <b>حُجز رغم التعارض:</b> {who(data.overlap_overridden_by)} · {when(data.overlap_overridden_at)}
                </span>
              )}
              {data.series_id && <span className="sm:col-span-2">ضمن مواعيد متكرّرة حُجزت معًا.</span>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
