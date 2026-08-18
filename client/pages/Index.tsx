import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpLeft,
  BarChart3,
  Bell,
  Building2,
  ClipboardList,
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
  Newspaper,
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
  UserCog,
  UserCheck,
  UserRoundPlus,
  UsersRound,
  CalendarCheck2,
  BriefcaseBusiness,
  Banknote,
  FileCheck2,
  UserPlus,
  Gauge,
  GraduationCap,
  CalendarRange,
  WalletCards,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { isOrganizationAdmin } from "@/lib/organization-access";
import { supabase } from "@/lib/supabase";
import { Switch } from "@/components/ui/switch";
import {
  filterAccessibleModules,
  groupModules,
  moduleRegistry,
  settingsModule,
} from "@/lib/module-registry";
import type { FeatureCatalogEntry, FeatureKey, OrganizationFeature } from "@shared/api";

type Appointment = {
  time: string;
  patient: string;
  type: string;
  doctor: string;
  color: string;
  status: string;
};

type ClinicalModal = "service" | "radiology" | "medicine" | "prescription";

type ClinicalRows = string[][];

type WorkflowCase = {
  id: string;
  patient: string;
  mrn: string;
  appointment: string;
  visit: string;
  service: string;
  invoice: string;
  payment: string;
  insurance: string;
  prescription: string;
  stage: string;
};

const initialWorkflowCases: WorkflowCase[] = [
  { id: "CASE-1024", patient: "سارة أحمد العتيبي", mrn: "MRN-1024", appointment: "مؤكد", visit: "مفتوحة", service: "كشف جلدية", invoice: "INV-RYD-1048", payment: "مدفوعة", insurance: "مؤهلة", prescription: "RX-2025-0841", stage: "الصرف" },
  { id: "CASE-1023", patient: "عبدالله سالم القحطاني", mrn: "MRN-1023", appointment: "وصل", visit: "بانتظار الطبيب", service: "متابعة علاج", invoice: "لم تنشأ", payment: "غير مدفوع", insurance: "نقدي", prescription: "لم تنشأ", stage: "الزيارة" },
  { id: "CASE-1022", patient: "نورة محمد الغامدي", mrn: "MRN-1022", appointment: "في الانتظار", visit: "لم تبدأ", service: "فحص أولي", invoice: "لم تنشأ", payment: "غير مدفوع", insurance: "بانتظار الأهلية", prescription: "لم تنشأ", stage: "الاستقبال" },
];

const initialServices: ClinicalRows = [
  ["استشارة جلدية أولية", "الجلدية والتجميل", "٣٠ دقيقة", "٢٠٠ ر.س", "الرياض · جدة", "نشطة"],
  ["جلسة ليزر", "التجميل", "٦٠ دقيقة", "٦٠٠ ر.س", "الرياض", "نشطة"],
  ["متابعة علاج", "طب عام", "٢٠ دقيقة", "١٥٠ ر.س", "كل الفروع", "نشطة"],
  ["زيارة طب أطفال", "طب الأطفال", "٣٠ دقيقة", "١٨٠ ر.س", "الرياض", "مسودة"],
];

const initialRadiologyOrders: ClinicalRows = [
  ["RAD-1024", "سارة أحمد العتيبي", "أشعة سونار البطن", "د. ليان المطيري", "مجدول", "اليوم ١١:٠٠"],
  ["RAD-1023", "عبدالله سالم القحطاني", "أشعة سينية للصدر", "د. عمر الحربي", "قيد التنفيذ", "اليوم ١٠:٣٠"],
  ["RAD-1022", "نورة محمد الغامدي", "تصوير بالرنين المغناطيسي", "د. ريم الزهراني", "بانتظار التقرير", "أمس ١٦:٢٠"],
];

const initialStock: ClinicalRows = [
  ["باراسيتامول ٥٠٠ مج", "مسكن", "BTH-8821", "١٢٠", "يناير ٢٠٢٧", "متوفر"],
  ["أموكسيسيلين ٥٠٠ مج", "مضاد حيوي", "BTH-5510", "٢٤", "أكتوبر ٢٠٢٦", "منخفض"],
  ["كريم هيدروكورتيزون", "جلدية", "BTH-3009", "٥٦", "يونيو ٢٠٢٦", "متوفر"],
  ["محلول ملحي ٥٠٠ مل", "مستلزمات", "BTH-1022", "٨٠", "مارس ٢٠٢٧", "متوفر"],
];

const initialPrescriptions: ClinicalRows = [
  ["RX-2025-0841", "سارة أحمد العتيبي", "د. ليان المطيري", "٣ أصناف", "معتمدة", "اليوم ٠٩:٤٥"],
  ["RX-2025-0840", "عبدالله سالم القحطاني", "د. عمر الحربي", "٢ صنف", "تم الصرف", "اليوم ٠٩:١٠"],
  ["RX-2025-0839", "نورة محمد الغامدي", "د. ليان المطيري", "٤ أصناف", "بانتظار الصرف", "أمس ١٧:٢٠"],
];

const initialDispensingQueue: ClinicalRows = [
  ["RX-2025-0841", "سارة أحمد العتيبي", "٣ أصناف", "تأمين", "بانتظار التجهيز"],
  ["RX-2025-0839", "نورة محمد الغامدي", "٤ أصناف", "نقدي", "جاري التجهيز"],
  ["RX-2025-0838", "خالد إبراهيم الشهري", "١ صنف", "باقة", "جاهز للتسليم"],
];

function readClinicalRows(key: string, fallback: ClinicalRows) {
  if (typeof window === "undefined") return fallback;
  const stored = window.localStorage.getItem(key);
  if (!stored) return fallback;
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed as ClinicalRows : fallback;
  } catch {
    return fallback;
  }
}

function readWorkflowCases() {
  if (typeof window === "undefined") return initialWorkflowCases;
  const stored = window.localStorage.getItem("zaincare-workflow-cases");
  if (!stored) return initialWorkflowCases;
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed as WorkflowCase[] : initialWorkflowCases;
  } catch {
    return initialWorkflowCases;
  }
}

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

