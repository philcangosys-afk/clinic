import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Download, ImageOff, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";

const BUCKET = "result-attachments";

/**
 * صور الأشعة في ملف المريض — المرحلة 33.
 *
 * المصدر `v_patient_radiology_images` وحده: الصورة تُسجَّل مرّة في
 * `radiology_images` ولا تُنسخ إلى `patient_documents`. نسختان لملفٍ واحد
 * تفترقان أوّل ما تُحذف إحداهما، فيبقى في الملف مرجعٌ لملفٍ لا وجود له.
 *
 * الفتح برابط موقَّع قصير العمر (60 ثانية) لا برابط عامّ: صورة الأشعة بيانٌ
 * طبيّ، ورابطها الدائم يعني أن من نسخه يفتحها بلا حساب وبلا أثر.
 */
export default function RadiologyImagesTab({ patientId }: { patientId: string }) {
  const [openingId, setOpeningId] = useState<string | null>(null);

  const images = useQuery({
    queryKey: ["patient-radiology-images", patientId],
    enabled: Boolean(patientId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_patient_radiology_images")
        .select("*")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const open = async (row: any) => {
    setOpeningId(row.id);
    try {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(row.file_url, 60);
      if (error) throw error;
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      toast({
        title: "تعذّر فتح الصورة",
        description: err?.message ?? "الملف غير موجود في التخزين",
        variant: "destructive",
      });
    } finally {
      setOpeningId(null);
    }
  };

  if (images.isLoading) return <Skeleton className="h-48 w-full" />;

  const rows = images.data ?? [];

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="grid place-items-center gap-2 py-10 text-center">
          <ImageOff className="h-9 w-9 text-muted-foreground" />
          <span className="font-medium">لا صور أشعة</span>
          <span className="text-sm text-muted-foreground">
            ما يرفعه قسم الأشعة لهذا المريض يظهر هنا.
          </span>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-1">
                <Activity className="h-3 w-3" />
                {r.exam_name ?? "فحص"}
              </Badge>
              <span className="truncate text-sm font-medium">{r.file_name}</span>
            </div>
            {r.note && <p className="mt-1 text-sm text-muted-foreground">{r.note}</p>}
            <p className="mt-1 text-xs text-muted-foreground">
              {new Date(r.created_at).toLocaleString("ar")}
              {r.doctor_name ? ` · بطلب ${r.doctor_name}` : ""}
              {r.size_bytes ? ` · ${(Number(r.size_bytes) / 1024).toFixed(0)} ك.ب` : ""}
            </p>
          </div>
          <Button size="sm" variant="outline" disabled={openingId === r.id} onClick={() => open(r)}>
            {openingId === r.id ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            فتح
          </Button>
        </div>
      ))}
    </div>
  );
}
