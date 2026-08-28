import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Upload, Download, Trash2, Image as ImageIcon } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type { PatientDocumentRow } from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import LookupSelect from "@/components/shared/LookupSelect";
import { useToast } from "@/hooks/use-toast";

/**
 * مستندات وصور المريض (لقطة 41).
 *
 * جدول `patient_documents` موجود منذ 0006 لكن لم يكن هناك مكان فعلي لتخزين
 * الملفات ولا أي واجهة — الميزة كانت معطّلة بالكامل. المهاجرة 0037 تُنشئ دلو
 * التخزين `patient-documents` وسياساته، وهذه الواجهة تستخدمه.
 *
 * مسار التخزين: {organization_id}/{patient_id}/{timestamp}-{filename}
 * سياسات الدلو تتحقق أن المستخدم عضو في المؤسسة التي يمثّلها أول جزء من
 * المسار، فلا يمكن لعضو مؤسسة الوصول لملفات مؤسسة أخرى.
 */
const BUCKET = "patient-documents";
const MAX_FILE_MB = 20;
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];

function isImageFile(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.includes(ext);
}

function usePatientDocuments(patientId: string) {
  return useQuery({
    queryKey: ["patient-documents", patientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_documents")
        .select("*")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PatientDocumentRow[];
    },
  });
}

function UploadDialog({
  open,
  onOpenChange,
  patientId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { organization, session } = useOrganizationAccess();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [docTypeId, setDocTypeId] = useState("");
  const [note, setNote] = useState("");

  const upload = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لا توجد مؤسسة نشطة");
      if (!file) throw new Error("اختر ملفًا أولًا");
      if (file.size > MAX_FILE_MB * 1024 * 1024)
        throw new Error(`حجم الملف يتجاوز ${MAX_FILE_MB} ميجابايت`);

      // اسم آمن: نُزيل المحارف التي قد تكسر المسار ونضيف طابعًا زمنيًا لتفادي
      // تصادم الأسماء المتطابقة.
      const safeName = file.name.replace(/[^\w.\-؀-ۿ]/g, "_");
      const path = `${organization.id}/${patientId}/${Date.now()}-${safeName}`;

      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file);
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from("patient_documents").insert({
        organization_id: organization.id,
        patient_id: patientId,
        category: isImageFile(file.name) ? ("image" as const) : ("document" as const),
        doc_type_value_id: docTypeId || null,
        storage_path: path,
        file_name: file.name,
        note: note.trim() || null,
        uploaded_by: session?.user.id ?? null,
      });
      // لو فشل تسجيل الصف بعد نجاح الرفع نحذف الملف حتى لا يبقى يتيمًا في الدلو
      if (insertError) {
        await supabase.storage.from(BUCKET).remove([path]);
        throw insertError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-documents", patientId] });
      toast({ title: "تم رفع المستند" });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر رفع المستند",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>رفع مستند</DialogTitle>
          <DialogDescription>الحد الأقصى لحجم الملف {MAX_FILE_MB} ميجابايت</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>الملف *</Label>
            <Input
              ref={fileRef}
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file && (
              <p className="text-xs text-muted-foreground">
                {file.name} — {(file.size / 1024 / 1024).toFixed(2)} م.ب
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>نوع المستند</Label>
            <LookupSelect
              categoryKey="patient_document_types"
              value={docTypeId}
              onChange={setDocTypeId}
              placeholder="اختياري"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>ملاحظة</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button onClick={() => upload.mutate()} disabled={upload.isPending || !file}>
            {upload.isPending ? "جارٍ الرفع..." : "رفع"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function DocumentsTab({ patientId }: { patientId: string }) {
  const documents = usePatientDocuments(patientId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [uploadOpen, setUploadOpen] = useState(false);

  /**
   * الدلو خاص (غير عام) فلا يمكن بناء رابط مباشر — نطلب رابطًا موقّتًا
   * صالحًا لدقيقة واحدة عند كل فتح.
   */
  const openDocument = useMutation({
    mutationFn: async (row: PatientDocumentRow) => {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(row.storage_path, 60);
      if (error) throw error;
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر فتح المستند",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  const removeDocument = useMutation({
    mutationFn: async (row: PatientDocumentRow) => {
      const { error: storageError } = await supabase.storage.from(BUCKET).remove([row.storage_path]);
      if (storageError) throw storageError;
      const { data: affectedRows, error } = await supabase.from("patient_documents").delete().eq("id", row.id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-documents", patientId] });
      toast({ title: "تم حذف المستند" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحذف",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              مستندات المريض
            </CardTitle>
            <CardDescription>صور الهوية، بطاقات التأمين، التقارير الخارجية، صور الأشعة</CardDescription>
          </div>
          <Button onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4" />
            رفع مستند
          </Button>
        </CardHeader>
        <CardContent>
          {documents.isLoading && <Skeleton className="h-32 w-full" />}
          {!documents.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الملف</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>ملاحظة</TableHead>
                  <TableHead>تاريخ الرفع</TableHead>
                  <TableHead className="w-28">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(documents.data ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <span className="flex items-center gap-2 font-medium">
                        {row.category === "image" ? (
                          <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate">{row.file_name ?? "بلا اسم"}</span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{row.category === "image" ? "صورة" : "مستند"}</Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                      {row.note ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(row.created_at).toLocaleDateString("ar-SA")}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          title="فتح"
                          onClick={() => openDocument.mutate(row)}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="حذف"
                          onClick={() => removeDocument.mutate(row)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(documents.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد مستندات مرفوعة لهذا المريض.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {uploadOpen && <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} patientId={patientId} />}
    </div>
  );
}
