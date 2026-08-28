import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Stethoscope, Pill, FileSignature, ExternalLink, ChevronDown, ChevronLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import VisitCanvasDetail from "@/components/medical/VisitCanvasDetail";

/**
 * تبويبات السياق الطبي والمالي داخل ملف المريض — الزيارات والوصفات
 * والاتفاقيات (لقطات 32 و39 و50).
 *
 * المواصفة تطلب رؤية هذه الثلاثة **في سياق المريض**، وكانت موجودة كشاشات
 * مستقلة فقط: من يفتح ملف مريض ليجيب "ما آخر وصفة صُرفت له؟" كان عليه ترك
 * الملف والذهاب لشاشة الصيدلية والبحث عن اسمه.
 *
 * **قراءة فقط عمدًا.** الإنشاء والتعديل يبقى في شاشته الأصلية: مسار كتابة
 * ثانٍ لنفس السجل يعني منطق تحقّق مكرَّرًا في موضعين، وهو أسرع طريق لاختلافهما.
 * كل تبويب ينتهي بزر يفتح الشاشة الكاملة.
 */

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-8 text-center text-sm text-muted-foreground">
        {text}
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// الزيارات والفحوصات
// ---------------------------------------------------------------------------
type VisitRow = {
  id: string;
  visit_date: string;
  main_complaint: string | null;
  next_visit_plan: string | null;
  doctor: { name_ar: string } | null;
  patient_visit_diagnoses: { icd10_code_id: string }[];
};

export function PatientVisitsTab({ patientId }: { patientId: string }) {
  // لوحة الأسنان ومخطط الجسم كانا يُحفظان ولا يُعرضان في أي مكان — يُفتحان هنا
  const [expandedVisitId, setExpandedVisitId] = useState<string | null>(null);
  const visits = useQuery({
    queryKey: ["patient-visits-context", patientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_visits")
        .select(
          "id, visit_date, main_complaint, next_visit_plan, doctor:doctors(name_ar), patient_visit_diagnoses(icd10_code_id)",
        )
        // المريض ينتمي لمنشأة واحدة، فالتقييد به يكفي لعزل المؤسسات
        .eq("patient_id", patientId)
        .order("visit_date", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as VisitRow[];
    },
  });

  const rows = visits.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Stethoscope className="h-4 w-4" />
            الزيارات والفحوصات
          </CardTitle>
          <CardDescription>آخر 50 زيارة — التسجيل والتعديل من شاشة السجلات الطبية</CardDescription>
        </div>
        <Button size="sm" variant="outline" asChild>
          <Link to="/medical-records">
            <ExternalLink className="h-3.5 w-3.5" />
            السجلات الطبية
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {visits.isLoading && <Skeleton className="h-32 w-full" />}
        {!visits.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>التاريخ</TableHead>
                <TableHead>الطبيب</TableHead>
                <TableHead>الشكوى الرئيسية</TableHead>
                <TableHead>التشخيصات</TableHead>
                <TableHead>خطة المتابعة</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const doctor = Array.isArray(row.doctor) ? row.doctor[0] : row.doctor;
                const isExpanded = expandedVisitId === row.id;
                return (
                  <Fragment key={row.id}>
                  <TableRow>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(row.visit_date).toLocaleString("ar-SA")}
                    </TableCell>
                    <TableCell className="text-sm">{doctor?.name_ar ?? "—"}</TableCell>
                    <TableCell className="max-w-xs truncate text-sm">
                      {row.main_complaint ?? "—"}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {(row.patient_visit_diagnoses ?? []).length}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                      {row.next_visit_plan ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="عرض الرسم المحفوظ"
                        onClick={() => setExpandedVisitId(isExpanded ? null : row.id)}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronLeft className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow>
                      <TableCell colSpan={6} className="bg-muted/10">
                        <VisitCanvasDetail visitId={row.id} />
                      </TableCell>
                    </TableRow>
                  )}
                  </Fragment>
                );
              })}
              {rows.length === 0 && <EmptyRow colSpan={6} text="لا توجد زيارات مسجَّلة لهذا المريض." />}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// الوصفات
// ---------------------------------------------------------------------------
type PrescriptionRow = {
  id: string;
  status: string;
  issued_at: string;
  is_billed: boolean;
  insurance_company_name: string | null;
  doctor: { name_ar: string } | null;
  prescription_items: {
    id: string;
    quantity_prescribed: number;
    dispensed_quantity: number | null;
    drug: { name_ar: string } | null;
  }[];
};

const PRESCRIPTION_STATUS: Record<string, string> = {
  draft: "مسوّدة",
  issued: "صادرة",
  partially_dispensed: "صرف جزئي",
  dispensed: "مصروفة",
  cancelled: "ملغاة",
};

