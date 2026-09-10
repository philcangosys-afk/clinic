import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BriefcaseMedical, Printer, RefreshCw } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { usePermissions } from "@/lib/permissions";
import { formatDate, useLocaleSettings } from "@/lib/locale";
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
 * الفحص الطبي المهنيّ — الشهادة الصحية وفحص العمالة الوافدة.
 *
 * **العيب الذي تُغلقه:** `occupational_exam_results` موجود في القاعدة،
 * و`v_occupational_exam_report` يقرؤه، وشاشة التقارير تعرض ذلك التقرير — وهو
 * **فارغٌ أبدًا**، لأنّ لا شاشة ولا دالّة تكتب في الجدول. تقريرٌ مبنيّ لا
 * يُملأ أسوأ من تقرير غير مبنيّ: يبدو للمالك أنّ الميزة تعمل.
 *
 * **النتيجة تُسجَّل على الزيارة لا على المريض:** القيد الفريد في القاعدة على
 * `visit_id` — فحصٌ واحد لكل زيارة. ولذلك تُعرض الزيارات وتُملأ نتيجة كلٍّ
 * منها، بدل نموذجٍ معلَّق بلا زيارة يُنتج فحوصًا لا يُعرف متى جرت.
 */

const PURPOSE_LABELS: Record<string, string> = {
  pre_employment: "ما قبل التوظيف",
  periodic: "دوريّ",
  return_to_work: "العودة للعمل",
  exit: "إنهاء الخدمة",
};

const FITNESS_LABELS: Record<string, string> = {
  fit: "لائق",
  fit_with_restrictions: "لائق مع قيود",
  unfit: "غير لائق طبيًّا",
  pending: "قيد الانتظار",
};

const FITNESS_BADGE: Record<string, "success" | "warning" | "destructive" | "secondary"> = {
  fit: "success",
  fit_with_restrictions: "warning",
  unfit: "destructive",
  pending: "secondary",
};

type VisitRow = {
  id: string;
  visit_date: string;
  status: string;
  doctor: { name_ar: string } | { name_ar: string }[] | null;
};

type ExamRow = {
  id: string;
  visit_id: string;
  exam_purpose: string;
  fitness_status: string;
  employer_value_id: string | null;
  restrictions_note: string | null;
  certificate_number: string | null;
  exam_date: string;
  next_exam_due_date: string | null;
};

function firstName(value: VisitRow["doctor"]) {
  if (!value) return null;
  return Array.isArray(value) ? (value[0]?.name_ar ?? null) : value.name_ar;
}

