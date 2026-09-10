import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, RefreshCw } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { usePermissions } from "@/lib/permissions";
import { formatDate, useLocaleSettings } from "@/lib/locale";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import NewClaimFormDialog from "@/components/insurance/NewClaimFormDialog";
import { CLAIM_STATUS_BADGE, CLAIM_STATUS_LABELS } from "@/components/insurance/claim-status";
import { GridFooterCount, ScreenToolbar } from "@/components/shell/ScreenToolbar";

/**
 * نماذج المطالبات (UCAF · DCAF · OCAF) داخل ملفّ المريض.
 *
 * النماذج كانت مبنيّة في شاشة التأمين وحدها، فالطبيب الذي يريد إصدار نموذج
 * لمريضٍ هو واقفٌ في ملفّه يخرج من الملفّ ويبحث عن المريض من جديد — ويفقد
 * سياق ما كان يفعله. النافذة هنا **هي نفسها** نافذة شاشة التأمين بكل قواعدها.
 */

type ClaimFormRow = {
  id: string;
  form_type: string;
  status: string;
  created_at: string;
  doctor: { name_ar: string } | { name_ar: string }[] | null;
};

const FORM_TYPE_LABELS: Record<string, string> = {
  ucaf: "UCAF — نموذج المطالبة الموحّد",
  dcaf: "DCAF — نموذج الأسنان",
  ocaf: "OCAF — نموذج البصريات",
};

function doctorName(value: ClaimFormRow["doctor"]) {
  if (!value) return null;
  return Array.isArray(value) ? (value[0]?.name_ar ?? null) : value.name_ar;
}

export default function ClaimFormsTab({ patientId }: { patientId: string }) {
  const { organization } = useOrganizationAccess();
  const { can } = usePermissions();
  const { calendarDisplay } = useLocaleSettings();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  const forms = useQuery({
    queryKey: ["patient-claim-forms", patientId, organization?.id],
    enabled: Boolean(patientId && organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("insurance_claim_forms")
        .select("id, form_type, status, created_at, doctor:doctors(name_ar)")
        .eq("organization_id", organization!.id)
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as ClaimFormRow[];
    },
  });

  const rows = forms.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <ScreenToolbar
        items={[
          {
            key: "new",
            label: "نموذج مطالبة جديد",
            icon: FilePlus2,
            hidden: !can("insurance.claims"),
            onClick: () => setCreateOpen(true),
          },
          { key: "sep1", separator: true },
          { key: "refresh", label: "تحديث", icon: RefreshCw, onClick: () => void forms.refetch() },
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle>نماذج المطالبات</CardTitle>
          <CardDescription>UCAF وDCAF وOCAF الصادرة لهذا المريض</CardDescription>
        </CardHeader>
        <CardContent>
          {forms.isLoading && <Skeleton className="h-28 w-full" />}
          {forms.isError && (
            <p className="py-6 text-center text-sm text-destructive">
              تعذّر تحميل النماذج: {errorMessage(forms.error)}
            </p>
          )}
          {!forms.isLoading && !forms.isError && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>النوع</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الطبيب</TableHead>
                  <TableHead>الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((form) => (
                  <TableRow key={form.id}>
                    <TableCell className="font-medium">
                      {FORM_TYPE_LABELS[form.form_type] ?? form.form_type}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {formatDate(form.created_at, calendarDisplay)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {doctorName(form.doctor) ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge className={CLAIM_STATUS_BADGE[form.status] ?? "bg-slate-100 text-slate-700"}>
                        {CLAIM_STATUS_LABELS[form.status] ?? form.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                      لم يصدر لهذا المريض نموذج مطالبة بعد.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {!forms.isLoading && !forms.isError && <GridFooterCount count={rows.length} />}
      </Card>

      {createOpen && (
        <NewClaimFormDialog
          open={createOpen}
          onOpenChange={(next) => {
            setCreateOpen(next);
            if (!next) queryClient.invalidateQueries({ queryKey: ["patient-claim-forms", patientId] });
          }}
          organizationId={organization?.id}
        />
      )}
    </div>
  );
}
