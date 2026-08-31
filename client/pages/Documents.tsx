import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FileSignature, FileStack, Upload } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { usePermissions } from "@/lib/permissions";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

/**
 * مركز المستندات — المرحلة 22.
 *
 * مستندات المريض تُدار من ملفه، ومستندات الموظف من ملفه؛ هذه الشاشة هي
 * **المكان الوحيد الذي يراها فيه كلها معًا**، ومعها ما يقارب الانتهاء
 * والموافقات التي لم تُوقَّع بعد. شهادات معايرة الأجهزة وعقود الموردين
 * تُرفع من هنا لأن لا ملف شخصيًّا لها.
 */
const BUCKET = "patient-documents";
const MAX_FILE_MB = 20;

const KINDS: Record<string, string> = {
  patient_document: "مستند مريض",
  employee_document: "مستند موظف",
  entity_document: "مستند كيان",
};

const ENTITY_TYPES: Record<string, string> = {
  asset: "أصل/جهاز",
  asset_calibration: "معايرة",
  maintenance_order: "أمر صيانة",
  distributor: "مورّد",
  purchase_invoice: "فاتورة شراء",
  purchase_order: "أمر شراء",
  insurance_company: "شركة تأمين",
  organization: "المنشأة",
  branch: "فرع",
  other: "أخرى",
};

export default function Documents() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">المستندات والموافقات</h1>
        <p className="text-sm text-muted-foreground">
          كل مستندات المنشأة في مكان واحد، بصلاحيتها وتواقيعها
        </p>
      </div>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">كل المستندات</TabsTrigger>
          <TabsTrigger value="expiry">تنبيهات الانتهاء</TabsTrigger>
          <TabsTrigger value="consents">الموافقات المعلّقة</TabsTrigger>
        </TabsList>
        <TabsContent value="all" className="mt-4"><AllDocuments /></TabsContent>
        <TabsContent value="expiry" className="mt-4"><ExpiryAlerts /></TabsContent>
        <TabsContent value="consents" className="mt-4"><PendingConsentsPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * كل المستندات
 * ════════════════════════════════════════════════════════════════════════ */
