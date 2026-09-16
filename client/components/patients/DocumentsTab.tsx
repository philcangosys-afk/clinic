import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive, Download, FileSignature, FileText, Image as ImageIcon, Upload, Wand2,
} from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { usePermissions } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import LookupSelect from "@/components/shared/LookupSelect";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";

/**
 * مستندات المريض وموافقاته — المرحلة 22.
 *
 * ما تغيّر عن النسخة السابقة، ولماذا:
 *
 *  1) التسجيل صار عبر `app_register_patient_document` بدل `insert` مباشر:
 *     الدالّة تولّد رقم المستند، وتتحقّق أن الموافقة مرتبطة بخدمة تطلبها،
 *     وتكتب في سجل التدقيق. الإدراج المباشر كان يتجاوز ذلك كله.
 *  2) **لا حذف**: المستند الطبي يُؤرشف بسبب موثَّق. القاعدة نفسها تمنع
 *     الحذف الآن، فزر الحذف القديم كان سيفشل على أي حال.
 *  3) التوقيع صار سجلًّا حقيقيًّا: من وقّع، بأيّ صفة، بأيّ وسيلة، وصورة
 *     توقيعه محفوظة — لا مجرد ختم `signed_at`.
 *  4) الموافقة تُولَّد من قالب بحقول المريض الحقيقية، فلا تُطبع بفراغات.
 */
const BUCKET = "patient-documents";
const MAX_FILE_MB = 20;
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];

function isImageFile(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.includes(ext);
}

function safePath(orgId: string, patientId: string, name: string) {
  const safeName = name.replace(/[^\w.\-؀-ۿ]/g, "_");
  return `${orgId}/${patientId}/${Date.now()}-${safeName}`;
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
      return (data ?? []) as any[];
    },
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * لوحة التوقيع — يُرسم بالإصبع أو الفأرة ويُحفظ صورةً في التخزين
 * ════════════════════════════════════════════════════════════════════════ */
function SignaturePad({ onChange }: { onChange: (blank: boolean) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111111";
  }, []);

  const pos = (e: any) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const point = e.touches?.[0] ?? e;
    return {
      x: ((point.clientX - rect.left) / rect.width) * canvas.width,
      y: ((point.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const start = (e: any) => {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawing.current = true;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = (e: any) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    if (!dirty.current) {
      dirty.current = true;
      onChange(false);
    }
  };
  const end = () => { drawing.current = false; };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    dirty.current = false;
    onChange(true);
  };

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        width={600}
        height={200}
        className="w-full touch-none rounded-md border bg-white"
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}
        data-signature-pad="1"
      />
      <Button type="button" variant="ghost" size="sm" className="self-start" onClick={clear}>
        مسح التوقيع
      </Button>
    </div>
  );
}

async function canvasBlob(): Promise<Blob | null> {
  const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-signature-pad="1"]');
  if (!canvas) return null;
  return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

/* ══════════════════════════════════════════════════════════════════════════
 * رفع مستند
 * ════════════════════════════════════════════════════════════════════════ */
