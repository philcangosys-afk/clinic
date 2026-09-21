import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { StickyNote, Save, ListChecks } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import type { PatientNoteRow } from "@/lib/database.types";
import { formatDateTime, useLocaleSettings } from "@/lib/locale";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/**
 * «الملاحظات» في أعلى ملفّ المريض — زرٌّ ظاهر لكلّ من يفتح الملفّ.
 *
 * كانت الملاحظات قسمًا بين عشرين قسمًا في القائمة الجانبية: الطبيب لا يعرف
 * أنّ للمريض ملاحظة ما لم يدخل القسم، والاستقبال مثله. الآن الزرّ في رأس
 * الملفّ بجانب أوامره، وعليه عدد الملاحظات النشطة، ويتلوّن حين توجد — فيُرى
 * قبل أن يُبحث عنه. والضغط يفتح لوحةً جانبية: حقل كتابةٍ سريع فوق، وآخر
 * الملاحظات بكاتبها ووقتها تحت.
 *
 * الحفظ في `patient_notes` نفسه الذي يقرؤه قسم «الملاحظات» (المفتاح نفسه في
 * الذاكرة)، فما يُكتب هنا يظهر هناك فورًا، وما يُعطَّل هناك يختفي هنا. ولا
 * صلاحية جديدة: سياسة الجدول (0002) تسمح لكلّ عضوٍ في المنشأة، طبيبًا كان
 * أو استقبالًا — وهذا المطلوب: الطبيب يكتب، والاستقبال يرى.
 */

export const PATIENT_NOTES_KEY = (patientId: string) => ["patient-notes", patientId] as const;

export async function fetchPatientNotes(patientId: string) {
  const { data, error } = await supabase
    .from("patient_notes")
    .select("*")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PatientNoteRow[];
}

/** كلّ ملاحظات المريض (النشطة والمعطّلة) — المفتاح الذي يقرؤه قسم «الملاحظات». */
export function usePatientNotes(patientId: string | undefined) {
  return useQuery({
    queryKey: PATIENT_NOTES_KEY(patientId ?? ""),
    enabled: Boolean(patientId),
    // ملاحظة زميلٍ على مريضٍ مفتوح تصل بلا تحديث يدويّ
    refetchInterval: 30_000,
    queryFn: () => fetchPatientNotes(patientId!),
  });
}

/**
 * أسماء أعضاء المنشأة — لعرض كاتب الملاحظة بدل معرّف مستخدم.
 *
 * `patient_notes.created_by` يشير إلى `auth.users`، وPostgREST لا يصل إلى
 * ذلك المخطّط، فالاسم يأتي من `v_organization_members_directory` (0026).
 */
export function useMemberNames() {
  const { organization } = useOrganizationAccess();
  return useQuery({
    queryKey: ["members-directory-names", organization?.id],
    enabled: Boolean(organization?.id),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_organization_members_directory")
        .select("user_id, display_name")
        .eq("organization_id", organization!.id);
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const row of (data ?? []) as { user_id: string; display_name: string }[]) {
        map[row.user_id] = row.display_name;
      }
      return map;
    },
  });
}

/**
 * عدد الملاحظات النشطة لعدّة مرضى في طلبٍ واحد — لإشارة الملاحظات في طابور
 * الاستقبال. طلبٌ لكلّ صفّ كان سيُرسل عشرات الطلبات مع كلّ تحديث للطابور.
 */
export function usePatientNoteCounts(patientIds: string[]) {
  const ids = Array.from(new Set(patientIds.filter(Boolean))).sort();
  return useQuery({
    queryKey: ["patient-note-counts", ids],
    enabled: ids.length > 0,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_notes")
        .select("patient_id")
        .in("patient_id", ids)
        .eq("is_disabled", false);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of (data ?? []) as { patient_id: string }[]) {
        counts[row.patient_id] = (counts[row.patient_id] ?? 0) + 1;
      }
      return counts;
    },
  });
}

