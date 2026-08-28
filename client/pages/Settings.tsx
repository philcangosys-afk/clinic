import { Link } from "react-router-dom";
import { Settings2, ChevronLeft } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { moduleRegistry } from "@/lib/module-registry";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

/**
 * صفحة الإعدادات — مدخل موحّد لشاشات الإعدادات المتفرقة.
 *
 * كان عنصر "الإعدادات" في القائمة الجانبية يفتح `/settings` وهي شاشة
 * "قيد الإنشاء" — رابط ميت في قائمة كل مستخدم، بينما شاشات الإعدادات الفعلية
 * موزّعة تحت تصنيف "التشغيل والإدارة" ولا يجمعها شيء.
 *
 * البطاقات تُشتقّ من سجل الموديولات نفسه لا من قائمة مكتوبة يدويًا: إضافة
 * شاشة إعدادات جديدة لاحقًا تظهر هنا تلقائيًا، ولا تبقى قائمة قديمة تشير إلى
 * شاشة حُذفت.
 */
const SETTINGS_MODULE_IDS = [
  "organization-settings",
  "operations-settings",
  "system-control",
  "users",
  "device-settings",
  "licenses",
  "reference-data",
  "exam-templates",
  "document-templates",
  "departments",
  "warehouses",
];

const DESCRIPTIONS: Record<string, string> = {
  "organization-settings": "اسم المنشأة والرقم الضريبي والعملة ونسبة الضريبة والفروع",
  "operations-settings": "الطباعة والضريبة والخصومات والكشفية والتأمين والقوائم المرجعية",
  "system-control": "تفعيل الموديولات لكل منشأة وشركات زاتكا",
  users: "صفات المستخدمين وتفعيلهم والاستثناءات على صلاحياتهم",
  "device-settings": "تفضيلات هذا الجهاز وتصدير البيانات",
  licenses: "تراخيص المنشأة وتواريخ انتهائها",
  "reference-data": "الأمراض المزمنة وأكواد ICD10",
  "exam-templates": "تصميم شاشات الفحص لكل نوع عيادة",
  "document-templates": "قوالب المستندات والشهادات",
  departments: "الأقسام والعيادات",
  warehouses: "المستودعات",
};

export default function Settings() {
  const { canAccess } = useOrganizationAccess();

  const cards = SETTINGS_MODULE_IDS.map((id) => moduleRegistry.find((item) => item.id === id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    // نفس فحص الصلاحية المطبَّق في القائمة الجانبية: عرض بطاقة لشاشة يُمنع
    // المستخدم من دخولها يوصله إلى رسالة رفض بلا سبب واضح.
    .filter((item) => canAccess(item.featureKey, item.requiredPermission));

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Settings2 className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">الإعدادات</h1>
          <p className="text-sm text-muted-foreground">كل شاشات الإعدادات المتاحة لك في مكان واحد</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.id} to={`/${item.id}`} className="block">
              <Card className="h-full transition-colors hover:border-primary hover:bg-muted/40">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between gap-2 text-base">
                    <span className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      {item.label}
                    </span>
                    {/* السهم لليسار في RTL يعني "للأمام" */}
                    <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>{DESCRIPTIONS[item.id] ?? ""}</CardDescription>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {cards.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            لا توجد شاشات إعدادات متاحة لصلاحيتك الحالية.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
