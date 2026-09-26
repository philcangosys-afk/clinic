import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, Archive, Copy, Eye, Pencil, Plus, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";
import { cn } from "@/lib/utils";
import {
  BASE_ROLE_KEYS,
  LEVEL_LABELS,
  ROLE_LABELS,
  SCREENS_MODULE,
  buildRoleSections,
  keysForLevel,
  moduleLevel,
  sectionLevel,
  type AccessLevel,
  type CatalogRow,
} from "@/lib/role-permissions";

/**
 * الأدوار المخصّصة (0183): دورٌ تصنعه المنشأة بصلاحياتٍ تختارها، ومن يحمله
 * يرث تعديله فورًا.
 *
 * **لماذا ثلاث حالات لا مربّع لكلّ صلاحية:** كتالوج الصلاحيات قرابة مئتي
 * مفتاح. من يضبط دورًا لا يريد أن يقرأها مفتاحًا مفتاحًا، بل يقول «الفوترة:
 * قراءة فقط». والمفاتيح تبقى متاحةً تحت «تفصيل» لمن أراد الدقّة — فالسرعة
 * للحالة الشائعة والدقّة متاحة لا مفقودة.
 */

export type OrganizationRoleRow = {
  id: string;
  organization_id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  base_role_key: string;
  is_active: boolean;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
};

export function useOrganizationRoles(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["organization-roles", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_roles")
        .select("id, organization_id, code, name_ar, name_en, base_role_key, is_active, is_archived, created_at, updated_at")
        .eq("organization_id", organizationId)
        .eq("is_archived", false)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as OrganizationRoleRow[];
    },
  });
}

function usePermissionCatalog() {
  return useQuery({
    queryKey: ["permission-catalog"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("permission_catalog")
        .select("permission_key, name_ar, module_key, description_ar, display_order")
        .order("module_key")
        .order("display_order");
      if (error) throw error;
      return (data ?? []) as CatalogRow[];
    },
  });
}

/**
 * افتراضات الصفات الجاهزة — `role_default_permissions` (0062 و0143).
 *
 * **لماذا شاشة لها أصلًا:** الصفة تُختار من قائمةٍ منسدلة بلا أن يُرى ما
 * تعنيه. و«مدير فرع» مثلًا يملك في القاعدة **كلّ** الشاشات (0143 منحته `*`)،
 * فمن أسنده ظنًّا أنّه أقلّ من مدير النظام أعطى ما لم يقصد. ما لا يُرى لا
 * يُراجَع.
 *
 * الجدول مقروءٌ لكلّ من دخل (سياسة `role_default_permissions_read`)، وهو
 * نفسه الذي تقرؤه `app_has_permission` — فما يُعرض هنا هو ما يجري فعلًا، لا
 * وصفٌ مكتوب بجانبه.
 */
function useRoleDefaults() {
  return useQuery({
    queryKey: ["role-default-permissions"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_default_permissions")
        .select("role_key, permission_key");
      if (error) throw error;
      const byRole: Record<string, string[]> = {};
      for (const row of (data ?? []) as { role_key: string; permission_key: string }[]) {
        (byRole[row.role_key] ??= []).push(row.permission_key);
      }
      return byRole;
    },
  });
}

const dateText = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString("en-GB", { timeZone: "Asia/Riyadh" }) : "—";

