import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart3,
  CalendarCheck2,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Mail,
  ReceiptText,
  ShieldCheck,
  Stethoscope,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";

/**
 * شاشة الدخول — بالبريد وكلمة المرور.
 *
 * **ما كان قبلها:** من يفتح العنوان يدخل النظام بلا حساب، ويختار «صفة»
 * للمعاينة باسمٍ يكتبه بنفسه. كان ذلك مقبولًا وهو نظامُ تجربةٍ بلا بيانات
 * حقيقية؛ أمّا وفيه مرضى وفواتير وأرقام ضريبية فلا: **لا شاشة تُفتح قبل
 * حساب**. والحساب يُنشئه المسؤول من «الموظفون» أو «مستخدم خاص».
 *
 * والدور لا يُختار هنا: يأتي من عضوية الحساب في المنشأة وصلاحياتها في
 * القاعدة. فما يراه الداخل هو ما يملكه فعلًا، لا ما اختاره لنفسه.
 *
 * الشعار من `public/brand-logo.png` إن وُجد — قبل الدخول لا تُقرأ إعدادات
 * المنشأة (سياسات الحماية تمنع)، فيبقى ملفًّا ثابتًا في الموقع، وإن غاب ظهر
 * رمزٌ بديل ولا تنكسر الشاشة.
 */

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: CalendarCheck2, title: "المواعيد والاستقبال", text: "حجزٌ وطابورٌ ومتابعةُ حالة المريض لحظةً بلحظة" },
  { icon: UsersRound, title: "ملفّات المرضى", text: "الملفّ الطبيّ والعلامات الحيوية والوصفات والمرفقات" },
  { icon: ReceiptText, title: "الفوترة والضريبة", text: "فاتورة ضريبية معتمدة وربطٌ مع هيئة الزكاة والضريبة" },
  { icon: BarChart3, title: "التقارير والمحاسبة", text: "اليومية والصناديق والمشتريات وتقارير الإيراد" },
];

const ROLES: { icon: LucideIcon; label: string }[] = [
  { icon: ShieldCheck, label: "الإدارة" },
  { icon: CalendarCheck2, label: "الاستقبال" },
  { icon: Stethoscope, label: "الأطباء" },
  { icon: Wallet, label: "المحاسبة" },
];

