import "./global.css";

import {
  Fragment,
  lazy,
  Suspense,
  useState,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from "react";
import { Toaster } from "@/components/ui/toaster";
import { createRoot } from "react-dom/client";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { registerScreenLoader } from "./lib/screen-preload";

type ScreenComponent = LazyExoticComponent<ComponentType<any>> & { preload: () => Promise<unknown> };

/**
 * شاشةٌ تُحمَّل عند الحاجة، ومعها محمِّلها لتُنزَّل حزمتها مسبقًا
 * (`lib/screen-preload.ts`): عند مرور المؤشّر على القسم، وفي أوقات الفراغ.
 */
function lazyScreen(loader: () => Promise<{ default: ComponentType<any> }>): ScreenComponent {
  return Object.assign(lazy(loader), { preload: loader });
}
const Index = lazyScreen(() => import("./pages/Index"));
const Onboarding = lazyScreen(() => import("./pages/Onboarding"));
const Login = lazyScreen(() => import("./pages/Login"));
const ComingSoon = lazyScreen(() => import("./pages/ComingSoon"));
const NotFound = lazyScreen(() => import("./pages/NotFound"));
const Reception = lazyScreen(() => import("./pages/Reception"));
const Patients = lazyScreen(() => import("./pages/Patients"));
const PatientProfile = lazyScreen(() => import("./pages/PatientProfile"));
const Appointments = lazyScreen(() => import("./pages/Appointments"));
const Billing = lazyScreen(() => import("./pages/Billing"));
const Doctors = lazyScreen(() => import("./pages/Doctors"));
const Departments = lazyScreen(() => import("./pages/Departments"));
const Services = lazyScreen(() => import("./pages/Services"));
const MedicalRecords = lazyScreen(() => import("./pages/MedicalRecords"));
const Insurance = lazyScreen(() => import("./pages/Insurance"));
const Employees = lazyScreen(() => import("./pages/Employees"));
const Payroll = lazyScreen(() => import("./pages/Payroll"));
const Reports = lazyScreen(() => import("./pages/Reports"));
const OperationsSettings = lazyScreen(() => import("./pages/OperationsSettings"));
const Laboratory = lazyScreen(() => import("./pages/Laboratory"));
const Radiology = lazyScreen(() => import("./pages/Radiology"));
const RadiologyConsole = lazyScreen(() => import("./pages/RadiologyConsole"));
const VitalSigns = lazyScreen(() => import("./pages/VitalSigns"));
const Pharmacy = lazyScreen(() => import("./pages/Pharmacy"));
const Packages = lazyScreen(() => import("./pages/Packages"));
const Accounting = lazyScreen(() => import("./pages/Accounting"));
const Procurement = lazyScreen(() => import("./pages/Procurement"));
const ZATCASettings = lazyScreen(() => import("./pages/ZATCASettings"));
const CashExpenses = lazyScreen(() => import("./pages/CashExpenses"));
const PurchaseReports = lazyScreen(() => import("./pages/PurchaseReports"));
const Inventory = lazyScreen(() => import("./pages/Inventory"));
const DentalLab = lazyScreen(() => import("./pages/DentalLab"));
const Messaging = lazyScreen(() => import("./pages/Messaging"));
const AuditLog = lazyScreen(() => import("./pages/AuditLog"));
const PatientJourney = lazyScreen(() => import("./pages/PatientJourney"));
const Shifts = lazyScreen(() => import("./pages/Shifts"));
const Attendance = lazyScreen(() => import("./pages/Attendance"));
const Leave = lazyScreen(() => import("./pages/Leave"));
const Contracts = lazyScreen(() => import("./pages/Contracts"));
const Recruitment = lazyScreen(() => import("./pages/Recruitment"));
const Performance = lazyScreen(() => import("./pages/Performance"));
const Training = lazyScreen(() => import("./pages/Training"));
const HrReports = lazyScreen(() => import("./pages/HrReports"));
const DocumentTemplates = lazyScreen(() => import("./pages/DocumentTemplates"));
const ExternalClients = lazyScreen(() => import("./pages/ExternalClients"));
const CustomReports = lazyScreen(() => import("./pages/CustomReports"));
const Warehouses = lazyScreen(() => import("./pages/Warehouses"));
const Licenses = lazyScreen(() => import("./pages/Licenses"));
const Waitlist = lazyScreen(() => import("./pages/Waitlist"));
const FollowUpCenter = lazyScreen(() => import("./pages/FollowUpCenter"));
const Users = lazyScreen(() => import("./pages/Users"));
const ExamTemplates = lazyScreen(() => import("./pages/ExamTemplates"));
const Offers = lazyScreen(() => import("./pages/Offers"));
const SystemControl = lazyScreen(() => import("./pages/SystemControl"));
const Alerts = lazyScreen(() => import("./pages/Alerts"));
const BlockedContacts = lazyScreen(() => import("./pages/BlockedContacts"));
const PatientVisits = lazyScreen(() => import("./pages/PatientVisits"));
const DeviceSettings = lazyScreen(() => import("./pages/DeviceSettings"));
const OrganizationSettings = lazyScreen(() => import("./pages/OrganizationSettings"));
const Content = lazyScreen(() => import("./pages/Content"));
const Settings = lazyScreen(() => import("./pages/Settings"));
const ReferenceData = lazyScreen(() => import("./pages/ReferenceData"));
const PriceLists = lazyScreen(() => import("./pages/PriceLists"));
const Resources = lazyScreen(() => import("./pages/Resources"));
const Assets = lazyScreen(() => import("./pages/Assets"));
const Documents = lazyScreen(() => import("./pages/Documents"));
const PatientPortalAdmin = lazyScreen(() => import("./pages/PatientPortalAdmin"));
const Portal = lazyScreen(() => import("./pages/Portal"));
const PublicBooking = lazyScreen(() => import("./pages/PublicBooking"));
const DoctorWorkspace = lazyScreen(() => import("./pages/DoctorWorkspace"));
const Quality = lazyScreen(() => import("./pages/Quality"));
const Integrations = lazyScreen(() => import("./pages/Integrations"));
const Analytics = lazyScreen(() => import("./pages/Analytics"));
const LaunchReadiness = lazyScreen(() => import("./pages/LaunchReadiness"));
import { OrganizationAccessProvider } from "./contexts/OrganizationAccessContext";
import { DemoRoleProvider } from "./contexts/DemoRoleContext";
import AppShell from "./components/layout/AppShell";
import RouteGuard from "./components/layout/RouteGuard";

/**
 * يعيد بناء الشاشة من أوّلها حين يُضغط قسمها في القائمة الجانبية وهي مفتوحة.
 *
 * الشاشات تحفظ تبويبها الداخلي في حالتها (الفوترة ← اليومية، المشتريات…)،
 * والضغط على الرابط نفسه لا يغيّر المسار فلا تتغيّر الحالة. القائمة ترسل مع
 * كل ضغطة علامة `navReset` جديدة، وهنا تصير مفتاحًا للشاشة فتُبنى من جديد.
 * أمّا التنقّل داخل الشاشة (معاملات العنوان) فلا يحمل العلامة فلا يمسّها.
 */
function ScreenResetBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  const incoming = (location.state as { navReset?: number } | null)?.navReset;
  const [key, setKey] = useState<number>(incoming ?? 0);
  if (incoming !== undefined && incoming !== key) setKey(incoming);
  return <Fragment key={key}>{children}</Fragment>;
}
import { moduleRegistry, settingsModule } from "./lib/module-registry";

