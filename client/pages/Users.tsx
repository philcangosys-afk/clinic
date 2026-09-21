import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserCog, ShieldCheck, Info } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { isOrganizationAdmin } from "@/lib/organization-access";
import type { OrganizationRole } from "@shared/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";

/**
 * بيانات المستخدمين والصلاحيات (لقطة 6).
 *
 * جدولا `organization_memberships` و `membership_permissions` موجودان منذ
 * 0001 لكن لم توجد أي شاشة لإدارتهما — كان تغيير صفة مستخدم أو صلاحياته
 * يتطلب تعديلًا يدويًا في قاعدة البيانات. وهذا بدوره كان يعطّل "حد الخصم
 * لمستخدم معيّن" (لقطة 7) لأنه يحتاج اختيار مستخدم من قائمة.
 *
 * حدّ مقصود: إنشاء حساب مستخدم جديد لا يتم من هنا. إنشاء مستخدم في
 * Supabase Auth يتطلب مفتاح خدمة (service role) لا يجوز إطلاقًا وضعه في كود
 * المتصفح، لأن من يملكه يملك صلاحية كاملة على كل بيانات كل المؤسسات. الطريقة
 * الآمنة: يسجّل الشخص حسابه بنفسه ثم يُسنَد له دور من هذه الشاشة.
 */
const ROLE_LABELS: Record<OrganizationRole, string> = {
  owner: "مالك المنشأة",
  organization_admin: "مدير النظام",
  branch_manager: "مدير فرع",
  doctor: "طبيب",
  nurse: "ممرّض/ة",
  receptionist: "موظف استقبال",
  pharmacist: "صيدلاني",
  lab_technician: "فني مختبر",
  radiology_technician: "فني أشعة",
  accountant: "محاسب",
  hr_manager: "مدير موارد بشرية",
  employee: "موظف",
};

type MemberRow = {
  organization_id: string;
  user_id: string;
  role_key: OrganizationRole;
  is_active: boolean;
  created_at: string;
  display_name: string;
  display_language: "ar" | "en";
  mobile_number: string | null;
  note: string | null;
};

function useMembers(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["org-members-admin", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      // الأسماء المعروضة تأتي من العرض الموجود (يشتقّها من doctors/employees)،
      // والحالة والصفة من جدول العضويات نفسه لأن العرض يُظهر النشطين فقط.
      const [memberships, directory] = await Promise.all([
        supabase
          .from("organization_memberships")
          .select(
            "organization_id, user_id, role_key, is_active, created_at, display_language, mobile_number, note",
          )
          .eq("organization_id", organizationId),
        supabase
          .from("v_organization_members_directory")
          .select("user_id, display_name")
          .eq("organization_id", organizationId),
      ]);
      if (memberships.error) throw memberships.error;
      if (directory.error) throw directory.error;
      const names = new Map(
        (directory.data ?? []).map((row: { user_id: string; display_name: string }) => [
          row.user_id,
          row.display_name,
        ]),
      );
      return (memberships.data ?? []).map((row) => ({
        ...row,
        display_name: names.get(row.user_id) ?? `مستخدم ${row.user_id.slice(0, 8)}`,
      })) as MemberRow[];
    },
  });
}

function usePermissions(organizationId: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: ["membership-permissions", organizationId, userId],
    enabled: Boolean(organizationId && userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("membership_permissions")
        .select("permission_key, granted")
        .eq("organization_id", organizationId)
        .eq("user_id", userId);
      if (error) throw error;
      return (data ?? []) as { permission_key: string; granted: boolean }[];
    },
  });
}

/**
 * الصلاحية الفعلية ومصدرها لكل عضو — المرحلة 28.
 *
 * الاستثناءات وحدها لا تكفي: المستخدم قد يملك الصلاحية من افتراض دوره،
 * أو من صفته الإدارية، ولا شيء منها يظهر في جدول الاستثناءات. هذا المنظور
 * يجمع الطبقات الثلاث ويقول من أين جاءت كل صلاحية.
 */
