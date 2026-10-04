import { cn } from "@/lib/utils";

/**
 * الأسنان كما تُرى (0221) — كلّ سنٍّ مرسومٌ بتاجه وجذوره بحسب نوعه (قاطع،
 * ناب، ضاحك، طاحن)، العلوية جذورها إلى أعلى والسفلية إلى أسفل. الحالة تُلوِّن
 * التاج أو الجذر (عصب، زراعة، تلبيسة…)، والمخلوع باهت، و«خلع» عليه علامة
 * حمراء. المحدَّد في إطارٍ أحمر، وما له إجراءٌ مسجّل نقطةٌ حمراء.
 *
 * رسمٌ مستقلّ بالمتّجهات (SVG) — لا صور.
 */

type Kind = "incisor" | "canine" | "premolar" | "molar";

// الشكل للسنّ السفلية (التاج أعلى). العلوية تُقلب رأسيًّا.
const CROWN: Record<Kind, string> = {
  incisor: "M9 4 C14 1 26 1 31 4 C32 14 31 27 29 38 C24 41 16 41 11 38 C9 27 8 14 9 4 Z",
  canine: "M8 12 C10 6 15 1 20 0 C25 1 30 6 32 12 C32 22 31 31 29 40 C24 43 16 43 11 40 C9 31 8 22 8 12 Z",
  premolar: "M6 9 C9 3 15 2 20 5 C25 2 31 3 34 9 C35 20 34 30 31 40 C24 43 16 43 9 40 C6 30 5 20 6 9 Z",
  molar:
    "M2 10 C5 3 10 2 14 6 C17 2 23 2 26 6 C30 2 35 3 38 10 C39 21 38 31 35 40 C26 44 14 44 5 40 C2 31 1 21 2 10 Z",
};

const ROOTS: Record<Kind, string[]> = {
  incisor: ["M11.5 38 C16 41 24 41 28.5 38 C27 60 24 88 21.5 106 C20.5 109 19.5 109 18.5 106 C16 88 13 60 11.5 38 Z"],
  canine: ["M11.5 40 C16 43 24 43 28.5 40 C27 64 24 92 21.5 110 C20.5 112 19.5 112 18.5 110 C16 92 13 64 11.5 40 Z"],
  premolar: ["M10 40 C16 43 24 43 30 40 C29 60 26 86 22.5 102 C21 105 19 105 17.5 102 C14 86 11 60 10 40 Z"],
  molar: [
    "M6 40 C9 42 14 43 18 43 C17 60 15 82 11.5 98 C10 101 8 101 7.5 97 C6 80 5.5 60 6 40 Z",
    "M34 40 C31 42 26 43 22 43 C23 60 25 82 28.5 98 C30 101 32 101 32.5 97 C34 80 34.5 60 34 40 Z",
  ],
};
const PALATAL_ROOT = "M16 43 C18 44 22 44 24 43 C24 62 22 84 20.8 96 C20.3 99 19.7 99 19.2 96 C18 84 16 62 16 43 Z";

const WIDTH: Record<Kind, number> = { incisor: 30, canine: 32, premolar: 34, molar: 42 };

export function toothKind(tooth: string): Kind {
  const quadrant = Number(tooth[0]);
  const position = Number(tooth[1]);
  const primary = quadrant >= 5;
  if (position <= 2) return "incisor";
  if (position === 3) return "canine";
  if (primary) return "molar";
  return position <= 5 ? "premolar" : "molar";
}

export const isUpperTooth = (tooth: string) => [1, 2, 5, 6].includes(Number(tooth[0]));

/** لون التاج لكلّ حالة — `null` = عاجيّ طبيعي */
const CROWN_FILL: Record<string, string | null> = {
  sound: null,
  caries: "#f87171",
  filled: "#60a5fa",
  root_canal: null,
  crown: "#fbbf24",
  bridge: "#fb923c",
  implant: "#d1d5db",
  veneer: "#f472b6",
  to_extract: null,
  extracted: null,
  missing: null,
  impacted: "#fde047",
  orthodontic: null,
  under_treatment: "#67e8f9",
};