function UploadDialog({
  open, onOpenChange, patientId,
}: { open: boolean; onOpenChange: (open: boolean) => void; patientId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { organization } = useOrganizationAccess();
  const [file, setFile] = useState<File | null>(null);
  const [docTypeId, setDocTypeId] = useState("");
  const [note, setNote] = useState("");
  const [isConsent, setIsConsent] = useState(false);
  const [itemId, setItemId] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  // الخدمات التي تطلب موافقة فقط — لا معنى لربط موافقة بغيرها
  const consentItems = useQuery({
    queryKey: ["consent-items", organization?.id],
    enabled: Boolean(organization?.id) && isConsent,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items").select("id, name_ar, code")
        .eq("organization_id", organization!.id)
        .eq("requires_consent", true)
        .eq("is_disabled", false)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const upload = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لا توجد مؤسسة نشطة");
      if (!file) throw new Error("اختر ملفًا أولًا");
      if (file.size > MAX_FILE_MB * 1024 * 1024)
        throw new Error(`حجم الملف يتجاوز ${MAX_FILE_MB} ميجابايت`);

      const path = safePath(organization.id, patientId, file.name);
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file);
      if (uploadError) throw uploadError;

      const { error } = await supabase.rpc("app_register_patient_document", {
        p_patient_id: patientId,
        p_storage_path: path,
        p_file_name: file.name,
        p_category: isImageFile(file.name) ? "image" : "document",
        p_visit_id: null,
        p_item_id: isConsent && itemId ? itemId : null,
        p_is_consent: isConsent,
        p_expires_at: expiresAt || null,
        p_mime_type: file.type || null,
        p_size_bytes: file.size,
        p_template_id: null,
        p_generated_document_id: null,
        p_doc_type_value_id: docTypeId || null,
        p_note: note.trim() || null,
      });
      // فشل تسجيل الصف بعد نجاح الرفع يترك ملفًا يتيمًا في الدلو — يُحذف فورًا
      if (error) {
        await supabase.storage.from(BUCKET).remove([path]);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-documents", patientId] });
      toast({ title: "تم رفع المستند" });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذر رفع المستند",
        description: errorMessage(error),
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
            <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
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
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={isConsent}
                   onChange={(e) => setIsConsent(e.target.checked)} />
            هذا مستند موافقة
          </label>
          {isConsent && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label>الإجراء الذي تغطّيه الموافقة</Label>
                <Select value={itemId} onValueChange={setItemId}>
                  <SelectTrigger><SelectValue placeholder="موافقة عامة لهذه الزيارة" /></SelectTrigger>
                  <SelectContent>
                    {(consentItems.data ?? []).map((i) => (
                      <SelectItem key={i.id} value={i.id}>{i.name_ar}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-[10px] text-muted-foreground">
                  موافقة إجراءٍ لا تُبيح إجراءً آخر — اختر الإجراء بدقّة
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>تنتهي في</Label>
                <Input type="date" value={expiresAt}
                       onChange={(e) => setExpiresAt(e.target.value)} />
              </div>
            </>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>ملاحظة</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={() => upload.mutate()} disabled={upload.isPending || !file}>
            {upload.isPending ? "جارٍ الرفع..." : "رفع"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * توليد موافقة من قالب
 * ════════════════════════════════════════════════════════════════════════ */
function GenerateDialog({
  open, onOpenChange, patientId,
}: { open: boolean; onOpenChange: (open: boolean) => void; patientId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { organization } = useOrganizationAccess();
  const [templateId, setTemplateId] = useState("");
  const [itemId, setItemId] = useState("");
  const [isConsent, setIsConsent] = useState(true);

  const templates = useQuery({
    queryKey: ["doc-templates-active", organization?.id],
    enabled: Boolean(organization?.id) && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_templates").select("id, name_ar, applies_to")
        .eq("organization_id", organization!.id)
        .eq("is_disabled", false)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const consentItems = useQuery({
    queryKey: ["consent-items", organization?.id],
    enabled: Boolean(organization?.id) && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items").select("id, name_ar")
        .eq("organization_id", organization!.id)
        .eq("requires_consent", true)
        .eq("is_disabled", false)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const generate = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لا توجد مؤسسة نشطة");
      const { data: genId, error } = await supabase.rpc("app_render_document_template", {
        p_template_id: templateId,
        p_patient_id: patientId,
        p_employee_id: null,
        p_visit_id: null,
        p_extra: {},
      });
      if (error) throw error;

      // المستند المولَّد يُحفظ نصًّا في التخزين ليُطبع ويُوقَّع كأيّ مستند
      const { data: gen, error: readErr } = await supabase
        .from("generated_documents").select("title, body_html").eq("id", genId).single();
      if (readErr) throw readErr;

      const path = safePath(organization.id, patientId, `${gen.title}.html`);
      const blob = new Blob([gen.body_html ?? ""], { type: "text/html;charset=utf-8" });
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob);
      if (upErr) throw upErr;

      const { error: regErr } = await supabase.rpc("app_register_patient_document", {
        p_patient_id: patientId,
        p_storage_path: path,
        p_file_name: `${gen.title}.html`,
        p_category: "document",
        p_visit_id: null,
        p_item_id: isConsent && itemId ? itemId : null,
        p_is_consent: isConsent,
        p_expires_at: null,
        p_mime_type: "text/html",
        p_size_bytes: blob.size,
        p_template_id: templateId,
        p_generated_document_id: genId,
        p_doc_type_value_id: null,
        p_note: null,
      });
      if (regErr) {
        await supabase.storage.from(BUCKET).remove([path]);
        throw regErr;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-documents", patientId] });
      toast({
        title: "وُلّد المستند من القالب",
        description: "وقّعه من زر التوقيع ليصير موافقة سارية",
      });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذر التوليد",
        description: errorMessage(error),
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>توليد مستند من قالب</DialogTitle>
          <DialogDescription>
            تُعبَّأ حقول القالب من بيانات المريض الحقيقية. أيّ حقل لا يجد قيمته
            يوقف التوليد بدل أن يُطبع فارغًا.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>القالب *</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger><SelectValue placeholder="اختر قالبًا" /></SelectTrigger>
              <SelectContent>
                {(templates.data ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name_ar}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={isConsent}
                   onChange={(e) => setIsConsent(e.target.checked)} />
            هذا مستند موافقة
          </label>
          {isConsent && (
            <div className="flex flex-col gap-1.5">
              <Label>الإجراء الذي تغطّيه</Label>
              <Select value={itemId} onValueChange={setItemId}>
                <SelectTrigger><SelectValue placeholder="موافقة عامة" /></SelectTrigger>
                <SelectContent>
                  {(consentItems.data ?? []).map((i) => (
                    <SelectItem key={i.id} value={i.id}>{i.name_ar}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button disabled={!templateId || generate.isPending}
                  onClick={() => generate.mutate()}>
            توليد
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * التوقيع على مستند
 * ════════════════════════════════════════════════════════════════════════ */
function SignDialog({
  document: doc, onOpenChange, patientId,
}: { document: any | null; onOpenChange: (open: boolean) => void; patientId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { organization } = useOrganizationAccess();
  const [role, setRole] = useState("patient");
  const [name, setName] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [relation, setRelation] = useState("");
  const [method, setMethod] = useState("on_screen");
  const [blank, setBlank] = useState(true);
  /**
   * صورة النسخة الموقَّعة على ورق. `app_sign_document` ترفض التوقيع بلا مسار
   * صورة في **كلتا** الوسيلتين (`on_screen` و`paper_scan`)، فوسيلة «نسخة
   * ممسوحة ضوئيًّا» بلا حقل رفع كانت بابًا مسدودًا: كل حفظ يُرفض برسالة
   * «صورة التوقيع مطلوبة لهذه الوسيلة»، ولا سبيل لتسجيل موافقة ورقية.
   */
  const [scanFile, setScanFile] = useState<File | null>(null);

  const signatures = useQuery({
    queryKey: ["document-signatures", doc?.id],
    enabled: Boolean(doc?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_document_signatures").select("*")
        .eq("document_id", doc!.id)
        .order("signed_at");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const sign = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لا توجد مؤسسة نشطة");
      let path: string | null = null;
      if (method === "on_screen") {
        const blob = await canvasBlob();
        if (!blob) throw new Error("ارسم التوقيع أولًا");
        path = safePath(organization.id, patientId, "signature.png");
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob);
        if (upErr) throw upErr;
      } else if (method === "paper_scan") {
        if (!scanFile) throw new Error("اختر صورة النسخة الموقَّعة");
        if (scanFile.size > MAX_FILE_MB * 1024 * 1024)
          throw new Error(`حجم الملف يتجاوز ${MAX_FILE_MB} ميجابايت`);
        path = safePath(organization.id, patientId, scanFile.name);
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, scanFile);
        if (upErr) throw upErr;
      }
      const { error } = await supabase.rpc("app_sign_document", {
        p_kind: "patient_document",
        p_document_id: doc.id,
        p_signer_role: role,
        p_signer_name: name.trim(),
        p_method: method,
        p_signature_path: path,
        p_signer_id_number: idNumber.trim() || null,
        p_relation: relation.trim() || null,
        p_note: null,
      });
      if (error) {
        if (path) await supabase.storage.from(BUCKET).remove([path]);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-documents", patientId] });
      queryClient.invalidateQueries({ queryKey: ["document-signatures", doc?.id] });
      toast({ title: "سُجّل التوقيع" });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذر التوقيع",
        description: errorMessage(error),
      }),
  });

  const ROLES: Record<string, string> = {
    patient: "المريض", guardian: "وليّ الأمر", doctor: "الطبيب",
    nurse: "الممرّض/ة", witness: "شاهد", employee: "موظف", other: "أخرى",
  };

  return (
    <Dialog open={Boolean(doc)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>توقيع — {doc?.file_name ?? "مستند"}</DialogTitle>
          <DialogDescription>
            التوقيع سجلٌّ دائم لا يُعدَّل ولا يُحذف: يُسجَّل من وقّع وبأيّ صفة
            وبأيّ وسيلة ومتى.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {(signatures.data ?? []).length > 0 && (
            <div className="rounded-md border p-2 text-xs">
              <span className="font-medium">وقّع سابقًا:</span>
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                {(signatures.data ?? []).map((s) => (
                  <li key={s.id}>
                    {ROLES[s.signer_role] ?? s.signer_role} — {s.signer_name} ·{" "}
                    {new Date(s.signed_at).toLocaleString("ar-SA")}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>الصفة *</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ROLES).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>اسم الموقِّع *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>رقم الهوية</Label>
              <Input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
            </div>
            {role === "guardian" && (
              <div className="flex flex-col gap-1.5">
                <Label>صلته بالمريض *</Label>
                <Input value={relation} onChange={(e) => setRelation(e.target.value)}
                       placeholder="الأب، الأم، الوصيّ…" />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label>الوسيلة</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="on_screen">توقيع على الشاشة</SelectItem>
                  <SelectItem value="paper_scan">نسخة ممسوحة ضوئيًّا</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {method === "on_screen" && <SignaturePad onChange={setBlank} />}
          {method === "paper_scan" && (
            <div className="flex flex-col gap-1.5">
              <Label>صورة النسخة الموقَّعة *</Label>
              <Input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setScanFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                {scanFile
                  ? `${scanFile.name} — ${(scanFile.size / 1024 / 1024).toFixed(2)} م.ب`
                  : `النظام يطلب أثرًا محفوظًا لكل توقيع — الحد الأقصى ${MAX_FILE_MB} ميجابايت`}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button
            disabled={
              !name.trim() || sign.isPending ||
              (method === "on_screen" && blank) ||
              (method === "paper_scan" && !scanFile) ||
              (role === "guardian" && !relation.trim())
            }
            onClick={() => sign.mutate()}
          >
            حفظ التوقيع
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * الأرشفة
 * ════════════════════════════════════════════════════════════════════════ */
function ArchiveDialog({
  document: doc, onOpenChange, patientId,
}: { document: any | null; onOpenChange: (open: boolean) => void; patientId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [reason, setReason] = useState("");

  const archive = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("app_archive_document", {
        p_kind: "patient_document",
        p_document_id: doc.id,
        p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-documents", patientId] });
      setReason("");
      toast({
        title: "أُرشف المستند",
        description: "المستندات الطبية لا تُحذف — تبقى بسجلّها وسبب أرشفتها",
      });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذرت الأرشفة",
        description: errorMessage(error),
      }),
  });

  return (
    <Dialog open={Boolean(doc)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>أرشفة مستند</DialogTitle>
          <DialogDescription>
            الموافقة المؤرشفة تتوقّف عن إباحة إجراءاتها فورًا.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label>سبب الأرشفة *</Label>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button variant="destructive" disabled={!reason.trim() || archive.isPending}
                  onClick={() => archive.mutate()}>
            أرشفة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * التبويب
 * ════════════════════════════════════════════════════════════════════════ */
/**
 * أنواع ما يُعرض. الصور والتواقيع ليست جداول أخرى — هي **صفوف هذا الجدول**
 * برشّاحٍ على عمودين قائمين: `category = 'image'` و`signed_at is not null`.
 * وبناء شاشتين مستقلّتين لهما كان سيُكرّر الرفع والأرشفة والتوقيع ثم يفترق.
 */
export type DocumentKind = "all" | "image" | "document" | "signed";

const DOCUMENT_KINDS: { key: DocumentKind; label: string }[] = [
  { key: "all", label: "الكل" },
  { key: "document", label: "مستندات" },
  { key: "image", label: "صور" },
  { key: "signed", label: "موقَّعة" },
];

export default function DocumentsTab({
  patientId,
  kind = "all",
}: {
  patientId: string;
  /** النوع المفتوح أوّلًا — والمستخدم يغيّره من الرشّاح أعلى الجدول. */
  kind?: DocumentKind;
}) {
  const documents = usePatientDocuments(patientId);
  const { toast } = useToast();
  const { can } = usePermissions();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [signing, setSigning] = useState<any | null>(null);
  const [archiving, setArchiving] = useState<any | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [activeKind, setActiveKind] = useState<DocumentKind>(kind);
  // القسم يأتي من العنوان، فتغييره من الشريط الجانبي يجب أن يُغيّر الرشّاح
  useEffect(() => setActiveKind(kind), [kind]);

  const openDocument = useMutation({
    mutationFn: async (row: any) => {
      const { data, error } = await supabase.storage
        .from(BUCKET).createSignedUrl(row.storage_path, 60);
      if (error) throw error;
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذر فتح المستند",
        description: errorMessage(error),
      }),
  });

  const rows = (documents.data ?? [])
    .filter((r) => showArchived || !r.is_archived)
    .filter((r) => {
      if (activeKind === "all") return true;
      if (activeKind === "image") return r.category === "image";
      if (activeKind === "signed") return Boolean(r.signed_at);
      // «مستندات» = كل ما ليس صورة، لا `category = 'document'` وحدها:
      // 0037 يسمّي المولَّد من قالبٍ بأسماء أخرى، وحصرُه بقيمةٍ واحدة كان
      // سيُخفي الموافقات المولَّدة من الجدول كلّه.
      return r.category !== "image";
    });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              مستندات المريض وموافقاته
            </CardTitle>
            <CardDescription>
              الموافقة الموقَّعة تُبيح إجراءها وحده — والإجراء الذي يطلب موافقة
              لا يُنفَّذ بدونها.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-md border p-1 text-xs">
              {DOCUMENT_KINDS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setActiveKind(option.key)}
                  className={`rounded px-2.5 py-1 ${
                    activeKind === option.key
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <Button variant="ghost" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? "إخفاء المؤرشف" : "إظهار المؤرشف"}
            </Button>
            {can("documents.upload") && (
              <Button variant="outline" onClick={() => setGenerateOpen(true)}>
                <Wand2 className="h-4 w-4" />
                توليد من قالب
              </Button>
            )}
            {can("documents.upload") && (
              <Button onClick={() => setUploadOpen(true)}>
                <Upload className="h-4 w-4" />
                رفع مستند
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {documents.isLoading && <Skeleton className="h-32 w-full" />}
          {!documents.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الملف</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>الصلاحية</TableHead>
                  <TableHead>تاريخ الرفع</TableHead>
                  <TableHead className="w-40">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} className={row.is_archived ? "opacity-60" : undefined}>
                    <TableCell>
                      <span className="flex items-center gap-2 font-medium">
                        {row.category === "image" ? (
                          <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate">{row.file_name ?? "بلا اسم"}</span>
                      </span>
                      {row.document_number && (
                        <span className="block text-[10px] text-muted-foreground">
                          #{row.document_number}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.is_consent ? "default" : "secondary"}>
                        {row.is_consent ? "موافقة" : row.category === "image" ? "صورة" : "مستند"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {row.is_archived ? (
                        <Badge variant="secondary">مؤرشف</Badge>
                      ) : row.signed_at ? (
                        <Badge variant="success">موقَّع</Badge>
                      ) : row.is_consent ? (
                        <Badge variant="destructive">بلا توقيع</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                      {row.archive_reason && (
                        <span className="block text-[10px] text-muted-foreground">
                          {row.archive_reason}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.expires_at ?? "—"}
                      {row.expires_at && new Date(row.expires_at) < new Date() && (
                        <Badge variant="destructive" className="ms-1">منتهٍ</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(row.created_at).toLocaleDateString("ar-SA")}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" title="فتح"
                                onClick={() => openDocument.mutate(row)}>
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                        {!row.is_archived && can("consents.sign") && (
                          <Button variant="ghost" size="sm" title="توقيع"
                                  onClick={() => setSigning(row)}>
                            <FileSignature className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {!row.is_archived && can("documents.archive") && (
                          <Button variant="ghost" size="sm" title="أرشفة"
                                  onClick={() => setArchiving(row)}>
                            <Archive className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد مستندات لهذا المريض.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {uploadOpen && (
        <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} patientId={patientId} />
      )}
      {generateOpen && (
        <GenerateDialog open={generateOpen} onOpenChange={setGenerateOpen} patientId={patientId} />
      )}
      {/**
        * نافذة التوقيع تُركَّب عند الفتح فقط. بقاؤها مركَّبة كان يُبقي حالتها
        * (اسم الموقِّع وصفته و`blank`) بين المستندات، بينما لوحة التوقيع داخل
        * `DialogContent` تُفكَّك وتُعاد بيضاء عند كل إغلاق — فمستندٌ ثانٍ
        * يُوقَّع بضغطة واحدة بصورة بيضاء وباسم موقِّع المستند السابق، في سجلٍّ
        * لا يُعدَّل ولا يُحذف.
        */}
      {signing && (
        <SignDialog document={signing} onOpenChange={(o) => !o && setSigning(null)}
                    patientId={patientId} />
      )}
      <ArchiveDialog document={archiving} onOpenChange={(o) => !o && setArchiving(null)}
                     patientId={patientId} />
    </div>
  );
}
