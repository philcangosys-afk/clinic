import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, Ban, CheckCircle2, FileSignature, FileSpreadsheet, Pencil, Plus, Printer, RefreshCw, X } from "lucide-react";
import { formatAmount } from "@/lib/locale";
import { errorMessage } from "@/lib/error-message";
import { usePermissions } from "@/lib/permissions";
import { useSessionDoctor } from "@/lib/session-doctor";
import { useMemberNames } from "@/lib/member-names";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { useToast } from "@/hooks/use-toast";
import { buildXlsx, downloadBlob } from "@/lib/xlsx-writer";
import { printAgreement, useAgreementList, type AgreementFilters, type AgreementListRow } from "@/lib/agreements";
import AgreementDialog, { AgreementDisableDialog, invalidateAgreementQueries } from "@/components/agreements/AgreementDialog";
import { useDoctorsAndClinics } from "@/components/agreements/QuoteEditorDialog";
import LegacyAgreementsDialog from "@/components/agreements/LegacyAgreementsDialog";
import PatientPicker from "@/components/shared/PatientPicker";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * قائمة الاتفاقيات — كشاشة «اتفاقيات المريض» في النظام المرجعيّ.
 *
 * بوضعين: داخل ملفّ المريض (`patientId`) تعرض اتفاقياته وحده، وفي المحاسبة
 * تعرض اتفاقيات المنشأة كلّها بعمودَي المريض ورقم ملفّه ورشّاحٍ للمريض.
 *
 * لا زرّ حذف: الاتفاقية مستندٌ ماليّ قد فُوتر منه — تُعطَّل ولا تُمحى.
 */

const ALL = "__all__";

