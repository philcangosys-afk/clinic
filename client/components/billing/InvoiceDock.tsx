import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Maximize2, Receipt, X } from "lucide-react";

import NewInvoiceDialog, { type NewInvoiceDialogProps } from "@/components/billing/NewInvoiceDialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { DockChip } from "@/components/layout/DockTray";

/**
 * ═══ إنزال الفاتورة إلى أسفل الشاشة (0237) ══════════════════════════════════
 *
 * طلب المالك (10/10/2026): «زرّ إنزال الفاتورة لتحت — إذا نسيت شيئًا في مكانٍ
 * آخر أذهب له وأرجع أرفع الفاتورة وأكمل عليها».
 *
 * نافذة الفاتورة كانت تُركَّب داخل الشاشة التي فتحتها (الفواتير، ملفّ المريض،
 * الاتفاقية)، فالانتقال إلى شاشةٍ أخرى يهدمها ويضيع ما كُتب فيها. الآن تُركَّب
 * هنا، في قشرة النظام التي لا تُهدم بالتنقّل: الشاشة تطلب فتحها، و«إنزال
 * الفاتورة» يخفي النافذة ويبقيها حيّةً ببنودها ودفعاتها، ويظهر شريطٌ أسفل
 * الشاشة يرفعها متى شاء الموظّف.
 *
 * فاتورةٌ واحدة في الشريط: من فتح فاتورةً جديدة وأخرى مُنزَلة تُرفع له
 * المُنزَلة ليكملها أو يلغيها أوّلًا — فلا تضيع فاتورةٌ نصف مكتوبة بصمت.
 */

type DockProps = Omit<NewInvoiceDialogProps, "open" | "onOpenChange" | "minimized" | "onMinimize">;

type DockSession = {
  id: number;
  props: DockProps;
  label: string;
  onClosed: () => void;
};

type DockApi = {
  /** يفتح فاتورةً في القشرة؛ ويُعيد رقمها، أو null إن كانت أخرى مفتوحة. */
  start: (props: DockProps, onClosed: () => void) => number | null;
  /** تُغلَق إن كانت هي المعروضة ولم تُنزَل (صاحبها أُغلق أو غادر). */
  release: (id: number) => void;
};

const InvoiceDockContext = createContext<DockApi | null>(null);

function sessionLabel(props: DockProps): string {
  const relation = props.appointment?.patient as unknown;
  const patient = Array.isArray(relation) ? relation[0] : relation;
  const name = (patient as { name_ar?: string } | null | undefined)?.name_ar;
  const kind = props.isQuote ? "عرض سعر" : "فاتورة";
  return name ? `${kind} — ${name}` : `${kind} قيد الإنشاء`;
}

export function InvoiceDockProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const [session, setSession] = useState<DockSession | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const sessionRef = useRef<DockSession | null>(null);
  const minimizedRef = useRef(false);
  const nextId = useRef(1);
  sessionRef.current = session;
  minimizedRef.current = minimized;

  const close = useCallback(() => {
    const current = sessionRef.current;
    sessionRef.current = null;
    setSession(null);
    setMinimized(false);
    setConfirmDiscard(false);
    current?.onClosed();
  }, []);

  const start = useCallback<DockApi["start"]>(
    (props, onClosed) => {
      if (sessionRef.current) {
        if (minimizedRef.current) {
          setMinimized(false);
          toast({
            title: "لديك فاتورة مُنزَلة",
            description: "رُفعت لك لتكملها أو تلغيها قبل فتح فاتورةٍ جديدة.",
          });
        }
        return null;
      }
      const id = nextId.current++;
      const created: DockSession = { id, props, label: sessionLabel(props), onClosed };
      sessionRef.current = created;
      setSession(created);
      setMinimized(false);
      return id;
    },
    [toast],
  );

  const release = useCallback<DockApi["release"]>(
    (id) => {
      if (sessionRef.current?.id === id && !minimizedRef.current) close();
    },
    [close],
  );

  const api = useMemo(() => ({ start, release }), [start, release]);

  return (
    <InvoiceDockContext.Provider value={api}>
      {children}
      {session && (
        <NewInvoiceDialog
          key={session.id}
          {...session.props}
          open
          minimized={minimized}
          onMinimize={() => {
            /**
             * الإنزال يفكّ الفاتورة عن الشاشة التي فتحتها (0242): تُبلَّغ أنّ
             * نافذتها أُغلقت، فيعمل زرّ «فاتورة جديدة» فيها من جديد — ويرفع
             * المُنزَلة بتنبيه — وتبقى الفاتورة حيّةً هنا.
             */
            const current = sessionRef.current;
            if (current) {
              const detach = current.onClosed;
              const detached = { ...current, onClosed: () => undefined };
              sessionRef.current = detached;
              setSession(detached);
              detach();
            }
            minimizedRef.current = true;
            setMinimized(true);
          }}
          onOpenChange={(next) => {
            if (!next) close();
          }}
        />
      )}
      {session && minimized && (
        <DockChip>
          <Receipt className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate text-sm font-semibold">{session.label}</span>
          <span className="hidden text-xs text-muted-foreground sm:inline">مُنزَلة — بياناتها محفوظة</span>
          <Button size="sm" className="h-8" onClick={() => setMinimized(false)}>
            <Maximize2 className="h-4 w-4" />
            رفع الفاتورة
          </Button>
          {confirmDiscard ? (
            <Button size="sm" variant="destructive" className="h-8" onClick={close}>
              تأكيد الإلغاء
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2"
              title="إلغاء الفاتورة المُنزَلة بلا حفظ"
              onClick={() => setConfirmDiscard(true)}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </DockChip>
      )}
    </InvoiceDockContext.Provider>
  );
}

/**
 * بديل `NewInvoiceDialog` بالخصائص نفسها: تفتحه الشاشة كما كانت، فيُفتح في
 * القشرة ويقبل الإنزال. وإن لم تكن القشرة موجودة (شاشة خارجها) يعمل كما كان.
 */
export function DockedNewInvoiceDialog(props: NewInvoiceDialogProps) {
  const dock = useContext(InvoiceDockContext);
  const { open, onOpenChange, minimized: _minimized, onMinimize: _onMinimize, ...rest } = props;
  const sessionId = useRef<number | null>(null);
  const latestClose = useRef(onOpenChange);
  latestClose.current = onOpenChange;
  const latestProps = useRef(rest);
  latestProps.current = rest;

  useEffect(() => {
    if (!dock) return;
    if (open && sessionId.current === null) {
      const id = dock.start(latestProps.current, () => {
        sessionId.current = null;
        latestClose.current(false);
      });
      if (id === null) latestClose.current(false);
      else sessionId.current = id;
    } else if (!open && sessionId.current !== null) {
      const id = sessionId.current;
      sessionId.current = null;
      dock.release(id);
    }
  }, [dock, open]);

  // الشاشة غادرت: تُغلق فاتورتها إلّا إن كانت مُنزَلة — فتلك قصد الموظّف إبقاءها
  useEffect(
    () => () => {
      if (dock && sessionId.current !== null) dock.release(sessionId.current);
    },
    [dock],
  );

  if (!dock) return <NewInvoiceDialog {...props} />;
  return null;
}

export default DockedNewInvoiceDialog;