/** تعريفات التدرّج — تُركَّب مرّةً مع المخطّط */
export function TeethDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden>
      <defs>
        <linearGradient id="zc-tooth-crown" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fffdf7" />
          <stop offset="55%" stopColor="#f3ead6" />
          <stop offset="100%" stopColor="#dccfb0" />
        </linearGradient>
        <linearGradient id="zc-tooth-root" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ead9b4" />
          <stop offset="50%" stopColor="#f6ecd5" />
          <stop offset="100%" stopColor="#d8c39a" />
        </linearGradient>
        <linearGradient id="zc-tooth-implant" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#9ca3af" />
          <stop offset="50%" stopColor="#e5e7eb" />
          <stop offset="100%" stopColor="#6b7280" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function ToothGlyph({
  tooth,
  condition,
  selected,
  hasRecord,
  planned,
  onClick,
  title,
}: {
  tooth: string;
  condition?: string | null;
  selected?: boolean;
  hasRecord?: boolean;
  planned?: number;
  onClick?: () => void;
  title?: string;
}) {
  const kind = toothKind(tooth);
  const upper = isUpperTooth(tooth);
  const state = condition ?? "sound";
  const gone = state === "extracted" || state === "missing";
  const crownFill = CROWN_FILL[state] ?? null;
  const rootFill = state === "implant" ? "url(#zc-tooth-implant)" : "url(#zc-tooth-root)";
  const roots = [...ROOTS[kind], ...(upper && kind === "molar" ? [PALATAL_ROOT] : [])];
  const width = WIDTH[kind];

  const label = (
    <span className={cn("text-[11px] font-bold tabular-nums", hasRecord ? "text-red-600" : "text-slate-600")}>
      {tooth}
      {hasRecord && <span className="ms-0.5 inline-block h-1.5 w-1.5 rounded-full bg-red-600 align-middle" />}
    </span>
  );

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "relative flex flex-col items-center gap-0.5 rounded-md border-2 px-0.5 py-1 transition hover:bg-sky-50",
        selected ? "border-red-600 bg-red-50/40" : "border-transparent",
      )}
    >
      {!upper && label}
      <svg
        viewBox="0 0 40 112"
        width={width}
        height={86}
        preserveAspectRatio="none"
        className={cn("drop-shadow-sm", gone && "opacity-25")}
      >
        <g transform={upper ? "translate(0,112) scale(1,-1)" : undefined}>
          {roots.map((d, i) => (
            <path key={i} d={d} fill={rootFill} stroke="#b9a37a" strokeWidth="0.8" />
          ))}
          {/* علاج العصب: قناةٌ بنفسجية في الجذر */}
          {state === "root_canal" &&
            roots.map((_, i) => {
              const x = kind === "molar" ? (i === 0 ? 11 : i === 1 ? 29 : 20) : 20;
              return <line key={`c${i}`} x1={x} y1={46} x2={x} y2={96} stroke="#7c3aed" strokeWidth="2.4" strokeLinecap="round" />;
            })}
          {state === "implant" &&
            [52, 62, 72, 82].map((y) => (
              <line key={y} x1={10} y1={y} x2={30} y2={y + 3} stroke="#6b7280" strokeWidth="1.2" />
            ))}
          <path
            d={CROWN[kind]}
            fill={crownFill ?? "url(#zc-tooth-crown)"}
            fillOpacity={crownFill ? 0.85 : 1}
            stroke={state === "under_treatment" ? "#0891b2" : "#b9a37a"}
            strokeWidth={state === "under_treatment" ? 2 : 0.9}
            strokeDasharray={state === "under_treatment" ? "3 2" : undefined}
          />
          {/* الحشوة: بقعة زرقاء على السطح الإطباقي */}
          {state === "filled" && <ellipse cx="20" cy="16" rx="8" ry="5" fill="#1d4ed8" fillOpacity="0.75" />}
          {/* التقويم: حاصرة على التاج */}
          {state === "orthodontic" && (
            <>
              <rect x="13" y="17" width="14" height="9" rx="1.5" fill="#6366f1" />
              <line x1="2" y1="21.5" x2="38" y2="21.5" stroke="#4338ca" strokeWidth="1.4" />
            </>
          )}
        </g>
        {(state === "to_extract" || gone) && (
          <g stroke={state === "to_extract" ? "#dc2626" : "#64748b"} strokeWidth="3.5" strokeLinecap="round">
            <line x1="6" y1="20" x2="34" y2="92" />
            <line x1="34" y1="20" x2="6" y2="92" />
          </g>
        )}
      </svg>
      {upper && label}
      {planned && planned > 0 ? (
        <span className="absolute -top-1.5 -end-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
          {planned}
        </span>
      ) : null}
    </button>
  );
}
