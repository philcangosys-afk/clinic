import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpLeft,
  Bell,
  Building2,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FlaskConical,
  HelpCircle,
  CreditCard,
  Database,
  Download,
  FileText,
  LayoutDashboard,
  MapPin,
  MoreHorizontal,
  Package,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  ReceiptText,
  Search,
  SlidersHorizontal,
  Settings2,
  MessageCircle,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  UserRoundPlus,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  icon: typeof LayoutDashboard;
  badge?: string;
};

type Appointment = {
  time: string;
  patient: string;
  type: string;
  doctor: string;
  color: string;
  status: string;
};

const navigation: NavItem[] = [
  { label: "الرئيسية", icon: LayoutDashboard },
  { label: "المرضى", icon: UsersRound, badge: "1,248" },
  { label: "المواعيد", icon: CalendarDays },
  { label: "الطابور", icon: Activity, badge: "12" },
  { label: "الفوترة والمدفوعات", icon: WalletCards },
  { label: "المختبر", icon: FlaskConical, badge: "4" },
  { label: "التأمين والمطالبات", icon: ShieldCheck },
  { label: "الباقات", icon: Package },
];

const appointments: Appointment[] = [
  { time: "09:30", patient: "سارة أحمد العتيبي", type: "استشارة جلدية", doctor: "د. ليان المطيري", color: "teal", status: "مؤكد" },
  { time: "10:00", patient: "عبدالله سالم القحطاني", type: "متابعة علاج", doctor: "د. عمر الحربي", color: "purple", status: "وصل" },
  { time: "10:30", patient: "نورة محمد الغامدي", type: "فحص أولي", doctor: "د. ليان المطيري", color: "amber", status: "في الانتظار" },
  { time: "11:15", patient: "خالد إبراهيم الشهري", type: "جلسة ليزر", doctor: "د. ريم الزهراني", color: "blue", status: "مؤكد" },
];

const queue = [
  { number: "A-017", patient: "سارة أ.", doctor: "د. ليان", wait: "الآن", state: "في الغرفة" },
  { number: "A-018", patient: "محمد ع.", doctor: "د. عمر", wait: "4 د", state: "التالي" },
  { number: "A-019", patient: "نورة م.", doctor: "د. ليان", wait: "11 د", state: "منتظر" },
];

const navIcons: Record<string, typeof LayoutDashboard> = {
  الرئيسية: LayoutDashboard,
  المرضى: UsersRound,
  المواعيد: CalendarDays,
  الطابور: Activity,
  "الفوترة والمدفوعات": WalletCards,
  المختبر: FlaskConical,
  "التأمين والمطالبات": ShieldCheck,
  الباقات: Package,
};

