import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  ChevronLeft,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Stethoscope,
} from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { usePermissions } from "@/lib/permissions";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import LookupSelect from "@/components/shared/LookupSelect";

/**
 * الأقسام والعيادات — المرحلة الأولى.
 *
 * قبل 0080 لم يكن في المخطط جدول أقسام إطلاقًا: هذه الشاشة كانت تقرأ
 * `clinics` وتسمّيها أقسامًا. فلم يكن ممكنًا أن يُقال «كم طبيبًا في قسم
 * الأشعة» لأن القسم لم يكن موجودًا.
 *
 * الآن: قسمٌ له شجرة ونوع ومدير، والعيادة تتبع قسمًا وفرعًا. والعدّادات
 * تُحسب في القاعدة (`v_department_summary` و`v_clinic_summary`) لا في
 * المتصفّح — حسابها هنا يعني استعلامًا لكل صفّ.
 */

const NONE = "__none__";

const DEPARTMENT_TYPES: Record<string, string> = {
  clinical: "سريري",
  laboratory: "مختبر",
  radiology: "أشعة",
  pharmacy: "صيدلية",
  administrative: "إداري",
  support: "مساند",
};

const CLINIC_TYPES: Record<string, string> = {
  general: "عام",
  dental: "أسنان",
  dermatology: "جلدية",
  pediatrics: "أطفال",
  ophthalmology: "عيون",
  physiotherapy: "علاج طبيعي",
  womens_health: "نساء وولادة",
  lab_center: "مختبر",
  multi_specialty: "متعددة التخصصات",
};

