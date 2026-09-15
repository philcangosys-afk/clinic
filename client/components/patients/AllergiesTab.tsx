import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Ban, Plus, ShieldCheck } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { usePermissions } from "@/lib/permissions";
import { formatDate, formatDateTime, useLocaleSettings } from "@/lib/locale";
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
 * حساسية المريض — مهيكلة، لا ملاحظة حرّة.
 *
 * **العيب الذي تُغلقه:** لم يكن في القاعدة جدولٌ للحساسية إطلاقًا. كانت
 * تُسجَّل بندًا في «الأمراض المزمنة» بملاحظة نصّية: لا دواء محدَّد ولا شدّة
 * ولا نوع تفاعل — ولا شيء يقرؤها عند وصف الدواء. ووصفُ دواءٍ يتحسّس منه
 * المريض من أخطر ما يمنعه نظامٌ طبيّ.
 *
 * الصفّ هنا يحمل **صنف الكتالوج** حين يكون الدواء معروفًا، فيُطابَق بالمعرّف
 * وبالاسم العلميّ عند الوصف (`app_check_drug_allergy` في 0155). وحين يذكر
 * المريض دواءً ليس في الكتالوج يبقى نصًّا، ويُطابَق نصًّا.
 *
 * **ولا حذف:** حساسيةٌ سُجِّلت ثمّ تبيّن خطؤها تُوضَع «منفيّة» بسببها ولا
 * تُمحى — نفيُها معلومةٌ طبية كإثباتها، ومحوُها يُعيد السؤال كلّ زيارة.
 */

type AllergyRow = {
  id: string;
  allergen_kind: "drug" | "food" | "environment" | "other";
  item_id: string | null;
  allergen_text: string | null;
  allergen_label: string | null;
  generic_name: string | null;
  allergy_type_name: string | null;
  severity_name: string | null;
  reaction: string | null;
  onset_date: string | null;
  status: "active" | "resolved" | "refuted";
  resolved_at: string | null;
  resolved_reason: string | null;
  note: string | null;
  created_at: string;
};

export const ALLERGY_KIND_LABELS: Record<AllergyRow["allergen_kind"], string> = {
  drug: "دواء",
  food: "طعام",
  environment: "بيئية",
  other: "أخرى",
};

const STATUS_LABELS: Record<AllergyRow["status"], string> = {
  active: "نشطة",
  resolved: "زالت",
  refuted: "منفيّة",
};

/** بحث دوائيّ من نفس كتالوج الوصفة — حتى لا يوجد دواءان بتعريفين. */
function useDrugSearch(organizationId: string | undefined, term: string) {
  return useQuery({
    queryKey: ["allergy-drug-search", organizationId, term],
    enabled: Boolean(organizationId) && term.trim().length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items")
        .select("id, name_ar, drug_details(generic_name)")
        .eq("organization_id", organizationId)
        .eq("item_type", "drug")
        .eq("is_disabled", false)
        .eq("is_archived", false)
        .ilike("name_ar", `%${term.trim()}%`)
        .order("name_ar")
        .limit(10);
      if (error) throw error;
      return (data ?? []).map((row: any) => {
        const details = Array.isArray(row.drug_details) ? row.drug_details[0] : row.drug_details;
        return {
          id: row.id as string,
          name_ar: row.name_ar as string,
          generic: (details?.generic_name as string | null) ?? null,
        };
      });
    },
  });
}

