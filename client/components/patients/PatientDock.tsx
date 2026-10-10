import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { FolderOpen, Maximize2, UserPlus, X } from "lucide-react";

import NewPatientDialog, { type NewPatientDialogProps } from "@/components/patients/NewPatientDialog";
import { DockChip } from "@/components/layout/DockTray";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

/**
 * ═══ إنزال ملفّ المريض إلى أسفل الشاشة (0241) ═══════════════════════════════
 *
 * طلب المالك (10/10/2026): «نفس حركة إنزال الفاتورة لملفّ المريض — عند إنشاء
 * ملفٍّ جديد، أو ملفٍّ محفوظ نفتحه وننزله تحت».
 *
 * ١) **الملفّ الجديد**: نافذته تُركَّب هنا في قشرة النظام (كالفاتورة)، و«إنزال
 *    الملف» يخفيها ويبقيها حيّةً بكلّ ما كُتب فيها. وأكثر من ملفٍّ جديد يُنزَل
 *    معًا (0242، حتى 5)، كلٌّ باسمه المكتوب على شريحته.
 *
 * ٢) **الملفّ المحفوظ**: صفحةٌ لا نافذة، فإنزاله يحفظ عنوانه (بقسمه المفتوح)
 *    وما كُتب في «المعلومات الشخصية» ولم يُحفظ بعد، ويعود الموظّف إلى حيث كان.
 *    الشريحة ترجعه إلى الملفّ نفسه والقسم نفسه، وتُعاد المسوّدة كما تركها.
 *    أكثر من ملفٍّ محفوظ يُنزَل معًا (حتى 6).
 */

type NewProps = Omit<NewPatientDialogProps, "open" | "onOpenChange" | "minimized" | "onMinimize">;

type PinnedFile = {
  id: string;
  name: string;
  fileNumber: number | string | null;
  path: string;
};

type PatientDockApi = {
  startNew: (props: NewProps, onClosed: () => void) => number | null;
  releaseNew: (id: number) => void;
  /** يُنزل ملفًّا محفوظًا بمسوّدته (إن وُجدت). */
  pinFile: (file: PinnedFile, draft: unknown) => void;
  /** يرفع الشريحة عن ملفٍّ فُتح (من الشريط أو من أيّ مكان). */
  unpinFile: (id: string) => void;
  /** المسوّدة المحفوظة عند الإنزال — تُقرأ دون حذف (StrictMode يكرّر المُهيّئ). */
  peekDraft: (id: string) => unknown;
  clearDraft: (id: string) => void;
};

const PatientDockContext = createContext<PatientDockApi | null>(null);

const MAX_PINNED = 6;

type NewSession = {
  id: number;
  props: NewProps;
  onClosed: () => void;
  minimized: boolean;
  /** الاسم المكتوب في الملف — يظهر على شريحته */
  name: string;
  confirmDiscard: boolean;
};

/** حدّ الملفّات الجديدة المُنزَلة معًا. */
const MAX_NEW = 5;