export default function OccupationalExamTab({ patientId }: { patientId: string }) {
  const { organization } = useOrganizationAccess();
  const { can } = usePermissions();
  const { calendarDisplay } = useLocaleSettings();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editVisit, setEditVisit] = useState<VisitRow | null>(null);

  const canWrite = can("medical_records.write");

  const visits = useQuery({
    queryKey: ["occupational-visits", patientId, organization?.id],
    enabled: Boolean(patientId && organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_visits")
        // المفتاح المركّب يُنشئ علاقتين، فيُحدَّد القيد صراحةً وإلّا رُدّ الطلب بـPGRST201
        .select("id, visit_date, status, doctor:doctors!patient_visits_doctor_tenant_fk(name_ar)")
        .eq("organization_id", organization!.id)
        .eq("patient_id", patientId)
        .order("visit_date", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as VisitRow[];
    },
  });

  const exams = useQuery({
    queryKey: ["occupational-exams", patientId, organization?.id],
    enabled: Boolean(patientId && organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("occupational_exam_results")
        .select(
          "id, visit_id, exam_purpose, fitness_status, employer_value_id, restrictions_note, certificate_number, exam_date, next_exam_due_date",
        )
        .eq("organization_id", organization!.id)
        .eq("patient_id", patientId);
      if (error) throw error;
      return (data ?? []) as ExamRow[];
    },
  });

  const byVisit = useMemo(() => {
    const map = new Map<string, ExamRow>();
    for (const exam of exams.data ?? []) map.set(exam.visit_id, exam);
    return map;
  }, [exams.data]);

  const rows = visits.data ?? [];
  const loading = visits.isLoading || exams.isLoading;
  const failed = visits.isError || exams.isError;

  const printCertificate = (visit: VisitRow, exam: ExamRow) => {
    printHtml(
      "الشهادة الصحية",
      `<h2 style="text-align:center">${organization?.name ?? ""}</h2>
       <h3 style="text-align:center">نتيجة الفحص الطبي المهنيّ</h3>
       <table style="width:100%;border-collapse:collapse" border="1" cellpadding="6">
         <tr><th style="text-align:start">رقم الشهادة</th><td>${exam.certificate_number ?? "—"}</td></tr>
         <tr><th style="text-align:start">تاريخ الفحص</th><td>${formatDate(exam.exam_date, calendarDisplay)}</td></tr>
         <tr><th style="text-align:start">غرض الفحص</th><td>${PURPOSE_LABELS[exam.exam_purpose] ?? exam.exam_purpose}</td></tr>
         <tr><th style="text-align:start">النتيجة</th><td>${FITNESS_LABELS[exam.fitness_status] ?? exam.fitness_status}</td></tr>
         <tr><th style="text-align:start">القيود</th><td>${exam.restrictions_note ?? "—"}</td></tr>
         <tr><th style="text-align:start">الفحص القادم</th><td>${formatDate(exam.next_exam_due_date, calendarDisplay)}</td></tr>
         <tr><th style="text-align:start">الطبيب</th><td>${firstName(visit.doctor) ?? "—"}</td></tr>
       </table>
       <p style="margin-top:3rem">التوقيع: ..............................</p>`,
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <ScreenToolbar
        items={[
          {
            key: "refresh",
            label: "تحديث",
            icon: RefreshCw,
            onClick: () => {
              void visits.refetch();
              void exams.refetch();
            },
          },
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle>الفحص الطبي المهنيّ</CardTitle>
          <CardDescription>
            نتيجة واحدة لكل زيارة — سجّلها على الزيارة التي جرى فيها الفحص. النتائج تغذّي تقرير
            الفحص المهنيّ في مركز التقارير.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading && <Skeleton className="h-28 w-full" />}
          {failed && (
            <p className="py-6 text-center text-sm text-destructive">
              تعذّر التحميل: {errorMessage(visits.error ?? exams.error)}
            </p>
          )}
          {!loading && !failed && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>تاريخ الزيارة</TableHead>
                  <TableHead>الطبيب</TableHead>
                  <TableHead>غرض الفحص</TableHead>
                  <TableHead>النتيجة</TableHead>
                  <TableHead>رقم الشهادة</TableHead>
                  <TableHead>الفحص القادم</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((visit) => {
                  const exam = byVisit.get(visit.id);
                  return (
                    <TableRow key={visit.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {formatDate(visit.visit_date, calendarDisplay)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {firstName(visit.doctor) ?? "—"}
                      </TableCell>
                      <TableCell>{exam ? (PURPOSE_LABELS[exam.exam_purpose] ?? exam.exam_purpose) : "—"}</TableCell>
                      <TableCell>
                        {exam ? (
                          <Badge variant={FITNESS_BADGE[exam.fitness_status] ?? "secondary"}>
                            {FITNESS_LABELS[exam.fitness_status] ?? exam.fitness_status}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">لم يُسجَّل</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{exam?.certificate_number ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {formatDate(exam?.next_exam_due_date, calendarDisplay)}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {canWrite && (
                            <Button size="sm" variant="ghost" onClick={() => setEditVisit(visit)}>
                              <BriefcaseMedical className="h-3.5 w-3.5" />
                              {exam ? "تعديل النتيجة" : "تسجيل النتيجة"}
                            </Button>
                          )}
                          {exam && (
                            <Button size="sm" variant="outline" onClick={() => printCertificate(visit, exam)}>
                              <Printer className="h-3.5 w-3.5" />
                              طباعة
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      لا زيارات لهذا المريض بعد — الفحص المهنيّ يُسجَّل على زيارة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {!loading && !failed && <GridFooterCount count={rows.length} />}
      </Card>

      <ExamDialog
        patientId={patientId}
        visit={editVisit}
        existing={editVisit ? (byVisit.get(editVisit.id) ?? null) : null}
        onOpenChange={(next) => !next && setEditVisit(null)}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ["occupational-exams", patientId] });
          toast({ title: "حُفظت نتيجة الفحص" });
        }}
      />
    </div>
  );
}

function ExamDialog({
  patientId,
  visit,
  existing,
  onOpenChange,
  onSaved,
}: {
  patientId: string;
  visit: VisitRow | null;
  existing: ExamRow | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { organization } = useOrganizationAccess();
  const { toast } = useToast();

  const [purpose, setPurpose] = useState("periodic");
  const [fitness, setFitness] = useState("pending");
  const [employerId, setEmployerId] = useState("");
  const [restrictions, setRestrictions] = useState("");
  const [certificate, setCertificate] = useState("");
  const [examDate, setExamDate] = useState("");
  const [nextDue, setNextDue] = useState("");

  useEffect(() => {
    if (!visit) return;
    setPurpose(existing?.exam_purpose ?? "periodic");
    setFitness(existing?.fitness_status ?? "pending");
    setEmployerId(existing?.employer_value_id ?? "");
    setRestrictions(existing?.restrictions_note ?? "");
    setCertificate(existing?.certificate_number ?? "");
    setExamDate(existing?.exam_date ?? visit.visit_date?.slice(0, 10) ?? "");
    setNextDue(existing?.next_exam_due_date ?? "");
  }, [visit, existing]);

  const save = useMutation({
    mutationFn: async () => {
      if (!organization?.id || !visit) throw new Error("لا توجد زيارة محدَّدة");
      const { error } = await supabase.rpc("app_save_occupational_exam", {
        p_organization_id: organization.id,
        p_patient_id: patientId,
        p_visit_id: visit.id,
        p_exam_purpose: purpose,
        p_fitness_status: fitness,
        p_employer_value_id: employerId || null,
        p_restrictions_note: restrictions.trim() || null,
        p_certificate_number: certificate.trim() || null,
        p_exam_date: examDate || null,
        p_next_exam_due_date: nextDue || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر الحفظ", description: errorMessage(error) }),
  });

  const needsRestrictions = fitness === "fit_with_restrictions";

  return (
    <Dialog open={Boolean(visit)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>نتيجة الفحص المهنيّ</DialogTitle>
          <DialogDescription>
            النتيجة تُحفظ على هذه الزيارة. تسجيلها مرّة أخرى يُحدِّثها ولا يُنشئ فحصًا ثانيًا.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>غرض الفحص</Label>
            <Select value={purpose} onValueChange={setPurpose}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PURPOSE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>النتيجة</Label>
            <Select value={fitness} onValueChange={setFitness}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(FITNESS_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>جهة العمل</Label>
            <LookupSelect
              categoryKey="work_entities"
              value={employerId}
              onChange={setEmployerId}
              placeholder="بدون"
              allowClear
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>رقم الشهادة</Label>
            <Input value={certificate} onChange={(e) => setCertificate(e.target.value)} dir="ltr" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>تاريخ الفحص</Label>
            <Input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الفحص القادم</Label>
            <Input type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>
              القيود {needsRestrictions ? "*" : ""}
            </Label>
            <Textarea
              value={restrictions}
              onChange={(e) => setRestrictions(e.target.value)}
              rows={3}
              placeholder={needsRestrictions ? "ما الذي يتجنّبه العامل؟" : "اختياري"}
            />
            {needsRestrictions && (
              <p className="text-xs text-muted-foreground">
                «لائق مع قيود» بلا بيان القيود ليس نتيجة — الجهة الطالبة لا تعرف ما تتجنّبه.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            إلغاء
          </Button>
          <Button
            disabled={save.isPending || (needsRestrictions && !restrictions.trim())}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
