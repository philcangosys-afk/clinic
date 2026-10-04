import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, FileText, Printer, RefreshCw } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { usePermissions } from "@/lib/permissions";
import { NO_DOCTOR, useSessionDoctor } from "@/lib/session-doctor";
import { formatDate, formatDateTime, useLocaleSettings } from "@/lib/locale";
import { printHtml } from "@/lib/document-merge";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import LookupSelect from "@/components/shared/LookupSelect";
import { GridFooterCount, ScreenToolbar } from "@/components/shell/ScreenToolbar";

/**
 * التقارير الطبية — الإجازة المرضية والإحالة ونموذج الدخول والخروج والتقرير الخاصّ.
 *
 * **العيب الذي تُغلقه:** لم يكن في النظام سبيلٌ لإصدار إجازة مرضية إطلاقًا.
 * قوالب المستندات العامّة تطبع أيّ ورقة، لكنّها لا تحفظ سجلًّا: لا رقم تقرير
 * يُرجع إليه، ولا «إلى» تُعرف بها الجهة، ولا مدير طبيّ، ولا حالة تحرير. فلا
 * يُعرف بعد شهر كم إجازة صدرت ولا لمن ولا من وقّعها — والإجازة المرضية وثيقةٌ
 * تُقدَّم لجهة عمل، وقد تُراجَع.
 *
 * الترقيم والإدراج في `app_issue_medical_report` (0154) في معاملة واحدة:
 * رقمٌ يُحجز ثمّ إدراجٌ يفشل يترك فجوةً في تسلسل الوثائق الرسمية.
 *
 * **ولا حذف:** الإلغاء تعطيلٌ بسبب، والرقم يبقى — تقريرٌ ملغًى برقمه أوضح من
 * فجوةٍ لا تفسير لها.
 */

type MedicalReportRow = {
  id: string;
  report_type: "medical_leave" | "referral" | "admission_discharge" | "custom";
  report_number: number | null;
  report_date: string;
  issued_to: string | null;
  medical_director_name: string | null;
  insurance_company_name: string | null;
  diagnosis_text: string | null;
  body: string | null;
  leave_start_date: string | null;
  leave_end_date: string | null;
  leave_days: number | null;
  referral_facility: string | null;
  referral_specialty_name: string | null;
  admission_at: string | null;
  discharge_at: string | null;
  status: "draft" | "issued" | "cancelled";
  cancel_reason: string | null;
  doctor_name: string | null;
  patient_name: string;
  patient_file_number: string | null;
  created_at: string;
};

const TYPE_LABELS: Record<MedicalReportRow["report_type"], string> = {
  medical_leave: "تقرير طبي وإجازة مرضية",
  referral: "إحالة طبية",
  admission_discharge: "نموذج الدخول والخروج",
  custom: "تقرير خاص",
};

