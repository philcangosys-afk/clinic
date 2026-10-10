import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { usePermissions } from "@/lib/permissions";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { CLAIM_STATUS_LABELS, CLAIM_STATUS_TONE } from "@/components/insurance/claim-status";
import { errorMessage } from "@/lib/error-message";

/**
 * مساحة عمل المطالبات — المرحلة ١٣.
 *
 * ثلاثة أشياء لم تكن موجودة قبلها:
 *   • **الرفض على مستوى البند.** الشركة ترفض بندًا وتقبل ثلاثة، والنظام كان
 *     يعرف «مرفوضة» أو «مقبولة» فقط — فلا يُعرف ما الذي رُفض ولا لماذا، ولا
 *     يُبنى عليه اعتراض.
 *   • **التسوية.** لا سبيل لتسجيل دفعة شركة ومطابقتها بمطالبات، ولا لمعرفة
 *     الفرق بين المطالَب به والمحصَّل.
 *   • **طابور نفيس.** الرسائل والمحاولات والاستجابات — مفصولة عن منطق النظام.
 */
// الترجمات والنبرات في `claim-status.ts`: كانت معرَّفة هنا وفي
// `pages/Insurance.tsx` معًا، والنسخة الأخرى ناقصة خمسَ حالات.

export default function ClaimsWorkspace() {
  const { organization } = useOrganizationAccess();
  const organizationId = organization?.id;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const [filter, setFilter] = useState("attention");
  const [openClaim, setOpenClaim] = useState<any | null>(null);
  const [settleOpen, setSettleOpen] = useState(false);

  const claims = useQuery({
    queryKey: ["claim-settlement", organizationId, filter],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let q = supabase
        .from("v_claim_settlement")
        .select("*")
        .eq("organization_id", organizationId)
        .order("submitted_at", { ascending: false, nullsFirst: false })
        .limit(200);
      if (filter === "attention")
        q = q.in("status", ["validation_failed", "rejected", "partially_approved"]);
      else if (filter === "unsettled") q = q.gt("unsettled_amount", 0);
      else if (filter !== "all") q = q.eq("status", filter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const receivables = useQuery({
    queryKey: ["insurance-receivables", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_insurance_receivables")
        .select("*")
        .eq("organization_id", organizationId)
        .order("outstanding", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  /**
   * تجهيز المطالبة للإرسال — الحالة `ready`.
   *
   * قسم «مطالبات جاهزة للإرسال» في طابور نفيس يُرشِّح `status = 'ready'`، ولم
   * يكن في النظام كلّه شيء يكتب هذه الحالة: `app_create_claim_from_visit`
   * تُنشئ `draft` أو `validation_failed`، والمحفِّز التلقائي يُنشئ `draft`،
   * وزرّ «إرسال» ينتقل من `draft` إلى `submitted` مباشرة. فكان الطابور فارغًا
   * دائمًا وزرّ «إدراج في الطابور» لا يُضغط ولا مرّة. الانتقال `draft → ready`
   * مسموح في `app_claim_status_allowed`، والدالّة هي التي تفحص الصلاحية
   * وتسجّل الأثر.
   */
  const prepare = useMutation({
    mutationFn: async (formId: string) => {
      const { error } = await supabase.rpc("app_set_claim_form_status", {
        p_form_id: formId,
        p_status: "ready",
        p_reason: null,
        p_amount: null,
        p_code: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["claim-settlement"] });
      queryClient.invalidateQueries({ queryKey: ["claims-ready-to-queue"] });
      queryClient.invalidateQueries({ queryKey: ["insurance-claim-forms"] });
      toast({ title: "جُهّزت المطالبة للإرسال", description: "أدرجها في طابور نفيس" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التجهيز",
        description: errorMessage(error),
      }),
  });

  const totals = (receivables.data ?? []).reduce(
    (a, r) => {
      a.claimed += Number(r.total_claimed ?? 0);
      a.approved += Number(r.total_approved ?? 0);
      a.rejected += Number(r.total_rejected ?? 0);
      a.outstanding += Number(r.outstanding ?? 0);
      return a;
    },
    { claimed: 0, approved: 0, rejected: 0, outstanding: 0 },
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="المطالَب به" value={totals.claimed} />
        <Stat label="المعتمَد" value={totals.approved} tone="text-emerald-700" />
        <Stat label="المرفوض" value={totals.rejected} tone="text-rose-700" />
        <Stat label="لم يُحصَّل بعد" value={totals.outstanding} tone="text-amber-700" />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>المطالبات</CardTitle>
            <CardDescription>
              الرفض يُسجَّل على مستوى البند بكوده وسببه — وهو ما يُبنى عليه الاعتراض
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="attention">تحتاج عملًا</SelectItem>
                <SelectItem value="unsettled">معتمَدة ولم تُحصَّل</SelectItem>
                {/* المسوّدة تحتاج تجهيزًا قبل الإرسال، فلها مُرشِّح ظاهر */}
                <SelectItem value="draft">مسوّدة</SelectItem>
                <SelectItem value="ready">جاهزة للإرسال</SelectItem>
                <SelectItem value="submitted">مُقدَّمة</SelectItem>
                <SelectItem value="all">الكل</SelectItem>
              </SelectContent>
            </Select>
            {can("insurance.claims") && (
              <Button variant="outline" onClick={() => setSettleOpen(true)}>
                تسجيل تسوية
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {claims.isLoading && <Skeleton className="h-40 w-full" />}
          {!claims.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المريض</TableHead>
                  <TableHead>الشركة</TableHead>
                  <TableHead>المطالَب / المعتمَد</TableHead>
                  <TableHead>المسدَّد</TableHead>
                  <TableHead>المدّة</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(claims.data ?? []).map((c) => (
                  <TableRow key={c.claim_form_id}>
                    <TableCell className="font-medium">
                      {c.patient_name}
                      {c.file_number && (
                        <span className="block text-xs text-muted-foreground">
                          ملف {c.file_number}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{c.company_name ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">
                      {Number(c.claimed_amount ?? 0).toLocaleString("ar-SA-u-nu-latn")} /{" "}
                      <span className="text-emerald-700">
                        {Number(c.approved_amount ?? 0).toLocaleString("ar-SA-u-nu-latn")}
                      </span>
                      {c.rejected_items > 0 && (
                        <span className="block text-xs text-rose-700">
                          {c.rejected_items} بند مرفوض
                          {c.rejection_codes ? ` (${c.rejection_codes})` : ""}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {Number(c.settled_amount ?? 0).toLocaleString("ar-SA-u-nu-latn")}
                      {Number(c.unsettled_amount ?? 0) > 0 && (
                        <span className="block text-xs text-amber-700">
                          متبقٍّ {Number(c.unsettled_amount).toLocaleString("ar-SA-u-nu-latn")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {c.response_days != null
                        ? `رُدّ خلال ${c.response_days} يومًا`
                        : c.days_pending != null
                          ? `معلَّقة ${c.days_pending} يومًا`
                          : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={CLAIM_STATUS_TONE[c.status] ?? "secondary"}>
                        {CLAIM_STATUS_LABELS[c.status] ?? c.status}
                      </Badge>
                      {c.has_validation_errors && (
                        <span className="block text-xs text-destructive">بيانات ناقصة</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {c.status === "draft" && can("insurance.claims") && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={prepare.isPending}
                            onClick={() => prepare.mutate(c.claim_form_id)}
                          >
                            تجهيز للإرسال
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setOpenClaim(c)}>
                          البنود
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(claims.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      لا مطالبات مطابقة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ClaimItemsDialog claim={openClaim} onClose={() => setOpenClaim(null)} />
      <SettlementDialog
        open={settleOpen}
        onClose={() => setSettleOpen(false)}
        organizationId={organizationId}
      />
      <NphiesQueuePanel organizationId={organizationId} />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className={`text-xl ${tone ?? ""}`}>
          {value.toLocaleString("ar-SA-u-nu-latn")} ر.س
        </CardTitle>
      </CardHeader>
    </Card>
  );
}

/**
 * بنود المطالبة وردّ الشركة على كل بند.
 *
 * `app_record_claim_item_response` تشتقّ حالة المطالبة من بنودها بعد آخر ردّ،
 * فلا تُكتب الحالة يدويًّا ولا تتناقض مع تفاصيلها.
 */
function ClaimItemsDialog({ claim, onClose }: { claim: any | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const [target, setTarget] = useState<any | null>(null);
  const [status, setStatus] = useState("approved");
  const [approved, setApproved] = useState("");
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");

  const items = useQuery({
    queryKey: ["claim-items", claim?.claim_form_id],
    enabled: Boolean(claim?.claim_form_id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("insurance_claim_form_items")
        .select(
          "id, description, service_code, qty, claimed_amount, approved_amount, rejected_amount, rejection_code, rejection_reason, status, preauthorization_id",
        )
        .eq("form_id", claim?.claim_form_id);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const record = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error("لا بند محدَّد");
      if (status !== "approved" && !reason.trim()) throw new Error("اكتب سبب الردّ");
      if (status === "partially_approved" && !approved)
        throw new Error("اكتب المبلغ المعتمَد");
      const { error } = await supabase.rpc("app_record_claim_item_response", {
        p_item_id: target.id,
        p_status: status,
        p_approved:
          status === "approved"
            ? Number(target.claimed_amount)
            : status === "partially_approved"
              ? Number(approved)
              : null,
        p_code: code.trim() || null,
        p_reason: reason.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["claim-items", claim?.claim_form_id] });
      queryClient.invalidateQueries({ queryKey: ["claim-settlement"] });
      queryClient.invalidateQueries({ queryKey: ["insurance-receivables"] });
      toast({ title: "سُجّل ردّ الشركة على البند" });
      setTarget(null);
      setApproved("");
      setCode("");
      setReason("");
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التسجيل",
        description: errorMessage(error),
      }),
  });

  const ITEM_STATUS: Record<string, string> = {
    claimed: "مُطالَب به",
    approved: "معتمَد",
    partially_approved: "معتمَد جزئيًا",
    rejected: "مرفوض",
    resubmitted: "أُعيد",
  };

  return (
    <Dialog open={Boolean(claim)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>بنود المطالبة — {claim?.patient_name}</DialogTitle>
          <DialogDescription>
            {claim?.company_name} · المطالَب{" "}
            {Number(claim?.claimed_amount ?? 0).toLocaleString("ar-SA-u-nu-latn")} ر.س
          </DialogDescription>
        </DialogHeader>

        {items.isLoading && <Skeleton className="h-32 w-full" />}
        {!items.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الخدمة</TableHead>
                <TableHead>الكود</TableHead>
                <TableHead>المطالَب</TableHead>
                <TableHead>المعتمَد</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(items.data ?? []).map((it) => (
                <TableRow key={it.id}>
                  <TableCell className="font-medium">
                    {it.description}
                    {it.preauthorization_id && (
                      <Badge variant="secondary" className="mr-2">
                        بموافقة
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{it.service_code ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">
                    {Number(it.claimed_amount ?? 0).toLocaleString("ar-SA-u-nu-latn")}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {it.approved_amount != null
                      ? Number(it.approved_amount).toLocaleString("ar-SA-u-nu-latn")
                      : "—"}
                    {Number(it.rejected_amount ?? 0) > 0 && (
                      <span className="block text-xs text-rose-700">
                        مرفوض {Number(it.rejected_amount).toLocaleString("ar-SA-u-nu-latn")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        it.status === "rejected"
                          ? "destructive"
                          : it.status === "approved"
                            ? "success"
                            : it.status === "partially_approved"
                              ? "warning"
                              : "secondary"
                      }
                    >
                      {ITEM_STATUS[it.status] ?? it.status}
                    </Badge>
                    {it.rejection_reason && (
                      <span className="block text-xs text-muted-foreground">
                        {it.rejection_code ? `${it.rejection_code}: ` : ""}
                        {it.rejection_reason}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {it.status === "claimed" && can("insurance.claims") && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setTarget(it);
                          setApproved(String(it.claimed_amount ?? ""));
                        }}
                      >
                        ردّ الشركة
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {target && (
          <>
            <Separator />
            <div className="flex flex-col gap-3 rounded-md border p-3">
              <h4 className="text-sm font-medium">ردّ الشركة على: {target.description}</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>القرار</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="approved">اعتماد كامل</SelectItem>
                      <SelectItem value="partially_approved">اعتماد جزئي</SelectItem>
                      <SelectItem value="rejected">رفض</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {status === "partially_approved" && (
                  <div className="flex flex-col gap-1.5">
                    <Label>المبلغ المعتمَد *</Label>
                    <Input
                      type="number"
                      min={0}
                      max={Number(target.claimed_amount)}
                      value={approved}
                      onChange={(e) => setApproved(e.target.value)}
                    />
                  </div>
                )}
                {status !== "approved" && (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <Label>كود الرفض</Label>
                      <Input value={code} onChange={(e) => setCode(e.target.value)} dir="ltr" />
                    </div>
                    <div className="col-span-2 flex flex-col gap-1.5">
                      <Label>سبب الردّ *</Label>
                      <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                    </div>
                  </>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setTarget(null)}>
                  تراجع
                </Button>
                <Button size="sm" disabled={record.isPending} onClick={() => record.mutate()}>
                  تسجيل الردّ
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * تسوية دفعة شركة التأمين.
 *
 * **المبلغ المرفوض لا يُحوَّل إلى المريض تلقائيًّا.** بعض الرفض خطأ ترميز
 * يُصحَّح ويُعاد تقديمه، وتحميله على المريض فورًا يخسره ويخسر حقّ المنشأة
 * معًا. يبقى ظاهرًا هنا لقرارٍ بشريّ.
 */
function SettlementDialog({
  open,
  onClose,
  organizationId,
}: {
  open: boolean;
  onClose: () => void;
  organizationId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [companyId, setCompanyId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [paid, setPaid] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  const companies = useQuery({
    queryKey: ["settlement-companies", organizationId],
    enabled: open && Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("insurance_companies")
        .select("id, name_ar")
        .eq("organization_id", organizationId)
        .eq("is_disabled", false)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });

  const claims = useQuery({
    queryKey: ["settleable-claims", companyId],
    enabled: open && Boolean(companyId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_claim_settlement")
        .select("claim_form_id, patient_name, claimed_amount, approved_amount, unsettled_amount, status")
        .eq("company_id", companyId)
        .in("status", ["approved", "partially_approved"])
        .gt("unsettled_amount", 0)
        .limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const expected = (claims.data ?? [])
    .filter((c) => selected.includes(c.claim_form_id))
    .reduce((s, c) => s + Number(c.unsettled_amount ?? 0), 0);

  const settle = useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error("اختر شركة التأمين");
      if (selected.length === 0) throw new Error("اختر مطالبة واحدة على الأقل");
      if (!Number(paid)) throw new Error("أدخل مبلغ الدفعة");
      const { error } = await supabase.rpc("app_settle_insurance_claims", {
        p_company_id: companyId,
        p_claims: selected,
        p_paid_total: Number(paid),
        p_reference: reference.trim() || null,
        p_note: note.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["claim-settlement"] });
      queryClient.invalidateQueries({ queryKey: ["insurance-receivables"] });
      toast({ title: "سُجّلت التسوية ووُزّعت على المطالبات" });
      setSelected([]);
      setPaid("");
      setReference("");
      setNote("");
      onClose();
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذرت التسوية",
        description: errorMessage(error),
      }),
  });

  const variance = paid ? Number(paid) - expected : 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>تسجيل تسوية شركة تأمين</DialogTitle>
          <DialogDescription>
            المبلغ يُوزَّع على المطالبات المختارة بنسبة المعتمَد لكلٍّ منها.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>شركة التأمين *</Label>
            <Select
              value={companyId}
              onValueChange={(v) => {
                setCompanyId(v);
                setSelected([]);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="اختر الشركة" />
              </SelectTrigger>
              <SelectContent>
                {(companies.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {companyId && (
            <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border p-2">
              {(claims.data ?? []).map((c) => (
                <label key={c.claim_form_id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(c.claim_form_id)}
                    onChange={(e) =>
                      setSelected((prev) =>
                        e.target.checked
                          ? [...prev, c.claim_form_id]
                          : prev.filter((x) => x !== c.claim_form_id),
                      )
                    }
                  />
                  <span className="flex-1">{c.patient_name}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {Number(c.unsettled_amount).toLocaleString("ar-SA-u-nu-latn")} ر.س
                  </span>
                </label>
              ))}
              {(claims.data ?? []).length === 0 && !claims.isLoading && (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  لا مطالبات معتمَدة غير مسوّاة لهذه الشركة.
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>مبلغ الدفعة *</Label>
              <Input type="number" min={0} value={paid} onChange={(e) => setPaid(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>مرجع الحوالة</Label>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} dir="ltr" />
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label>ملاحظة</Label>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>

          {selected.length > 0 && (
            <div className="rounded-md bg-muted p-3 text-sm">
              المعتمَد على المطالبات المختارة:{" "}
              <span className="font-semibold">{expected.toLocaleString("ar-SA-u-nu-latn")} ر.س</span>
              {paid && (
                <span className={variance === 0 ? "" : "block text-amber-700"}>
                  {variance !== 0 &&
                    `الفرق: ${variance.toLocaleString("ar-SA-u-nu-latn")} ر.س — سيظهر على كل مطالبة`}
                </span>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            disabled={!companyId || selected.length === 0 || !paid || settle.isPending}
            onClick={() => settle.mutate()}
          >
            {settle.isPending ? "جارٍ التسجيل..." : "تسجيل التسوية"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * طابور نفيس.
 *
 * **لا إرسال من هذه الشاشة.** الإدراج في الطابور فقط؛ ومن يرسل فعلًا خدمة
 * خلفية محميّة تحمل مفاتيح الربط — لا المتصفّح. وتسجيل الاستجابة هنا للحالة
 * التي يتعامل فيها الموظف مع بوّابة الشركة يدويًّا.
 */
const NPHIES_STATUS_LABELS: Record<string, string> = {
  queued: "في الطابور",
  sending: "قيد الإرسال",
  sent: "أُرسلت",
  acknowledged: "استُلمت",
  completed: "اكتملت",
  failed: "فشلت",
  cancelled: "ملغاة",
};

function NphiesQueuePanel({ organizationId }: { organizationId: string | undefined }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();

  const messages = useQuery({
    queryKey: ["nphies-queue", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_nphies_queue")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const queueMessage = useMutation({
    mutationFn: async (claimId: string) => {
      if (!organizationId) throw new Error("لا منشأة");
      const { error } = await supabase.rpc("app_queue_nphies_message", {
        p_organization_id: organizationId,
        p_message_type: "claim",
        p_payload: { queued_from: "claims_workspace" },
        p_claim_form_id: claimId,
        p_preauth_id: null,
        p_eligibility_id: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nphies-queue", organizationId] });
      toast({
        title: "أُدرجت الرسالة في الطابور",
        description: "الإرسال الفعليّ من خدمة خلفية — لا من المتصفّح",
      });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الإدراج",
        description: errorMessage(error),
      }),
  });

  const recordResponse = useMutation({
    mutationFn: async ({ id, status, note }: { id: string; status: string; note: string }) => {
      const { error } = await supabase.rpc("app_record_nphies_response", {
        p_message_id: id,
        p_status: status,
        p_response: note ? { manual_note: note } : null,
        p_errors: status === "failed" && note ? { reason: note } : null,
        p_response_id: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nphies-queue", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["claim-settlement"] });
      toast({ title: "سُجّلت الاستجابة" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التسجيل",
        description: errorMessage(error),
      }),
  });

  const ready = useQuery({
    queryKey: ["claims-ready-to-queue", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_claim_settlement")
        .select("claim_form_id, patient_name, claimed_amount")
        .eq("organization_id", organizationId)
        .eq("status", "ready")
        .limit(20);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>طابور نفيس</CardTitle>
        <CardDescription>
          الإدراج في الطابور فقط — **الإرسال الفعليّ من خدمة خلفية محميّة تحمل مفاتيح الربط،
          لا من المتصفّح**. والبيئة الحالية اختبارية.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {(ready.data ?? []).length > 0 && can("insurance.claims") && (
          <div className="rounded-md border p-3">
            <p className="mb-2 text-sm">{(ready.data ?? []).length} مطالبة جاهزة للإرسال.</p>
            {(ready.data ?? []).slice(0, 5).map((c) => (
              <div key={c.claim_form_id} className="flex items-center justify-between text-sm">
                <span>
                  {c.patient_name} — {Number(c.claimed_amount ?? 0).toLocaleString("ar-SA-u-nu-latn")} ر.س
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={queueMessage.isPending}
                  onClick={() => queueMessage.mutate(c.claim_form_id)}
                >
                  إدراج في الطابور
                </Button>
              </div>
            ))}
          </div>
        )}

        {messages.isLoading && <Skeleton className="h-24 w-full" />}
        {!messages.isLoading &&
          (messages.data ?? []).map((m) => (
            <div key={m.id} className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">
                  {m.message_type} · {m.direction === "outbound" ? "صادرة" : "واردة"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(m.created_at).toLocaleString("ar-SA-u-nu-latn")} · بيئة {m.environment}
                  {m.attempt_count > 0 ? ` · ${m.attempt_count} محاولة` : ""}
                </p>
                {/* الدافع ومعرّفه يظهران هنا لأن أكثر الرفض سببه شركة غير مفعَّلة
                    أو معرّف دافع خاطئ — يُقرأ قبل فتح بلاغ مع البوّابة. */}
                {m.payer_name && (
                  <p className="text-xs text-muted-foreground">
                    الدافع: {m.payer_name}
                    {m.payer_id ? ` (${m.payer_id})` : ""}
                    {m.claim_nphies_last_sync_at
                      ? ` · آخر مزامنة ${new Date(m.claim_nphies_last_sync_at).toLocaleString("ar-SA-u-nu-latn")}`
                      : ""}
                  </p>
                )}
                {m.errors && (
                  <p className="text-xs text-destructive">{JSON.stringify(m.errors)}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {m.needs_manual_review && <Badge variant="destructive">تحتاج مراجعة</Badge>}
                <Badge variant={m.status === "failed" ? "destructive" : "secondary"}>
                  {NPHIES_STATUS_LABELS[m.status] ?? m.status}
                </Badge>
                {can("insurance.claims") && !["completed", "cancelled"].includes(m.status) && (
                  <Select
                    value=""
                    onValueChange={(v) => {
                      const note =
                        v === "failed" ? window.prompt("سبب الفشل؟") ?? "" : "";
                      if (v === "failed" && !note.trim()) return;
                      recordResponse.mutate({ id: m.id, status: v, note: note.trim() });
                    }}
                  >
                    <SelectTrigger className="h-8 w-36">
                      <SelectValue placeholder="تسجيل الحالة" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sent">أُرسلت</SelectItem>
                      <SelectItem value="acknowledged">استُلمت</SelectItem>
                      <SelectItem value="completed">اكتملت</SelectItem>
                      <SelectItem value="failed">فشلت</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          ))}
        {!messages.isLoading && (messages.data ?? []).length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">لا رسائل في الطابور.</p>
        )}
      </CardContent>
    </Card>
  );
}