/**
 * إعدادات جلب البيانات.
 *
 * كانت الافتراضية: كلّ استعلامٍ «قديم» لحظة وصوله (`staleTime: 0`)، فيُعاد جلبه
 * عند كلّ فتح شاشةٍ أو حوار، **وعند كلّ عودةٍ إلى النافذة** (من واتساب أو من
 * برنامجٍ آخر) يُعاد جلب كلّ ما هو مفتوح دفعةً واحدة — عشرات الطلبات تشغل
 * اتّصالات الخادم، فينتظر خلفها ما ضغطه المستخدم. والخطأ يُعاد ثلاث مرّات
 * بمهلٍ متزايدة (نحو سبع ثوانٍ) قبل أن يظهر.
 *
 * الآن:
 *   * البيانات تبقى حديثةً ثلاثين ثانية، ولا جلب عند العودة إلى النافذة —
 *     الشاشات الحيّة (الاستقبال، التقويم، التنبيهات) لها تحديثها الدوريّ.
 *   * **كلّ إجراءٍ ناجح يُعلِّم كلّ البيانات قديمةً** بلا جلبٍ فوريّ: الشاشة
 *     التالية تجلب من جديد عند فتحها، فلا يُرى رقمٌ سابقٌ لما حُفظ للتوّ — مع
 *     بقاء ما يُعيد الإجراء نفسه جلبه (`invalidateQueries`) كما هو.
 *   * الخطأ يُعاد مرّةً واحدة.
 */