const STATUS_LABELS: Record<MedicalReportRow["status"], string> = {
  draft: "مسوّدة",
  issued: "صادر",
  cancelled: "ملغى",
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

function useDoctorsList(organizationId: string | undefined) {
  // الطبيب الداخل: نفسه وحده في القائمة (0221)
  const { doctorId: sessionDoctorId, isDoctorScope } = useSessionDoctor();
  const scopeDoctor = isDoctorScope && sessionDoctorId && sessionDoctorId !== NO_DOCTOR ? sessionDoctorId : null;
  return useQuery({
    queryKey: ["medical-report-doctors", organizationId, scopeDoctor],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let query = supabase
        .from("doctors")
        .select("id, name_ar")
        .eq("organization_id", organizationId)
        .eq("is_enabled", true);
      if (scopeDoctor) query = query.eq("id", scopeDoctor);
      const { data, error } = await query.order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });
}

export default function MedicalReportsTab({ patientId }: { patientId: string }) {
  const { organization } = useOrganizationAccess();
  const { can } = usePermissions();
  const { calendarDisplay } = useLocaleSettings();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [issueType, setIssueType] = useState<MedicalReportRow["report_type"] | null>(null);
  const [cancelFor, setCancelFor] = useState<MedicalReportRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const reports = useQuery({
    queryKey: ["medical-reports", patientId, organization?.id],
    enabled: Boolean(patientId && organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_medical_reports")
        .select("*")
        .eq("organization_id", organization!.id)
        .eq("patient_id", patientId)
        .order("report_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MedicalReportRow[];
    },
  });

  const rows = useMemo(() => reports.data ?? [], [reports.data]);
  const selected = rows.find((row) => row.id === selectedId) ?? null;
  /* الصلاحية نفسها التي تفرضها القاعدة في `app_issue_medical_report`، لا مفتاح
     جديد: زرٌّ يظهر ثمّ تردّ القاعدة عمليته أسوأ من زرٍّ غائب. */
  const canIssue = can("medical_records.write");

  const cancelReport = useMutation({
    mutationFn: async () => {
      if (!cancelFor) throw new Error("لم يُختَر تقرير");
      const { error } = await supabase.rpc("app_cancel_medical_report", {
        p_report_id: cancelFor.id,
        p_reason: cancelReason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setCancelFor(null);
      setCancelReason("");
      queryClient.invalidateQueries({ queryKey: ["medical-reports", patientId] });
      toast({ title: "أُلغي التقرير" });
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر الإلغاء", description: errorMessage(error) }),
  });

  const printReport = (report: MedicalReportRow) => {
    const line = (label: string, value: string | null | undefined) =>
      value ? `<tr><th style="text-align:start;width:9rem">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>` : "";
    const rowsHtml = [
      line("رقم التقرير", report.report_number ? String(report.report_number) : "—"),
      line("التاريخ", formatDate(report.report_date, calendarDisplay)),
      line("المريض", `${report.patient_name}${report.patient_file_number ? ` (ملف ${report.patient_file_number})` : ""}`),
      line("الطبيب", report.doctor_name),
      line("إلى", report.issued_to),
      line("المدير الطبي", report.medical_director_name),
      line("شركة التأمين", report.insurance_company_name),
      line("التشخيص", report.diagnosis_text),
      report.report_type === "medical_leave"
        ? line(
            "مدّة الإجازة",
            `من ${formatDate(report.leave_start_date, calendarDisplay)} إلى ${formatDate(
              report.leave_end_date,
              calendarDisplay,
            )} (${report.leave_days ?? "—"} يومًا)`,
          )
        : "",
      report.report_type === "referral" ? line("محال إلى", report.referral_facility) : "",
      report.report_type === "referral" ? line("التخصّص", report.referral_specialty_name) : "",
      report.report_type === "admission_discharge"
        ? line("الدخول", formatDateTime(report.admission_at, calendarDisplay))
        : "",
      report.report_type === "admission_discharge"
        ? line("الخروج", formatDateTime(report.discharge_at, calendarDisplay))
        : "",
    ].join("");

    printHtml(
      TYPE_LABELS[report.report_type],
      `<h2 style="text-align:center">${escapeHtml(organization?.name ?? "")}</h2>
       <h3 style="text-align:center">${escapeHtml(TYPE_LABELS[report.report_type])}</h3>
       ${report.status === "cancelled" ? '<p style="color:#b91c1c;font-weight:700">هذا التقرير ملغى</p>' : ""}
       <table style="width:100%;border-collapse:collapse" border="1" cellpadding="6">${rowsHtml}</table>
       ${report.body ? `<p style="white-space:pre-wrap;margin-top:1rem">${escapeHtml(report.body)}</p>` : ""}
       <p style="margin-top:3rem">التوقيع: ..............................</p>`,
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <ScreenToolbar
        items={[
          {
            key: "leave",
            label: "تقرير طبي وإجازة مرضية",
            icon: FileText,
            hidden: !canIssue,
            onClick: () => setIssueType("medical_leave"),
          },
          {
            key: "referral",
            label: "إحالة طبية",
            icon: FileText,
            hidden: !canIssue,
            onClick: () => setIssueType("referral"),
          },
          {
            key: "admission",
            label: "نموذج الدخول والخروج",
            icon: FileText,
            hidden: !canIssue,
            onClick: () => setIssueType("admission_discharge"),
          },
          {
            key: "custom",
            label: "تقرير خاص",
            icon: FileText,
            hidden: !canIssue,
            onClick: () => setIssueType("custom"),
          },
          { key: "sep1", separator: true },
          {
            key: "print",
            label: "طباعة",
            icon: Printer,
            disabled: !selected,
            title: selected ? "طباعة التقرير المختار" : "اختر تقريرًا من الجدول أوّلًا",
            onClick: () => selected && printReport(selected),
          },
          {
            key: "cancel",
            label: "إلغاء التقرير",
            icon: Ban,
            tone: "danger",
            hidden: !canIssue,
            disabled: !selected || selected.status === "cancelled",
            title: "التقرير الطبي لا يُحذف — يُلغى بسبب ويبقى رقمه",
            onClick: () => selected && setCancelFor(selected),
          },
          { key: "sep2", separator: true },
          { key: "refresh", label: "تحديث", icon: RefreshCw, onClick: () => void reports.refetch() },
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle>التقارير الطبية</CardTitle>
          <CardDescription>
            سجلّ ما صدر لهذا المريض — اختر صفًّا ليظهر نصّه كاملًا تحت الجدول
          </CardDescription>
        </CardHeader>
        <CardContent>
          {reports.isLoading && <Skeleton className="h-28 w-full" />}
          {reports.isError && (
            <p className="py-6 text-center text-sm text-destructive">
              تعذّر تحميل التقارير: {errorMessage(reports.error)}
            </p>
          )}
          {!reports.isLoading && !reports.isError && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>النوع</TableHead>
                  <TableHead>الرقم</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الطبيب</TableHead>
                  <TableHead>إلى</TableHead>
                  <TableHead>الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((report) => (
                  <TableRow
                    key={report.id}
                    onClick={() => setSelectedId(report.id)}
                    aria-selected={report.id === selectedId}
                    className={
                      report.id === selectedId ? "cursor-pointer bg-accent" : "cursor-pointer hover:bg-accent/50"
                    }
                  >
                    <TableCell className="font-medium">{TYPE_LABELS[report.report_type]}</TableCell>
                    <TableCell className="font-mono text-xs">{report.report_number ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {formatDate(report.report_date, calendarDisplay)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{report.doctor_name ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{report.issued_to ?? "—"}</TableCell>
                    <TableCell>
                      {report.status === "cancelled" ? (
                        <Badge variant="destructive">{STATUS_LABELS.cancelled}</Badge>
                      ) : report.status === "draft" ? (
                        <Badge variant="secondary">{STATUS_LABELS.draft}</Badge>
                      ) : (
                        <Badge variant="success">{STATUS_LABELS.issued}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      لم يصدر لهذا المريض تقرير طبيّ بعد.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {!reports.isLoading && !reports.isError && <GridFooterCount count={rows.length} />}
      </Card>

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {TYPE_LABELS[selected.report_type]}
              {selected.report_number ? ` #${selected.report_number}` : ""}
            </CardTitle>
            <CardDescription>
              {formatDate(selected.report_date, calendarDisplay)}
              {selected.doctor_name ? ` · ${selected.doctor_name}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {selected.status === "cancelled" && (
              <p className="rounded-md border border-destructive/40 p-2 text-destructive">
                ملغى — {selected.cancel_reason}
              </p>
            )}
            {selected.report_type === "medical_leave" && (
              <p>
                إجازة من {formatDate(selected.leave_start_date, calendarDisplay)} إلى{" "}
                {formatDate(selected.leave_end_date, calendarDisplay)} — {selected.leave_days ?? "—"} يومًا
              </p>
            )}
            {selected.report_type === "referral" && (
              <p>
                محال إلى: {selected.referral_facility ?? "—"}
                {selected.referral_specialty_name ? ` · ${selected.referral_specialty_name}` : ""}
              </p>
            )}
            {selected.report_type === "admission_discharge" && (
              <p>
                الدخول: {formatDateTime(selected.admission_at, calendarDisplay)} · الخروج:{" "}
                {formatDateTime(selected.discharge_at, calendarDisplay)}
              </p>
            )}
            {selected.diagnosis_text && <p>التشخيص: {selected.diagnosis_text}</p>}
            {selected.issued_to && <p>إلى: {selected.issued_to}</p>}
            {selected.insurance_company_name && <p>شركة التأمين: {selected.insurance_company_name}</p>}
            {selected.body && <p className="whitespace-pre-wrap">{selected.body}</p>}
          </CardContent>
        </Card>
      )}

      <IssueReportDialog
        patientId={patientId}
        reportType={issueType}
        onOpenChange={(next) => !next && setIssueType(null)}
        onIssued={(id) => {
          setSelectedId(id);
          queryClient.invalidateQueries({ queryKey: ["medical-reports", patientId] });
        }}
      />

      <Dialog open={Boolean(cancelFor)} onOpenChange={(next) => !next && setCancelFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إلغاء التقرير</DialogTitle>
            <DialogDescription>
              التقرير لا يُحذف: يبقى برقمه وحالته «ملغى» وسببه. اكتب السبب.
            </DialogDescription>
          </DialogHeader>
          <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelFor(null)}>
              تراجع
            </Button>
            <Button
              variant="destructive"
              disabled={!cancelReason.trim() || cancelReport.isPending}
              onClick={() => cancelReport.mutate()}
            >
              {cancelReport.isPending ? "جارٍ الإلغاء..." : "إلغاء التقرير"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function IssueReportDialog({
  patientId,
  reportType,
  onOpenChange,
  onIssued,
}: {
  patientId: string;
  reportType: MedicalReportRow["report_type"] | null;
  onOpenChange: (open: boolean) => void;
  onIssued: (id: string) => void;
}) {
  const { organization } = useOrganizationAccess();
  const { toast } = useToast();
  const doctors = useDoctorsList(organization?.id);

  const [doctorId, setDoctorId] = useState("");
  const [reportDate, setReportDate] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [issuedTo, setIssuedTo] = useState("");
  const [director, setDirector] = useState("");
  const [insurance, setInsurance] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [body, setBody] = useState("");
  const [leaveStart, setLeaveStart] = useState("");
  const [leaveEnd, setLeaveEnd] = useState("");
  const [facility, setFacility] = useState("");
  const [specialtyId, setSpecialtyId] = useState("");
  const [admission, setAdmission] = useState("");
  const [discharge, setDischarge] = useState("");

  const reset = () => {
    setDoctorId("");
    setReportDate(new Date().toLocaleDateString("en-CA"));
    setIssuedTo("");
    setDirector("");
    setInsurance("");
    setDiagnosis("");
    setBody("");
    setLeaveStart("");
    setLeaveEnd("");
    setFacility("");
    setSpecialtyId("");
    setAdmission("");
    setDischarge("");
  };

  /* عدد الأيام يُعرض وهو يُكتب لا بعد الحفظ: طبيبٌ يكتب تاريخين ويقصد ثلاثة
     أيام فيخرجان أربعة يجب أن يراها قبل أن يوقّع. */
  const leaveDays = useMemo(() => {
    if (!leaveStart || !leaveEnd) return null;
    const start = new Date(`${leaveStart}T00:00:00`);
    const end = new Date(`${leaveEnd}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
    return days > 0 ? days : null;
  }, [leaveStart, leaveEnd]);

  const issue = useMutation({
    mutationFn: async () => {
      if (!organization?.id || !reportType) throw new Error("لا توجد منشأة نشطة");
      const { data, error } = await supabase.rpc("app_issue_medical_report", {
        p_organization_id: organization.id,
        p_patient_id: patientId,
        p_report_type: reportType,
        p_doctor_id: doctorId || null,
        p_visit_id: null,
        p_report_date: reportDate || null,
        p_issued_to: issuedTo.trim() || null,
        p_medical_director_name: director.trim() || null,
        p_insurance_company_name: insurance.trim() || null,
        p_diagnosis_text: diagnosis.trim() || null,
        p_body: body.trim() || null,
        p_leave_start_date: leaveStart || null,
        p_leave_end_date: leaveEnd || null,
        p_referral_facility: facility.trim() || null,
        p_referral_specialty_value_id: specialtyId || null,
        p_admission_at: admission ? new Date(admission).toISOString() : null,
        p_discharge_at: discharge ? new Date(discharge).toISOString() : null,
        p_status: "issued",
      });
      if (error) throw error;
      return String(data);
    },
    onSuccess: (id) => {
      toast({ title: "صدر التقرير" });
      onIssued(id);
      reset();
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر إصدار التقرير", description: errorMessage(error) }),
  });

  const ready =
    reportType === "medical_leave"
      ? Boolean(leaveStart && leaveEnd && leaveDays)
      : reportType === "referral"
        ? Boolean(facility.trim())
        : reportType === "admission_discharge"
          ? Boolean(admission)
          : Boolean(body.trim());

  return (
    <Dialog open={Boolean(reportType)} onOpenChange={(next) => { if (!next) { reset(); } onOpenChange(next); }}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{reportType ? TYPE_LABELS[reportType] : ""}</DialogTitle>
          <DialogDescription>
            يُعطى التقرير رقمًا متسلسلًا عند الإصدار ويبقى في سجلّ المريض.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>الطبيب</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger>
                <SelectValue placeholder="اختر الطبيب" />
              </SelectTrigger>
              <SelectContent>
                {(doctors.data ?? []).map((doctor) => (
                  <SelectItem key={doctor.id} value={doctor.id}>
                    {doctor.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>تاريخ التقرير</Label>
            <Input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>إلى (الجهة)</Label>
            <Input value={issuedTo} onChange={(e) => setIssuedTo(e.target.value)} placeholder="جهة العمل، مدرسة، محكمة..." />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>المدير الطبي</Label>
            <Input value={director} onChange={(e) => setDirector(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>شركة التأمين</Label>
            <Input value={insurance} onChange={(e) => setInsurance(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>التشخيص</Label>
            <Input value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} />
          </div>

          {reportType === "medical_leave" && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label>من تاريخ *</Label>
                <Input type="date" value={leaveStart} onChange={(e) => setLeaveStart(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>إلى تاريخ *</Label>
                <Input type="date" value={leaveEnd} onChange={(e) => setLeaveEnd(e.target.value)} />
              </div>
              <p className="sm:col-span-2 text-sm text-muted-foreground">
                {leaveDays
                  ? `مدّة الإجازة: ${leaveDays} يومًا (اليومان طرفان محسوبان)`
                  : "أدخل التاريخين لتظهر المدّة."}
              </p>
            </>
          )}

          {reportType === "referral" && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label>محال إلى *</Label>
                <Input value={facility} onChange={(e) => setFacility(e.target.value)} placeholder="اسم المستشفى أو المركز" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>التخصّص</Label>
                <LookupSelect
                  categoryKey="medical_specialties"
                  value={specialtyId}
                  onChange={setSpecialtyId}
                  placeholder="بدون"
                />
              </div>
            </>
          )}

          {reportType === "admission_discharge" && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label>الدخول *</Label>
                <Input type="datetime-local" value={admission} onChange={(e) => setAdmission(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>الخروج</Label>
                <Input type="datetime-local" value={discharge} onChange={(e) => setDischarge(e.target.value)} />
              </div>
            </>
          )}

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>نصّ التقرير {reportType === "custom" ? "*" : ""}</Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={issue.isPending}>
            إلغاء
          </Button>
          <Button disabled={!ready || issue.isPending} onClick={() => issue.mutate()}>
            {issue.isPending ? "جارٍ الإصدار..." : "إصدار التقرير"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
