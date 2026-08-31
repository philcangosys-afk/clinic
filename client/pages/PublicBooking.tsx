import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import {
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  Clock3,
  HeartPulse,
  MapPin,
  Menu,
  Phone,
  Printer,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Users,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

const HERO_IMAGE = "https://images.pexels.com/photos/4971512/pexels-photo-4971512.jpeg";
const LOGO_IMAGE = "https://cdn.builder.io/api/v1/image/assets%2Fce04605038104603b965d31c7c18e8db%2F44225d3925cf48e8883d9f35b0a6e724?format=webp&width=800&height=1200";

type Clinic = { id: string; name: string };
type Doctor = { id: string; name: string; job_title: string | null; clinic_id: string };
type Service = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  duration_minutes: number;
  clinic_id: string;
};
type Catalog = {
  site_name: string;
  hero_title: string;
  hero_subtitle: string | null;
  phone: string | null;
  address: string | null;
  clinics: Clinic[];
  doctors: Doctor[];
  team: Doctor[];
  services: Service[];
};
type BookingResult = {
  booking_reference: string;
  invoice_number: number;
  invoice_date: string;
  scheduled_start: string;
  scheduled_end: string;
  patient_name: string;
  patient_mobile: string;
  patient_email: string | null;
  service_name: string;
  doctor_name: string;
  clinic_name: string;
  invoice_subtotal: number;
  vat_rate: number;
  vat_amount: number;
  invoice_total: number;
  legal_name: string;
  vat_registration_number: string | null;
  currency: string;
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("ar-SA", { style: "currency", currency: "SAR" }).format(value);
}

function tomorrowDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function PublicBooking() {
  const { slug = "asnan-premium" } = useParams();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState<BookingResult | null>(null);
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [gender, setGender] = useState("");
  const [clinicId, setClinicId] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState(tomorrowDate);
  const [time, setTime] = useState("10:00");
  const [note, setNote] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase.rpc("app_public_booking_catalog", { p_slug: slug }).then(({ data, error }) => {
      if (!active) return;
      if (error) setLoadError(error.message);
      else setCatalog(data as Catalog);
      setLoading(false);
    });
    return () => { active = false; };
  }, [slug]);

  useEffect(() => {
    if (!catalog || clinicId) return;
    const initialClinic = catalog.clinics[0];
    if (initialClinic) setClinicId(initialClinic.id);
  }, [catalog, clinicId]);

  const services = useMemo(
    () => (catalog?.services ?? []).filter((service) => service.clinic_id === clinicId),
    [catalog, clinicId],
  );
  const doctors = useMemo(
    () => (catalog?.doctors ?? []).filter((doctor) => doctor.clinic_id === clinicId),
    [catalog, clinicId],
  );

  useEffect(() => {
    if (!services.some((service) => service.id === serviceId)) setServiceId(services[0]?.id ?? "");
    if (!doctors.some((doctor) => doctor.id === doctorId)) setDoctorId(doctors[0]?.id ?? "");
  }, [doctorId, doctors, serviceId, services]);

  const selectedService = services.find((service) => service.id === serviceId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitError("");
    if (!clinicId || !doctorId || !serviceId) {
      setSubmitError("اختر العيادة والطبيب والخدمة");
      return;
    }
    setSubmitting(true);
    const scheduledStart = new Date(`${date}T${time}:00`).toISOString();
    const { data, error } = await supabase.rpc("app_public_create_booking", {
      p_slug: slug,
      p_name: name,
      p_mobile: mobile,
      p_email: email || null,
      p_gender: gender,
      p_clinic_id: clinicId,
      p_doctor_id: doctorId,
      p_item_id: serviceId,
      p_scheduled_start: scheduledStart,
      p_note: note || null,
      p_consent: consent,
      p_website: website || null,
    });
    setSubmitting(false);
    if (error) setSubmitError(error.message);
    else {
      setResult(data as BookingResult);
      requestAnimationFrame(() => document.getElementById("booking")?.scrollIntoView({ behavior: "smooth" }));
    }
  };

  if (loading) return <main dir="rtl" className="grid min-h-screen place-items-center bg-[#f4f8f7] text-[#0b1f1c]">جارٍ تجهيز موقع الحجز...</main>;
  if (loadError || !catalog) return <main dir="rtl" className="grid min-h-screen place-items-center bg-[#f4f8f7] p-6 text-center text-[#0b1f1c]"><div><h1 className="text-2xl font-bold">موقع الحجز غير متاح</h1><p className="mt-2 text-[#6e827d]">{loadError}</p></div></main>;

  return (
    <div dir="rtl" className="min-h-screen bg-[#f4f8f7] text-start text-[#0b1f1c]">
      <div className="bg-[#0b1f1c] text-xs text-white/75">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-5 py-2.5 lg:px-10">
          <span className="flex items-center gap-2"><Clock3 className="h-3.5 w-3.5 text-[#1fcfb8]" /> السبت – الخميس، 9 صباحًا – 10 مساءً</span>
          <span className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-[#1fcfb8]" /> {catalog.phone ?? "920000000"}</span>
        </div>
      </div>

      <header className="sticky top-0 z-40 border-b border-[#d9e4e1] bg-[#f4f8f7]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3.5 lg:px-10">
          <a href="#top" className="flex items-center gap-3">
            <span className="grid h-16 w-16 place-items-center overflow-hidden rounded-2xl bg-white p-1 shadow-lg shadow-emerald-700/15">
              <img src={LOGO_IMAGE} alt="شعار أسناني My Teeth" className="h-full w-full object-contain" />
            </span>
            <span><strong className="block text-base font-extrabold">{catalog.site_name}</strong><small className="text-[#6e827d]">رعاية أسنان متخصصة</small></span>
          </a>
          <nav className="hidden items-center gap-7 text-sm font-bold text-[#37514b] lg:flex">
            <a href="#top" className="hover:text-[#0baa8e]">الرئيسية</a>
            <a href="#services" className="hover:text-[#0baa8e]">خدماتنا</a>
            <a href="#doctors" className="hover:text-[#0baa8e]">أطباؤنا</a>
            <a href="#about" className="hover:text-[#0baa8e]">عن المركز</a>
          </nav>
          <a href="#booking" className="hidden rounded-full bg-gradient-to-l from-[#0baa8e] to-[#1fcfb8] px-5 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-700/20 sm:block">احجز موعدك</a>
          <button type="button" aria-label="القائمة" aria-expanded={mobileMenu} onClick={() => setMobileMenu((open) => !open)} className="grid h-10 w-10 place-items-center rounded-xl border border-[#bfd0cb] lg:hidden"><Menu className="h-5 w-5" /></button>
        </div>
        {mobileMenu && (
          <nav className="border-t border-[#d9e4e1] bg-white px-5 py-3 lg:hidden">
            <div className="mx-auto flex max-w-7xl flex-col text-sm font-bold text-[#37514b]">
              <a onClick={() => setMobileMenu(false)} href="#top" className="border-b border-[#eaf1ef] py-3">الرئيسية</a>
              <a onClick={() => setMobileMenu(false)} href="#services" className="border-b border-[#eaf1ef] py-3">خدماتنا</a>
              <a onClick={() => setMobileMenu(false)} href="#doctors" className="border-b border-[#eaf1ef] py-3">أطباؤنا</a>
              <a onClick={() => setMobileMenu(false)} href="#booking" className="py-3 text-[#067663]">احجز موعدك</a>
            </div>
          </nav>
        )}
      </header>

      <main id="top">
        <section className="relative isolate overflow-hidden bg-[#0b1f1c] text-white">
          <img src={HERO_IMAGE} alt="طبيبة أسنان تقدم الرعاية لمريضة في عيادة حديثة" className="absolute inset-0 -z-20 h-full w-full object-cover object-center" />
          <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(11,31,28,.72),rgba(11,31,28,.92)),radial-gradient(circle_at_20%_30%,rgba(11,170,142,.45),transparent_55%)]" />
          <div className="mx-auto grid min-h-[690px] max-w-7xl items-center gap-12 px-5 py-20 lg:grid-cols-[1.05fr_.95fr] lg:px-10">
            <div className="max-w-2xl">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-bold backdrop-blur"><Sparkles className="h-4 w-4 text-[#1fcfb8]" /> ابتسامة صحية، ثقة تدوم</span>
              <h1 className="mt-6 text-4xl font-extrabold leading-[1.15] sm:text-5xl lg:text-6xl">{catalog.hero_title}</h1>
              <p className="mt-5 max-w-xl text-lg leading-8 text-white/80">{catalog.hero_subtitle}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a href="#booking" className="rounded-xl bg-gradient-to-l from-[#0baa8e] to-[#1fcfb8] px-6 py-3.5 font-bold text-white shadow-xl">احجز موعدك الآن</a>
                <a href="#doctors" className="rounded-xl border border-white/30 bg-white/10 px-6 py-3.5 font-bold backdrop-blur">تعرّف على أطبائنا</a>
              </div>
              <div className="mt-10 grid max-w-xl grid-cols-3 gap-4 border-t border-white/15 pt-7 text-center sm:text-start">
                <div><strong className="block text-2xl text-[#1fcfb8]">+15</strong><span className="text-xs text-white/65">عامًا من الخبرة</span></div>
                <div><strong className="block text-2xl text-[#1fcfb8]">+20K</strong><span className="text-xs text-white/65">ابتسامة سعيدة</span></div>
                <div><strong className="block text-2xl text-[#1fcfb8]">98%</strong><span className="text-xs text-white/65">رضا المراجعين</span></div>
              </div>
            </div>

            <div id="booking" className="scroll-mt-28 rounded-[24px] border border-white/40 bg-white/95 p-5 text-[#0b1f1c] shadow-2xl backdrop-blur-xl sm:p-7">
              {result ? (
                <div className="py-2">
                  <div className="mb-5 text-center print:hidden">
                    <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#cfeee6] text-[#067663]"><CheckCircle2 className="h-8 w-8" /></span>
                    <h2 className="mt-3 text-2xl font-extrabold">تم تأكيد حجزك وإصدار فاتورتك</h2>
                    <p className="mt-1 text-sm text-[#6e827d]">وصل الموعد والفاتورة مباشرةً إلى نظام المركز.</p>
                  </div>

                  <article id="booking-invoice" className="overflow-hidden rounded-2xl border border-[#c8d8d4] bg-white text-[#172c27] shadow-sm">
                    <header className="flex flex-wrap items-start justify-between gap-5 border-b-4 border-[#0baa8e] bg-[#f7fbfa] p-5">
                      <div className="flex items-center gap-3">
                        <span className="grid h-20 w-20 place-items-center overflow-hidden rounded-xl border border-[#d9e4e1] bg-white p-1">
                          <img src={LOGO_IMAGE} alt="شعار أسناني My Teeth" className="h-full w-full object-contain" />
                        </span>
                        <div>
                          <h2 className="text-lg font-extrabold">{result.legal_name || catalog.site_name}</h2>
                          <p className="mt-1 text-xs text-[#60746f]">{catalog.address || "المملكة العربية السعودية"}</p>
                          <p className="mt-1 text-xs text-[#60746f]" dir="ltr">{catalog.phone}</p>
                          <p className="mt-1 text-xs text-[#60746f]">الرقم الضريبي: <span dir="ltr">{result.vat_registration_number || "غير مسجل"}</span></p>
                        </div>
                      </div>
                      <div className="rounded-xl bg-[#0b1f1c] px-4 py-3 text-white">
                        <div className="flex items-center gap-2"><ReceiptText className="h-5 w-5 text-[#1fcfb8]" /><strong>فاتورة ضريبية مبسطة</strong></div>
                        <p className="mt-2 text-xs text-white/70">رقم الفاتورة</p>
                        <p className="font-mono text-lg font-extrabold" dir="ltr">#{result.invoice_number}</p>
                        <p className="mt-1 text-xs text-white/70">{new Date(result.invoice_date).toLocaleString("ar-SA")}</p>
                      </div>
                    </header>

                    <div className="grid gap-4 border-b border-[#d9e4e1] p-5 sm:grid-cols-2">
                      <section className="rounded-xl bg-[#f4f8f7] p-4">
                        <h3 className="text-xs font-extrabold text-[#0a816d]">بيانات العميل</h3>
                        <dl className="mt-3 space-y-2 text-sm">
                          <div className="flex justify-between gap-3"><dt className="text-[#6e827d]">الاسم</dt><dd className="font-bold">{result.patient_name}</dd></div>
                          <div className="flex justify-between gap-3"><dt className="text-[#6e827d]">الجوال</dt><dd className="font-bold" dir="ltr">{result.patient_mobile}</dd></div>
                          {result.patient_email && <div className="flex justify-between gap-3"><dt className="text-[#6e827d]">البريد</dt><dd className="break-all font-medium" dir="ltr">{result.patient_email}</dd></div>}
                        </dl>
                      </section>
                      <section className="rounded-xl bg-[#f4f8f7] p-4">
                        <h3 className="text-xs font-extrabold text-[#0a816d]">تفاصيل الموعد</h3>
                        <dl className="mt-3 space-y-2 text-sm">
                          <div className="flex justify-between gap-3"><dt className="text-[#6e827d]">رقم الحجز</dt><dd className="font-mono font-bold" dir="ltr">{result.booking_reference}</dd></div>
                          <div className="flex justify-between gap-3"><dt className="text-[#6e827d]">الموعد</dt><dd className="font-bold">{new Date(result.scheduled_start).toLocaleString("ar-SA")}</dd></div>
                          <div className="flex justify-between gap-3"><dt className="text-[#6e827d]">الطبيب</dt><dd className="font-bold">د. {result.doctor_name}</dd></div>
                          <div className="flex justify-between gap-3"><dt className="text-[#6e827d]">العيادة</dt><dd className="font-bold">{result.clinic_name}</dd></div>
                        </dl>
                      </section>
                    </div>

                    <div className="p-5">
                      <div className="overflow-x-auto rounded-xl border border-[#d9e4e1]">
                        <table className="w-full min-w-[560px] text-sm">
                          <thead className="bg-[#0b1f1c] text-white">
                            <tr><th className="p-3 text-start">الخدمة</th><th className="p-3">الكمية</th><th className="p-3">السعر</th><th className="p-3">الضريبة</th><th className="p-3">الإجمالي</th></tr>
                          </thead>
                          <tbody>
                            <tr className="border-b border-[#e4ecea]"><td className="p-3 font-bold">{result.service_name}</td><td className="p-3 text-center">1</td><td className="p-3 text-center">{formatMoney(Number(result.invoice_subtotal))}</td><td className="p-3 text-center">{Number(result.vat_rate)}%</td><td className="p-3 text-center font-bold">{formatMoney(Number(result.invoice_total))}</td></tr>
                          </tbody>
                        </table>
                      </div>

                      <div className="mt-4 me-auto w-full max-w-xs space-y-2 rounded-xl bg-[#f4f8f7] p-4 text-sm">
                        <div className="flex justify-between"><span className="text-[#60746f]">المجموع قبل الضريبة</span><strong>{formatMoney(Number(result.invoice_subtotal))}</strong></div>
                        <div className="flex justify-between"><span className="text-[#60746f]">ضريبة القيمة المضافة ({Number(result.vat_rate)}%)</span><strong>{formatMoney(Number(result.vat_amount))}</strong></div>
                        <div className="flex justify-between border-t-2 border-[#0baa8e] pt-3 text-lg"><span className="font-extrabold">الإجمالي</span><strong className="text-[#067663]">{formatMoney(Number(result.invoice_total))}</strong></div>
                        <div className="flex justify-between"><span className="text-[#60746f]">المدفوع</span><strong>{formatMoney(0)}</strong></div>
                        <div className="flex justify-between rounded-lg bg-amber-50 px-2 py-1.5 text-amber-800"><span className="font-bold">المتبقي</span><strong>{formatMoney(Number(result.invoice_total))}</strong></div>
                      </div>

                      <div className="mt-5 flex items-center justify-between gap-4 border-t border-dashed border-[#c8d8d4] pt-4 text-xs text-[#60746f]">
                        <span>حالة الفاتورة: <strong className="text-amber-700">غير مدفوعة</strong></span>
                        <span>شكرًا لاختياركم {catalog.site_name}</span>
                      </div>
                    </div>
                  </article>

                  <div className="mt-5 flex flex-wrap justify-center gap-3 print:hidden">
                    <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-xl bg-[#0b1f1c] px-6 py-3 font-bold text-white"><Printer className="h-4 w-4" /> طباعة الفاتورة</button>
                    <button type="button" onClick={() => setResult(null)} className="rounded-xl border border-[#0baa8e] bg-white px-6 py-3 font-bold text-[#067663]">حجز موعد آخر</button>
                  </div>
                </div>
              ) : (
                <form onSubmit={submit} className="space-y-4">
                  <div><span className="text-xs font-bold text-[#0baa8e]">حجز إلكتروني مباشر</span><h2 className="mt-1 text-2xl font-extrabold">اختر موعدك المناسب</h2><p className="mt-1 text-sm text-[#6e827d]">ستظهر بياناتك فورًا لدى فريق الاستقبال.</p></div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-bold">الاسم الكامل<input required value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5 w-full rounded-xl border border-[#d9e4e1] bg-white px-3.5 py-3 outline-none focus:border-[#0baa8e]" placeholder="الاسم الثلاثي" /></label>
                    <label className="text-sm font-bold">رقم الجوال<input required dir="ltr" inputMode="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} className="mt-1.5 w-full rounded-xl border border-[#d9e4e1] bg-white px-3.5 py-3 text-end outline-none focus:border-[#0baa8e]" placeholder="05xxxxxxxx" /></label>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-bold">البريد الإلكتروني<input dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5 w-full rounded-xl border border-[#d9e4e1] bg-white px-3.5 py-3 text-end outline-none focus:border-[#0baa8e]" placeholder="name@example.com" /></label>
                    <label className="text-sm font-bold">الجنس<select required value={gender} onChange={(e) => setGender(e.target.value)} className="mt-1.5 w-full rounded-xl border border-[#d9e4e1] bg-white px-3.5 py-3 outline-none focus:border-[#0baa8e]"><option value="">اختر</option><option value="male">ذكر</option><option value="female">أنثى</option></select></label>
                  </div>
                  <label className="block text-sm font-bold">العيادة<select required value={clinicId} onChange={(e) => setClinicId(e.target.value)} className="mt-1.5 w-full rounded-xl border border-[#d9e4e1] bg-white px-3.5 py-3 outline-none focus:border-[#0baa8e]">{catalog.clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}</select></label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-bold">الخدمة<select required value={serviceId} onChange={(e) => setServiceId(e.target.value)} className="mt-1.5 w-full rounded-xl border border-[#d9e4e1] bg-white px-3.5 py-3 outline-none focus:border-[#0baa8e]">{services.map((service) => <option key={service.id} value={service.id}>{service.name} — {formatMoney(Number(service.price))}</option>)}</select></label>
                    <label className="text-sm font-bold">الطبيب<select required value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className="mt-1.5 w-full rounded-xl border border-[#d9e4e1] bg-white px-3.5 py-3 outline-none focus:border-[#0baa8e]">{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>د. {doctor.name}</option>)}</select></label>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-bold">التاريخ<input required type="date" min={tomorrowDate()} value={date} onChange={(e) => setDate(e.target.value)} className="mt-1.5 w-full rounded-xl border border-[#d9e4e1] bg-white px-3.5 py-3 outline-none focus:border-[#0baa8e]" /></label>
                    <label className="text-sm font-bold">الوقت<input required type="time" min="09:00" max="21:00" step="900" value={time} onChange={(e) => setTime(e.target.value)} className="mt-1.5 w-full rounded-xl border border-[#d9e4e1] bg-white px-3.5 py-3 outline-none focus:border-[#0baa8e]" /></label>
                  </div>
                  <label className="block text-sm font-bold">ملاحظة اختيارية<textarea maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className="mt-1.5 min-h-20 w-full resize-none rounded-xl border border-[#d9e4e1] bg-white px-3.5 py-3 outline-none focus:border-[#0baa8e]" placeholder="سبب الزيارة أو أي ملاحظة مهمة" /></label>
                  <label className="hidden" aria-hidden="true">الموقع<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
                  <label className="flex items-start gap-2 text-xs leading-5 text-[#516761]"><input required type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4 accent-[#0baa8e]" /> أوافق على استخدام بياناتي لغرض إنشاء الملف والموعد والفاتورة وفق سياسة الخصوصية.</label>
                  {selectedService && <div className="flex items-center justify-between rounded-xl bg-[#eaf1ef] px-4 py-3 text-sm"><span>القيمة التقديرية قبل الضريبة</span><strong>{formatMoney(Number(selectedService.price))}</strong></div>}
                  {submitError && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{submitError}</p>}
                  <button disabled={submitting} className="w-full rounded-xl bg-gradient-to-l from-[#0baa8e] to-[#1fcfb8] px-5 py-4 font-extrabold text-white shadow-lg transition hover:-translate-y-0.5 disabled:opacity-60">{submitting ? "جارٍ تثبيت الموعد..." : "تأكيد الحجز وإنشاء الفاتورة"}</button>
                </form>
              )}
            </div>
          </div>
        </section>

        <section className="bg-[#0b1f1c] py-4 text-white/80"><div className="mx-auto flex max-w-7xl flex-wrap justify-center gap-x-10 gap-y-3 px-5 text-sm font-bold"><span>تعقيم بمعايير عالية</span><span>أطباء متخصصون</span><span>تقنيات رقمية حديثة</span><span>مواعيد مرنة</span><span>خيارات دفع متعددة</span></div></section>

        <section id="services" className="mx-auto max-w-7xl px-5 py-24 lg:px-10">
          <div className="mx-auto max-w-2xl text-center"><span className="font-bold text-[#0baa8e]">خدمات مصممة لابتسامتك</span><h2 className="mt-2 text-3xl font-extrabold sm:text-4xl">رعاية شاملة للأسنان</h2><p className="mt-3 text-[#6e827d]">من الفحص الوقائي إلى تحسين الابتسامة، نقدم تجربة واضحة ومريحة في كل زيارة.</p></div>
          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {[{ icon: Stethoscope, title: "الفحص والتشخيص", body: "تقييم دقيق وخطة علاج واضحة." }, { icon: Sparkles, title: "تنظيف وتلميع", body: "عناية دورية لصحة اللثة والأسنان." }, { icon: HeartPulse, title: "علاج الأسنان", body: "حلول محافظة تعيد الراحة والوظيفة." }, { icon: ShieldCheck, title: "الوقاية والمتابعة", body: "متابعة مستمرة لحماية ابتسامتك." }].map(({ icon: Icon, title, body }) => <article key={title} className="rounded-[20px] border border-[#d9e4e1] bg-white p-6 shadow-[0_10px_30px_-20px_rgba(11,31,28,.35)] transition hover:-translate-y-1"><span className="grid h-14 w-14 place-items-center rounded-2xl bg-[#cfeee6] text-[#067663]"><Icon className="h-6 w-6" /></span><h3 className="mt-5 text-lg font-extrabold">{title}</h3><p className="mt-2 text-sm leading-6 text-[#6e827d]">{body}</p></article>)}
          </div>
        </section>

        <section id="doctors" className="bg-white py-24"><div className="mx-auto max-w-7xl px-5 lg:px-10"><div className="flex flex-wrap items-end justify-between gap-5"><div><span className="font-bold text-[#0baa8e]">فريقنا الطبي</span><h2 className="mt-2 text-3xl font-extrabold sm:text-4xl">خبرة تضع راحتك أولًا</h2></div><a href="#booking" className="font-bold text-[#067663]">احجز مع طبيبك ←</a></div><div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">{catalog.team.map((doctor) => <article key={doctor.id} className="flex items-center gap-4 rounded-[20px] border border-[#d9e4e1] bg-[#f4f8f7] p-5"><span className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-[#0baa8e] to-[#1fcfb8] text-xl font-extrabold text-white">{doctor.name.replace("د. ", "").charAt(0)}</span><div><h3 className="font-extrabold">د. {doctor.name}</h3><p className="mt-1 text-sm text-[#6e827d]">{doctor.job_title ?? "طبيب أسنان"}</p><span className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-[#067663]"><BadgeCheck className="h-4 w-4" /> متاح للحجز</span></div></article>)}</div></div></section>

        <section id="about" className="mx-auto max-w-7xl px-5 py-24 lg:px-10"><div className="grid gap-8 lg:grid-cols-3">{[{ icon: CalendarDays, n: "01", title: "اختر موعدك", body: "حدد الخدمة والطبيب والوقت المناسب." }, { icon: Users, n: "02", title: "يصل الحجز فورًا", body: "يظهر الموعد مباشرةً لفريق الاستقبال." }, { icon: CheckCircle2, n: "03", title: "ابدأ رحلتك", body: "احضر في الوقت المحدد وأكمل خطة الرعاية." }].map(({ icon: Icon, n, title, body }) => <div key={n} className="rounded-[22px] border border-[#d9e4e1] bg-white p-7"><div className="flex items-center justify-between"><span className="grid h-12 w-12 place-items-center rounded-full bg-[#cfeee6] font-extrabold text-[#067663]">{n}</span><Icon className="h-6 w-6 text-[#0baa8e]" /></div><h3 className="mt-6 text-xl font-extrabold">{title}</h3><p className="mt-2 text-[#6e827d]">{body}</p></div>)}</div></section>
      </main>

      <footer className="bg-[#0b1f1c] py-14 text-white/70"><div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-8 px-5 lg:px-10"><div className="flex items-center gap-4"><span className="grid h-20 w-20 place-items-center overflow-hidden rounded-2xl bg-white p-1"><img src={LOGO_IMAGE} alt="شعار أسناني My Teeth" className="h-full w-full object-contain" /></span><div><strong className="text-lg text-white">{catalog.site_name}</strong><p className="mt-2 max-w-md text-sm leading-6">رعاية طبية متخصصة تجمع الخبرة والتقنية والاهتمام بالتفاصيل.</p></div></div><div className="space-y-2 text-sm"><p className="flex items-center gap-2"><Phone className="h-4 w-4 text-[#1fcfb8]" /> {catalog.phone}</p><p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-[#1fcfb8]" /> {catalog.address || "المملكة العربية السعودية"}</p></div></div><div className="mx-auto mt-10 max-w-7xl border-t border-white/10 px-5 pt-6 text-xs lg:px-10">© {new Date().getFullYear()} {catalog.site_name}. جميع الحقوق محفوظة.</div></footer>
    </div>
  );
}