export default function RolesPanel({
  organizationId,
  canManage,
}: {
  organizationId: string | undefined;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const roles = useOrganizationRoles(organizationId);
  const [editing, setEditing] = useState<OrganizationRoleRow | null>(null);
  const [creating, setCreating] = useState(false);
  /** صلاحياتٌ تُملأ بها شاشة الدور الجديد — نسخةً من صفةٍ جاهزة. */
  const [prefill, setPrefill] = useState<{ baseRole: string; permissions: string[] } | null>(null);

  const holders = useQuery({
    queryKey: ["organization-role-holders", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_memberships")
        .select("custom_role_id")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .not("custom_role_id", "is", null);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of (data ?? []) as { custom_role_id: string }[]) {
        counts[row.custom_role_id] = (counts[row.custom_role_id] ?? 0) + 1;
      }
      return counts;
    },
  });

  const archive = useMutation({
    mutationFn: async (roleId: string) => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      const { error } = await supabase.rpc("app_archive_organization_role", {
        p_organization_id: organizationId,
        p_role_id: roleId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization-roles"] });
      toast({ title: "أُرشف الدور" });
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّرت الأرشفة", description: errorMessage(error) }),
  });

  return (
    <div className="flex flex-col gap-5">
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            الأدوار المخصّصة
          </CardTitle>
          <CardDescription>
            الدور يحمل صلاحياته، ومن يحمله يرث تعديلها فورًا — بلا ضبطٍ لكلّ موظّف على حدة
          </CardDescription>
        </div>
        {canManage && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            إضافة دور جديد
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {roles.isLoading && <Skeleton className="h-40 w-full" />}
        {!roles.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>رقم الدور</TableHead>
                <TableHead>اسم الدور</TableHead>
                <TableHead>بالإنجليزية</TableHead>
                <TableHead>الدور الأساس</TableHead>
                <TableHead>المستخدمون</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>تاريخ الإضافة</TableHead>
                <TableHead>آخر تعديل</TableHead>
                <TableHead className="w-32">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(roles.data ?? []).map((role) => (
                <TableRow key={role.id}>
                  <TableCell className="font-mono text-xs">{role.code}</TableCell>
                  <TableCell className="font-medium">{role.name_ar}</TableCell>
                  <TableCell className="text-xs text-muted-foreground" dir="ltr">
                    {role.name_en ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs">{ROLE_LABELS[role.base_role_key] ?? role.base_role_key}</TableCell>
                  <TableCell className="text-xs">{holders.data?.[role.id] ?? 0}</TableCell>
                  <TableCell>
                    <Badge variant={role.is_active ? "success" : "secondary"}>
                      {role.is_active ? "فعال" : "موقوف"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{dateText(role.created_at)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{dateText(role.updated_at)}</TableCell>
                  <TableCell>
                    {canManage && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" title="تعديل" onClick={() => setEditing(role)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="أرشفة الدور"
                          disabled={archive.isPending}
                          onClick={() => archive.mutate(role.id)}
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(roles.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                    لا أدوار مخصّصة بعد — الأعضاء يعملون بأدوارهم الجاهزة.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {(creating || editing) && (
        <RoleEditorDialog
          key={editing?.id ?? (prefill ? `new-from-${prefill.baseRole}` : "new-role")}
          organizationId={organizationId}
          role={editing}
          prefill={editing ? null : prefill}
          onOpenChange={(open) => {
            if (!open) {
              setCreating(false);
              setEditing(null);
              setPrefill(null);
            }
          }}
        />
      )}
    </Card>

      <BaseRolesCard
        canManage={canManage}
        onCopy={(baseRole, permissions) => {
          setPrefill({ baseRole, permissions });
          setCreating(true);
        }}
      />
    </div>
  );
}

function LevelButtons({
  level,
  onChange,
  size = "default",
}: {
  level: AccessLevel;
  onChange: (level: Exclude<AccessLevel, "custom">) => void;
  size?: "default" | "sm";
}) {
  const options: Exclude<AccessLevel, "custom">[] = ["none", "read", "full"];
  return (
    <div className="flex items-center gap-1">
      {level === "custom" && (
        <Badge variant="outline" className="ml-1 text-[10px]">
          {LEVEL_LABELS.custom}
        </Badge>
      )}
      {options.map((option) => {
        const active = level === option;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-md border px-2 font-medium transition-colors",
              size === "sm" ? "h-6 text-[11px]" : "h-7 text-xs",
              active
                ? option === "full"
                  ? "border-primary bg-primary text-primary-foreground"
                  : option === "read"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-foreground/40 bg-foreground/80 text-background"
                : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {LEVEL_LABELS[option]}
          </button>
        );
      })}
    </div>
  );
}

function RoleEditorDialog({
  organizationId,
  role,
  prefill,
  onOpenChange,
}: {
  organizationId: string | undefined;
  role: OrganizationRoleRow | null;
  /**
   * دورٌ جديد يبدأ من صلاحيات صفةٍ جاهزة بدل الصفر.
   *
   * البدء من صفرٍ يعني تأشير عشرات المفاتيح يدويًّا لإعادة بناء ما تعرفه
   * القاعدة سلفًا — ومن يفعل ذلك تحت الضجر يؤشّر «إدارة كاملة» للكلّ. فالبدء
   * من الصفة ثمّ التقليم هو الطريق الذي ينتهي بدورٍ محدود فعلًا.
   */
  prefill?: { baseRole: string; permissions: string[] } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const catalog = usePermissionCatalog();
  const [nameAr, setNameAr] = useState(role?.name_ar ?? "");
  const [nameEn, setNameEn] = useState(role?.name_en ?? "");
  const [baseRole, setBaseRole] = useState(role?.base_role_key ?? prefill?.baseRole ?? "employee");
  const [isActive, setIsActive] = useState(role?.is_active ?? true);
  const [granted, setGranted] = useState<Set<string>>(new Set(role ? [] : (prefill?.permissions ?? [])));
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(["فتح الشاشات"]));
  const [detailed, setDetailed] = useState<Set<string>>(new Set());

  const existing = useQuery({
    queryKey: ["organization-role-permissions", role?.id],
    enabled: Boolean(role?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_role_permissions")
        .select("permission_key")
        .eq("role_id", role?.id);
      if (error) throw error;
      return (data ?? []).map((row: { permission_key: string }) => row.permission_key);
    },
  });

  useEffect(() => {
    if (existing.data) setGranted(new Set(existing.data));
  }, [existing.data]);

  const sections = useMemo(() => buildRoleSections(catalog.data ?? []), [catalog.data]);

  const setKeys = (keys: string[], on: boolean) => {
    setGranted((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  };

  const applyLevel = (rows: CatalogRow[], level: Exclude<AccessLevel, "custom">) => {
    setKeys(rows.map((row) => row.permission_key), false);
    setKeys(keysForLevel(rows, level), true);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      if (!nameAr.trim()) throw new Error("اسم الدور بالعربية مطلوب");
      const { error } = await supabase.rpc("app_save_organization_role", {
        p_organization_id: organizationId,
        p_role_id: role?.id ?? null,
        p_name_ar: nameAr.trim(),
        p_name_en: nameEn.trim() || null,
        p_base_role_key: baseRole,
        p_is_active: isActive,
        p_permissions: [...granted],
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organization-roles"] });
      queryClient.invalidateQueries({ queryKey: ["organization-role-permissions"] });
      queryClient.invalidateQueries({ queryKey: ["my-permissions"] });
      toast({ title: role ? "حُفظ الدور" : "أُضيف الدور" });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر الحفظ", description: errorMessage(error) }),
  });

  const allRows = useMemo(
    () => sections.flatMap((section) => section.modules.flatMap((module) => module.rows)),
    [sections],
  );
  const allSelected = allRows.length > 0 && allRows.every((row) => granted.has(row.permission_key));

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{role ? `تعديل الدور — ${role.name_ar}` : "دور جديد"}</DialogTitle>
          <DialogDescription>
            اختر لكلّ قسم: بدون وصول، أو قراءة فقط (عرضٌ وبحثٌ وطباعة بلا تعديل)، أو إدارة كاملة
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <Label>الاسم بالعربية *</Label>
            <Input value={nameAr} onChange={(event) => setNameAr(event.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الاسم بالإنجليزية</Label>
            <Input value={nameEn} onChange={(event) => setNameEn(event.target.value)} dir="ltr" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الدور الأساس</Label>
            <Select value={baseRole} onValueChange={setBaseRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BASE_ROLE_KEYS.map((key) => (
                  <SelectItem key={key} value={key}>
                    {ROLE_LABELS[key] ?? key}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              به تُقاس حماية القاعدة نفسها — اختر الأقرب لعمل هذا الدور
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>حالة الدور</Label>
            <Select value={isActive ? "active" : "inactive"} onValueChange={(value) => setIsActive(value === "active")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">فعال</SelectItem>
                <SelectItem value="inactive">موقوف</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2">
          <div className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={allSelected}
              onCheckedChange={(checked) => setKeys(allRows.map((row) => row.permission_key), checked === true)}
            />
            <span>اختيار الكل — إدارة كاملة لكلّ الأقسام</span>
          </div>
          <span className="text-xs text-muted-foreground">{granted.size} صلاحية مختارة</span>
        </div>

        {catalog.isLoading && <Skeleton className="h-64 w-full" />}

        <div className="flex flex-col gap-2">
          {sections.map((section) => {
            const modules = section.modules;
            const rows = modules.flatMap((module) => module.rows);
            const level = sectionLevel(modules, granted);
            const open = openSections.has(section.key);
            const isScreens = modules.length === 1 && modules[0].key === SCREENS_MODULE;
            return (
              <div key={section.key} className="rounded-lg border">
                <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/40 px-3 py-2">
                  <button
                    type="button"
                    className="flex items-center gap-2 text-sm font-semibold"
                    onClick={() =>
                      setOpenSections((current) => {
                        const next = new Set(current);
                        if (next.has(section.key)) next.delete(section.key);
                        else next.add(section.key);
                        return next;
                      })
                    }
                  >
                    {open ? <ChevronDown className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                    {section.key}
                    <span className="text-xs font-normal text-muted-foreground">
                      {isScreens ? `${rows.length} شاشة` : `${modules.length} قسم`}
                    </span>
                  </button>
                  <LevelButtons level={level} onChange={(next) => applyLevel(rows, next)} />
                </div>

                {open && (
                  <div className="flex flex-col divide-y">
                    {isScreens
                      ? rows.map((row) => (
                          <label
                            key={row.permission_key}
                            className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-muted/40"
                          >
                            <span className="flex items-center gap-2">
                              <Checkbox
                                checked={granted.has(row.permission_key)}
                                onCheckedChange={(checked) => setKeys([row.permission_key], checked === true)}
                              />
                              {row.name_ar}
                            </span>
                            <span className="font-mono text-[10px] text-muted-foreground">{row.permission_key}</span>
                          </label>
                        ))
                      : modules.map((module) => {
                          const moduleState = moduleLevel(module.rows, granted);
                          const showDetail = detailed.has(module.key);
                          return (
                            <div key={module.key} className="flex flex-col gap-1 px-3 py-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-sm font-medium">{module.label}</span>
                                <div className="flex items-center gap-2">
                                  <LevelButtons
                                    level={moduleState}
                                    size="sm"
                                    onChange={(next) => applyLevel(module.rows, next)}
                                  />
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 px-2 text-[11px]"
                                    onClick={() =>
                                      setDetailed((current) => {
                                        const next = new Set(current);
                                        if (next.has(module.key)) next.delete(module.key);
                                        else next.add(module.key);
                                        return next;
                                      })
                                    }
                                  >
                                    {showDetail ? "إخفاء التفصيل" : "تفصيل"}
                                  </Button>
                                </div>
                              </div>
                              {showDetail && (
                                <div className="grid grid-cols-1 gap-1 rounded-md bg-muted/30 p-2 sm:grid-cols-2">
                                  {module.rows.map((row) => (
                                    <label
                                      key={row.permission_key}
                                      className="flex cursor-pointer items-center gap-2 text-xs"
                                      title={row.description_ar ?? undefined}
                                    >
                                      <Checkbox
                                        checked={granted.has(row.permission_key)}
                                        onCheckedChange={(checked) => setKeys([row.permission_key], checked === true)}
                                      />
                                      {row.name_ar}
                                    </label>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button disabled={save.isPending || !nameAr.trim()} onClick={() => save.mutate()}>
            {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


/**
 * ═══ الصفات الجاهزة وما تعنيه ══════════════════════════════════════════════
 *
 * الصفات الاثنتا عشرة مثبّتة في القاعدة، وبها تُقاس سياسات الحماية. وما تمنحه
 * كلٌّ منها كان مكتوبًا في ترقياتٍ لا يقرؤها المالك. هنا يُقرأ من الجدول نفسه.
 *
 * **مالك المنشأة ومدير النظام لا افتراضات لهما بالمعنى المفيد:** الأسبقية
 * الأولى في `app_has_permission` تُرجع `true` لهما قبل النظر في أيّ جدول:
 *
 *     when exists (… m.role_key in ('owner','organization_admin')) then true
 *
 * فيُعرضان بذلك صراحةً بدل عددٍ يُوهم أنّ لهما حدًّا.
 */
function BaseRolesCard({
  canManage,
  onCopy,
}: {
  canManage: boolean;
  onCopy: (baseRole: string, permissions: string[]) => void;
}) {
  const defaults = useRoleDefaults();
  const catalog = usePermissionCatalog();
  const [viewing, setViewing] = useState<string | null>(null);

  const ADMIN_ROLES = ["owner", "organization_admin"];
  const rows = Object.keys(ROLE_LABELS);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          الصفات الجاهزة — ماذا تمنح كلّ صفة
        </CardTitle>
        <CardDescription>
          هذه صفات القاعدة الثابتة، وهي ما يسري على العضو ما لم يُسنَد له دورٌ مخصّص.
          افتحها قبل أن تُسند صفةً لأحد.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {(defaults.isLoading || catalog.isLoading) && <Skeleton className="h-40 w-full" />}
        {defaults.isError && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            تعذّرت قراءة افتراضات الصفات: {errorMessage(defaults.error)}
          </p>
        )}
        {defaults.isSuccess && catalog.isSuccess && (
          <Table className="min-w-[640px] [&_th]:whitespace-nowrap">
            <TableHeader>
              <TableRow>
                <TableHead className="w-56">الصفة</TableHead>
                <TableHead className="w-40">عدد الصلاحيات</TableHead>
                <TableHead>الشاشات المفتوحة</TableHead>
                <TableHead className="w-56 text-center">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((roleKey) => {
                const keys = defaults.data?.[roleKey] ?? [];
                const isAdmin = ADMIN_ROLES.includes(roleKey);
                const screenKeys = keys.filter((key) =>
                  (catalog.data ?? []).some(
                    (row) => row.permission_key === key && row.module_key === SCREENS_MODULE,
                  ),
                );
                const screensTotal = (catalog.data ?? []).filter(
                  (row) => row.module_key === SCREENS_MODULE,
                ).length;
                return (
                  <TableRow key={roleKey}>
                    <TableCell className="font-medium">{ROLE_LABELS[roleKey]}</TableCell>
                    <TableCell>
                      {isAdmin ? (
                        <Badge variant="outline" className="whitespace-nowrap">
                          كل شيء — تتخطّى الفحص
                        </Badge>
                      ) : (
                        <span className="font-mono text-xs">{keys.length}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {isAdmin
                        ? "كل الشاشات"
                        : screenKeys.length === screensTotal && screensTotal > 0
                          ? `كل الشاشات (${screensTotal})`
                          : `${screenKeys.length} من ${screensTotal}`}
                    </TableCell>
                    <TableCell className="text-center">
                      {!isAdmin && (
                        <div className="flex justify-center gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setViewing(roleKey)}>
                            <Eye className="h-3.5 w-3.5" />
                            عرض التفصيل
                          </Button>
                          {canManage && (
                            <Button
                              size="sm"
                              variant="outline"
                              title="ابدأ دورًا مخصّصًا بنسخةٍ من صلاحيات هذه الصفة، ثمّ قلّمها"
                              onClick={() => onCopy(roleKey, keys)}
                            >
                              <Copy className="h-3.5 w-3.5" />
                              نسخ إلى دور
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {viewing && (
        <BaseRoleDetailDialog
          roleKey={viewing}
          permissions={defaults.data?.[viewing] ?? []}
          catalog={catalog.data ?? []}
          onOpenChange={() => setViewing(null)}
        />
      )}
    </Card>
  );
}

/** تفصيل صفةٍ جاهزة — للقراءة وحدها؛ الصفات لا تُعدَّل من الشاشة. */
function BaseRoleDetailDialog({
  roleKey,
  permissions,
  catalog,
  onOpenChange,
}: {
  roleKey: string;
  permissions: string[];
  catalog: CatalogRow[];
  onOpenChange: (open: boolean) => void;
}) {
  const granted = useMemo(() => new Set(permissions), [permissions]);
  const sections = useMemo(() => buildRoleSections(catalog), [catalog]);
  const [open, setOpen] = useState<Set<string>>(new Set());

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>صلاحيات صفة: {ROLE_LABELS[roleKey] ?? roleKey}</DialogTitle>
          <DialogDescription>
            للقراءة فقط — الصفات ثابتة في القاعدة وبها تُقاس سياسات الحماية.
            لتقييد أحدهم أنشئ دورًا مخصّصًا وأسنده إليه.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {sections.map((section) => {
            const level = sectionLevel(section.modules, granted);
            const isOpen = open.has(section.key);
            return (
              <div key={section.key} className="rounded-lg border">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-start"
                  onClick={() =>
                    setOpen((current) => {
                      const next = new Set(current);
                      if (next.has(section.key)) next.delete(section.key);
                      else next.add(section.key);
                      return next;
                    })
                  }
                >
                  <span className="flex items-center gap-2">
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="font-semibold">{section.key}</span>
                    <span className="text-xs text-muted-foreground">{section.modules.length} قسم</span>
                  </span>
                  <Badge
                    variant={level === "none" ? "secondary" : "outline"}
                    className={cn(
                      "whitespace-nowrap",
                      level === "full" && "border-primary text-primary",
                      level === "read" && "border-primary/50 text-primary",
                    )}
                  >
                    {LEVEL_LABELS[level]}
                  </Badge>
                </button>

                {isOpen && (
                  <div className="flex flex-col gap-1.5 border-t px-3 py-2.5">
                    {section.modules.map((module) => {
                      const moduleState = moduleLevel(module.rows, granted);
                      return (
                        <div key={module.key} className="flex flex-col gap-1">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm">{module.label}</span>
                            <Badge
                              variant={moduleState === "none" ? "secondary" : "outline"}
                              className={cn(
                                "whitespace-nowrap text-[11px]",
                                moduleState === "full" && "border-primary text-primary",
                                moduleState === "read" && "border-primary/50 text-primary",
                              )}
                            >
                              {LEVEL_LABELS[moduleState]}
                            </Badge>
                          </div>
                          {/* «فتح الشاشات» يُفصَّل دائمًا: كلّ مفتاحٍ فيه شاشةٌ
                              قائمة بذاتها، و«مخصّص» وحدها لا تقول أيّها. */}
                          {(module.key === SCREENS_MODULE || moduleState === "custom") && (
                            <div className="flex flex-wrap gap-1 pb-1 ps-3">
                              {module.rows
                                .filter((row) => granted.has(row.permission_key))
                                .map((row) => (
                                  <Badge
                                    key={row.permission_key}
                                    variant="secondary"
                                    className="text-[10px] font-normal"
                                  >
                                    {row.name_ar}
                                  </Badge>
                                ))}
                              {module.rows.every((row) => !granted.has(row.permission_key)) && (
                                <span className="text-[11px] text-muted-foreground">لا شيء</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إغلاق
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
