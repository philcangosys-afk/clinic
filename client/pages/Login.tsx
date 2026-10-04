import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BarChart3,
  ChevronDown,
  CalendarCheck2,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Mail,
  ReceiptText,
  ShieldCheck,
  Stethoscope,
  UserRound,
  UsersRound,
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
 * شاشة الدخول — باختيار الاسم ثم كلمة المرور (0218)، أو بالبريد.
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

type DirectoryUser = {
  user_id: string;
  display_name: string;
  role_label: string;
  group_key: "doctor" | "staff";
  email: string;
};

/**
 * أسماء من يدخلون النظام (0218): الحاسوب الواحد يعمل عليه أكثر من طبيب،
 * فيختار الداخل اسمه ثم يكتب كلمة مروره — بدل أن يكتب بريده كلّ مرّة أو
 * يجد بريد زميله محفوظًا. إن تعذّرت القائمة (ترقيةٌ لم تُنفَّذ، أو انقطاع)
 * بقي الدخول بالبريد كما كان.
 */
function useLoginDirectory() {
  return useQuery({
    queryKey: ["login-directory"],
    staleTime: 5 * 60 * 1000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("app_login_directory");
      if (error) throw error;
      return (data ?? []) as DirectoryUser[];
    },
  });
}

export default function Login() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { session, loading, refresh } = useOrganizationAccess();
  const directory = useLoginDirectory();
  const [mode, setMode] = useState<"names" | "email">("names");
  const [picked, setPicked] = useState<DirectoryUser | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [logoBroken, setLogoBroken] = useState(false);
  // حقل كلمة المرور للقراءة فقط حتى يُلمس: المتصفّح لا يملؤه بكلمةٍ محفوظة
  // لزميلٍ دخل من الحاسوب نفسه.
  const [passwordArmed, setPasswordArmed] = useState(false);

  // جلسةٌ قائمة ⇒ لا معنى لشاشة الدخول
  useEffect(() => {
    if (!loading && session) navigate("/", { replace: true });
  }, [loading, session, navigate]);

  const users = directory.data ?? [];
  const namesAvailable = users.length > 0;
  const effectiveMode = namesAvailable ? mode : "email";
  const loginEmail = effectiveMode === "names" ? picked?.email ?? "" : email.trim();

  const doctors = useMemo(() => users.filter((u) => u.group_key === "doctor"), [users]);
  const staff = useMemo(() => users.filter((u) => u.group_key !== "doctor"), [users]);

  const pick = (user: DirectoryUser | null) => {
    setPicked(user);
    setListOpen(false);
    setPassword("");
    setShowPassword(false);
    setPasswordArmed(false);
  };

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    if (!loginEmail || !password) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: loginEmail.toLowerCase(),
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
            ? effectiveMode === "names"
              ? "كلمة المرور غير صحيحة"
              : "البريد الإلكتروني أو كلمة المرور غير صحيحة"
            : /email not confirmed/i.test(raw)
              ? "الحساب غير مفعَّل — راجع مسؤول النظام"
              : raw || "تعذّر تسجيل الدخول",
        );
      }
      setPassword("");
      await refresh();
      navigate("/", { replace: true });
    } catch (error: unknown) {
      toast({ variant: "destructive", title: "تعذّر الدخول", description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    if (!loginEmail) {
      toast({
        variant: "destructive",
        title: effectiveMode === "names" ? "اختر اسمك أولًا" : "اكتب بريدك أولًا",
        description: "نرسل الرابط إلى البريد المسجَّل",
      });
      return;
    }
    setResetting(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(loginEmail.toLowerCase(), {
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

  const passwordBlock = (
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
          name="zc-login-secret"
          type={showPassword ? "text" : "password"}
          dir="ltr"
          autoComplete="off"
          data-lpignore="true"
          data-1p-ignore="true"
          readOnly={!passwordArmed}
          onFocus={() => setPasswordArmed(true)}
          className="pl-9 pr-9"
          placeholder="••••••••"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoFocus={effectiveMode === "names"}
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
  );

  const userRow = (user: DirectoryUser) => (
    <button
      key={user.user_id}
      type="button"
      onClick={() => pick(user)}
      className="flex w-full items-center gap-3 border-b px-3 py-2.5 text-start transition-colors last:border-b-0 hover:bg-primary/5"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
        {user.display_name.replace(/^د\.\s*/, "").trim().charAt(0) || "؟"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{user.display_name}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{user.role_label}</span>
      </span>
    </button>
  );

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
            <p className="mt-1 text-sm text-muted-foreground">
              {effectiveMode === "names"
                ? picked
                  ? "اكتب كلمة مرورك للمتابعة"
                  : "اختر اسمك ثم اكتب كلمة مرورك"
                : "ادخل ببريدك وكلمة مرورك للمتابعة"}
            </p>

            {effectiveMode === "names" && !picked && (
              <div className="mt-5 flex flex-col gap-2">
                {/* حقلٌ يُضغط فتنفتح الأسماء تحت بعضها — لا كتابة ولا بحث (0220) */}
                <button
                  type="button"
                  onClick={() => setListOpen((v) => !v)}
                  aria-expanded={listOpen}
                  className="flex h-11 w-full items-center gap-2 rounded-md border bg-background px-3 text-start text-sm transition-colors hover:border-primary"
                >
                  <UserRound className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 text-muted-foreground">اختر اسمك</span>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${listOpen ? "rotate-180" : ""}`} />
                </button>
                {listOpen && (
                  <div className="flex max-h-[50vh] flex-col overflow-y-auto rounded-md border bg-background shadow-sm">
                    {doctors.length > 0 && (
                      <>
                        <p className="sticky top-0 flex items-center gap-1.5 border-b bg-muted/80 px-3 py-1.5 text-xs font-semibold text-muted-foreground backdrop-blur">
                          <Stethoscope className="h-3.5 w-3.5" /> الأطباء
                        </p>
                        {doctors.map(userRow)}
                      </>
                    )}
                    {staff.length > 0 && (
                      <>
                        <p className="sticky top-0 flex items-center gap-1.5 border-b bg-muted/80 px-3 py-1.5 text-xs font-semibold text-muted-foreground backdrop-blur">
                          <ShieldCheck className="h-3.5 w-3.5" /> الإدارة والموظفون
                        </p>
                        {staff.map(userRow)}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {effectiveMode === "names" && picked && (
              <form className="mt-5 flex flex-col gap-4" onSubmit={signIn} autoComplete="off">
                <div className="flex items-center gap-3 rounded-xl border bg-muted/30 px-3 py-2.5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground">
                    {picked.display_name.replace(/^د\.\s*/, "").trim().charAt(0) || "؟"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{picked.display_name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{picked.role_label}</span>
                  </span>
                  <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={() => pick(null)}>
                    <ArrowRight className="h-4 w-4" />
                    تغيير
                  </Button>
                </div>
                {passwordBlock}
                <Button type="submit" className="mt-1 h-11 text-base" disabled={busy || !password}>
                  {busy ? "جارٍ الدخول..." : "تسجيل الدخول"}
                </Button>
              </form>
            )}

            {effectiveMode === "email" && (
              <form className="mt-6 flex flex-col gap-4" onSubmit={signIn} autoComplete="off">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="login-email">البريد الإلكتروني</Label>
                  <div className="relative">
                    <Mail className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="login-email"
                      type="email"
                      dir="ltr"
                      autoComplete="off"
                      inputMode="email"
                      className="pr-9"
                      placeholder="name@example.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoFocus
                    />
                  </div>
                </div>
                {passwordBlock}
                <Button type="submit" className="mt-2 h-11 text-base" disabled={busy || !email.trim() || !password}>
                  {busy ? "جارٍ الدخول..." : "تسجيل الدخول"}
                </Button>
              </form>
            )}

            <div className="mt-4 text-center">
              {namesAvailable && (
                <button
                  type="button"
                  className="text-xs font-medium text-primary hover:underline"
                  onClick={() => {
                    setMode(effectiveMode === "names" ? "email" : "names");
                    pick(null);
                  }}
                >
                  {effectiveMode === "names" ? "الدخول بالبريد الإلكتروني" : "الدخول باختيار الاسم"}
                </button>
              )}
              {directory.isLoading && <p className="text-xs text-muted-foreground">جارٍ تحميل الأسماء...</p>}
            </div>

            <div className="mt-4 border-t pt-4">
              <p className="text-center text-[11px] text-muted-foreground">
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
