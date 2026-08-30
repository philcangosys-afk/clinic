import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, FlaskConical, Pill, Scan, Stethoscope, Wrench } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BodyDiagramReadOnly, VIEW_LABELS, type BodyDiagramData } from "@/components/medical/BodyDiagram";

/**
 * تفاصيل زيارة بعينها: ما رُسم على اللوحات، وما نُفِّذ من خدمات، وما قيس من
 * مؤشرات، وما طُلب من تحاليل وأشعة وأدوية.
 *
 * سبب وجود هذا المكوّن: التدقيق الشامل للقطات الـ133 أثبت أن الجدولين
 * `dental_chart_entries` و`body_diagram_annotations` **للكتابة فقط** — لكلٍّ
 * منهما `.insert()` واحد في `MedicalRecords.tsx` ولا `.select()` في المشروع
 * كله. الطبيب يحدّد الأسنان ويكتب الإجراء والتخدير والمضاد الحيوي، أو يرسم
 * مواضع الآفات على مخطط الجسم، فيُحفظ كله في القاعدة ثم **لا يُعرض أبدًا**:
 * لا في الزيارة التالية، ولا في ملف المريض، ولا في أي تقرير.
 *
 * وهذا أسوأ من عدم الحفظ أصلًا: الطبيب يظن أن لديه مرجعًا للمقارنة في زيارة
 * المتابعة، فلا يجده — بينما البيانات موجودة في القاعدة طوال الوقت.
 *
 * وقد وُسِّع بعد 0056/0057 ليشمل الخدمات والمؤشرات والطلبات: فبعد أن صار
 * الطبيب يُصدر التحاليل والأشعة والوصفة من داخل الزيارة، كان لا بد أن تُقرأ
 * من داخلها أيضًا — وإلا تكرّر العيب نفسه بشكل جديد.
 *
 * لا يُعرض قسمٌ لم يُستخدم في هذه الزيارة، فلا يتضخّم سجل الزيارات ببطاقات
 * فارغة.
 */

type DentalEntry = {
  id: string;
  tooth_numbers: string[] | null;
  tooth_type: string | null;
  procedure_done: string | null;
  complications: string | null;
  anesthesia: string | null;
  prophylactic_antibiotics: string | null;
  patient_family_education: string | null;
  is_xray: boolean;
  ortho_upper: boolean;
  ortho_lower: boolean;
  full_arch: boolean;
  note: string | null;
  diagnosis: { code: string; name_ar: string | null; name_en: string } | null;
};

type DiagramEntry = {
  id: string;
  diagram_view: string;
  annotation_data: { strokes?: BodyDiagramData["strokes"] } | null;
  note: string | null;
};

const TOOTH_TYPE_LABELS: Record<string, string> = {
  permanent: "دائمة",
  primary: "لبنية",
};

const LAB_STATUS_LABELS: Record<string, string> = {
  ordered: "مطلوب",
  specimen_collected: "سُحبت العيّنة",
  in_progress: "قيد التنفيذ",
  completed: "مكتمل",
  verified: "معتمَد",
  cancelled: "ملغى",
};

const RAD_STATUS_LABELS: Record<string, string> = {
  ordered: "مطلوب",
  scheduled: "مجدول",
  in_progress: "قيد التنفيذ",
  completed: "مكتمل",
  reported: "صدر التقرير",
  cancelled: "ملغى",
};

const RX_STATUS_LABELS: Record<string, string> = {
  draft: "مسودة",
  issued: "صادرة",
  partially_dispensed: "صُرفت جزئيًا",
  dispensed: "صُرفت",
  cancelled: "ملغاة",
};

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value || !value.trim()) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

function SectionCard({
  icon,
  title,
  badges,
  children,
}: {
  icon: ReactNode;
  title: string;
  badges?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {icon}
        <span className="text-sm font-medium">{title}</span>
        {badges}
      </div>
      {children}
    </div>
  );
}

