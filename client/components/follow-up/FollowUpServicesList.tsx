import { ListChecks } from "lucide-react";

import { formatAmount } from "@/lib/locale";
import type { FollowUpService } from "@/components/follow-up/follow-up-meta";

/**
 * خدمات الطبيب في ملاحظة المتابعة (0218) — للاستقبال: الخدمة، وسعرها كما
 * حدّده الطبيب (والكتالوج إن اختلف)، وخصمها، والصافي. لا فاتورة تصدر منها؛
 * الاستقبال يفوتر بها من شاشته.
 */
export default function FollowUpServicesList({ services }: { services: FollowUpService[] | null | undefined }) {
  if (!services || services.length === 0) return null;
  const total = services.reduce((sum, s) => sum + Number(s.net ?? 0), 0);
  return (
    <div className="mt-1.5 rounded-md border border-sky-200 bg-sky-50/60 p-2 text-sm">
      <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-sky-800">
        <ListChecks className="h-3.5 w-3.5" /> خدمات من الطبيب
      </p>
      <table className="w-full text-xs tabular-nums">
        <thead className="text-muted-foreground">
          <tr className="[&>th]:px-1 [&>th]:py-0.5 [&>th]:text-start [&>th]:font-medium">
            <th>الخدمة</th>
            <th>السعر</th>
            <th>الخصم</th>
            <th>الصافي</th>
          </tr>
        </thead>
        <tbody>
          {services.map((s, index) => (
            <tr key={`${s.item_id}-${index}`} className="border-t border-sky-100 [&>td]:px-1 [&>td]:py-0.5">
              <td className="font-medium">
                {s.name}
                {s.code && <span className="ms-1 font-mono text-[10px] text-muted-foreground">{s.code}</span>}
              </td>
              <td>
                {formatAmount(s.price)}
                {s.catalog_price !== null && Number(s.catalog_price) !== Number(s.price) && (
                  <span className="ms-1 text-[10px] text-muted-foreground line-through">{formatAmount(s.catalog_price)}</span>
                )}
              </td>
              <td>{Number(s.discount) > 0 ? formatAmount(s.discount) : "—"}</td>
              <td className="font-semibold">{formatAmount(s.net)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-sky-200 font-bold [&>td]:px-1 [&>td]:py-0.5">
            <td colSpan={3}>الإجمالي</td>
            <td>{formatAmount(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
