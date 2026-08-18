import { useEffect, useState, type FormEvent } from "react";
import { Activity, ArrowLeft, Building2, CheckCircle2, LogIn, UserPlus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { HealthcareOrganizationType } from "@shared/api";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export const organizationTypes: { value: HealthcareOrganizationType; label: string; detail: string }[] = [
  { value: "clinic", label: "عيادة", detail: "الوحدات التشغيلية الأساسية للاستقبال والمواعيد والمرضى والسجل الطبي والفوترة والموارد البشرية" },
  { value: "medical_center", label: "مركز طبي متكامل", detail: "الوحدات الأساسية مع الأقسام والمختبر والأشعة والصيدلية والتأمين والمخزون والمشتريات والتمريض والتقارير المتقدمة" },
];

export default function Onboarding() {
  const navigate = useNavigate();
  const access = useOrganizationAccess();
  const [authMode, setAuthMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [organizationType, setOrganizationType] = useState<HealthcareOrganizationType>("clinic");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!access.loading && access.session && access.membership) navigate("/", { replace: true });
  }, [access.loading, access.membership, access.session, navigate]);

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const result = authMode === "signIn"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    if (!result.data.session) {
      setMessage("تم إنشاء الحساب. تحقق من بريدك الإلكتروني لتأكيد الحساب ثم سجّل الدخول.");
      setAuthMode("signIn");
      return;
    }
    await access.refresh();
  };

  const createOrganization = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!access.session) return;
    setBusy(true);
    setError("");
    const { error: insertError } = await supabase.from("organizations").insert({
      name: name.trim(),
      organization_type: organizationType,
      created_by: access.session.user.id,
    });
    if (insertError) {
      setError(insertError.message);
      setBusy(false);
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    await access.refresh();
    setBusy(false);
    navigate("/", { replace: true });
  };

  return <main dir="rtl" className="min-h-screen bg-[#f3f7fb] px-5 py-10 text-[#183f42] sm:px-8">
    <div className="mx-auto max-w-5xl">
      <button type="button" onClick={() => navigate("/")} className="mb-7 flex items-center gap-2 text-xs font-bold text-[#5f817e]"><ArrowLeft className="h-4 w-4" /> العودة إلى العرض التجريبي</button>
      <div className="grid overflow-hidden rounded-[28px] border border-[#dceae7] bg-white shadow-[0_24px_70px_rgba(25,72,70,0.1)] lg:grid-cols-[0.85fr_1.15fr]">
        <section className="bg-[#101b2e] p-8 text-white sm:p-12">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0d716a]"><Activity className="h-6 w-6" /></div>
          <div className="mt-8 text-xs font-bold text-[#87d4c7]">زين كير للمنشآت الصحية</div>
          <h1 className="mt-3 text-3xl font-bold leading-[1.45]">ابدأ مساحة عمل منظمتك خلال دقائق</h1>
          <p className="mt-4 text-sm leading-7 text-[#b8c7da]">حساب آمن، فروع وصلاحيات، ووحدات قابلة للتخصيص حسب احتياج منشأتك.</p>
          <div className="mt-8 space-y-4 text-xs text-[#d5dfeb]">{["إعداد الفرع الرئيسي تلقائيًا", "صلاحيات مالك المنظمة", "اختيار الوحدات بعد الإنشاء"].map((item) => <div key={item} className="flex items-center gap-3"><CheckCircle2 className="h-4 w-4 text-[#87d4c7]" />{item}</div>)}</div>
        </section>
        <section className="p-6 sm:p-10">
          {!access.session ? <>
            <div className="mb-7 flex rounded-xl bg-[#f1f7f5] p-1">{(["signIn", "signUp"] as const).map((mode) => <button key={mode} type="button" onClick={() => { setAuthMode(mode); setError(""); setMessage(""); }} className={cn("flex-1 rounded-lg px-3 py-2.5 text-xs font-bold", authMode === mode ? "bg-white text-[#0d716a] shadow-sm" : "text-[#78928f]")}>{mode === "signIn" ? "تسجيل الدخول" : "إنشاء حساب"}</button>)}</div>
            <div className="mb-6"><h2 className="text-2xl font-bold">{authMode === "signIn" ? "مرحبًا بعودتك" : "أنشئ حسابك الجديد"}</h2><p className="mt-2 text-xs text-[#819b98]">استخدم بريد العمل للمتابعة إلى إعداد المنظمة.</p></div>
            <form onSubmit={submitAuth} className="space-y-4">
              <AuthField label="البريد الإلكتروني"><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className={controlClass} dir="ltr" /></AuthField>
              <AuthField label="كلمة المرور"><input required minLength={6} type="password" value={password} onChange={(event) => setPassword(event.target.value)} className={controlClass} dir="ltr" /></AuthField>
              <Status error={error} message={message} />
              <button disabled={busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0d716a] text-xs font-bold text-white disabled:opacity-60">{authMode === "signIn" ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}{busy ? "جارٍ المتابعة..." : authMode === "signIn" ? "دخول ومتابعة" : "إنشاء الحساب"}</button>
            </form>
          </> : <>
            <div className="mb-7"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e4f5f1] text-[#0d857b]"><Building2 className="h-5 w-5" /></div><h2 className="mt-5 text-2xl font-bold">إعداد المنظمة</h2><p className="mt-2 text-xs text-[#819b98]">سننشئ الفرع الرئيسي والوحدات الافتراضية تلقائيًا.</p></div>
            <form onSubmit={createOrganization} className="space-y-5">
              <AuthField label="اسم المنشأة"><input required value={name} onChange={(event) => setName(event.target.value)} className={controlClass} placeholder="مثال: مجمع زين الطبي" /></AuthField>
              <div><div className="mb-2 text-[11px] font-bold text-[#698783]">نوع المنشأة</div><div className="grid gap-2 sm:grid-cols-2">{organizationTypes.map((type) => <button key={type.value} type="button" onClick={() => setOrganizationType(type.value)} className={cn("rounded-xl border p-3 text-right transition", organizationType === type.value ? "border-[#72bbb2] bg-[#eaf7f4]" : "border-[#e1ecea] hover:border-[#a9d6d0]")}><div className="text-xs font-bold text-[#315d5a]">{type.label}</div><div className="mt-1 text-[10px] text-[#8ba3a0]">{type.detail}</div></button>)}</div></div>
              <Status error={error} message={message} />
              <button disabled={busy} className="h-12 w-full rounded-xl bg-[#0d716a] text-xs font-bold text-white disabled:opacity-60">{busy ? "جارٍ إنشاء المنظمة..." : "إنشاء المنظمة وبدء العمل"}</button>
            </form>
          </>}
        </section>
      </div>
    </div>
  </main>;
}

const controlClass = "h-12 w-full rounded-xl border border-[#dce9e7] bg-[#fbfdfc] px-3 text-sm outline-none transition focus:border-[#72bbb2] focus:ring-4 focus:ring-[#eaf7f4]";

function AuthField({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-2 block text-[11px] font-bold text-[#698783]">{label}</span>{children}</label>;
}

function Status({ error, message }: { error: string; message: string }) {
  if (!error && !message) return null;
  return <div role="status" className={cn("rounded-xl px-3 py-3 text-[11px] leading-5", error ? "bg-[#fff0eb] text-[#bd654d]" : "bg-[#eaf7f4] text-[#0d716a]")}>{error || message}</div>;
}
