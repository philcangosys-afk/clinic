import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errorMessage } from "@/lib/error-message";
import { formatAmount, formatDateTime } from "@/lib/locale";

/**
 * ما مُنِح لهذا المريض مجانًا، وما خُصِم له.
 *
 * **الملفّ هو المكان الصحيح لهذا السؤال.** «أعطيته جلسة مجانية» قرارٌ يُتخذ في
 * لحظةٍ ويُسأل عنه بعد شهرين: كم مرّة؟ ومن منح؟ وبأيّ سبب؟ وبلا موضعٍ في
 * الملفّ يبقى الجواب في ذاكرة من كان حاضرًا.
 *
 * **وقيمة المجانيّ بسعر القائمة لا بصفر السطر.** السطر يُسجَّل بصفر — وهو
 * صحيح محاسبيًّا — لكنّ ما تنازلت عنه المنشأة هو سعر الخدمة. ولذلك يحسب
 * `v_complimentary_lines` القيمة من `items.price`، وإلّا بدت السياسة بلا كلفة
 * فلا تُراجَع أبدًا.
 */
export default function PatientBenefitsTab({ patientId }: { patientId: string }) {
  const { organization } = useOrganizationAccess();
  const organizationId = organization?.id;

  const complimentary = useQuery({
    queryKey: ["patient-complimentary", organizationId, patientId],
    enabled: Boolean(organizationId && patientId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_complimentary_lines")
        .select(
          "id, invoice_id, invoice_number, invoice_created_at, invoice_status, item_name, forgone_value, qty, complimentary_reason, granted_by_name, doctor_name, created_at",
        )
        .eq("organization_id", organizationId)
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const discounts = useQuery({
    queryKey: ["patient-line-discounts", organizationId, patientId],
    enabled: Boolean(organizationId && patientId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_line_discounts")
        .select(
          "id, invoice_id, invoice_number, invoice_created_at, item_name, price, qty, discount_percent, discount_amount, discount_value, net_amount, discount_reason, discount_granted_by_name, doctor_name, created_at",
        )
        .eq("organization_id", organizationId)
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const totals = useMemo(() => {
    const compRows = complimentary.data ?? [];
    const discRows = discounts.data ?? [];
    return {
      compCount: compRows.length,
      compValue: compRows.reduce((sum, r) => sum + (Number(r.forgone_value) || 0), 0),
      discCount: discRows.length,
      discValue: discRows.reduce((sum, r) => sum + (Number(r.discount_value) || 0), 0),
    };
  }, [complimentary.data, discounts.data]);

  const missingMigration = (error: unknown) =>
    String(errorMessage(error, "")).includes("does not exist") ||
    String(errorMessage(error, "")).includes("v_complimentary_lines") ||
    String(errorMessage(error, "")).includes("v_line_discounts");

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>خدمات مُنِحت مجانًا</CardDescription>
            <CardTitle className="text-xl tabular-nums">
              {totals.compCount}
              <span className="ms-2 text-sm font-normal text-muted-foreground">
                بقيمة {formatAmount(totals.compValue)} ر.س
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-xs text-muted-foreground">
            القيمة بسعر القائمة — وهي ما تنازلت عنه المنشأة، لا صفر السطر.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>سطور خُصِم عليها</CardDescription>
            <CardTitle className="text-xl tabular-nums">
              {totals.discCount}
              <span className="ms-2 text-sm font-normal text-muted-foreground">
                بمجموع {formatAmount(totals.discValue)} ر.س
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-xs text-muted-foreground">
            الخصم بالريال كما حسبته القاعدة، ومعه سببه ومن منحه.
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">الخدمات المجانية</CardTitle>
          <CardDescription>
            ما مُنِح لهذا المريض بلا مقابل — بأيّ سبب، ومن منحه
          </CardDescription>
        </CardHeader>
        <CardContent>
          {complimentary.isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : complimentary.isError ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              تعذّر القراءة: {errorMessage(complimentary.error, "خطأ غير متوقع")}
              {missingMigration(complimentary.error) && (
                <>
                  <br />
                  ترقية 0167 غير منفَّذة بعد.
                </>
              )}
            </p>
          ) : (complimentary.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">لم تُمنح خدمات مجانية لهذا المريض.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">الفاتورة</TableHead>
                  <TableHead className="text-right">التاريخ</TableHead>
                  <TableHead className="text-right">الخدمة</TableHead>
                  <TableHead className="text-right">الكمية</TableHead>
                  <TableHead className="text-right">القيمة المتنازل عنها</TableHead>
                  <TableHead className="text-right">السبب</TableHead>
                  <TableHead className="text-right">الطبيب</TableHead>
                  <TableHead className="text-right">منحها</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(complimentary.data ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="tabular-nums">{row.invoice_number ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {formatDateTime(row.invoice_created_at)}
                    </TableCell>
                    <TableCell className="font-medium">{row.item_name ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{row.qty ?? 1}</TableCell>
                    <TableCell className="tabular-nums">
                      <Badge className="bg-sky-600 hover:bg-sky-600">
                        {formatAmount(row.forgone_value ?? 0)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{row.complimentary_reason ?? "—"}</TableCell>
                    <TableCell className="text-xs">{row.doctor_name ?? "—"}</TableCell>
                    <TableCell className="text-xs">{row.granted_by_name ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">الخصومات على السطور</CardTitle>
          <CardDescription>«الخدمة بمئة والمريض دفع تسعين» — كم، ولماذا، وبقرار من</CardDescription>
        </CardHeader>
        <CardContent>
          {discounts.isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : discounts.isError ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              تعذّر القراءة: {errorMessage(discounts.error, "خطأ غير متوقع")}
              {missingMigration(discounts.error) && (
                <>
                  <br />
                  ترقية 0167 غير منفَّذة بعد.
                </>
              )}
            </p>
          ) : (discounts.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">لا خصومات على سطور فواتير هذا المريض.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">الفاتورة</TableHead>
                  <TableHead className="text-right">التاريخ</TableHead>
                  <TableHead className="text-right">الخدمة</TableHead>
                  <TableHead className="text-right">السعر</TableHead>
                  <TableHead className="text-right">الخصم</TableHead>
                  <TableHead className="text-right">الصافي</TableHead>
                  <TableHead className="text-right">السبب</TableHead>
                  <TableHead className="text-right">منحه</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(discounts.data ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="tabular-nums">{row.invoice_number ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {formatDateTime(row.invoice_created_at)}
                    </TableCell>
                    <TableCell className="font-medium">{row.item_name ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">
                      {formatAmount(row.price ?? 0)}
                      {Number(row.qty ?? 1) !== 1 && (
                        <span className="text-xs text-muted-foreground"> × {row.qty}</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      <Badge className="bg-rose-600 hover:bg-rose-600">
                        {formatAmount(row.discount_value ?? 0)}
                      </Badge>
                      {Number(row.discount_percent ?? 0) > 0 && (
                        <span className="ms-1 text-[10px] text-muted-foreground">
                          ({row.discount_percent}%)
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">{formatAmount(row.net_amount ?? 0)}</TableCell>
                    <TableCell className="text-xs">{row.discount_reason ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {row.discount_granted_by_name ?? row.doctor_name ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
