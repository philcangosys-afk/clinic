import "./global.css";

import type { ComponentType } from "react";
import { Toaster } from "@/components/ui/toaster";
import { createRoot } from "react-dom/client";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Onboarding from "./pages/Onboarding";
import ComingSoon from "./pages/ComingSoon";
import NotFound from "./pages/NotFound";
import Reception from "./pages/Reception";
import Patients from "./pages/Patients";
import PatientProfile from "./pages/PatientProfile";
import Appointments from "./pages/Appointments";
import Billing from "./pages/Billing";
import Doctors from "./pages/Doctors";
import Departments from "./pages/Departments";
import Services from "./pages/Services";
import MedicalRecords from "./pages/MedicalRecords";
import Insurance from "./pages/Insurance";
import Employees from "./pages/Employees";
import Payroll from "./pages/Payroll";
import Reports from "./pages/Reports";
import OperationsSettings from "./pages/OperationsSettings";
import Laboratory from "./pages/Laboratory";
import Radiology from "./pages/Radiology";
import Pharmacy from "./pages/Pharmacy";
import Packages from "./pages/Packages";
import Accounting from "./pages/Accounting";
import Procurement from "./pages/Procurement";
import Inventory from "./pages/Inventory";
import Messaging from "./pages/Messaging";
import AuditLog from "./pages/AuditLog";
import PatientJourney from "./pages/PatientJourney";
import Shifts from "./pages/Shifts";
import Attendance from "./pages/Attendance";
import Leave from "./pages/Leave";
import Contracts from "./pages/Contracts";
import Recruitment from "./pages/Recruitment";
import Performance from "./pages/Performance";
import Training from "./pages/Training";
import HrReports from "./pages/HrReports";
import { OrganizationAccessProvider } from "./contexts/OrganizationAccessContext";
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
  "medical-records": MedicalRecords,
  insurance: Insurance,
  employees: Employees,
  payroll: Payroll,
  reports: Reports,
  "operations-settings": OperationsSettings,
  laboratory: Laboratory,
  radiology: Radiology,
  // الصيدلية/الوصفات/الصرف موديول واحد متصل فعليًا (نفس المخطط 0015) — الثلاثة
  // في القائمة الجانبية يفتحون نفس الشاشة بثلاث تبويبات (صرف/وصفات/كتالوج)
  pharmacy: Pharmacy,
  prescriptions: Pharmacy,
  dispensing: Pharmacy,
  packages: Packages,
  accounting: Accounting,
  procurement: Procurement,
  inventory: Inventory,
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
};
const routedModules = [...moduleRegistry.filter((item) => item.id !== "dashboard"), settingsModule];

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <OrganizationAccessProvider>
          <Routes>
            <Route path="/onboarding" element={<Onboarding />} />
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
        </OrganizationAccessProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

createRoot(document.getElementById("root")!).render(<App />);