export default function Index() {
  const access = useOrganizationAccess();
  const navigate = useNavigate();
  const [activeItem, setActiveItem] = useState("الرئيسية");
  const [collapsed, setCollapsed] = useState(false);
  const [branch, setBranch] = useState("فرع الرياض - النخيل");
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [globalQuery, setGlobalQuery] = useState("");
  const [openNavSections, setOpenNavSections] = useState<string[]>(["لوحة التحكم"]);
  const [modal, setModal] = useState<"patient" | "appointment" | "clinic" | null>(null);
  const [toast, setToast] = useState("");
  const [patientCount, setPatientCount] = useState(1248);
  const [appointmentCount, setAppointmentCount] = useState(38);
  const [recentPatient, setRecentPatient] = useState("سارة أحمد العتيبي");
  const [clinicalModal, setClinicalModal] = useState<ClinicalModal | null>(null);
  const [services, setServices] = useState<ClinicalRows>(() => readClinicalRows("zaincare-local-services", initialServices));
  const [radiologyOrders, setRadiologyOrders] = useState<ClinicalRows>(() => readClinicalRows("zaincare-local-radiology", initialRadiologyOrders));
  const [stock, setStock] = useState<ClinicalRows>(() => readClinicalRows("zaincare-local-stock", initialStock));
  const [prescriptions, setPrescriptions] = useState<ClinicalRows>(() => readClinicalRows("zaincare-local-prescriptions", initialPrescriptions));
  const [dispensingQueue, setDispensingQueue] = useState<ClinicalRows>(() => readClinicalRows("zaincare-local-dispensing", initialDispensingQueue));
  const [workflowCases, setWorkflowCases] = useState<WorkflowCase[]>(readWorkflowCases);

  useEffect(() => {
    window.localStorage.setItem("zaincare-local-services", JSON.stringify(services));
    window.localStorage.setItem("zaincare-local-radiology", JSON.stringify(radiologyOrders));
    window.localStorage.setItem("zaincare-local-stock", JSON.stringify(stock));
    window.localStorage.setItem("zaincare-local-prescriptions", JSON.stringify(prescriptions));
    window.localStorage.setItem("zaincare-local-dispensing", JSON.stringify(dispensingQueue));
    window.localStorage.setItem("zaincare-workflow-cases", JSON.stringify(workflowCases));
  }, [services, radiologyOrders, stock, prescriptions, dispensingQueue, workflowCases]);

  const accessibleNavigation = useMemo(
    () => filterAccessibleModules(moduleRegistry, access.canAccess),
    [access.canAccess],
  );
  const navGroups = useMemo(() => groupModules(accessibleNavigation), [accessibleNavigation]);
  const requestedModule = [...moduleRegistry, settingsModule].find((item) => item.label === activeItem);
  const safeActiveItem = requestedModule && access.canAccess(requestedModule.featureKey, requestedModule.requiredPermission)
    ? activeItem
    : "الرئيسية";
  useEffect(() => {
    if (safeActiveItem !== activeItem) setActiveItem("الرئيسية");
  }, [activeItem, safeActiveItem]);
  useEffect(() => {
    const activeSection = navGroups.find((group) => group.items.some((item) => item.label === safeActiveItem))?.section;
    if (activeSection) setOpenNavSections((sections) => sections.includes(activeSection) ? sections : [...sections, activeSection]);
  }, [safeActiveItem, navGroups]);
  const activeIcon = requestedModule?.icon ?? LayoutDashboard;
  const activeLabel = safeActiveItem === "الرئيسية" ? "نظرة عامة" : safeActiveItem;
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
    const sequence = String(workflowCases.length + 1025);
    setWorkflowCases((cases) => [{ id: `CASE-${sequence}`, patient: name, mrn: `MRN-${sequence}`, appointment: "لم يحجز", visit: "لم تبدأ", service: "لم تحدد", invoice: "لم تنشأ", payment: "غير مدفوع", insurance: "بانتظار التحقق", prescription: "لم تنشأ", stage: "الاستقبال" }, ...cases]);
    setActiveItem("رحلة المريض");
    notify(`تم تسجيل ملف ${name} وفتح رحلة المريض`);
  };
  const handleAppointmentCreated = (appointment: { patient: string; service: string }) => {
    setAppointmentCount((count) => count + 1);
    const patientName = appointment.patient.split(" · ")[0];
    setWorkflowCases((cases) => cases.map((item, index) => item.patient === patientName || (!patientName && index === 0) ? { ...item, appointment: "مؤكد", service: appointment.service.split(" · ")[0], stage: "الاستقبال" } : item));
    setActiveItem("رحلة المريض");
    notify(`تم حجز ${appointment.service.split(" · ")[0]} وربطه برحلة ${patientName}`);
  };
  const handleClinicalCreated = (type: ClinicalModal, row: string[], payment = "نقدي") => {
    if (type === "service") {
      setServices((current) => [row, ...current]);
      setActiveItem("الخدمات");
      notify(`تمت إضافة خدمة ${row[0]}`);
      return;
    }
    if (type === "radiology") {
      setRadiologyOrders((current) => [row, ...current]);
      setActiveItem("الأشعة والتصوير الطبي");
      notify(`تم إنشاء طلب الأشعة ${row[0]}`);
      return;
    }
    if (type === "medicine") {
      setStock((current) => [row, ...current]);
      setActiveItem("الصيدلية");
      notify(`تمت إضافة ${row[0]} إلى المخزون`);
      return;
    }
    setPrescriptions((current) => [row, ...current]);
    setDispensingQueue((current) => [[row[0], row[1], row[3], payment, "بانتظار التجهيز"], ...current]);
    setActiveItem("صرف الأدوية");
    notify(`تم اعتماد الوصفة ${row[0]} وإضافتها إلى طابور الصرف`);
  };
  const updateDispensingStatus = (prescriptionId: string, status: string) => {
    setDispensingQueue((current) => current.map((row) => row[0] === prescriptionId ? [...row.slice(0, 4), status] : row));
    const prescriptionStatus = status === "تم التسليم" ? "تم الصرف" : status === "جاهز للتسليم" ? "جاهزة للتسليم" : "قيد التجهيز";
    setPrescriptions((current) => current.map((row) => row[0] === prescriptionId ? [...row.slice(0, 4), prescriptionStatus, row[5]] : row));
    notify(status === "تم التسليم" ? "تم تسليم الوصفة وتحديث سجل المريض" : `تم تحديث حالة ${prescriptionId} إلى ${status}`);
  };
  const scanPrescription = () => {
    const waiting = dispensingQueue.find((row) => row[4] === "بانتظار التجهيز");
    if (!waiting) {
      notify("لا توجد وصفات جديدة في انتظار التجهيز");
      return;
    }
    updateDispensingStatus(waiting[0], "جاري التجهيز");
  };
  const advanceWorkflow = (caseId: string) => {
    const currentCase = workflowCases.find((item) => item.id === caseId);
    if (!currentCase) return;
    const transitions: Record<string, string> = { الاستقبال: "الزيارة", الزيارة: "الخدمات", الخدمات: "الفوترة", الفوترة: "الصرف", الصرف: "مكتملة" };
    const nextStage = transitions[currentCase.stage] ?? "مكتملة";
    let updates: Partial<WorkflowCase> = { stage: nextStage };
    if (nextStage === "الزيارة") updates = { ...updates, appointment: "وصل", visit: "مفتوحة" };
    if (nextStage === "الخدمات") updates = { ...updates, visit: "مكتملة", prescription: `RX-2025-${currentCase.mrn.slice(-4)}` };
    if (nextStage === "الفوترة") updates = { ...updates, invoice: `INV-RYD-${currentCase.mrn.slice(-4)}`, payment: "بانتظار الدفع" };
    if (nextStage === "الصرف") updates = { ...updates, payment: "مدفوعة", insurance: currentCase.insurance === "بانتظار الأهلية" ? "مؤهلة" : currentCase.insurance };
    if (nextStage === "مكتملة") updates = { ...updates, payment: "مدفوعة", visit: "مغلقة" };
    setWorkflowCases((cases) => cases.map((item) => item.id === caseId ? { ...item, ...updates } : item));
    if (nextStage === "الخدمات" && !prescriptions.some((row) => row[1] === currentCase.patient)) {
      const prescriptionId = `RX-2025-${currentCase.mrn.slice(-4)}`;
      setPrescriptions((rows) => [[prescriptionId, currentCase.patient, "د. ليان المطيري", "٢ صنف", "معتمدة", "الآن"], ...rows]);
      setDispensingQueue((rows) => [[prescriptionId, currentCase.patient, "٢ صنف", currentCase.insurance === "نقدي" ? "نقدي" : "تأمين", "بانتظار التجهيز"], ...rows]);
    }
    notify(`انتقلت حالة ${currentCase.patient} إلى ${nextStage}`);
  };

  return (
    <main dir="rtl" className="min-h-screen bg-[#f3f7fb] text-[#152f33]">
      <div className="flex min-h-screen">
        <aside className={cn("hidden shrink-0 border-l border-[#263650] bg-[#101b2e] transition-all duration-300 lg:flex lg:flex-col", collapsed ? "w-[88px]" : "w-[264px]")}>
          <div className={cn("flex h-[76px] items-center border-b border-[#263650] px-5", collapsed ? "justify-center" : "justify-between")}>
            <div className={cn("flex items-center gap-3", collapsed && "justify-center")}>
              <div className="relative flex h-11 w-11 items-center justify-center rounded-[15px] bg-[#0d6f68] text-white shadow-[0_8px_20px_rgba(13,111,104,0.22)]">
                <Activity className="h-6 w-6" strokeWidth={2.5} />
                <span className="absolute bottom-1.5 left-1.5 h-1.5 w-1.5 rounded-full bg-[#f5b54b]" />
              </div>
              {!collapsed && <div><div className="text-[19px] font-bold tracking-[-0.03em] text-white">زين كير</div><div className="text-[10px] font-semibold tracking-[0.14em] text-[#7e91ad]">ZAINCARE</div></div>}
            </div>
            {!collapsed && <button aria-label="طي القائمة" onClick={() => setCollapsed(true)} className="rounded-lg p-2 text-[#8ba4a2] transition hover:bg-[#f1f7f5] hover:text-[#0d6f68]"><PanelRightClose className="h-5 w-5" /></button>}
          </div>

          {collapsed && <button aria-label="فتح القائمة" onClick={() => setCollapsed(false)} className="mx-auto mt-5 rounded-lg p-2 text-[#8ba4a2] transition hover:bg-[#f1f7f5] hover:text-[#0d6f68]"><PanelRightOpen className="h-5 w-5" /></button>}

          <div className={cn("min-h-0 flex-1 overflow-y-auto px-3 pt-5", collapsed && "px-2")}>
            {!collapsed && <div className="mb-3 px-3 text-[11px] font-bold tracking-[0.08em] text-[#7e91ad]">مساحة العمل</div>}
            <nav className="space-y-2 pb-5">
              {navGroups.map((group) => {
                const isOpen = collapsed || openNavSections.includes(group.section);
                const hasActiveItem = group.items.some((item) => item.label === safeActiveItem);
                return <div key={group.section} className={cn(!collapsed && "rounded-xl", hasActiveItem && !collapsed && "bg-[#14233a]")}>
                  {!collapsed && <button onClick={() => setOpenNavSections((sections) => sections.includes(group.section) ? sections.filter((section) => section !== group.section) : [...sections, group.section])} className={cn("flex w-full items-center justify-between rounded-xl px-3 py-3 text-[11px] font-bold transition", hasActiveItem ? "text-[#70b7e4]" : "text-[#8193ad] hover:bg-[#192943] hover:text-[#b9cce2]")}><span>{group.section}</span><ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-180")} /></button>}
                  {isOpen && <div className={cn("space-y-1", !collapsed && "px-1 pb-2")}>{group.items.map((item) => {
                    const Icon = item.icon;
                    const active = item.label === safeActiveItem;
                    return <button key={item.label} onClick={() => setActiveItem(item.label)} title={collapsed ? item.label : undefined} className={cn("group flex w-full items-center rounded-xl text-right text-[12px] font-semibold transition", collapsed ? "justify-center px-2 py-3" : "gap-3 px-3 py-2.5", active ? "bg-[#245d9b] text-white" : "text-[#b9c5d7] hover:bg-[#192943] hover:text-white")}><Icon className={cn("h-[17px] w-[17px] shrink-0", active ? "text-white" : "text-[#8092ac] group-hover:text-[#c5d2e3]")} strokeWidth={active ? 2.3 : 1.9} />{!collapsed && <><span className="flex-1">{item.label}</span>{item.badge && <span className={cn("rounded-md px-1.5 py-0.5 text-[9px]", active ? "bg-white/15 text-white" : "bg-[#1b2a43] text-[#91a4be]")}>{item.badge}</span>}</>}</button>;
                  })}</div>}
                </div>;
              })}
            </nav>
          </div>

          <div className={cn("mt-auto p-3", collapsed && "p-2")}>
            {!collapsed && <div className="mb-4 rounded-2xl bg-[#172741] p-4"><div className="mb-2 flex items-center gap-2 text-[#87d4c7]"><Sparkles className="h-4 w-4" /><span className="text-xs font-bold">مساحة النمو</span></div><p className="text-[11px] leading-5 text-[#a7b6ca]">أكمل إعداد قنوات الواتساب لرفع معدل تذكير المرضى.</p><button onClick={() => setModal("clinic")} className="mt-3 text-[11px] font-bold text-[#87d4c7]">إكمال الإعداد <ArrowUpLeft className="mr-1 inline h-3 w-3" /></button></div>}
            {access.canAccess(settingsModule.featureKey, settingsModule.requiredPermission) && <button onClick={() => setActiveItem("الإعدادات")} className={cn("flex w-full items-center rounded-xl text-[#aab8ca] hover:bg-[#192943]", collapsed ? "justify-center p-3" : "gap-3 px-3 py-3")}><Settings2 className="h-[18px] w-[18px]" /><span className={cn("text-[13px] font-semibold", collapsed && "sr-only")}>الإعدادات</span></button>}
            <button onClick={() => notify("مركز المساعدة متاح من خلال مدير الحساب والدعم الفني")} className={cn("flex w-full items-center rounded-xl text-[#aab8ca] hover:bg-[#192943]", collapsed ? "justify-center p-3" : "gap-3 px-3 py-3")}><HelpCircle className="h-[18px] w-[18px]" /><span className={cn("text-[13px] font-semibold", collapsed && "sr-only")}>مركز المساعدة</span></button>
          </div>
        </aside>

        <section className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-[#e6efed] bg-[#f3f7fb]/95 px-5 backdrop-blur-md sm:px-8 lg:px-10">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-[#0d6f68] text-white lg:hidden"><Activity className="h-5 w-5" /></div>
              <div className="hidden min-w-0 items-center gap-2 text-sm text-[#88a19e] sm:flex"><span>مساحة العمل</span><ChevronLeft className="h-4 w-4" /><span className="font-bold text-[#355b5b]">{activeLabel}</span></div>
              <div className="flex items-center gap-2 sm:hidden"><div className="text-[17px] font-bold text-[#123f42]">زين كير</div><span className="rounded-full bg-[#e6f4f1] px-2 py-1 text-[10px] font-bold text-[#0d716a]">مدير العيادة</span></div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="relative hidden h-10 items-center rounded-xl border border-[#dfebe8] bg-white px-3 sm:flex sm:w-[218px]"><Search className="ml-2 h-4 w-4 text-[#99afac]" /><input aria-label="بحث عام" value={globalQuery} onChange={(event) => setGlobalQuery(event.target.value)} onKeyDown={(event) => { if (event.key !== "Enter") return; const match = accessibleNavigation.find((item) => item.label.includes(globalQuery.trim())); if (match) { setActiveItem(match.label); setGlobalQuery(""); notify(`تم فتح وحدة ${match.label}`); } else notify("لم يتم العثور على وحدة بهذا الاسم"); }} className="w-full bg-transparent text-xs outline-none placeholder:text-[#a9bcba]" placeholder="ابحث في زين كير..." /></div>
              <button aria-label="البحث" onClick={() => notify("اكتب اسم الوحدة ثم اضغط Enter للانتقال إليها")} className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#dfebe8] bg-white text-[#799693] sm:hidden"><Search className="h-4 w-4" /></button>
              <div className="relative">
                <button aria-label="الإشعارات" onClick={() => setShowNotifications((value) => !value)} className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-[#dfebe8] bg-white text-[#799693] transition hover:border-[#aad8d1] hover:text-[#0d716a]"><Bell className="h-[17px] w-[17px]" /><span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[#e98b66] ring-2 ring-white" /></button>
                {showNotifications && <div className="absolute left-0 top-12 z-30 w-[280px] rounded-2xl border border-[#deebe8] bg-white p-4 shadow-[0_18px_45px_rgba(29,72,72,0.13)]"><div className="mb-3 flex items-center justify-between"><span className="font-bold text-[#234b4b]">التنبيهات</span><span className="text-[10px] font-bold text-[#0d716a]">٣ جديدة</span></div><div className="space-y-3"><div className="flex gap-3 border-b border-[#eff4f3] pb-3"><div className="rounded-lg bg-[#fff1e7] p-2 text-[#df865b]"><AlertTriangle className="h-4 w-4" /></div><p className="text-[11px] leading-5 text-[#547371]">نتيجة مختبر غير طبيعية تحتاج مراجعة الطبيب.</p></div><div className="flex gap-3"><div className="rounded-lg bg-[#e8f6f2] p-2 text-[#0d857b]"><CheckCircle2 className="h-4 w-4" /></div><p className="text-[11px] leading-5 text-[#547371]">تم تأكيد موعد نورة الغامدي.</p></div></div></div>}
              </div>
              <div className="hidden h-8 w-px bg-[#dfeae8] sm:block" />
              <div className="relative"><button onClick={() => setShowProfileMenu((value) => !value)} className="flex items-center gap-2 rounded-xl p-1 transition hover:bg-white"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#d9eeea] text-xs font-bold text-[#0d716a]">أم</div><div className="hidden text-right sm:block"><div className="max-w-[150px] truncate text-[9px] font-bold text-[#0d716a]">مركز اسناني المميز</div><div className="text-[12px] font-bold text-[#345a59]">أحمد المطيري</div><div className="text-[9px] text-[#92a9a6]">مالك العيادة</div></div><ChevronDown className="hidden h-4 w-4 text-[#9db2af] sm:block" /></button>{showProfileMenu && <div className="absolute left-0 top-12 z-30 w-52 rounded-2xl border border-[#deebe8] bg-white p-2 shadow-[0_18px_45px_rgba(29,72,72,0.13)]"><button onClick={() => { setShowProfileMenu(false); setActiveItem("الإعدادات"); }} className="w-full rounded-xl px-3 py-2 text-right text-[11px] font-bold text-[#557673] hover:bg-[#f1f8f6]">الملف والإعدادات</button>{access.needsOnboarding && <button onClick={() => { setShowProfileMenu(false); navigate("/onboarding"); }} className="w-full rounded-xl px-3 py-2 text-right text-[11px] font-bold text-[#0d716a] hover:bg-[#f1f8f6]">إعداد منشأة جديدة</button>}<button onClick={() => { setShowProfileMenu(false); if (access.legacyMode) navigate("/onboarding"); else void access.signOut(); }} className="w-full rounded-xl px-3 py-2 text-right text-[11px] font-bold text-[#d77e65] hover:bg-[#fff3ef]">{access.legacyMode ? "تسجيل الدخول أو إعداد منشأة" : "تسجيل الخروج"}</button></div>}</div>
            </div>
          </header>

          <div className="mx-auto max-w-[1500px] px-5 pb-12 pt-7 sm:px-8 lg:px-10 lg:pt-9">
            {safeActiveItem === "الرئيسية" ? <>
            <ReferenceOverview branch={branch} onPatient={openPatientForm} onAppointment={openAppointmentForm} onClinic={() => setModal("clinic")} onPrescription={() => setClinicalModal("prescription")} onFinance={() => setActiveItem("الفوترة والمدفوعات")} onStaff={() => setActiveItem("الموظفون")} onLab={() => setActiveItem("المختبر")} />
            <div className="hidden">
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
                <div className="mb-5 flex items-start justify-between"><div><div className="flex items-center gap-2"><h2 className="text-[16px] font-bold text-[#234b4b]">الطابور المباشر</h2><span className="flex h-5 items-center rounded-full bg-[#e6f6f1] px-2 text-[10px] font-bold text-[#0d857b]">مباشر</span></div><p className="mt-1 text-[11px] text-[#96aaa8]">تحديث تلقائي كل ٣٠ ثانية</p></div><button onClick={() => setActiveItem("الاستقبال والانتظار")} className="rounded-lg p-1.5 text-[#9ab0ad] hover:bg-[#f3f8f7] hover:text-[#0d716a]"><MoreHorizontal className="h-5 w-5" /></button></div>
                <div className="mb-5 flex items-center gap-4 rounded-2xl bg-[#f0f8f6] p-4"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-[21px] font-bold text-[#0d716a] shadow-sm">A-017</div><div className="min-w-0 flex-1"><div className="text-[12px] font-bold text-[#2d5958]">المريض الحالي</div><div className="mt-1 flex items-center gap-1 text-[11px] text-[#76938f]"><Stethoscope className="h-3.5 w-3.5" /> د. ليان المطيري · غرفة ٣</div></div><div className="text-left"><div className="text-[10px] text-[#90aaa5]">الحالة</div><div className="mt-1 text-[11px] font-bold text-[#0d857b]">في الغرفة</div></div></div>
                <div className="mb-3 flex items-center justify-between text-[11px] font-bold text-[#89a4a0]"><span>التالي في الطابور</span><span>وقت الانتظار المتوقع</span></div>
                <div className="space-y-2">{queue.slice(1).map((item) => <div key={item.number} className="flex items-center gap-3 rounded-xl border border-[#edf3f1] px-3 py-3"><div className="flex h-9 w-10 items-center justify-center rounded-lg bg-[#f7f9f8] text-[11px] font-bold text-[#4d7370]">{item.number}</div><div className="flex-1"><div className="text-[12px] font-bold text-[#426765]">{item.patient}</div><div className="mt-0.5 text-[10px] text-[#9bb0ad]">{item.doctor}</div></div><div className="text-left text-[11px] font-bold text-[#779490]">{item.wait}</div></div>)}</div>
                <button onClick={() => setActiveItem("الاستقبال والانتظار")} className="mt-4 w-full rounded-xl bg-[#0d716a] py-3 text-[11px] font-bold text-white transition hover:bg-[#095d58]">إدارة الطابور</button>
              </section>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)]">
              <section className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 shadow-[0_4px_18px_rgba(30,73,72,0.025)] sm:p-6"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-[16px] font-bold text-[#234b4b]">أداء العيادة</h2><p className="mt-1 text-[11px] text-[#96aaa8]">مقارنة آخر ٧ أيام</p></div><button className="flex items-center gap-1 rounded-lg bg-[#f5f9f8] px-3 py-2 text-[10px] font-bold text-[#789794]">هذا الأسبوع <ChevronDown className="h-3 w-3" /></button></div><div className="flex h-[155px] items-end gap-2 border-b border-[#edf3f1] px-2 pb-2 sm:gap-4"><ChartBar day="السبت" height="52%" value="١٠٫٢ك" /><ChartBar day="الأحد" height="68%" value="١٢٫٤ك" active /><ChartBar day="الإثنين" height="44%" value="٨٫٧ك" /><ChartBar day="الثلاثاء" height="78%" value="١٤٫١ك" /><ChartBar day="الأربعاء" height="61%" value="١١٫٨ك" /><ChartBar day="الخميس" height="88%" value="١٦٫٣ك" /><ChartBar day="الجمعة" height="35%" value="٦٫٢ك" /></div><div className="mt-4 flex items-center justify-between text-[11px] text-[#8ea7a3]"><span>إجمالي الإيرادات</span><span className="font-bold text-[#2c6260]">٧٩٬٧٠٠ ر.س <span className="mr-1 text-[#0d857b]">↑ ١٨٪</span></span></div></section>
              <section className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 shadow-[0_4px_18px_rgba(30,73,72,0.025)] sm:p-6"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-[16px] font-bold text-[#234b4b]">إجراءات سريعة</h2><p className="mt-1 text-[11px] text-[#96aaa8]">أنجز مهامك اليومية بسرعة</p></div><Sparkles className="h-5 w-5 text-[#e5b15a]" /></div><div className="grid grid-cols-2 gap-3"><QuickAction icon={UserRoundPlus} label="تسجيل مريض" tone="teal" onClick={openPatientForm} /><QuickAction icon={CalendarClock} label="حجز موعد" tone="blue" onClick={openAppointmentForm} /><QuickAction icon={ReceiptText} label="إنشاء فاتورة" tone="amber" onClick={() => setActiveItem("الفوترة والمدفوعات")} /><QuickAction icon={FlaskConical} label="نتائج المختبر" tone="purple" onClick={() => setActiveItem("المختبر")} /><QuickAction icon={Building2} label="نوع العيادة" tone="teal" onClick={() => setModal("clinic")} /></div></section>
            </div>

            <div className="mt-6 flex flex-col items-start justify-between gap-3 rounded-[20px] bg-[#e8f5f1] px-5 py-4 sm:flex-row sm:items-center sm:px-6"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-[#0d716a]"><MapPin className="h-4 w-4" /></div><div><p className="text-[12px] font-bold text-[#2d625e]">أنت تعمل الآن من {branch}</p><p className="mt-1 text-[10px] text-[#6f9690]">آخر مزامنة للبيانات: منذ دقيقة واحدة</p></div></div><button className="flex items-center gap-1 text-[11px] font-bold text-[#0d716a]">تغيير الفرع <ArrowUpLeft className="h-3.5 w-3.5" /></button></div>
            </div>
            </> : <ModuleView activeItem={safeActiveItem} branch={branch} onPatient={openPatientForm} onAppointment={openAppointmentForm} onClinic={() => setModal("clinic")} newPatient={recentPatient} patientCount={patientCount} services={services} radiologyOrders={radiologyOrders} stock={stock} prescriptions={prescriptions} dispensingQueue={dispensingQueue} onCreate={(type) => setClinicalModal(type)} onUpdateDispensing={updateDispensingStatus} onScanPrescription={scanPrescription} onNavigate={setActiveItem} workflowCases={workflowCases} onAdvanceWorkflow={advanceWorkflow} />}
          </div>
        </section>
      </div>
      {toast && <div role="status" className="fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-2xl bg-[#163f42] px-4 py-3 text-[12px] font-bold text-white shadow-[0_14px_35px_rgba(22,63,66,0.24)]"><CheckCircle2 className="h-4 w-4 text-[#72d2bb]" />{toast}</div>}
      {modal === "patient" && <PatientModal onClose={() => setModal(null)} onCreated={handlePatientCreated} />}
      {modal === "appointment" && <AppointmentModal onClose={() => setModal(null)} onCreated={handleAppointmentCreated} />}
      {modal === "clinic" && <ClinicProfileModal onClose={() => setModal(null)} onSaved={(profile) => notify(`تم تفعيل ملف ${profile} وتحديث الوحدات`)} />}
      {clinicalModal && <ClinicalEntryModal type={clinicalModal} onClose={() => setClinicalModal(null)} onCreated={(row, payment) => { setClinicalModal(null); handleClinicalCreated(clinicalModal, row, payment); }} />}
    </main>
  );
}

function ReferenceOverview({ branch, onPatient, onAppointment, onClinic, onPrescription, onFinance, onStaff, onLab }: { branch: string; onPatient: () => void; onAppointment: () => void; onClinic: () => void; onPrescription: () => void; onFinance: () => void; onStaff: () => void; onLab: () => void }) {
  const actions = [["إضافة موعد جديد", CalendarClock, "bg-[#2878b9]", onAppointment], ["حجز مريض جديد", UserRoundPlus, "bg-[#7957bd]", onPatient], ["إضافة عيادة", Building2, "bg-[#29958c]", onClinic], ["وصفة طبية", FileText, "bg-[#d48739]", onPrescription], ["إضافة فاتورة", ReceiptText, "bg-[#d45d68]", onFinance], ["إضافة موظف", UserCog, "bg-[#41967d]", onStaff]] as const;
  return <div className="mb-8 space-y-4"><div className="flex gap-2 overflow-x-auto pb-1">{actions.map(([label, Icon, color, action]) => <button key={label} onClick={action} className={cn("flex min-w-max items-center gap-1.5 rounded-full px-3.5 py-2 text-[10px] font-bold text-white shadow-sm transition hover:-translate-y-0.5", color)}><Icon className="h-3.5 w-3.5" />{label}</button>)}</div><div className="grid grid-cols-1 gap-4 lg:grid-cols-3"><AdminOverview branch={branch} /><RefCard title="دليل المستخدمين" tone="blue" icon={UsersRound}><RefRow label="إجمالي المستخدمين" value="٦٣" icon={UserCog} /><RefRow label="إجمالي المرضى" value="١٣٢" icon={UsersRound} /><RefRow label="أفراد العائلة" value="٣٤" icon={UserPlus} /></RefCard><RefCard title="الكيانات الطبية" tone="mint" icon={Building2}><RefRow label="الأطباء" value="٢٢" detail="نشط ٢٢ · الإجمالي ٢٢" icon={Stethoscope} /><RefRow label="العيادات" value="١٠" detail="نشط ١٠ · الإجمالي ١٠" icon={Building2} /><RefRow label="الأقسام" value="١٠" detail="نشط ١٠ · الإجمالي ١٠" icon={ClipboardList} /><button onClick={onLab} className="text-[9px] font-bold text-[#267c76]">فتح المختبر</button></RefCard><RefCard title="النظرة المالية" tone="mint" icon={WalletCards}><RefRow label="الفواتير" value="٦١٣" icon={ReceiptText} /><RefRow label="المدفوعات" value="٥٤٩" icon={CreditCard} /><RefRow label="المعاملات" value="٥٧٦" icon={Banknote} /></RefCard><RefCard title="المحتوى والتصنيفات" tone="purple" icon={SlidersHorizontal}><RefRow label="التخصصات" value="٨" icon={Sparkles} /><RefRow label="تصنيفات الأمراض" value="٥" detail="نشط ٥ · الإجمالي ٥" icon={Activity} /><RefRow label="تصنيفات المدونة" value="٣" detail="نشط ٣ · الإجمالي ٣" icon={Newspaper} /><RefRow label="لافتات التطبيق" value="٦" icon={PanelRightOpen} /></RefCard><RefCard title="أداء المدونة" tone="blue" icon={Newspaper}><RefRow label="إجمالي المقالات" value="٥" icon={FileText} /><RefRow label="منشور" value="٤" icon={CheckCircle2} /><RefRow label="بانتظار المراجعة" value="٠" icon={Clock3} /><RefRow label="مسودات" value="١" icon={FileText} /><RefRow label="مرفوض" value="٠" icon={X} /></RefCard></div></div>;
}
function RefCard({ title, tone, icon: Icon, children }: { title: string; tone: "blue" | "mint" | "purple"; icon: typeof LayoutDashboard; children: ReactNode }) {
  return <section className={cn("min-h-[210px] overflow-hidden rounded-[14px] border border-[#dceaf0]", tone === "mint" ? "bg-[#eefaf7]" : tone === "purple" ? "bg-[#f3f1fb]" : "bg-[#edf6fc]")}><div className="flex h-10 items-center justify-between bg-gradient-to-l from-[#164b7b] to-[#276ca2] px-4 text-white"><h3 className="text-[10px] font-bold">{title}</h3><span className="rounded-md bg-white/15 p-1.5"><Icon className="h-3.5 w-3.5" /></span></div><div className="space-y-3 p-4">{children}</div></section>;
}
function RefRow({ label, value, detail, icon: Icon }: { label: string; value: string; detail?: string; icon: typeof LayoutDashboard }) {
  return <div className="flex items-center justify-between gap-2 text-[10px]"><span className="flex items-center gap-2 text-[#708796]"><Icon className="h-3 w-3 text-[#4385b9]" />{label}</span><span className="text-left"><b className="text-[#1f3444]">{value}</b>{detail && <small className="mr-2 text-[7px] text-[#43a47e]">{detail}</small>}</span></div>;
}
function AdminOverview({ branch }: { branch: string }) {
  return <section className="min-h-[210px] overflow-hidden rounded-[14px] border border-[#d6e7ef] bg-[#f8fbfd]"><div className="bg-gradient-to-l from-[#164b7b] via-[#24699f] to-[#2376ae] px-5 py-5 text-white"><div className="flex items-center justify-between"><div><div className="text-[8px] text-[#b9d8eb]">لوحة تحكم المدير</div><h3 className="mt-1 text-[18px] font-bold">مدير النظام</h3><div className="text-[7px] tracking-[0.12em] text-[#c7e1f0]">SUPER ADMIN</div></div><div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white/60 bg-[#d9eef4] font-bold text-[#24699f]">أم</div></div></div><div className="grid grid-cols-2 px-5 py-4 text-center"><div><small className="text-[#79909d]">إجمالي المرضى</small><b className="block text-[17px]">١٣٢</b></div><div><small className="text-[#79909d]">أفراد العائلة</small><b className="block text-[17px]">٣٤</b></div></div><div className="border-t px-4 py-2 text-[7px] text-[#91a4af]">{branch}</div></section>;
}

function MiniStat({ value, label, icon: Icon }: { value: string; label: string; icon: typeof UsersRound }) {
  return <div className="px-2 text-center"><div className="flex items-center justify-center gap-1 text-[18px] font-bold text-[#214662]">{value}<Icon className="h-3 w-3 text-[#397fbd]" /></div><div className="mt-1 text-[9px] text-[#7895a7]">{label}</div></div>;
}

function DirectoryView({ activeItem, branch }: { activeItem: string; branch: string }) {
  const [query, setQuery] = useState("");
  const [filteredMode, setFilteredMode] = useState(false);
  const content = { الأطباء: { title: "دليل الأطباء", eyebrow: "الكوادر الطبية", description: "الأطباء والتخصصات والتراخيص حسب الفرع", action: "إضافة طبيب", rows: [["د. ليان المطيري", "جلدية وتجميل", "الرياض · جدة", "نشط"], ["د. عمر الحربي", "طب عام", "الرياض", "نشط"], ["د. ريم الزهراني", "تجميل وليزر", "جدة", "إجازة"]] }, "الأقسام والعيادات": { title: "الأقسام والعيادات", eyebrow: "الكيانات الطبية", description: `${branch} · المرافق والأقسام والغرف`, action: "إضافة عيادة", rows: [["عيادة الجلدية", "الرياض", "غرفة ٣", "نشطة"], ["عيادة طب الأطفال", "الرياض", "غرفة ١", "نشطة"], ["قسم المختبر", "جدة", "مختبر مركزي", "نشط"]] }, الموظفون: { title: "دليل الموظفين", eyebrow: "دليل المستخدمين", description: "المستخدمون والأدوار ونطاق الوصول", action: "دعوة موظف", rows: [["أحمد المطيري", "مالك العيادة", "كل الفروع", "نشط"], ["ريم السبيعي", "استقبال", "الرياض", "نشط"], ["عمر الحربي", "محاسب", "كل الفروع", "دعوة معلقة"]] }, "الأمراض والتشخيص": { title: "الأمراض والتشخيص", eyebrow: "القاموس الطبي", description: "قائمة التشخيصات المستخدمة في السجل الطبي والمطالبات", action: "إضافة تشخيص", rows: [["السكري من النوع الثاني", "E11", "ICD-10", "نشط"], ["ارتفاع ضغط الدم", "I10", "ICD-10", "نشط"], ["التهاب الجلد", "L30", "ICD-10", "نشط"]] } }[activeItem as "الأطباء" | "الأقسام والعيادات" | "الموظفون" | "الأمراض والتشخيص"];
  return <><ViewHeader eyebrow={content.eyebrow} title={content.title} description={content.description} action={content.action} icon={activeItem === "الأطباء" ? Stethoscope : activeItem === "الموظفون" ? UserCog : activeItem === "الأمراض والتشخيص" ? ClipboardList : Building2} /><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-[16px] font-bold text-[#234b4b]">السجل الكامل</h2><p className="mt-1 text-[11px] text-[#96aaa8]">بيانات تجريبية قابلة للتوسع محليًا</p></div><div className="flex gap-2"><div className="flex h-10 items-center rounded-xl border border-[#dfebe8] px-3"><Search className="ml-2 h-4 w-4 text-[#9bb1ae]" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="w-40 bg-transparent text-xs outline-none" placeholder="بحث..." /></div><button type="button" onClick={() => setFilteredMode((value) => !value)} aria-label="تصفية السجل" className={cn("rounded-xl border px-3 text-[11px] font-bold", filteredMode ? "border-[#8acbc1] bg-[#e6f4f1] text-[#0d716a]" : "border-[#dfebe8] text-[#6d8b88]")}><SlidersHorizontal className="h-4 w-4" /></button></div></div><div className="space-y-2">{content.rows.filter((row) => (!query.trim() || row.join(" ").includes(query.trim())) && (!filteredMode || ["نشط", "نشطة"].includes(row[row.length - 1]))).map((row) => <div key={row[0]} className="flex flex-col gap-3 rounded-xl border border-[#edf3f1] p-4 sm:flex-row sm:items-center"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#e6f4f1] text-[#0d857b]"><Building2 className="h-4 w-4" /></div><div className="flex-1"><div className="text-[12px] font-bold text-[#426765]">{row[0]}</div><div className="mt-1 text-[10px] text-[#9aafac]">{row[1]} · {row[2]}</div></div><StatusPill tone={row[3] === "إجازة" || row[3] === "دعوة معلقة" ? "amber" : "teal"}>{row[3]}</StatusPill><button className="text-[10px] font-bold text-[#0d716a]">عرض التفاصيل</button></div>)}</div></div></>;
}

function ContentView({ branch }: { branch: string }) {
  return <><ViewHeader eyebrow="المحتوى والتصنيف" title="إدارة المحتوى" description={`${branch} · المدونة والخدمات والأسئلة الشائعة`} action="مقالة جديدة" icon={Newspaper} /><div className="grid gap-4 md:grid-cols-3"><SummaryCards items={[{ label: "مقالات منشورة", value: "٢٤", note: "٣ مسودات", tone: "bg-[#7654ba]" }, { label: "الخدمات النشطة", value: "١٨", note: "متاحة للحجز", tone: "bg-[#0d857b]" }, { label: "الأسئلة الشائعة", value: "٣٦", note: "بالعربية والإنجليزية", tone: "bg-[#d36c83]" }]} /></div><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><h2 className="text-[16px] font-bold text-[#234b4b]">آخر المحتوى</h2><div className="mt-5 grid gap-3 sm:grid-cols-3"><ContentTile title="متى تحتاج إلى فحص البشرة؟" type="مقالة" status="منشور" /><ContentTile title="خدمات عيادة الجلدية" type="خدمة" status="نشطة" /><ContentTile title="أسئلة التأمين الشائعة" type="صفحة" status="مراجعة" /></div></div></>;
}

function ContentTile({ title, type, status }: { title: string; type: string; status: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [savedTitle, setSavedTitle] = useState(() => typeof window === "undefined" ? title : window.localStorage.getItem(`zaincare-content-${title}`) ?? title);
  const save = () => { setSavedTitle(draft); window.localStorage.setItem(`zaincare-content-${title}`, draft); setEditing(false); };
  return <div className="rounded-xl border border-[#edf3f1] p-4"><div className="mb-4 flex items-center justify-between"><span className="rounded-md bg-[#f3effb] px-2 py-1 text-[9px] font-bold text-[#7654ba]">{type}</span><StatusPill tone={status === "مراجعة" ? "amber" : "teal"}>{status}</StatusPill></div>{editing ? <input value={draft} onChange={(event) => setDraft(event.target.value)} className={formControlClass()} /> : <div className="text-[12px] font-bold leading-5 text-[#426765]">{savedTitle}</div>}<div className="mt-4 flex gap-2">{editing && <button onClick={save} className="rounded-lg bg-[#0d716a] px-3 py-2 text-[9px] font-bold text-white">حفظ</button>}<button onClick={() => { setDraft(savedTitle); setEditing((value) => !value); }} className="text-[10px] font-bold text-[#0d716a]">{editing ? "إلغاء" : "تحرير المحتوى"} <ChevronLeft className="mr-1 inline h-3 w-3" /></button></div></div>;
}

function ReportsView({ branch }: { branch: string }) {
  return <><ViewHeader eyebrow="التقارير والتحليلات" title="التقارير" description={`${branch} · مؤشرات الأداء والمالية والعمليات`} action="إنشاء تقرير" icon={BarChart3} /><SummaryCards items={[{ label: "تغطية التقارير", value: "٩٤٪", note: "بيانات مكتملة", tone: "bg-[#0d857b]" }, { label: "استخدام الأطباء", value: "٧٨٪", note: "هذا الشهر", tone: "bg-[#397fbd]" }, { label: "رضا المرضى", value: "٤٫٨ / ٥", note: "من ١٤٢ تقييمًا", tone: "bg-[#e5b15a]" }, { label: "حالات عدم الحضور", value: "٦٪", note: "تحسن ٢٪", tone: "bg-[#7654ba]" }]} /><div className="grid gap-4 md:grid-cols-2"><ReportCard title="أداء المواعيد" detail="٣٨ موعدًا اليوم · ٨٩٪ مكتملة" bars={[45, 72, 58, 88, 66, 78, 54]} tone="teal" /><ReportCard title="الإيرادات حسب الفرع" detail="الرياض ٥٤٪ · جدة ٣١٪ · دبي ١٥٪" bars={[82, 54, 34]} tone="blue" /></div></>;
}

function ReportCard({ title, detail, bars, tone }: { title: string; detail: string; bars: number[]; tone: "teal" | "blue" }) {
  return <section className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><h2 className="text-[16px] font-bold text-[#234b4b]">{title}</h2><p className="mt-1 text-[11px] text-[#96aaa8]">{detail}</p><div className="mt-6 flex h-28 items-end gap-3">{bars.map((height, index) => <div key={index} className={cn("flex-1 rounded-t-lg", tone === "teal" ? "bg-[#cdebe4]" : "bg-[#d7e8f3]", index === bars.length - 1 && (tone === "teal" ? "bg-[#0d857b]" : "bg-[#397fbd]"))} style={{ height: `${height}%` }} />)}</div></section>;
}

function ServicesView({ branch, rows, onAdd }: { branch: string; rows: ClinicalRows; onAdd: () => void }) {
  return <><ViewHeader eyebrow="الكتالوج الطبي" title="الخدمات والأسعار" description={`${branch} · الخدمات المتاحة للحجز والفوترة والتأمين`} action="إضافة خدمة" icon={ReceiptText} onAction={onAdd} /><SummaryCards items={[{ label: "الخدمات النشطة", value: toArabicNumber(rows.filter((row) => row[5] === "نشطة").length), note: "في هذا العرض", tone: "bg-[#0d857b]" }, { label: "خدمات التأمين", value: "١٢", note: "مرتبطة برموز المطالبات", tone: "bg-[#397fbd]" }, { label: "الخدمات الرقمية", value: "٠٥", note: "متاحة للحجز الإلكتروني", tone: "bg-[#7654ba]" }, { label: "تحتاج مراجعة", value: toArabicNumber(rows.filter((row) => row[5] !== "نشطة").length), note: "تسعير أو مدة ناقصة", tone: "bg-[#e5b15a]" }]} /><ModuleTable title="دليل الخدمات" description="السعر والمدة والفرع والتخصص" columns={["الخدمة", "التخصص", "المدة", "السعر", "الفروع", "الحالة"]} rows={rows} /></>;
}

function RadiologyView({ branch, orders, onAdd }: { branch: string; orders: ClinicalRows; onAdd: () => void }) {
  return <><ViewHeader eyebrow="الأشعة والتصوير الطبي" title="مركز الأشعة" description={`${branch} · الطلبات والتقارير وجدولة أجهزة التصوير`} action="طلب أشعة" icon={Activity} onAction={onAdd} /><SummaryCards items={[{ label: "طلبات اليوم", value: toArabicNumber(orders.length), note: "مرتبطة بالزيارات", tone: "bg-[#397fbd]" }, { label: "قيد التنفيذ", value: toArabicNumber(orders.filter((row) => row[4] === "قيد التنفيذ").length), note: "على الأجهزة", tone: "bg-[#0d857b]" }, { label: "بانتظار التقرير", value: toArabicNumber(orders.filter((row) => row[4] === "بانتظار التقرير").length), note: "يحتاج مراجعة", tone: "bg-[#e5b15a]" }, { label: "الأجهزة المتاحة", value: "٠٦ / ٠٧", note: "جهاز واحد للصيانة", tone: "bg-[#7654ba]" }]} /><ModuleTable title="طلبات الأشعة" description="كل طلب مرتبط بالزيارة والطبيب والمريض" columns={["رقم الطلب", "المريض", "الفحص", "الطبيب", "الحالة", "الموعد"]} rows={orders} /></>;
}

function PharmacyView({ branch, stock, onAdd }: { branch: string; stock: ClinicalRows; onAdd: () => void }) {
  return <><ViewHeader eyebrow="الصيدلية والمخزون" title="الصيدلية" description={`${branch} · المخزون والدفعات والصرف بنظام FEFO`} action="إضافة دواء" icon={Package} onAction={onAdd} /><SummaryCards items={[{ label: "الأصناف النشطة", value: toArabicNumber(stock.length), note: "أدوية ومستلزمات", tone: "bg-[#0d857b]" }, { label: "منخفض المخزون", value: toArabicNumber(stock.filter((row) => row[5] === "منخفض").length), note: "تحتاج طلب شراء", tone: "bg-[#e5b15a]" }, { label: "تنتهي قريبًا", value: "٠٢", note: "خلال ٩٠ يومًا", tone: "bg-[#d36c83]" }, { label: "قيمة المخزون", value: "٤٨٬٢٠٠", note: "ر.س تقديرية", tone: "bg-[#397fbd]" }]} /><ModuleTable title="مخزون الصيدلية" description="تتبع الدفعات والصلاحية وصرف الأقدم أولاً" columns={["الدواء", "التصنيف", "رقم الدفعة", "الكمية", "الصلاحية", "الحالة"]} rows={stock} /></>;
}

function PrescriptionsView({ branch, prescriptions, onAdd }: { branch: string; prescriptions: ClinicalRows; onAdd: () => void }) {
  return <><ViewHeader eyebrow="الأدوية والوصفات" title="الوصفات الطبية" description={`${branch} · وصفات ثنائية اللغة جاهزة للطباعة والصرف`} action="وصفة جديدة" icon={FileText} onAction={onAdd} /><SummaryCards items={[{ label: "وصفات اليوم", value: toArabicNumber(prescriptions.length), note: "في هذا العرض", tone: "bg-[#0d857b]" }, { label: "بانتظار الصرف", value: toArabicNumber(prescriptions.filter((row) => ["معتمدة", "بانتظار الصرف", "قيد التجهيز", "جاهزة للتسليم"].includes(row[4])).length), note: "في طابور الصيدلية", tone: "bg-[#e5b15a]" }, { label: "أدوية موصوفة", value: "٧٢", note: "من الوصفات الحالية", tone: "bg-[#397fbd]" }, { label: "وصفات فيديو", value: "٠٥", note: "وصفة إلكترونية", tone: "bg-[#7654ba]" }]} /><ModuleTable title="آخر الوصفات" description="التوقيع الطبي وحالة الصرف لكل وصفة" columns={["رقم الوصفة", "المريض", "الطبيب", "الأصناف", "الحالة", "التاريخ"]} rows={prescriptions} /></>;
}

function DispensingView({ branch, queueRows, onScan, onUpdate }: { branch: string; queueRows: ClinicalRows; onScan: () => void; onUpdate: (id: string, status: string) => void }) {
  const waiting = queueRows.filter((row) => row[4] === "بانتظار التجهيز").length;
  const ready = queueRows.filter((row) => row[4] === "جاهز للتسليم").length;
  return <><ViewHeader eyebrow="الصيدلية والوصفات" title="صرف الأدوية" description={`${branch} · طابور الوصفات والتسليم للمريض`} action="مسح وصفة QR" icon={ClipboardList} onAction={onScan} /><div className="mb-6 rounded-[22px] border border-[#cfe3ee] bg-[#edf6fb] p-5"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><div className="text-[12px] font-bold text-[#315d77]">طابور الصرف الحالي</div><div className="mt-1 text-[10px] text-[#7794a5]">اختر الإجراء لتحديث الوصفة والطابور معًا</div></div><div className="flex gap-6"><MiniStat value={toArabicNumber(waiting)} label="بانتظار التجهيز" icon={Clock3} /><MiniStat value={toArabicNumber(ready)} label="جاهز" icon={CheckCircle2} /></div></div></div><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 shadow-[0_4px_18px_rgba(30,73,72,0.025)] sm:p-6"><div className="mb-5"><h2 className="text-[16px] font-bold text-[#234b4b]">وصفات بانتظار الصرف</h2><p className="mt-1 text-[11px] text-[#96aaa8]">تحقق من هوية المريض والدواء والدفعة قبل التسليم</p></div><div className="overflow-x-auto"><table className="w-full min-w-[780px] text-right"><thead><tr className="border-b border-[#dbeaf0] bg-[#eaf6fb] text-[10px] font-bold text-[#5d7f91]"><th className="px-3 py-3">الوصفة</th><th className="px-3 py-3">المريض</th><th className="px-3 py-3">الأصناف</th><th className="px-3 py-3">الدفع</th><th className="px-3 py-3">الحالة</th><th className="px-3 py-3">إجراء</th></tr></thead><tbody>{queueRows.map((row) => <tr key={row[0]} className="border-b border-[#f0f4f3] text-[11px] last:border-0"><td className="px-3 py-3.5 font-mono text-[10px] text-[#436f86]" dir="ltr">{row[0]}</td><td className="px-3 py-3.5 font-bold text-[#426765]">{row[1]}</td><td className="px-3 py-3.5 text-[#66817f]">{row[2]}</td><td className="px-3 py-3.5 text-[#66817f]">{row[3]}</td><td className="px-3 py-3.5"><StatusPill tone={row[4] === "تم التسليم" ? "teal" : row[4] === "جاري التجهيز" ? "blue" : row[4] === "جاهز للتسليم" ? "purple" : "amber"}>{row[4]}</StatusPill></td><td className="px-3 py-3.5"><div className="flex gap-2"><button onClick={() => onUpdate(row[0], row[4] === "بانتظار التجهيز" ? "جاري التجهيز" : "جاهز للتسليم")} disabled={row[4] === "تم التسليم"} className="rounded-lg bg-[#e6f4f1] px-3 py-2 text-[10px] font-bold text-[#0d716a] disabled:cursor-not-allowed disabled:opacity-50">{row[4] === "بانتظار التجهيز" ? "بدء التجهيز" : row[4] === "جاري التجهيز" ? "تجهيز مكتمل" : row[4] === "جاهز للتسليم" ? "تأكيد التسليم" : "تم التسليم"}</button><button onClick={() => onUpdate(row[0], "تم التسليم")} disabled={row[4] === "تم التسليم"} className="rounded-lg border border-[#dfece9] px-3 py-2 text-[10px] font-bold text-[#6d8b88] disabled:cursor-not-allowed disabled:opacity-50">تسليم</button></div></td></tr>)}</tbody></table></div></div></>;
}

function downloadCsv(filename: string, columns: string[], rows: string[][]) {
  const csv = [columns, ...rows].map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["\\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function ModuleTable({ title, description, columns, rows }: { title: string; description: string; columns: string[]; rows: string[][] }) {
  const [query, setQuery] = useState("");
  const visibleRows = rows.filter((row) => row.join(" ").includes(query.trim()));
  return <div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 shadow-[0_4px_18px_rgba(30,73,72,0.025)] sm:p-6"><div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h2 className="text-[16px] font-bold text-[#234b4b]">{title}</h2><p className="mt-1 text-[11px] text-[#96aaa8]">{description}</p></div><div className="flex gap-2"><div className="flex h-10 items-center rounded-xl border border-[#dfebe8] px-3"><Search className="ml-2 h-4 w-4 text-[#9bb1ae]" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="w-36 bg-transparent text-xs outline-none" placeholder="بحث..." /></div><button type="button" onClick={() => downloadCsv(`${title}.csv`, columns, visibleRows)} aria-label={`تصدير ${title}`} className="rounded-xl border border-[#dfebe8] px-3 text-[11px] font-bold text-[#6d8b88]"><Download className="h-4 w-4" /></button></div></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-right"><thead><tr className="border-b border-[#dbeaf0] bg-[#eaf6fb] text-[10px] font-bold text-[#5d7f91]">{columns.map((column) => <th key={column} className="px-3 py-3">{column}</th>)}<th className="px-3 py-3">إجراء</th></tr></thead><tbody>{visibleRows.map((row, index) => <tr key={`${row[0]}-${index}`} className="border-b border-[#f0f4f3] text-[11px] last:border-0 hover:bg-[#fbfdfd]">{row.map((cell, cellIndex) => <td key={`${cell}-${cellIndex}`} className={cn("px-3 py-3.5 text-[#66817f]", cellIndex === 0 && "font-mono text-[10px] text-[#436f86]", cellIndex === row.length - 1 && "font-bold text-[#426765]")}>{cellIndex === row.length - 1 ? <StatusPill tone={cell.includes("منخفض") || cell.includes("انتظار") || cell.includes("معلق") ? "amber" : cell.includes("مسودة") ? "purple" : "teal"}>{cell}</StatusPill> : cell}</td>)}<td className="px-3 py-3.5"><button className="text-[10px] font-bold text-[#0d716a]">عرض</button></td></tr>)}</tbody></table></div></div>;
}

type HRRow = string[];

const hrEmployeeSeed: HRRow[] = [
  ["أحمد المطيري", "EMP-0001", "مدير العيادة", "الإدارة", "كل الفروع", "نشط"],
  ["ريم السبيعي", "EMP-0042", "موظفة استقبال", "الاستقبال", "الرياض", "نشط"],
  ["عمر الحربي", "EMP-0018", "طبيب عام", "العيادات", "الرياض", "نشط"],
  ["هند القحطاني", "EMP-0037", "صيدلانية", "الصيدلية", "جدة", "إجازة"],
];

const hrSectionLabels = ["الموظفون", "الحضور والانصراف", "الإجازات", "الرواتب", "العقود والملفات", "التوظيف", "تقييم الأداء", "التدريب والتطوير", "المناوبات والجداول", "تقارير الموارد البشرية"];

function HRTable({ columns, rows, actionLabel, onAction }: { columns: string[]; rows: HRRow[]; actionLabel?: string; onAction?: (row: HRRow) => void }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-right"><thead><tr className="border-b border-[#dbeaf0] bg-[#eaf6fb] text-[10px] font-bold text-[#5d7f91]">{columns.map((column) => <th key={column} className="px-3 py-3">{column}</th>)}{onAction && <th className="px-3 py-3">إجراء</th>}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row[0]}-${index}`} className="border-b border-[#f0f4f3] text-[11px] last:border-0 hover:bg-[#fbfdfd]">{row.map((cell, cellIndex) => <td key={`${cell}-${cellIndex}`} className={cn("px-3 py-3.5 text-[#66817f]", cellIndex === 0 && "font-bold text-[#426765]", cell === "نشط" || cell === "معتمد" || cell === "مكتمل" ? "text-[#3d9573]" : cell === "معلق" || cell === "قيد المراجعة" ? "text-[#c5872e]" : "")}>{cell}</td>)}{onAction && <td className="px-3 py-3.5"><button onClick={() => onAction(row)} className="rounded-lg bg-[#e6f4f1] px-3 py-2 text-[10px] font-bold text-[#0d716a] transition hover:bg-[#cfece5]">{actionLabel}</button></td>}</tr>)}</tbody></table></div>;
}

function HRActionForm({ section, onClose, onSave }: { section: string; onClose: () => void; onSave: (values: string[]) => void }) {
  const labels: Record<string, string[]> = {
    "الموظفون": ["اسم الموظف", "المسمى الوظيفي", "القسم", "الفرع"],
    "الحضور والانصراف": ["الموظف", "وقت الحضور", "نوع الدوام", "ملاحظة"],
    "الإجازات": ["الموظف", "نوع الإجازة", "من تاريخ", "إلى تاريخ"],
    "الرواتب": ["الموظف", "الراتب الأساسي", "البدلات", "الاستقطاعات"],
    "العقود والملفات": ["الموظف", "نوع الوثيقة", "تاريخ الانتهاء", "رقم الوثيقة"],
    "التوظيف": ["المسمى الوظيفي", "القسم", "عدد الشواغر", "مرحلة التوظيف"],
    "تقييم الأداء": ["الموظف", "الدورة", "النتيجة", "ملاحظات المدير"],
    "التدريب والتطوير": ["اسم الدورة", "نوع الدورة", "عدد الموظفين", "تاريخ البدء"],
    "المناوبات والجداول": ["اسم المناوبة", "وقت البداية", "وقت النهاية", "القسم"],
    "تقارير الموارد البشرية": ["اسم التقرير", "من تاريخ", "إلى تاريخ", "الصيغة"],
  };
  const fields = labels[section] ?? ["البيان", "القيمة", "التاريخ", "ملاحظة"];
  const [values, setValues] = useState(["", "", "", ""]);
  return <form onSubmit={(event) => { event.preventDefault(); onSave(values); }} className="mb-6 rounded-[22px] border border-[#b9ded8] bg-white p-5 shadow-[0_10px_30px_rgba(30,73,72,0.08)]"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-[15px] font-bold text-[#234b4b]">{section}</h2><p className="mt-1 text-[10px] text-[#96aaa8]">أكمل الحقول ثم احفظ لإضافة السجل إلى الجدول</p></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-[#8ea7a3] hover:bg-[#f1f7f5]"><X className="h-4 w-4" /></button></div><div className="grid gap-4 sm:grid-cols-2">{fields.map((label, index) => <FormField key={label} label={label} required><input required value={values[index]} onChange={(event) => setValues((current) => current.map((value, fieldIndex) => fieldIndex === index ? event.target.value : value))} className={formControlClass()} /></FormField>)}</div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="h-10 rounded-xl border border-[#dfece9] px-4 text-[10px] font-bold text-[#769390]">إلغاء</button><button type="submit" className="h-10 rounded-xl bg-[#0d716a] px-5 text-[10px] font-bold text-white">حفظ السجل</button></div></form>;
}

function HRView({ activeItem, branch, onNavigate }: { activeItem: string; branch: string; onNavigate: (item: string) => void }) {
  const [employees, setEmployees] = useState<HRRow[]>(hrEmployeeSeed);
  const [attendanceMarked, setAttendanceMarked] = useState(false);
  const [payrollReady, setPayrollReady] = useState(false);
  const [leaveStatuses, setLeaveStatuses] = useState<Record<string, string>>({ "إجازة هند القحطاني": "قيد المراجعة", "إجازة ريم السبيعي": "معتمد" });
  const [note, setNote] = useState("");
  const [showActionForm, setShowActionForm] = useState(false);
  const [extraRows, setExtraRows] = useState<Record<string, HRRow[]>>({});
  const activeSection = hrSectionLabels.includes(activeItem) ? activeItem : "الموظفون";
  const addEmployee = () => {
    setEmployees((current) => [["موظف جديد", `EMP-${String(current.length + 1).padStart(4, "0")}`, "موظف إداري", "الإدارة", branch.replace("فرع ", ""), "نشط"], ...current]);
    setNote("تمت إضافة موظف جديد إلى السجل المحلي");
  };
  const markAttendance = () => {
    setAttendanceMarked(true);
    setNote("تم تسجيل حضور الموظفين المناوبين لهذا اليوم");
  };
  const approveLeave = (row: HRRow) => {
    setLeaveStatuses((current) => ({ ...current, [row[0]]: "معتمد" }));
    setNote(`تم اعتماد طلب ${row[0]}`);
  };
  const section = {
    "الموظفون": { eyebrow: "الموارد البشرية", title: "دليل الموظفين", description: `${branch} · الملفات والأدوار ونطاق الوصول`, action: "إضافة موظف", icon: UserCog },
    "الحضور والانصراف": { eyebrow: "الموارد البشرية", title: "الحضور والانصراف", description: `${branch} · متابعة الحضور والتأخير وساعات العمل`, action: "تسجيل حضور", icon: UserCheck },
    "الإجازات": { eyebrow: "الموارد البشرية", title: "إدارة الإجازات", description: `${branch} · الطلبات والأرصدة ومسار الاعتماد`, action: "طلب إجازة", icon: CalendarCheck2 },
    "الرواتب": { eyebrow: "الموارد البشرية والمالية", title: "الرواتب والمستحقات", description: `${branch} · مسير الرواتب والبدلات والاستقطاعات`, action: payrollReady ? "تم اعتماد المسير" : "اعتماد مسير الرواتب", icon: Banknote },
    "العقود والملفات": { eyebrow: "الموارد البشرية", title: "العقود والملفات", description: `${branch} · الوثائق والتراخيص والتنبيهات`, action: "رفع وثيقة", icon: FileCheck2 },
    "التوظيف": { eyebrow: "الموارد البشرية", title: "التوظيف", description: `${branch} · الوظائف الشاغرة والمرشحون ومراحل المقابلة`, action: "وظيفة شاغرة", icon: UserPlus },
    "تقييم الأداء": { eyebrow: "الموارد البشرية", title: "تقييم الأداء", description: `${branch} · الأهداف والدورات وملاحظات المديرين`, action: "بدء دورة تقييم", icon: Gauge },
    "التدريب والتطوير": { eyebrow: "الموارد البشرية", title: "التدريب والتطوير", description: `${branch} · الدورات والشهادات والامتثال المهني`, action: "إضافة دورة", icon: GraduationCap },
    "المناوبات والجداول": { eyebrow: "الموارد البشرية", title: "المناوبات والجداول", description: `${branch} · جدولة الفرق وتغطية العيادات`, action: "مناوبة جديدة", icon: CalendarRange },
    "تقارير الموارد البشرية": { eyebrow: "الموارد البشرية", title: "تقارير الموارد البشرية", description: `${branch} · مؤشرات القوى العاملة والتكلفة والالتزام`, action: "تصدير التقرير", icon: BarChart3 },
  }[activeSection];
  const handleAction = () => setShowActionForm(true);
  const saveHRAction = (values: string[]) => {
    if (activeSection === "الموظفون") setEmployees((current) => [[values[0], `EMP-${String(current.length + 1).padStart(4, "0")}`, values[1], values[2], values[3], "نشط"], ...current]);
    else if (activeSection === "الحضور والانصراف") { markAttendance(); setExtraRows((current) => ({ ...current, [activeSection]: [[values[0], values[2], values[1], "حاضر"], ...(current[activeSection] ?? [])] })); }
    else if (activeSection === "الرواتب") { setPayrollReady(true); setExtraRows((current) => ({ ...current, [activeSection]: [[values[0], "موظف", `${values[1]} ر.س`, `${values[3]} ر.س`, "معتمد"], ...(current[activeSection] ?? [])] })); }
    else {
      const status = activeSection === "الإجازات" ? "قيد المراجعة" : activeSection === "العقود والملفات" ? "ساري" : activeSection === "التوظيف" ? "نشطة" : activeSection === "تقييم الأداء" ? "قيد المراجعة" : activeSection === "التدريب والتطوير" ? "مفتوحة" : activeSection === "المناوبات والجداول" ? "مجدولة" : "جاهز";
      setExtraRows((current) => ({ ...current, [activeSection]: [[...values, status], ...(current[activeSection] ?? [])] }));
    }
    setNote(`تم حفظ سجل ${activeSection} وربطه محليًا`);
    setShowActionForm(false);
  };
  const attendanceRows = [...(extraRows["الحضور والانصراف"] ?? []), ["أحمد المطيري", "مدير العيادة", attendanceMarked ? "08:42" : "لم يسجل", attendanceMarked ? "حاضر" : "بانتظار التسجيل"], ["ريم السبيعي", "الاستقبال", "08:15", "حاضر"], ["عمر الحربي", "طبيب عام", "09:05", "متأخر ٥ د"]];
  const leaveRows = [...(extraRows["الإجازات"] ?? []), ["إجازة هند القحطاني", "هند القحطاني", "سنوية", "٢٠ - ٢٤ مايو", leaveStatuses["إجازة هند القحطاني"]], ["إجازة ريم السبيعي", "ريم السبيعي", "اضطرارية", "٢٢ مايو", leaveStatuses["إجازة ريم السبيعي"]], ["إجازة عمر الحربي", "عمر الحربي", "علمية", "١ - ٣ يونيو", "معلق"]];
  const payrollRows = [...(extraRows["الرواتب"] ?? []), ["أحمد المطيري", "مدير العيادة", "١٨٬٥٠٠ ر.س", "٠", payrollReady ? "معتمد" : "مسودة"], ["ريم السبيعي", "الاستقبال", "٦٬٨٠٠ ر.س", "٣٠٠ ر.س", payrollReady ? "معتمد" : "مسودة"], ["عمر الحربي", "طبيب عام", "١٥٬٢٠٠ ر.س", "٠", payrollReady ? "معتمد" : "مسودة"]];
  const contractRows = [...(extraRows["العقود والملفات"] ?? []), ["EMP-0001", "أحمد المطيري", "عقد دائم", "٣١ ديسمبر ٢٠٢٦", "ساري"], ["EMP-0042", "ريم السبيعي", "عقد سنوي", "٣٠ يونيو ٢٠٢٦", "ينتهي قريبًا"], ["EMP-0037", "هند القحطاني", "عقد سنوي", "١٥ مايو ٢٠٢٦", "يحتاج تجديد"]];
  const recruitmentRows = [...(extraRows["التوظيف"] ?? []), ["طبيب جلدية", "الجلدية", "٤ مرشحين", "مقابلة", "نشطة"], ["ممرضة عيادة", "التمريض", "٧ مرشحين", "فرز أولي", "نشطة"], ["محاسب فرع", "المالية", "مرشحان", "عرض وظيفي", "قيد الإغلاق"]];
  const performanceRows = [...(extraRows["تقييم الأداء"] ?? []), ["ريم السبيعي", "الاستقبال", "٤٫٦ / ٥", "٩٢٪", "مكتمل"], ["عمر الحربي", "العيادات", "٤٫٨ / ٥", "٩٦٪", "قيد المراجعة"], ["هند القحطاني", "الصيدلية", "٤٫٤ / ٥", "٨٨٪", "لم يبدأ"]];
  const trainingRows = [...(extraRows["التدريب والتطوير"] ?? []), ["سلامة المرضى", "إلزامية", "٢٤ موظفًا", "١٥ يونيو", "مفتوحة"], ["خصوصية البيانات PDPL", "امتثال", "٦٣ موظفًا", "٣٠ يونيو", "مكتملة"], ["الإسعافات الأولية", "سريرية", "١٢ موظفًا", "٧ يوليو", "مفتوحة"]];
  const shiftRows = [...(extraRows["المناوبات والجداول"] ?? []), ["الأحد صباحي", "08:00 - 16:00", "الاستقبال · الجلدية", "٨ موظفين", "مكتملة"], ["الأحد مسائي", "16:00 - 00:00", "الطوارئ · الصيدلية", "٦ موظفين", "تحتاج تغطية"], ["الإثنين صباحي", "08:00 - 16:00", "الأطفال · المختبر", "٧ موظفين", "مكتملة"]];
  const reportCards = [{ label: "إجمالي الموظفين", value: toArabicNumber(employees.length), note: "٤ فئات وظيفية", tone: "bg-[#0d857b]" }, { label: "نسبة الحضور", value: attendanceMarked ? "٩٧٪" : "٩٢٪", note: "هذا الشهر", tone: "bg-[#397fbd]" }, { label: "تكلفة الرواتب", value: "٤٠٫٥ك", note: "ر.س · الشهر الحالي", tone: "bg-[#7654ba]" }, { label: "معدل الدوران", value: "٣٫٢٪", note: "أفضل من الربع السابق", tone: "bg-[#e5b15a]" }];
  return <><ViewHeader eyebrow={section.eyebrow} title={section.title} description={section.description} action={section.action} icon={section.icon} onAction={handleAction} /><div className="mb-6 flex gap-2 overflow-x-auto pb-1">{hrSectionLabels.map((label) => <button key={label} onClick={() => onNavigate(label)} className={cn("min-w-max rounded-xl border px-3 py-2.5 text-[10px] font-bold transition", activeSection === label ? "border-[#0d857b] bg-[#e6f4f1] text-[#0d716a]" : "border-[#e3eeeb] bg-white text-[#789794] hover:border-[#acd8d2]")}>{label}</button>)}</div>{showActionForm && <HRActionForm section={activeSection} onClose={() => setShowActionForm(false)} onSave={saveHRAction} />}{activeSection === "الموظفون" && <><SummaryCards items={[{ label: "إجمالي الموظفين", value: toArabicNumber(employees.length), note: "كل الفروع", tone: "bg-[#0d857b]" }, { label: "الموظفون النشطون", value: "٥٨", note: "جاهزون للعمل", tone: "bg-[#397fbd]" }, { label: "إجازات اليوم", value: "٠٣", note: "تؤثر على التغطية", tone: "bg-[#e5b15a]" }, { label: "وثائق تحتاج تحديث", value: "٠٦", note: "عقود أو تراخيص", tone: "bg-[#d36c83]" }]} /><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><div className="mb-5"><h2 className="text-[16px] font-bold text-[#234b4b]">سجل الموظفين</h2><p className="mt-1 text-[11px] text-[#96aaa8]">الملفات والأدوار والصلاحيات حسب الفرع</p></div><HRTable columns={["الموظف", "الرقم", "المسمى الوظيفي", "القسم", "الفرع", "الحالة"]} rows={employees} actionLabel="فتح الملف" onAction={() => setNote("تم فتح ملف الموظف محليًا")} /></div></>}{activeSection === "الحضور والانصراف" && <><SummaryCards items={[{ label: "حاضرون الآن", value: attendanceMarked ? "٥٨" : "٥٧", note: "من ٦٣ موظفًا", tone: "bg-[#0d857b]" }, { label: "متأخرون", value: "٠٥", note: "يحتاجون متابعة", tone: "bg-[#e5b15a]" }, { label: "غائبون", value: "٠٣", note: "معتمدون بإجازة", tone: "bg-[#d36c83]" }, { label: "ساعات إضافية", value: "٢٤", note: "ساعة هذا الأسبوع", tone: "bg-[#397fbd]" }]} /><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><HRTable columns={["الموظف", "القسم", "وقت الدخول", "الحالة"]} rows={attendanceRows} actionLabel={attendanceMarked ? "تعديل" : "تسجيل"} onAction={markAttendance} /></div></>}{activeSection === "الإجازات" && <div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><div className="mb-5"><h2 className="text-[16px] font-bold text-[#234b4b]">طلبات الإجازات</h2><p className="mt-1 text-[11px] text-[#96aaa8]">اعتماد الطلب ينعكس على تغطية المناوبات</p></div><HRTable columns={["الطلب", "الموظف", "النوع", "المدة", "الحالة"]} rows={leaveRows} actionLabel="اعتماد" onAction={approveLeave} /></div>}{activeSection === "الرواتب" && <><SummaryCards items={[{ label: "إجمالي المسير", value: "٤٠٬٥٠٠ ر.س", note: payrollReady ? "معتمد للمراجعة" : "مسودة الشهر الحالي", tone: "bg-[#0d857b]" }, { label: "بدلات", value: "١٬٨٠٠ ر.س", note: "بدلات حضور ونقل", tone: "bg-[#397fbd]" }, { label: "استقطاعات", value: "٣٠٠ ر.س", note: "حسب الحضور", tone: "bg-[#e5b15a]" }, { label: "موعد الصرف", value: "٢٧ مايو", note: "متوافق مع السياسة", tone: "bg-[#7654ba]" }]} /><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><HRTable columns={["الموظف", "المسمى", "الأساسي", "الاستقطاعات", "الحالة"]} rows={payrollRows} actionLabel="كشف الراتب" onAction={() => setNote("تم فتح كشف الراتب محليًا")} /></div></>}{activeSection === "العقود والملفات" && <div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><HRTable columns={["الرقم", "الموظف", "نوع العقد", "الانتهاء", "الحالة"]} rows={contractRows} actionLabel="عرض الملف" onAction={() => setNote("تم فتح ملف العقد والوثائق")} /></div>}{activeSection === "التوظيف" && <div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><HRTable columns={["الوظيفة", "القسم", "المرشحون", "المرحلة", "الحالة"]} rows={recruitmentRows} actionLabel="متابعة" onAction={() => setNote("تم فتح مسار التوظيف")} /></div>}{activeSection === "تقييم الأداء" && <div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><HRTable columns={["الموظف", "القسم", "التقييم", "تحقيق الأهداف", "الحالة"]} rows={performanceRows} actionLabel="فتح التقييم" onAction={() => setNote("تم فتح نموذج تقييم الأداء")} /></div>}{activeSection === "التدريب والتطوير" && <div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><HRTable columns={["الدورة", "النوع", "المسجلون", "التاريخ", "الحالة"]} rows={trainingRows} actionLabel="إدارة الدورة" onAction={() => setNote("تم فتح إدارة الدورة التدريبية")} /></div>}{activeSection === "المناوبات والجداول" && <div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><HRTable columns={["المناوبة", "الوقت", "التغطية", "الفريق", "الحالة"]} rows={shiftRows} actionLabel="تعديل الجدول" onAction={() => setNote("تم فتح جدول المناوبة")} /></div>}{activeSection === "تقارير الموارد البشرية" && <><SummaryCards items={reportCards} /><div className="grid gap-4 md:grid-cols-2"><ReportCard title="توزيع القوى العاملة" detail="العيادات ٤٢٪ · الاستقبال ٢٢٪ · الخدمات المساندة ٣٦٪" bars={[82, 54, 68, 43]} tone="blue" /><ReportCard title="الحضور والالتزام" detail="نسبة الحضور ٩٢٪ · الإجازات ٥٪ · الغياب ٣٪" bars={[92, 55, 35]} tone="teal" /></div></>}{note && <div role="status" className="mt-4 rounded-xl bg-[#e8f5f1] px-4 py-3 text-[11px] font-bold text-[#0d716a]">{note}</div>}</>;
}

function PatientJourneyView({ branch, cases, onAdvance, onNavigate }: { branch: string; cases: WorkflowCase[]; onAdvance: (caseId: string) => void; onNavigate: (item: string) => void }) {
  const stages = ["الاستقبال", "الزيارة", "الخدمات", "الفوترة", "الصرف", "مكتملة"];
  const [selectedId, setSelectedId] = useState(cases[0]?.id ?? "");
  const selected = cases.find((item) => item.id === selectedId) ?? cases[0];
  if (!selected) return null;
  const stageIndex = stages.indexOf(selected.stage);
  return <><ViewHeader eyebrow="التشغيل السريري والمالي" title="رحلة المريض المترابطة" description={`${branch} · كل إجراء يحدث الوحدات المرتبطة ويحفظ محليًا`} action={selected.stage === "مكتملة" ? "الرحلة مكتملة" : `نقل إلى ${stages[Math.min(stageIndex + 1, stages.length - 1)]}`} icon={Activity} onAction={() => onAdvance(selected.id)} /><div className="mb-5 flex gap-2 overflow-x-auto">{cases.map((item) => <button key={item.id} onClick={() => setSelectedId(item.id)} className={cn("min-w-[210px] rounded-2xl border p-4 text-right", selected.id === item.id ? "border-[#0d857b] bg-[#eaf7f4]" : "border-[#e3eeeb] bg-white")}><div className="text-[11px] font-bold text-[#315d5a]">{item.patient}</div><div className="mt-1 text-[10px] text-[#8ba4a1]">{item.mrn} · {item.id}</div><div className="mt-3"><StatusPill tone={item.stage === "مكتملة" ? "teal" : "blue"}>{item.stage}</StatusPill></div></button>)}</div><div className="mb-6 rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><div className="flex min-w-[720px] items-center overflow-x-auto">{stages.map((stage, index) => <div key={stage} className="flex flex-1 items-center"><div className="min-w-[90px] text-center"><div className={cn("mx-auto flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-bold", index <= stageIndex ? "bg-[#0d857b] text-white" : "bg-[#edf3f1] text-[#91a8a5]")}>{index < stageIndex ? "✓" : index + 1}</div><div className={cn("mt-2 text-[10px] font-bold", index <= stageIndex ? "text-[#0d716a]" : "text-[#91a8a5]")}>{stage}</div></div>{index < stages.length - 1 && <div className={cn("h-0.5 flex-1", index < stageIndex ? "bg-[#0d857b]" : "bg-[#e3eeeb]")} />}</div>)}</div></div><div className="grid gap-5 lg:grid-cols-3"><SettingsCard title="الاستقبال والزيارة" description="الموعد والوصول والملف السريري" icon={CalendarDays}><div className="space-y-3"><JourneyRow label="الموعد" value={selected.appointment} /><JourneyRow label="الزيارة" value={selected.visit} /><JourneyRow label="الخدمة" value={selected.service} /></div><div className="mt-4 grid grid-cols-2 gap-2"><button onClick={() => onNavigate("المواعيد")} className="rounded-xl border border-[#dceae7] py-2.5 text-[10px] font-bold text-[#0d716a]">المواعيد</button><button onClick={() => onNavigate("السجل الطبي")} className="rounded-xl border border-[#dceae7] py-2.5 text-[10px] font-bold text-[#0d716a]">السجل الطبي</button></div></SettingsCard><SettingsCard title="السريري والصيدلية" description="التشخيص والوصفة والصرف والمخزون" icon={Stethoscope}><div className="space-y-3"><JourneyRow label="الوصفة" value={selected.prescription} /><JourneyRow label="حالة الصرف" value={selected.stage === "مكتملة" ? "تم التسليم" : selected.stage === "الصرف" ? "بانتظار التجهيز" : "لم تبدأ"} /><JourneyRow label="المخزون" value={selected.stage === "مكتملة" ? "تم الخصم من الدفعة" : "محجوز عند الصرف"} /></div><div className="mt-4 grid grid-cols-2 gap-2"><button onClick={() => onNavigate("الأدوية والوصفات")} className="rounded-xl border border-[#dceae7] py-2.5 text-[10px] font-bold text-[#0d716a]">الوصفات</button><button onClick={() => onNavigate("صرف الأدوية")} className="rounded-xl border border-[#dceae7] py-2.5 text-[10px] font-bold text-[#0d716a]">الصرف</button></div></SettingsCard><SettingsCard title="المالية والتأمين" description="الفاتورة والأهلية والتحصيل" icon={WalletCards}><div className="space-y-3"><JourneyRow label="الفاتورة" value={selected.invoice} /><JourneyRow label="الدفع" value={selected.payment} /><JourneyRow label="التأمين" value={selected.insurance} /></div><div className="mt-4 grid grid-cols-2 gap-2"><button onClick={() => onNavigate("الفوترة والمدفوعات")} className="rounded-xl border border-[#dceae7] py-2.5 text-[10px] font-bold text-[#0d716a]">الفوترة</button><button onClick={() => onNavigate("التأمين والمطالبات")} className="rounded-xl border border-[#dceae7] py-2.5 text-[10px] font-bold text-[#0d716a]">التأمين</button></div></SettingsCard></div><div className="mt-5 rounded-[18px] border border-[#d7e8e4] bg-[#f0f8f6] p-4"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><div className="text-[11px] font-bold text-[#315d5a]">الإجراء التالي المنطقي</div><p className="mt-1 text-[10px] text-[#789794]">سيتم تحديث الرحلة والوصفة وطابور الصرف والفاتورة تلقائيًا بحسب المرحلة.</p></div><button disabled={selected.stage === "مكتملة"} onClick={() => onAdvance(selected.id)} className="rounded-xl bg-[#0d716a] px-5 py-3 text-[10px] font-bold text-white disabled:bg-[#a8bcb8]">{selected.stage === "مكتملة" ? "تم إغلاق الرحلة" : `اعتماد والانتقال إلى ${stages[Math.min(stageIndex + 1, stages.length - 1)]}`}</button></div></div></>;
}

function JourneyRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between rounded-xl bg-[#f7faf9] px-3 py-2.5"><span className="text-[10px] text-[#8ba4a1]">{label}</span><span className="text-[10px] font-bold text-[#426765]">{value}</span></div>;
}

function OperationsCenterView({ activeItem, branch, onNavigate }: { activeItem: string; branch: string; onNavigate: (item: string) => void }) {
  const [tab, setTab] = useState(activeItem);
  const [statuses, setStatuses] = useState<Record<string, string>>({ "PO-2025-009": "مسودة", "REQ-1048": "بانتظار الاعتماد", "MSG-003": "مجدولة" });
  const [saved, setSaved] = useState(false);
  const tabs = ["الحسابات ودليل الحسابات", "المشتريات والموردون", "حركات المخزون", "الرسائل والتنبيهات", "سجل التدقيق", "إعدادات التشغيل"];
  const action = (id: string, next: string) => { setStatuses((current) => ({ ...current, [id]: next })); setSaved(true); window.setTimeout(() => setSaved(false), 2200); };
  const section = tab === "الحسابات ودليل الحسابات" ? { title: "الحسابات ودليل الحسابات", eyebrow: "المحاسبة", description: `${branch} · دليل الحسابات والقيود والتحصيل والإغلاق اليومي`, icon: CircleDollarSign } : tab === "المشتريات والموردون" ? { title: "المشتريات والموردون", eyebrow: "المستودعات", description: `${branch} · طلبات الشراء والموردون والفواتير الواردة`, icon: BriefcaseBusiness } : tab === "حركات المخزون" ? { title: "حركات المخزون", eyebrow: "المستودعات", description: `${branch} · استلام وصرف وتحويل وجرد الدفعات والصلاحيات`, icon: Package } : tab === "الرسائل والتنبيهات" ? { title: "الرسائل والتنبيهات", eyebrow: "الاتصال", description: `${branch} · قوالب واتساب وSMS والبريد والتنبيهات الآلية`, icon: MessageCircle } : tab === "سجل التدقيق" ? { title: "سجل التدقيق", eyebrow: "الحوكمة والأمان", description: `${branch} · كل إضافة وتعديل واعتماد وتصدير موثق بالمستخدم والوقت`, icon: LockKeyhole } : { title: "إعدادات التشغيل", eyebrow: "التهيئة", description: `${branch} · قواعد الفوترة والضريبة والمواعيد والصلاحيات`, icon: Settings2 };
  return <><ViewHeader eyebrow={section.eyebrow} title={section.title} description={section.description} action={saved ? "تم الحفظ محليًا" : "حفظ التغييرات"} icon={section.icon} onAction={() => setSaved(true)} /><div className="mb-5 flex gap-2 overflow-x-auto pb-1">{tabs.map((item) => <button key={item} onClick={() => setTab(item)} className={cn("min-w-max rounded-xl border px-3 py-2.5 text-[10px] font-bold", tab === item ? "border-[#0d857b] bg-[#e6f4f1] text-[#0d716a]" : "border-[#e3eeeb] bg-white text-[#789794]")}>{item}</button>)}</div>{tab === "الحسابات ودليل الحسابات" && <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]"><SummaryCards items={[{ label: "إيرادات اليوم", value: "١٢٬٤٨٠ ر.س", note: "٢٩ عملية دفع", tone: "bg-[#0d857b]" }, { label: "ضريبة القيمة المضافة", value: "١٬٨٧٢ ر.س", note: "VAT 15%", tone: "bg-[#397fbd]" }, { label: "دفعات معلقة", value: "٧", note: "٤٬٣٢٠ ر.س", tone: "bg-[#e5b15a]" }, { label: "حالة الصندوق", value: "مفتوح", note: "إغلاق نهاية اليوم", tone: "bg-[#7654ba]" }]} /><SettingsCard title="دورة الفاتورة والتحصيل" description="الخدمة ← الفاتورة ← الدفع ← القيد ← الإغلاق" icon={WalletCards}><div className="space-y-3">{[["INV-RYD-1048", "سارة أحمد العتيبي", "كشف جلدية", "مدفوعة"], ["INV-RYD-1046", "نورة محمد الغامدي", "فحص أولي", "بانتظار التأمين"], ["INV-RYD-1045", "خالد إبراهيم الشهري", "باقة ليزر", "مدفوعة"]].map((row) => <div key={row[0]} className="flex items-center justify-between rounded-xl border border-[#edf3f1] p-3"><div><div className="text-[11px] font-bold text-[#426765]">{row[0]} · {row[1]}</div><div className="mt-1 text-[10px] text-[#9aafac]">{row[2]} · VAT 15%</div></div><StatusPill tone={row[3] === "مدفوعة" ? "teal" : "amber"}>{row[3]}</StatusPill></div>)}</div><button onClick={() => onNavigate("الفوترة والمدفوعات")} className="mt-4 w-full rounded-xl bg-[#0d716a] py-3 text-[10px] font-bold text-white">فتح الفوترة والمدفوعات</button></SettingsCard></div>}{tab === "المشتريات والموردون" && <div className="grid gap-5 lg:grid-cols-[1fr_1fr]"><ModuleTable title="طلبات الشراء" description="المورد والصنف والكمية والحالة" columns={["الطلب", "المورد", "التاريخ", "القيمة", "الحالة"]} rows={[["PO-2025-009", "شركة المستلزمات الطبية", "18 أغسطس", "٨٬٤٥٠ ر.س", statuses["PO-2025-009"]], ["PO-2025-008", "مؤسسة المختبرات المتحدة", "16 أغسطس", "٣٬٢٨٠ ر.س", "مستلم"]]} /><SettingsCard title="بيانات المورد" description="الرقم الضريبي ووسائل الاتصال وشروط الدفع" icon={BriefcaseBusiness}><div className="grid gap-3"><EditableField label="اسم المورد" value="شركة المستلزمات الطبية" onChange={() => undefined} /><EditableField label="الرقم الضريبي" value="310123456700003" dir="ltr" onChange={() => undefined} /><EditableField label="شروط الدفع" value="آجل 30 يومًا" onChange={() => undefined} /></div><button onClick={() => action("PO-2025-009", "معتمد للشراء")} className="mt-4 w-full rounded-xl border border-[#abd6cf] py-3 text-[10px] font-bold text-[#0d716a]">اعتماد طلب الشراء</button></SettingsCard></div>}{tab === "حركات المخزون" && <><SummaryCards items={[{ label: "حركات اليوم", value: "١٦", note: "استلام وصرف وتحويل", tone: "bg-[#0d857b]" }, { label: "أصناف منخفضة", value: "٠٤", note: "تحتاج طلب شراء", tone: "bg-[#e5b15a]" }, { label: "دفعات قاربت الانتهاء", value: "٠٢", note: "خلال ٩٠ يومًا", tone: "bg-[#d36c83]" }, { label: "قيمة المخزون", value: "٤٨٬٢٠٠", note: "ر.س تقديرية", tone: "bg-[#397fbd]" }]} /><ModuleTable title="حركات المخزون" description="تتبع الصنف والدفعة والكمية والمستخدم والمستودع" columns={["المرجع", "الصنف", "الحركة", "الدفعة", "الكمية", "المستخدم"]} rows={[["REQ-1048", "أموكسيسيلين ٥٠٠ مج", "صرف وصفة", "BTH-5510", "٢", "الصيدلية"], ["GRN-021", "قفازات طبية", "استلام شراء", "BTH-9910", "٥٠٠", "المستودع"], ["TRN-014", "محلول ملحي ٥٠٠ مل", "تحويل فرع", "BTH-1022", "٢٠", "أحمد المطيري"]]} /></>}{tab === "الرسائل والتنبيهات" && <div className="grid gap-5 lg:grid-cols-[1fr_1fr]"><SettingsCard title="قوالب الإرسال" description="رسائل المواعيد والنتائج والفواتير والتذكير" icon={MessageCircle}><div className="space-y-3">{[["تأكيد الموعد", "واتساب + SMS", "مفعلة"], ["تذكير قبل 24 ساعة", "واتساب", "مفعلة"], ["جاهزية نتيجة المختبر", "واتساب + بريد", "مجدولة"], ["إيصال الدفع", "SMS + بريد", "مفعلة"]].map((row) => <div key={row[0]} className="flex items-center justify-between rounded-xl border border-[#edf3f1] p-3"><div><div className="text-[11px] font-bold text-[#426765]">{row[0]}</div><div className="mt-1 text-[10px] text-[#9aafac]">{row[1]}</div></div><StatusPill>{row[2]}</StatusPill></div>)}</div></SettingsCard><SettingsCard title="قنوات الاتصال" description="إعدادات المزود والقوالب الافتراضية" icon={MessageCircle}><div className="grid gap-3"><EditableField label="مزود واتساب" value="Meta Cloud API" onChange={() => undefined} /><EditableField label="رقم الإرسال" value="+966 55 420 1188" dir="ltr" onChange={() => undefined} /><EditableField label="البريد الافتراضي" value="notifications@zainmedical.sa" dir="ltr" onChange={() => undefined} /></div><button onClick={() => action("MSG-003", "مفعلة")} className="mt-4 w-full rounded-xl bg-[#0d716a] py-3 text-[10px] font-bold text-white">اختبار إرسال رسالة</button></SettingsCard></div>}{tab === "سجل التدقيق" && <ModuleTable title="السجل الكامل" description="إضافة وتعديل واعتماد وتصدير مع المستخدم والوقت والجهاز" columns={["الوقت", "المستخدم", "العملية", "الكيان", "المرجع", "النتيجة"]} rows={[["08/08/2025 05:41", "admin", "Add", "فاتورة", "INV-RYD-1048", "نجاح"], ["08/08/2025 05:39", "أحمد المطيري", "Update", "ملف مريض", "MRN-1024", "نجاح"], ["08/08/2025 05:37", "الصيدلية", "Dispense", "وصفة", "RX-2025-0841", "نجاح"], ["08/08/2025 05:35", "النظام", "Export", "تقرير مالي", "RPT-2025-08", "نجاح"]]} />}{tab === "إعدادات التشغيل" && <div className="grid gap-5 lg:grid-cols-2"><SettingsCard title="قواعد التشغيل" description="إعدادات الفوترة والمواعيد والتأمين" icon={Settings2}><div className="space-y-3"><ToggleRow label="احتساب ضريبة القيمة المضافة" description="إضافة VAT 15% للخدمات الخاضعة" checked={true} onChange={() => setSaved(true)} /><ToggleRow label="منع الصرف دون اعتماد الطبيب" description="ربط الوصفة بطابور الصرف" checked={true} onChange={() => setSaved(true)} /><ToggleRow label="تسجيل كل التغييرات" description="حفظ سجل التدقيق للمستخدم والوقت" checked={true} onChange={() => setSaved(true)} /><ToggleRow label="تنبيه قرب انتهاء الدفعات" description="إشعار المستودع قبل 90 يومًا" checked={true} onChange={() => setSaved(true)} /></div></SettingsCard><SettingsCard title="المستودعات والفروع" description="المستودع الافتراضي وسياسة FEFO" icon={Building2}><div className="grid gap-3"><EditableField label="المستودع الافتراضي" value="مستودع الرياض الرئيسي" onChange={() => undefined} /><EditableField label="سياسة الصرف" value="FEFO - الأقدم انتهاءً أولًا" onChange={() => undefined} /><EditableField label="حد إعادة الطلب" value="10 وحدات" onChange={() => undefined} /></div><button onClick={() => setSaved(true)} className="mt-4 w-full rounded-xl border border-[#abd6cf] py-3 text-[10px] font-bold text-[#0d716a]">حفظ إعدادات التشغيل</button></SettingsCard></div>}</>;
}

type ModuleViewProps = { activeItem: string; branch: string; onPatient: () => void; onAppointment: () => void; onClinic: () => void; newPatient: string; patientCount: number; services: ClinicalRows; radiologyOrders: ClinicalRows; stock: ClinicalRows; prescriptions: ClinicalRows; dispensingQueue: ClinicalRows; onCreate: (type: ClinicalModal) => void; onUpdateDispensing: (id: string, status: string) => void; onScanPrescription: () => void; onNavigate: (item: string) => void; workflowCases: WorkflowCase[]; onAdvanceWorkflow: (caseId: string) => void };

function ModuleView({ activeItem, branch, onPatient, onAppointment, onClinic, newPatient, patientCount, services, radiologyOrders, stock, prescriptions, dispensingQueue, onCreate, onUpdateDispensing, onScanPrescription, onNavigate, workflowCases, onAdvanceWorkflow }: ModuleViewProps) {
  if (activeItem === "المرضى") return <PatientsView branch={branch} onAdd={onPatient} newPatient={newPatient} patientCount={patientCount} />;
  if (activeItem === "السجل الطبي") return <MedicalRecordView branch={branch} onNavigate={onNavigate} />;
  if (activeItem === "رحلة المريض") return <PatientJourneyView branch={branch} cases={workflowCases} onAdvance={onAdvanceWorkflow} onNavigate={onNavigate} />;
  if (activeItem === "المواعيد") return <AppointmentsView branch={branch} onBook={onAppointment} />;
  if (activeItem === "الاستقبال والانتظار") return <QueueView branch={branch} />;
  if (activeItem === "الفوترة والمدفوعات") return <FinanceView branch={branch} />;
  if (activeItem === "المختبر") return <LabView branch={branch} />;
  if (activeItem === "التأمين والمطالبات") return <InsuranceView branch={branch} />;
  if (activeItem === "الباقات") return <PackagesView branch={branch} />;
  if (activeItem === "الخدمات") return <ServicesView branch={branch} rows={services} onAdd={() => onCreate("service")} />;
  if (activeItem === "الأشعة والتصوير الطبي") return <RadiologyView branch={branch} orders={radiologyOrders} onAdd={() => onCreate("radiology")} />;
  if (activeItem === "الصيدلية") return <PharmacyView branch={branch} stock={stock} onAdd={() => onCreate("medicine")} />;
  if (activeItem === "الأدوية والوصفات") return <PrescriptionsView branch={branch} prescriptions={prescriptions} onAdd={() => onCreate("prescription")} />;
  if (activeItem === "صرف الأدوية") return <DispensingView branch={branch} queueRows={dispensingQueue} onScan={onScanPrescription} onUpdate={onUpdateDispensing} />;
  if (["الموظفون", "الحضور والانصراف", "الإجازات", "الرواتب", "العقود والملفات", "التوظيف", "تقييم الأداء", "التدريب والتطوير", "المناوبات والجداول", "تقارير الموارد البشرية"].includes(activeItem)) return <HRView activeItem={activeItem} branch={branch} onNavigate={onNavigate} />;
  if (["الأطباء", "الأقسام والعيادات", "الأمراض والتشخيص"].includes(activeItem)) return <DirectoryView activeItem={activeItem} branch={branch} />;
  if (activeItem === "المحتوى") return <ContentView branch={branch} />;
  if (activeItem === "التقارير") return <ReportsView branch={branch} />;
  if (["الحسابات ودليل الحسابات", "المشتريات والموردون", "حركات المخزون", "الرسائل والتنبيهات", "سجل التدقيق", "إعدادات التشغيل"].includes(activeItem)) return <OperationsCenterView activeItem={activeItem} branch={branch} onNavigate={onNavigate} />;
  return <EditableSettingsView branch={branch} onClinic={onClinic} />;
}

function ViewHeader({ eyebrow, title, description, action, icon: Icon = LayoutDashboard, onAction }: { eyebrow: string; title: string; description: string; action: string; icon?: typeof LayoutDashboard; onAction?: () => void }) {
  const [completed, setCompleted] = useState(false);
  const handleAction = () => { if (onAction) { onAction(); return; } const audit = JSON.parse(window.localStorage.getItem("zaincare-ui-audit") ?? "[]") as { action: string; time: string }[]; window.localStorage.setItem("zaincare-ui-audit", JSON.stringify([{ action, time: new Date().toISOString() }, ...audit].slice(0, 100))); setCompleted(true); window.setTimeout(() => setCompleted(false), 2500); };
  return <div className="mb-7 flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><div className="mb-2 flex items-center gap-2 text-[11px] font-bold text-[#92aaa7]"><Icon className="h-4 w-4 text-[#0d857b]" /> {eyebrow}</div><h1 className="text-[28px] font-bold tracking-[-0.04em] text-[#183f42] sm:text-[32px]">{title}</h1><p className="mt-2 text-[13px] text-[#76918e]">{description}</p>{completed && <div role="status" className="mt-2 text-[10px] font-bold text-[#0d716a]">تم تنفيذ إجراء «{action}» محليًا</div>}</div><button onClick={handleAction} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0d716a] px-4 text-xs font-bold text-white shadow-[0_8px_18px_rgba(13,113,106,0.19)] transition hover:bg-[#095d58]"><Plus className="h-4 w-4" /> {action}</button></div>;
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
  const [paymentFilter, setPaymentFilter] = useState("الكل");
  const patients = [
    ["سارة أحمد العتيبي", "MRN-1024", "05 5123 8841", "اليوم", "مؤمّن"],
    ["عبدالله سالم القحطاني", "MRN-1023", "05 4781 2290", "اليوم", "نقدي"],
    ["نورة محمد الغامدي", "MRN-1022", "05 9012 3367", "أمس", "مؤمّن"],
    ["خالد إبراهيم الشهري", "MRN-1021", "05 6634 1029", "١٥ مايو", "باقة"],
    ["ريم فهد السبيعي", "MRN-1020", "05 7201 7782", "١٤ مايو", "مؤمّن"],
    [newPatient, "MRN-NEW", "05 0000 0000", "الآن", "نقدي"],
  ];
  const filtered = patients.filter((patient) => patient.join(" ").includes(query) && (paymentFilter === "الكل" || patient[4] === paymentFilter));
  return <><ViewHeader eyebrow="إدارة المرضى" title="سجل المرضى" description={`${branch} · بحث آمن ببيانات المرضى والهوية الوطنية`} action="تسجيل مريض" icon={UsersRound} onAction={onAdd} /><SummaryCards items={[{ label: "إجمالي المرضى", value: toArabicNumber(patientCount), note: "+ ٣٢ هذا الشهر", tone: "bg-[#0d857b]" }, { label: "زيارات اليوم", value: "٣٨", note: "٢٨ مكتملة", tone: "bg-[#5a91bf]" }, { label: "ملفات تحتاج إكمال", value: "٢١", note: "بيانات التسجيل ناقصة", tone: "bg-[#e5b15a]" }, { label: "مواعيد متابعة", value: "١٠٦", note: "خلال ١٤ يومًا", tone: "bg-[#8968bd]" }]} /><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 shadow-[0_4px_18px_rgba(30,73,72,0.025)] sm:p-6"><div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-[16px] font-bold text-[#234b4b]">كل المرضى</h2><p className="mt-1 text-[11px] text-[#96aaa8]">البيانات محمية وتظهر حسب صلاحيتك</p></div><div className="flex gap-2"><div className="flex h-10 min-w-0 flex-1 items-center rounded-xl border border-[#dfebe8] px-3 sm:w-[230px]"><Search className="ml-2 h-4 w-4 shrink-0 text-[#9bb1ae]" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="w-full bg-transparent text-xs outline-none placeholder:text-[#a9bcba]" placeholder="ابحث بالاسم أو MRN..." /></div><button onClick={() => { const filters = ["الكل", "مؤمّن", "نقدي", "باقة"]; setPaymentFilter(filters[(filters.indexOf(paymentFilter) + 1) % filters.length]); }} title={`التصفية الحالية: ${paymentFilter}`} className={cn("flex h-10 items-center gap-2 rounded-xl border px-3 text-[11px] font-bold", paymentFilter === "الكل" ? "border-[#dfebe8] text-[#6d8b88]" : "border-[#8acbc1] bg-[#e6f4f1] text-[#0d716a]")}><SlidersHorizontal className="h-4 w-4" /> تصفية</button></div></div><div className="overflow-x-auto"><table className="w-full min-w-[650px] text-right"><thead><tr className="border-b border-[#edf3f1] text-[10px] font-bold text-[#96aaa8]"><th className="pb-3 pr-2">المريض</th><th className="pb-3">رقم الملف</th><th className="pb-3">الجوال</th><th className="pb-3">آخر زيارة</th><th className="pb-3">طريقة الدفع</th><th className="pb-3">الإجراء</th></tr></thead><tbody>{filtered.map((patient) => <tr key={patient[1]} className="group border-b border-[#f0f4f3] text-[11px] last:border-0 hover:bg-[#fbfefd]"><td className="py-4 pr-2"><div className="flex items-center gap-3"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#e4f5f1] text-[10px] font-bold text-[#0d857b]">{patient[0].split(" ").slice(0, 2).map((word) => word[0]).join("")}</div><span className="font-bold text-[#3c6260]">{patient[0]}</span></div></td><td className="py-4 font-mono text-[10px] text-[#789693]" dir="ltr">{patient[1]}</td><td className="py-4 text-[#789693]" dir="ltr">{patient[2]}</td><td className="py-4 text-[#789693]">{patient[3]}</td><td className="py-4"><StatusPill tone={patient[4] === "مؤمّن" ? "blue" : patient[4] === "باقة" ? "purple" : "teal"}>{patient[4]}</StatusPill></td><td className="py-4"><button aria-label={`عرض ${patient[0]}`} className="rounded-lg p-2 text-[#a3b8b5] transition hover:bg-[#eaf6f2] hover:text-[#0d716a]"><ChevronLeft className="h-4 w-4" /></button></td></tr>)}</tbody></table>{filtered.length === 0 && <div className="py-12 text-center text-xs text-[#91a9a6]">لا توجد نتائج مطابقة للبحث.</div>}</div></div></>;
}

function MedicalRecordView({ branch, onNavigate }: { branch: string; onNavigate: (item: string) => void }) {
  const [tab, setTab] = useState("الملخص");
  const [visitStatus, setVisitStatus] = useState("مفتوحة");
  const [saved, setSaved] = useState(false);
  const tabs = ["الملخص", "الزيارات", "التشخيصات", "الأسنان", "الوصفات", "الأشعة", "الفوترة"];
  const diagnoses = [["E11", "السكري من النوع الثاني", "مزمن", "نشط"], ["I10", "ارتفاع ضغط الدم", "مزمن", "متابعة"], ["K04.7", "خراج سني", "زيارة حالية", "قيد العلاج"]];
  const visits = [["VIS-2025-0841", "18 مايو 2025 · 09:30", "د. ليان المطيري", "كشف جلدية", "مكتملة"], ["VIS-2025-0712", "02 أبريل 2025 · 11:15", "د. عمر الحربي", "متابعة علاج", "مكتملة"]];
  const dental = [["16", "حشوة ضوئية", "سن علوي يمين", "منفذ"], ["24", "ألم وحساسية", "ضرس علوي يسار", "يحتاج متابعة"], ["36", "تنظيف عميق", "ضرس سفلي يسار", "مخطط"]];
  const save = () => { setSaved(true); window.setTimeout(() => setSaved(false), 2500); };
  return <><ViewHeader eyebrow="الملف الطبي الموحد" title="سجل المريض الطبي" description={`${branch} · سارة أحمد العتيبي · MRN-1024 · هوية ٢٤٨٧٠١xxxx`} action={saved ? "تم الحفظ محليًا" : "حفظ التحديثات"} icon={ClipboardList} onAction={save} /><div className="mb-6 rounded-[22px] border border-[#d7e8e4] bg-white p-5"><div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center"><div className="flex items-center gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#e6f4f1] text-[16px] font-bold text-[#0d716a]">سأ</div><div><h2 className="text-[17px] font-bold text-[#234b4b]">سارة أحمد العتيبي</h2><p className="mt-1 text-[10px] text-[#8ba4a1]">أنثى · ٢٨ سنة · سعودية · 05 5123 8841</p></div></div><div className="grid grid-cols-2 gap-4 text-right sm:grid-cols-4"><div><div className="text-[10px] text-[#96aaa8]">رقم الزيارة</div><div className="mt-1 text-[11px] font-bold text-[#426765]">VIS-2025-0841</div></div><div><div className="text-[10px] text-[#96aaa8]">الطبيب</div><div className="mt-1 text-[11px] font-bold text-[#426765]">د. ليان المطيري</div></div><div><div className="text-[10px] text-[#96aaa8]">التغطية</div><div className="mt-1 text-[11px] font-bold text-[#426765]">بوبا العربية</div></div><div><div className="text-[10px] text-[#96aaa8]">حالة الزيارة</div><button onClick={() => setVisitStatus(visitStatus === "مفتوحة" ? "مكتملة" : "مفتوحة")} className="mt-1"><StatusPill tone={visitStatus === "مفتوحة" ? "amber" : "teal"}>{visitStatus}</StatusPill></button></div></div></div></div><div className="mb-5 flex gap-2 overflow-x-auto pb-1">{tabs.map((item) => <button key={item} onClick={() => setTab(item)} className={cn("min-w-max rounded-xl border px-4 py-2.5 text-[11px] font-bold", tab === item ? "border-[#0d857b] bg-[#e6f4f1] text-[#0d716a]" : "border-[#e3eeeb] bg-white text-[#789794]")}>{item}</button>)}</div>{tab === "الملخص" && <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]"><SettingsCard title="بيانات الزيارة" description="الشكوى والقياسات والملاحظات السريرية" icon={Stethoscope}><div className="grid gap-4 sm:grid-cols-2"><EditableField label="الشكوى الرئيسية" value="ألم في الجهة اليمنى" onChange={() => undefined} /><EditableField label="نوع الزيارة" value="متابعة علاج" onChange={() => undefined} /><EditableField label="ضغط الدم" value="120 / 80" dir="ltr" onChange={() => undefined} /><EditableField label="الوزن" value="72 كجم" onChange={() => undefined} /></div><label className="mt-4 block"><span className="mb-2 block text-[10px] font-bold text-[#8ba4a1]">الملاحظات السريرية</span><textarea defaultValue="المريض مستقر، يوصى بمتابعة العلاج وإجراء الفحص القادم." className={cn(formControlClass(), "min-h-[90px] bg-[#fbfdfc]")} /></label></SettingsCard><SettingsCard title="الإجراءات المرتبطة" description="الخدمة ← الطلب ← الوصفة ← الفاتورة" icon={ReceiptText}><div className="space-y-2"><button onClick={() => onNavigate("الخدمات")} className="flex w-full items-center justify-between rounded-xl border border-[#edf3f1] p-3 text-right"><span><span className="block text-[11px] font-bold text-[#426765]">كشف جلدية</span><span className="mt-1 block text-[10px] text-[#9aafac]">٢٠٠ ر.س · خدمة مرتبطة بالزيارة</span></span><StatusPill>مضاف</StatusPill></button><button onClick={() => onNavigate("الأشعة والتصوير الطبي")} className="flex w-full items-center justify-between rounded-xl border border-[#edf3f1] p-3 text-right"><span><span className="block text-[11px] font-bold text-[#426765]">أشعة سونار البطن</span><span className="mt-1 block text-[10px] text-[#9aafac]">RAD-1024 · اليوم ١١:٠٠</span></span><StatusPill tone="amber">مجدول</StatusPill></button><button onClick={() => onNavigate("الأدوية والوصفات")} className="flex w-full items-center justify-between rounded-xl border border-[#edf3f1] p-3 text-right"><span><span className="block text-[11px] font-bold text-[#426765]">وصفة RX-2025-0841</span><span className="mt-1 block text-[10px] text-[#9aafac]">٣ أصناف · مرتبطة بالزيارة</span></span><StatusPill tone="blue">معتمدة</StatusPill></button></div></SettingsCard></div>}{tab === "الزيارات" && <ModuleTable title="سجل الزيارات" description="كل زيارة مرتبطة بالطبيب والخدمات والفاتورة" columns={["رقم الزيارة", "التاريخ", "الطبيب", "نوع الزيارة", "الحالة"]} rows={visits} />}{tab === "التشخيصات" && <ModuleTable title="التشخيصات" description="قاموس ICD-10 والتشخيصات المسجلة للمريض" columns={["الرمز", "التشخيص", "النوع", "الحالة"]} rows={diagnoses} />}{tab === "الأسنان" && <ModuleTable title="مخطط الأسنان والإجراءات" description="السن والإجراء والملاحظة وحالة العلاج" columns={["رقم السن", "الإجراء", "الموضع", "الحالة"]} rows={dental} />}{tab === "الوصفات" && <ModuleTable title="الوصفات المرتبطة" description="الطبيب ← الوصفة ← الصرف" columns={["الوصفة", "المريض", "الطبيب", "الأصناف", "الحالة", "التاريخ"]} rows={[["RX-2025-0841", "سارة أحمد العتيبي", "د. ليان المطيري", "٣ أصناف", "معتمدة", "اليوم ٠٩:٤٥"]]} />}{tab === "الأشعة" && <ModuleTable title="طلبات الأشعة" description="الزيارة ← الطلب ← التقرير" columns={["الطلب", "المريض", "الفحص", "الطبيب", "الحالة", "الموعد"]} rows={[["RAD-1024", "سارة أحمد العتيبي", "أشعة سونار البطن", "د. ليان المطيري", "مجدول", "اليوم ١١:٠٠"]]} />}{tab === "الفوترة" && <ModuleTable title="الفاتورة والتحصيل" description="الخدمات والضريبة والدفع والتأمين" columns={["الفاتورة", "الخدمة", "قبل الضريبة", "VAT 15%", "الإجمالي", "الحالة"]} rows={[["INV-RYD-1048", "كشف جلدية", "٢٠٠ ر.س", "٣٠ ر.س", "٢٣٠ ر.س", "مدفوعة"]]} />}</>;
}

function CardDetail({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[9px] text-[#9aafac]">{label}</div><div className="mt-1 font-bold leading-5 text-[#496f6c]">{value}</div></div>;
}

type ClinicAppointment = {
  id: string;
  patient: string;
  doctor: string;
  number: string;
  date: string;
  time: string;
  type: "نقدي" | "تأمين" | "باقة";
  payment: string;
  source: string;
  approval: string;
  status: "مؤكد" | "تمت الزيارة" | "مكتمل" | "قيد الانتظار" | "ملغي" | "مرفوض";
  mode: "حضوري" | "فيديو";
  arrived: boolean;
};

const appointmentSeed: ClinicAppointment[] = [
  { id: "APT-1094", patient: "سارة أحمد العتيبي", doctor: "د. ليان المطيري", number: "١٠٩٤", date: "2025-05-18", time: "09:00", type: "تأمين", payment: "مدفوع", source: "الويب", approval: "تمت الموافقة", status: "مؤكد", mode: "حضوري", arrived: false },
  { id: "APT-1093", patient: "عبدالله سالم القحطاني", doctor: "د. عمر الحربي", number: "١٠٩٣", date: "2025-05-18", time: "10:00", type: "نقدي", payment: "مدفوع", source: "التطبيق", approval: "لا يتطلب موافقة", status: "قيد الانتظار", mode: "فيديو", arrived: false },
  { id: "APT-1092", patient: "نورة محمد الغامدي", doctor: "د. ريم الزهراني", number: "١٠٩٢", date: "2025-05-19", time: "11:30", type: "باقة", payment: "مدفوع", source: "الاستقبال", approval: "تمت الموافقة", status: "مكتمل", mode: "حضوري", arrived: true },
  { id: "APT-1091", patient: "خالد إبراهيم الشهري", doctor: "د. ليان المطيري", number: "١٠٩١", date: "2025-05-19", time: "13:00", type: "تأمين", payment: "بانتظار الدفع", source: "الهاتف", approval: "بانتظار الموافقة", status: "مرفوض", mode: "حضوري", arrived: false },
  { id: "APT-1090", patient: "ريم سعد الدوسري", doctor: "د. عمر الحربي", number: "١٠٩٠", date: "2025-05-20", time: "14:15", type: "نقدي", payment: "غير مدفوع", source: "الويب", approval: "لا يتطلب موافقة", status: "ملغي", mode: "فيديو", arrived: false },
  { id: "APT-1089", patient: "محمد علي الزهراني", doctor: "د. ريم الزهراني", number: "١٠٨٩", date: "2025-05-20", time: "15:30", type: "باقة", payment: "مدفوع", source: "التطبيق", approval: "تمت الموافقة", status: "تمت الزيارة", mode: "حضوري", arrived: true },
  { id: "APT-1088", patient: "أمل حسن المطيري", doctor: "د. ليان المطيري", number: "١٠٨٨", date: "2025-05-21", time: "16:00", type: "تأمين", payment: "مدفوع جزئيًا", source: "الاستقبال", approval: "بانتظار الموافقة", status: "مؤكد", mode: "فيديو", arrived: false },
  { id: "APT-1087", patient: "فهد صالح القحطاني", doctor: "د. عمر الحربي", number: "١٠٨٧", date: "2025-05-21", time: "17:45", type: "نقدي", payment: "مدفوع", source: "الهاتف", approval: "لا يتطلب موافقة", status: "قيد الانتظار", mode: "حضوري", arrived: false },
];

function AppointmentsView({ branch, onBook }: { branch: string; onBook: () => void }) {
  const statuses: ClinicAppointment["status"][] = ["مؤكد", "تمت الزيارة", "مكتمل", "قيد الانتظار", "ملغي", "مرفوض"];
  const types: ClinicAppointment["type"][] = ["نقدي", "تأمين", "باقة"];
  const modes: ClinicAppointment["mode"][] = ["حضوري", "فيديو"];
  const [clinicAppointments, setClinicAppointments] = useState<ClinicAppointment[]>(() => {
    if (typeof window === "undefined") return appointmentSeed;
    try { return JSON.parse(window.localStorage.getItem("zaincare-appointments") ?? "null") ?? appointmentSeed; } catch { return appointmentSeed; }
  });
  const [search, setSearch] = useState("");
  const [doctor, setDoctor] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [statusFilters, setStatusFilters] = useState<ClinicAppointment["status"][]>([]);
  const [typeFilters, setTypeFilters] = useState<ClinicAppointment["type"][]>([]);
  const [modeFilters, setModeFilters] = useState<ClinicAppointment["mode"][]>([]);
  const [notice, setNotice] = useState("");

  useEffect(() => { window.localStorage.setItem("zaincare-appointments", JSON.stringify(clinicAppointments)); }, [clinicAppointments]);
  const doctors = Array.from(new Set(clinicAppointments.map((item) => item.doctor)));
  const toggleFilter = <T extends string>(value: T, values: T[], setter: (next: T[]) => void) => setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  const visibleAppointments = useMemo(() => clinicAppointments.filter((item) => {
    const term = search.trim().toLowerCase();
    return (!term || `${item.patient} ${item.doctor} ${item.number}`.toLowerCase().includes(term)) && (!doctor || item.doctor === doctor) && (!fromDate || item.date >= fromDate) && (!toDate || item.date <= toDate) && (!statusFilters.length || statusFilters.includes(item.status)) && (!typeFilters.length || typeFilters.includes(item.type)) && (!modeFilters.length || modeFilters.includes(item.mode));
  }), [clinicAppointments, search, doctor, fromDate, toDate, statusFilters, typeFilters, modeFilters]);
  const cycleStatus = (id: string) => setClinicAppointments((items) => items.map((item) => item.id === id ? { ...item, status: statuses[(statuses.indexOf(item.status) + 1) % statuses.length] } : item));
  const markArrival = (id: string) => { setClinicAppointments((items) => items.map((item) => item.id === id ? { ...item, arrived: true, status: item.status === "مؤكد" ? "قيد الانتظار" : item.status } : item)); setNotice("تم تسجيل وصول المريض وفتح الموعد"); };
  const filterButton = (active: boolean) => cn("rounded-full border px-3 py-2 text-[10px] font-bold transition", active ? "border-[#0d857b] bg-[#e6f4f1] text-[#0d716a]" : "border-[#dfece9] bg-white text-[#789592] hover:border-[#acd8d2]");
  const statusTone = (status: ClinicAppointment["status"]) => status === "مؤكد" || status === "مكتمل" ? "bg-[#e5f6ef] text-[#28765d]" : status === "قيد الانتظار" ? "bg-[#fff3df] text-[#a36d21]" : status === "تمت الزيارة" ? "bg-[#e8f1fb] text-[#4678a5]" : "bg-[#fceae7] text-[#b55745]";

  return <div dir="rtl">
    <ViewHeader eyebrow="الجدولة والحجز" title="المواعيد" description={`${branch} · إدارة المواعيد والانتظار والتذكيرات`} action="إضافة جديد" icon={CalendarDays} onAction={onBook} />
    <section className="mb-6 rounded-[22px] border border-[#e3eeeb] bg-white p-4 shadow-[0_4px_18px_rgba(30,73,72,0.025)] sm:p-6">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.5fr)_1fr_1fr_1fr_auto]">
        <label className="relative"><Search className="absolute right-3 top-3 h-4 w-4 text-[#91aaa6]" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث باسم المريض أو رقم الموعد" className="h-10 w-full rounded-xl border border-[#dfeae8] bg-[#fbfdfc] pr-10 pl-3 text-[11px] text-[#365f5d] outline-none focus:border-[#75bdb5]" /></label>
        <input aria-label="من تاريخ" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className={formControlClass()} />
        <input aria-label="إلى تاريخ" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className={formControlClass()} />
        <select aria-label="اختيار الطبيب" value={doctor} onChange={(event) => setDoctor(event.target.value)} className={formControlClass()}><option value="">كل الأطباء</option>{doctors.map((name) => <option key={name}>{name}</option>)}</select>
        <button onClick={() => setNotice("تم تحديث الجدول من البيانات المحفوظة محليًا")} className="flex h-10 items-center justify-center gap-2 rounded-xl border border-[#b9ded8] bg-white px-4 text-[11px] font-bold text-[#0d716a]"><CalendarClock className="h-4 w-4" /> تحديث الجدول</button>
      </div>
      <div className="mt-5 space-y-3 border-t border-[#edf3f1] pt-4">
        <div className="flex flex-wrap items-center gap-2"><span className="w-20 text-[10px] font-bold text-[#829d99]">حالة الموعد</span>{statuses.map((value) => <button key={value} onClick={() => toggleFilter(value, statusFilters, setStatusFilters)} className={filterButton(statusFilters.includes(value))}>{value}</button>)}</div>
        <div className="flex flex-wrap items-center gap-2"><span className="w-20 text-[10px] font-bold text-[#829d99]">الدفع / النوع</span>{types.map((value) => <button key={value} onClick={() => toggleFilter(value, typeFilters, setTypeFilters)} className={filterButton(typeFilters.includes(value))}>{value}</button>)}</div>
        <div className="flex flex-wrap items-center gap-2"><span className="w-20 text-[10px] font-bold text-[#829d99]">نمط الزيارة</span>{modes.map((value) => <button key={value} onClick={() => toggleFilter(value, modeFilters, setModeFilters)} className={filterButton(modeFilters.includes(value))}>{value}</button>)}</div>
      </div>
    </section>
    {notice && <div role="status" className="mb-4 rounded-xl bg-[#e8f7f1] px-4 py-3 text-[11px] font-bold text-[#28765d]">{notice}</div>}
    <div className="mb-4 flex items-center justify-between"><div><h2 className="text-[16px] font-bold text-[#234b4b]">جدول المواعيد</h2><p className="mt-1 text-[11px] text-[#96aaa8]">{toArabicNumber(visibleAppointments.length)} مواعيد مطابقة</p></div><button onClick={onBook} className="flex h-10 items-center gap-2 rounded-xl bg-[#0d716a] px-4 text-[11px] font-bold text-white"><Plus className="h-4 w-4" /> إضافة جديد</button></div>
    {visibleAppointments.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{visibleAppointments.map((item) => <article key={item.id} className="overflow-hidden rounded-[20px] border border-[#dcebe8] bg-white shadow-[0_5px_20px_rgba(30,73,72,0.04)] transition hover:-translate-y-0.5 hover:border-[#acd8d2]">
      <div className="flex items-start justify-between border-b border-[#edf3f1] p-4"><div><h3 className="text-[13px] font-bold text-[#234b4b]">{item.patient}</h3><p className="mt-1 text-[10px] font-semibold text-[#76938f]">{item.doctor}</p></div><span className={cn("rounded-full px-2.5 py-1 text-[9px] font-bold", statusTone(item.status))}>{item.status}</span></div>
      <div className="space-y-3 p-4 text-[10px]"><div className="grid grid-cols-2 gap-3"><CardDetail label="رقم الموعد / الطابور" value={item.number} /><CardDetail label="التاريخ" value={item.date} /><CardDetail label="الوقت" value={item.time} /><CardDetail label="نمط الزيارة" value={item.mode} /><CardDetail label="النوع" value={item.type} /><CardDetail label="حالة الدفع" value={item.payment} /><CardDetail label="المصدر" value={item.source} /><CardDetail label="الطلب / الموافقة" value={item.approval} /></div><div className="flex gap-2 border-t border-[#edf3f1] pt-3"><button onClick={() => cycleStatus(item.id)} className="flex-1 rounded-xl bg-[#e6f4f1] px-2 py-2.5 text-[10px] font-bold text-[#0d716a]">تحديث الحالة</button><button onClick={() => markArrival(item.id)} className={cn("flex-1 rounded-xl px-2 py-2.5 text-[10px] font-bold", item.arrived ? "bg-[#edf3f1] text-[#789592]" : "bg-[#0d716a] text-white")}>{item.arrived ? "تم الوصول" : "فتح / وصول"}</button></div></div>
    </article>)}</div> : <div className="rounded-[22px] border border-dashed border-[#cfe2df] bg-white py-16 text-center text-[12px] text-[#829d99]">لا توجد مواعيد مطابقة للفلاتر الحالية</div>}
  </div>;
  const [selectedDay, setSelectedDay] = useState("الأحد");
  const days = ["السبت", "الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس"];
  return <><ViewHeader eyebrow="الجدولة والحجز" title="مواعيد العيادة" description={`${branch} · إدارة المواعيد والانتظار والتذكيرات`} action="حجز موعد" icon={CalendarDays} onAction={onBook} /><div className="mb-6 flex gap-2 overflow-x-auto pb-1">{days.map((day, index) => <button key={day} onClick={() => setSelectedDay(day)} className={cn("min-w-[92px] rounded-xl border px-4 py-3 text-right transition", selectedDay === day ? "border-[#0d857b] bg-[#e6f4f1] text-[#0d716a]" : "border-[#e3eeeb] bg-white text-[#769390] hover:border-[#acd8d2]")}><div className="text-[10px] font-semibold">{day}</div><div className="mt-1 text-[16px] font-bold">{17 + index}</div></button>)}</div><div className="grid gap-6 xl:grid-cols-[1fr_320px]"><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-[16px] font-bold text-[#234b4b]">جدول {selectedDay}</h2><p className="mt-1 text-[11px] text-[#96aaa8]">٤ أطباء · ٣٨ موعدًا</p></div><div className="flex gap-2"><button onClick={() => setSelectedDay(days[Math.max(0, days.indexOf(selectedDay) - 1)])} aria-label="اليوم السابق" className="rounded-lg bg-[#f5f9f8] p-2 text-[#789794]"><ChevronRight className="h-4 w-4" /></button><button onClick={() => setSelectedDay(days[Math.min(days.length - 1, days.indexOf(selectedDay) + 1)])} aria-label="اليوم التالي" className="rounded-lg bg-[#f5f9f8] p-2 text-[#789794]"><ChevronLeft className="h-4 w-4" /></button></div></div><div className="space-y-2">{appointments.map((appointment) => <AppointmentRow key={appointment.time + appointment.patient} appointment={appointment} />)}</div></div><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><h2 className="text-[16px] font-bold text-[#234b4b]">قواعد الحجز</h2><p className="mt-1 text-[11px] text-[#96aaa8]">إعدادات الفرع الحالية</p><div className="mt-5 space-y-4"><SettingRow label="أقل مدة قبل الحجز" value="ساعتان" /><SettingRow label="نافذة الإلغاء" value="٢٤ ساعة" /><SettingRow label="التذكير" value="واتساب + SMS" /><SettingRow label="الإجازة الأسبوعية" value="الجمعة" /></div><div className="mt-6 rounded-xl bg-[#f1f8f6] p-3 text-[11px] leading-5 text-[#6b8d89]">يتم تحديث التوافر تلقائيًا عند تغيير جدول الطبيب أو إضافة فترة صلاة.</div></div></div></>;
}

type ReceptionRecord = {
  id: string;
  collector: string;
  clinic: string;
  appointment: string;
  doctor: string;
  patient: string;
  date: string;
  time: string;
  createdAt: string;
  updatedAt: string;
  status: "مسجل" | "في الطابور" | "جاري النداء" | "مكتمل";
};

const receptionSeed: ReceptionRecord[] = [
  { id: "REC-1042", collector: "ريم السبيعي", clinic: "عيادة ١", appointment: "109", doctor: "د. ليان المطيري", patient: "سارة أحمد العتيبي", date: "2025-05-18", time: "09:30", createdAt: "2025-05-18 09:12", updatedAt: "2025-05-18 09:18", status: "جاري النداء" },
  { id: "REC-1041", collector: "ريم السبيعي", clinic: "عيادة ٢", appointment: "117", doctor: "د. عمر الحربي", patient: "عبدالله سالم القحطاني", date: "2025-05-18", time: "10:00", createdAt: "2025-05-18 09:20", updatedAt: "2025-05-18 09:20", status: "في الطابور" },
  { id: "REC-1040", collector: "نجلاء القحطاني", clinic: "عيادة ٣", appointment: "121", doctor: "د. ريم الزهراني", patient: "نورة محمد الغامدي", date: "2025-05-18", time: "10:30", createdAt: "2025-05-18 09:34", updatedAt: "2025-05-18 09:34", status: "مسجل" },
  { id: "REC-1039", collector: "نجلاء القحطاني", clinic: "عيادة ١", appointment: "098", doctor: "د. ليان المطيري", patient: "خالد إبراهيم الشهري", date: "2025-05-17", time: "16:15", createdAt: "2025-05-17 15:58", updatedAt: "2025-05-17 16:22", status: "مكتمل" },
];

function QueueView({ branch }: { branch: string }) {
  const [records, setRecords] = useState<ReceptionRecord[]>(() => {
    if (typeof window === "undefined") return receptionSeed;
    try {
      return JSON.parse(window.localStorage.getItem("zaincare-reception-records") ?? "null") ?? receptionSeed;
    } catch {
      return receptionSeed;
    }
  });
  const [showForm, setShowForm] = useState(false);
  const [view, setView] = useState<"records" | "queue">("records");
  const [draftRange, setDraftRange] = useState({ from: "", to: "" });
  const [range, setRange] = useState({ from: "", to: "" });
  const [activeId, setActiveId] = useState(() => records.find((row) => row.status === "جاري النداء")?.id ?? "");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ patient: "", doctor: "د. ليان المطيري", clinic: "عيادة ١", appointment: "", date: new Date().toISOString().slice(0, 10), time: "09:00" });

  useEffect(() => {
    window.localStorage.setItem("zaincare-reception-records", JSON.stringify(records));
  }, [records]);

  const visibleRecords = useMemo(() => records.filter((row) => (!range.from || row.date >= range.from) && (!range.to || row.date <= range.to)), [records, range]);
  const queue = records.filter((row) => row.status === "في الطابور" || row.status === "جاري النداء");
  const current = records.find((row) => row.id === activeId) ?? queue[0];
  const updateForm = (key: keyof typeof form, value: string) => setForm((currentForm) => ({ ...currentForm, [key]: value }));
  const activate = (id: string) => {
    const updatedAt = new Date().toLocaleString("ar-SA");
    setRecords((rows) => rows.map((row) => row.id === id ? { ...row, status: "جاري النداء", updatedAt } : row.status === "جاري النداء" ? { ...row, status: "في الطابور", updatedAt } : row));
    setActiveId(id);
    setNotice("تم تفعيل الاستقبال في الطابور المباشر");
    setView("queue");
  };
  const addToQueue = (id: string) => {
    setRecords((rows) => rows.map((row) => row.id === id ? { ...row, status: "في الطابور", updatedAt: new Date().toLocaleString("ar-SA") } : row));
    setNotice("تمت إضافة المراجع إلى الطابور");
  };
  const callNext = () => {
    const waiting = records.find((row) => row.status === "في الطابور");
    if (waiting) activate(waiting.id);
    else setNotice("لا يوجد مراجعون بانتظار النداء");
  };
  const saveReception = (event: FormEvent) => {
    event.preventDefault();
    const now = new Date().toLocaleString("ar-SA");
    setRecords((rows) => [{ id: `REC-${String(Date.now()).slice(-6)}`, collector: "موظف الاستقبال", clinic: form.clinic, appointment: form.appointment, doctor: form.doctor, patient: form.patient, date: form.date, time: form.time, createdAt: now, updatedAt: now, status: "مسجل" }, ...rows]);
    setShowForm(false);
    setNotice("تم حفظ سجل الاستقبال محليًا");
  };
  const columns = ["المعرّف", "محصل العيادة", "رقم العيادة", "رقم الموعد", "الطبيب", "المريض", "التاريخ", "الوقت", "تاريخ الإنشاء", "تاريخ التحديث", "الحالة"];
  const exportRows = visibleRecords.map((row) => [row.id, row.collector, row.clinic, row.appointment, row.doctor, row.patient, row.date, row.time, row.createdAt, row.updatedAt, row.status]);

  return <div dir="rtl">
    <div className="mb-7 flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div><div className="mb-2 flex items-center gap-2 text-[11px] font-bold text-[#92aaa7]"><Activity className="h-4 w-4 text-[#0d857b]" /> الاستقبال والطابور</div><h1 className="text-[28px] font-bold tracking-[-0.04em] text-[#183f42] sm:text-[32px]">الاستقبال</h1><p className="mt-2 text-[13px] text-[#76918e]">{branch} · تسجيل وصول المرضى وربطهم بالطابور المباشر</p></div>
      <div className="flex flex-col gap-2 sm:flex-row"><button onClick={() => setShowForm(true)} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0d716a] px-4 text-xs font-bold text-white"><Plus className="h-4 w-4" /> استقبال جديد</button><button onClick={() => setView(view === "records" ? "queue" : "records")} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-[#b9ded8] bg-white px-4 text-xs font-bold text-[#0d716a]"><Activity className="h-4 w-4" /> {view === "records" ? "عرض شاشة الاستقبال" : "عرض سجلات الاستقبال"}</button></div>
    </div>
    {notice && <div role="status" className="mb-4 rounded-xl bg-[#e8f7f1] px-4 py-3 text-[11px] font-bold text-[#28765d]">{notice}</div>}
    {showForm && <form onSubmit={saveReception} className="mb-6 rounded-[22px] border border-[#b9ded8] bg-white p-5 shadow-[0_10px_30px_rgba(30,73,72,0.08)]"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-[16px] font-bold text-[#234b4b]">استقبال جديد</h2><p className="mt-1 text-[10px] text-[#96aaa8]">أدخل بيانات وصول المريض</p></div><button type="button" onClick={() => setShowForm(false)} aria-label="إغلاق"><X className="h-4 w-4 text-[#8ea7a3]" /></button></div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><FormField label="المريض" required><input required value={form.patient} onChange={(event) => updateForm("patient", event.target.value)} className={formControlClass()} /></FormField><FormField label="الطبيب" required><select value={form.doctor} onChange={(event) => updateForm("doctor", event.target.value)} className={formControlClass()}><option>د. ليان المطيري</option><option>د. عمر الحربي</option><option>د. ريم الزهراني</option></select></FormField><FormField label="العيادة" required><select value={form.clinic} onChange={(event) => updateForm("clinic", event.target.value)} className={formControlClass()}><option>عيادة ١</option><option>عيادة ٢</option><option>عيادة ٣</option></select></FormField><FormField label="رقم الموعد" required><input required value={form.appointment} onChange={(event) => updateForm("appointment", event.target.value)} className={formControlClass()} /></FormField><FormField label="التاريخ" required><input required type="date" value={form.date} onChange={(event) => updateForm("date", event.target.value)} className={formControlClass()} /></FormField><FormField label="الوقت" required><input required type="time" value={form.time} onChange={(event) => updateForm("time", event.target.value)} className={formControlClass()} /></FormField></div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setShowForm(false)} className="h-10 rounded-xl border border-[#dfece9] px-4 text-[10px] font-bold text-[#769390]">إلغاء</button><button type="submit" className="h-10 rounded-xl bg-[#0d716a] px-5 text-[10px] font-bold text-white">حفظ الاستقبال</button></div></form>}
    {view === "records" ? <section className="rounded-[22px] border border-[#e3eeeb] bg-white p-4 shadow-[0_4px_18px_rgba(30,73,72,0.025)] sm:p-6"><div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><h2 className="text-[16px] font-bold text-[#234b4b]">سجلات الاستقبال</h2><p className="mt-1 text-[11px] text-[#96aaa8]">{toArabicNumber(visibleRecords.length)} سجلات مطابقة</p></div><div className="flex flex-col gap-2 sm:flex-row sm:items-end"><FormField label="من تاريخ"><input type="date" value={draftRange.from} onChange={(event) => setDraftRange((value) => ({ ...value, from: event.target.value }))} className={formControlClass()} /></FormField><FormField label="إلى تاريخ"><input type="date" value={draftRange.to} onChange={(event) => setDraftRange((value) => ({ ...value, to: event.target.value }))} className={formControlClass()} /></FormField><button onClick={() => setRange(draftRange)} className="flex h-10 items-center justify-center gap-2 rounded-xl bg-[#e6f4f1] px-4 text-[11px] font-bold text-[#0d716a]"><SlidersHorizontal className="h-4 w-4" /> تصفية</button><button onClick={() => downloadCsv("reception-records.csv", columns, exportRows)} className="flex h-10 items-center justify-center gap-2 rounded-xl border border-[#dfebe8] px-4 text-[11px] font-bold text-[#6d8b88]"><Download className="h-4 w-4" /> تصدير CSV</button></div></div><div className="overflow-x-auto"><table className="w-full min-w-[1450px] text-right"><thead><tr className="border-b border-[#dbeaf0] bg-[#eaf6fb] text-[10px] font-bold text-[#5d7f91]">{columns.map((column) => <th key={column} className="px-3 py-3">{column}</th>)}<th className="px-3 py-3">إجراء</th></tr></thead><tbody>{visibleRecords.map((row) => <tr key={row.id} className="border-b border-[#f0f4f3] text-[11px] last:border-0 hover:bg-[#fbfdfd]">{[row.id, row.collector, row.clinic, row.appointment, row.doctor, row.patient, row.date, row.time, row.createdAt, row.updatedAt].map((cell, index) => <td key={`${row.id}-${index}`} className={cn("px-3 py-3 text-[#66817f]", (index === 0 || index === 5) && "font-bold text-[#426765]")}>{cell}</td>)}<td className="px-3 py-3"><StatusPill tone={row.status === "مكتمل" ? "teal" : row.status === "جاري النداء" ? "blue" : "amber"}>{row.status}</StatusPill></td><td className="px-3 py-3"><button disabled={row.status === "مكتمل"} onClick={() => row.status === "مسجل" ? addToQueue(row.id) : activate(row.id)} className="rounded-lg bg-[#e6f4f1] px-3 py-2 text-[10px] font-bold text-[#0d716a] disabled:cursor-not-allowed disabled:opacity-40">{row.status === "مسجل" ? "إضافة للطابور" : row.status === "مكتمل" ? "مكتمل" : "تفعيل النداء"}</button></td></tr>)}</tbody></table></div></section> : <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]"><section className="rounded-[22px] border border-[#d5e9e5] bg-white p-5 sm:p-6"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-[16px] font-bold text-[#234b4b]">الطابور المباشر</h2><p className="mt-1 text-[11px] text-[#96aaa8]">مرتبط بسجلات الاستقبال</p></div><StatusPill>مباشر</StatusPill></div><div className="mb-5 rounded-2xl bg-[#eaf6f2] p-6 text-center"><div className="text-[11px] font-bold text-[#6c918c]">الرقم الحالي</div><div className="my-2 text-[38px] font-bold text-[#0d716a]" dir="ltr">{current?.appointment ?? "—"}</div><div className="text-[13px] font-bold text-[#426765]">{current?.patient ?? "لا يوجد مراجع حالي"}</div><div className="mt-1 text-[10px] text-[#7b9a96]">{current ? `${current.doctor} · ${current.clinic}` : ""}</div></div><div className="flex gap-2"><button onClick={callNext} className="flex-1 rounded-xl bg-[#0d716a] py-3 text-[11px] font-bold text-white">استدعاء التالي</button><button onClick={() => setNotice(current ? `تمت إعادة نداء ${current.patient}` : "لا يوجد رقم حالي")} className="rounded-xl border border-[#dfece9] px-4 text-[11px] font-bold text-[#6e8e8a]">إعادة النداء</button></div></section><section className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><h2 className="text-[16px] font-bold text-[#234b4b]">قائمة الانتظار</h2><p className="mt-1 text-[11px] text-[#96aaa8]">{toArabicNumber(queue.length)} مراجعين</p><div className="mt-5 space-y-3">{queue.map((row) => <button key={row.id} onClick={() => activate(row.id)} className={cn("flex w-full items-center justify-between rounded-xl border p-3 text-right", row.id === current?.id ? "border-[#0d857b] bg-[#eaf7f4]" : "border-[#edf3f1]")}><div><div className="text-[11px] font-bold text-[#426765]">{row.patient}</div><div className="mt-1 text-[9px] text-[#8ba4a1]">{row.doctor} · {row.time}</div></div><span className="text-[15px] font-bold text-[#0d716a]" dir="ltr">{row.appointment}</span></button>)}</div></section></div>}
  </div>;
}

function LegacyQueueView({ branch }: { branch: string }) {
  const [activeNumber, setActiveNumber] = useState("A-017");
  const [recalled, setRecalled] = useState(false);
  const tickets = [{ number: "A-017", name: "سارة أحمد", doctor: "د. ليان المطيري", room: "غرفة ٣", wait: "الآن", tone: "teal" as const }, { number: "A-018", name: "عبدالله سالم", doctor: "د. عمر الحربي", room: "غرفة ٢", wait: "٤ دقائق", tone: "purple" as const }, { number: "A-019", name: "نورة محمد", doctor: "د. ليان المطيري", room: "غرفة ٣", wait: "١١ دقيقة", tone: "amber" as const }, { number: "A-020", name: "خالد إبراهيم", doctor: "د. ريم الزهراني", room: "غرفة ١", wait: "١٨ دقيقة", tone: "blue" as const }];
  const current = tickets.find((ticket) => ticket.number === activeNumber) ?? tickets[0];
  return <><ViewHeader eyebrow="الاستقبال والطابور" title="الطابور المباشر" description={`${branch} · متابعة المراجعين لحظة بلحظة`} action="تسجيل حضور" icon={Activity} /><div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]"><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-[16px] font-bold text-[#234b4b]">لوحة التشغيل</h2><p className="mt-1 text-[11px] text-[#96aaa8]">آخر تحديث قبل ١٢ ثانية</p></div><StatusPill>مباشر</StatusPill></div><div className="mb-5 rounded-2xl bg-[#eaf6f2] p-5 text-center"><div className="text-[11px] font-bold text-[#6c918c]">الرقم الحالي</div><div className="my-2 text-[43px] font-bold tracking-[-0.05em] text-[#0d716a]" dir="ltr">{current.number}</div><div className="text-[12px] font-bold text-[#426765]">{current.name} · {current.room}</div><div className="mt-1 text-[10px] text-[#7b9a96]">{current.doctor}</div></div><div className="flex gap-2"><button onClick={() => setActiveNumber(tickets[Math.min(tickets.findIndex((ticket) => ticket.number === activeNumber) + 1, tickets.length - 1)].number)} className="flex-1 rounded-xl bg-[#0d716a] py-3 text-[11px] font-bold text-white">استدعاء التالي</button><button onClick={() => setRecalled(true)} className="rounded-xl border border-[#dfece9] px-4 text-[11px] font-bold text-[#6e8e8a]">{recalled ? "تمت إعادة النداء" : "إعادة النداء"}</button></div></div><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-[16px] font-bold text-[#234b4b]">قائمة الانتظار</h2><p className="mt-1 text-[11px] text-[#96aaa8]">{tickets.length} مراجعين نشطين</p></div><button className="rounded-lg p-2 text-[#99afac] hover:bg-[#f3f8f7]"><MoreHorizontal className="h-5 w-5" /></button></div><div className="space-y-2">{tickets.map((ticket) => <button key={ticket.number} onClick={() => setActiveNumber(ticket.number)} className={cn("flex w-full items-center gap-3 rounded-xl border p-3 text-right transition", activeNumber === ticket.number ? "border-[#a8d8d1] bg-[#f3faf8]" : "border-[#edf3f1] hover:border-[#c9e3df]")}><div className={cn("flex h-9 w-11 items-center justify-center rounded-lg text-[10px] font-bold", ticket.tone === "teal" ? "bg-[#dff3ee] text-[#0d857b]" : ticket.tone === "purple" ? "bg-[#f0eafb] text-[#8061bb]" : ticket.tone === "amber" ? "bg-[#fff2dc] text-[#bd812b]" : "bg-[#e8f2fb] text-[#4283b9]")} dir="ltr">{ticket.number}</div><div className="min-w-0 flex-1"><div className="truncate text-[11px] font-bold text-[#426765]">{ticket.name}</div><div className="mt-1 truncate text-[10px] text-[#9aafac]">{ticket.doctor}</div></div><span className="text-[10px] font-bold text-[#7b9793]">{ticket.wait}</span></button>)}</div></div></div></>;
}

function InvoiceForm({ onClose, onSave }: { onClose: () => void; onSave: (row: string[]) => void }) {
  const [form, setForm] = useState({ patient: "سارة أحمد العتيبي", service: "كشف جلدية", quantity: "1", price: "200", discount: "0", payment: "نقدي" });
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const subtotal = Number(form.quantity) * Number(form.price) - Number(form.discount);
  const vat = subtotal * 0.15;
  const total = subtotal + vat;
  return <form onSubmit={(event) => { event.preventDefault(); onSave([`INV-RYD-${String(Date.now()).slice(-5)}`, form.patient, form.service, `${total.toFixed(2)} ر.س`, form.payment === "تأمين" ? "بانتظار التأمين" : "مدفوعة", form.payment === "تأمين" ? "amber" : "teal"]); }} className="mb-6 rounded-[22px] border border-[#b9ded8] bg-white p-5 shadow-[0_10px_30px_rgba(30,73,72,0.08)]"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-[16px] font-bold text-[#234b4b]">فاتورة جديدة</h2><p className="mt-1 text-[10px] text-[#96aaa8]">المريض والخدمة والخصم والضريبة وطريقة الدفع</p></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-[#8ea7a3] hover:bg-[#f1f7f5]"><X className="h-4 w-4" /></button></div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><FormField label="المريض" required><select value={form.patient} onChange={(event) => update("patient", event.target.value)} className={formControlClass()}><option>سارة أحمد العتيبي</option><option>عبدالله سالم القحطاني</option><option>نورة محمد الغامدي</option></select></FormField><FormField label="الخدمة" required><select value={form.service} onChange={(event) => update("service", event.target.value)} className={formControlClass()}><option>كشف جلدية</option><option>متابعة علاج</option><option>جلسة ليزر</option><option>فحص مختبر</option></select></FormField><FormField label="الكمية" required><input type="number" min="1" value={form.quantity} onChange={(event) => update("quantity", event.target.value)} className={formControlClass()} dir="ltr" /></FormField><FormField label="سعر الوحدة" required><input type="number" min="0" value={form.price} onChange={(event) => update("price", event.target.value)} className={formControlClass()} dir="ltr" /></FormField><FormField label="الخصم"><input type="number" min="0" value={form.discount} onChange={(event) => update("discount", event.target.value)} className={formControlClass()} dir="ltr" /></FormField><FormField label="طريقة الدفع" required><select value={form.payment} onChange={(event) => update("payment", event.target.value)} className={formControlClass()}><option>نقدي</option><option>بطاقة</option><option>تأمين</option><option>باقة</option></select></FormField></div><div className="mt-5 grid grid-cols-3 gap-3 rounded-xl bg-[#f3f8f7] p-4 text-center"><div><div className="text-[9px] text-[#8ba4a1]">قبل الضريبة</div><div className="mt-1 text-[12px] font-bold text-[#426765]">{subtotal.toFixed(2)} ر.س</div></div><div><div className="text-[9px] text-[#8ba4a1]">VAT 15%</div><div className="mt-1 text-[12px] font-bold text-[#426765]">{vat.toFixed(2)} ر.س</div></div><div><div className="text-[9px] text-[#8ba4a1]">الإجمالي</div><div className="mt-1 text-[12px] font-bold text-[#0d716a]">{total.toFixed(2)} ر.س</div></div></div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="h-10 rounded-xl border border-[#dfece9] px-4 text-[10px] font-bold text-[#769390]">إلغاء</button><button type="submit" className="h-10 rounded-xl bg-[#0d716a] px-5 text-[10px] font-bold text-white">حفظ وتحصيل</button></div></form>;
}

function FinanceView({ branch }: { branch: string }) {
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [invoices, setInvoices] = useState([["INV-RYD-1048", "سارة أحمد العتيبي", "كشف جلدية", "٢٣٠ ر.س", "مدفوعة", "teal"], ["INV-RYD-1047", "عبدالله سالم القحطاني", "متابعة علاج", "١٧٢٫٥٠ ر.س", "مدفوعة", "teal"], ["INV-RYD-1046", "نورة محمد الغامدي", "فحص أولي", "١١٥ ر.س", "بانتظار التأمين", "amber"], ["INV-RYD-1045", "خالد إبراهيم الشهري", "باقة ليزر", "١٬٨٠٠ ر.س", "مدفوعة", "teal"]]);
  return <><ViewHeader eyebrow="المالية والتحصيل" title="الفوترة والمدفوعات" description={`${branch} · فواتير متوافقة مع ضريبة القيمة المضافة`} action="إنشاء فاتورة" icon={WalletCards} onAction={() => setShowInvoiceForm(true)} />{showInvoiceForm && <InvoiceForm onClose={() => setShowInvoiceForm(false)} onSave={(row) => { setInvoices((rows) => [row, ...rows]); setShowInvoiceForm(false); }} />}<SummaryCards items={[{ label: "إيرادات اليوم", value: "١٢٬٤٨٠", note: "ر.س · ↑ ٨٪", tone: "bg-[#0d857b]" }, { label: "الفواتير المدفوعة", value: "٢٩", note: "من أصل ٣٤ فاتورة", tone: "bg-[#5a91bf]" }, { label: "المبالغ المعلقة", value: "٤٬٣٢٠", note: "ر.س · ٧ فواتير", tone: "bg-[#e5b15a]" }, { label: "إغلاق الصندوق", value: "لم يُغلق", note: "آخر إغلاق أمس ٩:٤٥م", tone: "bg-[#8968bd]" }]} /><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-[16px] font-bold text-[#234b4b]">آخر الفواتير</h2><p className="mt-1 text-[11px] text-[#96aaa8]">كل العمليات المالية مسجلة في سجل التدقيق</p></div><button type="button" onClick={() => downloadCsv("zaincare-invoices.csv", ["رقم الفاتورة", "المريض", "الخدمة", "الإجمالي", "الحالة"], invoices.map((invoice) => invoice.slice(0, 5)))} className="flex items-center gap-2 rounded-xl border border-[#dfebe8] px-3 py-2 text-[11px] font-bold text-[#6d8b88]"><Download className="h-4 w-4" /> تصدير التقرير</button></div><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-right"><thead><tr className="border-b border-[#edf3f1] text-[10px] font-bold text-[#96aaa8]"><th className="pb-3 pr-2">رقم الفاتورة</th><th className="pb-3">المريض</th><th className="pb-3">الخدمة</th><th className="pb-3">الإجمالي</th><th className="pb-3">الحالة</th><th className="pb-3">الإجراء</th></tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice[0]} className="border-b border-[#f0f4f3] text-[11px] last:border-0"><td className="py-4 pr-2 font-mono text-[10px] text-[#789693]" dir="ltr">{invoice[0]}</td><td className="py-4 font-bold text-[#3c6260]">{invoice[1]}</td><td className="py-4 text-[#789693]">{invoice[2]}</td><td className="py-4 font-bold text-[#426765]">{invoice[3]}</td><td className="py-4"><StatusPill tone={invoice[5] as "teal" | "amber"}>{invoice[4]}</StatusPill></td><td className="py-4"><button className="rounded-lg p-2 text-[#a3b8b5] hover:bg-[#eaf6f2] hover:text-[#0d716a]"><ChevronLeft className="h-4 w-4" /></button></td></tr>)}</tbody></table></div></div></>;
}

function LabView({ branch }: { branch: string }) {
  const [tab, setTab] = useState("قيد المراجعة");
  const [results, setResults] = useState([{ patient: "نورة محمد الغامدي", test: "تحليل وظائف الغدة الدرقية", doctor: "د. ليان المطيري", time: "منذ ١٢ دقيقة", status: "نتيجة غير طبيعية", tone: "red" as const }, { patient: "خالد إبراهيم الشهري", test: "تحليل الدم الشامل CBC", doctor: "د. ريم الزهراني", time: "منذ ٤٥ دقيقة", status: "بانتظار التحقق", tone: "amber" as const }, { patient: "سارة أحمد العتيبي", test: "فيتامين د", doctor: "د. ليان المطيري", time: "منذ ساعة", status: "جاهز للتسليم", tone: "teal" as const }]);
  return <><ViewHeader eyebrow="المختبر والنتائج" title="لوحة المختبر" description={`${branch} · العينات والنتائج الطبية في مكان واحد`} action="طلب تحليل" icon={FlaskConical} onAction={() => setResults((rows) => [{ patient: "مريض جديد", test: "تحليل دم شامل CBC", doctor: "د. عمر الحربي", time: "الآن", status: "تم استلام الطلب", tone: "amber" as const }, ...rows])} /><SummaryCards items={[{ label: "عينات اليوم", value: "٢٤", note: "٨ قيد المعالجة", tone: "bg-[#0d857b]" }, { label: "بانتظار التحقق", value: "٠٤", note: "تحتاج توقيع المراجع", tone: "bg-[#e5b15a]" }, { label: "نتائج غير طبيعية", value: "٠٢", note: "تنبيه الطبيب مُفعّل", tone: "bg-[#d77e65]" }, { label: "متوسط الإنجاز", value: "٤٥ د", note: "أفضل من أمس بـ ١٢٪", tone: "bg-[#5a91bf]" }]} /><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><div className="mb-5 flex gap-2 border-b border-[#edf3f1] pb-3">{["قيد المراجعة", "كل النتائج", "العينات"].map((item) => <button key={item} onClick={() => setTab(item)} className={cn("rounded-lg px-3 py-2 text-[11px] font-bold", tab === item ? "bg-[#e6f4f1] text-[#0d716a]" : "text-[#8ba5a1] hover:bg-[#f5f9f8]")}>{item}</button>)}</div><div className="space-y-3">{results.map((result) => <div key={result.patient + result.test} className="flex flex-col gap-3 rounded-xl border border-[#edf3f1] p-4 transition hover:border-[#c7e2de] sm:flex-row sm:items-center"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#eaf3fb] text-[#4284b9]"><FlaskConical className="h-4 w-4" /></div><div className="min-w-0 flex-1"><div className="text-[12px] font-bold text-[#3d6462]">{result.test}</div><div className="mt-1 text-[10px] text-[#9aafac]">{result.patient} · {result.doctor} · {result.time}</div></div><StatusPill tone={result.tone}>{result.status}</StatusPill><button className="rounded-xl border border-[#dfebe8] px-3 py-2 text-[10px] font-bold text-[#6d8b88]">فتح النتيجة</button></div>)}</div></div></>;
}

function InsuranceView({ branch }: { branch: string }) {
  const [claims, setClaims] = useState([["CLM-2025-0184", "نورة محمد الغامدي", "بوبا العربية", "٢٬٤٥٠ ر.س", "بانتظار الرد", "amber"], ["CLM-2025-0183", "عبدالله سالم القحطاني", "التعاونية", "٨٧٥ ر.س", "مقبولة", "teal"], ["CLM-2025-0182", "سارة أحمد العتيبي", "ملاذ للتأمين", "١٬٢٥٠ ر.س", "تحتاج تصحيح", "red"]]);
  return <><ViewHeader eyebrow="التأمين والمطالبات" title="مركز المطالبات" description={`${branch} · متابعة الأهلية والموافقات والتسويات`} action="فحص أهلية" icon={ShieldCheck} onAction={() => setClaims((rows) => [[`ELG-${String(Date.now()).slice(-5)}`, "مريض جديد", "بوبا العربية", "—", "مؤهل", "teal"], ...rows])} /><SummaryCards items={[{ label: "مطالبات هذا الشهر", value: "١٨٤", note: "↑ ١٢٪ عن الشهر السابق", tone: "bg-[#0d857b]" }, { label: "نسبة القبول الأولي", value: "٩٢٪", note: "أعلى من متوسط السوق", tone: "bg-[#5a91bf]" }, { label: "تحتاج متابعة", value: "٠٧", note: "بما فيها ٢ مرفوضة", tone: "bg-[#e5b15a]" }, { label: "متوسط التحصيل", value: "١٢٫٤ يوم", note: "من تاريخ الإرسال", tone: "bg-[#8968bd]" }]} /><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-[16px] font-bold text-[#234b4b]">حالات المطالبات</h2><p className="mt-1 text-[11px] text-[#96aaa8]">NPHIES-ready · آخر مزامنة منذ ٦ دقائق</p></div><button type="button" onClick={() => downloadCsv("zaincare-rejections.csv", ["رقم المطالبة", "المريض", "شركة التأمين", "القيمة", "الحالة"], claims.map((claim) => claim.slice(0, 5)))} className="flex items-center gap-2 rounded-xl border border-[#dfebe8] px-3 py-2 text-[11px] font-bold text-[#6d8b88]"><Download className="h-4 w-4" /> تقرير الرفض</button></div><div className="overflow-x-auto"><table className="w-full min-w-[690px] text-right"><thead><tr className="border-b border-[#edf3f1] text-[10px] font-bold text-[#96aaa8]"><th className="pb-3 pr-2">رقم المطالبة</th><th className="pb-3">المريض</th><th className="pb-3">شركة التأمين</th><th className="pb-3">القيمة</th><th className="pb-3">الحالة</th><th className="pb-3">الإجراء</th></tr></thead><tbody>{claims.map((claim) => <tr key={claim[0]} className="border-b border-[#f0f4f3] text-[11px] last:border-0"><td className="py-4 pr-2 font-mono text-[10px] text-[#789693]" dir="ltr">{claim[0]}</td><td className="py-4 font-bold text-[#3c6260]">{claim[1]}</td><td className="py-4 text-[#789693]">{claim[2]}</td><td className="py-4 font-bold text-[#426765]">{claim[3]}</td><td className="py-4"><StatusPill tone={claim[5] as "teal" | "amber" | "red"}>{claim[4]}</StatusPill></td><td className="py-4"><button className="rounded-lg p-2 text-[#a3b8b5] hover:bg-[#eaf6f2] hover:text-[#0d716a]"><ChevronLeft className="h-4 w-4" /></button></td></tr>)}</tbody></table></div></div></>;
}

function PackagesView({ branch }: { branch: string }) {
  const [selectedPackage, setSelectedPackage] = useState("");
  const [sessionNotes, setSessionNotes] = useState<Record<string, string>>({});
  const packages = [{ name: "إشراقة البشرة", description: "٤ جلسات تنظيف وعناية", price: "٨٥٠ ر.س", used: "٢ / ٤", progress: "50%", tone: "teal" }, { name: "باقة الليزر الكاملة", description: "٦ جلسات · جميع المناطق", price: "١٬٨٠٠ ر.س", used: "٣ / ٦", progress: "50%", tone: "purple" }, { name: "متابعة الأطفال", description: "٥ زيارات طب أطفال", price: "٦٠٠ ر.س", used: "١ / ٥", progress: "20%", tone: "amber" }];
  return <><ViewHeader eyebrow="الباقات والاشتراكات" title="باقات العلاج" description={`${branch} · بيع الباقات ومتابعة الجلسات المتبقية`} action="إنشاء باقة" icon={Package} /><div className="mb-6 grid gap-4 md:grid-cols-3">{packages.map((item) => <div key={item.name} className="rounded-[20px] border border-[#e3eeeb] bg-white p-5 shadow-[0_4px_18px_rgba(30,73,72,0.025)]"><div className="mb-4 flex items-start justify-between"><div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", item.tone === "teal" ? "bg-[#e4f5f1] text-[#0d857b]" : item.tone === "purple" ? "bg-[#f2edfb] text-[#8565bd]" : "bg-[#fff3df] text-[#bd812b]")}><Package className="h-5 w-5" /></div><button onClick={() => setSelectedPackage(selectedPackage === item.name ? "" : item.name)} aria-label={`إجراءات ${item.name}`} className="rounded-lg p-1 text-[#a5b9b6] hover:bg-[#f3f8f7]"><MoreHorizontal className="h-5 w-5" /></button></div><h2 className="text-[15px] font-bold text-[#2f5a59]">{item.name}</h2><p className="mt-1 text-[11px] text-[#94aaa7]">{item.description}</p>{selectedPackage === item.name && <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-[#f5f9f8] p-2"><button onClick={() => setSessionNotes((current) => ({ ...current, [item.name]: "تم تسجيل جلسة اليوم" }))} className="rounded-lg bg-[#0d716a] px-2 py-2 text-[9px] font-bold text-white">تسجيل جلسة</button><button onClick={() => setSessionNotes((current) => ({ ...current, [item.name]: "تم فتح تفاصيل الاستخدام" }))} className="rounded-lg border border-[#d8e8e5] px-2 py-2 text-[9px] font-bold text-[#0d716a]">تفاصيل الاستخدام</button></div>}{sessionNotes[item.name] && <div className="mt-2 text-[9px] font-bold text-[#0d716a]">{sessionNotes[item.name]}</div>}<div className="mt-5 flex items-end justify-between"><span className="text-[18px] font-bold text-[#234b4b]">{item.price}</span><span className="text-[11px] font-bold text-[#7e9894]">{item.used}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-[#edf3f1]"><div className={cn("h-full rounded-full", item.tone === "teal" ? "bg-[#0d857b]" : item.tone === "purple" ? "bg-[#8565bd]" : "bg-[#e5b15a]")} style={{ width: item.progress }} /></div><button className="mt-4 flex w-full items-center justify-center gap-1 rounded-xl border border-[#dcebe8] py-2.5 text-[10px] font-bold text-[#6d8b88]">عرض المشتركين <ChevronLeft className="h-3.5 w-3.5" /></button></div>)}</div><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-[16px] font-bold text-[#234b4b]">آخر عمليات الاستخدام</h2><p className="mt-1 text-[11px] text-[#96aaa8]">كل جلسة مرتبطة بموعد وفاتورة</p></div><StatusPill tone="purple">١٢٣ جلسة هذا الشهر</StatusPill></div><div className="space-y-2"><UsageRow patient="سارة أحمد العتيبي" packageName="إشراقة البشرة" service="جلسة تنظيف" date="اليوم، ٠٩:٣٠" /><UsageRow patient="خالد إبراهيم الشهري" packageName="باقة الليزر الكاملة" service="جلسة ليزر" date="أمس، ١٧:٠٠" /><UsageRow patient="ريم فهد السبيعي" packageName="متابعة الأطفال" service="زيارة متابعة" date="أمس، ١٤:٣٠" /></div></div></>;
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

  return <><ViewHeader eyebrow="إعدادات العيادة" title="إعدادات النظام" description={`${branch} · التهيئة والهوية وقواعد التشغيل`} action="نوع المنشأة والوحدات" icon={Settings2} onAction={() => { const panel = document.getElementById("organization-modules-panel"); panel?.scrollIntoView({ behavior: "smooth", block: "start" }); panel?.focus({ preventScroll: true }); }} /><OrganizationModulesPanel /><div className="grid gap-6 lg:grid-cols-[230px_1fr]"><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-3"><div className="mb-3 px-3 text-[10px] font-bold text-[#9ab1af]">إعدادات المساحة</div>{localSettingsTabs.map(([id, label, Icon]) => <button key={id} onClick={() => setTab(id)} className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-3 text-right text-[11px] font-bold transition", tab === id ? "bg-[#e6f4f1] text-[#0d716a]" : "text-[#7d9894] hover:bg-[#f5f9f8]")}><Icon className="h-4 w-4" />{label}</button>)}<div className="mt-4 rounded-xl bg-[#f1f8f6] p-3"><div className="flex items-center gap-2 text-[10px] font-bold text-[#0d716a]"><Database className="h-3.5 w-3.5" /> إعدادات تشغيل محلية</div><p className="mt-1 text-[10px] leading-5 text-[#799792]">تبقى إعدادات نماذج التشغيل المحلية في هذا المتصفح، بينما يُحفظ نوع المنشأة ووحداتها بأمان في Supabase.</p></div></div><div className="min-w-0 space-y-6">{tab === "profile" && <SettingsCard title="ملف المنشأة" description="البيانات التي تظهر في البوابة والفواتير" icon={Building2}><div className="grid gap-4 sm:grid-cols-2">{input("اسم المنشأة بالعربية", "nameAr")} {input("الاسم بالإنجليزية", "nameEn", "ltr")} {input("الرقم الضريبي", "vatNumber", "ltr")} {input("المدينة", "city")} {input("رقم التواصل", "phone", "ltr")} {input("البريد الإلكتروني", "email", "ltr", "email")}</div></SettingsCard>}{tab === "users" && <SettingsCard title="المستخدمون والصلاحيات" description="إدارة الفريق والوصول حسب الدور والفرع" icon={UsersRound}><div className="mb-4 flex items-center justify-between rounded-xl bg-[#f1f8f6] p-4"><div><div className="text-[12px] font-bold text-[#426765]">١٢ مستخدمًا نشطًا</div><div className="mt-1 text-[10px] text-[#8ca6a2]">الصلاحيات مبنية على أدوار ZainCare</div></div><button className="h-10 rounded-xl bg-[#0d716a] px-4 text-[11px] font-bold text-white"><Plus className="ml-1 inline h-4 w-4" /> دعوة مستخدم</button></div>{["أحمد المطيري · مالك العيادة · كل الفروع", "د. ليان المطيري · طبيب · الرياض وجدة", "ريم السبيعي · استقبال · الرياض", "عمر الحربي · محاسب · دعوة معلقة"].map((user) => <div key={user} className="flex items-center justify-between border-b border-[#f0f4f3] py-4 last:border-0"><span className="text-[11px] font-bold text-[#426765]">{user}</span><button className="text-[10px] font-bold text-[#0d716a]">إدارة الصلاحيات</button></div>)}</SettingsCard>}{tab === "hours" && <SettingsCard title="أوقات العمل" description="جدول الفرع والفترات اليومية والاستراحات" icon={CalendarClock}><div className="grid gap-4 sm:grid-cols-3">{input("وقت الافتتاح", "openingTime", "ltr", "time")} {input("وقت الإغلاق", "closingTime", "ltr", "time")} {input("استراحة الصلاة", "prayerBreak", "ltr")}</div><div className="mt-6 space-y-2">{["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس"].map((day) => <div key={day} className="flex items-center justify-between rounded-xl border border-[#edf3f1] px-4 py-3"><span className="text-[11px] font-bold text-[#527572]">{day}</span><span className="text-[11px] text-[#789693]">{settings.openingTime} - {settings.closingTime}</span><span className="text-[10px] font-bold text-[#0d857b]">مفتوح</span></div>)}<div className="flex items-center justify-between rounded-xl border border-[#f3e4d0] bg-[#fffaf2] px-4 py-3"><span className="text-[11px] font-bold text-[#8c6e45]">الجمعة</span><span className="text-[11px] font-bold text-[#bd812b]">مغلق · قابل للتعديل</span></div></div></SettingsCard>}{tab === "notifications" && <SettingsCard title="الإشعارات والواتساب" description="قنوات التواصل الأساسية مع المرضى" icon={MessageCircle}><div className="grid gap-4 sm:grid-cols-2">{input("مزود واتساب", "whatsappProvider")} {input("رقم المرسل", "whatsappSender", "ltr")}</div><div className="mt-6 space-y-3">{toggle("تذكير الموعد قبل ٢٤ ساعة", "إرسال رسالة واتساب ثنائية اللغة", "reminder24h")}{toggle("تذكير الموعد قبل ساعة", "تقليل حالات عدم الحضور", "reminder1h")}{toggle("تنبيه اقتراب الدور", "إبلاغ المريض عند بقاء ٣ أرقام أمامه", "queueAlerts")}</div><div className="mt-5 rounded-xl border border-[#dcece8] bg-[#f4fbf8] p-4"><div className="flex items-center gap-2 text-[11px] font-bold text-[#0d716a]"><MessageCircle className="h-4 w-4" /> حالة الاتصال: متصل</div><p className="mt-1 text-[10px] text-[#789792]">تم إرسال ١٨٤ رسالة هذا الشهر بنسبة تسليم ٩٨٪.</p></div></SettingsCard>}{tab === "payments" && <SettingsCard title="الدفع والفوترة" description="طرق الدفع والضريبة وتسلسل الفواتير" icon={CreditCard}><div className="grid gap-4 sm:grid-cols-2">{input("بادئة الفاتورة", "vatNumber", "ltr")} {input("نسبة الضريبة", "vatNumber", "ltr")}</div><div className="mt-6 space-y-3">{toggle("مدى", "الدفع الإلكتروني المحلي", "mada")}{toggle("Apple Pay", "الدفع السريع من الهاتف", "applePay")}{toggle("الدفع النقدي", "تسجيل المدفوعات من الكاشير", "cash")}{toggle("التأمين", "تحويل حصة شركة التأمين إلى المطالبة", "insurance")}{toggle("تفعيل VAT والفاتورة الإلكترونية", "عرض الضريبة في الفاتورة", "vatEnabled")}</div></SettingsCard>}{tab === "security" && <SettingsCard title="الأمان والخصوصية" description="حماية بيانات المرضى وسجل التدقيق" icon={LockKeyhole}><div className="space-y-3">{toggle("المصادقة الثنائية للموظفين", "إلزام المالك والمحاسبين والأطباء بالتحقق الإضافي", "twoFactor")}{toggle("تسجيل عمليات التصدير", "حفظ كل عمليات طباعة وتصدير بيانات المرضى", "auditExports")}</div><div className="mt-6 grid gap-4 sm:grid-cols-2">{input("مهلة انتهاء الجلسة", "sessionTimeout")}<EditableField label="نسخة الموافقة PDPL" value="v2.1 · ١ مايو ٢٠٢٥" onChange={() => undefined} /></div><div className="mt-5 rounded-xl border border-[#f2ddd6] bg-[#fff8f5] p-4"><div className="flex items-center gap-2 text-[11px] font-bold text-[#c5785f]"><LockKeyhole className="h-4 w-4" /> لا توجد قاعدة بيانات مرتبطة</div><p className="mt-1 text-[10px] leading-5 text-[#98776d]">هذه النسخة تحفظ الإعدادات محليًا في المتصفح فقط.</p></div></SettingsCard>}<div className="flex flex-col items-stretch justify-between gap-3 rounded-[18px] border border-[#dcece8] bg-[#eaf7f3] p-4 sm:flex-row sm:items-center"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-[#0d716a]"><CheckCircle2 className="h-4 w-4" /></div><div><div className="text-[11px] font-bold text-[#356460]">{saved ? "تم حفظ الإعدادات محليًا" : "لديك إعدادات قابلة للحفظ"}</div><div className="mt-1 text-[10px] text-[#7c9995]">لن يتم إرسال أي بيانات إلى خادم خارجي.</div></div></div><button onClick={save} className="h-10 rounded-xl bg-[#0d716a] px-5 text-[11px] font-bold text-white transition hover:bg-[#095d58]">حفظ البيانات</button></div></div></div></>;
}

const clinicPlanFeatures = [
  "لوحة التحكم", "الاستقبال والانتظار", "المواعيد", "المرضى", "السجل الطبي", "رحلة المريض", "الخدمات", "الأقسام والعيادات", "الأطباء", "الوصفات الطبية", "الفوترة والمدفوعات", "الموارد البشرية", "الأمراض والتشخيص", "التقارير", "سجل التدقيق", "الإعدادات",
];

const medicalCenterAddedFeatures = [
  "المختبر", "الأشعة", "الصيدلية", "صرف الأدوية", "التأمين والمطالبات", "الباقات", "الحسابات", "المشتريات", "المخزون", "الرسائل والتنبيهات", "التمريض", "التحليلات المتقدمة",
];

function OrganizationModulesPanel() {
  const access = useOrganizationAccess();
  const [catalog, setCatalog] = useState<FeatureCatalogEntry[]>([]);
  const [features, setFeatures] = useState<OrganizationFeature[]>([]);
  const [updating, setUpdating] = useState<FeatureKey | null>(null);
  const [error, setError] = useState("");
  const [upgradeConfirmation, setUpgradeConfirmation] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeSuccess, setUpgradeSuccess] = useState(false);
  const canConfigure = Boolean(access.session && access.organization && isOrganizationAdmin(access.membership?.role_key));

  const loadPanelData = useCallback(async () => {
    if (!canConfigure || !access.organization) return;
    const [catalogResult, featuresResult] = await Promise.all([
      supabase.from("feature_catalog").select("feature_key, name_ar, name_en, category_key, description_ar, is_core, display_order").order("display_order", { ascending: true }),
      supabase.from("organization_features").select("organization_id, feature_key, enabled").eq("organization_id", access.organization.id),
    ]);
    if (catalogResult.error || featuresResult.error) {
      setError(catalogResult.error?.message ?? featuresResult.error?.message ?? "تعذر تحميل الوحدات");
      return;
    }
    setCatalog(catalogResult.data ?? []);
    setFeatures(featuresResult.data ?? []);
  }, [access.organization, canConfigure]);

  useEffect(() => {
    void loadPanelData();
  }, [loadPanelData]);

  if (access.legacyMode) return <div id="organization-modules-panel" tabIndex={-1} className="mb-6 scroll-mt-24 rounded-[22px] border border-[#e3eeeb] bg-white p-5 outline-none sm:p-6"><div className="mb-4"><h2 className="text-[16px] font-bold text-[#234b4b]">معاينة نوع المنشأة والوحدات</h2><p className="mt-1 text-[11px] leading-5 text-[#96aaa8]">هذه معاينة اختبارية مباشرة دون تسجيل دخول. إعدادات المنشأة الإنتاجية تبقى محفوظة بأمان في Supabase بعد تسجيل الدخول.</p></div><div className="grid gap-3 md:grid-cols-2"><button type="button" onClick={() => access.setDemoOrganizationType("clinic")} className={cn("rounded-xl border p-4 text-right transition", access.demoOrganizationType === "clinic" ? "border-[#0d857b] bg-[#eaf7f4] shadow-[0_5px_15px_rgba(13,113,106,0.08)]" : "border-[#cfe3df] bg-[#f8fcfb] hover:border-[#8acbc1]")}><div className="flex items-center justify-between gap-3"><div className="text-[13px] font-bold text-[#315d5a]">عيادة</div>{access.demoOrganizationType === "clinic" && <CheckCircle2 className="h-4 w-4 text-[#0d857b]" />}</div><p className="mt-2 text-[10px] leading-5 text-[#789592]">الوحدات الأساسية للاستقبال والمواعيد والمرضى والسجل الطبي والوصفات والفوترة والموارد البشرية.</p></button><button type="button" onClick={() => access.setDemoOrganizationType("medical_center")} className={cn("rounded-xl border p-4 text-right transition", access.demoOrganizationType === "medical_center" ? "border-[#0d857b] bg-[#eaf7f4] shadow-[0_5px_15px_rgba(13,113,106,0.08)]" : "border-[#cfe3df] bg-[#f8fcfb] hover:border-[#8acbc1]")}><div className="flex items-center justify-between gap-3"><div className="text-[13px] font-bold text-[#0d716a]">مركز طبي متكامل</div>{access.demoOrganizationType === "medical_center" && <CheckCircle2 className="h-4 w-4 text-[#0d857b]" />}</div><p className="mt-2 text-[10px] leading-5 text-[#5f817e]">كل وحدات العيادة مع المختبر والأشعة والصيدلية والتأمين والمخزون والمشتريات والتمريض.</p></button></div>{access.demoOrganizationType && <div role="status" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#f1f8f6] px-3 py-2"><span className="text-[10px] font-bold text-[#0d716a]">{access.demoOrganizationType === "clinic" ? "تم تطبيق نظام العيادة تجريبيًا" : "تم تطبيق نظام المركز الطبي المتكامل تجريبيًا"}</span><button type="button" onClick={() => access.setDemoOrganizationType(null)} className="text-[10px] font-bold text-[#6f8f8b] hover:text-[#0d716a]">عرض جميع الوحدات</button></div>}</div>;
  if (!canConfigure || !access.organization || !access.session) return null;
  const isEnabled = (featureKey: FeatureKey) => features.find((feature) => feature.feature_key === featureKey)?.enabled ?? false;
  const updateFeature = async (featureKey: FeatureKey, enabled: boolean) => {
    if (featureKey === "core_dashboard" || featureKey === "settings") return;
    setUpdating(featureKey);
    setError("");
    const { error: updateError } = await supabase
      .from("organization_features")
      .update({
        enabled,
        configured_by: access.session!.user.id,
        configured_at: new Date().toISOString(),
      })
      .eq("organization_id", access.organization!.id)
      .eq("feature_key", featureKey);
    if (updateError) setError(updateError.message);
    else {
      setFeatures((current) => [...current.filter((feature) => feature.feature_key !== featureKey), { organization_id: access.organization!.id, feature_key: featureKey, enabled }]);
      await access.refresh();
    }
    setUpdating(null);
  };
  const upgradeOrganization = async () => {
    setUpgrading(true);
    setError("");
    setUpgradeSuccess(false);
    const { error: upgradeError } = await supabase
      .from("organizations")
      .update({ organization_type: "medical_center" })
      .eq("id", access.organization!.id);
    if (upgradeError) setError(upgradeError.message);
    else {
      await access.refresh();
      await loadPanelData();
      setUpgradeConfirmation(false);
      setUpgradeSuccess(true);
    }
    setUpgrading(false);
  };

  return <div id="organization-modules-panel" tabIndex={-1} className="mb-6 scroll-mt-24 rounded-[22px] border border-[#e3eeeb] bg-white p-5 shadow-[0_4px_18px_rgba(30,73,72,0.025)] outline-none sm:p-6"><div className="mb-5 flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e4f5f1] text-[#0d857b]"><SlidersHorizontal className="h-5 w-5" /></div><div><h2 className="text-[16px] font-bold text-[#234b4b]">وحدات المنظمة</h2><p className="mt-1 text-[11px] text-[#96aaa8]">نوع المنشأة والوحدات المتاحة لأعضاء المنظمة</p></div></div><section className="mb-6 rounded-[18px] border border-[#cfe3df] bg-[#f8fcfb] p-4 sm:p-5"><div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><div className="text-[10px] font-bold text-[#8ca5a2]">نوع المنشأة الحالي</div><div className="mt-1 text-[15px] font-bold text-[#234b4b]">{access.organization.organization_type === "medical_center" ? "مركز طبي متكامل" : "عيادة"}</div></div>{access.organization.organization_type === "medical_center" && <div className="rounded-xl bg-[#e4f5f1] px-3 py-2 text-[11px] font-bold text-[#0d716a]">المركز الطبي المتكامل مفعّل</div>}</div><div className="grid gap-3 md:grid-cols-2"><div className="rounded-xl border border-[#e0ece9] bg-white p-4"><div className="text-[12px] font-bold text-[#315d5a]">عيادة</div><div className="mt-1 text-[10px] text-[#8ca5a2]">الوحدات التشغيلية الأساسية</div><div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">{clinicPlanFeatures.map((feature) => <div key={feature} className="flex items-start gap-2 text-[10px] text-[#587774]"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-[#5ba68f]" />{feature}</div>)}</div></div><div className="rounded-xl border border-[#cfe3df] bg-[#edf8f5] p-4"><div className="text-[12px] font-bold text-[#0d716a]">مركز طبي متكامل</div><div className="mt-1 text-[10px] text-[#789793]">كل وحدات العيادة، بالإضافة إلى</div><div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">{medicalCenterAddedFeatures.map((feature) => <div key={feature} className="flex items-start gap-2 text-[10px] text-[#4f7470]"><Plus className="mt-0.5 h-3 w-3 shrink-0 text-[#0d857b]" />{feature}</div>)}</div></div></div><div className="mt-3 rounded-xl bg-white px-3 py-2 text-[10px] leading-5 text-[#78928f]">الطوارئ والتنويم والإجراءات والإحالات تبقى وحدات اختيارية يمكن تفعيلها عند الحاجة.</div>{access.organization.organization_type === "clinic" && !upgradeConfirmation && <button type="button" onClick={() => { setUpgradeConfirmation(true); setUpgradeSuccess(false); }} className="mt-4 h-10 rounded-xl bg-[#0d716a] px-4 text-[11px] font-bold text-white">الترقية إلى مركز طبي متكامل</button>}{access.organization.organization_type === "clinic" && upgradeConfirmation && <div className="mt-4 rounded-xl border border-[#ead9b7] bg-[#fff8e9] p-4"><div className="text-[11px] font-bold text-[#8a6428]">تأكيد الترقية</div><p className="mt-1 text-[10px] leading-5 text-[#98794b]">ستُفعّل وحدات المركز الطبي الافتراضية مع الاحتفاظ بكل الوحدات والبيانات الحالية. لا يتوفر الرجوع إلى نوع العيادة.</p><div className="mt-3 flex gap-2"><button type="button" disabled={upgrading} onClick={() => void upgradeOrganization()} className="h-9 rounded-lg bg-[#0d716a] px-4 text-[10px] font-bold text-white disabled:opacity-60">{upgrading ? "جارٍ الترقية..." : "تأكيد الترقية"}</button><button type="button" disabled={upgrading} onClick={() => setUpgradeConfirmation(false)} className="h-9 rounded-lg border border-[#dfd1b5] bg-white px-4 text-[10px] font-bold text-[#806b43]">إلغاء</button></div></div>}{upgradeSuccess && <div role="status" className="mt-4 rounded-xl bg-[#e4f5f1] px-3 py-2 text-[10px] font-bold text-[#0d716a]">تمت الترقية وتفعيل وحدات المركز الطبي المتكامل.</div>}</section>{error && <div role="alert" className="mb-4 rounded-xl bg-[#fff0eb] px-3 py-2 text-[10px] text-[#bd654d]">{error}</div>}<div className="mb-4"><div className="text-[13px] font-bold text-[#315d5a]">تهيئة الوحدات</div><div className="mt-1 text-[10px] text-[#8ca5a2]">يمكن تفعيل الوحدات الاختيارية أو إيقافها حسب احتياج المنشأة.</div></div><div className="grid gap-3 md:grid-cols-2">{catalog.map((entry) => {
    const enabled = isEnabled(entry.feature_key);
    const protectedFeature = entry.feature_key === "core_dashboard" || entry.feature_key === "settings";
    return <div key={entry.feature_key} className="flex items-center justify-between gap-4 rounded-xl border border-[#edf3f1] p-4"><div><div className="flex items-center gap-2"><div className="text-[11px] font-bold text-[#426765]">{entry.name_ar}</div><span className={cn("rounded-md px-2 py-1 text-[9px] font-bold", entry.is_core ? "bg-[#eaf3fb] text-[#4284b9]" : "bg-[#f3effb] text-[#7654ba]")}>{entry.is_core ? "أساسية" : "اختيارية"}</span></div><div className="mt-1 text-[10px] leading-5 text-[#9aafac]">{entry.description_ar ?? entry.name_en}</div></div><Switch checked={protectedFeature || enabled} disabled={protectedFeature || updating === entry.feature_key} onCheckedChange={(checked) => void updateFeature(entry.feature_key, checked)} aria-label={`تفعيل ${entry.name_ar}`} /></div>;
  })}</div></div>;
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
  return <><ViewHeader eyebrow="إعدادات العيادة" title="إعدادات النظام" description={`${branch} · التهيئة والهوية وقواعد التشغيل`} action="نوع المنشأة والوحدات" icon={Settings2} onAction={() => { const panel = document.getElementById("organization-modules-panel"); panel?.scrollIntoView({ behavior: "smooth", block: "start" }); panel?.focus({ preventScroll: true }); }} /><div className="grid gap-6 lg:grid-cols-[220px_1fr]"><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-3"><SettingsTab icon={Building2} label="ملف المنشأة" active /><SettingsTab icon={UsersRound} label="المستخدمون والصلاحيات" /><SettingsTab icon={CalendarClock} label="أوقات العمل" /><SettingsTab icon={MessageCircle} label="الإشعارات والواتساب" /><SettingsTab icon={CreditCard} label="الدفع والفوترة" /><SettingsTab icon={LockKeyhole} label="الأمان والخصوصية" /></div><div className="space-y-6"><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><div className="mb-6 flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e4f5f1] text-[#0d857b]"><Building2 className="h-5 w-5" /></div><div><h2 className="text-[16px] font-bold text-[#234b4b]">ملف المنشأة</h2><p className="mt-1 text-[11px] text-[#96aaa8]">البيانات التي تظهر في البوابة والفواتير</p></div></div><div className="grid gap-4 sm:grid-cols-2"><Field label="اسم المنشأة بالعربية" value="مجمع زين الطبي" /><Field label="الاسم بالإنجليزية" value="Zain Medical Center" /><Field label="الرقم الضريبي" value="310123456700003" ltr /><Field label="المدينة" value="الرياض، المملكة العربية السعودية" /></div></div><div className="rounded-[22px] border border-[#e3eeeb] bg-white p-5 sm:p-6"><div className="mb-5"><h2 className="text-[16px] font-bold text-[#234b4b]">الوحدات المفعّلة</h2><p className="mt-1 text-[11px] text-[#96aaa8]">تظهر الوحدات المفعّلة فقط في القائمة الجانبية</p></div><div className="grid gap-3 sm:grid-cols-2">{["المواعيد والحجز", "الطابور المباشر", "السجل الطبي", "المختبر", "التأمين والمطالبات", "الباقات والاشتراكات"].map((module, index) => <div key={module} className="flex items-center justify-between rounded-xl border border-[#edf3f1] p-3"><div className="flex items-center gap-3"><div className="h-2 w-2 rounded-full bg-[#0d857b]" /><span className="text-[11px] font-bold text-[#527572]">{module}</span></div><div className="h-5 w-9 rounded-full bg-[#0d857b] p-0.5"><div className="h-4 w-4 translate-x-4 rounded-full bg-white shadow-sm" /></div></div>)}</div></div></div></div></>;
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

function AppointmentModal({ onClose, onCreated }: { onClose: () => void; onCreated: (appointment: { patient: string; service: string }) => void }) {
  const [form, setForm] = useState({ patient: "", clinic: "dermatology", doctor: "د. ليان المطيري", service: "استشارة أولية · ٢٠٠ ر.س", branch: "فرع الرياض - النخيل", date: "2025-05-18", time: "10:30", type: "in_person", payment: "insurance" });
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); onCreated({ patient: form.patient, service: form.service }); };
  return <ModalShell title="حجز موعد جديد" description="اختر المريض والخدمة والوقت المناسب" icon={CalendarClock} onClose={onClose}><form onSubmit={submit} className="space-y-5"><div className="grid gap-4 sm:grid-cols-2"><FormField label="المريض" required><select required value={form.patient} onChange={(event) => update("patient", event.target.value)} className={formControlClass()}><option value="">اختر المريض</option><option>سارة أحمد العتيبي · MRN-1024</option><option>عبدالله سالم القحطاني · MRN-1023</option><option>نورة محمد الغامدي · MRN-1022</option><option>+ تسجيل مريض جديد</option></select></FormField><FormField label="نوع العيادة" required><select required value={form.clinic} onChange={(event) => update("clinic", event.target.value)} className={formControlClass()}>{clinicProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></FormField><FormField label="الطبيب" required><select required value={form.doctor} onChange={(event) => update("doctor", event.target.value)} className={formControlClass()}><option>د. ليان المطيري · جلدية</option><option>د. عمر الحربي · طب عام</option><option>د. ريم الزهراني · تجميل</option></select></FormField><FormField label="الخدمة" required><select required value={form.service} onChange={(event) => update("service", event.target.value)} className={formControlClass()}><option>استشارة أولية · ٢٠٠ ر.س</option><option>متابعة علاج · ١٥٠ ر.س</option><option>جلسة ليزر · ٦٠٠ ر.س</option></select></FormField><FormField label="الفرع" required><select required value={form.branch} onChange={(event) => update("branch", event.target.value)} className={formControlClass()}><option>فرع الرياض - النخيل</option><option>فرع جدة - الروضة</option><option>فرع دبي - الخليج التجاري</option></select></FormField><FormField label="نوع الموعد" required><select required value={form.type} onChange={(event) => update("type", event.target.value)} className={formControlClass()}><option value="in_person">حضوري</option><option value="video">استشارة فيديو</option><option value="follow_up">متابعة</option><option value="emergency">طوارئ</option></select></FormField><FormField label="التاريخ" required><input required type="date" value={form.date} onChange={(event) => update("date", event.target.value)} className={formControlClass()} dir="ltr" /></FormField><FormField label="الوقت" required><select required value={form.time} onChange={(event) => update("time", event.target.value)} className={formControlClass()} dir="ltr"><option>09:30</option><option>10:00</option><option>10:30</option><option>11:15</option><option>12:00</option></select></FormField></div><div className="rounded-2xl border border-[#e6f0ee] bg-[#fbfdfc] p-4"><div className="mb-3 flex items-center justify-between"><span className="text-[12px] font-bold text-[#426765]">طريقة الدفع</span><span className="text-[10px] text-[#95aaa7]">يتم حساب الضريبة تلقائيًا</span></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[["insurance", "تأمين"], ["mada", "مدى"], ["cash", "نقدي"], ["package", "باقة"]].map(([value, label]) => <button type="button" key={value} onClick={() => update("payment", value)} className={cn("rounded-xl border px-2 py-3 text-[10px] font-bold", form.payment === value ? "border-[#8acbc1] bg-[#e6f4f1] text-[#0d716a]" : "border-[#e3eeeb] text-[#7d9894]")}><CreditCard className="mx-auto mb-1 h-4 w-4" />{label}</button>)}</div></div><div className="flex items-center justify-between rounded-xl bg-[#f1f8f6] px-4 py-3"><div><div className="text-[11px] font-bold text-[#426765]">تقدير الزيارة</div><div className="mt-1 text-[10px] text-[#8ca6a2]">استشارة أولية · ضريبة القيمة المضافة ١٥٪</div></div><span className="text-[18px] font-bold text-[#0d716a]">٢٣٠ ر.س</span></div><div className="flex flex-col-reverse gap-2 border-t border-[#edf3f1] pt-5 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} className="h-11 rounded-xl border border-[#dfece9] px-5 text-[11px] font-bold text-[#769390]">إلغاء</button><button type="submit" className="h-11 rounded-xl bg-[#0d716a] px-6 text-[11px] font-bold text-white">تأكيد وحجز الموعد</button></div></form></ModalShell>;
}

function ClinicProfileModal({ onClose, onSaved }: { onClose: () => void; onSaved: (profile: string) => void }) {
  const [selected, setSelected] = useState("dermatology");
  return <ModalShell title="اختيار نوع العيادة" description="اختر الملف المتخصص لتفعيل الحقول والوحدات المناسبة" icon={Building2} onClose={onClose}><div className="grid gap-3 sm:grid-cols-2">{clinicProfiles.map((profile) => <button type="button" key={profile.id} onClick={() => setSelected(profile.id)} className={cn("rounded-2xl border p-4 text-right transition", selected === profile.id ? "border-[#8acbc1] bg-[#eaf7f3] shadow-[0_5px_15px_rgba(13,113,106,0.08)]" : "border-[#e3eeeb] hover:border-[#b9ded8]")}><div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#0d857b]"><profile.icon className="h-5 w-5" /></div><div className="min-w-0"><div className="text-[13px] font-bold text-[#355e5c]">{profile.name}</div><div className="mt-1 text-[10px] text-[#8ca6a2]">{profile.detail}</div><div className="mt-2 text-[10px] font-semibold text-[#0d857b]">{profile.modules}</div></div></div></button>)}</div><div className="mt-5 rounded-xl bg-[#f1f8f6] p-4 text-[11px] leading-5 text-[#628580]">عند التفعيل سيتم تجهيز نموذج السجل الطبي، الحقول المخصصة، الخدمات المقترحة، وقواعد الحجز الخاصة بهذا النوع.</div><div className="mt-5 flex justify-end gap-2 border-t border-[#edf3f1] pt-5"><button type="button" onClick={onClose} className="h-11 rounded-xl border border-[#dfece9] px-5 text-[11px] font-bold text-[#769390]">إلغاء</button><button type="button" onClick={() => onSaved(clinicProfiles.find((profile) => profile.id === selected)?.name ?? "نوع العيادة")} className="h-11 rounded-xl bg-[#0d716a] px-6 text-[11px] font-bold text-white">تفعيل الملف المختار</button></div></ModalShell>;
}

function ClinicalEntryModal({ type, onClose, onCreated }: { type: ClinicalModal; onClose: () => void; onCreated: (row: string[], payment?: string) => void }) {
  const [form, setForm] = useState({ name: "", specialty: "الجلدية والتجميل", duration: "٣٠", price: "٢٠٠", patient: "سارة أحمد العتيبي", exam: "أشعة سونار البطن", doctor: "د. ليان المطيري", time: "١١:٠٠", category: "مسكن", batch: "", quantity: "١٠٠", expiry: "يناير ٢٠٢٧", payment: "نقدي", itemCount: "٣" });
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const config = {
    service: { title: "إضافة خدمة", description: "أضف خدمة لتظهر في الحجز والفوترة", icon: ReceiptText },
    radiology: { title: "طلب أشعة جديد", description: "اربط الطلب بزيارة المريض والطبيب", icon: Activity },
    medicine: { title: "إضافة دواء للمخزون", description: "سجل الصنف والدفعة والكمية لتفعيل الصرف", icon: Package },
    prescription: { title: "إنشاء وصفة جديدة", description: "اعتمد الوصفة لإضافتها تلقائيًا إلى طابور الصرف", icon: FileText },
  }[type];
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (type === "service") onCreated([form.name, form.specialty, `${form.duration} دقيقة`, `${form.price} ر.س`, "الرياض · النخيل", "نشطة"]);
    if (type === "radiology") onCreated([`RAD-${String(Date.now()).slice(-4)}`, form.patient, form.exam, form.doctor, "مجدول", `اليوم ${form.time}`]);
    if (type === "medicine") onCreated([form.name, form.category, form.batch || `BTH-${String(Date.now()).slice(-4)}`, form.quantity, form.expiry, Number(form.quantity) < 10 ? "منخفض" : "متوفر"]);
    if (type === "prescription") onCreated([`RX-2025-${String(Date.now()).slice(-4)}`, form.patient, form.doctor, `${form.itemCount} أصناف`, "معتمدة", "الآن"], form.payment);
  };
  return <ModalShell title={config.title} description={config.description} icon={config.icon} onClose={onClose}><form onSubmit={submit} className="space-y-5">
    {type === "service" && <div className="grid gap-4 sm:grid-cols-2"><FormField label="اسم الخدمة" required><input required value={form.name} onChange={(event) => update("name", event.target.value)} className={formControlClass()} placeholder="مثال: تنظيف البشرة العميق" /></FormField><FormField label="التخصص" required><select required value={form.specialty} onChange={(event) => update("specialty", event.target.value)} className={formControlClass()}><option>الجلدية والتجميل</option><option>طب عام</option><option>طب الأطفال</option><option>طب الأسنان</option><option>العلاج الطبيعي</option></select></FormField><FormField label="المدة بالدقائق" required><input required type="number" min="5" value={form.duration} onChange={(event) => update("duration", event.target.value)} className={formControlClass()} dir="ltr" /></FormField><FormField label="السعر قبل الضريبة" required><input required type="number" min="0" value={form.price} onChange={(event) => update("price", event.target.value)} className={formControlClass()} dir="ltr" /></FormField></div>}
    {type === "radiology" && <div className="grid gap-4 sm:grid-cols-2"><FormField label="المريض" required><select required value={form.patient} onChange={(event) => update("patient", event.target.value)} className={formControlClass()}><option>سارة أحمد العتيبي</option><option>عبدالله سالم القحطاني</option><option>نورة محمد الغامدي</option><option>خالد إبراهيم الشهري</option></select></FormField><FormField label="نوع الفحص" required><select required value={form.exam} onChange={(event) => update("exam", event.target.value)} className={formControlClass()}><option>أشعة سونار البطن</option><option>أشعة سينية للصدر</option><option>تصوير بالرنين المغناطيسي</option><option>أشعة مقطعية</option></select></FormField><FormField label="الطبيب الطالب" required><select required value={form.doctor} onChange={(event) => update("doctor", event.target.value)} className={formControlClass()}><option>د. ليان المطيري</option><option>د. عمر الحربي</option><option>د. ريم الزهراني</option></select></FormField><FormField label="وقت الموعد" required><input required value={form.time} onChange={(event) => update("time", event.target.value)} className={formControlClass()} dir="ltr" /></FormField></div>}
    {type === "medicine" && <div className="grid gap-4 sm:grid-cols-2"><FormField label="اسم الدواء أو المستلزم" required><input required value={form.name} onChange={(event) => update("name", event.target.value)} className={formControlClass()} placeholder="مثال: باراسيتامول ٥٠٠ مج" /></FormField><FormField label="التصنيف" required><select required value={form.category} onChange={(event) => update("category", event.target.value)} className={formControlClass()}><option>مسكن</option><option>مضاد حيوي</option><option>جلدية</option><option>مستلزمات</option></select></FormField><FormField label="رقم الدفعة"><input value={form.batch} onChange={(event) => update("batch", event.target.value)} className={formControlClass()} dir="ltr" placeholder="يُنشأ تلقائيًا عند تركه فارغًا" /></FormField><FormField label="الكمية" required><input required type="number" min="1" value={form.quantity} onChange={(event) => update("quantity", event.target.value)} className={formControlClass()} dir="ltr" /></FormField><FormField label="تاريخ الانتهاء" required><input required value={form.expiry} onChange={(event) => update("expiry", event.target.value)} className={formControlClass()} placeholder="مثال: ديسمبر ٢٠٢٧" /></FormField></div>}
    {type === "prescription" && <div className="grid gap-4 sm:grid-cols-2"><FormField label="المريض" required><select required value={form.patient} onChange={(event) => update("patient", event.target.value)} className={formControlClass()}><option>سارة أحمد العتيبي</option><option>عبدالله سالم القحطاني</option><option>نورة محمد الغامدي</option><option>خالد إبراهيم الشهري</option></select></FormField><FormField label="الطبيب" required><select required value={form.doctor} onChange={(event) => update("doctor", event.target.value)} className={formControlClass()}><option>د. ليان المطيري</option><option>د. عمر الحربي</option><option>د. ريم الزهراني</option></select></FormField><FormField label="عدد الأصناف" required><input required type="number" min="1" value={form.itemCount} onChange={(event) => update("itemCount", event.target.value)} className={formControlClass()} dir="ltr" /></FormField><FormField label="طريقة الدفع" required><select required value={form.payment} onChange={(event) => update("payment", event.target.value)} className={formControlClass()}><option>نقدي</option><option>تأمين</option><option>باقة</option></select></FormField></div>}
    <div className="rounded-xl bg-[#f1f8f6] px-4 py-3 text-[11px] leading-5 text-[#628580]">سيتم حفظ السجل محليًا في الواجهة، وربطه مباشرة بالوحدة التالية دون إرسال أي بيانات إلى خادم.</div><div className="flex justify-end gap-2 border-t border-[#edf3f1] pt-5"><button type="button" onClick={onClose} className="h-11 rounded-xl border border-[#dfece9] px-5 text-[11px] font-bold text-[#769390]">إلغاء</button><button type="submit" className="h-11 rounded-xl bg-[#0d716a] px-5 text-[11px] font-bold text-white">حفظ ومتابعة</button></div>
  </form></ModalShell>;
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
  const [status, setStatus] = useState(appointment.status);
  const [showActions, setShowActions] = useState(false);
  const colors = { teal: "bg-[#e2f4f0] text-[#0d857b]", purple: "bg-[#f0eafb] text-[#8061bb]", amber: "bg-[#fff2dc] text-[#bd812b]", blue: "bg-[#e8f2fb] text-[#4283b9]" };
  const statuses: Record<string, string> = { مؤكد: "text-[#4b9872] bg-[#edf8f1]", وصل: "text-[#7b62b2] bg-[#f3effb]", "في الانتظار": "text-[#c88932] bg-[#fff7e9]", ملغي: "text-[#d77e65] bg-[#fff0eb]" };
  return <div className="group relative flex items-center gap-3 rounded-xl border border-[#edf3f1] p-3 transition hover:border-[#c5e4df] hover:bg-[#fbfefd]"><div className="w-10 shrink-0 text-center text-[12px] font-bold text-[#527472]">{appointment.time}</div><div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold", colors[appointment.color as keyof typeof colors])}>{appointment.patient.split(" ").slice(0, 2).map((word) => word[0]).join("")}</div><div className="min-w-0 flex-1"><div className="truncate text-[12px] font-bold text-[#345d5c]">{appointment.patient}</div><div className="mt-1 flex items-center gap-2 truncate text-[10px] text-[#9aafac]"><span>{appointment.type}</span><span className="h-1 w-1 rounded-full bg-[#c6d3d1]" /><span>{appointment.doctor}</span></div></div><span className={cn("hidden shrink-0 rounded-md px-2 py-1 text-[10px] font-bold sm:inline-flex", statuses[status])}>{status}</span><button onClick={() => setShowActions((value) => !value)} aria-label={`خيارات موعد ${appointment.patient}`} className="shrink-0 rounded-lg p-1 text-[#a6b9b6] transition hover:bg-[#eff7f5] hover:text-[#0d716a]"><ChevronLeft className="h-4 w-4" /></button>{showActions && <div className="absolute left-2 top-12 z-20 w-36 rounded-xl border border-[#dfeae8] bg-white p-1.5 shadow-lg"><button onClick={() => { setStatus("وصل"); setShowActions(false); }} className="w-full rounded-lg px-3 py-2 text-right text-[10px] font-bold text-[#0d716a] hover:bg-[#eef8f5]">تسجيل الوصول</button><button onClick={() => { setStatus("مؤكد"); setShowActions(false); }} className="w-full rounded-lg px-3 py-2 text-right text-[10px] font-bold text-[#397fbd] hover:bg-[#eef5fb]">تأكيد الموعد</button><button onClick={() => { setStatus("ملغي"); setShowActions(false); }} className="w-full rounded-lg px-3 py-2 text-right text-[10px] font-bold text-[#d77e65] hover:bg-[#fff3ef]">إلغاء الموعد</button></div>}</div>;
}

function ChartBar({ day, height, value, active = false }: { day: string; height: string; value: string; active?: boolean }) {
  return <div className="flex h-full flex-1 flex-col items-center justify-end gap-2"><span className="text-[9px] font-semibold text-[#8ca7a3]">{value}</span><div className={cn("w-full max-w-[32px] rounded-t-lg transition", active ? "bg-[#0d857b] shadow-[0_5px_12px_rgba(13,133,123,0.18)]" : "bg-[#dceeea]")} style={{ height }} /><span className={cn("text-[9px]", active ? "font-bold text-[#477370]" : "text-[#a0b3b0]")}>{day}</span></div>;
}

function QuickAction({ icon: Icon, label, tone, onClick }: { icon: typeof UserRoundPlus; label: string; tone: "teal" | "blue" | "amber" | "purple"; onClick: () => void }) {
  const tones = { teal: "bg-[#e6f5f1] text-[#0d857b]", blue: "bg-[#eaf3fb] text-[#4284b9]", amber: "bg-[#fff3df] text-[#bd812b]", purple: "bg-[#f2edfb] text-[#8565bd]" };
  return <button onClick={onClick} className="flex items-center gap-3 rounded-xl border border-[#edf3f1] p-3 text-right transition hover:-translate-y-0.5 hover:border-[#c8e3df] hover:shadow-sm"><span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", tones[tone])}><Icon className="h-[17px] w-[17px]" /></span><span className="text-[11px] font-bold text-[#557673]">{label}</span></button>;
}