export default function PatientNotesButton({
  patientId,
  patientName,
  onOpenAll,
}: {
  patientId: string;
  patientName: string;
  /** يفتح قسم «الملاحظات» الكامل (التعديل والتعطيل والمعطّلة) */
  onOpenAll?: () => void;
}) {
  const { session } = useOrganizationAccess();
  const { calendarDisplay } = useLocaleSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const memberNames = useMemberNames();
  const notes = usePatientNotes(patientId);

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const active = (notes.data ?? []).filter((note) => !note.is_disabled);
  const count = active.length;

  const save = useMutation({
    mutationFn: async () => {
      const text = body.trim();
      if (!text) throw new Error("اكتب نصّ الملاحظة أوّلًا");
      const { error } = await supabase.from("patient_notes").insert({
        patient_id: patientId,
        title: title.trim() || null,
        body: text,
        created_by: session?.user.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setTitle("");
      setBody("");
      queryClient.invalidateQueries({ queryKey: PATIENT_NOTES_KEY(patientId) });
      queryClient.invalidateQueries({ queryKey: ["patient-note-counts"] });
      toast({ title: "حُفظت الملاحظة", description: "تظهر لكلّ من يفتح ملفّ المريض" });
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر حفظ الملاحظة", description: errorMessage(error) }),
  });

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        title={count > 0 ? `للمريض ${count} ملاحظة نشطة` : "لا ملاحظات — اضغط لكتابة ملاحظة"}
        className={
          count > 0
            ? "border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100 hover:text-amber-950"
            : undefined
        }
      >
        <StickyNote className="h-3.5 w-3.5" />
        الملاحظات
        {count > 0 && (
          <span className="rounded-full bg-amber-500 px-1.5 text-[11px] font-bold leading-5 text-white tabular-nums">
            {count}
          </span>
        )}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b p-4 text-start">
            <SheetTitle className="flex items-center gap-2">
              <StickyNote className="h-4 w-4" />
              ملاحظات الملفّ
            </SheetTitle>
            <SheetDescription>
              {patientName} — ما يُكتب هنا يُحفظ في ملفّ المريض ويراه الأطباء والاستقبال.
            </SheetDescription>
          </SheetHeader>

          <form
            className="flex flex-col gap-2 border-b p-4"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <Label htmlFor="quick-note-title">العنوان (اختياريّ)</Label>
            <Input
              id="quick-note-title"
              value={title}
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="مثال: تنبيه للاستقبال"
            />
            <Label htmlFor="quick-note-body">الملاحظة</Label>
            <Textarea
              id="quick-note-body"
              rows={4}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="اكتب الملاحظة…"
            />
            <Button type="submit" disabled={save.isPending || !body.trim()} className="self-end">
              <Save className="h-3.5 w-3.5" />
              {save.isPending ? "جارٍ الحفظ…" : "حفظ الملاحظة"}
            </Button>
          </form>

          <div className="flex-1 overflow-y-auto p-4">
            {notes.isLoading && <Skeleton className="h-24 w-full" />}
            {notes.isError && (
              <p className="py-6 text-center text-sm text-destructive">
                تعذّر تحميل الملاحظات: {errorMessage(notes.error)}
              </p>
            )}
            {!notes.isLoading && !notes.isError && count === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">لا ملاحظات على هذا الملفّ بعد.</p>
            )}
            <ul className="flex flex-col gap-2">
              {active.map((note) => (
                <li key={note.id} className="rounded-md border border-amber-200 bg-amber-50/60 p-3">
                  {note.title && <p className="mb-1 text-sm font-semibold">{note.title}</p>}
                  <p className="whitespace-pre-wrap break-words text-sm">{note.body}</p>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {note.created_by ? memberNames.data?.[note.created_by] ?? "—" : "—"}
                    {" · "}
                    {formatDateTime(note.created_at, calendarDisplay)}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          {onOpenAll && (
            <div className="border-t p-3">
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => {
                  setOpen(false);
                  onOpenAll();
                }}
              >
                <ListChecks className="h-3.5 w-3.5" />
                كلّ الملاحظات — التعديل والتعطيل
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