export default function VisitCanvasDetail({ visitId }: { visitId: string }) {
  const dental = useQuery({
    queryKey: ["visit-dental-chart", visitId],
    enabled: Boolean(visitId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dental_chart_entries")
        .select(
          "id, tooth_numbers, tooth_type, procedure_done, complications, anesthesia, prophylactic_antibiotics, patient_family_education, is_xray, ortho_upper, ortho_lower, full_arch, note, diagnosis:icd10_codes(code, name_ar, name_en)",
        )
        // الزيارة تنتمي لمنشأة واحدة، والوصول إليها محكوم بسياسة الزيارة نفسها
        .eq("visit_id", visitId);
      if (error) throw error;
      return (data ?? []) as unknown as DentalEntry[];
    },
  });

  const diagram = useQuery({
    queryKey: ["visit-body-diagram", visitId],
    enabled: Boolean(visitId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("body_diagram_annotations")
        .select("id, diagram_view, annotation_data, note")
        .eq("visit_id", visitId);
      if (error) throw error;
      return (data ?? []) as unknown as DiagramEntry[];
    },
  });

  /**
   * الخدمات المنفَّذة. تلميح القيد `!visit_services_item_tenant_fk` إلزامي:
   * بين `patient_visit_services` و`items` قيدان أجنبيان (المعرّف المفرد من
   * 0053 وقيد عزل المنشآت المركّب)، وبدون التلميح يرفض PostgREST الاستعلام
   * بـPGRST201 «أكثر من علاقة ممكنة» — وهو خطأ لا يظهر إلا وقت التشغيل.
   */
  const services = useQuery({
    queryKey: ["visit-services-detail", visitId],
    enabled: Boolean(visitId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_visit_services")
        .select("id, qty, unit_price, note, item:items!visit_services_item_tenant_fk(name_ar)")
        .eq("visit_id", visitId)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const vitals = useQuery({
    queryKey: ["visit-vitals-detail", visitId],
    enabled: Boolean(visitId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_vital_signs")
        .select(
          "id, heart_rate, blood_pressure_systolic, blood_pressure_diastolic, temperature_celsius, glucose_level, height_cm, weight_kg, bmi",
        )
        .eq("visit_id", visitId)
        .maybeSingle();
      if (error) throw error;
      return data as any | null;
    },
  });

  const labOrders = useQuery({
    queryKey: ["visit-lab-orders-detail", visitId],
    enabled: Boolean(visitId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lab_orders")
        .select(
          "id, status, priority, sales_invoice_id, lab_order_items(id, result_value, is_abnormal, is_critical, lab_test:lab_tests(name_ar, unit))",
        )
        .eq("visit_id", visitId);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const radOrders = useQuery({
    queryKey: ["visit-rad-orders-detail", visitId],
    enabled: Boolean(visitId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("radiology_orders")
        .select(
          "id, status, priority, sales_invoice_id, clinical_indication, radiology_order_items(id, findings, impression, is_urgent_finding, radiology_exam:radiology_exams(name_ar, modality))",
        )
        .eq("visit_id", visitId);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const prescriptions = useQuery({
    queryKey: ["visit-prescriptions-detail", visitId],
    enabled: Boolean(visitId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prescriptions")
        .select(
          "id, status, is_billed, notes, prescription_items(id, dosage_instructions, frequency, duration_days, quantity_prescribed, dispensed_quantity, is_substitutable, drug:items(name_ar))",
        )
        .eq("visit_id", visitId);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const loading =
    dental.isLoading ||
    diagram.isLoading ||
    services.isLoading ||
    vitals.isLoading ||
    labOrders.isLoading ||
    radOrders.isLoading ||
    prescriptions.isLoading;
  if (loading) return <Skeleton className="h-16 w-full" />;

  const dentalRows = dental.data ?? [];
  const diagramRows = diagram.data ?? [];
  const serviceRows = services.data ?? [];
  const vitalsRow = vitals.data ?? null;
  const labRows = labOrders.data ?? [];
  const radRows = radOrders.data ?? [];
  const rxRows = prescriptions.data ?? [];

  const hasVitals =
    vitalsRow &&
    [
      vitalsRow.heart_rate,
      vitalsRow.blood_pressure_systolic,
      vitalsRow.temperature_celsius,
      vitalsRow.glucose_level,
      vitalsRow.height_cm,
      vitalsRow.weight_kg,
    ].some((value) => value !== null && value !== undefined);

  if (
    dentalRows.length === 0 &&
    diagramRows.length === 0 &&
    serviceRows.length === 0 &&
    !hasVitals &&
    labRows.length === 0 &&
    radRows.length === 0 &&
    rxRows.length === 0
  ) {
    return null;
  }

  const num = (value: unknown) => (value === null || value === undefined ? null : String(value));

  return (
    <div className="flex flex-col gap-3">
      {hasVitals && (
        <SectionCard
          icon={<Activity className="h-3.5 w-3.5 text-muted-foreground" />}
          title="المؤشرات الحيوية"
        >
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <Field label="النبض" value={num(vitalsRow.heart_rate)} />
            <Field
              label="ضغط الدم"
              value={
                vitalsRow.blood_pressure_systolic
                  ? `${vitalsRow.blood_pressure_systolic}/${vitalsRow.blood_pressure_diastolic ?? "—"}`
                  : null
              }
            />
            <Field label="الحرارة (°م)" value={num(vitalsRow.temperature_celsius)} />
            <Field label="السكر" value={num(vitalsRow.glucose_level)} />
            <Field label="الطول (سم)" value={num(vitalsRow.height_cm)} />
            <Field label="الوزن (كجم)" value={num(vitalsRow.weight_kg)} />
            <Field label="كتلة الجسم" value={num(vitalsRow.bmi)} />
          </div>
        </SectionCard>
      )}

      {serviceRows.length > 0 && (
        <SectionCard
          icon={<Wrench className="h-3.5 w-3.5 text-muted-foreground" />}
          title="الخدمات المنفَّذة"
          badges={<Badge variant="outline" className="text-[10px]">{serviceRows.length}</Badge>}
        >
          <div className="flex flex-col gap-1">
            {serviceRows.map((row) => {
              const item = Array.isArray(row.item) ? row.item[0] : row.item;
              return (
                <div key={row.id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{item?.name_ar ?? "صنف محذوف"}</span>
                  <span className="text-xs text-muted-foreground">
                    {Number(row.qty)} ×{" "}
                    {row.unit_price === null ? "—" : Number(row.unit_price).toLocaleString("ar-SA")}
                  </span>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {labRows.map((order) => (
        <SectionCard
          key={order.id}
          icon={<FlaskConical className="h-3.5 w-3.5 text-muted-foreground" />}
          title="طلب مختبر"
          badges={
            <>
              <Badge variant="outline" className="text-[10px]">
                {LAB_STATUS_LABELS[order.status] ?? order.status}
              </Badge>
              {order.priority !== "routine" && (
                <Badge variant="destructive" className="text-[10px]">
                  {order.priority === "stat" ? "فوري" : "عاجل"}
                </Badge>
              )}
              <Badge variant={order.sales_invoice_id ? "success" : "secondary"} className="text-[10px]">
                {order.sales_invoice_id ? "مفوتر" : "غير مفوتر"}
              </Badge>
            </>
          }
        >
          <div className="flex flex-col gap-1">
            {(order.lab_order_items ?? []).map((item: any) => {
              const test = Array.isArray(item.lab_test) ? item.lab_test[0] : item.lab_test;
              return (
                <div key={item.id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{test?.name_ar ?? "فحص"}</span>
                  {item.result_value ? (
                    <span
                      className={
                        item.is_critical
                          ? "text-xs font-medium text-destructive"
                          : item.is_abnormal
                            ? "text-xs font-medium text-amber-700"
                            : "text-xs"
                      }
                    >
                      {item.result_value}
                      {test?.unit ? ` ${test.unit}` : ""}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">بانتظار النتيجة</span>
                  )}
                </div>
              );
            })}
          </div>
        </SectionCard>
      ))}

      {radRows.map((order) => (
        <SectionCard
          key={order.id}
          icon={<Scan className="h-3.5 w-3.5 text-muted-foreground" />}
          title="طلب أشعة"
          badges={
            <>
              <Badge variant="outline" className="text-[10px]">
                {RAD_STATUS_LABELS[order.status] ?? order.status}
              </Badge>
              <Badge variant={order.sales_invoice_id ? "success" : "secondary"} className="text-[10px]">
                {order.sales_invoice_id ? "مفوتر" : "غير مفوتر"}
              </Badge>
            </>
          }
        >
          <Field label="السبب السريري" value={order.clinical_indication} />
          <div className="mt-1 flex flex-col gap-1.5">
            {(order.radiology_order_items ?? []).map((item: any) => {
              const exam = Array.isArray(item.radiology_exam) ? item.radiology_exam[0] : item.radiology_exam;
              return (
                <div key={item.id} className="rounded-md border bg-background p-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{exam?.name_ar ?? "فحص"}</span>
                    {item.is_urgent_finding && (
                      <Badge variant="destructive" className="text-[10px]">
                        موجودة عاجلة
                      </Badge>
                    )}
                  </div>
                  <Field label="الموجودات" value={item.findings} />
                  <Field label="الانطباع" value={item.impression} />
                </div>
              );
            })}
          </div>
        </SectionCard>
      ))}

      {rxRows.map((rx) => (
        <SectionCard
          key={rx.id}
          icon={<Pill className="h-3.5 w-3.5 text-muted-foreground" />}
          title="الوصفة الطبية"
          badges={
            <>
              <Badge variant="outline" className="text-[10px]">
                {RX_STATUS_LABELS[rx.status] ?? rx.status}
              </Badge>
              <Badge variant={rx.is_billed ? "success" : "secondary"} className="text-[10px]">
                {rx.is_billed ? "مفوترة" : "غير مفوترة"}
              </Badge>
            </>
          }
        >
          <div className="flex flex-col gap-1">
            {(rx.prescription_items ?? []).map((item: any) => {
              const drug = Array.isArray(item.drug) ? item.drug[0] : item.drug;
              const parts = [
                item.dosage_instructions,
                item.frequency,
                item.duration_days ? `${item.duration_days} يوم` : null,
              ].filter(Boolean);
              return (
                <div key={item.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{drug?.name_ar ?? "دواء"}</span>
                  {parts.length > 0 && (
                    <span className="text-xs text-muted-foreground">{parts.join(" — ")}</span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    صُرف {Number(item.dispensed_quantity)} من {Number(item.quantity_prescribed)}
                  </span>
                  {item.is_substitutable === false && (
                    <Badge variant="destructive" className="text-[10px]">
                      لا يُستبدل
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
          <Field label="ملاحظات" value={rx.notes} />
        </SectionCard>
      ))}

      {dentalRows.map((entry) => (
        <div key={entry.id} className="rounded-lg border bg-muted/20 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Stethoscope className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm font-medium">لوحة الأسنان</span>
            {entry.tooth_type && (
              <Badge variant="outline" className="text-[10px]">
                {TOOTH_TYPE_LABELS[entry.tooth_type] ?? entry.tooth_type}
              </Badge>
            )}
            {entry.is_xray && <Badge variant="secondary" className="text-[10px]">أشعة</Badge>}
            {entry.full_arch && <Badge variant="secondary" className="text-[10px]">القوس كامل</Badge>}
            {entry.ortho_upper && <Badge variant="secondary" className="text-[10px]">تقويم علوي</Badge>}
            {entry.ortho_lower && <Badge variant="secondary" className="text-[10px]">تقويم سفلي</Badge>}
          </div>

          {(entry.tooth_numbers ?? []).length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {(entry.tooth_numbers ?? []).map((tooth) => (
                <Badge key={tooth} className="font-mono text-[10px]">
                  {tooth}
                </Badge>
              ))}
            </div>
          )}

          {entry.diagnosis && (
            <div className="mb-2 text-xs">
              <span className="text-muted-foreground">التشخيص: </span>
              <span className="font-mono">{entry.diagnosis.code}</span>
              <span> — {entry.diagnosis.name_ar ?? entry.diagnosis.name_en}</span>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="الإجراء المنفَّذ" value={entry.procedure_done} />
            <Field label="التخدير" value={entry.anesthesia} />
            <Field label="المضاد الحيوي الوقائي" value={entry.prophylactic_antibiotics} />
            <Field label="المضاعفات" value={entry.complications} />
            <Field label="توعية المريض والأسرة" value={entry.patient_family_education} />
            <Field label="ملاحظة" value={entry.note} />
          </div>
        </div>
      ))}

      {diagramRows.map((entry) => {
        const strokes = entry.annotation_data?.strokes ?? [];
        return (
          <div key={entry.id} className="rounded-lg border bg-muted/20 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Activity className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm font-medium">مخطط الجسم</span>
              <Badge variant="outline" className="text-[10px]">
                {VIEW_LABELS[entry.diagram_view as keyof typeof VIEW_LABELS] ?? entry.diagram_view}
              </Badge>
              <span className="text-[10px] text-muted-foreground">{strokes.length} علامة</span>
            </div>
            <BodyDiagramReadOnly
              value={{
                view: (entry.diagram_view as BodyDiagramData["view"]) ?? "front",
                strokes,
              }}
            />
            <Field label="ملاحظة" value={entry.note} />
          </div>
        );
      })}
    </div>
  );
}