export default function Index() {
  const [activeItem, setActiveItem] = useState("الرئيسية");
  const [collapsed, setCollapsed] = useState(false);
  const [branch, setBranch] = useState("فرع الرياض - النخيل");
  const [showNotifications, setShowNotifications] = useState(false);
  const [modal, setModal] = useState<"patient" | "appointment" | "clinic" | null>(null);
  const [toast, setToast] = useState("");
  const [patientCount, setPatientCount] = useState(1248);
  const [appointmentCount, setAppointmentCount] = useState(38);
  const [recentPatient, setRecentPatient] = useState("سارة أحمد العتيبي");

  const activeIcon = navIcons[activeItem] ?? LayoutDashboard;
  const activeLabel = activeItem === "الرئيسية" ? "نظرة عامة" : activeItem;
  const dateLabel = useMemo(() => new Intl.DateTimeFormat("ar-SA", { weekday: "long", day: "numeric", month: "long" }).format(new Date(2025, 4, 18)), []);
  const openPatientForm = () => setModal("patient");
  const openAppointmentForm = () => setModal("appointment");
  const notify = (message: string) => {
    setModal(null);
    setToast(message);
    window.setTimeout(() => setToast(""), 3500);
  };
  const handlePatientCreated = (name: string) => {
    setPatientCount((count) => count + 1);
    setRecentPatient(name);
    setActiveItem("المرضى");
    notify(`تم تسجيل ملف ${name} بنجاح`);
  };
  const handleAppointmentCreated = () => {
    setAppointmentCount((count) => count + 1);
    setActiveItem("المواعيد");
    notify("تم حجز الموعد وإرسال رسالة التأكيد");
  };

  return (
    <main dir="rtl" className="min-h-screen bg-[#f6f8f8] text-[#152f33]">
      <div className="flex min-h-screen">
        <aside className={cn("hidden shrink-0 border-l border-[#dce9e7] bg-white transition-all duration-300 lg:flex lg:flex-col", collapsed ? "w-[88px]" : "w-[264px]")}>
          <div className={cn("flex h-[88px] items-center border-b border-[#edf2f1] px-5", collapsed ? "justify-center" : "justify-between")}>
            <div className={cn("flex items-center gap-3", collapsed && "justify-center")}>
              <div className="relative flex h-11 w-11 items-center justify-center rounded-[15px] bg-[#0d6f68] text-white shadow-[0_8px_20px_rgba(13,111,104,0.22)]">
                <Activity className="h-6 w-6" strokeWidth={2.5} />
                <span className="absolute bottom-1.5 left-1.5 h-1.5 w-1.5 rounded-full bg-[#f5b54b]" />
              </div>
              {!collapsed && <div><div className="text-[19px] font-bold tracking-[-0.03em] text-[#123f42]">زين كير</div><div className="text-[10px] font-semibold tracking-[0.14em] text-[#80a19e]">ZAINCARE</div></div>}
            </div>
            {!collapsed && <button aria-label="طي القائمة" onClick={() => setCollapsed(true)} className="rounded-lg p-2 text-[#8ba4a2] transition hover:bg-[#f1f7f5] hover:text-[#0d6f68]"><PanelRightClose className="h-5 w-5" /></button>}
          </div>

          {collapsed && <button aria-label="فتح القائمة" onClick={() => setCollapsed(false)} className="mx-auto mt-5 rounded-lg p-2 text-[#8ba4a2] transition hover:bg-[#f1f7f5] hover:text-[#0d6f68]"><PanelRightOpen className="h-5 w-5" /></button>}

          <div className={cn("px-3 pt-7", collapsed && "pt-5 px-2")}>
            {!collapsed && <div className="mb-3 px-3 text-[11px] font-bold tracking-[0.08em] text-[#9ab1af]">مساحة العمل</div>}
            <nav className="space-y-1.5">
              {navigation.map((item) => {
                const Icon = item.icon;
                const active = item.label === activeItem;
                return <button key={item.label} onClick={() => setActiveItem(item.label)} title={collapsed ? item.label : undefined} className={cn("group flex w-full items-center rounded-xl text-right text-[13px] font-semibold transition", collapsed ? "justify-center px-2 py-3" : "gap-3 px-3 py-3", active ? "bg-[#e6f4f1] text-[#0b716a]" : "text-[#66817f] hover:bg-[#f5f9f8] hover:text-[#244f50]")}>
                  <Icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-[#0d857b]" : "text-[#8ba6a3] group-hover:text-[#4f7b78]")} strokeWidth={active ? 2.3 : 1.9} />
                  {!collapsed && <><span className="flex-1">{item.label}</span>{item.badge && <span className={cn("rounded-md px-1.5 py-0.5 text-[10px]", active ? "bg-white text-[#0d716a]" : "bg-[#f0f5f4] text-[#91a9a6]")}>{item.badge}</span>}</>}
                </button>;
              })}
            </nav>
          </div>

          <div className={cn("mt-auto p-3", collapsed && "p-2")}>
            {!collapsed && <div className="mb-4 rounded-2xl bg-[#f1f8f6] p-4"><div className="mb-2 flex items-center gap-2 text-[#0d716a]"><Sparkles className="h-4 w-4" /><span className="text-xs font-bold">مساحة النمو</span></div><p className="text-[11px] leading-5 text-[#6f8e8a]">أكمل إعداد قنوات الواتساب لرفع معدل تذكير المرضى.</p><button onClick={() => setModal("clinic")} className="mt-3 text-[11px] font-bold text-[#0d716a]">إكمال الإعداد <ArrowUpLeft className="mr-1 inline h-3 w-3" /></button></div>}
            <button onClick={() => setActiveItem("الإعدادات")} className={cn("flex w-full items-center rounded-xl text-[#72908d] hover:bg-[#f5f9f8]", collapsed ? "justify-center p-3" : "gap-3 px-3 py-3")}><Settings2 className="h-[18px] w-[18px]" /><span className={cn("text-[13px] font-semibold", collapsed && "sr-only")}>الإعدادات</span></button>
            <button className={cn("flex w-full items-center rounded-xl text-[#72908d] hover:bg-[#f5f9f8]", collapsed ? "justify-center p-3" : "gap-3 px-3 py-3")}><HelpCircle className="h-[18px] w-[18px]" /><span className={cn("text-[13px] font-semibold", collapsed && "sr-only")}>مركز المساعدة</span></button>
          </div>
        </aside>

        <section className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex h-[88px] items-center justify-between border-b border-[#e6efed] bg-[#f6f8f8]/95 px-5 backdrop-blur-md sm:px-8 lg:px-10">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-[#0d6f68] text-white lg:hidden"><Activity className="h-5 w-5" /></div>
              <div className="hidden min-w-0 items-center gap-2 text-sm text-[#88a19e] sm:flex"><span>مساحة العمل</span><ChevronLeft className="h-4 w-4" /><span className="font-bold text-[#355b5b]">{activeLabel}</span></div>
              <div className="flex items-center gap-2 sm:hidden"><div className="text-[17px] font-bold text-[#123f42]">زين كير</div><span className="rounded-full bg-[#e6f4f1] px-2 py-1 text-[10px] font-bold text-[#0d716a]">مدير العيادة</span></div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="relative hidden h-10 items-center rounded-xl border border-[#dfebe8] bg-white px-3 sm:flex sm:w-[218px]"><Search className="ml-2 h-4 w-4 text-[#99afac]" /><input aria-label="بحث عام" className="w-full bg-transparent text-xs outline-none placeholder:text-[#a9bcba]" placeholder="ابحث في زين كير..." /></div>
              <button aria-label="البحث" className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#dfebe8] bg-white text-[#799693] sm:hidden"><Search className="h-4 w-4" /></button>
              <div className="relative">
                <button aria-label="الإشعارات" onClick={() => setShowNotifications((value) => !value)} className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-[#dfebe8] bg-white text-[#799693] transition hover:border-[#aad8d1] hover:text-[#0d716a]"><Bell className="h-[17px] w-[17px]" /><span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[#e98b66] ring-2 ring-white" /></button>
                {showNotifications && <div className="absolute left-0 top-12 z-30 w-[280px] rounded-2xl border border-[#deebe8] bg-white p-4 shadow-[0_18px_45px_rgba(29,72,72,0.13)]"><div className="mb-3 flex items-center justify-between"><span className="font-bold text-[#234b4b]">التنبيهات</span><span className="text-[10px] font-bold text-[#0d716a]">٣ جديدة</span></div><div className="space-y-3"><div className="flex gap-3 border-b border-[#eff4f3] pb-3"><div className="rounded-lg bg-[#fff1e7] p-2 text-[#df865b]"><AlertTriangle className="h-4 w-4" /></div><p className="text-[11px] leading-5 text-[#547371]">نتيجة مختبر غير طبيعية تحتاج مراجعة الطبيب.</p></div><div className="flex gap-3"><div className="rounded-lg bg-[#e8f6f2] p-2 text-[#0d857b]"><CheckCircle2 className="h-4 w-4" /></div><p className="text-[11px] leading-5 text-[#547371]">تم تأكيد موعد نورة الغامدي.</p></div></div></div>}
              </div>
              <div className="hidden h-8 w-px bg-[#dfeae8] sm:block" />
              <button className="flex items-center gap-2 rounded-xl p-1 transition hover:bg-white"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#d9eeea] text-xs font-bold text-[#0d716a]">أم</div><div className="hidden text-right sm:block"><div className="text-[12px] font-bold text-[#345a59]">أحمد المطيري</div><div className="text-[10px] text-[#92a9a6]">مالك العيادة</div></div><ChevronDown className="hidden h-4 w-4 text-[#9db2af] sm:block" /></button>
            </div>
          </header>

          <div className="mx-auto max-w-[1500px] px-5 pb-12 pt-7 sm:px-8 lg:px-10 lg:pt-9">
            {activeItem === "الرئيسية" ? <>
            <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
              <div><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#91a8a5]"><span>{dateLabel}</span><span className="h-1 w-1 rounded-full bg-[#b8c9c6]" /><span>١٨ مايو ٢٠٢٥</span></div><h1 className="text-[27px] font-bold tracking-[-0.04em] text-[#183f42] sm:text-[32px]">صباح الخير، أحمد <span className="inline-block">👋</span></h1><p className="mt-2 text-[13px] text-[#76918e]">إليك ملخص أداء عيادتك لهذا اليوم.</p></div>
              <div className="flex items-center gap-2"><div className="relative"><select aria-label="اختيار الفرع" value={branch} onChange={(event) => setBranch(event.target.value)} className="h-11 appearance-none rounded-xl border border-[#dfebe8] bg-white py-2 pl-9 pr-10 text-xs font-bold text-[#436866] outline-none transition focus:border-[#83c7bf]"><option>فرع الرياض - النخيل</option><option>فرع جدة - الروضة</option><option>فرع دبي - الخليج التجاري</option></select><Building2 className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-[#0d857b]" /><ChevronDown className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[#9ab2ae]" /></div><button onClick={openAppointmentForm} className="flex h-11 items-center gap-2 rounded-xl bg-[#0d716a] px-4 text-xs font-bold text-white shadow-[0_8px_18px_rgba(13,113,106,0.19)] transition hover:bg-[#095d58]"><Plus className="h-4 w-4" /> موعد جديد</button></div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
              <MetricCard label="مواعيد اليوم" value={toArabicNumber(appointmentCount)} change="١٢٪" trend="up" icon={CalendarClock} tone="teal" detail="مقابل ٣٤ أمس" />
              <MetricCard label="في الطابور الآن" value="١٢" change="نشط" trend="neutral" icon={Clock3} tone="amber" detail="متوسط الانتظار ١٤ د" />
              <MetricCard label="إيرادات اليوم" value="١٢٬٤٨٠ ر.س" change="٨٪" trend="up" icon={CircleDollarSign} tone="blue" detail="من ٢٩ عملية دفع" />
              <MetricCard label="المطالبات المعلقة" value="٠٧" change="تحتاج متابعة" trend="alert" icon={ShieldCheck} tone="purple" detail="بقيمة ٤٬٣٢٠ ر.س" />
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.85fr)]">
              <section className="min-w-0 rounded-[22px] border border-[#e3eeeb] bg-white p-5 shadow-[0_4px_18px_rgba(30,73,72,0.025)] sm:p-6">
                <div className="mb-5 flex items-center justify-between"><div><h2 className="text-[16px] font-bold text-[#234b4b]">مواعيد اليوم</h2><p className="mt-1 text-[11px] text-[#96aaa8]">الأحد، ١٨ مايو · {branch}</p></div><button onClick={() => setActiveItem("المواعيد")} className="flex items-center gap-1 text-[11px] font-bold text-[#0d716a]">عرض التقويم <ChevronLeft className="h-3.5 w-3.5" /></button></div>
                <div className="mb-4 flex items-center justify-between rounded-xl bg-[#f7faf9] px-3 py-2"><div className="flex items-center gap-2 text-[11px] font-semibold text-[#70908c]"><span className="h-2 w-2 rounded-full bg-[#0d857b]" /> اليوم <span className="text-[#b0bfbd]">|</span> ٣٨ موعدًا</div><div className="flex items-center gap-1"><button aria-label="اليوم السابق" className="rounded-md p-1 text-[#9ab0ad] hover:bg-white"><ChevronRight className="h-4 w-4" /></button><button aria-label="اليوم التالي" className="rounded-md p-1 text-[#9ab0ad] hover:bg-white"><ChevronLeft className="h-4 w-4" /></button></div></div>
                <div className="space-y-2">
                  {appointments.map((appointment) => <AppointmentRow key={appointment.time + appointment.patient} appointment={appointment} />)}
                </div>
                <button onClick={() => setActiveItem("المواعيد")} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#cfe2df] py-3 text-[11px] font-bold text-[#6f9490] transition hover:border-[#8ccac2] hover:bg-[#f5fbf9] hover:text-[#0d716a]"><CalendarDays className="h-4 w-4" /> فتح جدول المواعيد الكامل</button>
              </section>

              <section className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 shadow-[0_4px_18px_rgba(30,73,72,0.025)] sm:p-6">
                <div className="mb-5 flex items-start justify-between"><div><div className="flex items-center gap-2"><h2 className="text-[16px] font-bold text-[#234b4b]">الطابور المباشر</h2><span className="flex h-5 items-center rounded-full bg-[#e6f6f1] px-2 text-[10px] font-bold text-[#0d857b]">مباشر</span></div><p className="mt-1 text-[11px] text-[#96aaa8]">تحديث تلقائي كل ٣٠ ثانية</p></div><button onClick={() => setActiveItem("الطابور")} className="rounded-lg p-1.5 text-[#9ab0ad] hover:bg-[#f3f8f7] hover:text-[#0d716a]"><MoreHorizontal className="h-5 w-5" /></button></div>
                <div className="mb-5 flex items-center gap-4 rounded-2xl bg-[#f0f8f6] p-4"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-[21px] font-bold text-[#0d716a] shadow-sm">A-017</div><div className="min-w-0 flex-1"><div className="text-[12px] font-bold text-[#2d5958]">المريض الحالي</div><div className="mt-1 flex items-center gap-1 text-[11px] text-[#76938f]"><Stethoscope className="h-3.5 w-3.5" /> د. ليان المطيري · غرفة ٣</div></div><div className="text-left"><div className="text-[10px] text-[#90aaa5]">الحالة</div><div className="mt-1 text-[11px] font-bold text-[#0d857b]">في الغرفة</div></div></div>
                <div className="mb-3 flex items-center justify-between text-[11px] font-bold text-[#89a4a0]"><span>التالي في الطابور</span><span>وقت الانتظار المتوقع</span></div>
                <div className="space-y-2">{queue.slice(1).map((item) => <div key={item.number} className="flex items-center gap-3 rounded-xl border border-[#edf3f1] px-3 py-3"><div className="flex h-9 w-10 items-center justify-center rounded-lg bg-[#f7f9f8] text-[11px] font-bold text-[#4d7370]">{item.number}</div><div className="flex-1"><div className="text-[12px] font-bold text-[#426765]">{item.patient}</div><div className="mt-0.5 text-[10px] text-[#9bb0ad]">{item.doctor}</div></div><div className="text-left text-[11px] font-bold text-[#779490]">{item.wait}</div></div>)}</div>
                <button onClick={() => setActiveItem("الطابور")} className="mt-4 w-full rounded-xl bg-[#0d716a] py-3 text-[11px] font-bold text-white transition hover:bg-[#095d58]">إدارة الطابور</button>
              </section>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)]">
              <section className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 shadow-[0_4px_18px_rgba(30,73,72,0.025)] sm:p-6"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-[16px] font-bold text-[#234b4b]">أداء العيادة</h2><p className="mt-1 text-[11px] text-[#96aaa8]">مقارنة آخر ٧ أيام</p></div><button className="flex items-center gap-1 rounded-lg bg-[#f5f9f8] px-3 py-2 text-[10px] font-bold text-[#789794]">هذا الأسبوع <ChevronDown className="h-3 w-3" /></button></div><div className="flex h-[155px] items-end gap-2 border-b border-[#edf3f1] px-2 pb-2 sm:gap-4"><ChartBar day="السبت" height="52%" value="١٠٫٢ك" /><ChartBar day="الأحد" height="68%" value="١٢٫٤ك" active /><ChartBar day="الإثنين" height="44%" value="٨٫٧ك" /><ChartBar day="الثلاثاء" height="78%" value="١٤٫١ك" /><ChartBar day="الأربعاء" height="61%" value="١١٫٨ك" /><ChartBar day="الخميس" height="88%" value="١٦٫٣ك" /><ChartBar day="الجمعة" height="35%" value="٦٫٢ك" /></div><div className="mt-4 flex items-center justify-between text-[11px] text-[#8ea7a3]"><span>إجمالي الإيرادات</span><span className="font-bold text-[#2c6260]">٧٩٬٧٠٠ ر.س <span className="mr-1 text-[#0d857b]">↑ ١٨٪</span></span></div></section>
              <section className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 shadow-[0_4px_18px_rgba(30,73,72,0.025)] sm:p-6"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-[16px] font-bold text-[#234b4b]">إجراءات سريعة</h2><p className="mt-1 text-[11px] text-[#96aaa8]">أنجز مهامك اليومية بسرعة</p></div><Sparkles className="h-5 w-5 text-[#e5b15a]" /></div><div className="grid grid-cols-2 gap-3"><QuickAction icon={UserRoundPlus} label="تسجيل مريض" tone="teal" onClick={openPatientForm} /><QuickAction icon={CalendarClock} label="حجز موعد" tone="blue" onClick={openAppointmentForm} /><QuickAction icon={ReceiptText} label="إنشاء فاتورة" tone="amber" onClick={() => setActiveItem("الفوترة والمدفوعات")} /><QuickAction icon={FlaskConical} label="نتائج المختبر" tone="purple" onClick={() => setActiveItem("المختبر")} /><QuickAction icon={Building2} label="نوع العيادة" tone="teal" onClick={() => setModal("clinic")} /></div></section>
            </div>

            <div className="mt-6 flex flex-col items-start justify-between gap-3 rounded-[20px] bg-[#e8f5f1] px-5 py-4 sm:flex-row sm:items-center sm:px-6"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-[#0d716a]"><MapPin className="h-4 w-4" /></div><div><p className="text-[12px] font-bold text-[#2d625e]">أنت تعمل الآن من {branch}</p><p className="mt-1 text-[10px] text-[#6f9690]">آخر مزامنة للبيانات: منذ دقيقة واحدة</p></div></div><button className="flex items-center gap-1 text-[11px] font-bold text-[#0d716a]">تغيير الفرع <ArrowUpLeft className="h-3.5 w-3.5" /></button></div>
            </> : <ModuleView activeItem={activeItem} branch={branch} onPatient={openPatientForm} onAppointment={openAppointmentForm} onClinic={() => setModal("clinic")} newPatient={recentPatient} patientCount={patientCount} />}
          </div>
        </section>
      </div>
      {toast && <div role="status" className="fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-2xl bg-[#163f42] px-4 py-3 text-[12px] font-bold text-white shadow-[0_14px_35px_rgba(22,63,66,0.24)]"><CheckCircle2 className="h-4 w-4 text-[#72d2bb]" />{toast}</div>}
      {modal === "patient" && <PatientModal onClose={() => setModal(null)} onCreated={handlePatientCreated} />}
      {modal === "appointment" && <AppointmentModal onClose={() => setModal(null)} onCreated={handleAppointmentCreated} />}
      {modal === "clinic" && <ClinicProfileModal onClose={() => setModal(null)} onSaved={(profile) => notify(`تم تفعيل ملف ${profile} وتحديث الوحدات`)} />}
    </main>
  );
}

type ModuleViewProps = { activeItem: string; branch: string; onPatient: () => void; onAppointment: () => void; onClinic: () => void; newPatient: string; patientCount: number };

function ModuleView({ activeItem, branch, onPatient, onAppointment, onClinic, newPatient, patientCount }: ModuleViewProps) {
  if (activeItem === "المرضى") return <PatientsView branch={branch} onAdd={onPatient} newPatient={newPatient} patientCount={patientCount} />;
  if (activeItem === "المواعيد") return <AppointmentsView branch={branch} onBook={onAppointment} />;
  if (activeItem === "الطابور") return <QueueView branch={branch} />;
  if (activeItem === "الفوترة والمدفوعات") return <FinanceView branch={branch} />;
  if (activeItem === "المختبر") return <LabView branch={branch} />;
  if (activeItem === "التأمين والمطالبات") return <InsuranceView branch={branch} />;
  if (activeItem === "الباقات") return <PackagesView branch={branch} />;
  return <EditableSettingsView branch={branch} onClinic={onClinic} />;
}

function ViewHeader({ eyebrow, title, description, action, icon: Icon = LayoutDashboard, onAction }: { eyebrow: string; title: string; description: string; action: string; icon?: typeof LayoutDashboard; onAction?: () => void }) {
  return <div className="mb-7 flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><div className="mb-2 flex items-center gap-2 text-[11px] font-bold text-[#92aaa7]"><Icon className="h-4 w-4 text-[#0d857b]" /> {eyebrow}</div><h1 className="text-[28px] font-bold tracking-[-0.04em] text-[#183f42] sm:text-[32px]">{title}</h1><p className="mt-2 text-[13px] text-[#76918e]">{description}</p></div><button onClick={onAction} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0d716a] px-4 text-xs font-bold text-white shadow-[0_8px_18px_rgba(13,113,106,0.19)] transition hover:bg-[#095d58]"><Plus className="h-4 w-4" /> {action}</button></div>;
}

function SummaryCards({ items }: { items: { label: string; value: string; note: string; tone: string }[] }) {
  return <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">{items.map((item) => <div key={item.label} className="rounded-[18px] border border-[#e3eeeb] bg-white p-4 shadow-[0_4px_18px_rgba(30,73,72,0.025)]"><div className={cn("mb-3 h-1 w-8 rounded-full", item.tone)} /><div className="text-[11px] font-semibold text-[#8ba4a1]">{item.label}</div><div className="mt-1 text-[23px] font-bold tracking-[-0.04em] text-[#234b4b]">{item.value}</div><div className="mt-1 text-[10px] text-[#9db1ae]">{item.note}</div></div>)}</div>;
}

function StatusPill({ children, tone = "teal" }: { children: string; tone?: "teal" | "amber" | "purple" | "red" | "blue" }) {
  const tones = { teal: "bg-[#e8f7f1] text-[#3d9573]", amber: "bg-[#fff5e5] text-[#c5872e]", purple: "bg-[#f2edfb] text-[#805fb7]", red: "bg-[#fff0eb] text-[#d77e65]", blue: "bg-[#eaf3fb] text-[#4284b9]" };
  return <span className={cn("inline-flex rounded-md px-2 py-1 text-[10px] font-bold", tones[tone])}>{children}</span>;
}

function PatientsView({ branch, onAdd, newPatient, patientCount }: { branch: string; onAdd: () => void; newPatient: string; patientCount: number }) {
  const [query, setQuery] = useState("");
  const patients = [
    ["سارة أحمد العتيبي", "MRN-1024", "05 5123 8841", "اليوم", "مؤمّن"],
    ["عبدالله سالم القحطاني", "MRN-1023", "05 4781 2290", "اليوم", "نقدي"],
    ["نورة محمد الغامدي", "MRN-1022", "05 9012 3367", "أمس", "مؤمّن"],
    ["خالد إبراهيم الشهري", "MRN-1021", "05 6634 1029", "١٥ مايو", "باقة"],
    ["ريم فهد السبيعي", "MRN-1020", "05 7201 7782", "١٤ مايو", "مؤمّن"],
    [newPatient, "MRN-NEW", "05 0000 0000", "الآن", "نقدي"],
  ];
  const filtered = patients.filter((patient) => patient.join(" ").includes(query));
  return <><ViewHeader eyebrow="إدارة المرضى" title="سجل المرضى" description={`${branch} · بحث آمن ببيانات المرضى والهوية الوطنية`} action="تسجيل مريض" icon={UsersRound} onAction={onAdd} /><SummaryCards items={[{ label: "إجمالي المرضى", value: toArabicNumber(patientCount), note: "+ ٣٢ هذا الشهر", tone: "bg-[#0d857b]" }, { label: "زيارات اليوم", value: "٣٨", note: "٢٨ مكتملة", tone: "bg-[#5a91bf]" }, { label: "ملفات تحتاج إكمال", value: "٢١", note: "بيانات التسجيل ناقصة", tone: "bg-[#e5b15a]" }, { label: "مواعيد متابعة", value: "١٠٦", note: "خلال ١٤ يومًا", tone: "bg-[#8968bd]" }]} /><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 shadow-[0_4px_18px_rgba(30,73,72,0.025)] sm:p-6"><div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-[16px] font-bold text-[#234b4b]">كل المرضى</h2><p className="mt-1 text-[11px] text-[#96aaa8]">البيانات محمية وتظهر حسب صلاحيتك</p></div><div className="flex gap-2"><div className="flex h-10 min-w-0 flex-1 items-center rounded-xl border border-[#dfebe8] px-3 sm:w-[230px]"><Search className="ml-2 h-4 w-4 shrink-0 text-[#9bb1ae]" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="w-full bg-transparent text-xs outline-none placeholder:text-[#a9bcba]" placeholder="ابحث بالاسم أو MRN..." /></div><button className="flex h-10 items-center gap-2 rounded-xl border border-[#dfebe8] px-3 text-[11px] font-bold text-[#6d8b88]"><SlidersHorizontal className="h-4 w-4" /> تصفية</button></div></div><div className="overflow-x-auto"><table className="w-full min-w-[650px] text-right"><thead><tr className="border-b border-[#edf3f1] text-[10px] font-bold text-[#96aaa8]"><th className="pb-3 pr-2">المريض</th><th className="pb-3">رقم الملف</th><th className="pb-3">الجوال</th><th className="pb-3">آخر زيارة</th><th className="pb-3">طريقة الدفع</th><th className="pb-3">الإجراء</th></tr></thead><tbody>{filtered.map((patient) => <tr key={patient[1]} className="group border-b border-[#f0f4f3] text-[11px] last:border-0 hover:bg-[#fbfefd]"><td className="py-4 pr-2"><div className="flex items-center gap-3"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#e4f5f1] text-[10px] font-bold text-[#0d857b]">{patient[0].split(" ").slice(0, 2).map((word) => word[0]).join("")}</div><span className="font-bold text-[#3c6260]">{patient[0]}</span></div></td><td className="py-4 font-mono text-[10px] text-[#789693]" dir="ltr">{patient[1]}</td><td className="py-4 text-[#789693]" dir="ltr">{patient[2]}</td><td className="py-4 text-[#789693]">{patient[3]}</td><td className="py-4"><StatusPill tone={patient[4] === "مؤمّن" ? "blue" : patient[4] === "باقة" ? "purple" : "teal"}>{patient[4]}</StatusPill></td><td className="py-4"><button aria-label={`عرض ${patient[0]}`} className="rounded-lg p-2 text-[#a3b8b5] transition hover:bg-[#eaf6f2] hover:text-[#0d716a]"><ChevronLeft className="h-4 w-4" /></button></td></tr>)}</tbody></table>{filtered.length === 0 && <div className="py-12 text-center text-xs text-[#91a9a6]">لا توجد نتائج مطابقة للبحث.</div>}</div></div></>;
}

function AppointmentsView({ branch, onBook }: { branch: string; onBook: () => void }) {
  const [selectedDay, setSelectedDay] = useState("الأحد");
  const days = ["السبت", "الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس"];
  return <><ViewHeader eyebrow="الجدولة والحجز" title="مواعيد العيادة" description={`${branch} · إدارة المواعيد والانتظار والتذكيرات`} action="حجز موعد" icon={CalendarDays} onAction={onBook} /><div className="mb-6 flex gap-2 overflow-x-auto pb-1">{days.map((day, index) => <button key={day} onClick={() => setSelectedDay(day)} className={cn("min-w-[92px] rounded-xl border px-4 py-3 text-right transition", selectedDay === day ? "border-[#0d857b] bg-[#e6f4f1] text-[#0d716a]" : "border-[#e3eeeb] bg-white text-[#769390] hover:border-[#acd8d2]")}><div className="text-[10px] font-semibold">{day}</div><div className="mt-1 text-[16px] font-bold">{17 + index}</div></button>)}</div><div className="grid gap-6 xl:grid-cols-[1fr_320px]"><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-[16px] font-bold text-[#234b4b]">جدول {selectedDay}</h2><p className="mt-1 text-[11px] text-[#96aaa8]">٤ أطباء · ٣٨ موعدًا</p></div><div className="flex gap-2"><button className="rounded-lg bg-[#f5f9f8] p-2 text-[#789794]"><ChevronRight className="h-4 w-4" /></button><button className="rounded-lg bg-[#f5f9f8] p-2 text-[#789794]"><ChevronLeft className="h-4 w-4" /></button></div></div><div className="space-y-2">{appointments.map((appointment) => <AppointmentRow key={appointment.time + appointment.patient} appointment={appointment} />)}</div></div><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><h2 className="text-[16px] font-bold text-[#234b4b]">قواعد الحجز</h2><p className="mt-1 text-[11px] text-[#96aaa8]">إعدادات الفرع الحالية</p><div className="mt-5 space-y-4"><SettingRow label="أقل مدة قبل الحجز" value="ساعتان" /><SettingRow label="نافذة الإلغاء" value="٢٤ ساعة" /><SettingRow label="التذكير" value="واتساب + SMS" /><SettingRow label="الإجازة الأسبوعية" value="الجمعة" /></div><div className="mt-6 rounded-xl bg-[#f1f8f6] p-3 text-[11px] leading-5 text-[#6b8d89]">يتم تحديث التوافر تلقائيًا عند تغيير جدول الطبيب أو إضافة فترة صلاة.</div></div></div></>;
}

function QueueView({ branch }: { branch: string }) {
  const [activeNumber, setActiveNumber] = useState("A-017");
  const tickets = [{ number: "A-017", name: "سارة أحمد", doctor: "د. ليان المطيري", room: "غرفة ٣", wait: "الآن", tone: "teal" as const }, { number: "A-018", name: "عبدالله سالم", doctor: "د. عمر الحربي", room: "غرفة ٢", wait: "٤ دقائق", tone: "purple" as const }, { number: "A-019", name: "نورة محمد", doctor: "د. ليان المطيري", room: "غرفة ٣", wait: "١١ دقيقة", tone: "amber" as const }, { number: "A-020", name: "خالد إبراهيم", doctor: "د. ريم الزهراني", room: "غرفة ١", wait: "١٨ دقيقة", tone: "blue" as const }];
  const current = tickets.find((ticket) => ticket.number === activeNumber) ?? tickets[0];
  return <><ViewHeader eyebrow="الاستقبال والطابور" title="الطابور المباشر" description={`${branch} · متابعة المراجعين لحظة بلحظة`} action="تسجيل حضور" icon={Activity} /><div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]"><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-[16px] font-bold text-[#234b4b]">لوحة التشغيل</h2><p className="mt-1 text-[11px] text-[#96aaa8]">آخر تحديث قبل ١٢ ثانية</p></div><StatusPill>مباشر</StatusPill></div><div className="mb-5 rounded-2xl bg-[#eaf6f2] p-5 text-center"><div className="text-[11px] font-bold text-[#6c918c]">الرقم الحالي</div><div className="my-2 text-[43px] font-bold tracking-[-0.05em] text-[#0d716a]" dir="ltr">{current.number}</div><div className="text-[12px] font-bold text-[#426765]">{current.name} · {current.room}</div><div className="mt-1 text-[10px] text-[#7b9a96]">{current.doctor}</div></div><div className="flex gap-2"><button onClick={() => setActiveNumber(tickets[Math.min(tickets.findIndex((ticket) => ticket.number === activeNumber) + 1, tickets.length - 1)].number)} className="flex-1 rounded-xl bg-[#0d716a] py-3 text-[11px] font-bold text-white">استدعاء التالي</button><button className="rounded-xl border border-[#dfece9] px-4 text-[11px] font-bold text-[#6e8e8a]">إعادة النداء</button></div></div><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-[16px] font-bold text-[#234b4b]">قائمة الانتظار</h2><p className="mt-1 text-[11px] text-[#96aaa8]">{tickets.length} مراجعين نشطين</p></div><button className="rounded-lg p-2 text-[#99afac] hover:bg-[#f3f8f7]"><MoreHorizontal className="h-5 w-5" /></button></div><div className="space-y-2">{tickets.map((ticket) => <button key={ticket.number} onClick={() => setActiveNumber(ticket.number)} className={cn("flex w-full items-center gap-3 rounded-xl border p-3 text-right transition", activeNumber === ticket.number ? "border-[#a8d8d1] bg-[#f3faf8]" : "border-[#edf3f1] hover:border-[#c9e3df]")}><div className={cn("flex h-9 w-11 items-center justify-center rounded-lg text-[10px] font-bold", ticket.tone === "teal" ? "bg-[#dff3ee] text-[#0d857b]" : ticket.tone === "purple" ? "bg-[#f0eafb] text-[#8061bb]" : ticket.tone === "amber" ? "bg-[#fff2dc] text-[#bd812b]" : "bg-[#e8f2fb] text-[#4283b9]")} dir="ltr">{ticket.number}</div><div className="min-w-0 flex-1"><div className="truncate text-[11px] font-bold text-[#426765]">{ticket.name}</div><div className="mt-1 truncate text-[10px] text-[#9aafac]">{ticket.doctor}</div></div><span className="text-[10px] font-bold text-[#7b9793]">{ticket.wait}</span></button>)}</div></div></div></>;
}

function FinanceView({ branch }: { branch: string }) {
  const invoices = [["INV-RYD-1048", "سارة أحمد العتيبي", "كشف جلدية", "٢٣٠ ر.س", "مدفوعة", "teal"], ["INV-RYD-1047", "عبدالله سالم القحطاني", "متابعة علاج", "١٧٢٫٥٠ ر.س", "مدفوعة", "teal"], ["INV-RYD-1046", "نورة محمد الغامدي", "فحص أولي", "١١٥ ر.س", "بانتظار التأمين", "amber"], ["INV-RYD-1045", "خالد إبراهيم الشهري", "باقة ليزر", "١٬٨٠٠ ر.س", "مدفوعة", "teal"]];
  return <><ViewHeader eyebrow="المالية والتحصيل" title="الفوترة والمدفوعات" description={`${branch} · فواتير متوافقة مع ضريبة القيمة المضافة`} action="إنشاء فاتورة" icon={WalletCards} /><SummaryCards items={[{ label: "إيرادات اليوم", value: "١٢٬٤٨٠", note: "ر.س · ↑ ٨٪", tone: "bg-[#0d857b]" }, { label: "الفواتير المدفوعة", value: "٢٩", note: "من أصل ٣٤ فاتورة", tone: "bg-[#5a91bf]" }, { label: "المبالغ المعلقة", value: "٤٬٣٢٠", note: "ر.س · ٧ فواتير", tone: "bg-[#e5b15a]" }, { label: "إغلاق الصندوق", value: "لم يُغلق", note: "آخر إغلاق أمس ٩:٤٥م", tone: "bg-[#8968bd]" }]} /><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-[16px] font-bold text-[#234b4b]">آخر الفواتير</h2><p className="mt-1 text-[11px] text-[#96aaa8]">كل العمليات المالية مسجلة في سجل التدقيق</p></div><button className="flex items-center gap-2 rounded-xl border border-[#dfebe8] px-3 py-2 text-[11px] font-bold text-[#6d8b88]"><Download className="h-4 w-4" /> تصدير التقرير</button></div><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-right"><thead><tr className="border-b border-[#edf3f1] text-[10px] font-bold text-[#96aaa8]"><th className="pb-3 pr-2">رقم الفاتورة</th><th className="pb-3">المريض</th><th className="pb-3">الخدمة</th><th className="pb-3">الإجمالي</th><th className="pb-3">الحالة</th><th className="pb-3">الإجراء</th></tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice[0]} className="border-b border-[#f0f4f3] text-[11px] last:border-0"><td className="py-4 pr-2 font-mono text-[10px] text-[#789693]" dir="ltr">{invoice[0]}</td><td className="py-4 font-bold text-[#3c6260]">{invoice[1]}</td><td className="py-4 text-[#789693]">{invoice[2]}</td><td className="py-4 font-bold text-[#426765]">{invoice[3]}</td><td className="py-4"><StatusPill tone={invoice[5] as "teal" | "amber"}>{invoice[4]}</StatusPill></td><td className="py-4"><button className="rounded-lg p-2 text-[#a3b8b5] hover:bg-[#eaf6f2] hover:text-[#0d716a]"><ChevronLeft className="h-4 w-4" /></button></td></tr>)}</tbody></table></div></div></>;
}

function LabView({ branch }: { branch: string }) {
  const [tab, setTab] = useState("قيد المراجعة");
  const results = [{ patient: "نورة محمد الغامدي", test: "تحليل وظائف الغدة الدرقية", doctor: "د. ليان المطيري", time: "منذ ١٢ دقيقة", status: "نتيجة غير طبيعية", tone: "red" as const }, { patient: "خالد إبراهيم الشهري", test: "تحليل الدم الشامل CBC", doctor: "د. ريم الزهراني", time: "منذ ٤٥ دقيقة", status: "بانتظار التحقق", tone: "amber" as const }, { patient: "سارة أحمد العتيبي", test: "فيتامين د", doctor: "د. ليان المطيري", time: "منذ ساعة", status: "جاهز للتسليم", tone: "teal" as const }];
  return <><ViewHeader eyebrow="المختبر والنتائج" title="لوحة المختبر" description={`${branch} · العينات والنتائج الطبية في مكان واحد`} action="طلب تحليل" icon={FlaskConical} /><SummaryCards items={[{ label: "عينات اليوم", value: "٢٤", note: "٨ قيد المعالجة", tone: "bg-[#0d857b]" }, { label: "بانتظار التحقق", value: "٠٤", note: "تحتاج توقيع المراجع", tone: "bg-[#e5b15a]" }, { label: "نتائج غير طبيعية", value: "٠٢", note: "تنبيه الطبيب مُفعّل", tone: "bg-[#d77e65]" }, { label: "متوسط الإنجاز", value: "٤٥ د", note: "أفضل من أمس بـ ١٢٪", tone: "bg-[#5a91bf]" }]} /><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><div className="mb-5 flex gap-2 border-b border-[#edf3f1] pb-3">{["قيد المراجعة", "كل النتائج", "العينات"].map((item) => <button key={item} onClick={() => setTab(item)} className={cn("rounded-lg px-3 py-2 text-[11px] font-bold", tab === item ? "bg-[#e6f4f1] text-[#0d716a]" : "text-[#8ba5a1] hover:bg-[#f5f9f8]")}>{item}</button>)}</div><div className="space-y-3">{results.map((result) => <div key={result.patient + result.test} className="flex flex-col gap-3 rounded-xl border border-[#edf3f1] p-4 transition hover:border-[#c7e2de] sm:flex-row sm:items-center"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#eaf3fb] text-[#4284b9]"><FlaskConical className="h-4 w-4" /></div><div className="min-w-0 flex-1"><div className="text-[12px] font-bold text-[#3d6462]">{result.test}</div><div className="mt-1 text-[10px] text-[#9aafac]">{result.patient} · {result.doctor} · {result.time}</div></div><StatusPill tone={result.tone}>{result.status}</StatusPill><button className="rounded-xl border border-[#dfebe8] px-3 py-2 text-[10px] font-bold text-[#6d8b88]">فتح النتيجة</button></div>)}</div></div></>;
}

function InsuranceView({ branch }: { branch: string }) {
  const claims = [["CLM-2025-0184", "نورة محمد الغامدي", "بوبا العربية", "٢٬٤٥٠ ر.س", "بانتظار الرد", "amber"], ["CLM-2025-0183", "عبدالله سالم القحطاني", "التعاونية", "٨٧٥ ر.س", "مقبولة", "teal"], ["CLM-2025-0182", "سارة أحمد العتيبي", "ملاذ للتأمين", "١٬٢٥٠ ر.س", "تحتاج تصحيح", "red"]];
  return <><ViewHeader eyebrow="التأمين والمطالبات" title="مركز المطالبات" description={`${branch} · متابعة الأهلية والموافقات والتسويات`} action="فحص أهلية" icon={ShieldCheck} /><SummaryCards items={[{ label: "مطالبات هذا الشهر", value: "١٨٤", note: "↑ ١٢٪ عن الشهر السابق", tone: "bg-[#0d857b]" }, { label: "نسبة القبول الأولي", value: "٩٢٪", note: "أعلى من متوسط السوق", tone: "bg-[#5a91bf]" }, { label: "تحتاج متابعة", value: "٠٧", note: "بما فيها ٢ مرفوضة", tone: "bg-[#e5b15a]" }, { label: "متوسط التحصيل", value: "١٢٫٤ يوم", note: "من تاريخ الإرسال", tone: "bg-[#8968bd]" }]} /><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-[16px] font-bold text-[#234b4b]">حالات المطالبات</h2><p className="mt-1 text-[11px] text-[#96aaa8]">NPHIES-ready · آخر مزامنة منذ ٦ دقائق</p></div><button className="flex items-center gap-2 rounded-xl border border-[#dfebe8] px-3 py-2 text-[11px] font-bold text-[#6d8b88]"><Download className="h-4 w-4" /> تقرير الرفض</button></div><div className="overflow-x-auto"><table className="w-full min-w-[690px] text-right"><thead><tr className="border-b border-[#edf3f1] text-[10px] font-bold text-[#96aaa8]"><th className="pb-3 pr-2">رقم المطالبة</th><th className="pb-3">المريض</th><th className="pb-3">شركة التأمين</th><th className="pb-3">القيمة</th><th className="pb-3">الحالة</th><th className="pb-3">الإجراء</th></tr></thead><tbody>{claims.map((claim) => <tr key={claim[0]} className="border-b border-[#f0f4f3] text-[11px] last:border-0"><td className="py-4 pr-2 font-mono text-[10px] text-[#789693]" dir="ltr">{claim[0]}</td><td className="py-4 font-bold text-[#3c6260]">{claim[1]}</td><td className="py-4 text-[#789693]">{claim[2]}</td><td className="py-4 font-bold text-[#426765]">{claim[3]}</td><td className="py-4"><StatusPill tone={claim[5] as "teal" | "amber" | "red"}>{claim[4]}</StatusPill></td><td className="py-4"><button className="rounded-lg p-2 text-[#a3b8b5] hover:bg-[#eaf6f2] hover:text-[#0d716a]"><ChevronLeft className="h-4 w-4" /></button></td></tr>)}</tbody></table></div></div></>;
}

function PackagesView({ branch }: { branch: string }) {
  const packages = [{ name: "إشراقة البشرة", description: "٤ جلسات تنظيف وعناية", price: "٨٥٠ ر.س", used: "٢ / ٤", progress: "50%", tone: "teal" }, { name: "باقة الليزر الكاملة", description: "٦ جلسات · جميع المناطق", price: "١٬٨٠٠ ر.س", used: "٣ / ٦", progress: "50%", tone: "purple" }, { name: "متابعة الأطفال", description: "٥ زيارات طب أطفال", price: "٦٠٠ ر.س", used: "١ / ٥", progress: "20%", tone: "amber" }];
  return <><ViewHeader eyebrow="الباقات والاشتراكات" title="باقات العلاج" description={`${branch} · بيع الباقات ومتابعة الجلسات المتبقية`} action="إنشاء باقة" icon={Package} /><div className="mb-6 grid gap-4 md:grid-cols-3">{packages.map((item) => <div key={item.name} className="rounded-[20px] border border-[#e3eeeb] bg-white p-5 shadow-[0_4px_18px_rgba(30,73,72,0.025)]"><div className="mb-4 flex items-start justify-between"><div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", item.tone === "teal" ? "bg-[#e4f5f1] text-[#0d857b]" : item.tone === "purple" ? "bg-[#f2edfb] text-[#8565bd]" : "bg-[#fff3df] text-[#bd812b]")}><Package className="h-5 w-5" /></div><button className="rounded-lg p-1 text-[#a5b9b6] hover:bg-[#f3f8f7]"><MoreHorizontal className="h-5 w-5" /></button></div><h2 className="text-[15px] font-bold text-[#2f5a59]">{item.name}</h2><p className="mt-1 text-[11px] text-[#94aaa7]">{item.description}</p><div className="mt-5 flex items-end justify-between"><span className="text-[18px] font-bold text-[#234b4b]">{item.price}</span><span className="text-[11px] font-bold text-[#7e9894]">{item.used}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-[#edf3f1]"><div className={cn("h-full rounded-full", item.tone === "teal" ? "bg-[#0d857b]" : item.tone === "purple" ? "bg-[#8565bd]" : "bg-[#e5b15a]")} style={{ width: item.progress }} /></div><button className="mt-4 flex w-full items-center justify-center gap-1 rounded-xl border border-[#dcebe8] py-2.5 text-[10px] font-bold text-[#6d8b88]">عرض المشتركين <ChevronLeft className="h-3.5 w-3.5" /></button></div>)}</div><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-[16px] font-bold text-[#234b4b]">آخر عمليات الاستخدام</h2><p className="mt-1 text-[11px] text-[#96aaa8]">كل جلسة مرتبطة بموعد وفاتورة</p></div><StatusPill tone="purple">١٢٣ جلسة هذا الشهر</StatusPill></div><div className="space-y-2"><UsageRow patient="سارة أحمد العتيبي" packageName="إشراقة البشرة" service="جلسة تنظيف" date="اليوم، ٠٩:٣٠" /><UsageRow patient="خالد إبراهيم الشهري" packageName="باقة الليزر الكاملة" service="جلسة ليزر" date="أمس، ١٧:٠٠" /><UsageRow patient="ريم فهد السبيعي" packageName="متابعة الأطفال" service="زيارة متابعة" date="أمس، ١٤:٣٠" /></div></div></>;
}

type LocalClinicSettings = {
  nameAr: string;
  nameEn: string;
  vatNumber: string;
  city: string;
  phone: string;
  email: string;
  openingTime: string;
  closingTime: string;
  prayerBreak: string;
  whatsappProvider: string;
  whatsappSender: string;
  reminder24h: boolean;
  reminder1h: boolean;
  queueAlerts: boolean;
  mada: boolean;
  applePay: boolean;
  cash: boolean;
  insurance: boolean;
  vatEnabled: boolean;
  twoFactor: boolean;
  auditExports: boolean;
  sessionTimeout: string;
};

const defaultLocalClinicSettings: LocalClinicSettings = {
  nameAr: "مجمع زين الطبي",
  nameEn: "Zain Medical Center",
  vatNumber: "310123456700003",
  city: "الرياض، المملكة العربية السعودية",
  phone: "+966 11 245 8800",
  email: "hello@zainmedical.sa",
  openingTime: "09:00",
  closingTime: "22:00",
  prayerBreak: "13:00 - 13:45",
  whatsappProvider: "Meta Cloud API",
  whatsappSender: "+966 55 420 1188",
  reminder24h: true,
  reminder1h: true,
  queueAlerts: true,
  mada: true,
  applePay: true,
  cash: true,
  insurance: true,
  vatEnabled: true,
  twoFactor: true,
  auditExports: true,
  sessionTimeout: "30 دقيقة",
};

const localSettingsTabs = [
  ["profile", "ملف المنشأة", Building2],
  ["users", "المستخدمون والصلاحيات", UsersRound],
  ["hours", "أوقات العمل", CalendarClock],
  ["notifications", "الإشعارات والواتساب", MessageCircle],
  ["payments", "الدفع والفوترة", CreditCard],
  ["security", "الأمان والخصوصية", LockKeyhole],
] as const;

function EditableSettingsView({ branch, onClinic }: { branch: string; onClinic: () => void }) {
  const [tab, setTab] = useState<(typeof localSettingsTabs)[number][0]>("profile");
  const [settings, setSettings] = useState<LocalClinicSettings>(() => {
    if (typeof window === "undefined") return defaultLocalClinicSettings;
    const stored = window.localStorage.getItem("zaincare-local-settings");
    if (!stored) return defaultLocalClinicSettings;
    try {
      return { ...defaultLocalClinicSettings, ...JSON.parse(stored) };
    } catch {
      return defaultLocalClinicSettings;
    }
  });
  const [saved, setSaved] = useState(false);
  const update = <K extends keyof LocalClinicSettings>(key: K, value: LocalClinicSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };
  const save = () => {
    window.localStorage.setItem("zaincare-local-settings", JSON.stringify(settings));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 3000);
  };
  const input = (label: string, key: keyof LocalClinicSettings, direction?: "ltr", type = "text") => <EditableField label={label} value={String(settings[key])} dir={direction} type={type} onChange={(value) => update(key, value as never)} />;
  const toggle = (label: string, description: string, key: keyof LocalClinicSettings) => <ToggleRow label={label} description={description} checked={Boolean(settings[key])} onChange={(value) => update(key, value as never)} />;

  return <><ViewHeader eyebrow="إعدادات العيادة" title="إعدادات النظام" description={`${branch} · التهيئة والهوية وقواعد التشغيل`} action="اختيار نوع العيادة" icon={Settings2} onAction={onClinic} /><div className="grid gap-6 lg:grid-cols-[230px_1fr]"><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-3"><div className="mb-3 px-3 text-[10px] font-bold text-[#9ab1af]">إعدادات المساحة</div>{localSettingsTabs.map(([id, label, Icon]) => <button key={id} onClick={() => setTab(id)} className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-3 text-right text-[11px] font-bold transition", tab === id ? "bg-[#e6f4f1] text-[#0d716a]" : "text-[#7d9894] hover:bg-[#f5f9f8]")}><Icon className="h-4 w-4" />{label}</button>)}<div className="mt-4 rounded-xl bg-[#f1f8f6] p-3"><div className="flex items-center gap-2 text-[10px] font-bold text-[#0d716a]"><Database className="h-3.5 w-3.5" /> حفظ محلي</div><p className="mt-1 text-[10px] leading-5 text-[#799792]">تُحفظ التغييرات في هذا المتصفح فقط حتى يتم ربط قاعدة البيانات.</p></div></div><div className="min-w-0 space-y-6">{tab === "profile" && <SettingsCard title="ملف المنشأة" description="البيانات التي تظهر في البوابة والفواتير" icon={Building2}><div className="grid gap-4 sm:grid-cols-2">{input("اسم المنشأة بالعربية", "nameAr")} {input("الاسم بالإنجليزية", "nameEn", "ltr")} {input("الرقم الضريبي", "vatNumber", "ltr")} {input("المدينة", "city")} {input("رقم التواصل", "phone", "ltr")} {input("البريد الإلكتروني", "email", "ltr", "email")}</div></SettingsCard>}{tab === "users" && <SettingsCard title="المستخدمون والصلاحيات" description="إدارة الفريق والوصول حسب الدور والفرع" icon={UsersRound}><div className="mb-4 flex items-center justify-between rounded-xl bg-[#f1f8f6] p-4"><div><div className="text-[12px] font-bold text-[#426765]">١٢ مستخدمًا نشطًا</div><div className="mt-1 text-[10px] text-[#8ca6a2]">الصلاحيات مبنية على أدوار ZainCare</div></div><button className="h-10 rounded-xl bg-[#0d716a] px-4 text-[11px] font-bold text-white"><Plus className="ml-1 inline h-4 w-4" /> دعوة مستخدم</button></div>{["أحمد المطيري · مالك العيادة · كل الفروع", "د. ليان المطيري · طبيب · الرياض وجدة", "ريم السبيعي · استقبال · الرياض", "عمر الحربي · محاسب · دعوة معلقة"].map((user) => <div key={user} className="flex items-center justify-between border-b border-[#f0f4f3] py-4 last:border-0"><span className="text-[11px] font-bold text-[#426765]">{user}</span><button className="text-[10px] font-bold text-[#0d716a]">إدارة الصلاحيات</button></div>)}</SettingsCard>}{tab === "hours" && <SettingsCard title="أوقات العمل" description="جدول الفرع والفترات اليومية والاستراحات" icon={CalendarClock}><div className="grid gap-4 sm:grid-cols-3">{input("وقت الافتتاح", "openingTime", "ltr", "time")} {input("وقت الإغلاق", "closingTime", "ltr", "time")} {input("استراحة الصلاة", "prayerBreak", "ltr")}</div><div className="mt-6 space-y-2">{["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس"].map((day) => <div key={day} className="flex items-center justify-between rounded-xl border border-[#edf3f1] px-4 py-3"><span className="text-[11px] font-bold text-[#527572]">{day}</span><span className="text-[11px] text-[#789693]">{settings.openingTime} - {settings.closingTime}</span><span className="text-[10px] font-bold text-[#0d857b]">مفتوح</span></div>)}<div className="flex items-center justify-between rounded-xl border border-[#f3e4d0] bg-[#fffaf2] px-4 py-3"><span className="text-[11px] font-bold text-[#8c6e45]">الجمعة</span><span className="text-[11px] font-bold text-[#bd812b]">مغلق · قابل للتعديل</span></div></div></SettingsCard>}{tab === "notifications" && <SettingsCard title="الإشعارات والواتساب" description="قنوات التواصل الأساسية مع المرضى" icon={MessageCircle}><div className="grid gap-4 sm:grid-cols-2">{input("مزود واتساب", "whatsappProvider")} {input("رقم المرسل", "whatsappSender", "ltr")}</div><div className="mt-6 space-y-3">{toggle("تذكير الموعد قبل ٢٤ ساعة", "إرسال رسالة واتساب ثنائية اللغة", "reminder24h")}{toggle("تذكير الموعد قبل ساعة", "تقليل حالات عدم الحضور", "reminder1h")}{toggle("تنبيه اقتراب الدور", "إبلاغ المريض عند بقاء ٣ أرقام أمامه", "queueAlerts")}</div><div className="mt-5 rounded-xl border border-[#dcece8] bg-[#f4fbf8] p-4"><div className="flex items-center gap-2 text-[11px] font-bold text-[#0d716a]"><MessageCircle className="h-4 w-4" /> حالة الاتصال: متصل</div><p className="mt-1 text-[10px] text-[#789792]">تم إرسال ١٨٤ رسالة هذا الشهر بنسبة تسليم ٩٨٪.</p></div></SettingsCard>}{tab === "payments" && <SettingsCard title="الدفع والفوترة" description="طرق الدفع والضريبة وتسلسل الفواتير" icon={CreditCard}><div className="grid gap-4 sm:grid-cols-2">{input("بادئة الفاتورة", "vatNumber", "ltr")} {input("نسبة الضريبة", "vatNumber", "ltr")}</div><div className="mt-6 space-y-3">{toggle("مدى", "الدفع الإلكتروني المحلي", "mada")}{toggle("Apple Pay", "الدفع السريع من الهاتف", "applePay")}{toggle("الدفع النقدي", "تسجيل المدفوعات من الكاشير", "cash")}{toggle("التأمين", "تحويل حصة شركة التأمين إلى المطالبة", "insurance")}{toggle("تفعيل VAT والفاتورة الإلكترونية", "عرض الضريبة في الفاتورة", "vatEnabled")}</div></SettingsCard>}{tab === "security" && <SettingsCard title="الأمان والخصوصية" description="حماية بيانات المرضى وسجل التدقيق" icon={LockKeyhole}><div className="space-y-3">{toggle("المصادقة الثنائية للموظفين", "إلزام المالك والمحاسبين والأطباء بالتحقق الإضافي", "twoFactor")}{toggle("تسجيل عمليات التصدير", "حفظ كل عمليات طباعة وتصدير بيانات المرضى", "auditExports")}</div><div className="mt-6 grid gap-4 sm:grid-cols-2">{input("مهلة انتهاء الجلسة", "sessionTimeout")}<EditableField label="نسخة الموافقة PDPL" value="v2.1 · ١ مايو ٢٠٢٥" onChange={() => undefined} /></div><div className="mt-5 rounded-xl border border-[#f2ddd6] bg-[#fff8f5] p-4"><div className="flex items-center gap-2 text-[11px] font-bold text-[#c5785f]"><LockKeyhole className="h-4 w-4" /> لا توجد قاعدة بيانات مرتبطة</div><p className="mt-1 text-[10px] leading-5 text-[#98776d]">هذه النسخة تحفظ الإعدادات محليًا في المتصفح فقط.</p></div></SettingsCard>}<div className="flex flex-col items-stretch justify-between gap-3 rounded-[18px] border border-[#dcece8] bg-[#eaf7f3] p-4 sm:flex-row sm:items-center"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-[#0d716a]"><CheckCircle2 className="h-4 w-4" /></div><div><div className="text-[11px] font-bold text-[#356460]">{saved ? "تم حفظ الإعدادات محليًا" : "لديك إعدادات قابلة للحفظ"}</div><div className="mt-1 text-[10px] text-[#7c9995]">لن يتم إرسال أي بيانات إلى خادم خارجي.</div></div></div><button onClick={save} className="h-10 rounded-xl bg-[#0d716a] px-5 text-[11px] font-bold text-white transition hover:bg-[#095d58]">حفظ البيانات</button></div></div></div></>;
}

function SettingsCard({ title, description, icon: Icon, children }: { title: string; description: string; icon: typeof Building2; children: ReactNode }) {
  return <div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 shadow-[0_4px_18px_rgba(30,73,72,0.025)] sm:p-6"><div className="mb-6 flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e4f5f1] text-[#0d857b]"><Icon className="h-5 w-5" /></div><div><h2 className="text-[16px] font-bold text-[#234b4b]">{title}</h2><p className="mt-1 text-[11px] text-[#96aaa8]">{description}</p></div></div>{children}</div>;
}

function EditableField({ label, value, onChange, dir, type = "text" }: { label: string; value: string; onChange: (value: string) => void; dir?: "ltr"; type?: string }) {
  return <label className="block"><span className="mb-2 block text-[10px] font-bold text-[#8ba4a1]">{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} className={cn(formControlClass(), "bg-[#fbfdfc]")} dir={dir} /></label>;
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-[#edf3f1] p-4 transition hover:border-[#c9e3df]"><div><div className="text-[11px] font-bold text-[#426765]">{label}</div><div className="mt-1 text-[10px] text-[#9aafac]">{description}</div></div><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="peer sr-only" /><span className={cn("relative h-6 w-11 shrink-0 rounded-full p-1 transition", checked ? "bg-[#0d857b]" : "bg-[#d7e5e2]")}><span className={cn("block h-4 w-4 rounded-full bg-white shadow-sm transition", checked ? "translate-x-5" : "translate-x-0")} /></span></label>;
}

function SettingsView({ branch, onClinic }: { branch: string; onClinic: () => void }) {
  return <><ViewHeader eyebrow="إعدادات العيادة" title="إعدادات النظام" description={`${branch} · التهيئة والهوية وقواعد التشغيل`} action="اختيار نوع العيادة" icon={Settings2} onAction={onClinic} /><div className="grid gap-6 lg:grid-cols-[220px_1fr]"><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-3"><SettingsTab icon={Building2} label="ملف المنشأة" active /><SettingsTab icon={UsersRound} label="المستخدمون والصلاحيات" /><SettingsTab icon={CalendarClock} label="أوقات العمل" /><SettingsTab icon={MessageCircle} label="الإشعارات والواتساب" /><SettingsTab icon={CreditCard} label="الدفع والفوترة" /><SettingsTab icon={LockKeyhole} label="الأمان والخصوصية" /></div><div className="space-y-6"><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><div className="mb-6 flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e4f5f1] text-[#0d857b]"><Building2 className="h-5 w-5" /></div><div><h2 className="text-[16px] font-bold text-[#234b4b]">ملف المنشأة</h2><p className="mt-1 text-[11px] text-[#96aaa8]">البيانات التي تظهر في البوابة والفواتير</p></div></div><div className="grid gap-4 sm:grid-cols-2"><Field label="اسم المنشأة بالعربية" value="مجمع زين الطبي" /><Field label="الاسم بالإنجليزية" value="Zain Medical Center" /><Field label="الرقم الضريبي" value="310123456700003" ltr /><Field label="المدينة" value="الرياض، المملكة العربية السعودية" /></div></div><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><div className="mb-5"><h2 className="text-[16px] font-bold text-[#234b4b]">الوحدات المفعّلة</h2><p className="mt-1 text-[11px] text-[#96aaa8]">تظهر الوحدات المفعّلة فقط في القائمة الجانبية</p></div><div className="grid gap-3 sm:grid-cols-2">{["المواعيد والحجز", "الطابور المباشر", "السجل الطبي", "المختبر", "التأمين والمطالبات", "الباقات والاشتراكات"].map((module, index) => <div key={module} className="flex items-center justify-between rounded-xl border border-[#edf3f1] p-3"><div className="flex items-center gap-3"><div className="h-2 w-2 rounded-full bg-[#0d857b]" /><span className="text-[11px] font-bold text-[#527572]">{module}</span></div><div className="h-5 w-9 rounded-full bg-[#0d857b] p-0.5"><div className="h-4 w-4 translate-x-4 rounded-full bg-white shadow-sm" /></div></div>)}</div></div></div></div></>;
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between border-b border-[#f0f4f3] pb-3 last:border-0 last:pb-0"><span className="text-[11px] text-[#7d9894]">{label}</span><span className="text-[11px] font-bold text-[#426765]">{value}</span></div>;
}

function UsageRow({ patient, packageName, service, date }: { patient: string; packageName: string; service: string; date: string }) {
  return <div className="flex items-center gap-3 rounded-xl border border-[#edf3f1] p-3"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#e4f5f1] text-[#0d857b]"><CheckCircle2 className="h-4 w-4" /></div><div className="min-w-0 flex-1"><div className="truncate text-[11px] font-bold text-[#426765]">{patient}</div><div className="mt-1 truncate text-[10px] text-[#9aafac]">{packageName} · {service}</div></div><span className="text-[10px] text-[#8ea6a2]">{date}</span></div>;
}

function SettingsTab({ icon: Icon, label, active = false }: { icon: typeof Building2; label: string; active?: boolean }) {
  return <button className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-3 text-right text-[11px] font-bold transition", active ? "bg-[#e6f4f1] text-[#0d716a]" : "text-[#7d9894] hover:bg-[#f5f9f8]")}><Icon className="h-4 w-4" />{label}</button>;
}

function Field({ label, value, ltr = false }: { label: string; value: string; ltr?: boolean }) {
  return <label className="block"><span className="mb-2 block text-[10px] font-bold text-[#8ba4a1]">{label}</span><div className={cn("rounded-xl border border-[#e3eeeb] bg-[#fbfdfc] px-3 py-3 text-[11px] font-semibold text-[#496f6b]", ltr && "text-left font-mono")} dir={ltr ? "ltr" : undefined}>{value}</div></label>;
}

const clinicProfiles = [
  { id: "general", name: "عيادة عامة", detail: "رعاية أولية وفحوصات عامة", icon: Stethoscope, modules: "السجل الطبي · المواعيد · الوصفات" },
  { id: "dental", name: "طب الأسنان", detail: "مخطط الأسنان وخطط العلاج", icon: Activity, modules: "مخطط الأسنان · الأشعة · خطط العلاج" },
  { id: "dermatology", name: "الجلدية والتجميل", detail: "جلسات الليزر والعناية بالبشرة", icon: Sparkles, modules: "جلسات التجميل · الصور · الباقات" },
  { id: "pediatrics", name: "طب الأطفال", detail: "النمو والتطعيمات والمتابعة", icon: UsersRound, modules: "مخططات النمو · التطعيمات · التابعون" },
  { id: "ophthalmology", name: "طب العيون", detail: "حدة النظر والضغط والوصفات", icon: EyeIcon, modules: "حدة النظر · ضغط العين · العدسات" },
  { id: "physiotherapy", name: "العلاج الطبيعي", detail: "الجلسات وقياس مدى الحركة", icon: Activity, modules: "الجلسات · الألم · خطة العلاج" },
];

function ModalShell({ title, description, icon: Icon, onClose, children }: { title: string; description: string; icon: typeof LayoutDashboard; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#123f42]/35 p-0 backdrop-blur-sm sm:items-center sm:p-5"><div role="dialog" aria-modal="true" className="max-h-[92vh] w-full max-w-[720px] overflow-y-auto rounded-t-[26px] bg-white shadow-[0_24px_80px_rgba(18,63,66,0.25)] sm:rounded-[26px]"><div className="sticky top-0 z-10 flex items-start justify-between border-b border-[#edf3f1] bg-white px-5 py-5 sm:px-7"><div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e6f4f1] text-[#0d857b]"><Icon className="h-5 w-5" /></div><div><h2 className="text-[17px] font-bold text-[#234b4b]">{title}</h2><p className="mt-1 text-[11px] text-[#8ca6a2]">{description}</p></div></div><button type="button" aria-label="إغلاق" onClick={onClose} className="rounded-xl p-2 text-[#8ea7a3] hover:bg-[#f1f7f5] hover:text-[#0d716a]"><X className="h-5 w-5" /></button></div><div className="p-5 sm:p-7">{children}</div></div></div>;
}

function FormField({ label, children, required = false }: { label: string; children: ReactNode; required?: boolean }) {
  return <label className="block"><span className="mb-2 block text-[11px] font-bold text-[#6f8f8b]">{label}{required && <span className="mr-1 text-[#d77e65]">*</span>}</span>{children}</label>;
}

function formControlClass() {
  return "h-11 w-full rounded-xl border border-[#dfece9] bg-[#fbfdfc] px-3 text-[12px] text-[#426765] outline-none transition placeholder:text-[#a8bbb8] focus:border-[#77c2b8] focus:bg-white focus:ring-4 focus:ring-[#e9f6f3]";
}

function PatientModal({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string) => void }) {
  const [form, setForm] = useState({ nameAr: "", nameEn: "", idType: "national_id", id: "", mobile: "", gender: "female", clinic: "dermatology", guardian: "" });
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); onCreated(form.nameAr); };
  return <ModalShell title="تسجيل مريض جديد" description="أنشئ ملفًا طبيًا مع التحقق من هوية المريض" icon={UserRoundPlus} onClose={onClose}><form onSubmit={submit} className="space-y-5"><div className="rounded-xl bg-[#f1f8f6] px-4 py-3 text-[11px] leading-5 text-[#628580]">سيتم إنشاء رقم ملف تلقائيًا، وتبقى البيانات الطبية الحساسة محمية حسب صلاحية المستخدم.</div><div className="grid gap-4 sm:grid-cols-2"><FormField label="الاسم الكامل بالعربية" required><input required value={form.nameAr} onChange={(event) => update("nameAr", event.target.value)} className={formControlClass()} placeholder="مثال: سارة أحمد العتيبي" /></FormField><FormField label="الاسم بالإنجليزية"><input value={form.nameEn} onChange={(event) => update("nameEn", event.target.value)} className={formControlClass()} dir="ltr" placeholder="Sara Ahmed Alotaibi" /></FormField><FormField label="نوع الهوية" required><select required value={form.idType} onChange={(event) => update("idType", event.target.value)} className={formControlClass()}><option value="national_id">الهوية الوطنية</option><option value="iqama">الإقامة</option><option value="passport">جواز السفر</option><option value="emirates_id">الهوية الإماراتية</option></select></FormField><FormField label="رقم الهوية" required><input required minLength={8} value={form.id} onChange={(event) => update("id", event.target.value)} className={formControlClass()} dir="ltr" placeholder="١٠ أرقام للهوية السعودية" /></FormField><FormField label="رقم الجوال" required><input required type="tel" value={form.mobile} onChange={(event) => update("mobile", event.target.value)} className={formControlClass()} dir="ltr" placeholder="+966 5X XXX XXXX" /></FormField><FormField label="الجنس" required><select required value={form.gender} onChange={(event) => update("gender", event.target.value)} className={formControlClass()}><option value="female">أنثى</option><option value="male">ذكر</option></select></FormField></div><div><div className="mb-3 text-[12px] font-bold text-[#355e5c]">نوع العيادة الأساسية</div><div className="grid gap-2 sm:grid-cols-3">{clinicProfiles.slice(0, 6).map((profile) => <button type="button" key={profile.id} onClick={() => update("clinic", profile.id)} className={cn("rounded-xl border p-3 text-right transition", form.clinic === profile.id ? "border-[#8acbc1] bg-[#eaf7f3]" : "border-[#e3eeeb] hover:border-[#b9ded8]")}><div className="flex items-center gap-2"><profile.icon className="h-4 w-4 text-[#0d857b]" /><span className="text-[11px] font-bold text-[#476f6b]">{profile.name}</span></div><p className="mt-1 text-[10px] text-[#9aafac]">{profile.detail}</p></button>)}</div></div><FormField label="ولي الأمر أو التابع (اختياري)"><input value={form.guardian} onChange={(event) => update("guardian", event.target.value)} className={formControlClass()} placeholder="يُطلب تلقائيًا للأطفال أو التابعين" /></FormField><label className="flex items-start gap-2 rounded-xl border border-[#edf3f1] p-3"><input required type="checkbox" className="mt-1 accent-[#0d716a]" /><span className="text-[10px] leading-5 text-[#769390]">أوافق على تسجيل موافقة المريض على معالجة بياناته وفق سياسة الخصوصية PDPL.</span></label><div className="flex flex-col-reverse gap-2 border-t border-[#edf3f1] pt-5 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} className="h-11 rounded-xl border border-[#dfece9] px-5 text-[11px] font-bold text-[#769390]">إلغاء</button><button type="submit" className="h-11 rounded-xl bg-[#0d716a] px-6 text-[11px] font-bold text-white shadow-[0_8px_18px_rgba(13,113,106,0.16)]">إنشاء ملف المريض</button></div></form></ModalShell>;
}

function AppointmentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ patient: "", clinic: "dermatology", doctor: "د. ليان المطيري", branch: "فرع الرياض - النخيل", date: "2025-05-18", time: "10:30", type: "in_person", payment: "insurance" });
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); onCreated(); };
  return <ModalShell title="حجز موعد جديد" description="اختر المريض والخدمة والوقت المناسب" icon={CalendarClock} onClose={onClose}><form onSubmit={submit} className="space-y-5"><div className="grid gap-4 sm:grid-cols-2"><FormField label="المريض" required><select required value={form.patient} onChange={(event) => update("patient", event.target.value)} className={formControlClass()}><option value="">اختر المريض</option><option>سارة أحمد العتيبي · MRN-1024</option><option>عبدالله سالم القحطاني · MRN-1023</option><option>نورة محمد الغامدي · MRN-1022</option><option>+ تسجيل مريض جديد</option></select></FormField><FormField label="نوع العيادة" required><select required value={form.clinic} onChange={(event) => update("clinic", event.target.value)} className={formControlClass()}>{clinicProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></FormField><FormField label="الطبيب" required><select required value={form.doctor} onChange={(event) => update("doctor", event.target.value)} className={formControlClass()}><option>د. ليان المطيري · جلدية</option><option>د. عمر الحربي · طب عام</option><option>د. ريم الزهراني · تجميل</option></select></FormField><FormField label="الخدمة" required><select required className={formControlClass()}><option>استشارة أولية · ٢٠٠ ر.س</option><option>متابعة علاج · ١٥٠ ر.س</option><option>جلسة ليزر · ٦٠٠ ر.س</option></select></FormField><FormField label="الفرع" required><select required value={form.branch} onChange={(event) => update("branch", event.target.value)} className={formControlClass()}><option>فرع الرياض - النخيل</option><option>فرع جدة - الروضة</option><option>فرع دبي - الخليج التجاري</option></select></FormField><FormField label="نوع الموعد" required><select required value={form.type} onChange={(event) => update("type", event.target.value)} className={formControlClass()}><option value="in_person">حضوري</option><option value="video">استشارة فيديو</option><option value="follow_up">متابعة</option><option value="emergency">طوارئ</option></select></FormField><FormField label="التاريخ" required><input required type="date" value={form.date} onChange={(event) => update("date", event.target.value)} className={formControlClass()} dir="ltr" /></FormField><FormField label="الوقت" required><select required value={form.time} onChange={(event) => update("time", event.target.value)} className={formControlClass()} dir="ltr"><option>09:30</option><option>10:00</option><option>10:30</option><option>11:15</option><option>12:00</option></select></FormField></div><div className="rounded-2xl border border-[#e6f0ee] bg-[#fbfdfc] p-4"><div className="mb-3 flex items-center justify-between"><span className="text-[12px] font-bold text-[#426765]">طريقة الدفع</span><span className="text-[10px] text-[#95aaa7]">يتم حساب الضريبة تلقائيًا</span></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[["insurance", "تأمين"], ["mada", "مدى"], ["cash", "نقدي"], ["package", "باقة"]].map(([value, label]) => <button type="button" key={value} onClick={() => update("payment", value)} className={cn("rounded-xl border px-2 py-3 text-[10px] font-bold", form.payment === value ? "border-[#8acbc1] bg-[#e6f4f1] text-[#0d716a]" : "border-[#e3eeeb] text-[#7d9894]")}><CreditCard className="mx-auto mb-1 h-4 w-4" />{label}</button>)}</div></div><div className="flex items-center justify-between rounded-xl bg-[#f1f8f6] px-4 py-3"><div><div className="text-[11px] font-bold text-[#426765]">تقدير الزيارة</div><div className="mt-1 text-[10px] text-[#8ca6a2]">استشارة أولية · ضريبة القيمة المضافة ١٥٪</div></div><span className="text-[18px] font-bold text-[#0d716a]">٢٣٠ ر.س</span></div><div className="flex flex-col-reverse gap-2 border-t border-[#edf3f1] pt-5 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} className="h-11 rounded-xl border border-[#dfece9] px-5 text-[11px] font-bold text-[#769390]">إلغاء</button><button type="submit" className="h-11 rounded-xl bg-[#0d716a] px-6 text-[11px] font-bold text-white">تأكيد وحجز الموعد</button></div></form></ModalShell>;
}

function ClinicProfileModal({ onClose, onSaved }: { onClose: () => void; onSaved: (profile: string) => void }) {
  const [selected, setSelected] = useState("dermatology");
  return <ModalShell title="اختيار نوع العيادة" description="اختر الملف المتخصص لتفعيل الحقول والوحدات المناسبة" icon={Building2} onClose={onClose}><div className="grid gap-3 sm:grid-cols-2">{clinicProfiles.map((profile) => <button type="button" key={profile.id} onClick={() => setSelected(profile.id)} className={cn("rounded-2xl border p-4 text-right transition", selected === profile.id ? "border-[#8acbc1] bg-[#eaf7f3] shadow-[0_5px_15px_rgba(13,113,106,0.08)]" : "border-[#e3eeeb] hover:border-[#b9ded8]")}><div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#0d857b]"><profile.icon className="h-5 w-5" /></div><div className="min-w-0"><div className="text-[13px] font-bold text-[#355e5c]">{profile.name}</div><div className="mt-1 text-[10px] text-[#8ca6a2]">{profile.detail}</div><div className="mt-2 text-[10px] font-semibold text-[#0d857b]">{profile.modules}</div></div></div></button>)}</div><div className="mt-5 rounded-xl bg-[#f1f8f6] p-4 text-[11px] leading-5 text-[#628580]">عند التفعيل سيتم تجهيز نموذج السجل الطبي، الحقول المخصصة، الخدمات المقترحة، وقواعد الحجز الخاصة بهذا النوع.</div><div className="mt-5 flex justify-end gap-2 border-t border-[#edf3f1] pt-5"><button type="button" onClick={onClose} className="h-11 rounded-xl border border-[#dfece9] px-5 text-[11px] font-bold text-[#769390]">إلغاء</button><button type="button" onClick={() => onSaved(clinicProfiles.find((profile) => profile.id === selected)?.name ?? "نوع العيادة")} className="h-11 rounded-xl bg-[#0d716a] px-6 text-[11px] font-bold text-white">تفعيل الملف المختار</button></div></ModalShell>;
}

function EyeIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 12s3.3-5 9.5-5 9.5 5 9.5 5-3.3 5-9.5 5-9.5-5-9.5-5Z" /><circle cx="12" cy="12" r="2.5" /></svg>;
}

function toArabicNumber(value: number) {
  return new Intl.NumberFormat("ar-SA").format(value);
}

function MetricCard({ label, value, change, trend, icon: Icon, tone, detail }: { label: string; value: string; change: string; trend: "up" | "neutral" | "alert"; icon: typeof CalendarClock; tone: "teal" | "amber" | "blue" | "purple"; detail: string }) {
  const tones = { teal: "bg-[#e4f5f1] text-[#0d857b]", amber: "bg-[#fff5e5] text-[#c9892e]", blue: "bg-[#eaf3fb] text-[#4284b9]", purple: "bg-[#f2edfb] text-[#8565bd]" };
  return <div className="rounded-[19px] border border-[#e3eeeb] bg-white p-4 shadow-[0_4px_18px_rgba(30,73,72,0.025)] sm:p-5"><div className="mb-4 flex items-center justify-between"><div className={cn("flex h-9 w-9 items-center justify-center rounded-xl", tones[tone])}><Icon className="h-[17px] w-[17px]" /></div><span className={cn("rounded-md px-2 py-1 text-[10px] font-bold", trend === "up" ? "bg-[#e8f7ef] text-[#4b9a72]" : trend === "alert" ? "bg-[#fff0ea] text-[#d88863]" : "bg-[#f5f8f7] text-[#91a6a3]")}>{change}</span></div><div className="text-[11px] font-semibold text-[#8ba4a1]">{label}</div><div className="mt-1 text-[22px] font-bold tracking-[-0.04em] text-[#234b4b] sm:text-[25px]">{value}</div><div className="mt-2 truncate text-[10px] text-[#a0b2af]">{detail}</div></div>;
}

function AppointmentRow({ appointment }: { appointment: Appointment }) {
  const colors = { teal: "bg-[#e2f4f0] text-[#0d857b]", purple: "bg-[#f0eafb] text-[#8061bb]", amber: "bg-[#fff2dc] text-[#bd812b]", blue: "bg-[#e8f2fb] text-[#4283b9]" };
  const statuses = { مؤكد: "text-[#4b9872] bg-[#edf8f1]", وصل: "text-[#7b62b2] bg-[#f3effb]", "في الانتظار": "text-[#c88932] bg-[#fff7e9]" };
  return <div className="group flex items-center gap-3 rounded-xl border border-[#edf3f1] p-3 transition hover:border-[#c5e4df] hover:bg-[#fbfefd]"><div className="w-10 shrink-0 text-center text-[12px] font-bold text-[#527472]">{appointment.time}</div><div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold", colors[appointment.color as keyof typeof colors])}>{appointment.patient.split(" ").slice(0, 2).map((word) => word[0]).join("")}</div><div className="min-w-0 flex-1"><div className="truncate text-[12px] font-bold text-[#345d5c]">{appointment.patient}</div><div className="mt-1 flex items-center gap-2 truncate text-[10px] text-[#9aafac]"><span>{appointment.type}</span><span className="h-1 w-1 rounded-full bg-[#c6d3d1]" /><span>{appointment.doctor}</span></div></div><span className={cn("hidden shrink-0 rounded-md px-2 py-1 text-[10px] font-bold sm:inline-flex", statuses[appointment.status as keyof typeof statuses])}>{appointment.status}</span><button aria-label={`خيارات موعد ${appointment.patient}`} className="shrink-0 rounded-lg p-1 text-[#a6b9b6] opacity-0 transition group-hover:opacity-100 hover:bg-[#eff7f5] hover:text-[#0d716a]"><ChevronLeft className="h-4 w-4" /></button></div>;
}

function ChartBar({ day, height, value, active = false }: { day: string; height: string; value: string; active?: boolean }) {
  return <div className="flex h-full flex-1 flex-col items-center justify-end gap-2"><span className="text-[9px] font-semibold text-[#8ca7a3]">{value}</span><div className={cn("w-full max-w-[32px] rounded-t-lg transition", active ? "bg-[#0d857b] shadow-[0_5px_12px_rgba(13,133,123,0.18)]" : "bg-[#dceeea]")} style={{ height }} /><span className={cn("text-[9px]", active ? "font-bold text-[#477370]" : "text-[#a0b3b0]")}>{day}</span></div>;
}

function QuickAction({ icon: Icon, label, tone, onClick }: { icon: typeof UserRoundPlus; label: string; tone: "teal" | "blue" | "amber" | "purple"; onClick: () => void }) {
  const tones = { teal: "bg-[#e6f5f1] text-[#0d857b]", blue: "bg-[#eaf3fb] text-[#4284b9]", amber: "bg-[#fff3df] text-[#bd812b]", purple: "bg-[#f2edfb] text-[#8565bd]" };
  return <button onClick={onClick} className="flex items-center gap-3 rounded-xl border border-[#edf3f1] p-3 text-right transition hover:-translate-y-0.5 hover:border-[#c8e3df] hover:shadow-sm"><span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", tones[tone])}><Icon className="h-[17px] w-[17px]" /></span><span className="text-[11px] font-bold text-[#557673]">{label}</span></button>;
}
