import { useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Activity } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { useDemoRole } from "@/contexts/DemoRoleContext";
import RolePicker from "./RolePicker";

const DEMO_HOME: Record<string, string> = {
  organization_admin: "/",
  receptionist: "/reception",
  doctor: "/doctor-workspace",
  radiology_technician: "/radiology-console",
  lab_technician: "/laboratory",
  accountant: "/billing",
};

/**
 * يغلّف شجرة مسارات التطبيق الرئيسية (ما بعد تسجيل الدخول). يحوّل المستخدم
 * تلقائيًا إلى /onboarding إذا كان لديه جلسة دخول لكنه بلا عضوية في أي منشأة
 * (needsOnboarding) — نفس السلوك الذي كان "يُفترض" أن يحدث في الواجهة القديمة
 * ولم يكن مفعّلًا تلقائيًا، وكان يعتمد على أن يضغط المستخدم بنفسه على رابط
 * "إعداد منشأة جديدة" من قائمة الحساب.
 */
export default function RouteGuard({ children }: { children: ReactNode }) {
  const access = useOrganizationAccess();
  const demo = useDemoRole();
  const navigate = useNavigate();

  useEffect(() => {
    if (!access.loading && access.needsOnboarding) {
      navigate("/onboarding", { replace: true });
    }
  }, [access.loading, access.needsOnboarding, navigate]);

  if (access.loading) {
    return (
      <div dir="rtl" className="flex h-screen w-full items-center justify-center bg-muted/30">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Activity className="h-8 w-8 animate-pulse text-primary" />
          <span className="text-sm font-medium">جارٍ تحميل بيانات المنشأة...</span>
        </div>
      </div>
    );
  }

  if (access.needsOnboarding) return null;

  // لا صفة مختارة بعد ⇒ شاشة اختيار الصفة قبل أي شاشة أخرى. تُعرض فقط بعد
  // قراءة الاختيار المحفوظ، وإلا ومضت لحظةً لمن اختار سلفًا.
  if (demo.ready && !demo.role) {
    return (
      <RolePicker
        onPick={(state) => {
          demo.set(state);
          const home = DEMO_HOME[state.role];
          if (home) navigate(home, { replace: true });
        }}
      />
    );
  }

  return <>{children}</>;
}
