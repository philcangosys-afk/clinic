import "./global.css";

import { lazy, Suspense, type ComponentType } from "react";
import { Toaster } from "@/components/ui/toaster";
import { createRoot } from "react-dom/client";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
const Index = lazy(() => import("./pages/Index"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const ComingSoon = lazy(() => import("./pages/ComingSoon"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Reception = lazy(() => import("./pages/Reception"));
const Patients = lazy(() => import("./pages/Patients"));
const PatientProfile = lazy(() => import("./pages/PatientProfile"));
const Appointments = lazy(() => import("./pages/Appointments"));
const Billing = lazy(() => import("./pages/Billing"));
const Doctors = lazy(() => import("./pages/Doctors"));
const Departments = lazy(() => import("./pages/Departments"));
const Services = lazy(() => import("./pages/Services"));
const MedicalRecords = lazy(() => import("./pages/MedicalRecords"));
const Insurance = lazy(() => import("./pages/Insurance"));
const Employees = lazy(() => import("./pages/Employees"));
const Payroll = lazy(() => import("./pages/Payroll"));
const Reports = lazy(() => import("./pages/Reports"));
const OperationsSettings = lazy(() => import("./pages/OperationsSettings"));
const Laboratory = lazy(() => import("./pages/Laboratory"));
const Radiology = lazy(() => import("./pages/Radiology"));
const RadiologyConsole = lazy(() => import("./pages/RadiologyConsole"));
const Pharmacy = lazy(() => import("./pages/Pharmacy"));
const Packages = lazy(() => import("./pages/Packages"));
const Accounting = lazy(() => import("./pages/Accounting"));
const Procurement = lazy(() => import("./pages/Procurement"));
const Inventory = lazy(() => import("./pages/Inventory"));
const DentalLab = lazy(() => import("./pages/DentalLab"));
const Messaging = lazy(() => import("./pages/Messaging"));
const AuditLog = lazy(() => import("./pages/AuditLog"));
const PatientJourney = lazy(() => import("./pages/PatientJourney"));
const Shifts = lazy(() => import("./pages/Shifts"));
const Attendance = lazy(() => import("./pages/Attendance"));
const Leave = lazy(() => import("./pages/Leave"));
const Contracts = lazy(() => import("./pages/Contracts"));
const Recruitment = lazy(() => import("./pages/Recruitment"));
const Performance = lazy(() => import("./pages/Performance"));
const Training = lazy(() => import("./pages/Training"));
const HrReports = lazy(() => import("./pages/HrReports"));
const DocumentTemplates = lazy(() => import("./pages/DocumentTemplates"));
const ExternalClients = lazy(() => import("./pages/ExternalClients"));
const CustomReports = lazy(() => import("./pages/CustomReports"));
const Warehouses = lazy(() => import("./pages/Warehouses"));
const Licenses = lazy(() => import("./pages/Licenses"));
const Waitlist = lazy(() => import("./pages/Waitlist"));
const Users = lazy(() => import("./pages/Users"));
const ExamTemplates = lazy(() => import("./pages/ExamTemplates"));
const Offers = lazy(() => import("./pages/Offers"));
const SystemControl = lazy(() => import("./pages/SystemControl"));
const Alerts = lazy(() => import("./pages/Alerts"));
const BlockedContacts = lazy(() => import("./pages/BlockedContacts"));
const PatientVisits = lazy(() => import("./pages/PatientVisits"));
const DeviceSettings = lazy(() => import("./pages/DeviceSettings"));
const OrganizationSettings = lazy(() => import("./pages/OrganizationSettings"));
const Content = lazy(() => import("./pages/Content"));
const Settings = lazy(() => import("./pages/Settings"));
const ReferenceData = lazy(() => import("./pages/ReferenceData"));
const PriceLists = lazy(() => import("./pages/PriceLists"));
const Resources = lazy(() => import("./pages/Resources"));
const Assets = lazy(() => import("./pages/Assets"));
const Documents = lazy(() => import("./pages/Documents"));
const PatientPortalAdmin = lazy(() => import("./pages/PatientPortalAdmin"));
const Portal = lazy(() => import("./pages/Portal"));
const PublicBooking = lazy(() => import("./pages/PublicBooking"));
const DoctorWorkspace = lazy(() => import("./pages/DoctorWorkspace"));
const Quality = lazy(() => import("./pages/Quality"));
const Integrations = lazy(() => import("./pages/Integrations"));
const Analytics = lazy(() => import("./pages/Analytics"));
const LaunchReadiness = lazy(() => import("./pages/LaunchReadiness"));
import { OrganizationAccessProvider } from "./contexts/OrganizationAccessContext";
import { DemoRoleProvider } from "./contexts/DemoRoleContext";
import AppShell from "./components/layout/AppShell";
import RouteGuard from "./components/layout/RouteGuard";
import { moduleRegistry, settingsModule } from "./lib/module-registry";

const queryClient = new QueryClient();

// كل موديولات الهيكل العام (module-registry) تُسجَّل كمسارات فعلية منذ الآن،
// حتى لا يبقى أي رابط في الشريط الجانبي بلا وجهة. الموديولات التي لم تُبنَ
// شاشتها الحقيقية بعد تعرض صفحة "قيد التطوير" (ComingSoon) مؤقتًا. الأساسيات
// التشغيلية اليومية (الاستقبال، المرضى، المواعيد، الفوترة) أصبحت شاشات حقيقية
// مربوطة بقاعدة البيانات — المرحلة 3.2.
const REAL_SCREENS: Record<string, ComponentType> = {
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
  // الصيدلية/الوصفات/الصرف موديول واحد متصل فعليًا (نفس المخطط 0015) — الثلاثة
  // في القائمة الجانبية يفتحون نفس الشاشة بثلاث تبويبات (صرف/وصفات/كتالوج)
  pharmacy: Pharmacy,
  prescriptions: Pharmacy,
  dispensing: Pharmacy,
  packages: Packages,
  accounting: Accounting,
  procurement: Procurement,
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
              <Route path="/" element={<Index />} />
              <Route path="/patients/:id" element={<PatientProfile />} />
              {routedModules.map((item) => {
                const RealScreen = REAL_SCREENS[item.id];
                return (
                  <Route
                    key={item.id}
                    path={`/${item.id}`}
                    element={RealScreen ? <RealScreen /> : <ComingSoon />}
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