export default function Login() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { session, loading, refresh } = useOrganizationAccess();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [logoBroken, setLogoBroken] = useState(false);

  // جلسةٌ قائمة ⇒ لا معنى لشاشة الدخول
  useEffect(() => {
    if (!loading && session) navigate("/", { replace: true });
  }, [loading, session, navigate]);

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (error) {
        /**
         * رسالة عربية واحدة للبريد الخاطئ وكلمة المرور الخاطئة معًا — التفريق
         * بينهما يكشف أيّ البُرُد مسجَّل في النظام لمن يجرّب.
         */
        const raw = String(error.message ?? "");
        throw new Error(
          /invalid login credentials/i.test(raw)
            ? "البريد الإلكتروني أو كلمة المرور غير صحيحة"
            : /email not confirmed/i.test(raw)
              ? "الحساب غير مفعَّل — راجع مسؤول النظام"
              : raw || "تعذّر تسجيل الدخول",
        );
      }
      await refresh();
      navigate("/", { replace: true });
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "تعذّر الدخول", description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    if (!email.trim()) {
      toast({ variant: "destructive", title: "اكتب بريدك أولًا", description: "نرسل الرابط إلى بريدك المسجَّل" });
      return;
    }
    setResetting(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: `${window.location.origin}/login`,
      });
      if (error) throw error;
      // لا نقول «البريد غير مسجَّل»: ذلك يكشف حسابات المنشأة لمن يجرّب
      toast({
        title: "أُرسل الرابط",
        description: "إن كان البريد مسجَّلًا فستصلك رسالة لتعيين كلمة مرور جديدة",
      });
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "تعذّر الإرسال", description: errorMessage(error) });
    } finally {
      setResetting(false);
    }
  };

  return (
    <main dir="rtl" className="grid min-h-screen grid-cols-1 bg-background lg:grid-cols-2">
      {/* ── نموذج الدخول (يمين الشاشة في العربية) ─────────────────────────── */}
      <section className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          <div className="mb-8 flex flex-col items-center gap-3 text-center lg:hidden">
            <BrandMark broken={logoBroken} onBroken={() => setLogoBroken(true)} compact />
            <h1 className="text-xl font-bold">مجمع أسناني المتميز الطبي</h1>
          </div>

          <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
            <h2 className="text-2xl font-bold">مرحبًا بعودتك</h2>
            <p className="mt-1 text-sm text-muted-foreground">ادخل ببريدك وكلمة مرورك للمتابعة</p>

            <form className="mt-6 flex flex-col gap-4" onSubmit={signIn}>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="login-email">البريد الإلكتروني</Label>
                <div className="relative">
                  <Mail className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="login-email"
                    type="email"
                    dir="ltr"
                    autoComplete="username"
                    inputMode="email"
                    className="pr-9"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoFocus
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="login-password">كلمة المرور</Label>
                  <button
                    type="button"
                    className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
                    disabled={resetting}
                    onClick={() => void resetPassword()}
                  >
                    {resetting ? "جارٍ الإرسال..." : "نسيت كلمة المرور؟"}
                  </button>
                </div>
                <div className="relative">
                  <LockKeyhole className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    dir="ltr"
                    autoComplete="current-password"
                    className="pl-9 pr-9"
                    placeholder="••••••••"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    className="absolute left-3 top-2.5 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button type="submit" className="mt-2 h-11 text-base" disabled={busy || !email.trim() || !password}>
                {busy ? "جارٍ الدخول..." : "تسجيل الدخول"}
              </Button>
            </form>

            <div className="mt-6 border-t pt-4">
              <p className="text-center text-[11px] font-medium text-muted-foreground">الأدوار في النظام</p>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {ROLES.map(({ icon: Icon, label }) => (
                  <div
                    key={label}
                    className="flex flex-col items-center gap-1 rounded-lg border bg-muted/30 px-1 py-2 text-[10px] text-muted-foreground"
                  >
                    <Icon className="h-4 w-4 text-primary" />
                    {label}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-center text-[11px] text-muted-foreground">
                لا حساب لك؟ الحسابات يُنشئها مسؤول النظام من شاشة الموظفين
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── لوحة الهوية ───────────────────────────────────────────────────── */}
      <section className="relative hidden overflow-hidden bg-primary p-10 text-primary-foreground lg:flex lg:flex-col lg:justify-center">
        <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-24 -right-16 h-80 w-80 rounded-full bg-white/5" />

        <div className="relative z-10 mx-auto w-full max-w-lg">
          <div className="flex items-center gap-4">
            <BrandMark broken={logoBroken} onBroken={() => setLogoBroken(true)} />
            <div>
              <h1 className="text-2xl font-bold leading-tight">مجمع أسناني المتميز الطبي</h1>
              <p className="text-sm text-primary-foreground/80">نظام إدارة المجمع الطبي</p>
            </div>
          </div>

          <h2 className="mt-10 text-3xl font-bold leading-snug">
            نظامٌ واحد يدير المجمع
            <span className="block text-primary-foreground/80">من الموعد إلى الفاتورة الضريبية</span>
          </h2>

          <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-xl bg-white/10 p-4 backdrop-blur-sm">
                <Icon className="mb-2 h-5 w-5" />
                <p className="text-sm font-semibold">{title}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-primary-foreground/75">{text}</p>
              </div>
            ))}
          </div>

          <p className="mt-8 flex items-center gap-2 text-[11px] text-primary-foreground/70">
            <KeyRound className="h-3.5 w-3.5" />
            كل دخولٍ يُسجَّل باسم صاحبه، وكل شاشةٍ تُفتح بصلاحيته وحدها
          </p>
        </div>
      </section>
    </main>
  );
}

/** شعار المنشأة من `public/brand-logo.png`، وإن غاب فرمزٌ بديل. */
function BrandMark({
  broken,
  onBroken,
  compact,
}: {
  broken: boolean;
  onBroken: () => void;
  compact?: boolean;
}) {
  const size = compact ? "h-16 w-16" : "h-20 w-20";
  if (broken) {
    return (
      <div className={`flex ${size} items-center justify-center rounded-2xl bg-white/15`}>
        <Stethoscope className="h-8 w-8" />
      </div>
    );
  }
  return (
    <img
      src="/brand-logo.png"
      alt="شعار المنشأة"
      className={`${size} rounded-2xl bg-white object-contain p-1.5`}
      onError={onBroken}
    />
  );
}