export function PatientPrescriptionsTab({ patientId }: { patientId: string }) {
  const prescriptions = useQuery({
    queryKey: ["patient-prescriptions-context", patientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prescriptions")
        .select(
          "id, status, issued_at, is_billed, insurance_company_name, doctor:doctors(name_ar), prescription_items(id, quantity_prescribed, dispensed_quantity, drug:items(name_ar))",
        )
        .eq("patient_id", patientId)
        .order("issued_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as PrescriptionRow[];
    },
  });

  const rows = prescriptions.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Pill className="h-4 w-4" />
            الوصفات
          </CardTitle>
          <CardDescription>الإصدار والصرف من شاشة الصيدلية</CardDescription>
        </div>
        <Button size="sm" variant="outline" asChild>
          <Link to="/pharmacy">
            <ExternalLink className="h-3.5 w-3.5" />
            الصيدلية
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {prescriptions.isLoading && <Skeleton className="h-32 w-full" />}
        {!prescriptions.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>التاريخ</TableHead>
                <TableHead>الطبيب</TableHead>
                <TableHead>الأدوية</TableHead>
                <TableHead>المصروف</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>التأمين</TableHead>
                <TableHead>الفوترة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const doctor = Array.isArray(row.doctor) ? row.doctor[0] : row.doctor;
                const items = row.prescription_items ?? [];
                const dispensed = items.filter(
                  (line) => Number(line.dispensed_quantity ?? 0) >= Number(line.quantity_prescribed ?? 0),
                ).length;
                const names = items
                  .map((line) => {
                    const drug = Array.isArray(line.drug) ? line.drug[0] : line.drug;
                    return drug?.name_ar;
                  })
                  .filter(Boolean)
                  .join("، ");
                return (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(row.issued_at).toLocaleDateString("ar-SA")}
                    </TableCell>
                    <TableCell className="text-sm">{doctor?.name_ar ?? "—"}</TableCell>
                    <TableCell className="max-w-xs truncate text-sm">{names || "—"}</TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {dispensed} / {items.length}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          row.status === "dispensed"
                            ? "success"
                            : row.status === "cancelled"
                              ? "destructive"
                              : row.status === "partially_dispensed"
                                ? "warning"
                                : "secondary"
                        }
                      >
                        {PRESCRIPTION_STATUS[row.status] ?? row.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.insurance_company_name ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.is_billed ? "success" : "secondary"}>
                        {row.is_billed ? "مفوترة" : "غير مفوترة"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && <EmptyRow colSpan={7} text="لا توجد وصفات لهذا المريض." />}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// الاتفاقيات العلاجية
// ---------------------------------------------------------------------------
type AgreementRow = {
  id: string;
  agreement_number: number;
  agreement_date: string;
  total_amount: number;
  invoiced_amount: number;
  remaining_amount: number;
  is_disabled: boolean;
  doctor: { name_ar: string } | null;
};

export function PatientAgreementsTab({ patientId }: { patientId: string }) {
  const agreements = useQuery({
    queryKey: ["patient-agreements-context", patientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("treatment_agreements")
        .select(
          "id, agreement_number, agreement_date, total_amount, invoiced_amount, remaining_amount, is_disabled, doctor:doctors(name_ar)",
        )
        .eq("patient_id", patientId)
        .order("agreement_number", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as AgreementRow[];
    },
  });

  const rows = agreements.data ?? [];
  const money = (value: number | null | undefined) =>
    Number(value ?? 0).toLocaleString("ar-SA", { maximumFractionDigits: 2 });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <FileSignature className="h-4 w-4" />
            الاتفاقيات العلاجية
          </CardTitle>
          <CardDescription>المُفوتَر يحسبه النظام من الفواتير المرتبطة — لا يُدخَل يدويًا</CardDescription>
        </div>
        <Button size="sm" variant="outline" asChild>
          <Link to="/accounting">
            <ExternalLink className="h-3.5 w-3.5" />
            المحاسبة
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {agreements.isLoading && <Skeleton className="h-32 w-full" />}
        {!agreements.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead>الطبيب</TableHead>
                <TableHead>الإجمالي</TableHead>
                <TableHead>المُفوتَر</TableHead>
                <TableHead>المتبقي</TableHead>
                <TableHead>الحالة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const doctor = Array.isArray(row.doctor) ? row.doctor[0] : row.doctor;
                const remaining = Number(row.remaining_amount ?? 0);
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.agreement_number}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(row.agreement_date).toLocaleDateString("ar-SA")}
                    </TableCell>
                    <TableCell className="text-sm">{doctor?.name_ar ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{money(row.total_amount)}</TableCell>
                    <TableCell className="tabular-nums text-emerald-700">
                      {money(row.invoiced_amount)}
                    </TableCell>
                    {/* المتبقي السالب يعني أن المُفوتَر تجاوز الإجمالي — يُبرز
                        بلون تحذيري بدل أن يمرّ كرقم عادي. */}
                    <TableCell
                      className={`tabular-nums ${remaining < 0 ? "font-bold text-destructive" : ""}`}
                    >
                      {money(remaining)}
                      {remaining < 0 && (
                        <span className="block text-[10px]">المُفوتَر يتجاوز الاتفاقية</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.is_disabled ? "secondary" : "success"}>
                        {row.is_disabled ? "معطّلة" : "نشطة"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && <EmptyRow colSpan={7} text="لا توجد اتفاقيات علاجية لهذا المريض." />}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