export default function AgreementsPanel({
  organizationId,
  patientId,
}: {
  organizationId: string | undefined;
  /** ملفّ مريض: اتفاقياته وحده. وبدونه: كلّ اتفاقيات المنشأة. */
  patientId?: string | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const { organization } = useOrganizationAccess();
  const canManage = can("agreements.manage");
  const patientMode = Boolean(patientId);
  /**
   * الطبيب يرى اتفاقياته هو وحده (0218): المريض الذي عند ماجد وأُرسل إلى
   * محمد له اتفاقيةٌ مع ماجد — لا تظهر لمحمد. والاستقبال والإدارة يرون الكلّ.
   */
  const { doctorId: sessionDoctorId, isDoctorScope } = useSessionDoctor();
  const scopeDoctorId = isDoctorScope ? sessionDoctorId : null;

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [doctorId, setDoctorId] = useState(ALL);
  const [registrarId, setRegistrarId] = useState(ALL);
  const [activeOnly, setActiveOnly] = useState(false);
  const [filterPatient, setFilterPatient] = useState<{ id: string; name_ar: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; agreementId: string | null }>({ open: false, agreementId: null });
  const [disableTarget, setDisableTarget] = useState<AgreementListRow | null>(null);
  const [legacyOpen, setLegacyOpen] = useState(false);

  const filters: AgreementFilters = {
    patientId: patientId ?? filterPatient?.id ?? null,
    from: from || null,
    to: to || null,
    doctorId: scopeDoctorId ?? (doctorId === ALL ? null : doctorId),
    activeOnly,
  };
  const list = useAgreementList(organizationId, filters);
  const lists = useDoctorsAndClinics(organizationId);
  const members = useMemberNames(organizationId);

  // المسجِّل يُرشَّح هنا لا في الاستعلام: الاتفاقيات القديمة بلا مسجِّلٍ
  // صريح، ومسجِّلها من أنشأها — والمنظور يعرض اسمه بهذا الترتيب نفسه.
  const registrarName = registrarId === ALL ? null : members.data?.get(registrarId) ?? null;
  const rows = useMemo(
    () => (list.data ?? []).filter((row) => !registrarName || row.registrar_name === registrarName),
    [list.data, registrarName],
  );
  const selected = rows.find((row) => row.id === selectedId) ?? null;

  const totals = rows
    .filter((row) => !row.is_disabled)
    .reduce(
      (sum, row) => ({
        vat: sum.vat + Number(row.vat_amount),
        net: sum.net + Number(row.net_amount),
        invoiced: sum.invoiced + Number(row.invoiced_amount),
        // ما أُلغيت مديونيته لا يُطالَب به — خارج مجموع المتبقّي
        remaining: sum.remaining + (row.debt_cancelled ? 0 : Number(row.remaining_amount)),
      }),
      { vat: 0, net: 0, invoiced: 0, remaining: 0 },
    );

  const memberOptions = Array.from((members.data ?? new Map<string, string>()).entries()).sort((a, b) =>
    a[1].localeCompare(b[1], "ar"),
  );

  const exportRows = () => {
    const header = [
      "#",
      "تاريخ الإنشاء",
      "تاريخ الاتفاقية",
      ...(patientMode ? [] : ["المريض", "رقم الملف"]),
      "الخدمات",
      "الطبيب",
      "المستخدم",
      "ملاحظات",
      "الضريبة",
      "الإجمالي",
      "المفوتر",
      "المتبقي",
      "معطّلة",
    ];
    const body = rows.map((row) => [
      row.agreement_number,
      new Date(row.created_at).toLocaleString("ar-SA"),
      row.agreement_date,
      ...(patientMode ? [] : [row.patient_name, String(row.file_number ?? "")]),
      row.services ?? "",
      row.doctor_name ?? "",
      row.registrar_name ?? "",
      row.note ?? "",
      Number(row.vat_amount),
      Number(row.net_amount),
      Number(row.invoiced_amount),
      Number(row.remaining_amount),
      row.is_disabled ? "نعم" : "",
    ]);
    downloadBlob(
      buildXlsx([{ name: "الاتفاقيات", rows: [header, ...body], boldRows: [0] }]),
      `agreements-${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  };

  const print = async (row: AgreementListRow) => {
    try {
      await printAgreement(row, organization?.name ?? "");
    } catch (error) {
      toast({ variant: "destructive", title: "تعذّرت الطباعة", description: errorMessage(error) });
    }
  };

  const colCount = patientMode ? 12 : 14;

  return (
    <Card>
      <CardHeader className="gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <FileSignature className="h-4 w-4" />
            {patientMode ? "اتفاقيات المريض" : "اتفاقيات العلاج"}
          </CardTitle>
          <CardDescription>
            اتفاقٌ مرن على الخدمات وأسعارها بعروض أسعار تُعدَّل قبل الفوترة — لا يُرسَل للضريبة. المفوتر يحسبه النظام
            من الفواتير المرتبطة.
          </CardDescription>
        </div>

        {/* ── شريط الأوامر ─────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2">
          <Button size="sm" disabled={!canManage} onClick={() => setDialog({ open: true, agreementId: null })}>
            <Plus className="h-4 w-4" />
            إضافة
          </Button>
          <Button size="sm" variant="outline" disabled={!selected} onClick={() => selected && setDialog({ open: true, agreementId: selected.id })}>
            <Pencil className="h-4 w-4" />
            فتح / تعديل
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!canManage || !selected || selected.is_disabled}
            onClick={() => selected && setDisableTarget(selected)}
          >
            <Ban className="h-4 w-4" />
            تعطيل
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!canManage || !selected || !selected.is_disabled}
            onClick={() => selected && setDisableTarget(selected)}
          >
            <CheckCircle2 className="h-4 w-4" />
            تفعيل
          </Button>
          <Button size="sm" variant="ghost" onClick={() => invalidateAgreementQueries(queryClient)}>
            <RefreshCw className="h-4 w-4" />
            تحديث
          </Button>
          <Button size="sm" variant="ghost" disabled={!selected} onClick={() => selected && void print(selected)}>
            <Printer className="h-4 w-4" />
            طباعة
          </Button>
          <Button size="sm" variant="ghost" disabled={rows.length === 0} onClick={exportRows}>
            <FileSpreadsheet className="h-4 w-4" />
            تصدير
          </Button>
          {/* أرشيف Kizen: اتفاقيات النظام السابق ببنودها وفواتيرها، و«تنشيط»
              يجعل أيًّا منها حيّةً هنا تُعدَّل وتُفوتَر (0217). */}
          <Button
            size="sm"
            className="ms-auto bg-amber-500 text-white shadow-sm hover:bg-amber-600"
            onClick={() => setLegacyOpen(true)}
          >
            <Archive className="h-4 w-4" />
            أرشيف اتفاقيات النظام السابق (Kizen)
          </Button>
        </div>

        {/* ── الرشّاحات ─────────────────────────────────────────── */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">من تاريخ</Label>
            <Input type="date" className="h-9 w-40" value={from} onChange={(event) => setFrom(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">إلى تاريخ</Label>
            <Input type="date" className="h-9 w-40" value={to} onChange={(event) => setTo(event.target.value)} />
          </div>
          {!scopeDoctorId && (
          <div className="flex flex-col gap-1">
            <Label className="text-xs">الطبيب</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>كلّ الأطباء</SelectItem>
                {(lists.data?.doctors ?? []).map((doctor) => (
                  <SelectItem key={doctor.id} value={doctor.id}>{doctor.name_ar}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          )}
          <div className="flex flex-col gap-1">
            <Label className="text-xs">المستخدم</Label>
            <Select value={registrarId} onValueChange={setRegistrarId}>
              <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>كلّ المستخدمين</SelectItem>
                {memberOptions.map(([userId, name]) => (
                  <SelectItem key={userId} value={userId}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!patientMode && (
            <div className="flex min-w-[16rem] flex-col gap-1">
              <Label className="text-xs">المريض</Label>
              {filterPatient ? (
                <div className="flex h-9 items-center gap-2 rounded-md border px-2 text-sm">
                  {filterPatient.name_ar}
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setFilterPatient(null)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <PatientPicker
                  placeholder="كلّ المرضى — ابحث لتحديد مريض"
                  onSelect={(patient) => setFilterPatient({ id: patient.id, name_ar: patient.name_ar })}
                />
              )}
            </div>
          )}
          <label className="flex h-9 items-center gap-2 text-sm">
            <Switch checked={activeOnly} onCheckedChange={setActiveOnly} />
            النشطة فقط
          </label>
        </div>
      </CardHeader>

      <CardContent>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[1100px] text-sm [&_th]:whitespace-nowrap">
            <thead className="bg-muted/60 text-xs">
              <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:text-start [&>th]:font-medium">
                <th>#</th>
                <th>تاريخ الإنشاء</th>
                <th>تاريخ الاتفاقية</th>
                {!patientMode && <th>المريض</th>}
                {!patientMode && <th>رقم الملف</th>}
                <th className="min-w-[12rem]">الخدمات</th>
                <th>الطبيب</th>
                <th>المستخدم</th>
                <th>ملاحظات</th>
                <th>الضريبة</th>
                <th>الإجمالي</th>
                <th>المفوتر</th>
                <th>المتبقي</th>
                <th>معطّلة</th>
              </tr>
            </thead>
            <tbody>
              {list.isLoading && (
                <tr>
                  <td colSpan={colCount} className="p-2"><Skeleton className="h-24 w-full" /></td>
                </tr>
              )}
              {list.error && (
                <tr>
                  <td colSpan={colCount} className="py-6 text-center text-destructive">{errorMessage(list.error)}</td>
                </tr>
              )}
              {!list.isLoading && !list.error && rows.length === 0 && (
                <tr>
                  <td colSpan={colCount} className="py-8 text-center text-muted-foreground">
                    لا اتفاقيات{patientMode ? " لهذا المريض" : ""} بهذه الرشّاحات.
                  </td>
                </tr>
              )}
              {rows.map((row) => {
                const remaining = Number(row.remaining_amount);
                return (
                  <tr
                    key={row.id}
                    className={`cursor-pointer border-t tabular-nums [&>td]:px-2 [&>td]:py-1.5 ${
                      selectedId === row.id ? "bg-primary/10" : "hover:bg-muted/40"
                    } ${row.is_disabled ? "text-muted-foreground" : ""}`}
                    onClick={() => setSelectedId(row.id)}
                    onDoubleClick={() => setDialog({ open: true, agreementId: row.id })}
                  >
                    <td className="font-mono">{row.agreement_number}</td>
                    <td className="whitespace-nowrap text-xs">{new Date(row.created_at).toLocaleString("ar-SA")}</td>
                    <td className="whitespace-nowrap text-xs">{new Date(row.agreement_date).toLocaleDateString("ar-SA")}</td>
                    {!patientMode && <td className="whitespace-nowrap">{row.patient_name}</td>}
                    {!patientMode && <td className="font-mono text-xs">{row.file_number ?? ""}</td>}
                    <td className="max-w-[16rem] truncate" title={row.services ?? ""}>{row.services ?? "—"}</td>
                    <td className="whitespace-nowrap">{row.doctor_name ?? "—"}</td>
                    <td className="whitespace-nowrap">{row.registrar_name ?? "—"}</td>
                    <td className="max-w-[10rem] truncate" title={row.note ?? ""}>{row.note ?? ""}</td>
                    <td>{formatAmount(row.vat_amount)}</td>
                    <td className="font-semibold">{formatAmount(row.net_amount)}</td>
                    <td className="text-emerald-700">{formatAmount(row.invoiced_amount)}</td>
                    <td className={remaining < 0 ? "font-bold text-destructive" : remaining > 0 ? "font-semibold text-amber-700" : ""}>
                      {formatAmount(remaining)}
                    </td>
                    <td className="whitespace-nowrap">
                      {row.is_disabled ? (
                        <Badge variant="secondary" title={row.disabled_reason ?? ""}>معطّلة</Badge>
                      ) : null}
                      {row.debt_cancelled ? (
                        <Badge variant="outline" className="border-rose-400 text-rose-700" title={row.debt_cancel_reason ?? ""}>
                          أُلغيت مديونيتها
                        </Badge>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="border-t bg-muted/40 font-semibold tabular-nums">
                <tr className="[&>td]:px-2 [&>td]:py-2">
                  <td colSpan={patientMode ? 7 : 9}>
                    الإجمالي — {rows.filter((row) => !row.is_disabled).length} اتفاقية نشطة
                    {rows.some((row) => row.is_disabled) ? " (المعطّلة خارج المجموع)" : ""}
                  </td>
                  <td>{formatAmount(totals.vat)}</td>
                  <td>{formatAmount(totals.net)}</td>
                  <td className="text-emerald-700">{formatAmount(totals.invoiced)}</td>
                  <td>{formatAmount(totals.remaining)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </CardContent>

      {dialog.open && (
        <AgreementDialog
          open={dialog.open}
          onOpenChange={(value) => setDialog((prev) => ({ ...prev, open: value }))}
          organizationId={organizationId}
          agreementId={dialog.agreementId}
          patientId={patientId ?? null}
        />
      )}
      {legacyOpen && (
        <LegacyAgreementsDialog
          open={legacyOpen}
          onOpenChange={setLegacyOpen}
          organizationId={organizationId}
          patientId={patientId ?? null}
          doctorScopeId={scopeDoctorId}
          onOpenAgreement={(agreementId) => {
            setLegacyOpen(false);
            setSelectedId(agreementId);
            setDialog({ open: true, agreementId });
          }}
        />
      )}
      <AgreementDisableDialog agreement={disableTarget} onOpenChange={(value) => !value && setDisableTarget(null)} />
    </Card>
  );
}
