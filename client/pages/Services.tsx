import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Clock, Download, Package, Pencil, Plus, Upload } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { usePermissions } from "@/lib/permissions";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardDescription } from "@/components/ui/card";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import CsvImportDialog, { type CsvColumn } from "@/components/shared/CsvImportDialog";
import LookupSelect from "@/components/shared/LookupSelect";
import ServiceEditorDialog, {
  ITEM_TYPE_LABELS,
  MEDICAL_SERVICE_TYPES,
} from "@/components/catalog/ServiceEditorDialog";
import { errorMessage } from "@/lib/error-message";

const ITEMS_CAP = 200;

function useItems(
  organizationId: string | undefined,
  search: string,
  categoryId: string,
  typeFilter: string,
  statusFilter: string,
  serviceTypeFilter: string,
  showArchived: boolean,
) {
  return useQuery({
    queryKey: [
      "items-catalog",
      organizationId,
      search,
      categoryId,
      typeFilter,
      statusFilter,
      serviceTypeFilter,
      showArchived,
    ],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      // يُقرأ من `v_service_catalog` لا من `items`: المنظور يضمّ اسم العيادة
      // والفئة والفروع والموارد وكود المطالبة في استعلام واحد، وبقاؤه بلا
      // قارئ كان يعني تعريفين للكتالوج يفترقان مع الوقت.
      let query = supabase
        .from("v_service_catalog")
        .select(
          "id, code, barcode, name_ar, name_en, item_type, medical_service_type, duration_minutes, category_value_id, category_name, price, cost_price, is_vat_exempt, is_disabled, is_archived, archive_reason, archived_at, default_clinic_id, clinic_name, requires_preauthorization, requires_consent, branch_ids, primary_claim_code",
        )
        .eq("organization_id", organizationId)
        .eq("is_archived", showArchived)
        .order("name_ar")
        .limit(ITEMS_CAP);
      const term = search.trim();
      if (term) query = query.or(`name_ar.ilike.%${term}%,code.ilike.%${term}%,barcode.ilike.%${term}%`);
      if (categoryId) query = query.eq("category_value_id", categoryId);
      if (typeFilter !== "all") query = query.eq("item_type", typeFilter);
      if (serviceTypeFilter !== "all") query = query.eq("medical_service_type", serviceTypeFilter);
      if (statusFilter !== "all") query = query.eq("is_disabled", statusFilter === "disabled");
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

/** تصدير الكتالوج المعروض — "لائحة الأسعار" في لقطة 10. */
function exportItemsCsv(rows: any[]) {
  const headers = [
    "الكود",
    "الباركود",
    "الاسم",
    "الاسم بالإنجليزي",
    "النوع",
    "نوع الخدمة",
    "القسم",
    "المدة (دقيقة)",
    "الفئة",
    "سعر البيع",
    "التكلفة",
    "الحالة",
  ];
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [
    headers.join(","),
    ...rows.map((row) => {

      return [
        row.code,
        row.barcode,
        row.name_ar,
        row.name_en,
        ITEM_TYPE_LABELS[row.item_type as string] ?? row.item_type,
        MEDICAL_SERVICE_TYPES[row.medical_service_type as string] ?? "",
        row.clinic_name,
        row.duration_minutes,
        row.category_name,
        row.price,
        row.cost_price,
        row.is_archived ? "مؤرشف" : row.is_disabled ? "معطّل" : "نشط",
      ]
        .map(escape)
        .join(",");
    }),
  ];
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `items-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * أعمدة استيراد الأصناف. `code` إلزامي لأن على الجدول قيد
 * `unique (organization_id, code)` — صنف بلا كود يعني فشل الإدراج كله.
 */
const ITEM_IMPORT_COLUMNS: CsvColumn[] = [
  { key: "code", header: "الكود", required: true },
  { key: "name_ar", header: "الاسم", required: true },
  { key: "name_en", header: "الاسم بالإنجليزي" },
  { key: "description_ar", header: "الوصف" },
  {
    key: "item_type",
    header: "النوع",
    /**
     * الدواء **مرفوض** في هذا الاستيراد.
     *
     * الاستيراد يُدرج في `items` مباشرةً ولا يمرّ بـ`app_save_drug`، ولا محفِّز
     * يُنشئ صفّ `drug_details`. و`app_dispense_prescription` تقرأ الخاصيّتين
     * بـ`coalesce(d.is_controlled_substance, false)` و
     * `coalesce(d.requires_prescription, true)` — فغياب الصف يعني «غير خاضع
     * للرقابة»: دواء مخدِّر يُستورَد بهذا الطريق يُصرف بلا فحص صلاحية
     * `pharmacy.dispense_controlled` وبلا تسجيله صرفًا رقابيًّا في التدقيق.
     * ويظهر كذلك في قائمة اختيار الدواء بلا شكل ولا تركيز.
     */
    parse: (raw) => {
      const map: Record<string, string> = {
        خدمة: "service",
        منتج: "product",
        "خدمة مختبر": "lab_service",
        service: "service",
        product: "product",
        lab_service: "lab_service",
      };
      const term = raw.trim();
      if (term === "دواء" || term.toLowerCase() === "drug")
        throw new Error(
          "الأدوية لا تُستورد من هذه الشاشة: أضفها من شاشة الصيدلية حتى تُسجَّل تفاصيلها الدوائية (الشكل والتركيز والتصنيف الرقابي واشتراط الوصفة)",
        );
      const value = map[term];
      if (!value) throw new Error("النوع يجب أن يكون: خدمة / منتج / خدمة مختبر");
      return value;
    },
  },
  {
    key: "medical_service_type",
    header: "نوع الخدمة الطبية",
    parse: (raw) => {
      const term = raw.trim();
      if (!term) return null;
      if (MEDICAL_SERVICE_TYPES[term]) return term;
      const found = Object.entries(MEDICAL_SERVICE_TYPES).find(([, label]) => label === term);
      if (!found) {
        throw new Error(`نوع خدمة غير معروف: ${term}`);
      }
      return found[0];
    },
  },
  {
    key: "duration_minutes",
    header: "المدة بالدقائق",
    parse: (raw) => {
      const term = raw.trim();
      if (!term) return null;
      const value = Number(term);
      if (!Number.isInteger(value) || value < 1 || value > 1440) {
        throw new Error("المدة يجب أن تكون بين ١ و ١٤٤٠ دقيقة");
      }
      return value;
    },
  },
  {
    key: "price",
    header: "السعر",
    parse: (raw) => {
      const value = Number(raw.replace(/,/g, ""));
      if (!Number.isFinite(value) || value < 0) throw new Error("السعر يجب أن يكون رقمًا غير سالب");
      return value;
    },
  },
  {
    key: "cost_price",
    header: "التكلفة",
    parse: (raw) => {
      const value = Number(raw.replace(/,/g, ""));
      if (!Number.isFinite(value) || value < 0) throw new Error("التكلفة يجب أن تكون رقمًا غير سالب");
      return value;
    },
  },
  { key: "unit", header: "الوحدة" },
  { key: "barcode", header: "الباركود" },
];

export default function Services() {
  const { organization, membership, legacyMode } = useOrganizationAccess();
  const { can } = usePermissions();
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [serviceTypeFilter, setServiceTypeFilter] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const [editorFor, setEditorFor] = useState<{ open: boolean; itemId: string | null }>({
    open: false,
    itemId: null,
  });
  const [archiveFor, setArchiveFor] = useState<any | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  /**
   * إعادة ترقيم أكواد الخدمات بأرقام من رقمَين أو ثلاثة.
   *
   * الاستقبال يبحث عن الخدمة بكودها عند الفوترة، وكود مثل
   * `SRV-CONSULT-0001` لا يُحفَظ ولا يُكتب بسرعة. الدالّة في القاعدة تُرقّم
   * الخدمات غير المؤرشفة التي لا كود قصير لها، وتحفظ الكود القديم فلا يُفقد
   * مرجع خارجيّ، ولا تمسّ المنتجات والأدوية (لها باركود ومرجع مورّد).
   */
  const renumber = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لا توجد منشأة نشطة");
      const { data, error } = await supabase.rpc("app_renumber_service_codes", {
        p_organization_id: organization.id,
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["items-catalog"] });
      toast({
        title: count > 0 ? `أُعطيت ${count} خدمة كودًا قصيرًا` : "كل الخدمات لها أكواد قصيرة أصلًا",
      });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر إعادة الترقيم",
        description: errorMessage(error),
      }),
  });

  const items = useItems(
    organization?.id,
    search,
    categoryId,
    typeFilter,
    statusFilter,
    serviceTypeFilter,
    showArchived,
  );
  const canManage = can("catalog.manage");

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">الخدمات والكتالوج الطبي</h1>
          <p className="text-sm text-muted-foreground">
            الخدمات والمنتجات والأدوية القابلة للفوترة، بمتطلّباتها السريرية وأسعارها
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={showArchived ? "default" : "outline"}
            onClick={() => setShowArchived((prev) => !prev)}
          >
            <Archive className="h-4 w-4" />
            {showArchived ? "عرض النشط" : "الأرشيف"}
          </Button>
          {canManage && (
            <>
              {/* الترقيم الجماعيّ لمسؤول المنشأة وحده — والقاعدة تفرض ذلك
                  أيضًا، فالزرّ لا يُظهر ما تَرفضه الدالّة. */}
              {(legacyMode ||
                ["owner", "organization_admin"].includes(membership?.role_key ?? "")) && (
                <Button
                  variant="outline"
                  disabled={renumber.isPending}
                  title="إعطاء كل خدمة كودًا من رقمين أو ثلاثة ليسهل حفظه"
                  onClick={() => {
                    if (
                      window.confirm(
                        "سيُعاد ترقيم أكواد الخدمات بأرقام قصيرة، ويُحفظ الكود القديم للرجوع إليه. المنتجات والأدوية لا تتغيّر. متابعة؟",
                      )
                    )
                      renumber.mutate();
                  }}
                >
                  {renumber.isPending ? "جارٍ الترقيم..." : "أكواد قصيرة للخدمات"}
                </Button>
              )}
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" />
                استيراد
              </Button>
              <Button onClick={() => setEditorFor({ open: true, itemId: null })}>
                <Plus className="h-4 w-4" />
                صنف/خدمة جديدة
              </Button>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالاسم أو الكود أو الباركود..."
              className="max-w-xs"
            />
            <div className="w-48">
              <LookupSelect
                categoryKey="item_categories"
                value={categoryId}
                onChange={setCategoryId}
                placeholder="كل الفئات"
                allowClear
                clearLabel="كل الفئات"
              />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأنواع</SelectItem>
                {Object.entries(ITEM_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={serviceTypeFilter} onValueChange={setServiceTypeFilter}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الخدمات الطبية</SelectItem>
                {Object.entries(MEDICAL_SERVICE_TYPES).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="active">النشط</SelectItem>
                <SelectItem value="disabled">المعطّل</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={() => exportItemsCsv(items.data ?? [])}
              disabled={(items.data ?? []).length === 0}
            >
              <Download className="h-4 w-4" />
              تصدير
            </Button>
          </div>
          <CardDescription>
            {showArchived && "الأرشيف — "}
            {(items.data ?? []).length >= ITEMS_CAP
              ? `يُعرض أول ${ITEMS_CAP} صنف — ضيّق البحث`
              : `${(items.data ?? []).length} صنف`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {items.isLoading && (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          )}
          {items.isError && (
            <p className="py-6 text-center text-sm text-destructive">
              تعذّر تحميل الكتالوج: {(items.error as Error)?.message}
            </p>
          )}
          {!items.isLoading && !items.isError && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الكود</TableHead>
                  <TableHead>الاسم</TableHead>
                  <TableHead>نوع الخدمة</TableHead>
                  <TableHead>القسم</TableHead>
                  <TableHead>المدة</TableHead>
                  <TableHead>السعر</TableHead>
                  <TableHead>متطلّبات</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(items.data ?? []).map((item) => {
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-xs">{item.code}</TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <Package className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <div>{item.name_ar}</div>
                            {item.name_en && (
                              <div className="text-xs text-muted-foreground" dir="ltr">
                                {item.name_en}
                              </div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {item.medical_service_type
                          ? (MEDICAL_SERVICE_TYPES[item.medical_service_type] ?? item.medical_service_type)
                          : (ITEM_TYPE_LABELS[item.item_type] ?? "—")}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{item.clinic_name ?? "—"}</TableCell>
                      <TableCell className="text-sm">
                        {item.duration_minutes ? (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3 text-muted-foreground" />
                            {item.duration_minutes} د
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>{Number(item.price).toLocaleString("ar-SA")} ر.س</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {item.requires_preauthorization && <Badge variant="outline">موافقة مسبقة</Badge>}
                          {item.requires_consent && <Badge variant="outline">إقرار</Badge>}
                          {item.is_vat_exempt && <Badge variant="secondary">معفى</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>
                        {item.is_archived ? (
                          <Badge variant="secondary" title={item.archive_reason ?? ""}>
                            مؤرشف
                          </Badge>
                        ) : (
                          <Badge variant={item.is_disabled ? "secondary" : "success"}>
                            {item.is_disabled ? "معطّل" : "نشط"}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-end">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditorFor({ open: true, itemId: item.id })}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {canManage && (
                            <Button size="sm" variant="ghost" onClick={() => setArchiveFor(item)}>
                              {item.is_archived ? (
                                <ArchiveRestore className="h-4 w-4" />
                              ) : (
                                <Archive className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {(items.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                      {showArchived ? "الأرشيف فارغ." : "لا توجد أصناف مطابقة."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CsvImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        table="items"
        title="استيراد خدمات ومنتجات من ملف CSV — الأدوية من شاشة الصيدلية"
        invalidateKey="items-catalog"
        fixedValues={{ organization_id: organization?.id }}
        columns={ITEM_IMPORT_COLUMNS}
      />

      <ServiceEditorDialog
        open={editorFor.open}
        onOpenChange={(open) => setEditorFor((prev) => ({ ...prev, open }))}
        itemId={editorFor.itemId}
      />

      <ArchiveDialog item={archiveFor} onClose={() => setArchiveFor(null)} />
    </div>
  );
}

/**
 * الأرشفة والاستعادة.
 *
 * الأرشفة ليست حذفًا: الخدمة تختفي من البحث والفوترة ويبقى تاريخها كاملًا في
 * الزيارات والفواتير الصادرة. والقاعدة ترفض أرشفة خدمة مرتبطة بزيارة لم
 * تُفوتر بعد — وإلا اختفى من الشاشة ما ينتظر الفوترة.
 *
 * والاستعادة تُعيدها **معطَّلة** لا نشطة، كي يراجعها أحد قبل ظهورها في
 * نقطة البيع بسعر قد يكون قديمًا.
 */
function ArchiveDialog({ item, onClose }: { item: any | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const isArchived = Boolean(item?.is_archived);

  const run = useMutation({
    mutationFn: async () => {
      if (!item) return;
      if (isArchived) {
        const { error } = await supabase.rpc("app_restore_item", { p_item_id: item.id });
        if (error) throw error;
      } else {
        if (!reason.trim()) throw new Error("سبب الأرشفة مطلوب");
        const { error } = await supabase.rpc("app_archive_item", {
          p_item_id: item.id,
          p_reason: reason.trim(),
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items-catalog"] });
      toast({
        title: isArchived ? "استُعيدت الخدمة" : "أُرشفت الخدمة",
        description: isArchived
          ? "أُعيدت معطَّلة — راجع سعرها ثم فعّلها."
          : "لن تظهر في البحث أو الفوترة، وتاريخها محفوظ.",
      });
      setReason("");
      onClose();
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: isArchived ? "تعذرت الاستعادة" : "تعذرت الأرشفة",
        description: errorMessage(error, "خطأ غير متوقع"),
      }),
  });

  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isArchived ? "استعادة الخدمة" : "أرشفة الخدمة"}</DialogTitle>
          <DialogDescription>
            {isArchived
              ? "ستعود الخدمة معطَّلة، فراجع سعرها ومتطلّباتها قبل تفعيلها."
              : "لن تظهر في البحث أو الفوترة. تاريخها في الزيارات والفواتير يبقى كما هو."}
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm font-medium">{item?.name_ar}</p>

        {isArchived ? (
          item?.archive_reason && (
            <p className="text-sm text-muted-foreground">سبب الأرشفة المسجَّل: {item.archive_reason}</p>
          )
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label>سبب الأرشفة *</Label>
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="مثال: توقّف تقديم الخدمة بعد إغلاق قسم الأشعة"
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            variant={isArchived ? "default" : "destructive"}
            disabled={run.isPending || (!isArchived && !reason.trim())}
            onClick={() => run.mutate()}
          >
            {run.isPending ? "..." : isArchived ? "استعادة" : "أرشفة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
