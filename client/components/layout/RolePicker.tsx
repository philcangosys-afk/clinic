import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Banknote,
  ClipboardList,
  Microscope,
  ShieldCheck,
  Smile,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { DEMO_ROLES, type DemoRoleKey, type DemoRoleState } from "@/lib/demo-role";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const ICONS: Record<DemoRoleKey, LucideIcon> = {
  organization_admin: ShieldCheck,
  receptionist: ClipboardList,
  doctor: Stethoscope,
  radiology_technician: Activity,
  lab_technician: Microscope,
  dental_lab_technician: Smile,
  accountant: Banknote,
};

/**
 * شاشة اختيار الصفة — الواجهة الأولى في وضع المعاينة.
 *
 * لا كلمة مرور هنا لأنها ليست تسجيل دخول: الجلسة قائمة سلفًا بحسابك، وهذا
 * اختيارٌ لِما تريد أن تراه. لذلك تحمل الشاشة تنبيهًا صريحًا بذلك — إخفاؤه
 * يجعل من يجرّب يظن أنه اختبر الصلاحيات وهو لم يفعل.
 */
export default function RolePicker({
  onPick,
}: {
  onPick: (state: DemoRoleState) => void;
}) {
  const { organization } = useOrganizationAccess();
  const [role, setRole] = useState<DemoRoleKey | null>(null);
  const [name, setName] = useState("");
  const [doctorId, setDoctorId] = useState<string>("");

  const doctors = useQuery({
    queryKey: ["role-picker-doctors", organization?.id],
    enabled: Boolean(organization?.id) && role === "doctor",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("doctors")
        .select("id, name_ar")
        .eq("organization_id", organization!.id)
        .eq("is_enabled", true)
        .order("name_ar");
      if (error) throw error;
      return (data ?? []) as { id: string; name_ar: string }[];
    },
  });

  const doctorList = doctors.data ?? [];

  const canEnter = useMemo(() => {
    if (!role) return false;
    if (role === "doctor") return Boolean(doctorId);
    return true;
  }, [role, doctorId]);

  const enter = () => {
    if (!role || !canEnter) return;
    const picked = doctorList.find((d) => d.id === doctorId);
    onPick({
      role,
      name:
        name.trim() ||
        (role === "doctor" ? picked?.name_ar ?? "طبيب" : DEMO_ROLES.find((r) => r.key === role)!.label),
      doctorId: role === "doctor" ? doctorId : null,
    });
  };

  return (
    <div dir="rtl" className="grid min-h-screen place-items-center bg-muted/30 p-4 text-start">
      <div className="w-full max-w-3xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-primary text-2xl font-extrabold text-primary-foreground">
            ز
          </div>
          <h1 className="text-2xl font-bold">{organization?.name ?? "المركز الطبي"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">اختر الصفة التي تريد الدخول بها</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DEMO_ROLES.map((r) => {
            const Icon = ICONS[r.key];
            const active = role === r.key;
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => {
                  setRole(r.key);
                  if (r.key !== "doctor") setDoctorId("");
                }}
                className={cn(
                  "flex flex-col gap-2 rounded-xl border-2 bg-card p-4 text-start transition-all",
                  active
                    ? "border-primary shadow-md"
                    : "border-border hover:border-primary/50 hover:bg-accent/5",
                )}
              >
                <span
                  className={cn(
                    "grid h-10 w-10 place-items-center rounded-lg",
                    active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                  )}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <span className="text-base font-bold">{r.label}</span>
                <span className="text-xs leading-relaxed text-muted-foreground">{r.description}</span>
              </button>
            );
          })}
        </div>

        {role === "doctor" && (
          <Card className="mt-4">
            <CardContent className="flex flex-col gap-2 pt-5">
              <Label htmlFor="rp-doctor">أيّ طبيب؟</Label>
              {doctors.isLoading && <span className="text-sm text-muted-foreground">جارٍ تحميل الأطباء…</span>}
              {!doctors.isLoading && doctorList.length === 0 && (
                <span className="text-sm text-destructive">
                  لا يوجد طبيب مفعَّل في هذه المنشأة — أضف طبيبًا من شاشة «الأطباء» أولًا.
                </span>
              )}
              {doctorList.length > 0 && (
                <select
                  id="rp-doctor"
                  dir="rtl"
                  value={doctorId}
                  onChange={(e) => setDoctorId(e.target.value)}
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                >
                  <option value="">— اختر الطبيب —</option>
                  {doctorList.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name_ar}
                    </option>
                  ))}
                </select>
              )}
              <p className="text-xs text-muted-foreground">
                اللوحة تعرض مرضى هذا الطبيب وطلباته وما وصله من نتائج.
              </p>
            </CardContent>
          </Card>
        )}

        <Card className="mt-4">
          <CardContent className="flex flex-col gap-2 pt-5">
            <Label htmlFor="rp-name">الاسم الذي يظهر في الشريط العلوي (اختياري)</Label>
            <Input
              id="rp-name"
              dir="rtl"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: نوف"
            />
          </CardContent>
        </Card>

        <Button className="mt-4 h-12 w-full text-base" disabled={!canEnter} onClick={enter}>
          دخول
        </Button>

        <p className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-center text-xs leading-relaxed text-amber-900 dark:text-amber-200">
          هذه <strong>معاينة</strong>: تبدّل الشاشات لتُريك ما يراه كل موظّف. الصلاحيات
          الفعلية في قاعدة البيانات تبقى صلاحيات حسابك أنت، لأن الجلسة جلستك.
          لاختبار الصلاحيات حقًّا يلزم حساب مستقلّ لكل موظّف — وهذه الشاشات نفسها
          تعمل عندها بلا تغيير.
        </p>
      </div>
    </div>
  );
}