const queryClient: QueryClient = new QueryClient({
  mutationCache: new MutationCache({
    onSuccess: () => {
      void queryClient.invalidateQueries({ refetchType: "none" });
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// كل موديولات الهيكل العام (module-registry) تُسجَّل كمسارات فعلية منذ الآن،
// حتى لا يبقى أي رابط في الشريط الجانبي بلا وجهة. الموديولات التي لم تُبنَ
// شاشتها الحقيقية بعد تعرض صفحة "قيد التطوير" (ComingSoon) مؤقتًا. الأساسيات
// التشغيلية اليومية (الاستقبال، المرضى، المواعيد، الفوترة) أصبحت شاشات حقيقية
// مربوطة بقاعدة البيانات — المرحلة 3.2.
const REAL_SCREENS: Record<string, ScreenComponent> = {
  reception: Reception,
  patients: Patients,
  appointments: Appointments,
  billing: Billing,
  doctors: Doctors,
  departments: Departments,
  services: Services,
  "price-lists": PriceLists,
  resources: Resources,
  "medical-records": MedicalRecords,
  insurance: Insurance,
  employees: Employees,
  payroll: Payroll,
  reports: Reports,
  "operations-settings": OperationsSettings,
  laboratory: Laboratory,
  radiology: Radiology,
  "radiology-console": RadiologyConsole,
  vitals: VitalSigns,
  // الصيدلية/الوصفات/الصرف موديول واحد متصل فعليًا (نفس المخطط 0015) — الثلاثة
  // في القائمة الجانبية يفتحون نفس الشاشة بثلاث تبويبات (صرف/وصفات/كتالوج)
  pharmacy: Pharmacy,
  prescriptions: Pharmacy,
  dispensing: Pharmacy,
  packages: Packages,
  accounting: Accounting,
  // المشتريات: شاشةٌ واحدة تقرأ خطوتها من المسار (0177) — الطلب والأمر
  // والاستلام والفاتورة والمرتجع والموردون يتشاركون لوحاتهم ومرشّح الجهة
  "purchase-requests": Procurement,
  "purchase-orders": Procurement,
  "goods-receipts": Procurement,
  "purchase-invoices": Procurement,
  "purchase-returns": Procurement,
  suppliers: Procurement,
  "cash-expenses": CashExpenses,
  "zatca-settings": ZATCASettings,
  "purchase-reports": PurchaseReports,
  inventory: Inventory,
  assets: Assets,
  documents: Documents,
  "patient-portal": PatientPortalAdmin,
  "doctor-workspace": DoctorWorkspace,
  quality: Quality,
  integrations: Integrations,
  analytics: Analytics,
  "launch-readiness": LaunchReadiness,
  "dental-lab": DentalLab,
  messaging: Messaging,
  audit: AuditLog,
  "patient-journey": PatientJourney,
  shifts: Shifts,
  attendance: Attendance,
  leave: Leave,
  contracts: Contracts,
  recruitment: Recruitment,
  performance: Performance,
  training: Training,
  "hr-reports": HrReports,
  "document-templates": DocumentTemplates,
  "external-clients": ExternalClients,
  "custom-reports": CustomReports,
  warehouses: Warehouses,
  licenses: Licenses,
  waitlist: Waitlist,
  "follow-up-center": FollowUpCenter,
  users: Users,
  "exam-templates": ExamTemplates,
  offers: Offers,
  "system-control": SystemControl,
  alerts: Alerts,
  "blocked-contacts": BlockedContacts,
  "reference-data": ReferenceData,
  "patient-visits": PatientVisits,
  "device-settings": DeviceSettings,
  "organization-settings": OrganizationSettings,
  content: Content,
  // "الأمراض والتشخيص" و"البيانات المرجعية" عنصران في القائمة لمحتوى واحد:
  // تبويبا "الأمراض والحالات" و"أكواد ICD-10" في `ReferenceData`. كان
  // `/diagnoses` بلا مسار فيفتح بطاقة "قيد الإنشاء" رغم أن عدّاده يقرأ من
  // القاعدة ويعرض 10 — عدّاد يعمل وشاشة لا وجود لها. يُوجَّه إلى الشاشة
  // القائمة بدل بناء نسخة ثانية تكتب في نفس الجداول.
  diagnoses: ReferenceData,
  settings: Settings,
};
registerScreenLoader("dashboard", Index.preload);
// «المرضى» يقود إلى ملفّ المريض: الحزمتان معًا
registerScreenLoader("patients", () => Promise.all([Patients.preload(), PatientProfile.preload()]));
for (const [moduleId, Screen] of Object.entries(REAL_SCREENS)) {
  registerScreenLoader(moduleId, Screen.preload);
}

const routedModules = [...moduleRegistry.filter((item) => item.id !== "dashboard"), settingsModule];

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <OrganizationAccessProvider>
          <DemoRoleProvider>
          <Suspense
            fallback={
              <main dir="rtl" className="grid min-h-screen place-items-center bg-background text-foreground">
                جارٍ تحميل الشاشة...
              </main>
            }
          >
          <Routes>
            {/* شاشة الدخول خارج `RouteGuard`: هي ما يُحوَّل إليه من لا جلسة له،
                فلو كانت داخله لدارت الإحالة على نفسها. */}
            <Route path="/login" element={<Login />} />
            <Route path="/onboarding" element={<Onboarding />} />
            {/* بوابة المريض خارج قشرة النظام: المريض ليس عضوًا في المنشأة */}
            <Route path="/portal" element={<Portal />} />
            <Route path="/booking/:slug" element={<PublicBooking />} />
            <Route
              element={
                <RouteGuard>
                  <AppShell />
                </RouteGuard>
              }
            >
              <Route path="/" element={<ScreenResetBoundary><Index /></ScreenResetBoundary>} />
              <Route path="/patients/:id" element={<PatientProfile />} />
              {/* المسار المذكور في مواصفة الربط — يقود إلى شاشة القائمة */}
              <Route path="/zatca/settings" element={<Navigate to="/zatca-settings" replace />} />
              {routedModules.map((item) => {
                const RealScreen = REAL_SCREENS[item.id];
                return (
                  <Route
                    key={item.id}
                    path={`/${item.id}`}
                    element={<ScreenResetBoundary>{RealScreen ? <RealScreen /> : <ComingSoon />}</ScreenResetBoundary>}
                  />
                );
              })}
            </Route>
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
          </DemoRoleProvider>
        </OrganizationAccessProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

createRoot(document.getElementById("root")!).render(<App />);
