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
 *    الملف» يخفيها ويبقيها حيّةً بكلّ ما كُتب فيها. ملفٌّ جديد واحد مُنزَل.
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

export function PatientDockProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const navigate = useNavigate();

  // ── الملف الجديد
  const [newSession, setNewSession] = useState<{ id: number; props: NewProps; onClosed: () => void } | null>(null);
  const [newMinimized, setNewMinimized] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const sessionRef = useRef(newSession);
  const minimizedRef = useRef(newMinimized);
  const nextId = useRef(1);
  sessionRef.current = newSession;
  minimizedRef.current = newMinimized;

  // ── الملفّات المحفوظة المُنزَلة
  const [pinned, setPinned] = useState<PinnedFile[]>([]);
  const drafts = useRef(new Map<string, unknown>());

  const closeNew = useCallback(() => {
    const current = sessionRef.current;
    sessionRef.current = null;
    setNewSession(null);
    setNewMinimized(false);
    setConfirmDiscard(false);
    current?.onClosed();
  }, []);

  const startNew = useCallback<PatientDockApi["startNew"]>(
    (props, onClosed) => {
      if (sessionRef.current) {
        if (minimizedRef.current) {
          setNewMinimized(false);
          toast({ title: "لديك ملفّ مريض جديد مُنزَل", description: "رُفع لك لتكمله أو تلغيه أوّلًا." });
        }
        return null;
      }
      const id = nextId.current++;
      const created = { id, props, onClosed };
      sessionRef.current = created;
      setNewSession(created);
      setNewMinimized(false);
      return id;
    },
    [toast],
  );

  const releaseNew = useCallback<PatientDockApi["releaseNew"]>(
    (id) => {
      if (sessionRef.current?.id === id && !minimizedRef.current) closeNew();
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

      {newSession && (
        <NewPatientDialog
          key={newSession.id}
          {...newSession.props}
          open
          minimized={newMinimized}
          onMinimize={() => setNewMinimized(true)}
          onOpenChange={(next) => {
            if (!next) closeNew();
          }}
        />
      )}

      {newSession && newMinimized && (
        <DockChip>
          <UserPlus className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate text-sm font-semibold">ملف مريض جديد</span>
          <span className="hidden text-xs text-muted-foreground sm:inline">مُنزَل — ما كُتب محفوظ</span>
          <Button size="sm" className="h-8" onClick={() => setNewMinimized(false)}>
            <Maximize2 className="h-4 w-4" />
            رفع الملف
          </Button>
          {confirmDiscard ? (
            <Button size="sm" variant="destructive" className="h-8" onClick={closeNew}>
              تأكيد الإلغاء
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2"
              title="إلغاء الملف الجديد المُنزَل بلا حفظ"
              onClick={() => setConfirmDiscard(true)}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </DockChip>
      )}

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
