import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Stethoscope, Download, ChevronDown, ChevronLeft } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { localDayRange } from "@/lib/date-range";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import VisitCanvasDetail from "@/components/medical/VisitCanvasDetail";

/**
 * سجل زيارات المرضى على مستوى المنشأة (لقطة 32).
 *
 * جدول `patient_visits` موجود منذ 0006 وتقرؤه شاشة السجلات الطبية، لكن
 * قراءتها **لمريض واحد في كل مرة**. المواصفة تطلب سجلًا عرضيًا لكل الزيارات
 * — من يسأل "كم زيارة أجراها د. أحمد أمس؟" أو "من سجّل هذه الزيارة؟" لم يكن
 * يجد أين يسأل. هذه الشاشة قراءة فقط: التعديل يبقى في مكانه الطبيعي داخل
 * ملف المريض، حتى لا يوجد مسار ثانٍ لتحرير سجل طبي.
 */
type VisitRow = {
  id: string;
  visit_date: string;
  main_complaint: string | null;
  notes: string | null;
  next_visit_plan: string | null;
  canvas_type: string;
  created_by: string | null;
  patient: { id: string; name_ar: string; file_number: number | null } | null;
  doctor: { name_ar: string } | null;
  clinic: { name: string } | null;
  patient_visit_diagnoses: { icd10_code_id: string }[];
};

function useVisits(
  organizationId: string | undefined,
  doctorId: string,
  dateFrom: string,
  dateTo: string,
  search: string,
) {
  return useQuery({
    queryKey: ["patient-visits-log", organizationId, doctorId, dateFrom, dateTo, search],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let query = supabase
        .from("patient_visits")
        .select(
          "id, visit_date, main_complaint, notes, next_visit_plan, canvas_type, created_by, patient:patients!patient_visits_patient_tenant_fk(id, name_ar, file_number), doctor:doctors!patient_visits_doctor_tenant_fk(name_ar), clinic:clinics!patient_visits_clinic_tenant_fk(name), patient_visit_diagnoses(icd10_code_id)",
        )
        .eq("organization_id", organizationId)
        .order("visit_date", { ascending: false })
        .limit(500);
      if (doctorId !== "all") query = query.eq("doctor_id", doctorId);
      // الحدود تُحسب بتوقيت المتصفح ثم تُحوَّل للحظة مطلقة — انظر التعليق في
      // date-range.ts: النص بلا إزاحة كان يُفسَّر بتوقيت الخادم فتختفي زيارات
      // اليوم نفسه من نتيجته.
      const bounds = localDayRange(dateFrom, dateTo);
      if (bounds.from) query = query.gte("visit_date", bounds.from);
      if (bounds.to) query = query.lte("visit_date", bounds.to);
      if (search.trim()) query = query.ilike("main_complaint", `%${search.trim()}%`);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as VisitRow[];
    },
  });
}

function useDoctors(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["visits-doctors", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar")
        .eq("organization_id", organizationId)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });
}

