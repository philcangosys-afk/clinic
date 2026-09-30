import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { StickyNote, Pencil, Printer, RefreshCw, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePermissions } from "@/lib/permissions";
import { useMemberNames } from "@/lib/member-names";
import { formatDate, formatDateTime, useLocaleSettings } from "@/lib/locale";
import { printHtml } from "@/lib/document-merge";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * ملاحظات اليوم والاجتماعات (Kizen «الملاحظات والاجتماعات») — جدول
 * `schedule_day_notes` (0197). تخصّ اليوم لا المريض: «اجتماع الأطباء
 * الثانية ظهرًا»، «الدكتور ماجد يتأخّر ساعة». الحذف أرشفة بسبب.
 */
type DayNote = {
  id: string;
  note_date: string;
  note_time: string | null;
  kind: "note" | "meeting";
  person_name: string | null;
  description: string;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
};

const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function useDayNotesCount(organizationId: string | undefined, dayKey: string) {
  return useQuery({
    queryKey: ["schedule-day-notes", organizationId, dayKey, "count"],
    enabled: Boolean(organizationId && dayKey),
    queryFn: async () => {
      const { count, error } = await supabase
        .from("schedule_day_notes")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("note_date", dayKey)
        .eq("is_archived", false);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export default function DayNotesDialog({
  organizationId,
  dayKey,
  open,
  onOpenChange,
}: {
  organizationId: string | undefined;
  dayKey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { can } = usePermissions();
  const { calendarDisplay } = useLocaleSettings();
  const memberNames = useMemberNames(organizationId);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [shownDay, setShownDay] = useState(dayKey);
  const [editing, setEditing] = useState<DayNote | "new" | null>(null);
  const [archiving, setArchiving] = useState<DayNote | null>(null);
  const [archiveReason, setArchiveReason] = useState("");
  const [kind, setKind] = useState<"note" | "meeting">("note");
  const [time, setTime] = useState("");
  const [person, setPerson] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (open) setShownDay(dayKey);
  }, [open, dayKey]);

  useEffect(() => {
    if (editing === "new") {
      setKind("note");
      setTime("");
      setPerson("");
      setDescription("");
    } else if (editing) {
      setKind(editing.kind);
      setTime(editing.note_time?.slice(0, 5) ?? "");
      setPerson(editing.person_name ?? "");
      setDescription(editing.description);
    }
  }, [editing]);

  const notes = useQuery({
    queryKey: ["schedule-day-notes", organizationId, shownDay],
    enabled: Boolean(open && organizationId && shownDay),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_day_notes")
        .select("id, note_date, note_time, kind, person_name, description, created_by, created_at, updated_by, updated_at")
        .eq("organization_id", organizationId)
        .eq("note_date", shownDay)
        .eq("is_archived", false)
        .order("note_time", { ascending: true, nullsFirst: true })
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as DayNote[];
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["schedule-day-notes"] });

  const save = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      if (!description.trim()) throw new Error("اكتب الوصف");
      const payload = {
        kind,
        note_time: time || null,
        person_name: person.trim() || null,
        description: description.trim(),
      };
      if (editing === "new") {
        const { error } = await supabase
          .from("schedule_day_notes")
          .insert({ ...payload, organization_id: organizationId, note_date: shownDay });
        if (error) throw error;
      } else if (editing) {
        const { data, error } = await supabase
          .from("schedule_day_notes")
          .update(payload)
          .eq("id", editing.id)
          .eq("organization_id", organizationId)
          .select("id");
        if (error) throw error;
        if (!data?.length) throw new Error("لا صلاحية لتعديل الملاحظة أو لم تعد موجودة");
      }
    },
    onSuccess: () => {
      invalidate();
      setEditing(null);
      toast({ title: "حُفظت الملاحظة" });
    },
    onError: (error: unknown) => toast({ variant: "destructive", title: "تعذّر الحفظ", description: errorMessage(error) }),
  });

  const archive = useMutation({
    mutationFn: async () => {
      if (!archiving || !organizationId) return;
      if (!archiveReason.trim()) throw new Error("سبب الحذف مطلوب");
      const { data, error } = await supabase
        .from("schedule_day_notes")
        .update({ is_archived: true, archive_reason: archiveReason.trim() })
        .eq("id", archiving.id)
        .eq("organization_id", organizationId)
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("لا صلاحية لحذف الملاحظة");
    },
    onSuccess: () => {
      invalidate();
      setArchiving(null);
      setArchiveReason("");
      toast({ title: "حُذفت الملاحظة (أُرشفت)" });
    },
    onError: (error: unknown) => toast({ variant: "destructive", title: "تعذّر الحذف", description: errorMessage(error) }),
  });

  const list = notes.data ?? [];
  const print = () => {
    const rows = list
      .map(
        (row) =>
          `<tr><td>${escapeHtml(row.note_time?.slice(0, 5) ?? "—")}</td><td>${row.kind === "meeting" ? "اجتماع" : "ملاحظة"}</td>` +
          `<td>${escapeHtml(row.person_name ?? "")}</td><td>${escapeHtml(row.description)}</td></tr>`,
      )
      .join("");
    printHtml(
      `ملاحظات يوم ${shownDay}`,
      `<h2>الملاحظات والاجتماعات — ${escapeHtml(formatDate(`${shownDay}T00:00:00`, calendarDisplay))}</h2>` +
        `<table border="1" cellspacing="0" cellpadding="6" style="width:100%;border-collapse:collapse">` +
        `<thead><tr><th>الوقت</th><th>النوع</th><th>الشخص</th><th>الوصف</th></tr></thead><tbody>${rows}</tbody></table>`,
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <StickyNote className="h-5 w-5" />
              الملاحظات والاجتماعات
            </DialogTitle>
            <DialogDescription>ملاحظاتٌ تخصّ اليوم لا مريضًا بعينه — تظهر لكلّ من يفتح جدول هذا اليوم.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" value={shownDay} onChange={(e) => e.target.value && setShownDay(e.target.value)} className="w-40" />
            <Button size="sm" variant="outline" onClick={() => notes.refetch()}>
              <RefreshCw className="h-3.5 w-3.5" />
              تحديث
            </Button>
            <Button size="sm" variant="outline" disabled={list.length === 0} onClick={print}>
              <Printer className="h-3.5 w-3.5" />
              معاينة الطباعة
            </Button>
            {can("appointments.create") && (
              <Button size="sm" onClick={() => setEditing("new")}>
                ملاحظة / اجتماع جديد
              </Button>
            )}
          </div>

          {notes.isLoading && <Skeleton className="h-24 w-full" />}
          {notes.isError && <p className="text-sm text-destructive">تعذّر القراءة: {errorMessage(notes.error)}</p>}
          {!notes.isLoading && !notes.isError && list.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">لا ملاحظات لهذا اليوم.</p>
          )}
          {list.length > 0 && (
            <div className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
              {list.map((row) => (
                <div key={row.id} className="flex items-start justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs tabular-nums">{row.note_time?.slice(0, 5) ?? "—"}</span>
                      <Badge variant={row.kind === "meeting" ? "warning" : "secondary"}>
                        {row.kind === "meeting" ? "اجتماع" : "ملاحظة"}
                      </Badge>
                      {row.person_name && <span className="font-medium">{row.person_name}</span>}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap">{row.description}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {memberNames.data?.get(row.created_by ?? "") ?? "—"} · {formatDateTime(row.created_at, calendarDisplay)}
                      {row.updated_by ? ` · عدّلها ${memberNames.data?.get(row.updated_by) ?? "—"}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {can("appointments.update") && (
                      <>
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="تعديل" onClick={() => setEditing(row)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive"
                          title="حذف"
                          onClick={() => setArchiving(row)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editing)} onOpenChange={(next) => !next && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "ملاحظة / اجتماع جديد" : "تعديل الملاحظة"}</DialogTitle>
            <DialogDescription>يوم {shownDay}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex gap-3 text-sm">
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="radio" checked={kind === "note"} onChange={() => setKind("note")} />
                ملاحظة
              </label>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="radio" checked={kind === "meeting"} onChange={() => setKind("meeting")} />
                اجتماع
              </label>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="flex flex-col gap-1.5">
                <Label>الوقت</Label>
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label>اسم الشخص</Label>
                <Input value={person} onChange={(e) => setPerson(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الوصف *</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              إلغاء
            </Button>
            <Button disabled={save.isPending || !description.trim()} onClick={() => save.mutate()}>
              {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(archiving)} onOpenChange={(next) => !next && setArchiving(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>حذف الملاحظة</DialogTitle>
            <DialogDescription>تُؤرشف ولا تُمحى، ويبقى السبب ومن حذفها.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label>السبب *</Label>
            <Textarea value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiving(null)}>
              تراجع
            </Button>
            <Button variant="destructive" disabled={archive.isPending || !archiveReason.trim()} onClick={() => archive.mutate()}>
              حذف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
