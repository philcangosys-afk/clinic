import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip, Upload, Download, Trash2, ImageIcon, FileText } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { storageFileName } from "@/lib/storage-key";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";

/**
 * مرفقات نتائج المختبر وصور الأشعة (لقطتا 121 و122).
 *
 * جدولا `lab_result_attachments` (0013) و`radiology_images` (0014) موجودان
 * وفيهما `file_url`، لكن لم يكن هناك دلو تخزين — فبقيت الميزة معطّلة تمامًا:
 * نتيجة أشعة بلا صورة، ونتيجة مختبر بلا ورقة التحليل الأصلية. الدلو أُنشئ في
 * 0045، وهذا المكوّن هو المستهلك.
 *
 * مكوّن واحد للجدولين: بنيتهما متطابقة عدا اسم عمود المفتاح الأجنبي.
 */
export type AttachmentKind = "lab" | "radiology";

const BUCKET = "result-attachments";
const MAX_FILE_MB = 20;

const CONFIG: Record<AttachmentKind, { table: string; fk: string; label: string }> = {
  lab: { table: "lab_result_attachments", fk: "lab_order_id", label: "مرفقات النتيجة" },
  radiology: { table: "radiology_images", fk: "radiology_order_item_id", label: "صور الأشعة" },
};

type AttachmentRow = {
  id: string;
  file_url: string;
  file_name: string | null;
  created_at: string;
};

function isImageFile(name: string) {
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);
}

export default function ResultAttachments({
  kind,
  parentId,
  readOnly = false,
}: {
  kind: AttachmentKind;
  /** معرّف طلب المختبر، أو معرّف بند طلب الأشعة */
  parentId: string;
  readOnly?: boolean;
}) {
  const { organization, session } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const config = CONFIG[kind];

  const attachments = useQuery({
    queryKey: ["result-attachments", kind, parentId],
    enabled: Boolean(parentId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from(config.table)
        .select("id, file_url, file_name, created_at")
        .eq(config.fk, parentId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AttachmentRow[];
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["result-attachments", kind, parentId] });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!organization?.id) throw new Error("لا توجد منشأة نشطة");
      if (file.size > MAX_FILE_MB * 1024 * 1024)
        throw new Error(`حجم الملف يتجاوز ${MAX_FILE_MB} ميجابايت`);

      // المسار يبدأ بمعرّف المنشأة لأن سياسات الدلو (0045) تبني عليه صلاحية
      // الوصول. الاسم يُنظَّف من المحارف التي قد تكسر المسار، ويُسبَق بطابع
      // زمني لتفادي تصادم الأسماء المتطابقة.
      const path = `${organization.id}/${kind}/${parentId}/${Date.now()}-${storageFileName(file.name)}`;

      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file);
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from(config.table).insert({
        [config.fk]: parentId,
        file_url: path,
        file_name: file.name,
        uploaded_by: session?.user.id ?? null,
      });
      // فشل تسجيل الصف بعد نجاح الرفع يترك ملفًا يتيمًا في الدلو لا يظهر في
      // أي واجهة ولا يمكن حذفه — فيُحذف فورًا.
      if (insertError) {
        await supabase.storage.from(BUCKET).remove([path]);
        throw insertError;
      }
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "تم رفع المرفق" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الرفع",
        description: errorMessage(error),
      }),
  });

  /**
   * الرابط موقَّع ومؤقَّت (60 ثانية) لا عام: نتائج المرضى بيانات صحية، ورابط
   * دائم يبقى صالحًا لمن نسخه حتى بعد انتهاء صلاحيته في النظام.
   */
  const openFile = async (row: AttachmentRow) => {
    setBusy(true);
    try {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(row.file_url, 60);
      if (error) throw error;
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "تعذر فتح الملف",
        description: errorMessage(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = useMutation({
    mutationFn: async (row: AttachmentRow) => {
      // الملف أولًا ثم الصف: العكس يترك ملفًا يتيمًا لا مرجع له لو فشل الحذف
      // الثاني — واليتيم في الدلو لا سبيل للوصول إليه لحذفه لاحقًا.
      const { error: storageError } = await supabase.storage.from(BUCKET).remove([row.file_url]);
      if (storageError) throw storageError;
      const { data, error } = await supabase
        .from(config.table)
        .delete()
        .eq("id", row.id)
        .select("id");
      if (error) throw error;
      // حذف لا يطابق صفًا ليس خطأً في PostgREST — بلا هذا الفحص تظهر رسالة
      // "تم حذف المرفق" ثم يعود المرفق للظهور عند أول تحديث للقائمة.
      if (!data || data.length === 0)
        throw new Error("لم يُحذف سجل المرفق — راجع صلاحيتك ثم أعد المحاولة");
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "تم حذف المرفق" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحذف",
        description: errorMessage(error),
      }),
  });

  const rows = attachments.data ?? [];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
          {config.label}
          {rows.length > 0 && <span className="text-xs text-muted-foreground">({rows.length})</span>}
        </span>
        {!readOnly && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={upload.isPending}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              {upload.isPending ? "جارٍ الرفع..." : "رفع ملف"}
            </Button>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept="image/*,application/pdf"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
                // تصفير القيمة حتى يعمل اختيار نفس الملف مرة أخرى
                e.target.value = "";
              }}
            />
          </>
        )}
      </div>

      {attachments.isLoading && <Skeleton className="h-10 w-full" />}

      {!attachments.isLoading && rows.length === 0 && (
        <p className="text-xs text-muted-foreground">
          لا توجد مرفقات. الحد الأقصى للملف {MAX_FILE_MB} ميجابايت (صور أو PDF).
        </p>
      )}

      {rows.map((row) => (
        <div key={row.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5">
          {isImageFile(row.file_name ?? "") ? (
            <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate text-sm">{row.file_name ?? "ملف"}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {new Date(row.created_at).toLocaleDateString("ar-SA")}
          </span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => openFile(row)} title="فتح">
            <Download className="h-3.5 w-3.5" />
          </Button>
          {!readOnly && (
            <Button
              size="sm"
              variant="ghost"
              disabled={remove.isPending}
              onClick={() => remove.mutate(row)}
              title="حذف"
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