/** أسماء من سجّل الزيارة — من دليل الأعضاء لا من auth.users (0026). */
function useMemberNames(organizationId: string | undefined) {
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

const CANVAS_LABELS: Record<string, string> = {
  dental_chart: "لوحة أسنان",
  body_diagram: "مخطط جسم",
  none: "—",
};

function exportCsv(rows: VisitRow[], memberNames: Map<string, string> | undefined) {
  const headers = ["التاريخ", "المريض", "#الملف", "الطبيب", "العيادة", "الشكوى", "عدد التشخيصات", "سجّلها"];
  const escape = (value: string | number | null | undefined) =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      [
        new Date(row.visit_date).toLocaleString("ar-SA"),
        row.patient?.name_ar,
        row.patient?.file_number,
        row.doctor?.name_ar,
        row.clinic?.name,
        row.main_complaint,
        (row.patient_visit_diagnoses ?? []).length,
        row.created_by ? memberNames?.get(row.created_by) ?? "" : "",
      ]
        .map(escape)
        .join(","),
    ),
  ];
  // BOM حتى تفتح إكسل الملف بترميز عربي صحيح
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `patient-visits-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function PatientVisits() {
  const { organization } = useOrganizationAccess();
  const [doctorId, setDoctorId] = useState("all");
  // الزيارة المفتوحة لعرض لوحة الأسنان/مخطط الجسم المحفوظَين
  const [expandedVisitId, setExpandedVisitId] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const visits = useVisits(organization?.id, doctorId, dateFrom, dateTo, search);
  const doctors = useDoctors(organization?.id);
  const memberNames = useMemberNames(organization?.id);

  const rows = visits.data ?? [];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">سجل زيارات المرضى</h1>
        <p className="text-sm text-muted-foreground">
          كل الزيارات المسجَّلة في المنشأة — عرض فقط، والتعديل يبقى داخل ملف المريض
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Stethoscope className="h-4 w-4" />
            آخر 500 زيارة
          </CardTitle>
          <CardDescription>يمكن التصفية بالطبيب والفترة والبحث في الشكوى الرئيسية</CardDescription>
          <div className="mt-2 flex flex-wrap gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث في الشكوى..."
              className="max-w-xs"
            />
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="كل الأطباء" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأطباء</SelectItem>
                {(doctors.data ?? []).map((doctor) => (
                  <SelectItem key={doctor.id} value={doctor.id}>
                    {doctor.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-40"
              title="من تاريخ"
            />
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-40"
              title="إلى تاريخ"
            />
            <Button
              variant="outline"
              disabled={rows.length === 0}
              onClick={() => exportCsv(rows, memberNames.data)}
            >
              <Download className="h-4 w-4" />
              تصدير CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {visits.isLoading && <Skeleton className="h-40 w-full" />}
          {!visits.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>المريض</TableHead>
                  <TableHead>#الملف</TableHead>
                  <TableHead>الطبيب</TableHead>
                  <TableHead>العيادة</TableHead>
                  <TableHead>الشكوى الرئيسية</TableHead>
                  <TableHead>التشخيصات</TableHead>
                  <TableHead>الرسم</TableHead>
                  <TableHead>سجّلها</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const patient = Array.isArray(row.patient) ? row.patient[0] : row.patient;
                  const doctor = Array.isArray(row.doctor) ? row.doctor[0] : row.doctor;
                  const clinic = Array.isArray(row.clinic) ? row.clinic[0] : row.clinic;
                  const isExpanded = expandedVisitId === row.id;
                  return (
                    <Fragment key={row.id}>
                    <TableRow>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(row.visit_date).toLocaleString("ar-SA")}
                      </TableCell>
                      <TableCell className="font-medium">{patient?.name_ar ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{patient?.file_number ?? "—"}</TableCell>
                      <TableCell className="text-sm">{doctor?.name_ar ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{clinic?.name ?? "—"}</TableCell>
                      <TableCell className="max-w-xs truncate text-sm">{row.main_complaint ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">
                        {(row.patient_visit_diagnoses ?? []).length}
                      </TableCell>
                      <TableCell>
                        {row.canvas_type === "none" ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <Badge variant="secondary">{CANVAS_LABELS[row.canvas_type] ?? row.canvas_type}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.created_by ? memberNames.data?.get(row.created_by) ?? "—" : "—"}
                      </TableCell>
                      <TableCell>
                        {/* الرسم كان يُحفظ ولا يُعرض — هذا الزر يفتح ما حُفظ فعلًا */}
                        {row.canvas_type !== "none" && (
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
                        )}
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow>
                        <TableCell colSpan={10} className="bg-muted/10">
                          <VisitCanvasDetail visitId={row.id} />
                        </TableCell>
                      </TableRow>
                    )}
                    </Fragment>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد زيارات مطابقة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
