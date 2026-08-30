import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ROW_CAP = 500;

/**
 * خدمات نُفِّذت ولم تصل إلى فاتورة.
 *
 * هذا التقرير يقيس تسرّبًا لا نشاطًا: كل سطر هنا عملٌ أُنجز ولم يُحاسَب
 * عليه أحد. وترتيبه بالأقدم أولًا مقصود — خدمة عمرها ثلاثون يومًا أصعب
 * تحصيلًا من خدمة الأمس، لأن المريض غادر ولا أحد يذكر التفاصيل.
 */
export default function UnbilledServices() {
  const { organization } = useOrganizationAccess();
  const organizationId = organization?.id;
  const [minDays, setMinDays] = useState("0");

  const rows = useQuery({
    queryKey: ["unbilled-services", organizationId, minDays],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let query = supabase
        .from("v_unbilled_performed_services")
        .select(
          "id, patient_name, file_number, item_name, medical_service_type, qty, unit_price, line_total, doctor_name, visit_date, days_since_visit, status",
        )
        .eq("organization_id", organizationId)
        .order("days_since_visit", { ascending: false })
        .limit(ROW_CAP);
      if (minDays !== "0") query = query.gte("days_since_visit", Number(minDays));
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const total = useMemo(
    () => (rows.data ?? []).reduce((sum, row) => sum + (Number(row.line_total) || 0), 0),
    [rows.data],
  );

  const exportCsv = () => {
    const headers = ["المريض", "رقم الملف", "الخدمة", "الطبيب", "الكمية", "السعر", "الإجمالي", "تاريخ الزيارة", "الأيام"];
    const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      headers.join(","),
      ...(rows.data ?? []).map((row) =>
        [
          row.patient_name,
          row.file_number,
          row.item_name,
          row.doctor_name,
          row.qty,
          row.unit_price,
          row.line_total,
          row.visit_date,
          row.days_since_visit,
        ]
          .map(escape)
          .join(","),
      ),
    ];
    // BOM كي تفتح Excel العربية بترميز صحيح بدل حروف مشوّشة.
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `unbilled-services-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              خدمات نُفِّذت ولم تُفوتَر
            </CardTitle>
            <CardDescription>
              كل سطر هنا عملٌ أُنجز ولم يُحاسَب عليه — الأقدم أولًا.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={minDays} onValueChange={setMinDays}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">كل الفترات</SelectItem>
                <SelectItem value="1">أقدم من يوم</SelectItem>
                <SelectItem value="7">أقدم من أسبوع</SelectItem>
                <SelectItem value="30">أقدم من شهر</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={exportCsv} disabled={(rows.data ?? []).length === 0}>
              <Download className="h-4 w-4" />
              تصدير
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Badge variant="secondary">{(rows.data ?? []).length} خدمة</Badge>
          <Badge variant="outline">الإجمالي {total.toLocaleString("ar-SA")} ر.س</Badge>
          {(rows.data ?? []).length >= ROW_CAP && (
            <span className="text-xs text-muted-foreground">
              يُعرض أول {ROW_CAP} سطر — ضيّق الفترة
            </span>
          )}
        </div>

        {rows.isLoading && (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-11 w-full" />
            ))}
          </div>
        )}
        {rows.isError && (
          <p className="py-6 text-center text-sm text-destructive">
            تعذّر التحميل: {(rows.error as Error)?.message}
          </p>
        )}
        {!rows.isLoading && !rows.isError && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>المريض</TableHead>
                <TableHead>الخدمة</TableHead>
                <TableHead>الطبيب</TableHead>
                <TableHead>الكمية</TableHead>
                <TableHead>الإجمالي</TableHead>
                <TableHead>تاريخ الزيارة</TableHead>
                <TableHead>منذ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rows.data ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    {row.patient_name}
                    {row.file_number && (
                      <span className="ms-2 font-mono text-xs text-muted-foreground">
                        {row.file_number}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{row.item_name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{row.doctor_name ?? "—"}</TableCell>
                  <TableCell>{row.qty}</TableCell>
                  <TableCell>{Number(row.line_total).toLocaleString("ar-SA")} ر.س</TableCell>
                  <TableCell className="font-mono text-xs">
                    {String(row.visit_date).slice(0, 10)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        row.days_since_visit >= 30
                          ? "destructive"
                          : row.days_since_visit >= 7
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {row.days_since_visit} يوم
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {(rows.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد خدمات منفَّذة بانتظار الفوترة.
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
