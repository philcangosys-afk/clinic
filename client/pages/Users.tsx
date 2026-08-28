import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserCog, ShieldCheck, Info } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { moduleRegistry, settingsModule } from "@/lib/module-registry";
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

/** كل صلاحيات العرض المتاحة، مشتقّة من سجل الموديولات نفسه. */
function useAvailablePermissions() {
  return useMemo(() => {
    const seen = new Map<string, string>();
    [...moduleRegistry, settingsModule].forEach((item) => {
      if (!seen.has(item.requiredPermission)) seen.set(item.requiredPermission, item.label);
    });
    return [...seen].map(([key, label]) => ({ key, label }));
  }, []);
}

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
  const available = useAvailablePermissions();

  const isAdmin = member ? isOrganizationAdmin(member.role_key) : false;
  const overrides = new Map((permissions.data ?? []).map((row) => [row.permission_key, row.granted]));

  const setPermission = useMutation({
    mutationFn: async ({ key, granted }: { key: string; granted: boolean | null }) => {
      if (!organizationId || !member) throw new Error("بيانات غير مكتملة");
      if (granted === null) {
        // العودة لسلوك الصفة الافتراضي = حذف الاستثناء
        const { data: affectedRows, error } = await supabase
          .from("membership_permissions")
          .delete()
          .eq("organization_id", organizationId)
          .eq("user_id", member.user_id)
          .eq("permission_key", key)
          .select();
        if (error) throw error;
        // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
        // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
        if (!affectedRows || affectedRows.length === 0)
          throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
        return;
      }
      const { error } = await supabase.from("membership_permissions").upsert({
        organization_id: organizationId,
        user_id: member.user_id,
        permission_key: key,
        granted,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["membership-permissions"] });
      toast({ title: "تم تحديث الصلاحية" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التحديث",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={Boolean(member)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>صلاحيات: {member?.display_name}</DialogTitle>
          <DialogDescription>
            الصفة تمنح صلاحيات افتراضية — هنا تضيف استثناءات فوقها لهذا المستخدم وحده
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

        {permissions.isLoading && <Skeleton className="h-40 w-full" />}
        {!permissions.isLoading && (
          <div className="flex flex-col gap-1">
            {available.map((permission) => {
              const override = overrides.get(permission.key);
              const state = override === undefined ? "default" : override ? "granted" : "denied";
              return (
                <div
                  key={permission.key}
                  className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{permission.label}</p>
                    <p className="truncate font-mono text-[10px] text-muted-foreground">
                      {permission.key}
                    </p>
                  </div>
                  <Select
                    value={state}
                    onValueChange={(value) =>
                      setPermission.mutate({
                        key: permission.key,
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
      const { data: affectedRows, error } = await supabase
        .from("organization_memberships")
        .update(patch)
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
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  const owners = (members.data ?? []).filter((row) => row.role_key === "owner" && row.is_active);

  /**
   * حمايتان مقصودتان: لا يستطيع المستخدم تعطيل حسابه هو (فيفقد الوصول
   * فورًا)، ولا يمكن إزالة آخر مالك نشط (فتبقى المنشأة بلا من يديرها).
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
