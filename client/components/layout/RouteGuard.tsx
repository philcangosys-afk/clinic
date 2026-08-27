import { useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Activity } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";

/**
 * يغلّف شجرة مسارات التطبيق الرئيسية (ما بعد تسجيل الدخول). يحوّل المستخدم
 * تلقائيًا إلى /onboarding إذا كان لديه جلسة دخول لكنه بلا عضوية في أي منشأة
 * (needsOnboarding) — نفس السلوك الذي كان "يُفترض" أن يحدث في الواجهة القديمة
 * ولم يكن مفعّلًا تلقائيًا، وكان يعتمد على أن يضغط المستخدم بنفسه على رابط
 * "إعداد منشأة جديدة" من قائمة الحساب.
 */
export default function RouteGuard({ children }: { children: ReactNode }) {
  const access = useOrganizationAccess();
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

  return <>{children}</>;
}