// ---------------------------------------------------------------------------
// استعلامات مشتركة
// ---------------------------------------------------------------------------
function useBranches(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["structure-branches", organizationId],
    enabled: Boolean(organizationId),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches")
        .select("id, name")
        .eq("organization_id", organizationId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
}

function useDepartments(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["departments-summary", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_department_summary")
        .select(
          "id, code, name_ar, name_en, department_type, parent_department_id, parent_name, manager_user_id, is_clinical, is_active, sort_order, clinic_count, active_clinic_count, doctor_count, service_count",
        )
        .eq("organization_id", organizationId)
        .order("sort_order")
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

function useClinics(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["clinics-summary", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_clinic_summary")
        .select(
          "id, branch_id, branch_name, department_id, department_name, code, name_ar, name_en, clinic_type, specialty_value_id, specialty_name, phone_extension, floor, room_number, default_visit_duration, allows_walk_in, allows_online_booking, capacity, color, sort_order, is_disabled, doctor_count, service_count, resource_count, future_appointment_count",
        )
        .eq("organization_id", organizationId)
        .order("sort_order")
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

// ---------------------------------------------------------------------------
export default function Departments() {
  const { organization } = useOrganizationAccess();
  const { can } = usePermissions();
  const organizationId = organization?.id;
  const canManage = can("structure.manage");

  const [tab, setTab] = useState("departments");
  const [departmentEditor, setDepartmentEditor] = useState<{ open: boolean; row: any | null }>({
    open: false,
    row: null,
  });
  const [clinicEditor, setClinicEditor] = useState<{ open: boolean; row: any | null }>({
    open: false,
    row: null,
  });
  const [disableTarget, setDisableTarget] = useState<any | null>(null);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">الأقسام والعيادات</h1>
          <p className="text-sm text-muted-foreground">
            الهيكل الذي يقوم عليه الأطباء والمواعيد والخدمات والمختبر والأشعة
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setDepartmentEditor({ open: true, row: null })}>
              <Plus className="h-4 w-4" />
              قسم جديد
            </Button>
            <Button onClick={() => setClinicEditor({ open: true, row: null })}>
              <Plus className="h-4 w-4" />
              عيادة جديدة
            </Button>
          </div>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="departments">الأقسام</TabsTrigger>
          <TabsTrigger value="clinics">العيادات</TabsTrigger>
        </TabsList>

        <TabsContent value="departments" className="mt-4">
          <DepartmentsTab
            organizationId={organizationId}
            canManage={canManage}
            onEdit={(row) => setDepartmentEditor({ open: true, row })}
          />
        </TabsContent>

        <TabsContent value="clinics" className="mt-4">
          <ClinicsTab
            organizationId={organizationId}
            canManage={canManage}
            onEdit={(row) => setClinicEditor({ open: true, row })}
            onToggle={(row) => setDisableTarget(row)}
          />
        </TabsContent>
      </Tabs>

      <DepartmentDialog
        open={departmentEditor.open}
        row={departmentEditor.row}
        organizationId={organizationId}
        onClose={() => setDepartmentEditor({ open: false, row: null })}
      />
      <ClinicDialog
        open={clinicEditor.open}
        row={clinicEditor.row}
        organizationId={organizationId}
        onClose={() => setClinicEditor({ open: false, row: null })}
      />
      <ClinicToggleDialog clinic={disableTarget} onClose={() => setDisableTarget(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// تبويب الأقسام — شجرة
// ---------------------------------------------------------------------------
function DepartmentsTab({
  organizationId,
  canManage,
  onEdit,
}: {
  organizationId: string | undefined;
  canManage: boolean;
  onEdit: (row: any) => void;
}) {
  const rows = useDepartments(organizationId);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [showInactive, setShowInactive] = useState(false);

  const filtered = useMemo(() => {
    const term = search.trim();
    return (rows.data ?? []).filter((row) => {
      if (!showInactive && !row.is_active) return false;
      if (typeFilter !== "all" && row.department_type !== typeFilter) return false;
      if (!term) return true;
      return (
        String(row.name_ar ?? "").includes(term) ||
        String(row.name_en ?? "").toLowerCase().includes(term.toLowerCase()) ||
        String(row.code ?? "").toLowerCase().includes(term.toLowerCase())
      );
    });
  }, [rows.data, search, typeFilter, showInactive]);

  /**
   * الترتيب الشجري.
   *
   * البحث والفلترة قد يُخرجان الأب ويُبقيان الابن، فالابن حينها يُعرض في
   * الجذر بدل أن يختفي — إخفاء نتيجة مطابقة لأن أباها غير مطابق سلوكٌ
   * يربك من يبحث.
   */
  const tree = useMemo(() => {
    const present = new Set(filtered.map((row) => row.id));
    const byParent = new Map<string, any[]>();
    for (const row of filtered) {
      const parent =
        row.parent_department_id && present.has(row.parent_department_id)
          ? row.parent_department_id
          : "__root__";
      const list = byParent.get(parent) ?? [];
      list.push(row);
      byParent.set(parent, list);
    }
    const out: { row: any; depth: number }[] = [];
    const walk = (parent: string, depth: number) => {
      for (const row of byParent.get(parent) ?? []) {
        out.push({ row, depth });
        walk(row.id, depth + 1);
      }
    };
    walk("__root__", 0);
    return out;
  }, [filtered]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالاسم أو الكود..."
            className="max-w-xs"
          />
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الأنواع</SelectItem>
              {Object.entries(DEPARTMENT_TYPES).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={showInactive} onCheckedChange={setShowInactive} />
            عرض المعطَّل
          </label>
        </div>
        <CardDescription>{filtered.length} قسم</CardDescription>
      </CardHeader>
      <CardContent>
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
                <TableHead>القسم</TableHead>
                <TableHead>الكود</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>العيادات</TableHead>
                <TableHead>الأطباء</TableHead>
                <TableHead>الخدمات</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tree.map(({ row, depth }) => (
                <TableRow key={row.id} className={row.is_active ? "" : "text-muted-foreground"}>
                  <TableCell className="font-medium">
                    <span
                      className="flex items-center gap-1.5"
                      style={{ paddingInlineStart: `${depth * 18}px` }}
                    >
                      {depth > 0 && <ChevronLeft className="h-3 w-3 text-muted-foreground" />}
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span>
                        {row.name_ar}
                        {row.name_en && (
                          <span className="ms-2 text-xs text-muted-foreground" dir="ltr">
                            {row.name_en}
                          </span>
                        )}
                      </span>
                      {!row.is_clinical && (
                        <Badge variant="outline" className="text-[10px]">
                          غير سريري
                        </Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.code ?? "—"}</TableCell>
                  <TableCell>{DEPARTMENT_TYPES[row.department_type] ?? row.department_type}</TableCell>
                  <TableCell>
                    {row.active_clinic_count}
                    {row.clinic_count !== row.active_clinic_count && (
                      <span className="text-xs text-muted-foreground"> / {row.clinic_count}</span>
                    )}
                  </TableCell>
                  <TableCell>{row.doctor_count}</TableCell>
                  <TableCell>{row.service_count}</TableCell>
                  <TableCell>
                    <Badge variant={row.is_active ? "success" : "secondary"}>
                      {row.is_active ? "نشط" : "معطَّل"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-left">
                    {canManage && (
                      <Button size="sm" variant="ghost" onClick={() => onEdit(row)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {tree.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد أقسام مطابقة. ابدأ بإنشاء قسم، ثم اربط العيادات به.
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

// ---------------------------------------------------------------------------
// تبويب العيادات
// ---------------------------------------------------------------------------
function ClinicsTab({
  organizationId,
  canManage,
  onEdit,
  onToggle,
}: {
  organizationId: string | undefined;
  canManage: boolean;
  onEdit: (row: any) => void;
  onToggle: (row: any) => void;
}) {
  const rows = useClinics(organizationId);
  const branches = useBranches(organizationId);
  const departments = useDepartments(organizationId);
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");

  const filtered = useMemo(() => {
    const term = search.trim();
    return (rows.data ?? []).filter((row) => {
      if (statusFilter === "active" && row.is_disabled) return false;
      if (statusFilter === "disabled" && !row.is_disabled) return false;
      if (branchFilter !== "all" && row.branch_id !== branchFilter) return false;
      if (departmentFilter !== "all" && row.department_id !== departmentFilter) return false;
      if (!term) return true;
      return (
        String(row.name_ar ?? "").includes(term) ||
        String(row.name_en ?? "").toLowerCase().includes(term.toLowerCase()) ||
        String(row.code ?? "").toLowerCase().includes(term.toLowerCase())
      );
    });
  }, [rows.data, search, branchFilter, departmentFilter, statusFilter]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالاسم أو الكود..."
            className="max-w-xs"
          />
          <Select value={branchFilter} onValueChange={setBranchFilter}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الفروع</SelectItem>
              {(branches.data ?? []).map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الأقسام</SelectItem>
              {(departments.data ?? []).map((department) => (
                <SelectItem key={department.id} value={department.id}>
                  {department.name_ar}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">النشط</SelectItem>
              <SelectItem value="disabled">المعطَّل</SelectItem>
              <SelectItem value="all">الكل</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <CardDescription>{filtered.length} عيادة</CardDescription>
      </CardHeader>
      <CardContent>
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
                <TableHead>العيادة</TableHead>
                <TableHead>الفرع</TableHead>
                <TableHead>القسم</TableHead>
                <TableHead>المدة</TableHead>
                <TableHead>الأطباء</TableHead>
                <TableHead>الخدمات</TableHead>
                <TableHead>الموارد</TableHead>
                <TableHead>مواعيد قادمة</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow key={row.id} className={row.is_disabled ? "text-muted-foreground" : ""}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block h-3 w-3 shrink-0 rounded-full border"
                        style={{ background: row.color ?? "transparent" }}
                      />
                      <span>
                        {row.name_ar}
                        <span className="ms-2 font-mono text-xs text-muted-foreground">{row.code}</span>
                        {row.room_number && (
                          <span className="ms-2 text-xs text-muted-foreground">
                            غرفة {row.room_number}
                          </span>
                        )}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{row.branch_name ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.department_name ?? "—"}
                  </TableCell>
                  <TableCell>{row.default_visit_duration ? `${row.default_visit_duration} د` : "—"}</TableCell>
                  <TableCell>{row.doctor_count}</TableCell>
                  <TableCell>{row.service_count}</TableCell>
                  <TableCell>{row.resource_count}</TableCell>
                  <TableCell>
                    {row.future_appointment_count > 0 ? (
                      <Badge variant="outline">{row.future_appointment_count}</Badge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.is_disabled ? "secondary" : "success"}>
                      {row.is_disabled ? "معطَّلة" : "نشطة"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-left">
                    <div className="flex justify-end gap-1">
                      {canManage && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => onEdit(row)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => onToggle(row)}>
                            {row.is_disabled ? (
                              <Power className="h-4 w-4" />
                            ) : (
                              <PowerOff className="h-4 w-4" />
                            )}
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد عيادات مطابقة.
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

// ---------------------------------------------------------------------------
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function DepartmentDialog({
  open,
  row,
  organizationId,
  onClose,
}: {
  open: boolean;
  row: any | null;
  organizationId: string | undefined;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const departments = useDepartments(organizationId);
  const [form, setForm] = useState<any>({});
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // المزامنة بالمقارنة لا بأثر جانبي: المفتاح يتغيّر فيُعاد التعبئة مرة واحدة.
  const key = open ? (row?.id ?? "__new__") : null;
  if (open && key !== loadedFor) {
    setForm(
      row
        ? { ...row }
        : {
            name_ar: "",
            name_en: "",
            code: "",
            department_type: "clinical",
            is_clinical: true,
            is_active: true,
            sort_order: 0,
          },
    );
    setLoadedFor(key);
  }
  if (!open && loadedFor !== null) setLoadedFor(null);

  const set = (field: string, value: any) => setForm((prev: any) => ({ ...prev, [field]: value }));

  const save = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      const { error } = await supabase.rpc("app_save_department", {
        p_organization_id: organizationId,
        p_department_id: row?.id ?? null,
        p_payload: {
          name_ar: String(form.name_ar ?? "").trim(),
          name_en: String(form.name_en ?? "").trim() || null,
          code: String(form.code ?? "").trim() || null,
          description_ar: String(form.description_ar ?? "").trim() || null,
          description_en: String(form.description_en ?? "").trim() || null,
          department_type: form.department_type,
          parent_department_id: form.parent_department_id || null,
          is_clinical: Boolean(form.is_clinical),
          is_active: Boolean(form.is_active),
          sort_order: String(form.sort_order ?? 0),
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["departments-summary"] });
      queryClient.invalidateQueries({ queryKey: ["clinics-summary"] });
      toast({ title: row ? "حُفظ القسم" : "أُنشئ القسم" });
      onClose();
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: error instanceof Error ? error.message : "خطأ غير متوقع",
      }),
  });

  // القسم لا يكون أبًا لنفسه — والقاعدة تمنع الدورات على كل حال.
  const parentOptions = (departments.data ?? []).filter((d) => d.id !== row?.id);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{row ? "تعديل القسم" : "قسم جديد"}</DialogTitle>
          <DialogDescription>
            القسم يجمع العيادات والأطباء والخدمات، وعليه تُبنى التقارير.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="الاسم بالعربية *">
              <Input value={form.name_ar ?? ""} onChange={(e) => set("name_ar", e.target.value)} autoFocus />
            </Field>
            <Field label="الاسم بالإنجليزية">
              <Input
                value={form.name_en ?? ""}
                dir="ltr"
                onChange={(e) => set("name_en", e.target.value)}
              />
            </Field>
            <Field label="الكود">
              <Input value={form.code ?? ""} dir="ltr" onChange={(e) => set("code", e.target.value)} />
            </Field>
            <Field label="النوع">
              <Select
                value={form.department_type ?? "clinical"}
                onValueChange={(value) => set("department_type", value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DEPARTMENT_TYPES).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="القسم الأب">
              <Select
                value={form.parent_department_id || NONE}
                onValueChange={(value) => set("parent_department_id", value === NONE ? "" : value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>قسم رئيسي</SelectItem>
                  {parentOptions.map((department) => (
                    <SelectItem key={department.id} value={department.id}>
                      {department.name_ar}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="ترتيب العرض">
              <Input
                type="number"
                value={form.sort_order ?? 0}
                onChange={(e) => set("sort_order", e.target.value)}
              />
            </Field>
          </div>

          <Field label="الوصف">
            <Textarea
              rows={2}
              value={form.description_ar ?? ""}
              onChange={(e) => set("description_ar", e.target.value)}
            />
          </Field>

          <Separator />

          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={Boolean(form.is_clinical)}
              onCheckedChange={(value) => set("is_clinical", value)}
            />
            قسم سريري يستقبل مرضى
          </label>
          <p className="text-xs text-muted-foreground">
            الأقسام الإدارية والمساندة لا تُعرض في حجز المواعيد.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={Boolean(form.is_active)} onCheckedChange={(value) => set("is_active", value)} />
            نشط
          </label>
          <p className="text-xs text-muted-foreground">
            لا يمكن تعطيل قسم له عيادة نشطة — عطّل عياداته أولًا.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            disabled={!String(form.name_ar ?? "").trim() || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
function ClinicDialog({
  open,
  row,
  organizationId,
  onClose,
}: {
  open: boolean;
  row: any | null;
  organizationId: string | undefined;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const branches = useBranches(organizationId);
  const departments = useDepartments(organizationId);
  const [form, setForm] = useState<any>({});
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const key = open ? (row?.id ?? "__new__") : null;
  if (open && key !== loadedFor) {
    setForm(
      row
        ? { ...row, name: row.name_ar }
        : {
            name: "",
            code: "",
            clinic_type: "general",
            allows_walk_in: true,
            allows_online_booking: false,
            sort_order: 0,
          },
    );
    setLoadedFor(key);
  }
  if (!open && loadedFor !== null) setLoadedFor(null);

  const set = (field: string, value: any) => setForm((prev: any) => ({ ...prev, [field]: value }));

  const warehouses = useQuery({
    queryKey: ["warehouses-for-clinics", organizationId],
    enabled: open && Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouses")
        .select("id, name")
        .eq("organization_id", organizationId)
        .eq("is_disabled", false)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const zatca = useQuery({
    queryKey: ["zatca-for-clinics", organizationId],
    enabled: open && Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("zatca_companies")
        .select("id, name, vat_number")
        .eq("organization_id", organizationId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; vat_number: string }[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      if (!String(form.code ?? "").trim()) throw new Error("كود العيادة مطلوب");

      const text = (value: any) => {
        const raw = String(value ?? "").trim();
        return raw === "" ? null : raw;
      };

      // `app_save_clinic` لا تكتب المستودعات وشركة زاتكا (أعمدة تشغيلية
      // سابقة لهذه المرحلة)، فتُحدَّث بعدها في نفس الطلب المنطقي.
      const { data, error } = await supabase.rpc("app_save_clinic", {
        p_organization_id: organizationId,
        p_clinic_id: row?.id ?? null,
        p_payload: {
          name: String(form.name ?? "").trim(),
          name_en: text(form.name_en),
          code: String(form.code ?? "").trim(),
          branch_id: text(form.branch_id),
          department_id: text(form.department_id),
          clinic_type: text(form.clinic_type),
          specialty_value_id: text(form.specialty_value_id),
          phone_extension: text(form.phone_extension),
          floor: text(form.floor),
          room_number: text(form.room_number),
          default_visit_duration: text(form.default_visit_duration),
          allows_walk_in: Boolean(form.allows_walk_in),
          allows_online_booking: Boolean(form.allows_online_booking),
          capacity: text(form.capacity),
          color: text(form.color),
          sort_order: String(form.sort_order ?? 0),
        },
      });
      if (error) throw error;

      const clinicId = (data as string) ?? row?.id;
      const extras: Record<string, any> = {
        supplier_warehouse_id: text(form.supplier_warehouse_id),
        consumable_warehouse_id: text(form.consumable_warehouse_id),
        zatca_company_id: text(form.zatca_company_id),
      };
      const updated = await supabase.from("clinics").update(extras).eq("id", clinicId).select("id");
      if (updated.error) throw updated.error;
      if (!updated.data || updated.data.length === 0) {
        throw new Error("لم تُحدَّث بيانات المستودعات — تحقّق من صلاحيتك");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clinics-summary"] });
      queryClient.invalidateQueries({ queryKey: ["departments-summary"] });
      toast({ title: row ? "حُفظت العيادة" : "أُنشئت العيادة" });
      onClose();
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: error instanceof Error ? error.message : "خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{row ? "تعديل العيادة" : "عيادة جديدة"}</DialogTitle>
          <DialogDescription>
            العيادة تتبع فرعًا وقسمًا، ومنها تُشتقّ مدة الموعد والأطباء والخدمات المتاحة.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="الاسم بالعربية *">
              <Input value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} autoFocus />
            </Field>
            <Field label="الاسم بالإنجليزية">
              <Input value={form.name_en ?? ""} dir="ltr" onChange={(e) => set("name_en", e.target.value)} />
            </Field>
            <Field label="الكود *">
              <Input value={form.code ?? ""} dir="ltr" onChange={(e) => set("code", e.target.value)} />
            </Field>
            <Field label="الفرع">
              <Select
                value={form.branch_id || NONE}
                onValueChange={(value) => set("branch_id", value === NONE ? "" : value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>بدون فرع</SelectItem>
                  {(branches.data ?? []).map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="القسم">
              <Select
                value={form.department_id || NONE}
                onValueChange={(value) => set("department_id", value === NONE ? "" : value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>بدون قسم</SelectItem>
                  {(departments.data ?? [])
                    .filter((department) => department.is_active)
                    .map((department) => (
                      <SelectItem key={department.id} value={department.id}>
                        {department.name_ar}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="نوع العيادة">
              <Select
                value={form.clinic_type ?? "general"}
                onValueChange={(value) => set("clinic_type", value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CLINIC_TYPES).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="التخصص">
              <LookupSelect
                categoryKey="medical_specialties"
                value={form.specialty_value_id ?? ""}
                onChange={(value) => set("specialty_value_id", value)}
                placeholder="بدون تخصص"
              />
            </Field>
            <Field label="لون العيادة في التقويم">
              <div className="flex items-center gap-2">
                <Input
                  type="color"
                  className="h-9 w-14 p-1"
                  value={form.color ?? "#2E86AB"}
                  onChange={(e) => set("color", e.target.value)}
                />
                <Input
                  value={form.color ?? ""}
                  dir="ltr"
                  placeholder="#RRGGBB"
                  onChange={(e) => set("color", e.target.value)}
                />
              </div>
            </Field>
          </div>

          <Separator />

          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="الطابق">
              <Input value={form.floor ?? ""} onChange={(e) => set("floor", e.target.value)} />
            </Field>
            <Field label="رقم الغرفة">
              <Input value={form.room_number ?? ""} onChange={(e) => set("room_number", e.target.value)} />
            </Field>
            <Field label="التحويلة">
              <Input
                value={form.phone_extension ?? ""}
                dir="ltr"
                onChange={(e) => set("phone_extension", e.target.value)}
              />
            </Field>
            <Field label="ترتيب العرض">
              <Input
                type="number"
                value={form.sort_order ?? 0}
                onChange={(e) => set("sort_order", e.target.value)}
              />
            </Field>
            <Field label="مدة الزيارة (دقيقة)">
              <Input
                type="number"
                min={5}
                max={480}
                value={form.default_visit_duration ?? ""}
                onChange={(e) => set("default_visit_duration", e.target.value)}
              />
            </Field>
            <Field label="السعة المتزامنة">
              <Input
                type="number"
                min={1}
                value={form.capacity ?? ""}
                onChange={(e) => set("capacity", e.target.value)}
              />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">
            مدة الزيارة هنا قاعدةٌ احتياطية: مدة الخدمة تتقدّم عليها، ثم إعداد الطبيب.
          </p>

          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={Boolean(form.allows_walk_in)}
                onCheckedChange={(value) => set("allows_walk_in", value)}
              />
              تقبل الحضور المباشر
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={Boolean(form.allows_online_booking)}
                onCheckedChange={(value) => set("allows_online_booking", value)}
              />
              تقبل الحجز الإلكتروني
            </label>
          </div>

          <Separator />

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="المستودع المورِّد">
              <Select
                value={form.supplier_warehouse_id || NONE}
                onValueChange={(value) => set("supplier_warehouse_id", value === NONE ? "" : value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>بدون</SelectItem>
                  {(warehouses.data ?? []).map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="المستودع الاستهلاكي">
              <Select
                value={form.consumable_warehouse_id || NONE}
                onValueChange={(value) => set("consumable_warehouse_id", value === NONE ? "" : value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>بدون</SelectItem>
                  {(warehouses.data ?? []).map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="الكيان الضريبي">
              <Select
                value={form.zatca_company_id || NONE}
                onValueChange={(value) => set("zatca_company_id", value === NONE ? "" : value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>بدون</SelectItem>
                  {(zatca.data ?? []).map((company) => (
                    <SelectItem key={company.id} value={company.id}>
                      {company.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            disabled={
              !String(form.name ?? "").trim() || !String(form.code ?? "").trim() || save.isPending
            }
            onClick={() => save.mutate()}
          >
            {save.isPending ? "..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
/**
 * تعطيل العيادة وتفعيلها.
 *
 * التعطيل يمرّ بـ`app_disable_clinic` لا بتحديث مباشر: الدالة تُلزم بسبب،
 * وتعدّ المواعيد القادمة، وترفض التعطيل ما لم يُؤكَّد صراحةً. عيادةٌ تُعطَّل
 * وعليها مواعيد تترك المرضى بمواعيد لا مكان لها.
 */
function ClinicToggleDialog({ clinic, onClose }: { clinic: any | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [force, setForce] = useState(false);
  const isDisabled = Boolean(clinic?.is_disabled);
  const future = Number(clinic?.future_appointment_count ?? 0);

  const run = useMutation({
    mutationFn: async () => {
      if (!clinic) return;
      if (isDisabled) {
        const { error } = await supabase.rpc("app_enable_clinic", { p_clinic_id: clinic.id });
        if (error) throw error;
      } else {
        if (!reason.trim()) throw new Error("سبب التعطيل مطلوب");
        const { error } = await supabase.rpc("app_disable_clinic", {
          p_clinic_id: clinic.id,
          p_reason: reason.trim(),
          p_force: force,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clinics-summary"] });
      queryClient.invalidateQueries({ queryKey: ["departments-summary"] });
      toast({ title: isDisabled ? "فُعِّلت العيادة" : "عُطِّلت العيادة" });
      setReason("");
      setForce(false);
      onClose();
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذّر التنفيذ",
        description: error instanceof Error ? error.message : "خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={Boolean(clinic)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isDisabled ? "تفعيل العيادة" : "تعطيل العيادة"}</DialogTitle>
          <DialogDescription>
            {isDisabled
              ? "ستعود العيادة للظهور في حجز المواعيد."
              : "لن تظهر في حجز المواعيد الجديدة، وتبقى في المواعيد والتقارير التاريخية."}
          </DialogDescription>
        </DialogHeader>

        <p className="flex items-center gap-2 text-sm font-medium">
          <Stethoscope className="h-4 w-4 text-muted-foreground" />
          {clinic?.name_ar}
        </p>

        {!isDisabled && (
          <>
            {future > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                على هذه العيادة <strong>{future}</strong> موعدًا قادمًا. تعطيلها يتركها مواعيد بلا
                مكان — أعد جدولتها أولًا، أو أكّد التعطيل صراحةً.
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label>سبب التعطيل *</Label>
              <Textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="مثال: نقل العيادة إلى الدور الثاني"
              />
            </div>
            {future > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={force} onCheckedChange={setForce} />
                أفهم أن هناك مواعيد قادمة، وأؤكّد التعطيل
              </label>
            )}
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            variant={isDisabled ? "default" : "destructive"}
            disabled={
              run.isPending ||
              (!isDisabled && !reason.trim()) ||
              (!isDisabled && future > 0 && !force)
            }
            onClick={() => run.mutate()}
          >
            {run.isPending ? "..." : isDisabled ? "تفعيل" : "تعطيل"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