export default function AllergiesTab({ patientId }: { patientId: string }) {
  const { organization, session } = useOrganizationAccess();
  const { calendarDisplay } = useLocaleSettings();
  const { can } = usePermissions();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canWrite = can("medical_records.write");

  const [addOpen, setAddOpen] = useState(false);
  const [closing, setClosing] = useState<{ row: AllergyRow; status: "resolved" | "refuted" } | null>(
    null,
  );
  const [closeReason, setCloseReason] = useState("");

  const [kind, setKind] = useState<AllergyRow["allergen_kind"]>("drug");
  const [drugTerm, setDrugTerm] = useState("");
  const [picked, setPicked] = useState<{ id: string; name_ar: string } | null>(null);
  const [text, setText] = useState("");
  const [typeValueId, setTypeValueId] = useState("");
  const [severityValueId, setSeverityValueId] = useState("");
  const [reaction, setReaction] = useState("");
  const [onsetDate, setOnsetDate] = useState("");
  const [note, setNote] = useState("");

  const drugs = useDrugSearch(organization?.id, drugTerm);

  const list = useQuery({
    queryKey: ["patient-allergies", organization?.id, patientId],
    enabled: Boolean(organization?.id && patientId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_patient_allergies")
        .select("*")
        .eq("organization_id", organization!.id)
        .eq("patient_id", patientId)
        .order("status")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AllergyRow[];
    },
  });

  const rows = list.data ?? [];
  const active = useMemo(() => rows.filter((r) => r.status === "active"), [rows]);

  function resetForm() {
    setKind("drug");
    setDrugTerm("");
    setPicked(null);
    setText("");
    setTypeValueId("");
    setSeverityValueId("");
    setReaction("");
    setOnsetDate("");
    setNote("");
  }

  const create = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لم تُحدَّد المنشأة");
      // لا حساسية بلا مُسبِّب: القيد في القاعدة يرفضها، والرسالة هنا أوضح.
      if (!picked && !text.trim()) {
        throw new Error("حدِّد الدواء من الكتالوج أو اكتب اسم المُسبِّب");
      }
      const { error } = await supabase.from("patient_allergies").insert({
        organization_id: organization.id,
        patient_id: patientId,
        allergen_kind: kind,
        item_id: kind === "drug" ? (picked?.id ?? null) : null,
        allergen_text: picked && kind === "drug" ? null : text.trim() || null,
        allergy_type_value_id: typeValueId || null,
        severity_value_id: severityValueId || null,
        reaction: reaction.trim() || null,
        onset_date: onsetDate || null,
        note: note.trim() || null,
        recorded_by: session?.user.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-allergies"] });
      queryClient.invalidateQueries({ queryKey: ["patient-allergy-count", patientId] });
      queryClient.invalidateQueries({ queryKey: ["drug-allergy-check"] });
      toast({ title: "سُجِّلت الحساسية" });
      resetForm();
      setAddOpen(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذّر الحفظ",
        description: errorMessage(error, "خطأ غير متوقع"),
      }),
  });

  const close = useMutation({
    mutationFn: async () => {
      if (!closing) throw new Error("لم يُحدَّد السجلّ");
      if (!closeReason.trim()) throw new Error("السبب مطلوب");
      /**
       * `.select()` بعد التحديث ضرورةٌ لا زينة: PostgREST لا يعدّ «لم يطابق
       * صفًّا» خطأً، فبدونه يُغلق الحوار ويظهر «تمّ» ولم يتغيّر شيء.
       */
      const { data, error } = await supabase
        .from("patient_allergies")
        .update({
          status: closing.status,
          resolved_reason: closeReason.trim(),
          resolved_at: new Date().toISOString(),
        })
        .eq("id", closing.row.id)
        .eq("organization_id", organization!.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("لم يتغيّر أيّ سجلّ — تحقّق من صلاحيتك");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-allergies"] });
      queryClient.invalidateQueries({ queryKey: ["patient-allergy-count", patientId] });
      queryClient.invalidateQueries({ queryKey: ["drug-allergy-check"] });
      toast({ title: "حُدِّثت حالة الحساسية" });
      setClosing(null);
      setCloseReason("");
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذّر التحديث",
        description: errorMessage(error, "خطأ غير متوقع"),
      }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-rose-600" />
          الحساسية
        </CardTitle>
        <CardDescription>
          ما يُسجَّل هنا يُفحص تلقائيًّا عند وصف الدواء. الفحص مطابقةٌ بالصنف
          وبالاسم العلميّ وبالنصّ — وليس محرّك تفاعلات متصالبة: حساسية البنسلين
          لا تُنبِّه على السيفالوسبورين.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ScreenToolbar
          items={[
            {
              key: "add",
              label: "تسجيل حساسية",
              icon: Plus,
              hidden: !canWrite,
              onClick: () => setAddOpen(true),
            },
          ]}
        />

        {active.length > 0 && (
          <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
            <span className="font-semibold">حساسية نشطة: </span>
            {active
              .map((r) =>
                [r.allergen_label ?? "—", r.severity_name].filter(Boolean).join(" — "),
              )
              .join(" • ")}
          </div>
        )}

        {list.isLoading && <Skeleton className="h-32 w-full" />}
        {list.isError && (
          <p className="text-sm text-destructive">
            تعذّر تحميل الحساسية: {errorMessage(list.error)}
          </p>
        )}

        {!list.isLoading && !list.isError && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المُسبِّب</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>التصنيف</TableHead>
                  <TableHead>الشدّة</TableHead>
                  <TableHead>التفاعل</TableHead>
                  <TableHead>البداية</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} className={r.status === "active" ? "" : "opacity-60"}>
                    <TableCell className="text-sm font-medium">
                      {r.allergen_label ?? "—"}
                      {r.generic_name && (
                        <span className="block text-[11px] text-muted-foreground">
                          {r.generic_name}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{ALLERGY_KIND_LABELS[r.allergen_kind]}</TableCell>
                    <TableCell className="text-xs">{r.allergy_type_name ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {r.severity_name ? (
                        <Badge variant={r.status === "active" ? "destructive" : "secondary"}>
                          {r.severity_name}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{r.reaction ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatDate(r.onset_date, calendarDisplay)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {STATUS_LABELS[r.status]}
                      {r.status !== "active" && r.resolved_reason && (
                        <span className="block text-[11px] text-muted-foreground">
                          {r.resolved_reason}
                          {r.resolved_at ? ` — ${formatDateTime(r.resolved_at, calendarDisplay)}` : ""}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      {canWrite && r.status === "active" && (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setClosing({ row: r, status: "resolved" });
                              setCloseReason("");
                            }}
                          >
                            <ShieldCheck className="h-3.5 w-3.5" />
                            زالت
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setClosing({ row: r, status: "refuted" });
                              setCloseReason("");
                            }}
                          >
                            <Ban className="h-3.5 w-3.5 text-destructive" />
                            نفي
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                      لا حساسية مسجَّلة. وخلوّ السجلّ ليس نفيًا — يعني أنّ أحدًا لم
                      يسأل بعد.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <GridFooterCount count={rows.length} />
          </div>
        )}
      </CardContent>

      {/* تسجيل حساسية */}
      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>تسجيل حساسية</DialogTitle>
            <DialogDescription>
              اختر الدواء من الكتالوج متى أمكن: المطابقة بالمعرّف وبالاسم العلميّ
              تُنبِّه على الاسم التجاريّ الآخر لنفس الدواء، والنصّ الحرّ لا يفعل.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>نوع المُسبِّب</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as AllergyRow["allergen_kind"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ALLERGY_KIND_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {kind === "drug" && (
              <div className="flex flex-col gap-1.5">
                <Label>الدواء من الكتالوج</Label>
                {picked ? (
                  <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                    <span className="font-medium">{picked.name_ar}</span>
                    <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>
                      تغيير
                    </Button>
                  </div>
                ) : (
                  <div className="relative">
                    <Input
                      value={drugTerm}
                      onChange={(e) => setDrugTerm(e.target.value)}
                      placeholder="ابحث عن الدواء..."
                    />
                    {(drugs.data ?? []).length > 0 && (
                      <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover shadow-lg">
                        {(drugs.data ?? []).map((d) => (
                          <button
                            key={d.id}
                            type="button"
                            className="flex w-full flex-col items-start px-3 py-1.5 text-start text-sm hover:bg-muted"
                            onClick={() => {
                              setPicked({ id: d.id, name_ar: d.name_ar });
                              setDrugTerm("");
                            }}
                          >
                            <span>{d.name_ar}</span>
                            {d.generic && (
                              <span className="text-[11px] text-muted-foreground">{d.generic}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {!(kind === "drug" && picked) && (
              <div className="flex flex-col gap-1.5">
                <Label>
                  {kind === "drug" ? "أو اسم الدواء كما ذكره المريض" : "اسم المُسبِّب"}
                </Label>
                <Input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={kind === "drug" ? "دواء ليس في الكتالوج" : "مثال: الفول، وبر القطط"}
                />
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>تصنيف الحساسية</Label>
                <LookupSelect
                  categoryKey="allergy_types"
                  value={typeValueId}
                  onChange={setTypeValueId}
                  allowClear
                  placeholder="اختر..."
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>الشدّة</Label>
                <LookupSelect
                  categoryKey="allergy_severity"
                  value={severityValueId}
                  onChange={setSeverityValueId}
                  allowClear
                  placeholder="اختر..."
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>التفاعل</Label>
                <Input
                  value={reaction}
                  onChange={(e) => setReaction(e.target.value)}
                  placeholder="طفح جلدي، ضيق تنفّس..."
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>تاريخ أوّل ظهور</Label>
                <Input type="date" value={onsetDate} onChange={(e) => setOnsetDate(e.target.value)} />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>ملاحظة</Label>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* زوال أو نفي — السبب إلزاميّ */}
      <Dialog
        open={Boolean(closing)}
        onOpenChange={(open) => {
          if (!open) {
            setClosing(null);
            setCloseReason("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {closing?.status === "refuted" ? "نفي الحساسية" : "تسجيل زوال الحساسية"}
            </DialogTitle>
            <DialogDescription>
              {closing?.status === "refuted"
                ? "النفي لا يمحو السجلّ — يبقى بسببه فلا يُعاد السؤال كلّ زيارة."
                : "زوال الحساسية قرارٌ سريريّ يُسأل عنه لاحقًا، فسببه إلزاميّ."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label>السبب</Label>
            <Textarea
              rows={3}
              value={closeReason}
              onChange={(e) => setCloseReason(e.target.value)}
              placeholder={
                closing?.status === "refuted"
                  ? "اختبار وخز سلبي، أو تبيّن أنّ التفاعل من دواء آخر"
                  : "أُعيد إعطاء الدواء بإشراف ولم يظهر تفاعل"
              }
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setClosing(null)}>
              إلغاء
            </Button>
            <Button
              variant="destructive"
              onClick={() => close.mutate()}
              disabled={close.isPending || !closeReason.trim()}
            >
              تأكيد
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
