import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * ═══ شريط الأعمال المُنزَلة أسفل الشاشة (0237، 0241) ══════════════════════════
 *
 * الفاتورة المُنزَلة، وملفّ المريض الجديد المُنزَل، وملفّات المرضى المحفوظة
 * المُنزَلة — كلّها شرائح في شريطٍ واحد أسفل وسط الشاشة، فلا تتراكب فوق
 * بعضها. كلّ «مُنزِل» يرسم شريحته هنا عبر `DockChip`.
 */

const DockTrayContext = createContext<HTMLElement | null>(null);

export function DockTrayProvider({ children }: { children: ReactNode }) {
  const [tray, setTray] = useState<HTMLElement | null>(null);
  return (
    <DockTrayContext.Provider value={tray}>
      {children}
      <div
        ref={setTray}
        dir="rtl"
        className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap-reverse items-end justify-center gap-2"
      />
    </DockTrayContext.Provider>
  );
}

/** شريحةٌ في الشريط — أو لا شيء إن لم يكن الشريط مركَّبًا بعد. */
export function DockChip({ children }: { children: ReactNode }) {
  const tray = useContext(DockTrayContext);
  if (!tray) return null;
  return createPortal(
    <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-xl border border-primary/40 bg-background px-3 py-2 shadow-xl">
      {children}
    </div>,
    tray,
  );
}
