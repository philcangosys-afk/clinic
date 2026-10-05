import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import {
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  HeartPulse,
  MapPin,
  Menu,
  Phone,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Users,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

const HERO_IMAGE = "https://images.pexels.com/photos/4971512/pexels-photo-4971512.jpeg";
const LOGO_IMAGE = "https://cdn.builder.io/api/v1/image/assets%2Fce04605038104603b965d31c7c18e8db%2F44225d3925cf48e8883d9f35b0a6e724?format=webp&width=800&height=1200";
const DERMATOLOGY_TEAM = [
  { name: "نوف", specialty: "الأمراض الجلدية والعناية بالبشرة" },
  { name: "سارة", specialty: "الليزر والتجميل غير الجراحي" },
  { name: "لينا", specialty: "علاج البشرة والشعر" },
  { name: "ريما", specialty: "الحقن التجميلي وتجديد البشرة" },
];

type Clinic = { id: string; name: string };
type Doctor = { id: string; name: string; job_title: string | null; specialty?: string | null; clinic_id: string };
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
type AvailableSlot = {
  start: string;
  end: string;
  date: string;
  doctors?: number;
};

type SlotsResponse = {
  slots: AvailableSlot[];
};

/**
 * الحجز من الموقع طلبٌ برقمٍ متسلسل (0226) — لا ملفّ ولا فاتورة: الاستقبال
 * يفتح الملفّ من بيانات الحاجز ويؤكّد الموعد. طريقة الدفع مخفيّة حاليًا.
 */
type BookingResult = {
  booking_number: number;
  scheduled_start: string;
  scheduled_end: string;
  patient_name: string;
  patient_mobile: string;
  service_text: string;
  doctor_name: string | null;
  doctor_specialty: string | null;
  clinic_name: string;
  phone: string | null;
  address: string | null;
  site_name: string;
};

/** «د. أمجد» ⇐ «أمجد» — الاسم يصل بلا لقب */
const doctorTitle = (name: string) => `د. ${name.replace(/^\s*د\s*\.?\s*/, "")}`;

function tomorrowDateFor(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function PublicBooking() {
  const { slug = "asnan-premium" } = useParams();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState<BookingResult | null>(() => {
    const savedBooking = window.history.state?.publicBookingResult;
    return savedBooking?.slug === slug ? savedBooking.result as BookingResult : null;
  });
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [gender, setGender] = useState("");
  const [clinicId, setClinicId] = useState("");
  // فارغ = «أي طبيب متاح»
  const [doctorId, setDoctorId] = useState("");
  const [serviceText, setServiceText] = useState("");
  const [copied, setCopied] = useState(false);
  const [date, setDate] = useState("");
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return new Date(tomorrow.getFullYear(), tomorrow.getMonth(), 1);
  });
  const [selectedSlotStart, setSelectedSlotStart] = useState("");
  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [mobileBookingOpen, setMobileBookingOpen] = useState(false);
  const [appointmentPickerOpen, setAppointmentPickerOpen] = useState(false);

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
    if (loading) return;
    const elements = document.querySelectorAll<HTMLElement>("[data-reveal]");
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [loading]);

  useEffect(() => {
    if (!catalog || clinicId) return;
    const initialClinic = catalog.clinics[0];
    if (initialClinic) setClinicId(initialClinic.id);
  }, [catalog, clinicId]);

  const doctors = useMemo(
    () => (catalog?.doctors ?? []).filter((doctor) => doctor.clinic_id === clinicId),
    [catalog, clinicId],
  );

  // طبيبٌ لا يتبع العيادة المختارة يُلغى اختياره (يبقى «أي طبيب»)
  useEffect(() => {
    if (doctorId && !doctors.some((doctor) => doctor.id === doctorId)) setDoctorId("");
  }, [doctorId, doctors]);

  const bookingDetailsComplete = Boolean(name.trim() && mobile.trim() && gender && clinicId && serviceText.trim());

  useEffect(() => {
    if (!clinicId) {
      setAvailableSlots([]);
      setSelectedSlotStart("");
      return;
    }
    let active = true;
    setSlotsLoading(true);
    setSlotsError("");
    setDate("");
    setSelectedSlotStart("");
    setAppointmentPickerOpen(false);
    void supabase.rpc("app_public_booking_slots", {
      p_slug: slug,
      p_clinic_id: clinicId,
      p_doctor_id: doctorId || null,
      p_from: tomorrowDateFor(new Date()),
      p_days: 30,
    }).then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setAvailableSlots([]);
        setSelectedSlotStart("");
        setSlotsError(error.message);
      } else {
        const slots = ((data as SlotsResponse | null)?.slots ?? []);
        setAvailableSlots(slots);
        const first = slots[0];
        if (first) {
          const firstDate = new Date(first.start);
          setVisibleMonth(new Date(firstDate.getFullYear(), firstDate.getMonth(), 1));
        }
      }
      setSlotsLoading(false);
    });
    return () => { active = false; };
  }, [clinicId, doctorId, slug]);

  const slotsByDate = useMemo(() => {
    const grouped = new Map<string, AvailableSlot[]>();
    availableSlots.forEach((slot) => {
      const key = tomorrowDateFor(new Date(slot.start));
      grouped.set(key, [...(grouped.get(key) ?? []), slot]);
    });
    return grouped;
  }, [availableSlots]);

  const availableDates = [...slotsByDate.keys()];
  const selectedDateSlots = slotsByDate.get(date) ?? [];
  const availableMonthKeys = [...new Set(availableDates.map((availableDate) => availableDate.slice(0, 7)))].sort();
  const visibleMonthKey = tomorrowDateFor(visibleMonth).slice(0, 7);
  const visibleMonthIndex = availableMonthKeys.indexOf(visibleMonthKey);
  const calendarDays = useMemo(() => {
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();
    const leadingDays = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return [
      ...Array.from({ length: leadingDays }, () => null),
      ...Array.from({ length: daysInMonth }, (_, index) => tomorrowDateFor(new Date(year, month, index + 1))),
    ];
  }, [visibleMonth]);

  const showMonth = (offset: number) => {
    const targetKey = availableMonthKeys[visibleMonthIndex + offset];
    if (!targetKey) return;
    const [year, month] = targetKey.split("-").map(Number);
    setVisibleMonth(new Date(year, month - 1, 1));
    setDate("");
    setSelectedSlotStart("");
  };

  const openBooking = () => {
    setMobileBookingOpen(true);
    setMobileMenu(false);
    requestAnimationFrame(() => document.getElementById("booking")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const clearBookingResult = () => {
    setResult(null);
    const nextState = { ...(window.history.state ?? {}) };
    delete nextState.publicBookingResult;
    window.history.replaceState(nextState, "");
  };

  const copyBookingNumber = async (value: number) => {
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitError("");
    if (!name.trim() || !mobile.trim()) {
      setSubmitError("الاسم ورقم الجوال مطلوبان");
      return;
    }
    if (!clinicId || !serviceText.trim()) {
      setSubmitError("اختر العيادة واكتب الخدمة المطلوبة");
      return;
    }
    if (!selectedSlotStart || !availableSlots.some((slot) => slot.start === selectedSlotStart)) {
      setSubmitError("اختر موعدًا متاحًا من الجدول");
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.rpc("app_public_create_booking", {
      p_slug: slug,
      p_name: name,
      p_mobile: mobile,
      p_gender: gender,
      p_clinic_id: clinicId,
      p_doctor_id: doctorId || null,
      p_service_text: serviceText,
      p_scheduled_start: selectedSlotStart,
      p_consent: consent,
      p_website: website || null,
    });
    setSubmitting(false);
    if (error) setSubmitError(error.message);
    else {
      const bookingResult = data as BookingResult;
      setResult(bookingResult);
      window.history.replaceState({ ...(window.history.state ?? {}), publicBookingResult: { slug, result: bookingResult } }, "");
      requestAnimationFrame(() => document.getElementById("booking")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };

  if (loading) return <main dir="rtl" className="grid min-h-screen place-items-center bg-[#f4f8f7] text-[#0b1f1c]">جارٍ تجهيز موقع الحجز...</main>;
  if (loadError || !catalog) return <main dir="rtl" className="grid min-h-screen place-items-center bg-[#f4f8f7] p-6 text-center text-[#0b1f1c]"><div><h1 className="text-2xl font-bold">موقع الحجز غير متاح</h1><p className="mt-2 text-[#6e827d]">{loadError}</p></div></main>;

  return (
    <div dir="rtl" className="min-h-screen bg-[#f4f8f7] pb-20 text-start text-[#0b1f1c] lg:pb-0">
      <div className="bg-[#0b1f1c] text-xs text-white/75">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-5 py-2.5 lg:px-10">
          <span className="flex items-center gap-2"><Clock3 className="h-3.5 w-3.5 text-[#1fcfb8]" /> السبت – الخميس، 9 صباحًا – 10 مساءً</span>
          {catalog.phone && <a href={`tel:${catalog.phone}`} className="flex items-center gap-2" dir="ltr"><Phone className="h-3.5 w-3.5 text-[#1fcfb8]" /> {catalog.phone}</a>}
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
            <a href="#dermatology" className="hover:text-[#0baa8e]">الجلدية والتجميل</a>
            <a href="#about" className="hover:text-[#0baa8e]">عن المركز</a>
          </nav>
          <button type="button" onClick={openBooking} className="hidden rounded-full bg-gradient-to-l from-[#0baa8e] to-[#1fcfb8] px-5 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-700/20 sm:block">احجز موعدك</button>
          <button type="button" aria-label="القائمة" aria-expanded={mobileMenu} onClick={() => setMobileMenu((open) => !open)} className="grid h-10 w-10 place-items-center rounded-xl border border-[#bfd0cb] lg:hidden"><Menu className="h-5 w-5" /></button>
        </div>
        {mobileMenu && (
          <nav className="border-t border-[#d9e4e1] bg-white px-5 py-3 lg:hidden">
            <div className="mx-auto flex max-w-7xl flex-col text-sm font-bold text-[#37514b]">
              <a onClick={() => setMobileMenu(false)} href="#top" className="border-b border-[#eaf1ef] py-3">الرئيسية</a>
              <a onClick={() => setMobileMenu(false)} href="#services" className="border-b border-[#eaf1ef] py-3">خدماتنا</a>
              <a onClick={() => setMobileMenu(false)} href="#doctors" className="border-b border-[#eaf1ef] py-3">أطباؤنا</a>
              <a onClick={() => setMobileMenu(false)} href="#dermatology" className="border-b border-[#eaf1ef] py-3">الجلدية والتجميل</a>
              <button type="button" onClick={openBooking} className="py-3 text-start text-[#067663]">احجز موعدك</button>
            </div>
          </nav>
        )}
      </header>

      <main id="top">
        <section className={`relative isolate ${result ? "bg-[#f4f8f7] text-[#0b1f1c]" : "overflow-hidden bg-[#0b1f1c] text-white"}`}>
          {!result && <img src={HERO_IMAGE} alt="طبيبة أسنان تقدم الرعاية لمريضة في عيادة حديثة" className="absolute inset-0 -z-20 h-full w-full object-cover object-center" />}
          {!result && <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(11,31,28,.72),rgba(11,31,28,.92)),radial-gradient(circle_at_20%_30%,rgba(11,170,142,.45),transparent_55%)]" />}
          <div className={`mx-auto grid max-w-7xl items-center gap-12 px-4 lg:px-10 ${result ? "min-h-0 py-8 lg:grid-cols-1 lg:py-12" : "min-h-[690px] py-20 lg:grid-cols-[1.05fr_.95fr]"}`}>
            {!result && <div data-reveal className="booking-reveal max-w-2xl">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-bold backdrop-blur"><Sparkles className="h-4 w-4 text-[#1fcfb8]" /> ابتسامة صحية، ثقة تدوم</span>
              <h1 className="mt-6 text-4xl font-extrabold leading-[1.15] sm:text-5xl lg:text-6xl">{catalog.hero_title}</h1>
              <p className="mt-5 max-w-xl text-lg leading-8 text-white/80">{catalog.hero_subtitle}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <button type="button" onClick={openBooking} className="hidden rounded-xl bg-gradient-to-l from-[#0baa8e] to-[#1fcfb8] px-6 py-3.5 font-bold text-white shadow-xl transition duration-300 hover:-translate-y-1 hover:shadow-2xl active:scale-95 lg:inline-flex">احجز موعدك الآن</button>
                <a href="#doctors" className="rounded-xl border border-white/30 bg-white/10 px-6 py-3.5 font-bold backdrop-blur transition duration-300 hover:-translate-y-1 hover:bg-white/20 active:scale-95">تعرّف على أطبائنا</a>
              </div>
              <div className="mt-10 grid max-w-xl grid-cols-3 gap-4 border-t border-white/15 pt-7 text-center sm:text-start">
                <div><strong className="block text-2xl text-[#1fcfb8]">+15</strong><span className="text-xs text-white/65">عامًا من الخبرة</span></div>
                <div><strong className="block text-2xl text-[#1fcfb8]">+20K</strong><span className="text-xs text-white/65">ابتسامة سعيدة</span></div>
                <div><strong className="block text-2xl text-[#1fcfb8]">98%</strong><span className="text-xs text-white/65">رضا المراجعين</span></div>
              </div>
            </div>}

            <div id="booking" className={`${mobileBookingOpen || result ? "block" : "hidden"} min-w-0 scroll-mt-28 rounded-[24px] border border-white/40 bg-white/95 p-4 text-[#0b1f1c] shadow-2xl backdrop-blur-xl sm:p-7 lg:block ${result ? "mx-auto w-full max-w-5xl" : ""}`}>
              {result ? (
                <div id="booking-result" className="min-w-0 py-2">
                  <div className="text-center">
                    <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#cfeee6] text-[#067663]"><CheckCircle2 className="h-8 w-8" /></span>
                    <h2 className="mt-3 text-xl font-extrabold sm:text-2xl">تم استلام حجزك</h2>
                    <p className="mt-1 text-sm text-[#6e827d]">سيتواصل معك الاستقبال لتأكيد الموعد.</p>
                  </div>

                  <div className="mx-auto mt-5 max-w-md rounded-2xl border-2 border-dashed border-[#0baa8e] bg-[#f4fbf9] p-5 text-center">
                    <p className="text-sm font-bold text-[#0a816d]">رقم الحجز</p>
                    <p className="mt-1 font-mono text-5xl font-extrabold tracking-wider text-[#0b1f1c]" dir="ltr">{result.booking_number}</p>
                    <button type="button" onClick={() => void copyBookingNumber(result.booking_number)} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[#0b1f1c] px-5 py-2.5 text-sm font-bold text-white">
                      <Copy className="h-4 w-4" /> {copied ? "تم النسخ" : "نسخ رقم الحجز"}
                    </button>
                    <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">صوّر الشاشة أو انسخ رقم الحجز — ستحتاجه عند التواصل مع المركز.</p>
                  </div>

                  <dl className="mx-auto mt-5 max-w-md space-y-2 rounded-2xl bg-[#f4f8f7] p-4 text-sm">
                    <div className="flex justify-between gap-3"><dt className="text-[#6e827d]">الاسم</dt><dd className="font-bold">{result.patient_name}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-[#6e827d]">الجوال</dt><dd className="font-bold" dir="ltr">{result.patient_mobile}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-[#6e827d]">الموعد</dt><dd className="text-end font-bold">{new Date(result.scheduled_start).toLocaleString("ar-SA", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-[#6e827d]">العيادة</dt><dd className="font-bold">{result.clinic_name}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-[#6e827d]">الطبيب</dt><dd className="text-end font-bold">{result.doctor_name ? `${doctorTitle(result.doctor_name)}${result.doctor_specialty ? ` — ${result.doctor_specialty}` : ""}` : "أي طبيب متاح (يحدّده الاستقبال)"}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-[#6e827d]">الخدمة</dt><dd className="text-end font-bold">{result.service_text}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-[#6e827d]">الحالة</dt><dd className="font-bold text-amber-700">بانتظار تأكيد الاستقبال</dd></div>
                  </dl>

                  <div className="mx-auto mt-4 flex max-w-md flex-col gap-2 text-sm">
                    {(result.phone || catalog.phone) && (
                      <a href={`tel:${result.phone || catalog.phone}`} className="flex items-center justify-center gap-2 rounded-xl border border-[#0baa8e] bg-white px-4 py-3 font-bold text-[#067663]"><Phone className="h-4 w-4" /> اتصل بنا <span dir="ltr">{result.phone || catalog.phone}</span></a>
                    )}
                    {(result.address || catalog.address) && <p className="flex items-center justify-center gap-2 text-[#6e827d]"><MapPin className="h-4 w-4 text-[#0baa8e]" /> {result.address || catalog.address}</p>}
                  </div>

                  <div className="mt-5 flex justify-center">
                    <button type="button" onClick={clearBookingResult} className="rounded-xl border border-[#0baa8e] bg-white px-6 py-3 font-bold text-[#067663]">حجز موعد آخر</button>
                  </div>
                </div>
              ) : (
                <form onSubmit={submit} className="space-y-4">
                  <div><span className="text-xs font-bold text-[#0baa8e]">حجز إلكتروني مباشر</span><h2 className="mt-1 text-2xl font-extrabold">اختر موعدك المناسب</h2><p className="mt-1 text-sm text-[#6e827d]">يصل حجزك فورًا إلى الاستقبال لتأكيده.</p></div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-bold">الاسم الكامل *<input required value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5 w-full rounded-xl border border-[#d9e4e1] bg-white px-3.5 py-3 outline-none focus:border-[#0baa8e]" placeholder="الاسم الثلاثي" /></label>
                    <label className="text-sm font-bold">رقم الجوال *<input required dir="ltr" inputMode="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} className="mt-1.5 w-full rounded-xl border border-[#d9e4e1] bg-white px-3.5 py-3 text-end outline-none focus:border-[#0baa8e]" placeholder="05xxxxxxxx" /></label>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-bold">الجنس *<select required value={gender} onChange={(e) => setGender(e.target.value)} className="mt-1.5 w-full rounded-xl border border-[#d9e4e1] bg-white px-3.5 py-3 outline-none focus:border-[#0baa8e]"><option value="">اختر</option><option value="male">ذكر</option><option value="female">أنثى</option></select></label>
                    <label className="text-sm font-bold">العيادة *<select required value={clinicId} onChange={(e) => setClinicId(e.target.value)} className="mt-1.5 w-full rounded-xl border border-[#d9e4e1] bg-white px-3.5 py-3 outline-none focus:border-[#0baa8e]">
                      {catalog.clinics.length === 0 && <option value="">لا توجد عيادات متاحة للحجز حاليًا</option>}
                      {catalog.clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}
                    </select></label>
                  </div>
                  <label className="block text-sm font-bold">الخدمة المطلوبة *<input required maxLength={200} value={serviceText} onChange={(e) => setServiceText(e.target.value)} className="mt-1.5 w-full rounded-xl border border-[#d9e4e1] bg-white px-3.5 py-3 outline-none focus:border-[#0baa8e]" placeholder="مثال: تنظيف أسنان، كشف، ليزر منطقة صغيرة" /></label>
                  <label className="block text-sm font-bold">الطبيب (اختياري)<select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className="mt-1.5 w-full rounded-xl border border-[#d9e4e1] bg-white px-3.5 py-3 outline-none focus:border-[#0baa8e]">
                    <option value="">أي طبيب متاح</option>
                    {doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctorTitle(doctor.name)}{(doctor.specialty || doctor.job_title) ? ` — ${doctor.specialty || doctor.job_title}` : ""}</option>)}
                  </select></label>
                  <div className="overflow-hidden rounded-2xl border border-[#d9e4e1]">
                    <button type="button" disabled={!bookingDetailsComplete || slotsLoading} onClick={() => setAppointmentPickerOpen((open) => !open)} className="flex w-full items-center justify-between gap-3 bg-[#f7fbfa] px-4 py-3 text-start hover:bg-[#eef7f4] disabled:cursor-not-allowed disabled:opacity-60">
                      <span><strong className="block text-sm">{selectedSlotStart ? "الموعد المختار" : "تاريخ الحجز *"}</strong><small className="mt-0.5 block text-[#6e827d]">{selectedSlotStart ? new Date(selectedSlotStart).toLocaleString("ar-SA", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : bookingDetailsComplete ? (doctorId ? "اضغط لاختيار اليوم والوقت من دوام الطبيب" : "اضغط لاختيار اليوم والوقت من دوام أطباء العيادة") : "أكمل البيانات بالأعلى أولًا"}</small></span>
                      <ChevronLeft className={`h-5 w-5 text-[#0a816d] transition-transform ${appointmentPickerOpen ? "-rotate-90" : ""}`} />
                    </button>
                    {appointmentPickerOpen && (
                      <div className="border-t border-[#e3ebe9] p-3 sm:p-4">
                        {slotsLoading && <p className="text-center text-xs font-bold text-[#0a816d]">جارٍ تحديث المواعيد...</p>}
                        {slotsError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{slotsError}</p>}
                        {!slotsLoading && !slotsError && availableDates.length === 0 && <p className="rounded-lg bg-amber-50 px-3 py-3 text-sm font-bold text-amber-800">لا توجد مواعيد متاحة خلال الثلاثين يومًا القادمة — جرّب طبيبًا آخر أو اتصل بالمركز.</p>}
                        {!slotsLoading && availableDates.length > 0 && !date && (
                          <div className="mx-auto max-w-xs">
                            <div className="flex items-center justify-between rounded-lg bg-[#f4f8f7] px-1.5 py-1.5">
                              <button type="button" aria-label="الشهر السابق" disabled={visibleMonthIndex <= 0} onClick={() => showMonth(-1)} className="grid h-7 w-7 place-items-center rounded-md hover:bg-white disabled:opacity-25"><ChevronRight className="h-4 w-4" /></button>
                              <strong className="text-xs sm:text-sm">{visibleMonth.toLocaleDateString("ar-SA", { month: "long", year: "numeric" })}</strong>
                              <button type="button" aria-label="الشهر التالي" disabled={visibleMonthIndex < 0 || visibleMonthIndex >= availableMonthKeys.length - 1} onClick={() => showMonth(1)} className="grid h-7 w-7 place-items-center rounded-md hover:bg-white disabled:opacity-25"><ChevronLeft className="h-4 w-4" /></button>
                            </div>
                            <div className="mt-1.5 grid grid-cols-7 gap-1 text-center text-[9px] font-bold text-[#6e827d] sm:text-[10px]">
                              {["أحد", "اثن", "ثلا", "أرب", "خمي", "جمع", "سبت"].map((dayName) => <span key={dayName} className="py-0.5">{dayName}</span>)}
                              {calendarDays.map((calendarDate, index) => {
                                if (!calendarDate) return <span key={`empty-${index}`} />;
                                const isAvailable = slotsByDate.has(calendarDate);
                                return (
                                  <button key={calendarDate} type="button" disabled={!isAvailable} onClick={() => {
                                    setDate(calendarDate);
                                    setSelectedSlotStart("");
                                  }} className={`h-8 rounded-md text-[10px] font-extrabold transition sm:h-9 sm:text-xs ${isAvailable ? "border border-[#9ed8cb] bg-[#e8f8f4] text-[#067663] hover:border-[#0baa8e]" : "cursor-not-allowed bg-[#f1f3f2] text-[#adb8b5]"}`}>
                                    {Number(calendarDate.slice(-2)).toLocaleString("ar-SA")}
                                  </button>
                                );
                              })}
                            </div>
                            <div className="mt-2 flex items-center justify-center gap-4 text-[10px] text-[#6e827d]"><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-[#e8f8f4] ring-1 ring-[#9ed8cb]" />متاح</span><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-[#f1f3f2]" />غير متاح</span></div>
                          </div>
                        )}
                        {!slotsLoading && date && (
                          <div className="mx-auto max-w-xs">
                            <div className="mb-3 flex items-center justify-between gap-2">
                              <button type="button" onClick={() => { setDate(""); setSelectedSlotStart(""); }} className="inline-flex items-center gap-1 rounded-lg border border-[#d9e4e1] px-2 py-1.5 text-xs font-bold text-[#067663]"><ChevronRight className="h-4 w-4" /> رجوع</button>
                              <span className="text-xs font-bold">{new Date(`${date}T12:00:00`).toLocaleDateString("ar-SA", { weekday: "long", day: "numeric", month: "long" })}</span>
                            </div>
                            <div className="grid max-h-44 grid-cols-3 gap-1.5 overflow-y-auto pe-1 sm:grid-cols-4">
                              {selectedDateSlots.map((slot) => (
                                <button key={slot.start} type="button" onClick={() => { setSelectedSlotStart(slot.start); setAppointmentPickerOpen(false); }} className={`rounded-lg border px-1 py-2 text-[11px] font-bold ${selectedSlotStart === slot.start ? "border-[#0baa8e] bg-[#0baa8e] text-white" : "border-[#d9e4e1] bg-white text-[#37514b] hover:border-[#0baa8e]"}`}>
                                  {new Date(slot.start).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <label className="hidden" aria-hidden="true">الموقع<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
                  <label className="flex items-start gap-2 text-xs leading-5 text-[#516761]"><input required type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4 accent-[#0baa8e]" /> أوافق على استخدام بياناتي لغرض إنشاء الملف والموعد وفق سياسة الخصوصية.</label>
                  {submitError && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{submitError}</p>}
                  <button disabled={submitting} className="w-full rounded-xl bg-gradient-to-l from-[#0baa8e] to-[#1fcfb8] px-5 py-4 font-extrabold text-white shadow-lg transition hover:-translate-y-0.5 disabled:opacity-60">{submitting ? "جارٍ إرسال الحجز..." : "تأكيد الحجز"}</button>
                  {catalog.phone && <p className="text-center text-xs text-[#6e827d]">للاستفسار: <a href={`tel:${catalog.phone}`} className="font-bold text-[#067663]" dir="ltr">{catalog.phone}</a></p>}
                </form>
              )}
            </div>
          </div>
        </section>

        <section className="bg-[#0b1f1c] py-4 text-white/80"><div className="mx-auto flex max-w-7xl flex-wrap justify-center gap-x-10 gap-y-3 px-5 text-sm font-bold"><span>تعقيم بمعايير عالية</span><span>أطباء متخصصون</span><span>تقنيات رقمية حديثة</span><span>مواعيد مرنة</span><span>تأكيد سريع من الاستقبال</span></div></section>

        <section id="services" data-reveal className="booking-reveal mx-auto max-w-7xl px-5 py-24 lg:px-10">
          <div className="mx-auto max-w-2xl text-center"><span className="font-bold text-[#0baa8e]">خدمات مصممة لابتسامتك</span><h2 className="mt-2 text-3xl font-extrabold sm:text-4xl">رعاية شاملة للأسنان</h2><p className="mt-3 text-[#6e827d]">من الفحص الوقائي إلى تحسين الابتسامة، نقدم تجربة واضحة ومريحة في كل زيارة.</p></div>
          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {[{ icon: Stethoscope, title: "الفحص والتشخيص", body: "تقييم دقيق وخطة علاج واضحة." }, { icon: Sparkles, title: "تنظيف وتلميع", body: "عناية دورية لصحة اللثة والأسنان." }, { icon: HeartPulse, title: "علاج الأسنان", body: "حلول محافظة تعيد الراحة والوظيفة." }, { icon: ShieldCheck, title: "الوقاية والمتابعة", body: "متابعة مستمرة لحماية ابتسامتك." }].map(({ icon: Icon, title, body }) => <article key={title} className="rounded-[20px] border border-[#d9e4e1] bg-white p-6 shadow-[0_10px_30px_-20px_rgba(11,31,28,.35)] transition hover:-translate-y-1"><span className="grid h-14 w-14 place-items-center rounded-2xl bg-[#cfeee6] text-[#067663]"><Icon className="h-6 w-6" /></span><h3 className="mt-5 text-lg font-extrabold">{title}</h3><p className="mt-2 text-sm leading-6 text-[#6e827d]">{body}</p></article>)}
          </div>
        </section>

        <section id="doctors" data-reveal className="booking-reveal bg-white py-24"><div className="mx-auto max-w-7xl px-5 lg:px-10"><div className="flex flex-wrap items-end justify-between gap-5"><div><span className="font-bold text-[#0baa8e]">فريقنا الطبي</span><h2 className="mt-2 text-3xl font-extrabold sm:text-4xl">خبرة تضع راحتك أولًا</h2></div><button type="button" onClick={openBooking} className="font-bold text-[#067663] transition hover:-translate-x-1">احجز مع طبيبك ←</button></div><div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">{catalog.team.map((doctor) => <article key={doctor.id} className="group flex items-center gap-4 rounded-[20px] border border-[#d9e4e1] bg-[#f4f8f7] p-5 transition duration-300 hover:-translate-y-1 hover:border-[#9ed8cb] hover:shadow-xl"><span className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-[#0baa8e] to-[#1fcfb8] text-xl font-extrabold text-white transition duration-300 group-hover:rotate-3 group-hover:scale-105">{doctor.name.replace("د. ", "").charAt(0)}</span><div><h3 className="font-extrabold">{doctorTitle(doctor.name)}</h3><p className="mt-1 text-sm text-[#6e827d]">{doctor.specialty || doctor.job_title || "\u00a0"}</p><span className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-[#067663]"><BadgeCheck className="h-4 w-4" /> متاح للحجز</span></div></article>)}</div></div></section>

        <section id="dermatology" data-reveal className="booking-reveal relative overflow-hidden bg-[#f3effa] py-20">
          <div className="absolute -start-24 top-10 h-64 w-64 rounded-full bg-violet-300/25 blur-3xl" />
          <div className="relative mx-auto max-w-7xl px-5 lg:px-10">
            <div className="grid items-center gap-10 lg:grid-cols-[.8fr_1.2fr]">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full bg-violet-100 px-4 py-2 text-sm font-bold text-violet-700"><Sparkles className="h-4 w-4" /> قريبًا في المركز</span>
                <h2 className="mt-5 text-3xl font-extrabold leading-tight text-[#241a32] sm:text-4xl">عيادة الجلدية والتجميل</h2>
                <p className="mt-4 leading-8 text-[#695d76]">تجربة عناية متكاملة تجمع التشخيص الطبي الدقيق مع أحدث تقنيات البشرة والليزر والتجميل غير الجراحي، ضمن خطط شخصية تحافظ على مظهر طبيعي وصحي.</p>
                <div className="mt-6 grid grid-cols-2 gap-3 text-sm font-bold text-[#52455f]"><span className="rounded-xl bg-white/75 p-3">عناية بالبشرة والشعر</span><span className="rounded-xl bg-white/75 p-3">ليزر وتقنيات حديثة</span><span className="rounded-xl bg-white/75 p-3">حقن تجميلي آمن</span><span className="rounded-xl bg-white/75 p-3">خطط علاج مخصصة</span></div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {DERMATOLOGY_TEAM.map((doctor, index) => (
                  <article key={doctor.name} className="group rounded-2xl border border-violet-200/70 bg-white/85 p-5 shadow-sm backdrop-blur transition duration-300 hover:-translate-y-1 hover:shadow-xl">
                    <div className="flex items-center gap-3"><span className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-500 font-extrabold text-white transition group-hover:scale-105">{doctor.name.charAt(0)}</span><div><h3 className="font-extrabold text-[#241a32]">د. {doctor.name}</h3><p className="mt-1 text-xs leading-5 text-[#776a83]">{doctor.specialty}</p></div></div>
                    <span className="mt-4 inline-flex rounded-full bg-violet-50 px-3 py-1 text-[11px] font-bold text-violet-700">{index === 0 ? "ضمن فريق المركز" : "ينضم قريبًا"}</span>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="about" data-reveal className="booking-reveal mx-auto max-w-7xl px-5 py-24 lg:px-10"><div className="grid gap-8 lg:grid-cols-3">{[{ icon: CalendarDays, n: "01", title: "اختر موعدك", body: "حدد الخدمة والطبيب والوقت المناسب." }, { icon: Users, n: "02", title: "يصل الحجز فورًا", body: "يظهر الموعد مباشرةً لفريق الاستقبال." }, { icon: CheckCircle2, n: "03", title: "ابدأ رحلتك", body: "احضر في الوقت المحدد وأكمل خطة الرعاية." }].map(({ icon: Icon, n, title, body }) => <div key={n} className="rounded-[22px] border border-[#d9e4e1] bg-white p-7"><div className="flex items-center justify-between"><span className="grid h-12 w-12 place-items-center rounded-full bg-[#cfeee6] font-extrabold text-[#067663]">{n}</span><Icon className="h-6 w-6 text-[#0baa8e]" /></div><h3 className="mt-6 text-xl font-extrabold">{title}</h3><p className="mt-2 text-[#6e827d]">{body}</p></div>)}</div></section>
      </main>

      {!mobileBookingOpen && !result && (
        <button type="button" onClick={openBooking} className="booking-float fixed inset-x-4 bottom-4 z-50 flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-[#0baa8e] to-[#1fcfb8] px-5 py-4 font-extrabold text-white shadow-[0_12px_35px_rgba(6,118,99,.38)] transition active:scale-[.98] lg:hidden">
          <CalendarDays className="h-5 w-5" /> احجز موعدك الآن
        </button>
      )}

      <footer className="bg-[#0b1f1c] py-14 text-white/70"><div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-8 px-5 lg:px-10"><div className="flex items-center gap-4"><span className="grid h-20 w-20 place-items-center overflow-hidden rounded-2xl bg-white p-1"><img src={LOGO_IMAGE} alt="شعار أسناني My Teeth" className="h-full w-full object-contain" /></span><div><strong className="text-lg text-white">{catalog.site_name}</strong><p className="mt-2 max-w-md text-sm leading-6">رعاية طبية متخصصة تجمع الخبرة والتقنية والاهتمام بالتفاصيل.</p></div></div><div className="space-y-2 text-sm">{catalog.phone && <a href={`tel:${catalog.phone}`} className="flex items-center gap-2"><Phone className="h-4 w-4 text-[#1fcfb8]" /> <span dir="ltr">{catalog.phone}</span></a>}<p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-[#1fcfb8]" /> {catalog.address || "المملكة العربية السعودية"}</p></div></div><div className="mx-auto mt-10 max-w-7xl border-t border-white/10 px-5 pt-6 text-xs lg:px-10">© {new Date().getFullYear()} {catalog.site_name}. جميع الحقوق محفوظة.</div></footer>
    </div>
  );
}
