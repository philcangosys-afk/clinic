import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, Users, User, TriangleAlert } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { localDayRange } from "@/lib/date-range";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PatientPicker from "@/components/shared/PatientPicker";
import LookupSelect from "@/components/shared/LookupSelect";
import { useToast } from "@/hooks/use-toast";

/**
 * الإرسال اليدوي للرسائل (لقطة 90).
 *
 * كل الإرسال في النظام كان تلقائيًا عبر مُحفِّزات قاعدة البيانات (تذكير موعد،
 * نتيجة تحليل، إشعار فاتورة...) ولم تكن هناك أي طريقة لإرسال رسالة يدويًا —
 * لا لمريض واحد ولا لمجموعة. هذه الشاشة تسدّ ذلك.
 *
 * ملاحظة تشغيلية مهمة: الإدراج في `message_log` بحالة `queued` هو ما يضع
 * الرسالة في طابور الإرسال — الإرسال الفعلي يقوم به مزوّد الرسائل الذي
 * يقرأ الطابور. لا تُرسل هذه الشاشة الرسالة بنفسها.
 */
const MAX_BULK_RECIPIENTS = 500;

type PatientTarget = { id: string; name_ar: string; mobile_number: string | null };


/** إرسال لمريض واحد. */
function SingleSend() {
  const { organization, session } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [patient, setPatient] = useState<PatientTarget | null>(null);
  const [text, setText] = useState("");

  const send = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لا توجد مؤسسة نشطة");
      if (!patient) throw new Error("اختر المريض أولًا");
      if (!patient.mobile_number) throw new Error("هذا المريض لا يملك رقم جوال مسجَّل");
      if (!text.trim()) throw new Error("اكتب نص الرسالة");
      const { error } = await supabase.from("message_log").insert({
        organization_id: organization.id,
        patient_id: patient.id,
        external_recipient: patient.mobile_number,
        channel: "sms" as const,
        message_text: text.trim(),
        status: "queued" as const,
        created_by: session?.user.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["message-log"] });
      // القول الصادق: الرسالة سُجّلت، ولم تُرسَل. قناة الرسائل النصّية غير
      // مفعّلة في هذا النظام بقرار مالكه، فالطابور لا يُصرَف. رسالة نجاح توحي
      // بوصولها إلى جوّال المريض تجعل الموظّف يظنّ أنه أبلغ من لم يُبلَّغ.
      toast({
        title: "سُجّلت الرسالة في الطابور",
        description: "لن تصل جوّال المريض حتى تُفعَّل قناة الرسائل النصّية — أبلِغه هاتفيًّا إن كان الأمر عاجلًا.",
      });
      setText("");
      setPatient(null);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الإرسال",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="h-4 w-4" />
          رسالة لمريض واحد
        </CardTitle>
        <CardDescription>
          تُسجَّل الرسالة في سجلّ الرسائل. قناة الرسائل النصّية غير مفعّلة حاليًّا، فما
          يُسجَّل هنا لا يصل جوّال المريض بعد.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>المريض *</Label>
          {patient ? (
            <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2">
              <span className="text-sm">
                <strong>{patient.name_ar}</strong>
                <span className="ms-2 font-mono text-xs text-muted-foreground">
                  {patient.mobile_number ?? "بلا جوال"}
                </span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => setPatient(null)}>
                تغيير
              </Button>
            </div>
          ) : (
            <PatientPicker
              onSelect={(row) =>
                setPatient({ id: row.id, name_ar: row.name_ar, mobile_number: row.mobile_number })
              }
            />
          )}
          {patient && !patient.mobile_number && (
            <p className="text-xs text-destructive">لا يوجد رقم جوال مسجَّل لهذا المريض</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>نص الرسالة *</Label>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} />
          <p className="text-xs text-muted-foreground">{text.length} حرفًا</p>
        </div>

        <div>
          <Button
            onClick={() => send.mutate()}
            disabled={send.isPending || !patient?.mobile_number || !text.trim()}
          >
            <Send className="h-4 w-4" />
            {send.isPending ? "جارٍ الإرسال..." : "إرسال"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** إرسال جماعي بفلترة. */
function BulkSend() {
  const { organization, session } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [genderFilter, setGenderFilter] = useState("all");
  const [sourceValueId, setSourceValueId] = useState("");
  const [registeredFrom, setRegisteredFrom] = useState("");
  const [registeredTo, setRegisteredTo] = useState("");
  const [text, setText] = useState("");

  const recipients = useQuery({
    queryKey: [
      "bulk-recipients",
      organization?.id,
      genderFilter,
      sourceValueId,
      registeredFrom,
      registeredTo,
    ],
    enabled: Boolean(organization?.id),
    queryFn: async () => {
      let query = supabase
        .from("patients")
        .select("id, name_ar, mobile_number")
        .eq("organization_id", organization?.id)
        // المرضى المحجوبون عن الرسائل يُستثنون احترامًا لإعداد الحجب في ملفهم
        .eq("block_sms", false)
        .not("mobile_number", "is", null)
        .limit(MAX_BULK_RECIPIENTS);
      if (genderFilter !== "all") query = query.eq("gender", genderFilter);
      if (sourceValueId) query = query.eq("source_value_id", sourceValueId);
      if (registeredFrom) query = query.gte("file_date", localDayRange(registeredFrom, "").from!);
      // `file_date` من نوع timestamptz، وتاريخ بلا وقت يُفسَّر منتصف الليل —
      // فكان "إلى 31 أغسطس" يستبعد كل من فُتح ملفه **في** 31 أغسطس.
      if (registeredTo) query = query.lte("file_date", localDayRange("", registeredTo).to!);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as PatientTarget[];
    },
  });

  const list = recipients.data ?? [];
  const atCap = list.length >= MAX_BULK_RECIPIENTS;

  const send = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لا توجد مؤسسة نشطة");
      if (!text.trim()) throw new Error("اكتب نص الرسالة");
      if (list.length === 0) throw new Error("لا يوجد مستلمون مطابقون للفلترة");
      const payload = list.map((row) => ({
        organization_id: organization.id,
        patient_id: row.id,
        external_recipient: row.mobile_number,
        channel: "sms" as const,
        message_text: text.trim(),
        status: "queued" as const,
        created_by: session?.user.id ?? null,
      }));
      const { error } = await supabase.from("message_log").insert(payload);
      if (error) throw error;
      return payload.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["message-log"] });
      toast({
        title: `سُجّلت ${count} رسالة في الطابور`,
        description: "لن تصل أجهزة المرضى حتى تُفعَّل قناة الرسائل النصّية.",
      });
      setText("");
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الإرسال",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          رسالة جماعية
        </CardTitle>
        <CardDescription>
          حدّد شريحة المرضى بالفلاتر ثم راجع عدد المستلمين. قناة الرسائل النصّية غير
          مفعّلة حاليًّا، فما يُسجَّل هنا لا يصل أجهزة المرضى بعد.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>الجنس</Label>
            <Select value={genderFilter} onValueChange={setGenderFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="male">ذكر</SelectItem>
                <SelectItem value="female">أنثى</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>مصدر المريض</Label>
            <LookupSelect
              categoryKey="patient_sources"
              value={sourceValueId}
              onChange={setSourceValueId}
              placeholder="الكل"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>مسجَّل من تاريخ</Label>
            <Input type="date" value={registeredFrom} onChange={(e) => setRegisteredFrom(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>إلى تاريخ</Label>
            <Input type="date" value={registeredTo} onChange={(e) => setRegisteredTo(e.target.value)} />
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
          {recipients.isLoading ? (
            <Skeleton className="h-5 w-32" />
          ) : (
            <>
              <Badge variant="default">{list.length}</Badge>
              <span className="text-sm">مستلم مطابق للفلترة</span>
            </>
          )}
        </div>

        {atCap && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              وصلت النتائج للحد الأقصى ({MAX_BULK_RECIPIENTS} مستلم). سيتم الإرسال لهؤلاء فقط — ضيّق
              الفلترة لتغطية بقية المرضى في دفعة تالية.
            </span>
          </div>
        )}

        <div className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          المرضى المحجوبون عن الرسائل ومن ليس لديهم رقم جوال مستبعدون تلقائيًا.
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>نص الرسالة *</Label>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} />
          <p className="text-xs text-muted-foreground">{text.length} حرفًا</p>
        </div>

        <div>
          <Button
            onClick={() => send.mutate()}
            disabled={send.isPending || list.length === 0 || !text.trim()}
          >
            <Send className="h-4 w-4" />
            {send.isPending ? "جارٍ الإرسال..." : `إرسال إلى ${list.length} مستلم`}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SendMessageTab() {
  return (
    <Tabs defaultValue="single" className="flex flex-col gap-4">
      <TabsList>
        <TabsTrigger value="single">مريض واحد</TabsTrigger>
        <TabsTrigger value="bulk">إرسال جماعي</TabsTrigger>
      </TabsList>
      <TabsContent value="single">
        <SingleSend />
      </TabsContent>
      <TabsContent value="bulk">
        <BulkSend />
      </TabsContent>
    </Tabs>
  );
}
