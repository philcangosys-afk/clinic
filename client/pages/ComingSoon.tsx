import { useLocation } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { moduleRegistry, settingsModule } from "@/lib/module-registry";
import { Card, CardContent } from "@/components/ui/card";

/**
 * صفحة نائبة (placeholder) لكل موديول لم تُبنَ شاشته الفعلية بعد. تُستخدم الآن
 * لكل موديولات الهيكل العام ما عدا الرئيسية، وستُستبدل واحدة تلو الأخرى بشاشات
 * حقيقية حسب الترتيب الذي اختاره المستخدم: الأساسيات التشغيلية اليومية
 * (الاستقبال، المرضى، المواعيد، الفوترة) أولًا، ثم باقي الموديولات.
 */
export default function ComingSoon() {
  const { pathname } = useLocation();
  const id = pathname.replace("/", "") || "dashboard";
  const match = [...moduleRegistry, settingsModule].find((item) => item.id === id);
  const Icon = match?.icon ?? Sparkles;
  const label = match?.label ?? "شاشة قيد التطوير";

  return (
    <div className="flex h-full min-h-[60vh] items-center justify-center p-6">
      <Card className="max-w-md text-center">
        <CardContent className="flex flex-col items-center gap-4 py-10">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Icon className="h-7 w-7" />
          </div>
          <div>
            <h2 className="text-lg font-bold">{label}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              هذه الشاشة جزء من هيكل التطبيق الجديد وسيتم بناؤها قريبًا ضمن خطة
              إعادة البناء التدريجية، بعد إكمال الأساسيات التشغيلية اليومية.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
