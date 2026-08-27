import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  StickyNote,
  Stethoscope,
  FileText,
  ShieldCheck,
  PackageCheck,
  FlaskConical,
  Radiation,
  Pill,
  Receipt,
  UserRound,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { PatientJourneyEventRow, PatientJourneyEventType, PatientRow } from "@/lib/database.types";
import PatientPicker from "@/components/shared/PatientPicker";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type SelectedPatient = Pick<PatientRow, "id" | "name_ar" | "name_en" | "mobile_number" | "file_number">;

const EVENT_META: Record<
  PatientJourneyEventType,
  { label: string; icon: typeof CalendarClock; color: string }
> = {
  appointment: { label: "موعد", icon: CalendarClock, color: "text-blue-600 bg-blue-50 border-blue-200" },
  note: { label: "ملاحظة", icon: StickyNote, color: "text-amber-600 bg-amber-50 border-amber-200" },
  visit: { label: "زيارة", icon: Stethoscope, color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  document: { label: "مستند", icon: FileText, color: "text-slate-600 bg-slate-50 border-slate-200" },
  insurance_claim: { label: "مطالبة تأمين", icon: ShieldCheck, color: "text-purple-600 bg-purple-50 border-purple-200" },
  package_purchase: { label: "اشتراك باقة", icon: PackageCheck, color: "text-pink-600 bg-pink-50 border-pink-200" },
  lab_order: { label: "طلب مختبر", icon: FlaskConical, color: "text-cyan-600 bg-cyan-50 border-cyan-200" },
  radiology_order: { label: "طلب أشعة", icon: Radiation, color: "text-orange-600 bg-orange-50 border-orange-200" },
  prescription: { label: "وصفة طبية", icon: Pill, color: "text-rose-600 bg-rose-50 border-rose-200" },
  invoice: { label: "فاتورة", icon: Receipt, color: "text-green-600 bg-green-50 border-green-200" },
};

function useJourney(patientId: string | undefined) {
  return useQuery({
    queryKey: ["patient-journey", patientId],
    enabled: Boolean(patientId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_patient_journey")
        .select("*")
        .eq("patient_id", patientId)
        .order("event_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data as PatientJourneyEventRow[]) ?? [];
    },
  });
}

export default function PatientJourney() {
  const [patient, setPatient] = useState<SelectedPatient | null>(null);
  const journey = useJourney(patient?.id);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">رحلة المريض</h1>
        <p className="text-sm text-muted-foreground">
          خط زمني واحد يجمع كل ما حدث للمريض عبر كل الوحدات — مواعيد، زيارات، ملاحظات، مستندات، تأمين،
          باقات، مختبر، أشعة، وصفات، وفواتير — دون الحاجة لفتح كل شاشة على حدة.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">اختر المريض</CardTitle>
        </CardHeader>
        <CardContent>
          <PatientPicker onSelect={(p) => setPatient(p)} />
          {patient && (
            <div className="mt-3 flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <UserRound className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{patient.name_ar}</span>
              <span className="text-xs text-muted-foreground">
                #{patient.file_number} · {patient.mobile_number ?? "—"}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {!patient && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            ابحث عن مريض أعلاه لعرض رحلته الزمنية الكاملة.
          </CardContent>
        </Card>
      )}

      {patient && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">الخط الزمني</CardTitle>
            <CardDescription>الأحدث أولًا — حتى آخر 300 حدث</CardDescription>
          </CardHeader>
          <CardContent>
            {journey.isLoading && (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            )}
            {!journey.isLoading && (journey.data ?? []).length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">لا توجد أحداث مسجَّلة لهذا المريض بعد.</p>
            )}
            {!journey.isLoading && (journey.data ?? []).length > 0 && (
              <ol className="relative border-e-2 border-muted ps-0 pe-4">
                {(journey.data ?? []).map((event) => {
                  const meta = EVENT_META[event.event_type];
                  const Icon = meta?.icon ?? StickyNote;
                  return (
                    <li key={`${event.source_module}-${event.source_id}`} className="relative mb-4 me-[-9px]">
                      <div className="flex items-start gap-3">
                        <span
                          className={cn(
                            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 bg-background",
                            meta?.color ?? "text-muted-foreground",
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="flex-1 rounded-md border bg-card p-3 shadow-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{event.title}</span>
                              <Badge variant="secondary" className="text-[10px]">
                                {meta?.label ?? event.event_type}
                              </Badge>
                              {event.status && (
                                <Badge variant="outline" className="text-[10px]">
                                  {event.status}
                                </Badge>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {new Date(event.event_at).toLocaleString("ar-SA")}
                            </span>
                          </div>
                          {event.subtitle && (
                            <p className="mt-1 text-sm text-muted-foreground">{event.subtitle}</p>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