function useEffectivePermissions(organizationId: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: ["effective-permissions", organizationId, userId],
    enabled: Boolean(organizationId && userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_user_effective_permissions")
        .select("permission_key, is_allowed, source")
        .eq("organization_id", organizationId)
        .eq("user_id", userId);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

const SOURCE_LABEL: Record<string, string> = {
  admin: "صفة إدارية",
  explicit_grant: "منح صريح",
  explicit_deny: "منع صريح",
  role_default: "افتراض الدور",
  none: "غير ممنوحة",
};

/**
 * الصلاحيات المتاحة تُقرأ من كتالوج القاعدة لا من سجل الموديولات.
 *
 * كانت القائمة تُشتقّ من `requiredPermission` في `module-registry.ts`، وهي
 * بصيغة `<الميزة>.view` — فنتج عن ذلك خطآن: مفاتيح لا وجود لها في
 * `permission_catalog` فترفضها `app_set_member_permission` برسالة «صلاحية غير
 * معروفة»، وغياب كل الصلاحيات التنفيذية (منح `integrations.manage` أو
 * `privacy.retention` أو `users.permissions` لم يكن ممكنًا من أي شاشة).
 * الكتالوج هو المرجع الوحيد لما يمكن منحه أو منعه، فمنه تُبنى النافذة.
 */
type CatalogRow = {
  permission_key: string;
  name_ar: string;
  module_key: string;
  description_ar: string | null;
  display_order: number | null;
};

function usePermissionCatalog() {
  return useQuery({
    queryKey: ["permission-catalog"],
    // الكتالوج ثابت لا يتغيّر بتغيّر المستخدم المعروض، فيُجلب مرة ويُعاد استعماله.
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

/** عناوين عربية لنطاقات الكتالوج (`module_key`) — المفتاح الخام يُعرض إن استُجدّ نطاق. */
const MODULE_LABELS: Record<string, string> = {
  screens: "فتح الشاشات",
  users: "المستخدمون والصلاحيات",
  security: "الخصوصية وسجل التدقيق",
  settings: "الإعدادات والسياسات",
  structure: "الفروع والأقسام",
  patients: "ملفات المرضى",
  reception: "الاستقبال",
  appointments: "المواعيد",
  visits: "الزيارات",
  vitals: "العلامات الحيوية",
  doctor_workspace: "مساحة عمل الطبيب",
  doctors: "الأطباء",
  exam_templates: "قوالب الفحص",
  laboratory: "المختبر",
  radiology: "الأشعة والتصوير",
  radiology_console: "محطة الأشعة",
  pharmacy: "الصيدلية وصرف الأدوية",
  inventory: "المخزون",
  purchasing: "المشتريات والموردون",
  catalog: "الأصناف والخدمات",
  billing: "الفوترة والمدفوعات",
  cashier: "الصندوق",
  accounting: "المحاسبة",
  insurance: "التأمين والمطالبات",
  documents: "المستندات",
  hr: "الموارد البشرية",
  quality: "الجودة والحوادث",
  assets: "الأصول والصيانة",
  messaging: "الرسائل",
  notifications: "التنبيهات",
  integrations: "التكاملات",
  portal: "بوابة المريض",
  reports: "التقارير",
  analytics: "التحليلات",
};

function PermissionsDialog({
  member,
  onOpenChange,
  organizationId,
}: {
  member: MemberRow | null;
  onOpenChange: () => void;
  organizationId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const permissions = usePermissions(organizationId, member?.user_id);
  const effective = useEffectivePermissions(organizationId, member?.user_id);
  const catalog = usePermissionCatalog();
  const [term, setTerm] = useState("");
  const [openModules, setOpenModules] = useState<Set<string>>(new Set());
  const effectiveMap = new Map(
    (effective.data ?? []).map((row: any) => [row.permission_key, row]),
  );

  const isAdmin = member ? isOrganizationAdmin(member.role_key) : false;
  const overrides = new Map((permissions.data ?? []).map((row) => [row.permission_key, row.granted]));

  const groups = useMemo(() => {
    const query = term.trim().toLowerCase();
    const matches = (row: CatalogRow) =>
      !query ||
      row.name_ar.toLowerCase().includes(query) ||
      row.permission_key.toLowerCase().includes(query) ||
      (MODULE_LABELS[row.module_key] ?? row.module_key).toLowerCase().includes(query);

    const byModule = new Map<string, CatalogRow[]>();
    (catalog.data ?? []).filter(matches).forEach((row) => {
      const list = byModule.get(row.module_key);
      if (list) list.push(row);
      else byModule.set(row.module_key, [row]);
    });
    return [...byModule]
      .map(([key, rows]) => ({ key, label: MODULE_LABELS[key] ?? key, rows }))
      // «فتح الشاشات» أولًا لأنه أكثر ما يُمنح، والبقية بترتيب أسمائها العربية.
      .sort((a, b) =>
        a.key === "screens" ? -1 : b.key === "screens" ? 1 : a.label.localeCompare(b.label, "ar"),
      );
  }, [catalog.data, term]);

  // البحث يفتح المجموعات المطابقة: طيُّها مع بحثٍ نشط يُظهر عناوين بلا نتائج.
  const searching = term.trim().length > 0;

  const setPermission = useMutation({
    mutationFn: async ({ key, granted }: { key: string; granted: boolean | null }) => {
      if (!organizationId || !member) throw new Error("بيانات غير مكتملة");
      // المنح والمنع يمرّان بدوالّ المرحلة 28: تتحقّق من الصلاحية، وتتأكّد
      // أن المفتاح موجود في الكتالوج، وتكتب في سجل التدقيق. الكتابة المباشرة
      // في الجدول كانت تتجاوز ذلك كله.
      if (granted === null) {
        const { error } = await supabase.rpc("app_clear_member_permission", {
          p_org: organizationId,
          p_user_id: member.user_id,
          p_permission: key,
        });
        if (error) throw error;
        return;
      }
      const { error } = await supabase.rpc("app_set_member_permission", {
        p_org: organizationId,
        p_user_id: member.user_id,
        p_permission: key,
        p_granted: granted,
        p_reason: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["membership-permissions"] });
      queryClient.invalidateQueries({ queryKey: ["effective-permissions"] });
      queryClient.invalidateQueries({ queryKey: ["duty-conflicts"] });
      toast({ title: "تم تحديث الصلاحية" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التحديث",
        description: errorMessage(error),
      }),
  });

  return (
    <Dialog open={Boolean(member)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>صلاحيات: {member?.display_name}</DialogTitle>
          <DialogDescription>
            كل صلاحيات النظام كما هي مسجَّلة في القاعدة، مجموعة بنطاقها. الصفة تمنح صلاحيات
            افتراضية — وهنا تضيف استثناءات فوقها لهذا المستخدم وحده.
          </DialogDescription>
        </DialogHeader>

        {isAdmin && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              هذا المستخدم بصفة إدارية ويملك كل الصلاحيات تلقائيًا — الاستثناءات أدناه لن تُطبَّق عليه.
            </span>
          </div>
        )}

        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="ابحث في الصلاحيات بالاسم أو المفتاح أو النطاق..."
        />

        {catalog.isError && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
            تعذّر قراءة كتالوج الصلاحيات:{" "}
            {errorMessage(catalog.error, "خطأ غير متوقع")}
          </div>
        )}

        {(permissions.isLoading || catalog.isLoading) && <Skeleton className="h-40 w-full" />}
        {!permissions.isLoading && !catalog.isLoading && (
          <div className="flex flex-col gap-2">
            {groups.map((group) => {
              const expanded = searching || openModules.has(group.key);
              // عدد الاستثناءات المضبوطة داخل النطاق يظهر على العنوان المطويّ،
              // وإلا لبقيت الاستثناءات مخفيّة داخل مجموعة مطويّة بلا أي أثر ظاهر.
              const overrideCount = group.rows.filter((row) => overrides.has(row.permission_key)).length;
              return (
                <div key={group.key} className="rounded-lg border">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenModules((prev) => {
                        const next = new Set(prev);
                        if (next.has(group.key)) next.delete(group.key);
                        else next.add(group.key);
                        return next;
                      })
                    }
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start"
                  >
                    <span className="text-sm font-semibold">{group.label}</span>
                    <span className="flex items-center gap-2">
                      {overrideCount > 0 && (
                        <Badge variant="secondary" className="text-[10px]">
                          {overrideCount} استثناء
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">{group.rows.length}</span>
                    </span>
                  </button>
                  {expanded && (
                    <div className="flex flex-col gap-1 border-t p-2">
                      {group.rows.map((permission) => {
                        const override = overrides.get(permission.permission_key);
                        const state = override === undefined ? "default" : override ? "granted" : "denied";
                        const effectiveRow = effectiveMap.get(permission.permission_key) as any;
                        return (
                          <div
                            key={permission.permission_key}
                            className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{permission.name_ar}</p>
                              <p className="truncate font-mono text-[10px] text-muted-foreground">
                                {permission.permission_key}
                              </p>
                              {permission.description_ar && (
                                <p className="truncate text-[10px] text-muted-foreground">
                                  {permission.description_ar}
                                </p>
                              )}
                              {effectiveRow && (
                                <p className="text-[10px]">
                                  <span
                                    className={
                                      effectiveRow.is_allowed
                                        ? "text-emerald-600"
                                        : "text-muted-foreground"
                                    }
                                  >
                                    {effectiveRow.is_allowed
                                      ? "الوضع الفعلي: مسموح"
                                      : "الوضع الفعلي: ممنوع"}
                                  </span>
                                  <span className="text-muted-foreground">
                                    {" · "}
                                    {SOURCE_LABEL[effectiveRow.source] ?? effectiveRow.source}
                                  </span>
                                </p>
                              )}
                            </div>
                            <Select
                              value={state}
                              onValueChange={(value) =>
                                setPermission.mutate({
                                  key: permission.permission_key,
                                  granted: value === "default" ? null : value === "granted",
                                })
                              }
                            >
                              <SelectTrigger className="w-36 shrink-0">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="default">حسب الصفة</SelectItem>
                                <SelectItem value="granted">مسموح</SelectItem>
                                <SelectItem value="denied">ممنوع</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            {groups.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                لا صلاحية مطابقة لبحثك.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onOpenChange}>
            إغلاق
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * بيانات العضوية (لغة العرض/الجوال/الملاحظة — أعمدة 0042). مكانها
 * `organization_memberships` لا `auth.users`: هذه خصائص عضوية في منشأة
 * بعينها، والعميل لا يملك صلاحية الكتابة في `auth.users` أصلًا.
 *
 * النموذج يُبنى بحالة محلية داخل مكوّن يُركَّب من جديد لكل عضو (المفتاح
 * user_id) — لولا ذلك لاحتفظ الحقل بقيمة العضو السابق عند فتح عضو آخر.
 */
function MemberDetailsDialog({
  member,
  onOpenChange,
  onSave,
  saving,
}: {
  member: MemberRow | null;
  onOpenChange: () => void;
  onSave: (patch: { display_language: "ar" | "en"; mobile_number: string | null; note: string | null }) => void;
  saving: boolean;
}) {
  if (!member) return null;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <MemberDetailsForm
          key={member.user_id}
          member={member}
          onCancel={onOpenChange}
          onSave={onSave}
          saving={saving}
        />
      </DialogContent>
    </Dialog>
  );
}

function MemberDetailsForm({
  member,
  onCancel,
  onSave,
  saving,
}: {
  member: MemberRow;
  onCancel: () => void;
  onSave: (patch: { display_language: "ar" | "en"; mobile_number: string | null; note: string | null }) => void;
  saving: boolean;
}) {
  const [language, setLanguage] = useState<"ar" | "en">(member.display_language ?? "ar");
  const [mobile, setMobile] = useState(member.mobile_number ?? "");
  const [note, setNote] = useState(member.note ?? "");

  return (
    <>
      <DialogHeader>
        <DialogTitle>بيانات: {member.display_name}</DialogTitle>
        <DialogDescription>بيانات خاصة بعضوية هذا المستخدم في هذه المنشأة</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>لغة العرض</Label>
          <Select value={language} onValueChange={(value) => setLanguage(value as "ar" | "en")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ar">العربية</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>رقم الجوال</Label>
          <Input value={mobile} onChange={(e) => setMobile(e.target.value)} dir="ltr" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>ملاحظة</Label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          إلغاء
        </Button>
        <Button
          disabled={saving}
          onClick={() =>
            onSave({
              display_language: language,
              mobile_number: mobile.trim() || null,
              note: note.trim() || null,
            })
          }
        >
          {saving ? "جارٍ الحفظ..." : "حفظ"}
        </Button>
      </DialogFooter>
    </>
  );
}

export default function Users() {
  const { organization, membership, session } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const members = useMembers(organization?.id);
  const [permissionsTarget, setPermissionsTarget] = useState<MemberRow | null>(null);
  const [editTarget, setEditTarget] = useState<MemberRow | null>(null);

  const viewerIsAdmin = isOrganizationAdmin(membership?.role_key as OrganizationRole | undefined);

  const updateMember = useMutation({
    mutationFn: async ({
      userId,
      patch,
    }: {
      userId: string;
      patch: {
        role_key?: OrganizationRole;
        is_active?: boolean;
        display_language?: "ar" | "en";
        mobile_number?: string | null;
        note?: string | null;
      };
    }) => {
      if (!organization?.id) throw new Error("لا توجد مؤسسة نشطة");

      // الدور والتفعيل يمرّان بدوالّهما: تتحقّقان من الصلاحية وتكتبان في
      // سجل التدقيق، وحماية آخر مالك ومنع ترقية النفس مطبَّقتان في القاعدة.
      if (patch.role_key !== undefined) {
        const { error } = await supabase.rpc("app_set_membership_role", {
          p_org: organization.id, p_user_id: userId, p_role_key: patch.role_key,
          p_reason: null,
        });
        if (error) throw error;
      }
      if (patch.is_active !== undefined) {
        const { error } = await supabase.rpc("app_set_member_active", {
          p_org: organization.id, p_user_id: userId, p_active: patch.is_active,
          p_reason: patch.is_active ? null : "تعطيل من شاشة المستخدمين",
        });
        if (error) throw error;
      }

      const rest: Record<string, any> = { ...patch };
      delete rest.role_key;
      delete rest.is_active;
      if (Object.keys(rest).length === 0) return;

      const { data: affectedRows, error } = await supabase
        .from("organization_memberships")
        .update(rest)
        .eq("organization_id", organization.id)
        .eq("user_id", userId)
        .select();
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-members-admin"] });
      toast({ title: "تم تحديث بيانات المستخدم" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التحديث",
        description: errorMessage(error),
      }),
  });

  const owners = (members.data ?? []).filter((row) => row.role_key === "owner" && row.is_active);

  /**
   * حمايتان مقصودتان: لا يستطيع المستخدم تعطيل حسابه هو (فيفقد الوصول
   * فورًا)، ولا يمكن إزالة آخر مالك نشط (فتبقى المنشأة بلا من يديرها).
   *
   * وكلتاهما صارتا مطبَّقتين **في قاعدة البيانات** منذ المرحلة 28، فما هنا
   * رسالةٌ مبكّرة للمستخدم لا خطُّ الدفاع الوحيد كما كان.
   */
  const guard = (row: MemberRow, nextActive: boolean, nextRole: OrganizationRole) => {
    if (row.user_id === session?.user.id && (!nextActive || !isOrganizationAdmin(nextRole))) {
      return "لا يمكنك تعطيل حسابك أو إنقاص صفتك بنفسك — اطلب ذلك من مالك آخر.";
    }
    const isLastOwner = row.role_key === "owner" && owners.length <= 1;
    if (isLastOwner && (!nextActive || nextRole !== "owner")) {
      return "لا يمكن تعطيل آخر مالك للمنشأة أو تغيير صفته — عيّن مالكًا آخر أولًا.";
    }
    return null;
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">المستخدمون والصلاحيات</h1>
        <p className="text-sm text-muted-foreground">
          صفات المستخدمين، تفعيلهم، والاستثناءات على صلاحياتهم
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span>
          إضافة مستخدم جديد تتم بتسجيله لحسابه بنفسه عبر صفحة الدخول، ثم يظهر هنا لتُسنَد له الصفة
          المناسبة. لا يُنشأ الحساب من هذه الشاشة لأسباب أمنية.
        </span>
      </div>

      <DutyConflictsCard organizationId={organization?.id} />

      {!viewerIsAdmin && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>صلاحيتك الحالية تسمح بالعرض فقط — تعديل الصفات والصلاحيات متاح لمالك المنشأة ومدير النظام.</span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCog className="h-4 w-4" />
            أعضاء المنشأة
          </CardTitle>
          <CardDescription>الصفة تحدّد الصلاحيات الافتراضية، والاستثناءات تُضاف فوقها لكل مستخدم</CardDescription>
        </CardHeader>
        <CardContent>
          {members.isLoading && <Skeleton className="h-40 w-full" />}
          {!members.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المستخدم</TableHead>
                  <TableHead>الصفة</TableHead>
                  <TableHead>الجوال</TableHead>
                  <TableHead>لغة العرض</TableHead>
                  <TableHead>ملاحظة</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>تاريخ الانضمام</TableHead>
                  <TableHead className="w-52">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(members.data ?? []).map((row) => (
                  <TableRow key={row.user_id}>
                    <TableCell>
                      <p className="font-medium">{row.display_name}</p>
                      {row.user_id === session?.user.id && (
                        <span className="text-[10px] text-muted-foreground">(أنت)</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {viewerIsAdmin ? (
                        <Select
                          value={row.role_key}
                          onValueChange={(value) => {
                            const blocked = guard(row, row.is_active, value as OrganizationRole);
                            if (blocked) {
                              toast({ variant: "destructive", title: "غير مسموح", description: blocked });
                              return;
                            }
                            updateMember.mutate({
                              userId: row.user_id,
                              patch: { role_key: value as OrganizationRole },
                            });
                          }}
                        >
                          <SelectTrigger className="w-44">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(ROLE_LABELS).map(([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="secondary">{ROLE_LABELS[row.role_key]}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs" dir="ltr">
                      {row.mobile_number ?? "—"}
                    </TableCell>
                    <TableCell>
                      {viewerIsAdmin ? (
                        <Select
                          value={row.display_language}
                          onValueChange={(value) =>
                            updateMember.mutate({
                              userId: row.user_id,
                              patch: { display_language: value as "ar" | "en" },
                            })
                          }
                        >
                          <SelectTrigger className="w-28">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ar">العربية</SelectItem>
                            <SelectItem value="en">English</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-sm">{row.display_language === "en" ? "English" : "العربية"}</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[12rem] truncate text-xs text-muted-foreground">
                      {row.note ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.is_active ? "success" : "secondary"}>
                        {row.is_active ? "نشط" : "معطّل"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(row.created_at).toLocaleDateString("ar-SA")}
                    </TableCell>
                    <TableCell>
                      {viewerIsAdmin && (
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setPermissionsTarget(row)}>
                            الصلاحيات
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setEditTarget(row)}>
                            بيانات
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const blocked = guard(row, !row.is_active, row.role_key);
                              if (blocked) {
                                toast({ variant: "destructive", title: "غير مسموح", description: blocked });
                                return;
                              }
                              updateMember.mutate({
                                userId: row.user_id,
                                patch: { is_active: !row.is_active },
                              });
                            }}
                          >
                            {row.is_active ? "تعطيل" : "تفعيل"}
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(members.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                      لا يوجد أعضاء مسجَّلون.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <PermissionsDialog
        member={permissionsTarget}
        onOpenChange={() => setPermissionsTarget(null)}
        organizationId={organization?.id}
      />

      <MemberDetailsDialog
        member={editTarget}
        onOpenChange={() => setEditTarget(null)}
        onSave={(patch) => {
          if (!editTarget) return;
          updateMember.mutate({ userId: editTarget.user_id, patch });
          setEditTarget(null);
        }}
        saving={updateMember.isPending}
      />
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════════════
 * تعارض المهام — المرحلة 28
 *
 * النظام يمنع التنفيذ المزدوج وقت العمل (من احتسب المسيّر لا يعتمده)، لكن
 * وجود التعارض نفسه ملاحظةٌ إدارية تُرفع قبل أن يُستعمل.
 * ════════════════════════════════════════════════════════════════════════ */
function DutyConflictsCard({ organizationId }: { organizationId: string | undefined }) {
  const conflicts = useQuery({
    queryKey: ["duty-conflicts", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_duty_conflicts").select("*")
        .eq("organization_id", organizationId);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const names = useQuery({
    queryKey: ["conflict-member-names", organizationId],
    enabled: Boolean(organizationId) && (conflicts.data ?? []).length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_members_overview").select("user_id, email, doctor_name")
        .eq("organization_id", organizationId);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  if (!conflicts.data || conflicts.data.length === 0) return null;

  const nameOf = (userId: string) => {
    const row = (names.data ?? []).find((n) => n.user_id === userId);
    return row?.doctor_name || row?.email || "مستخدم";
  };

  return (
    <Card className="border-amber-300">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">تعارض في المهام</CardTitle>
        <CardDescription>
          أعضاء يملكون طرفَي عملية واحدة. النظام يمنع التنفيذ المزدوج وقت
          العمل، لكن الأصل أن يُوزَّع الطرفان على شخصين.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {(conflicts.data ?? []).map((c) => (
          <div key={`${c.user_id}-${c.conflict_key}`}
               className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="destructive">{c.conflict_name}</Badge>
            <span>{nameOf(c.user_id)}</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {c.perm_a} + {c.perm_b}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
