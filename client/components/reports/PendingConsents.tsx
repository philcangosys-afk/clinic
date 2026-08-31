import { useQuery } from "@tanstack/react-query";
import { FileSignature } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/**
 * خدمات تتطلّب إقرارًا موقَّعًا ولم يُوقَّع.
 *
 * `items.requires_consent` يقول إن الخدمة تحتاج إقرارًا، و`patient_documents`
 * فيه `is_consent` و`signed_at` — لكن لم يكن أحد يصل بين الطرفين، فالنظام
 * يعرف أن الإقرار مطلوب ولا يعرف هل وُقِّع. هذه الشاشة تغلق الحلقة.
 */
export default function PendingConsents() {
  const { organization } = useOrganizationAccess();
  const organizationId = organization?.id;

  const rows = useQuery({
    queryKey: ["pending-consents", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_pending_consents")
        .select(
          "visit_service_id, patient_name, file_number, item_name, consent_note_ar, visit_date, status, consent_status, consent_override_reason",
        )
        .eq("organization_id", organizationId)
        .neq("consent_status", "signed")
        .order("visit_date", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileSignature className="h-4 w-4 text-muted-foreground" />
          إقرارات مطلوبة ولم تُوقَّع
        </CardTitle>
        <CardDescription>
          خدمات مسجَّلة تشترط إقرارًا، ولا يوجد إقرار موقَّع سارٍ **لهذا الإجراء
          تحديدًا** — إقرار إجراءٍ آخر لا يُحتسب.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Badge variant="secondary" className="self-start">
          {(rows.data ?? []).length} خدمة
        </Badge>

        {rows.isLoading && (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, index) => (
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
                <TableHead>نصّ الإقرار</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>تاريخ الزيارة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rows.data ?? []).map((row) => (
                <TableRow key={row.visit_service_id}>
                  <TableCell className="font-medium">
                    {row.patient_name}
                    {row.file_number && (
                      <span className="ms-2 font-mono text-xs text-muted-foreground">
                        {row.file_number}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{row.item_name}</TableCell>
                  <TableCell className="max-w-md text-sm text-muted-foreground">
                    {row.consent_note_ar ?? "—"}
                  </TableCell>
                  <TableCell>
                    {row.consent_override_reason ? (
                      <Badge variant="secondary" title={row.consent_override_reason}>
                        نُفّذ بتجاوز موثَّق
                      </Badge>
                    ) : (
                      <Badge variant="destructive">
                        {row.consent_status === "expired" ? "موافقة منتهية" : "بلا موافقة"}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {String(row.visit_date).slice(0, 10)}
                  </TableCell>
                </TableRow>
              ))}
              {(rows.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد إقرارات معلّقة.
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
