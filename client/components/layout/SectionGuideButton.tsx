import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { HelpCircle, Info, Link2, ListOrdered, MousePointerClick, TriangleAlert } from "lucide-react";
import {
  guideKeyForPath,
  hasSectionGuide,
  loadSectionGuide,
  type SectionGuide,
} from "@/lib/section-guides";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

function GuideBlock({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Info;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Icon className="h-4 w-4 shrink-0 text-primary" />
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * زرّ «شرح القسم» العائم. مُثبَّت مرّة واحدة في قشرة النظام، فيظهر في كل
 * الشاشات دون تعديل أيٍّ منها، ويقرأ شرحه من المسار الحالي.
 *
 * إن لم يكن للشاشة دليل مكتوب فالزرّ لا يظهر أصلًا: زرّ يفتح لوحًا فارغًا
 * أسوأ من لا زرّ. ونصّ الدليل لا يُحمَّل إلّا عند أوّل فتح، فلا يُبطئ النظام
 * على من لم يطلبه.
 */
export default function SectionGuideButton() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [guide, setGuide] = useState<SectionGuide | null>(null);
  const key = guideKeyForPath(location.pathname);
  const available = hasSectionGuide(key);

  // الانتقال إلى شاشة أخرى يُغلق اللوح ويُفرغ نصّه، وإلّا بقي شرح القسم
  // السابق معروضًا فوق شاشة جديدة.
  useEffect(() => {
    setOpen(false);
    setGuide(null);
  }, [key]);

  useEffect(() => {
    if (!open || !key || guide) return;
    let alive = true;
    void loadSectionGuide(key).then((loaded) => {
      if (alive) setGuide(loaded);
    });
    return () => {
      alive = false;
    };
  }, [open, key, guide]);

  if (!available) return null;

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="شرح كيفية التعامل مع القسم"
        className="fixed bottom-5 end-5 z-40 h-11 gap-2 rounded-full px-4 shadow-lg shadow-primary/20"
      >
        <HelpCircle className="h-5 w-5" />
        <span className="hidden sm:inline">شرح القسم</span>
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          dir="rtl"
          className="flex w-full flex-col gap-0 overflow-hidden p-0 text-start sm:max-w-lg"
        >
          <SheetHeader className="space-y-1 border-b bg-muted/40 p-5 text-start">
            <SheetTitle className="text-start text-lg">
              {guide ? `شرح كيفية التعامل مع: ${guide.title}` : "شرح كيفية التعامل مع القسم"}
            </SheetTitle>
            <SheetDescription className="text-start leading-relaxed">
              {guide ? guide.purpose : "جارٍ تحميل الشرح..."}
            </SheetDescription>
          </SheetHeader>

          {guide && (
            <div className="flex-1 space-y-5 overflow-y-auto p-5 text-sm leading-relaxed">
              {guide.concepts?.length ? (
                <GuideBlock icon={Info} title="مفاهيم يجب فهمها">
                  <dl className="space-y-2">
                    {guide.concepts.map((item) => (
                      <div key={item.term} className="rounded-lg border bg-card p-3">
                        <dt className="font-semibold">{item.term}</dt>
                        <dd className="mt-1 text-muted-foreground">{item.meaning}</dd>
                      </div>
                    ))}
                  </dl>
                </GuideBlock>
              ) : null}

              {guide.flow?.length ? (
                <>
                  <Separator />
                  <GuideBlock icon={ListOrdered} title="ترتيب العمل">
                    <ol className="list-decimal space-y-1.5 ps-5 text-muted-foreground">
                      {guide.flow.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  </GuideBlock>
                </>
              ) : null}

              {guide.actions?.length ? (
                <>
                  <Separator />
                  <GuideBlock icon={MousePointerClick} title="الأزرار وأثر كلٍّ منها">
                    <ul className="space-y-2">
                      {guide.actions.map((action) => (
                        <li key={action.label} className="rounded-lg border bg-card p-3">
                          <span className="font-semibold">{action.label}</span>
                          <p className="mt-1 text-muted-foreground">{action.effect}</p>
                        </li>
                      ))}
                    </ul>
                  </GuideBlock>
                </>
              ) : null}

              {guide.links?.length ? (
                <>
                  <Separator />
                  <GuideBlock icon={Link2} title="ارتباط هذا القسم بغيره">
                    <ul className="list-disc space-y-1.5 ps-5 text-muted-foreground">
                      {guide.links.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </GuideBlock>
                </>
              ) : null}

              {guide.cautions?.length ? (
                <>
                  <Separator />
                  <GuideBlock icon={TriangleAlert} title="احترس">
                    <ul className="list-disc space-y-1.5 ps-5 text-muted-foreground">
                      {guide.cautions.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </GuideBlock>
                </>
              ) : null}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
