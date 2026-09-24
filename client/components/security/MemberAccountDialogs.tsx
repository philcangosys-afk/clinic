import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { createMemberAccount, setMemberEmail, setMemberPassword } from "@/lib/member-accounts";
import { BASE_ROLE_KEYS, ROLE_LABELS } from "@/lib/role-permissions";
import { useOrganizationRoles } from "@/components/security/RolesPanel";

/**
 * حسابات الدخول من داخل النظام (0185 + الدالّة الطرفية `admin-users`).
 *
 * **المستخدم الخاصّ:** محاسبٌ خارجيّ أو مراجعٌ يدخل النظام ولا ملفّ له في
 * الموظفين — لا يظهر في كشف الرواتب ولا في قائمة الموظفين، ويعمل بدورٍ
 * يُختار له كأيّ عضو.
 *
 * كلمة المرور تُكتب هنا وتذهب إلى الدالّة الطرفية مباشرةً: لا تُحفظ في
 * القاعدة ولا في حالة التطبيق، ولا تُعاد إلى الشاشة بعد الحفظ.
 */

const PASSWORD_HINT = "8 خانات فأكثر، وليست أرقامًا وحدها";

export function SpecialUserDialog({
  organizationId,
  onOpenChange,
}: {
  organizationId: string | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const roles = useOrganizationRoles(organizationId);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // القيمة إمّا `custom:<id>` لدورٍ مخصّص أو `base:<key>` لدورٍ جاهز
  const [roleValue, setRoleValue] = useState("base:employee");

  const create = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      const [kind, value] = roleValue.split(":");
      await createMemberAccount({
        organizationId,
        email: email.trim(),
        password,
        displayName: name.trim(),
        memberKind: "special",
        roleKey: kind === "base" ? value : "employee",
        customRoleId: kind === "custom" ? value : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-members-admin"] });
      queryClient.invalidateQueries({ queryKey: ["member-accounts"] });
      toast({ title: "أُنشئ الحساب", description: "سلّم المستخدم بريده وكلمة مروره" });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر إنشاء الحساب", description: errorMessage(error) }),
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>إضافة مستخدم خاص</DialogTitle>
          <DialogDescription>
            مستخدم يدخل النظام بدورٍ تختاره، ولا يُسجَّل في الموظفين ولا في الرواتب
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>الاسم *</Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>البريد الإلكتروني *</Label>
            <Input value={email} onChange={(event) => setEmail(event.target.value)} dir="ltr" inputMode="email" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>كلمة المرور *</Label>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              dir="ltr"
              autoComplete="new-password"
            />
            <p className="text-[11px] text-muted-foreground">{PASSWORD_HINT}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الدور والصلاحيات *</Label>
            <Select value={roleValue} onValueChange={setRoleValue}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(roles.data ?? [])
                  .filter((role) => role.is_active)
                  .map((role) => (
                    <SelectItem key={role.id} value={`custom:${role.id}`}>
                      {role.name_ar}
                    </SelectItem>
                  ))}
                {BASE_ROLE_KEYS.map((key) => (
                  <SelectItem key={key} value={`base:${key}`}>
                    {ROLE_LABELS[key] ?? key} (جاهز)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              الأدوار المخصّصة تُضبط من تبويب «الأدوار والصلاحيات»
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button
            disabled={create.isPending || !name.trim() || !email.trim() || password.length < 8}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "جارٍ الإنشاء..." : "إنشاء المستخدم"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * حساب دخول الموظّف — من شاشة الموظفين مباشرةً.
 *
 * موظّفٌ بلا حساب: يُنشأ له حسابٌ ويُربط بملفّه (`employees.user_id`)، فيعرف
 * النظام أنّ هذا الداخل هو ذاك الموظّف. وموظّفٌ له حساب: تُغيَّر كلمة مروره
 * أو بريده من النافذة نفسها.
 */
export function EmployeeAccountDialog({
  organizationId,
  employee,
  onOpenChange,
}: {
  organizationId: string | undefined;
  employee: { id: string; name_ar: string; user_id: string | null; email: string | null } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const roles = useOrganizationRoles(organizationId);
  const [email, setEmail] = useState(employee?.email ?? "");
  const [password, setPassword] = useState("");
  const [roleValue, setRoleValue] = useState("base:employee");

  const create = useMutation({
    mutationFn: async () => {
      if (!organizationId || !employee) throw new Error("بيانات غير مكتملة");
      const [kind, value] = roleValue.split(":");
      await createMemberAccount({
        organizationId,
        email: email.trim(),
        password,
        displayName: employee.name_ar,
        employeeId: employee.id,
        memberKind: "employee",
        roleKey: kind === "base" ? value : "employee",
        customRoleId: kind === "custom" ? value : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees-list"] });
      queryClient.invalidateQueries({ queryKey: ["org-members-admin"] });
      queryClient.invalidateQueries({ queryKey: ["member-accounts"] });
      toast({ title: "أُنشئ حساب الموظّف", description: "سلّمه بريده وكلمة مروره" });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر إنشاء الحساب", description: errorMessage(error) }),
  });

  if (!employee) return null;

  if (employee.user_id) {
    return (
      <MemberAccountDialog
        organizationId={organizationId}
        member={{ user_id: employee.user_id, display_name: employee.name_ar }}
        currentEmail={employee.email}
        onOpenChange={onOpenChange}
      />
    );
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>حساب دخول — {employee.name_ar}</DialogTitle>
          <DialogDescription>
            لا حساب لهذا الموظّف بعد. أنشئ له حسابًا يدخل به، واختر دوره وصلاحياته.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>البريد الإلكتروني *</Label>
            <Input value={email} onChange={(event) => setEmail(event.target.value)} dir="ltr" inputMode="email" autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>كلمة المرور *</Label>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              dir="ltr"
              autoComplete="new-password"
            />
            <p className="text-[11px] text-muted-foreground">{PASSWORD_HINT}</p>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>الدور والصلاحيات *</Label>
            <Select value={roleValue} onValueChange={setRoleValue}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(roles.data ?? [])
                  .filter((role) => role.is_active)
                  .map((role) => (
                    <SelectItem key={role.id} value={`custom:${role.id}`}>
                      {role.name_ar}
                    </SelectItem>
                  ))}
                {BASE_ROLE_KEYS.map((key) => (
                  <SelectItem key={key} value={`base:${key}`}>
                    {ROLE_LABELS[key] ?? key} (جاهز)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button
            disabled={create.isPending || !email.trim() || password.length < 8}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "جارٍ الإنشاء..." : "إنشاء الحساب"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MemberAccountDialog({
  organizationId,
  member,
  currentEmail,
  onOpenChange,
}: {
  organizationId: string | undefined;
  member: { user_id: string; display_name: string } | null;
  currentEmail: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState(currentEmail ?? "");

  const changePassword = useMutation({
    mutationFn: async () => {
      if (!organizationId || !member) throw new Error("بيانات غير مكتملة");
      await setMemberPassword(organizationId, member.user_id, password);
    },
    onSuccess: () => {
      setPassword("");
      toast({ title: "غُيّرت كلمة المرور", description: "سلّمها للمستخدم — لا تُعرض بعد الآن" });
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر التغيير", description: errorMessage(error) }),
  });

  const changeEmail = useMutation({
    mutationFn: async () => {
      if (!organizationId || !member) throw new Error("بيانات غير مكتملة");
      await setMemberEmail(organizationId, member.user_id, email.trim());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["member-accounts"] });
      toast({ title: "غُيّر البريد الإلكتروني" });
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر التغيير", description: errorMessage(error) }),
  });

  if (!member) return null;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>حساب الدخول — {member.display_name}</DialogTitle>
          <DialogDescription>
            البريد وكلمة المرور اللذان يدخل بهما هذا المستخدم. حساب المالك لا يعدّله إلّا مالك.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>البريد الإلكتروني</Label>
            <div className="flex gap-2">
              <Input value={email} onChange={(event) => setEmail(event.target.value)} dir="ltr" inputMode="email" />
              <Button
                variant="outline"
                disabled={changeEmail.isPending || !email.trim() || email.trim() === currentEmail}
                onClick={() => changeEmail.mutate()}
              >
                حفظ
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>كلمة مرور جديدة</Label>
            <div className="flex gap-2">
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                dir="ltr"
                autoComplete="new-password"
              />
              <Button disabled={changePassword.isPending || password.length < 8} onClick={() => changePassword.mutate()}>
                تغيير
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">{PASSWORD_HINT}</p>
          </div>
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
