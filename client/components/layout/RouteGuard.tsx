import { useEffect, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Activity } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";

/**
 * بوّابة شجرة المسارات الداخلية — ما بعد الدخول.
 *
 * **ما تغيّر ولماذا.** كانت هذه البوّابة تفتح النظام لمن لا حساب له: تعرض
 * «اختيار الصفة»، فيكتب زائرٌ اسمًا ويختار «الإدارة» ويدخل على كل الشاشات.
 * كان ذلك مقبولًا وهو نظام عرضٍ بلا بيانات؛ وفيه اليوم مرضى وفواتير وأرقام
 * ضريبية — فلا شاشة قبل حساب. من لا جلسة له يُحوَّل إلى `/login`.
 *
 * والدور لم يعد يُختار: يأتي من عضوية الحساب في المنشأة. فمن دخل بحسابه رأى
 * ما يملكه فعلًا لا ما اختاره لنفسه. (تصفية القائمة الجانبية بحسب الدور بقيت
 * كما هي — `DemoRoleContext` يستنبط الدور من العضوية نفسها.)
 *
 * والوجهة المقصودة تُمرَّر في حالة التنقّل، فمن فتح رابطًا داخليًّا ولم يكن
 * داخلًا عاد إليه بعد الدخول لا إلى الرئيسية.
 */
export default function RouteGuard({ children }: { children: ReactNode }) {
  const access = useOrganizationAccess();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (access.loading) return;
    if (!access.session) {
      navigate("/login", {
        replace: true,
        state: { from: `${location.pathname}${location.search}` },
      });
      return;
    }
    if (access.needsOnboarding) navigate("/onboarding", { replace: true });
  }, [
    access.loading,
    access.session,
    access.needsOnboarding,
    navigate,
    location.pathname,
    location.search,
  ]);

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

  // لا شيء يُرسم أثناء الإحالة: إطارٌ من الشاشة الداخلية لمن لا جلسة له تسريبٌ
  // للبيانات وإن كان لمحةً.
  if (!access.session || access.needsOnboarding) return null;

  return <>{children}</>;
}
