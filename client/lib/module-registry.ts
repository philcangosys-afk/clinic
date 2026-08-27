import {
  Activity,
  BarChart3,
  Banknote,
  BriefcaseBusiness,
  Building2,
  CalendarCheck2,
  CalendarDays,
  CalendarRange,
  CircleDollarSign,
  ClipboardList,
  Contact2,
  FileCheck2,
  FileStack,
  FileText,
  LayoutGrid,
  FlaskConical,
  Gauge,
  GraduationCap,
  LayoutDashboard,
  LockKeyhole,
  MessageCircle,
  Newspaper,
  Package,
  ReceiptText,
  Settings2,
  ShieldCheck,
  Smile,
  Stethoscope,
  UserCheck,
  UserCog,
  UserPlus,
  UsersRound,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import type { FeatureKey } from "@shared/api";

export type ModuleRegistryItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
  featureKey: FeatureKey;
  requiredPermission: `${FeatureKey}.view`;
  category: string;
  order: number;
};

export const moduleRegistry: ModuleRegistryItem[] = [
  { id: "dashboard", label: "الرئيسية", icon: LayoutDashboard, featureKey: "core_dashboard", requiredPermission: "core_dashboard.view", category: "لوحة التحكم", order: 10 },
  { id: "reception", label: "الاستقبال والانتظار", icon: Activity, badge: "12", featureKey: "reception", requiredPermission: "reception.view", category: "الاستقبال والمواعيد", order: 20 },
  { id: "appointments", label: "المواعيد", icon: CalendarDays, featureKey: "appointments", requiredPermission: "appointments.view", category: "الاستقبال والمواعيد", order: 30 },
  { id: "patients", label: "المرضى", icon: UsersRound, badge: "1,248", featureKey: "patients", requiredPermission: "patients.view", category: "الاستقبال والمواعيد", order: 40 },
  { id: "medical-records", label: "السجل الطبي", icon: ClipboardList, badge: "24", featureKey: "medical_records", requiredPermission: "medical_records.view", category: "الاستقبال والمواعيد", order: 50 },
  { id: "patient-journey", label: "رحلة المريض", icon: Activity, badge: "3", featureKey: "patient_journey", requiredPermission: "patient_journey.view", category: "الاستقبال والمواعيد", order: 60 },
  { id: "services", label: "الخدمات", icon: ReceiptText, badge: "18", featureKey: "medical_services", requiredPermission: "medical_services.view", category: "الكتالوج الطبي", order: 70 },
  { id: "departments", label: "الأقسام والعيادات", icon: Building2, badge: "22", featureKey: "departments_clinics", requiredPermission: "departments_clinics.view", category: "الكتالوج الطبي", order: 80 },
  { id: "doctors", label: "الأطباء", icon: Stethoscope, badge: "10", featureKey: "doctors", requiredPermission: "doctors.view", category: "الكتالوج الطبي", order: 90 },
  { id: "laboratory", label: "المختبر", icon: FlaskConical, badge: "4", featureKey: "laboratory", requiredPermission: "laboratory.view", category: "الكتالوج الطبي", order: 100 },
  { id: "radiology", label: "الأشعة والتصوير الطبي", icon: Activity, badge: "6", featureKey: "radiology", requiredPermission: "radiology.view", category: "الكتالوج الطبي", order: 110 },
  { id: "pharmacy", label: "الصيدلية", icon: Package, badge: "24", featureKey: "pharmacy", requiredPermission: "pharmacy.view", category: "الصيدلية والوصفات", order: 120 },
  { id: "prescriptions", label: "الأدوية والوصفات", icon: FileText, featureKey: "prescriptions", requiredPermission: "prescriptions.view", category: "الصيدلية والوصفات", order: 130 },
  { id: "dispensing", label: "صرف الأدوية", icon: ClipboardList, badge: "8", featureKey: "dispensing", requiredPermission: "dispensing.view", category: "الصيدلية والوصفات", order: 140 },
  { id: "insurance", label: "التأمين والمطالبات", icon: ShieldCheck, featureKey: "insurance_claims", requiredPermission: "insurance_claims.view", category: "المالية والتأمين", order: 150 },
  { id: "billing", label: "الفوترة والمدفوعات", icon: WalletCards, featureKey: "billing_payments", requiredPermission: "billing_payments.view", category: "المالية والتأمين", order: 160 },
  { id: "packages", label: "الباقات", icon: Package, featureKey: "packages", requiredPermission: "packages.view", category: "المالية والتأمين", order: 170 },
  { id: "employees", label: "الموظفون", icon: UserCog, badge: "63", featureKey: "hr", requiredPermission: "hr.view", category: "الموارد البشرية", order: 180 },
  { id: "attendance", label: "الحضور والانصراف", icon: UserCheck, badge: "58", featureKey: "hr", requiredPermission: "hr.view", category: "الموارد البشرية", order: 190 },
  { id: "leave", label: "الإجازات", icon: CalendarCheck2, badge: "7", featureKey: "hr", requiredPermission: "hr.view", category: "الموارد البشرية", order: 200 },
  { id: "payroll", label: "الرواتب", icon: Banknote, badge: "شهرية", featureKey: "hr", requiredPermission: "hr.view", category: "الموارد البشرية", order: 210 },
  { id: "contracts", label: "العقود والملفات", icon: FileCheck2, badge: "63", featureKey: "hr", requiredPermission: "hr.view", category: "الموارد البشرية", order: 220 },
  { id: "recruitment", label: "التوظيف", icon: UserPlus, badge: "12", featureKey: "hr", requiredPermission: "hr.view", category: "الموارد البشرية", order: 230 },
  { id: "performance", label: "تقييم الأداء", icon: Gauge, featureKey: "hr", requiredPermission: "hr.view", category: "الموارد البشرية", order: 240 },
  { id: "training", label: "التدريب والتطوير", icon: GraduationCap, badge: "4", featureKey: "hr", requiredPermission: "hr.view", category: "الموارد البشرية", order: 250 },
  { id: "shifts", label: "المناوبات والجداول", icon: CalendarRange, badge: "3", featureKey: "hr", requiredPermission: "hr.view", category: "الموارد البشرية", order: 260 },
  { id: "hr-reports", label: "تقارير الموارد البشرية", icon: BarChart3, featureKey: "hr", requiredPermission: "hr.view", category: "الإدارة", order: 270 },
  { id: "document-templates", label: "قوالب المستندات", icon: FileStack, featureKey: "hr", requiredPermission: "hr.view", category: "الإدارة", order: 275 },
  { id: "diagnoses", label: "الأمراض والتشخيص", icon: ClipboardList, badge: "10", featureKey: "diagnosis", requiredPermission: "diagnosis.view", category: "الإدارة", order: 280 },
  { id: "content", label: "المحتوى", icon: Newspaper, featureKey: "content", requiredPermission: "content.view", category: "الإدارة", order: 290 },
  { id: "reports", label: "التقارير", icon: BarChart3, featureKey: "reports", requiredPermission: "reports.view", category: "الإدارة", order: 300 },
  { id: "custom-reports", label: "تقارير مخصصة", icon: LayoutGrid, featureKey: "reports", requiredPermission: "reports.view", category: "الإدارة", order: 305 },
  { id: "accounting", label: "الحسابات ودليل الحسابات", icon: CircleDollarSign, featureKey: "accounting", requiredPermission: "accounting.view", category: "التشغيل والإدارة", order: 310 },
  { id: "procurement", label: "المشتريات والموردون", icon: BriefcaseBusiness, badge: "9", featureKey: "procurement", requiredPermission: "procurement.view", category: "التشغيل والإدارة", order: 320 },
  { id: "inventory", label: "حركات المخزون", icon: Package, badge: "16", featureKey: "inventory", requiredPermission: "inventory.view", category: "التشغيل والإدارة", order: 330 },
  { id: "dental-lab", label: "معامل الأسنان", icon: Smile, featureKey: "dental_lab", requiredPermission: "dental_lab.view", category: "التشغيل والإدارة", order: 335 },
  { id: "messaging", label: "الرسائل والتنبيهات", icon: MessageCircle, badge: "3", featureKey: "messaging", requiredPermission: "messaging.view", category: "التشغيل والإدارة", order: 340 },
  { id: "external-clients", label: "العملاء الخارجيون", icon: Contact2, featureKey: "messaging", requiredPermission: "messaging.view", category: "التشغيل والإدارة", order: 345 },
  { id: "audit", label: "سجل التدقيق", icon: LockKeyhole, badge: "107", featureKey: "audit_log", requiredPermission: "audit_log.view", category: "التشغيل والإدارة", order: 350 },
  { id: "operations-settings", label: "إعدادات التشغيل", icon: Settings2, featureKey: "settings", requiredPermission: "settings.view", category: "التشغيل والإدارة", order: 360 },
];

export const settingsModule: ModuleRegistryItem = {
  id: "settings",
  label: "الإعدادات",
  icon: Settings2,
  featureKey: "settings",
  requiredPermission: "settings.view",
  category: "الإعدادات",
  order: 1000,
};

export function filterAccessibleModules(
  items: ModuleRegistryItem[],
  canAccess: (featureKey: FeatureKey, permissionKey: string) => boolean,
) {
  return items.filter((item) => canAccess(item.featureKey, item.requiredPermission));
}

export function groupModules(items: ModuleRegistryItem[]) {
  const groups = new Map<string, ModuleRegistryItem[]>();
  [...items].sort((a, b) => a.order - b.order).forEach((item) => {
    groups.set(item.category, [...(groups.get(item.category) ?? []), item]);
  });
  return [...groups].map(([section, groupedItems]) => ({ section, items: groupedItems }));
}
