import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Banknote,
  CalendarClock,
  CheckCircle2,
  Inbox,
  Loader2,
  StickyNote,
  UserRoundSearch,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";

const TYPE_META: Record<string, { label: string; icon: typeof Inbox }> = {
  call_patient: { label: "استدعاء مريض", icon: UserRoundSearch },
  collect_payment: { label: "تحصيل مبلغ", icon: Banknote },
  note: { label: "ملاحظة", icon: StickyNote },
  follow_up: { label: "موعد متابعة", icon: CalendarClock },
};

/**
 * طلبات الأطباء عند الاستقبال — المرحلة 33.
 *
 * مصدران يظهران في مكانٍ واحد لأن الموظّف واحد: `staff_requests` (استدعاء،
 * تحصيل، ملاحظة) و`appointment_requests` بـ`source='doctor'` (موعد المتابعة).
 * لم يُنشأ جدول ثالث يجمعهما — العرض `v_reception_requests` يجمعهما وقت
 * القراءة، فيبقى لكل طلب جدوله وشاشته الأصلية.
 *
 * **موعد المتابعة يُنهى من شاشة المواعيد لا من هنا**: إنهاؤه يعني حجز موعد
 * فعليّ بطبيب ووقت، وزرٌّ هنا يقول «تمّ» بلا حجز يكذب على الطبيب.
 */
export default function DoctorRequests() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const requests = useQuery({
    queryKey: ["reception-requests", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_reception_requests")
        .select("*")
        .eq("organization_id", organization!.id)
        .eq("status", "pending")
        .order("requested_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const resolve = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "done" | "cancelled" }) => {
      setBusyId(id);
      const { error } = await supabase.rpc("app_resolve_staff_request", {
        p_request_id: id,
        p_status: status,
        p_note: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reception-requests"] });
      toast({ title: "تمّ" });
    },
    onError: (err: any) =>
      toast({
        title: "تعذّر الإغلاق",
        description: err?.message ?? "خطأ غير معروف",
        variant: "destructive",
      }),
    onSettled: () => setBusyId(null),
  });

  const rows = requests.data ?? [];

  if (requests.isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Inbox className="h-4 w-4" />
          طلبات الأطباء
          {rows.length > 0 && <Badge variant="destructive">{rows.length}</Badge>}
        </CardTitle>
        <CardDescription>
          ما يرسله الأطباء من عياداتهم — استدعاء مريض، تحصيل، متابعة، ملاحظة.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {rows.length === 0 && (
          <div className="grid place-items-center gap-2 py-8 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            <span className="text-sm text-muted-foreground">لا طلبات معلّقة</span>
          </div>
        )}

        {rows.map((r) => {
          const meta = TYPE_META[r.request_type] ?? { label: r.request_type, icon: Inbox };
          const Icon = meta.icon;
          const isFollowUp = r.request_type === "follow_up";
          return (
            <div
              key={r.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="gap-1">
                    <Icon className="h-3 w-3" />
                    {meta.label}
                  </Badge>
                  {r.priority === "urgent" && <Badge variant="destructive">عاجل</Badge>}
                  {r.patient_id ? (
                    <Link
                      to={`/patients/${r.patient_id}`}
                      className="font-semibold underline-offset-4 hover:underline"
                    >
                      {r.patient_name ?? "مريض"}
                    </Link>
                  ) : (
                    <span className="font-semibold">—</span>
                  )}
                  {r.patient_phone && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {r.patient_phone}
                    </span>
                  )}
                </div>
                {r.body && <p className="mt-1 text-sm">{r.body}</p>}
                {r.amount != null && (
                  <p className="mt-1 text-sm font-semibold tabular-nums">
                    المبلغ: {Number(r.amount).toLocaleString("ar")}
                  </p>
                )}
                {r.preferred_date && (
                  <p className="mt-1 text-sm">
                    التاريخ المطلوب: {new Date(r.preferred_date).toLocaleDateString("ar")}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  من: {r.doctor_name ?? "—"} · {new Date(r.requested_at).toLocaleString("ar")}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {isFollowUp ? (
                  <Link to="/appointments">
                    <Button size="sm" variant="outline">
                      <CalendarClock className="h-4 w-4" />
                      احجز الموعد
                    </Button>
                  </Link>
                ) : (
                  <>
                    <Button
                      size="sm"
                      disabled={busyId === r.id}
                      onClick={() => resolve.mutate({ id: r.id, status: "done" })}
                    >
                      {busyId === r.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      تمّ
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyId === r.id}
                      onClick={() => resolve.mutate({ id: r.id, status: "cancelled" })}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