function AllDocuments() {
  const { organization } = useOrganizationAccess();
  const { can } = usePermissions();
  const { toast } = useToast();
  const [kind, setKind] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const [uploading, setUploading] = useState(false);

  const documents = useQuery({
    queryKey: ["all-documents", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_documents").select("*")
        .eq("organization_id", organization!.id)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const open = useMutation({
    mutationFn: async (row: any) => {
      const { data, error } = await supabase.storage
        .from(BUCKET).createSignedUrl(row.storage_path, 60);
      if (error) throw error;
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذر فتح المستند",
        description: error instanceof Error ? error.message : "خطأ غير متوقع",
      }),
  });

  const rows = (documents.data ?? []).filter(
    (r) => (kind === "all" || r.document_kind === kind) && (showArchived || !r.is_archived),
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileStack className="h-4 w-4" />
              كل المستندات
            </CardTitle>
            <CardDescription>
              مستندات المرضى والموظفين والكيانات — لا تُحذف، تُؤرشف بسبب موثَّق.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {Object.entries(KINDS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="ghost" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? "إخفاء المؤرشف" : "إظهار المؤرشف"}
            </Button>
            {can("documents.upload") && (
              <Button onClick={() => setUploading(true)}>
                <Upload className="h-4 w-4" />
                مستند كيان
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {documents.isLoading && <Skeleton className="h-40 w-full" />}
          {!documents.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>العنوان</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>يخصّ</TableHead>
                  <TableHead>التصنيف</TableHead>
                  <TableHead>الصلاحية</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={`${r.document_kind}-${r.id}`}
                            className={r.is_archived ? "opacity-60" : undefined}>
                    <TableCell className="max-w-64 truncate text-sm">{r.title}</TableCell>
                    <TableCell className="text-xs">{KINDS[r.document_kind] ?? r.document_kind}</TableCell>
                    <TableCell className="text-sm">
                      {r.entity_name ?? ENTITY_TYPES[r.entity_type] ?? r.entity_type}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.category ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.expires_at ?? "—"}
                      {r.expires_at && new Date(r.expires_at) < new Date() && (
                        <Badge variant="destructive" className="ms-1">منتهٍ</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.is_archived
                        ? <Badge variant="secondary">مؤرشف</Badge>
                        : r.is_consent
                          ? (r.signed_at
                              ? <Badge variant="success">موقَّع</Badge>
                              : <Badge variant="destructive">بلا توقيع</Badge>)
                          : <Badge variant="secondary">نشط</Badge>}
                    </TableCell>
                    <TableCell className="text-end">
                      <Button variant="ghost" size="sm" onClick={() => open.mutate(r)}>
                        فتح
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      لا مستندات.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {uploading && <EntityUploadDialog open={uploading} onOpenChange={setUploading} />}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * رفع مستند كيان (شهادة معايرة، عقد مورّد، رخصة…)
 * ════════════════════════════════════════════════════════════════════════ */
function EntityUploadDialog({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [entityType, setEntityType] = useState("asset");
  const [entityId, setEntityId] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);

  // قوائم الكيانات: نشط وغير مؤرشف فقط
  const assets = useQuery({
    queryKey: ["doc-assets", organization?.id],
    enabled: Boolean(organization?.id) && entityType === "asset",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("assets").select("id, asset_number, name_ar")
        .eq("organization_id", organization!.id)
        .neq("status", "disposed")
        .order("asset_number");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const suppliers = useQuery({
    queryKey: ["doc-suppliers", organization?.id],
    enabled: Boolean(organization?.id) && entityType === "distributor",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributors").select("id, name_ar")
        .eq("organization_id", organization!.id)
        .eq("is_disabled", false).eq("is_archived", false)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const branches = useQuery({
    queryKey: ["doc-branches", organization?.id],
    enabled: Boolean(organization?.id) && entityType === "branch",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches").select("id, name")
        .eq("organization_id", organization!.id).order("name");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const options =
    entityType === "asset"
      ? (assets.data ?? []).map((a) => ({ id: a.id, label: `${a.asset_number} — ${a.name_ar}` }))
      : entityType === "distributor"
        ? (suppliers.data ?? []).map((s) => ({ id: s.id, label: s.name_ar }))
        : entityType === "branch"
          ? (branches.data ?? []).map((b) => ({ id: b.id, label: b.name }))
          : [];

  const upload = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لا توجد مؤسسة نشطة");
      if (!file) throw new Error("اختر ملفًا أولًا");
      if (file.size > MAX_FILE_MB * 1024 * 1024)
        throw new Error(`حجم الملف يتجاوز ${MAX_FILE_MB} ميجابايت`);
      const target = entityType === "organization" ? organization.id : entityId;
      if (!target) throw new Error("اختر الكيان المرتبط");

      const safeName = file.name.replace(/[^\w.\-؀-ۿ]/g, "_");
      const path = `${organization.id}/entities/${entityType}/${Date.now()}-${safeName}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file);
      if (upErr) throw upErr;

      const { error } = await supabase.rpc("app_register_entity_document", {
        p_org: organization.id,
        p_entity_type: entityType,
        p_entity_id: target,
        p_title: title.trim(),
        p_storage_path: path,
        p_file_name: file.name,
        p_category: category.trim() || null,
        p_branch_id: null,
        p_issue_date: issueDate || null,
        p_expires_at: expiresAt || null,
        p_mime_type: file.type || null,
        p_size_bytes: file.size,
        p_note: note.trim() || null,
      });
      if (error) {
        await supabase.storage.from(BUCKET).remove([path]);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-documents", organization?.id] });
      queryClient.invalidateQueries({ queryKey: ["document-expiry", organization?.id] });
      toast({ title: "رُفع المستند وارتبط بكيانه" });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive", title: "تعذر الرفع",
        description: error instanceof Error ? error.message : "خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>رفع مستند كيان</DialogTitle>
          <DialogDescription>
            شهادة معايرة، ضمان، عقد مورّد، رخصة منشأة… يُربط المستند بكيانه
            فيظهر معه وفي تنبيهات الانتهاء.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>نوع الكيان *</Label>
            <Select value={entityType} onValueChange={(v) => { setEntityType(v); setEntityId(""); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="asset">أصل/جهاز</SelectItem>
                <SelectItem value="distributor">مورّد</SelectItem>
                <SelectItem value="branch">فرع</SelectItem>
                <SelectItem value="organization">المنشأة</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {entityType !== "organization" && (
            <div className="flex flex-col gap-1.5">
              <Label>الكيان *</Label>
              <Select value={entityId} onValueChange={setEntityId}>
                <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                <SelectContent>
                  {options.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>العنوان *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)}
                   placeholder="شهادة معايرة 2026" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>التصنيف</Label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)}
                   placeholder="calibration، warranty، contract…" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>تاريخ الإصدار</Label>
              <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>ينتهي في</Label>
              <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الملف *</Label>
            <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>ملاحظة</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button disabled={!file || !title.trim() || upload.isPending}
                  onClick={() => upload.mutate()}>
            رفع
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * تنبيهات الانتهاء
 * ════════════════════════════════════════════════════════════════════════ */
function ExpiryAlerts() {
  const { organization } = useOrganizationAccess();

  const alerts = useQuery({
    queryKey: ["document-expiry", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_document_expiry_alerts").select("*")
        .eq("organization_id", organization!.id)
        .order("expires_at");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4" />
          مستندات منتهية أو تقارب الانتهاء
        </CardTitle>
        <CardDescription>
          خلال 60 يومًا — هوية مريض، رخصة موظف، شهادة معايرة جهاز، عقد مورّد.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {alerts.isLoading && <Skeleton className="h-32 w-full" />}
        {!alerts.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>المستند</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>يخصّ</TableHead>
                <TableHead>ينتهي في</TableHead>
                <TableHead>المتبقّي</TableHead>
                <TableHead>الحالة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(alerts.data ?? []).map((a) => (
                <TableRow key={`${a.document_kind}-${a.id}`}>
                  <TableCell className="max-w-64 truncate text-sm">{a.title}</TableCell>
                  <TableCell className="text-xs">{KINDS[a.document_kind] ?? a.document_kind}</TableCell>
                  <TableCell className="text-sm">
                    {a.entity_name ?? ENTITY_TYPES[a.entity_type] ?? a.entity_type}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{a.expires_at}</TableCell>
                  <TableCell className="font-mono text-xs">{a.days_left} يومًا</TableCell>
                  <TableCell>
                    <Badge variant={a.urgency === "منتهٍ" ? "destructive" : "default"}>
                      {a.urgency}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {(alerts.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    لا مستندات تقارب الانتهاء.
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

/* ══════════════════════════════════════════════════════════════════════════
 * الموافقات المعلّقة
 * ════════════════════════════════════════════════════════════════════════ */
function PendingConsentsPanel() {
  const { organization } = useOrganizationAccess();

  const rows = useQuery({
    queryKey: ["pending-consents-page", organization?.id],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_pending_consents").select("*")
        .eq("organization_id", organization!.id)
        .order("visit_date", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const STATUS: Record<string, { label: string; variant: any }> = {
    signed: { label: "موقَّعة", variant: "success" },
    missing: { label: "بلا موافقة", variant: "destructive" },
    expired: { label: "منتهية", variant: "destructive" },
    not_required: { label: "غير مطلوبة", variant: "secondary" },
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileSignature className="h-4 w-4" />
          الموافقات على الإجراءات
        </CardTitle>
        <CardDescription>
          الحالة محسوبة **لكل إجراء على حدة**: موافقة الجراحة لا تُبيح التخدير.
          الإجراء بلا موافقة لا يُنفَّذ إلا بتجاوز موثَّق من صاحب صلاحية.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {rows.isLoading && <Skeleton className="h-32 w-full" />}
        {!rows.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>المريض</TableHead>
                <TableHead>الإجراء</TableHead>
                <TableHead>حالة الموافقة</TableHead>
                <TableHead>حالة الخدمة</TableHead>
                <TableHead>تاريخ الزيارة</TableHead>
                <TableHead>تجاوز</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rows.data ?? []).map((r) => (
                <TableRow key={r.visit_service_id}>
                  <TableCell className="text-sm">
                    {r.patient_name}
                    {r.file_number && (
                      <span className="block font-mono text-[10px] text-muted-foreground">
                        {r.file_number}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.item_name}
                    {r.consent_note_ar && (
                      <span className="block text-[10px] text-muted-foreground">
                        {r.consent_note_ar}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS[r.consent_status]?.variant ?? "secondary"}>
                      {STATUS[r.consent_status]?.label ?? r.consent_status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{r.status}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {String(r.visit_date).slice(0, 10)}
                  </TableCell>
                  <TableCell className="max-w-48 truncate text-xs text-muted-foreground">
                    {r.consent_override_reason ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
              {(rows.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    لا إجراءات تحتاج موافقة حاليًّا.
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
