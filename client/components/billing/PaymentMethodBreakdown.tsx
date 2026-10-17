import { useQuery } from "@tanstack/react-query";
import { Banknote, CreditCard, Wallet } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
import { formatAmount } from "@/lib/locale";

/**
 * المحصَّل حسب طريقة الدفع لأيام العمل المعروضة — طلب المالك (17/10/2026):
 * «في صفحة الفواتير أضف في الأعلى: نقدي كم، شبكة كم، تمارا كم… حسب نوع الدفع».
 *
 * المصدر `v_business_day_collections` نفسه الذي تقرأه اليومية: سندات القبض
 * ناقص استرداد المرضى، مجمّعةً بطريقة الدفع لكلّ يوم عمل (سداد الموردين
 * والمصروفات خارجه منذ 0243). فرقم الشاشتين واحد.
 */

type CollectionRow = {
  business_day_id: string;
  method_name: string;
  affects_drawer: boolean;
  vouchers_count: number;
  amount: number;
};

type MethodTotal = { name: string; amount: number; count: number; cash: boolean };

export function usePaymentMethodBreakdown(
  organizationId: string | undefined,
  from: string | null,
  to: string | null,
) {
  return useQuery({
    queryKey: ["payment-method-breakdown", organizationId, from, to],
    enabled: Boolean(organizationId && from && to),
    staleTime: 30_000,
    queryFn: async () => {
      const days = await supabase
        .from("business_days")
        .select("id")
        .eq("organization_id", organizationId!)
        .gte("business_date", from!)
        .lte("business_date", to!);
      if (days.error) throw days.error;
      const ids = (days.data ?? []).map((row: { id: string }) => row.id);
      if (ids.length === 0) return [] as MethodTotal[];

      const totals = new Map<string, MethodTotal>();
      // دفعاتٌ من 200 يوم عمل — رابط الطلب لا يطول بلا حدّ
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await supabase
          .from("v_business_day_collections")
          .select("business_day_id, method_name, affects_drawer, vouchers_count, amount")
          .in("business_day_id", ids.slice(i, i + 200));
        if (error) throw error;
        for (const row of (data ?? []) as CollectionRow[]) {
          const current = totals.get(row.method_name) ?? {
            name: row.method_name,
            amount: 0,
            count: 0,
            cash: Boolean(row.affects_drawer),
          };
          current.amount += Number(row.amount ?? 0);
          current.count += Number(row.vouchers_count ?? 0);
          totals.set(row.method_name, current);
        }
      }
      return [...totals.values()].sort((a, b) => b.amount - a.amount);
    },
  });
}

export default function PaymentMethodBreakdown({
  organizationId,
  from,
  to,
}: {
  organizationId: string | undefined;
  from: string | null;
  to: string | null;
}) {
  const breakdown = usePaymentMethodBreakdown(organizationId, from, to);
  const rows = breakdown.data ?? [];
  const total = rows.reduce((sum, row) => sum + row.amount, 0);

  if (breakdown.isError) {
    return (
      <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        تعذّر حساب المحصَّل حسب طريقة الدفع: {errorMessage(breakdown.error)}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-muted/20 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <Wallet className="h-4 w-4 text-primary" />
          المحصَّل حسب طريقة الدفع
        </span>
        <span className="text-xs text-muted-foreground">
          سندات القبض ناقص الاسترداد في أيام العمل المعروضة — كما في اليومية
        </span>
      </div>
      {breakdown.isLoading ? (
        <div className="h-14 animate-pulse rounded-lg bg-muted" />
      ) : rows.length === 0 ? (
        <p className="py-2 text-center text-xs text-muted-foreground">لا تحصيل في هذه المدّة.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {rows.map((row) => (
            <div key={row.name} className="rounded-lg border bg-background p-2.5">
              <p className="flex items-center gap-1 truncate text-xs text-muted-foreground" title={row.name}>
                {row.cash ? <Banknote className="h-3.5 w-3.5 shrink-0" /> : <CreditCard className="h-3.5 w-3.5 shrink-0" />}
                {row.name}
              </p>
              <p className="mt-0.5 text-base font-bold tabular-nums" dir="ltr">
                {formatAmount(row.amount)}
              </p>
              <p className="text-[11px] text-muted-foreground">{row.count} سند</p>
            </div>
          ))}
          <div className="rounded-lg border-2 border-primary/40 bg-primary/5 p-2.5">
            <p className="text-xs font-semibold text-primary">الإجمالي المحصَّل</p>
            <p className="mt-0.5 text-base font-bold tabular-nums text-primary" dir="ltr">
              {formatAmount(total)}
            </p>
            <p className="text-[11px] text-muted-foreground">{rows.reduce((s, r) => s + r.count, 0)} سند</p>
          </div>
        </div>
      )}
    </div>
  );
}
