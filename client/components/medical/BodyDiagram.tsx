import { useRef, useState } from "react";
import { Eraser, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * مخطط الجسم التفاعلي لعيادة الجلدية (لقطة 117).
 *
 * جدول `body_diagram_annotations` موجود منذ 0006 ويخزّن الرسم في عمود
 * `annotation_data` من نوع jsonb، لكن لم يوجد أي مكوّن رسم يملؤه.
 *
 * قرار تصميمي: الرسم يُخزَّن كمسارات متجهية (نقاط بإحداثيات نسبية 0-1) لا
 * كصورة نقطية. السبب أن المسارات:
 *   • أصغر بكثير في الحجم (سجل زيارات لسنوات يبقى خفيفًا)
 *   • تبقى حادة عند أي حجم عرض أو طباعة
 *   • قابلة للمقارنة والتحليل لاحقًا (عدد الآفات، مواضعها)
 * الإحداثيات نسبية حتى يظهر الرسم صحيحًا مهما تغيّر حجم المخطط على الشاشة.
 */

export type Stroke = { color: string; width: number; points: { x: number; y: number }[] };
export type BodyDiagramView = "front" | "back" | "face";

export type BodyDiagramData = {
  view: BodyDiagramView;
  strokes: Stroke[];
};

export const VIEW_LABELS: Record<BodyDiagramView, string> = {
  front: "أمامي",
  back: "خلفي",
  face: "الوجه",
};

const COLORS = [
  { value: "#dc2626", label: "أحمر" },
  { value: "#2563eb", label: "أزرق" },
  { value: "#16a34a", label: "أخضر" },
  { value: "#111827", label: "أسود" },
];

const WIDTHS = [2, 4, 7];

export const strokeToPath = (stroke: Stroke) =>
  stroke.points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x * 100} ${p.y * 128}`).join(" ");

/**
 * عرض مخطط محفوظ بلا تحرير.
 *
 * سبب وجوده: التدقيق أثبت أن `body_diagram_annotations` **جدول للكتابة فقط** —
 * `.insert()` واحد في شاشة السجل الطبي ولا `.select()` في المشروع كله. الطبيب
 * يرسم مواضع الآفات، تُحفظ في القاعدة، ثم لا تُعرض أبدًا: لا في الزيارة
 * التالية ولا في ملف المريض. وهو أسوأ من عدم الحفظ، لأن الطبيب يظن أن لديه
 * مرجعًا للمقارنة.
 */
export function BodyDiagramReadOnly({ value, className }: { value: BodyDiagramData; className?: string }) {
  return (
    <div className={cn("relative mx-auto w-full max-w-[200px] rounded-lg border bg-background", className)}>
      <svg viewBox="0 0 100 128" className="h-auto w-full select-none">
        <BodyOutline view={value.view} />
        {value.strokes.map((stroke, index) => (
          <path
            key={index}
            d={strokeToPath(stroke)}
            fill="none"
            stroke={stroke.color}
            strokeWidth={stroke.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </div>
  );
}

/** رسم تخطيطي بسيط لجسم الإنسان — خلفية يُرسم فوقها الطبيب. */
export function BodyOutline({ view }: { view: BodyDiagramView }) {
  const stroke = "currentColor";
  const common = { fill: "none", stroke, strokeWidth: 1.4, vectorEffect: "non-scaling-stroke" as const };

  if (view === "face") {
    return (
      <g className="text-muted-foreground/50">
        <ellipse cx="50" cy="52" rx="26" ry="34" {...common} />
        <ellipse cx="40" cy="45" rx="4.5" ry="3" {...common} />
        <ellipse cx="60" cy="45" rx="4.5" ry="3" {...common} />
        <path d="M50 48 L50 60 L45 63" {...common} />
        <path d="M40 72 Q50 78 60 72" {...common} />
        <path d="M32 34 Q40 29 47 33" {...common} />
        <path d="M53 33 Q60 29 68 34" {...common} />
      </g>
    );
  }

  return (
    <g className="text-muted-foreground/50">
      {/* الرأس */}
      <circle cx="50" cy="12" r="8" {...common} />
      {/* الرقبة والجذع */}
      <path d="M50 20 L50 26" {...common} />
      <path d="M34 30 Q50 24 66 30 L68 62 Q50 66 32 62 Z" {...common} />
      {/* الذراعان */}
      <path d="M34 31 L24 52 L21 74" {...common} />
      <path d="M66 31 L76 52 L79 74" {...common} />
      {/* الساقان */}
      <path d="M40 64 L37 90 L36 116" {...common} />
      <path d="M60 64 L63 90 L64 116" {...common} />
      {/* خط المنتصف للتوجيه */}
      <path d="M50 30 L50 64" {...common} strokeDasharray="3 3" />
    </g>
  );
}

export default function BodyDiagram({
  value,
  onChange,
}: {
  value: BodyDiagramData;
  onChange: (next: BodyDiagramData) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [color, setColor] = useState(COLORS[0].value);
  const [width, setWidth] = useState(WIDTHS[1]);
  const [drawing, setDrawing] = useState(false);
  /** المنظر الذي يُنتقل إليه بانتظار تأكيد المستخدم (الرسم الحالي سيُفقد). */
  const [pendingView, setPendingView] = useState<BodyDiagramView | null>(null);

  /** يحوّل إحداثيات المؤشر إلى نسبة 0-1 من أبعاد المخطط. */
  const relativePoint = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const startStroke = (event: React.PointerEvent<SVGSVGElement>) => {
    const point = relativePoint(event);
    if (!point) return;
    // التقاط المؤشر حتى لا ينقطع الرسم إذا خرجت اليد خارج حدود المخطط
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrawing(true);
    onChange({ ...value, strokes: [...value.strokes, { color, width, points: [point] }] });
  };

  const extendStroke = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!drawing) return;
    const point = relativePoint(event);
    if (!point) return;
    const strokes = [...value.strokes];
    const current = strokes[strokes.length - 1];
    if (!current) return;
    strokes[strokes.length - 1] = { ...current, points: [...current.points, point] };
    onChange({ ...value, strokes });
  };

  const endStroke = () => setDrawing(false);

  const undo = () => onChange({ ...value, strokes: value.strokes.slice(0, -1) });
  const clear = () => onChange({ ...value, strokes: [] });

  const toPath = (stroke: Stroke) =>
    stroke.points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x * 100} ${p.y * 128}`).join(" ");

  return (
    <div className="flex flex-col gap-3">
      <AlertDialog open={pendingView !== null} onOpenChange={(open) => !open && setPendingView(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>الانتقال يمحو الرسم الحالي</AlertDialogTitle>
            <AlertDialogDescription>
              المخطّط يحفظ منظرًا واحدًا لكل زيارة، فالانتقال إلى «
              {pendingView ? VIEW_LABELS[pendingView] : ""}» يمحو{" "}
              {value.strokes.length} علامة مرسومة على «{VIEW_LABELS[value.view]}» ولا
              تُستعاد. احفظ الزيارة أولًا إن أردت الإبقاء على هذا الرسم.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>تراجع</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingView) onChange({ view: pendingView, strokes: [] });
                setPendingView(null);
              }}
            >
              انتقل وامسح الرسم
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {(Object.keys(VIEW_LABELS) as BodyDiagramView[]).map((view) => (
            <Button
              key={view}
              type="button"
              size="sm"
              variant={value.view === view ? "default" : "outline"}
              /**
               * تبديل المنظر يُصفّر `strokes` لأن بنية البيانات تحمل منظرًا
               * واحدًا (`{ view, strokes }`) و`app_save_visit` يكتب صفًّا
               * لمنظر واحد. فكان طبيب الجلدية يرسم مواضع الآفات على الأمامي
               * ثم يضغط «خلفي» ليكمل التوثيق فيختفي كل ما رسمه بلا سؤال —
               * و«تراجع» لا يُعيده (يزيل خطًّا واحدًا). فلا يُمحى عملٌ قائم
               * إلا بتأكيد صريح.
               */
              onClick={() => {
                if (view === value.view) return;
                if (value.strokes.length > 0) {
                  setPendingView(view);
                  return;
                }
                onChange({ view, strokes: [] });
              }}
            >
              {VIEW_LABELS[view]}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {COLORS.map((option) => (
              <button
                key={option.value}
                type="button"
                title={option.label}
                aria-label={option.label}
                onClick={() => setColor(option.value)}
                className={cn(
                  "h-7 w-7 rounded-full border-2 transition-transform",
                  color === option.value ? "scale-110 border-foreground" : "border-transparent",
                )}
                style={{ backgroundColor: option.value }}
              />
            ))}
          </div>
          <div className="flex gap-1">
            {WIDTHS.map((option) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={width === option ? "default" : "outline"}
                onClick={() => setWidth(option)}
                className="w-9 px-0"
              >
                {option}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="relative mx-auto w-full max-w-xs rounded-lg border bg-background">
        <svg
          ref={svgRef}
          viewBox="0 0 100 128"
          className="h-auto w-full touch-none select-none"
          style={{ cursor: "crosshair" }}
          onPointerDown={startStroke}
          onPointerMove={extendStroke}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
        >
          <BodyOutline view={value.view} />
          {value.strokes.map((stroke, index) => (
            <path
              key={index}
              d={toPath(stroke)}
              fill="none"
              stroke={stroke.color}
              strokeWidth={stroke.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs text-muted-foreground">
          {value.strokes.length === 0
            ? "ارسم على المخطط لتحديد مواضع الآفات"
            : `${value.strokes.length} علامة مرسومة`}
        </Label>
        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={undo}
            disabled={value.strokes.length === 0}
          >
            <Undo2 className="h-3.5 w-3.5" />
            تراجع
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={clear}
            disabled={value.strokes.length === 0}
          >
            <Eraser className="h-3.5 w-3.5" />
            مسح الكل
          </Button>
        </div>
      </div>
    </div>
  );
}
