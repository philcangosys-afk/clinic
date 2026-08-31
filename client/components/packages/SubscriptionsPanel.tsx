import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, PauseCircle, PlayCircle, RefreshCcw, RotateCcw, Users, XCircle } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { usePermissions } from "@/lib/permissions";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

/**
 * إدارة اشتراكات المرضى — التجميد والاستئناف والإلغاء والاسترداد والتجديد
 * والنقل (المرحلة 16).
 *
 * الاستهلاك **لا يُدار من هنا**: يُخصم تلقائيًّا عند تنفيذ الخدمة في الزيارة
 * (`trg_auto_consume_package`). ما يبقى للموظّف هو دورة حياة الاشتراك نفسه.
 */

const STATUS: Record<string, { label: string; variant: any }> = {
  active:    { label: "سارٍ",     variant: "success" },
  frozen:    { label: "مجمَّد",    variant: "secondary" },
  expired:   { label: "منتهٍ",    variant: "destructive" },
  consumed:  { label: "مستهلَك",  variant: "outline" },
  cancelled: { label: "ملغى",     variant: "destructive" },
  refunded:  { label: "مسترَدّ",   variant: "outline" },
};

export default function SubscriptionsPanel() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();

  const [status, setStatus] = useState("active");
  const [search, setSearch] = useState("");
  const [cancelling, setCancelling] = useState<any | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [withRefund, setWithRefund] = useState(true);

  const rows = useQuery({
    queryKey: ["patient-subscriptions", organization?.id, status],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      let query = supabase
        .from("v_patient_subscriptions")
        .select("*")
        .eq("organization_id", organization!.id)
        .order("purchased_at", { ascending: false })
        .limit(300);
      if (status !== "all") query = query.eq("effective_status", status);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const filtered = (rows.data ?? []).filter(
    (r) =>
      !search.trim() ||
      String(r.patient_name ?? "").includes(search.trim()) ||
      String(r.package_name ?? "").includes(search.trim()) ||
      String(r.file_number ?? "").includes(search.trim()),
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["patient-subscriptions", organization?.id] });
    queryClient.invalidateQueries({ queryKey: ["patient-package-balances", organization?.id] });
  };
  const fail = (title: string) => (error: unknown) =>
    toast({
      variant: "destructive",
      title,
      description: error instanceof Error ? error.message : "خطأ غير متوقع",
    });

  const freeze = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("app_freeze_patient_package", {
        p_patient_package_id: id,
        p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({
        title: "جُمّد الاشتراك",
        description: "أيّام التجميد تُضاف إلى الصلاحية عند الاستئناف",
      });
    },
    onError: fail("تعذر التجميد"),
  });

  const resume = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("app_resume_patient_package", {
        p_patient_package_id: id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "استُؤنف الاشتراك", description: "مُدّت الصلاحية بأيّام التجميد" });
    },
    onError: fail("تعذر الاستئناف"),
  });

  const renew = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("app_renew_patient_package", {
        p_patient_package_id: id,
        p_note: null,
      });
      if (error) throw error;
      return data as { patient_package_id: string; invoice_id: string };
    },
    onSuccess: () => {
      invalidate();
      toast({
        title: "جُدّد الاشتراك",
        description: "أُنشئت فاتورة مسوّدة للتجديد — أصدرها من شاشة الفوترة",
      });
    },
    onError: fail("تعذر التجديد"),
  });

  /**
   * النقل مقيَّد مرّتين: بقابلية الباقة للنقل، وبأهلية المنقول إليه.
   * بلا الشرط الثاني يصير النقل بابًا خلفيًّا لتجاوز شروط العمر والجنس.
   */
  const transfer = useMutation({
    mutationFn: async ({ id, toPatientId, reason }: {
      id: string; toPatientId: string; reason: string;
    }) => {
      const { error } = await supabase.rpc("app_transfer_patient_package", {
        p_patient_package_id: id,
        p_to_patient_id: toPatientId,
        p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "نُقل الاشتراك" });
    },
    onError: fail("تعذر النقل"),
  });

  const cancel = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("app_cancel_patient_package", {
        p_patient_package_id: cancelling.patient_package_id,
        p_reason: cancelReason.trim(),
        p_refund: withRefund,
      });
      if (error) throw error;
      return data as { refunded_amount: number; credit_note_id: string | null };
    },
    onSuccess: (result) => {
      invalidate();
      setCancelling(null);
      setCancelReason("");
      toast({
        title: "أُلغي الاشتراك",
        description:
          Number(result?.refunded_amount ?? 0) > 0
            ? `صدر إشعار دائن بـ ${Number(result.refunded_amount).toLocaleString("ar-SA")}`
            : "بلا استرداد",
      });
    },
    onError: fail("تعذر الإلغاء"),
  });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            اشتراكات المرضى
          </CardTitle>
          <CardDescription>
            الاستهلاك يُخصم تلقائيًّا عند تنفيذ الخدمة في الزيارة — لا حاجة لخصمه يدويًّا.
            هنا تُدار دورة حياة الاشتراك نفسه.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <div className="flex w-44 flex-col gap-1.5">
            <Label>الحالة</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">السارية</SelectItem>
                <SelectItem value="frozen">المجمَّدة</SelectItem>
                <SelectItem value="expired">المنتهية</SelectItem>
                <SelectItem value="consumed">المستهلَكة</SelectItem>
                <SelectItem value="cancelled">الملغاة</SelectItem>
                <SelectItem value="refunded">المستردَّة</SelectItem>
                <SelectItem value="all">الكل</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-56 flex-1 flex-col gap-1.5">
            <Label>بحث</Label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="اسم المريض أو الباقة أو رقم الملف"
            />
          </div>
          <Button variant="outline" onClick={() => rows.refetch()}>
            <RefreshCcw className="h-4 w-4" />
            تحديث
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="overflow-x-auto pt-4">
          {rows.isLoading && <Skeleton className="h-40 w-full" />}
          {!rows.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المريض</TableHead>
                  <TableHead>الباقة</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>المتبقّي</TableHead>
                  <TableHead>تنتهي</TableHead>
                  <TableHead>المدفوع</TableHead>
                  <TableHead>قيمة غير المستخدَم</TableHead>
                  <TableHead>الفاتورة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.patient_package_id}>
                    <TableCell className="text-sm font-medium">
                      {r.patient_name}
                      {r.file_number && (
                        <span className="ms-2 font-mono text-xs text-muted-foreground">
                          {r.file_number}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.package_name}
                      {r.renewal_count > 0 && (
                        <Badge variant="outline" className="ms-2">
                          تجديد {r.renewal_count}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS[r.effective_status]?.variant ?? "secondary"}>
                        {STATUS[r.effective_status]?.label ?? r.effective_status}
                      </Badge>
                      {r.freeze_reason && r.effective_status === "frozen" && (
                        <span className="ms-2 text-xs text-muted-foreground">
                          {r.freeze_reason}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.total_remaining ?? 0} / {r.total_included ?? 0}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.expires_at
                        ? `${new Date(r.expires_at).toLocaleDateString("ar-SA")}${
                            r.days_remaining !== null ? ` (${r.days_remaining} يومًا)` : ""
                          }`
                        : "بلا انتهاء"}
                      {r.frozen_days > 0 && (
                        <span className="block text-[10px] text-muted-foreground">
                          مُدّدت {r.frozen_days} يومًا تجميدًا
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {Number(r.price_paid ?? 0).toLocaleString("ar-SA")}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {Number(r.unused_value ?? 0).toLocaleString("ar-SA")}
                      {Number(r.refunded_amount ?? 0) > 0 && (
                        <span className="block text-[10px] text-muted-foreground">
                          استُرِدّ {Number(r.refunded_amount).toLocaleString("ar-SA")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.invoice_number ?? "—"}
                      <span className="block text-[10px] text-muted-foreground">
                        {r.invoice_status ?? ""}
                      </span>
                    </TableCell>
                    <TableCell className="text-left">
                      <div className="flex justify-end gap-1">
                        {can("billing.issue") && r.effective_status === "active" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={freeze.isPending}
                            onClick={() => {
                              const reason = window.prompt("سبب التجميد؟") ?? "";
                              if (!reason.trim()) return;
                              freeze.mutate({
                                id: r.patient_package_id,
                                reason: reason.trim(),
                              });
                            }}
                          >
                            <PauseCircle className="h-3.5 w-3.5" />
                            تجميد
                          </Button>
                        )}
                        {can("billing.issue") && r.effective_status === "frozen" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={resume.isPending}
                            onClick={() => resume.mutate(r.patient_package_id)}
                          >
                            <PlayCircle className="h-3.5 w-3.5" />
                            استئناف
                          </Button>
                        )}
                        {can("billing.issue") &&
                          ["active", "expired", "consumed"].includes(r.effective_status) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={renew.isPending}
                              onClick={() => renew.mutate(r.patient_package_id)}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              تجديد
                            </Button>
                          )}
                        {can("billing.issue") &&
                          ["active", "frozen"].includes(r.effective_status) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={transfer.isPending}
                              onClick={() => {
                                const toId = window.prompt("معرّف المريض المنقول إليه؟") ?? "";
                                if (!toId.trim()) return;
                                const reason = window.prompt("سبب النقل؟") ?? "";
                                if (!reason.trim()) return;
                                transfer.mutate({
                                  id: r.patient_package_id,
                                  toPatientId: toId.trim(),
                                  reason: reason.trim(),
                                });
                              }}
                            >
                              <ArrowLeftRight className="h-3.5 w-3.5" />
                              نقل
                            </Button>
                          )}
                        {can("billing.refund") &&
                          ["active", "frozen"].includes(r.effective_status) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setCancelling(r);
                                setWithRefund(Number(r.unused_value ?? 0) > 0);
                              }}
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              إلغاء
                            </Button>
                          )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                      لا اشتراكات في هذه الحالة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <UsageLogPanel />

      <Dialog open={Boolean(cancelling)} onOpenChange={(o) => !o && setCancelling(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إلغاء اشتراك {cancelling?.patient_name}</DialogTitle>
            <DialogDescription>
              الاسترداد يُصدر **إشعارًا دائنًا** على الفاتورة الأصلية ولا يعدّلها. قيمته
              نسبة ما لم يُستخدَم من قيمة الباقة، لا قسمةً على عدد الحصص.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="rounded-md border p-3 text-sm">
              قيمة غير المستخدَم:{" "}
              <span className="font-mono">
                {Number(cancelling?.unused_value ?? 0).toLocaleString("ar-SA")}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="with-refund"
                type="checkbox"
                className="h-4 w-4"
                checked={withRefund}
                onChange={(e) => setWithRefund(e.target.checked)}
              />
              <Label htmlFor="with-refund" className="cursor-pointer">
                استرداد قيمة غير المستخدَم
              </Label>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>سبب الإلغاء *</Label>
              <Input
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="يُسجَّل في سجل التدقيق"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={!cancelReason.trim() || cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              {cancel.isPending ? "جارٍ التنفيذ..." : "تأكيد الإلغاء"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


/**
 * سجل استخدام الباقات — بما فيه المعكوس.
 *
 * الخصم يقع تلقائيًّا عند تنفيذ الخدمة، فقد يقع على خدمة أُلغيت بعد تنفيذها.
 * العكس يردّ الرصيد **ولا يمحو السطر**: الخصم والردّ يظهران معًا، وإلا بدا
 * الرصيد وكأنه لم يُمسّ قطّ.
 */
function UsageLogPanel() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();

  const log = useQuery({
    queryKey: ["package-usage-log", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_package_usage_log")
        .select("*")
        .eq("organization_id", organization!.id)
        .order("report_date", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const reverse = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("app_reverse_package_usage", {
        p_usage_id: id,
        p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["package-usage-log", organization?.id] });
      queryClient.invalidateQueries({ queryKey: ["patient-subscriptions", organization?.id] });
      queryClient.invalidateQueries({ queryKey: ["patient-package-balances", organization?.id] });
      toast({ title: "عُكس الاستخدام", description: "رُدّ الرصيد وبقي أثر الخصم والردّ" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر العكس",
        description: error instanceof Error ? error.message : "خطأ غير متوقع",
      }),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">سجل استخدام الباقات</CardTitle>
        <CardDescription>
          الخصم يقع تلقائيًّا عند تنفيذ الخدمة. العكس يردّ الرصيد ويُبقي السطر شاهدًا.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {log.isLoading && <Skeleton className="h-32 w-full" />}
        {!log.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>التاريخ</TableHead>
                <TableHead>المريض</TableHead>
                <TableHead>الباقة</TableHead>
                <TableHead>الخدمة</TableHead>
                <TableHead>الكمّية</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(log.data ?? []).map((u) => (
                <TableRow key={u.usage_id}>
                  <TableCell className="whitespace-nowrap font-mono text-xs">
                    {new Date(u.report_date).toLocaleString("ar-SA")}
                  </TableCell>
                  <TableCell className="text-sm">{u.patient_name}</TableCell>
                  <TableCell className="text-sm">{u.package_name}</TableCell>
                  <TableCell className="text-sm">{u.item_name}</TableCell>
                  <TableCell className="font-mono text-xs">{u.quantity_used}</TableCell>
                  <TableCell>
                    {u.is_reversed ? (
                      <span className="flex flex-col">
                        <Badge variant="destructive">معكوس</Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {u.reversal_reason}
                        </span>
                      </span>
                    ) : (
                      <Badge variant="success">مخصوم</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-left">
                    {!u.is_reversed && can("billing.issue") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={reverse.isPending}
                        onClick={() => {
                          const reason = window.prompt("سبب عكس الاستخدام؟") ?? "";
                          if (!reason.trim()) return;
                          reverse.mutate({ id: u.usage_id, reason: reason.trim() });
                        }}
                      >
                        عكس
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(log.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                    لا استخدامات مسجَّلة بعد.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