export function PatientDockProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const navigate = useNavigate();

  /**
   * ── الملفّات الجديدة (0242: أكثر من ملفّ)
   *
   * كلّ ملفٍّ جديد جلسةٌ بنافذته وما كُتب فيها. نافذةٌ واحدة تُعرض في كلّ لحظة،
   * والباقي مُنزَل في الشريط؛ ورفع ملفٍّ يُنزل المعروض قبله فلا يضيع شيء.
   */
  const [sessions, setSessions] = useState<NewSession[]>([]);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const nextId = useRef(1);

  // ── الملفّات المحفوظة المُنزَلة
  const [pinned, setPinned] = useState<PinnedFile[]>([]);
  const drafts = useRef(new Map<string, unknown>());

  const patch = (id: number, change: Partial<NewSession>) =>
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...change } : s)));

  const closeNew = useCallback((id: number) => {
    const current = sessionsRef.current.find((s) => s.id === id);
    sessionsRef.current = sessionsRef.current.filter((s) => s.id !== id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    current?.onClosed();
  }, []);

  /** يرفع ملفًّا ويُنزل المعروض قبله — نافذةٌ واحدة في كلّ لحظة. */
  const restore = (id: number) =>
    setSessions((prev) =>
      prev.map((s) => ({ ...s, minimized: s.id !== id, confirmDiscard: s.id === id ? false : s.confirmDiscard })),
    );

  const startNew = useCallback<PatientDockApi["startNew"]>(
    (props, onClosed) => {
      const list = sessionsRef.current;
      // ملفٌّ معروضٌ الآن (لم يُنزَل): لا يُفتح فوقه آخر
      if (list.some((s) => !s.minimized)) return null;
      if (list.length >= MAX_NEW) {
        toast({
          title: `لديك ${MAX_NEW} ملفّات جديدة مُنزَلة`,
          description: "أكمل أحدها أو ألغِه من الشريط أسفل الشاشة قبل فتح ملفٍّ جديد آخر.",
        });
        return null;
      }
      const id = nextId.current++;
      const created: NewSession = { id, props, onClosed, minimized: false, name: "", confirmDiscard: false };
      sessionsRef.current = [...list, created];
      setSessions((prev) => [...prev, created]);
      return id;
    },
    [toast],
  );

  const releaseNew = useCallback<PatientDockApi["releaseNew"]>(
    (id) => {
      const current = sessionsRef.current.find((s) => s.id === id);
      if (current && !current.minimized) closeNew(id);
    },
    [closeNew],
  );

  const pinFile = useCallback<PatientDockApi["pinFile"]>((file, draft) => {
    if (draft) drafts.current.set(file.id, draft);
    else drafts.current.delete(file.id);
    setPinned((prev) => {
      const rest = prev.filter((p) => p.id !== file.id);
      const next = [...rest, file];
      // الأقدم يخرج إن زادت عن الحدّ — ومسوّدته معه
      while (next.length > MAX_PINNED) {
        const dropped = next.shift();
        if (dropped) drafts.current.delete(dropped.id);
      }
      return next;
    });
  }, []);

  const unpinFile = useCallback<PatientDockApi["unpinFile"]>((id) => {
    setPinned((prev) => (prev.some((p) => p.id === id) ? prev.filter((p) => p.id !== id) : prev));
  }, []);

  const peekDraft = useCallback<PatientDockApi["peekDraft"]>((id) => drafts.current.get(id) ?? null, []);
  const clearDraft = useCallback<PatientDockApi["clearDraft"]>((id) => {
    drafts.current.delete(id);
  }, []);

  const api = useMemo(
    () => ({ startNew, releaseNew, pinFile, unpinFile, peekDraft, clearDraft }),
    [startNew, releaseNew, pinFile, unpinFile, peekDraft, clearDraft],
  );

  return (
    <PatientDockContext.Provider value={api}>
      {children}

      {sessions.map((session) => (
        <NewPatientDialog
          key={session.id}
          {...session.props}
          open
          minimized={session.minimized}
          onMinimize={() => {
            /**
             * الإنزال يفكّ الملف عن الشاشة التي فتحته: تُبلَّغ أنّ نافذتها أُغلقت،
             * فيعمل زرّ «ملف جديد» فيها من جديد، ويبقى الملف حيًّا هنا.
             */
            const detach = session.onClosed;
            patch(session.id, { minimized: true, confirmDiscard: false, onClosed: () => undefined });
            sessionsRef.current = sessionsRef.current.map((s) =>
              s.id === session.id ? { ...s, minimized: true, onClosed: () => undefined } : s,
            );
            detach();
          }}
          onNameChange={(name) => {
            if (name !== session.name) patch(session.id, { name });
          }}
          onOpenChange={(next) => {
            if (!next) closeNew(session.id);
          }}
        />
      ))}

      {sessions
        .filter((session) => session.minimized)
        .map((session, index) => (
          <DockChip key={`new-${session.id}`}>
            <UserPlus className="h-4 w-4 shrink-0 text-primary" />
            <span className="max-w-[12rem] truncate text-sm font-semibold" title={session.name || undefined}>
              {session.name ? `ملف جديد — ${session.name}` : `ملف مريض جديد ${index + 1}`}
            </span>
            <Button size="sm" className="h-8" onClick={() => restore(session.id)}>
              <Maximize2 className="h-4 w-4" />
              رفع الملف
            </Button>
            {session.confirmDiscard ? (
              <Button size="sm" variant="destructive" className="h-8" onClick={() => closeNew(session.id)}>
                تأكيد الإلغاء
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2"
                title="إلغاء الملف الجديد المُنزَل بلا حفظ"
                onClick={() => patch(session.id, { confirmDiscard: true })}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </DockChip>
        ))}

      {pinned.map((file) => (
        <DockChip key={file.id}>
          <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
          <span className="max-w-[12rem] truncate text-sm font-semibold" title={file.name}>
            {file.name}
          </span>
          {file.fileNumber != null && (
            <span className="text-xs tabular-nums text-muted-foreground">({file.fileNumber})</span>
          )}
          {drafts.current.has(file.id) && (
            <span className="hidden text-xs text-amber-700 sm:inline">تعديل غير محفوظ</span>
          )}
          <Button size="sm" className="h-8" onClick={() => navigate(file.path)}>
            <Maximize2 className="h-4 w-4" />
            رفع الملف
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2"
            title={drafts.current.has(file.id) ? "إزالة الشريحة — ويضيع التعديل غير المحفوظ" : "إزالة الشريحة"}
            onClick={() => {
              drafts.current.delete(file.id);
              unpinFile(file.id);
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        </DockChip>
      ))}
    </PatientDockContext.Provider>
  );
}

export function usePatientDock() {
  return useContext(PatientDockContext);
}

/**
 * بديل `NewPatientDialog` بالخصائص نفسها: يُفتح في القشرة فيقبل الإنزال.
 * وإن لم تكن القشرة موجودة يعمل كما كان.
 */
export function DockedNewPatientDialog(props: NewPatientDialogProps) {
  const dock = useContext(PatientDockContext);
  const { open, onOpenChange, minimized: _minimized, onMinimize: _onMinimize, ...rest } = props;
  const sessionId = useRef<number | null>(null);
  const latestClose = useRef(onOpenChange);
  latestClose.current = onOpenChange;
  const latestProps = useRef(rest);
  latestProps.current = rest;

  useEffect(() => {
    if (!dock) return;
    if (open && sessionId.current === null) {
      const id = dock.startNew(latestProps.current, () => {
        sessionId.current = null;
        latestClose.current(false);
      });
      if (id === null) latestClose.current(false);
      else sessionId.current = id;
    } else if (!open && sessionId.current !== null) {
      const id = sessionId.current;
      sessionId.current = null;
      dock.releaseNew(id);
    }
  }, [dock, open]);

  useEffect(
    () => () => {
      if (dock && sessionId.current !== null) dock.releaseNew(sessionId.current);
    },
    [dock],
  );

  if (!dock) return <NewPatientDialog {...props} />;
  return null;
}

export default DockedNewPatientDialog;
