import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/**
 * لوحة الأسنان التفاعلية بترقيم FDI (لقطة 116 — أهم شاشة سريرية في نظام أسنان).
 *
 * جدول `dental_chart_entries` موجود منذ 0006 بكل حقوله (أرقام الأسنان،
 * نوع الأسنان، المضاعفات، التخدير، المضادات الوقائية، تثقيف المريض، أشعة،
 * تقويم علوي/سفلي، قوس كامل) لكنه لم يُستخدم في أي مكوّن — لم تكن هناك أي
 * واجهة لاختيار سنّ.
 *
 * ترقيم FDI العالمي: الرقم الأول هو الربع والثاني هو موضع السنّ.
 *   دائمة:  الربع 1 (علوي أيمن) 18→11 · الربع 2 (علوي أيسر) 21→28
 *           الربع 4 (سفلي أيمن) 48→41 · الربع 3 (سفلي أيسر) 31→38
 *   لبنية:  الربع 5 (علوي أيمن) 55→51 · الربع 6 (علوي أيسر) 61→65
 *           الربع 8 (سفلي أيمن) 85→81 · الربع 7 (سفلي أيسر) 71→75
 *
 * ملاحظة على الاتجاه: اللوحة تُعرض دائمًا باتجاه LTR حتى داخل واجهة عربية،
 * لأن ترتيب الأرباع في مخططات الأسنان اصطلاح تشريحي عالمي (يمين المريض على
 * يسار الناظر). عكسه ليطابق اتجاه النص يجعل الطبيب يقرأ اللوحة مقلوبة وقد
 * يؤدي لتوثيق العلاج على السنّ الخطأ.
 */

type ToothType = "permanent" | "primary";

const PERMANENT_QUADRANTS = {
  upperRight: [18, 17, 16, 15, 14, 13, 12, 11],
  upperLeft: [21, 22, 23, 24, 25, 26, 27, 28],
  lowerRight: [48, 47, 46, 45, 44, 43, 42, 41],
  lowerLeft: [31, 32, 33, 34, 35, 36, 37, 38],
};

const PRIMARY_QUADRANTS = {
  upperRight: [55, 54, 53, 52, 51],
  upperLeft: [61, 62, 63, 64, 65],
  lowerRight: [85, 84, 83, 82, 81],
  lowerLeft: [71, 72, 73, 74, 75],
};

function ToothButton({
  number,
  selected,
  onToggle,
}: {
  number: number;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      aria-label={`السن رقم ${number}`}
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-xs font-semibold tabular-nums transition-colors",
        selected
          ? "border-primary bg-primary text-primary-foreground shadow-sm"
          : "border-input bg-background hover:border-primary hover:bg-primary/10",
      )}
    >
      {number}
    </button>
  );
}

function QuadrantRow({
  right,
  left,
  selected,
  onToggle,
}: {
  right: number[];
  left: number[];
  selected: string[];
  onToggle: (tooth: number) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-1">
      <div className="flex gap-1">
        {right.map((tooth) => (
          <ToothButton
            key={tooth}
            number={tooth}
            selected={selected.includes(String(tooth))}
            onToggle={() => onToggle(tooth)}
          />
        ))}
      </div>
      {/* خط المنتصف الفاصل بين الجهتين */}
      <div className="mx-1 h-9 w-px bg-border" />
      <div className="flex gap-1">
        {left.map((tooth) => (
          <ToothButton
            key={tooth}
            number={tooth}
            selected={selected.includes(String(tooth))}
            onToggle={() => onToggle(tooth)}
          />
        ))}
      </div>
    </div>
  );
}

export default function DentalChart({
  toothType,
  onToothTypeChange,
  selectedTeeth,
  onSelectedTeethChange,
}: {
  toothType: ToothType;
  onToothTypeChange: (type: ToothType) => void;
  selectedTeeth: string[];
  onSelectedTeethChange: (teeth: string[]) => void;
}) {
  const quadrants = toothType === "permanent" ? PERMANENT_QUADRANTS : PRIMARY_QUADRANTS;

  const toggleTooth = (tooth: number) => {
    const key = String(tooth);
    onSelectedTeethChange(
      selectedTeeth.includes(key)
        ? selectedTeeth.filter((t) => t !== key)
        : [...selectedTeeth, key],
    );
  };

  const selectArch = (arch: "upper" | "lower") => {
    const teeth =
      arch === "upper"
        ? [...quadrants.upperRight, ...quadrants.upperLeft]
        : [...quadrants.lowerRight, ...quadrants.lowerLeft];
    const keys = teeth.map(String);
    const allSelected = keys.every((k) => selectedTeeth.includes(k));
    onSelectedTeethChange(
      allSelected
        ? selectedTeeth.filter((t) => !keys.includes(t))
        : [...new Set([...selectedTeeth, ...keys])],
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant={toothType === "permanent" ? "default" : "outline"}
            onClick={() => {
              onToothTypeChange("permanent");
              onSelectedTeethChange([]);
            }}
          >
            أسنان دائمة
          </Button>
          <Button
            type="button"
            size="sm"
            variant={toothType === "primary" ? "default" : "outline"}
            onClick={() => {
              onToothTypeChange("primary");
              onSelectedTeethChange([]);
            }}
          >
            أسنان لبنية
          </Button>
        </div>
        <div className="flex gap-1">
          <Button type="button" size="sm" variant="outline" onClick={() => selectArch("upper")}>
            القوس العلوي
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => selectArch("lower")}>
            القوس السفلي
          </Button>
          {selectedTeeth.length > 0 && (
            <Button type="button" size="sm" variant="ghost" onClick={() => onSelectedTeethChange([])}>
              مسح التحديد
            </Button>
          )}
        </div>
      </div>

      {/*
        dir="ltr" مقصود: ترتيب الأرباع اصطلاح تشريحي عالمي لا يتبع اتجاه لغة
        الواجهة (انظر التعليق أعلى الملف).
      */}
      <div dir="ltr" className="flex flex-col gap-2 overflow-x-auto rounded-lg border bg-muted/20 p-3">
        <QuadrantRow
          right={quadrants.upperRight}
          left={quadrants.upperLeft}
          selected={selectedTeeth}
          onToggle={toggleTooth}
        />
        <div className="mx-auto h-px w-full max-w-md bg-border" />
        <QuadrantRow
          right={quadrants.lowerRight}
          left={quadrants.lowerLeft}
          selected={selectedTeeth}
          onToggle={toggleTooth}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Label className="text-muted-foreground">الأسنان المحددة:</Label>
        {selectedTeeth.length === 0 ? (
          <span className="text-sm text-muted-foreground">لم يُحدَّد أي سنّ بعد</span>
        ) : (
          <span className="font-mono text-sm font-semibold" dir="ltr">
            {[...selectedTeeth].sort((a, b) => Number(a) - Number(b)).join(" · ")}
          </span>
        )}
      </div>
    </div>
  );
}
