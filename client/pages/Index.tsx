import { useMemo, useState } from "react";
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
  LayoutDashboard,
  MapPin,
  MoreHorizontal,
  Package,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  ReceiptText,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  UserRoundPlus,
  UsersRound,
  WalletCards,
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

  const activeIcon = navIcons[activeItem] ?? LayoutDashboard;
  const activeLabel = activeItem === "الرئيسية" ? "نظرة عامة" : activeItem;
  const dateLabel = useMemo(() => new Intl.DateTimeFormat("ar-SA", { weekday: "long", day: "numeric", month: "long" }).format(new Date(2025, 4, 18)), []);

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
            {!collapsed && <div className="mb-4 rounded-2xl bg-[#f1f8f6] p-4"><div className="mb-2 flex items-center gap-2 text-[#0d716a]"><Sparkles className="h-4 w-4" /><span className="text-xs font-bold">مساحة النمو</span></div><p className="text-[11px] leading-5 text-[#6f8e8a]">أكمل إعداد قنوات الواتساب لرفع معدل تذكير المرضى.</p><button className="mt-3 text-[11px] font-bold text-[#0d716a]">إكمال الإعداد <ArrowUpLeft className="mr-1 inline h-3 w-3" /></button></div>}
            <button className={cn("flex w-full items-center rounded-xl text-[#72908d] hover:bg-[#f5f9f8]", collapsed ? "justify-center p-3" : "gap-3 px-3 py-3")}><Settings2 className="h-[18px] w-[18px]" /><span className={cn("text-[13px] font-semibold", collapsed && "sr-only")}>الإعدادات</span></button>
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
            <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
              <div><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#91a8a5]"><span>{dateLabel}</span><span className="h-1 w-1 rounded-full bg-[#b8c9c6]" /><span>١٨ مايو ٢٠٢٥</span></div><h1 className="text-[27px] font-bold tracking-[-0.04em] text-[#183f42] sm:text-[32px]">صباح الخير، أحمد <span className="inline-block">👋</span></h1><p className="mt-2 text-[13px] text-[#76918e]">إليك ملخص أداء عيادتك لهذا اليوم.</p></div>
              <div className="flex items-center gap-2"><div className="relative"><select aria-label="اختيار الفرع" value={branch} onChange={(event) => setBranch(event.target.value)} className="h-11 appearance-none rounded-xl border border-[#dfebe8] bg-white py-2 pl-9 pr-10 text-xs font-bold text-[#436866] outline-none transition focus:border-[#83c7bf]"><option>فرع الرياض - النخيل</option><option>فرع جدة - الروضة</option><option>فرع دبي - الخليج التجاري</option></select><Building2 className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-[#0d857b]" /><ChevronDown className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[#9ab2ae]" /></div><button className="flex h-11 items-center gap-2 rounded-xl bg-[#0d716a] px-4 text-xs font-bold text-white shadow-[0_8px_18px_rgba(13,113,106,0.19)] transition hover:bg-[#095d58]"><Plus className="h-4 w-4" /> موعد جديد</button></div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
              <MetricCard label="مواعيد اليوم" value="٣٨" change="١٢٪" trend="up" icon={CalendarClock} tone="teal" detail="مقابل ٣٤ أمس" />
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
              <section className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 shadow-[0_4px_18px_rgba(30,73,72,0.025)] sm:p-6"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-[16px] font-bold text-[#234b4b]">إجراءات سريعة</h2><p className="mt-1 text-[11px] text-[#96aaa8]">أنجز مهامك اليومية بسرعة</p></div><Sparkles className="h-5 w-5 text-[#e5b15a]" /></div><div className="grid grid-cols-2 gap-3"><QuickAction icon={UserRoundPlus} label="تسجيل مريض" tone="teal" onClick={() => setActiveItem("المرضى")} /><QuickAction icon={CalendarClock} label="حجز موعد" tone="blue" onClick={() => setActiveItem("المواعيد")} /><QuickAction icon={ReceiptText} label="إنشاء فاتورة" tone="amber" onClick={() => setActiveItem("الفوترة والمدفوعات")} /><QuickAction icon={FlaskConical} label="نتائج المختبر" tone="purple" onClick={() => setActiveItem("المختبر")} /></div></section>
            </div>

            <div className="mt-6 flex flex-col items-start justify-between gap-3 rounded-[20px] bg-[#e8f5f1] px-5 py-4 sm:flex-row sm:items-center sm:px-6"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-[#0d716a]"><MapPin className="h-4 w-4" /></div><div><p className="text-[12px] font-bold text-[#2d625e]">أنت تعمل الآن من {branch}</p><p className="mt-1 text-[10px] text-[#6f9690]">آخر مزامنة للبيانات: منذ دقيقة واحدة</p></div></div><button className="flex items-center gap-1 text-[11px] font-bold text-[#0d716a]">تغيير الفرع <ArrowUpLeft className="h-3.5 w-3.5" /></button></div>
          </div>
        </section>
      </div>
    </main>
  );
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
