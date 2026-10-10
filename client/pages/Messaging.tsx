import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, MessageSquare, Plus, Send, Smartphone, Users } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type {
  CannedTextRow,
  InternalConversationRow,
  InternalMessagingSettingsRow,
  InternalUnreadCountView,
  MessageChannel,
  MessageTemplateRow,
  OrganizationMemberDirectoryView,
  SmsCreditTransactionRow,
} from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import SendMessageTab from "@/components/messaging/SendMessageTab";
import { errorMessage } from "@/lib/error-message";

const CHANNEL_ICON: Record<MessageChannel, typeof Mail> = { sms: Smartphone, email: Mail, internal: MessageSquare };
const CHANNEL_LABELS: Record<MessageChannel, string> = { sms: "رسالة نصية", email: "بريد إلكتروني", internal: "داخلي" };
/**
 * الحالات السبع كما يسمح بها قيد `message_log_status_check` في القاعدة.
 *
 * كانت الخرائط تغطّي أربعًا فقط، فتُرسَم شارة **فارغة بلا نصّ** لكل رسالة
 * `pending` (يُدرجها مُشغِّل التذكيرات) أو `processing` (يُعلّمها سحب الطابور)
 * أو `cancelled` (يحوّلها مُحفِّز الحجب) — أي أن الرسالة الملغاة لمريض محجوب
 * والرسالة التي لم يحن دورها لا يمكن تمييزهما ولا فهمهما.
 */
const STATUS_BADGE: Record<string, "secondary" | "default" | "destructive" | "success" | "warning"> = {
  pending: "secondary",
  queued: "secondary",
  processing: "default",
  sent: "default",
  delivered: "success",
  failed: "destructive",
  cancelled: "warning",
};
const STATUS_LABELS: Record<string, string> = {
  pending: "بانتظار الدور",
  queued: "في الانتظار",
  processing: "قيد الإرسال",
  sent: "أُرسلت",
  delivered: "تم التسليم",
  failed: "فشلت",
  cancelled: "أُلغيت",
};

export default function Messaging() {
  const { organization } = useOrganizationAccess();
  /**
   * إعدادات الدردشة تُقرأ هنا لا في تبويبها وحده.
   *
   * كان «تفعيل الدردشة الداخلية» يُحفظ ولا يقرؤه شيء: يُلغي المالك تأشيره
   * فيرى رسالة نجاح، ويبقى التبويب مفتوحًا للفريق كله. الآن يُخفى التبويب فعلًا
   * عند إلغاء التفعيل — مع ملاحظة صريحة أن هذا منعُ واجهة لا منعُ قاعدة
   * (سياسات `internal_messages` لا تفحص هذا المفتاح بعد).
   */
  const chatSettings = useChatSettings(organization?.id);
  const chatEnabled = chatSettings.data ? chatSettings.data.internal_chat_enabled : true;
  const pollSeconds = Math.max(5, Number(chatSettings.data?.poll_interval_seconds ?? 15));

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">الرسائل والتنبيهات</h1>
        <p className="text-sm text-muted-foreground">سجل الرسائل الموحَّد، قوالب الأحداث، النصوص الجاهزة، ورصيد الرسائل النصية</p>
      </div>

      <Tabs defaultValue="log">
        <TabsList>
          <TabsTrigger value="send">إرسال رسالة</TabsTrigger>
          <TabsTrigger value="log">سجل الرسائل</TabsTrigger>
          <TabsTrigger value="templates">القوالب</TabsTrigger>
          <TabsTrigger value="canned">النصوص الجاهزة</TabsTrigger>
          <TabsTrigger value="sms">رصيد SMS</TabsTrigger>
          {chatEnabled && <TabsTrigger value="chat">الدردشة الداخلية</TabsTrigger>}
          <TabsTrigger value="settings">إعدادات الدردشة</TabsTrigger>
        </TabsList>
        <TabsContent value="send" className="mt-4">
          <SendMessageTab />
        </TabsContent>
        <TabsContent value="log" className="mt-4">
          <MessageLogTab />
        </TabsContent>
        <TabsContent value="templates" className="mt-4">
          <TemplatesTab />
        </TabsContent>
        <TabsContent value="canned" className="mt-4">
          <CannedTextsTab />
        </TabsContent>
        <TabsContent value="sms" className="mt-4">
          <SmsLedgerTab />
        </TabsContent>
        {chatEnabled && (
          <TabsContent value="chat" className="mt-4">
            <InternalChatTab pollSeconds={pollSeconds} />
          </TabsContent>
        )}
        <TabsContent value="settings" className="mt-4">
          <ChatSettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// سجل الرسائل
// ---------------------------------------------------------------------------
function useMessageLog(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["message-log", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("message_log")
        .select(
          "id, channel, event_key, message_text, status, last_error, sent_at, created_at, recipient_user_id, external_recipient, created_by, patient:patients(name_ar)",
        )
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
}

function useOrgMembersDirectory(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["org-members-directory", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_organization_members_directory")
        .select("user_id, display_name")
        .eq("organization_id", organizationId);
      if (error) throw error;
      return new Map((data ?? []).map((m: any) => [m.user_id as string, m.display_name as string]));
    },
  });
}

function MessageLogTab() {
  const { organization } = useOrganizationAccess();
  const log = useMessageLog(organization?.id);
  const directory = useOrgMembersDirectory(organization?.id);

  return (
    <Card>
      <CardHeader>
        <CardTitle>آخر 100 رسالة</CardTitle>
        <CardDescription>يشمل تذكيرات المواعيد التلقائية، إشعارات الفواتير، والتنبيهات الداخلية لمالك المؤسسة</CardDescription>
      </CardHeader>
      <CardContent>
        {log.isLoading && <Skeleton className="h-40 w-full" />}
        {!log.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>القناة</TableHead>
                <TableHead>المريض/المستلم</TableHead>
                <TableHead>المُرسِل</TableHead>
                <TableHead>النص</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>التاريخ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(log.data ?? []).map((msg) => {
                const Icon = CHANNEL_ICON[msg.channel as MessageChannel];
                const patient = Array.isArray(msg.patient) ? msg.patient[0] : msg.patient;
                return (
                  <TableRow key={msg.id}>
                    <TableCell>
                      <span className="flex items-center gap-1.5 text-xs">
                        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                        {CHANNEL_LABELS[msg.channel as MessageChannel]}
                      </span>
                    </TableCell>
                    <TableCell>
                      {patient?.name_ar ??
                        (msg.recipient_user_id
                          ? directory.data?.get(msg.recipient_user_id) ?? "مستخدم داخلي"
                          : msg.external_recipient ?? "—")}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {msg.created_by ? directory.data?.get(msg.created_by) ?? "—" : "—"}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-sm">{msg.message_text}</TableCell>
                    <TableCell>
                      {/* سبب الفشل أو الإلغاء يظهر في تلميح على الشارة: بدونه
                          تبقى «أُلغيت» بلا تفسير للموظّف الذي أرسلها. */}
                      <Badge
                        variant={STATUS_BADGE[String(msg.status)] ?? "secondary"}
                        title={(msg as any).last_error ?? undefined}
                      >
                        {STATUS_LABELS[String(msg.status)] ?? String(msg.status)}
                      </Badge>
                      {(msg as any).last_error && (
                        <p className="mt-0.5 max-w-40 truncate text-[10px] text-muted-foreground">
                          {(msg as any).last_error}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(msg.created_at).toLocaleString("ar-SA-u-nu-latn")}</TableCell>
                  </TableRow>
                );
              })}
              {(log.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد رسائل مسجَّلة بعد.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// القوالب
// ---------------------------------------------------------------------------
const EVENT_KEY_LABELS: Record<string, string> = {
  file_opened: "فتح ملف مريض",
  appointment_reminder: "تذكير بموعد",
  lab_results_ready: "جاهزية نتائج التحاليل",
  invoice_notification: "إشعار فاتورة",
  notes_reminder: "تذكير بالملاحظات",
  document_expiry_alert: "انتهاء وثيقة",
  owner_notification: "تبليغ المالك",
  sms_balance_low: "انخفاض رصيد SMS",
};

function useMessageTemplates(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["message-templates", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("message_templates")
        .select("id, event_key, channel, template_text, is_disabled")
        .eq("organization_id", organizationId)
        .order("event_key");
      if (error) throw error;
      return (data ?? []) as MessageTemplateRow[];
    },
  });
}

function TemplatesTab() {
  const { organization } = useOrganizationAccess();
  const templates = useMessageTemplates(organization?.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [createOpen, setCreateOpen] = useState(false);

  const saveTemplate = useMutation({
    mutationFn: async ({ id, text }: { id: string; text: string }) => {
      // `.select("id")` ليس تزيينًا: سياسة RLS من نوع USING تُخرج الصف من
      // نطاق التحديث بلا خطأ — يعود PostgREST بـ204 و`error = null`، فتظهر
      // رسالة "تم حفظ القالب" ولا يُحفظ شيء ويضيع التعديل عند التحديث.
      const { data, error } = await supabase
        .from("message_templates")
        .update({ template_text: text })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0)
        throw new Error("لم يُحفظ التعديل — تعديل القوالب مقيَّد بصفة مالك المنشأة أو مدير النظام");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["message-templates", organization?.id] });
      toast({ title: "تم حفظ القالب" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ — التعديل مقيَّد بصفة مدير المؤسسة",
        description: errorMessage(error),
      }),
  });

  const toggleDisabled = useMutation({
    mutationFn: async ({ id, disabled }: { id: string; disabled: boolean }) => {
      const { data: affectedRows, error } = await supabase.from("message_templates").update({ is_disabled: disabled }).eq("id", id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["message-templates", organization?.id] }),
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر تغيير حالة القالب", description: errorMessage(error) }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>قوالب الرسائل</CardTitle>
          {/* الوصف كان يقول إن ثمانية قوالب «زُرعت تلقائيًا» — والزرع ضاع من
              دالّة إنشاء المنشأة الحيّة، فكان التبويب يظهر فارغًا بلا مخرج
              وبوصفٍ يكذّب ما يراه المستخدم. */}
          <CardDescription>
            نصّ كل حدث تُبنى منه الرسالة (تذكير موعد، جاهزية نتيجة، إشعار فاتورة...). الزرع
            التلقائي عند إنشاء المنشأة لا يعمل حاليًّا، فأنشئ ما تحتاجه من «قالب جديد».
            الإضافة والتعديل مقيَّدان بصفة المالك أو مدير النظام في القاعدة.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          قالب جديد
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <NewTemplateDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          organizationId={organization?.id}
          existing={templates.data ?? []}
        />
        {templates.isLoading && <Skeleton className="h-40 w-full" />}
        {!templates.isLoading &&
          (templates.data ?? []).map((template) => (
            <div key={template.id} className="flex flex-col gap-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {EVENT_KEY_LABELS[template.event_key] ?? template.event_key} — {CHANNEL_LABELS[template.channel]}
                </span>
                <Button
                  size="sm"
                  variant={template.is_disabled ? "outline" : "ghost"}
                  onClick={() => toggleDisabled.mutate({ id: template.id, disabled: !template.is_disabled })}
                >
                  {template.is_disabled ? "معطَّل — تفعيل" : "نشط — تعطيل"}
                </Button>
              </div>
              <Textarea
                rows={2}
                value={drafts[template.id] ?? template.template_text}
                onChange={(e) => setDrafts((d) => ({ ...d, [template.id]: e.target.value }))}
              />
              <Button
                size="sm"
                variant="outline"
                className="self-start"
                disabled={saveTemplate.isPending}
                onClick={() => saveTemplate.mutate({ id: template.id, text: drafts[template.id] ?? template.template_text })}
              >
                حفظ النص
              </Button>
            </div>
          ))}
        {!templates.isLoading && (templates.data ?? []).length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            لا توجد قوالب لهذه المنشأة. تذكير المواعيد يقرأ قالبه من هنا — وبلا قالب لا نصّ،
            فأنشئ قالب «تذكير بموعد» على الأقل.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * إنشاء قالب يدويًّا — المخرج من التبويب الفارغ.
 *
 * سياسة `message_templates_manage_admins` تسمح للمالك ومدير النظام بالإدراج
 * أصلًا، ولم تكن هناك واجهة تفعله: فمنشأة فقدت الزرع التلقائي تبقى بلا قوالب
 * إلى الأبد. مفاتيح الأحداث والقنوات محصورة بما يسمح به قيد القاعدة.
 */
function NewTemplateDialog({
  open,
  onOpenChange,
  organizationId,
  existing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  existing: MessageTemplateRow[];
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [eventKey, setEventKey] = useState("appointment_reminder");
  const [channel, setChannel] = useState<MessageChannel>("sms");
  const [text, setText] = useState("");

  const duplicate = existing.some((row) => row.event_key === eventKey && row.channel === channel);

  const create = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      if (!text.trim()) throw new Error("اكتب نصّ القالب");
      const { error } = await supabase.from("message_templates").insert({
        organization_id: organizationId,
        event_key: eventKey,
        channel,
        template_text: text.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["message-templates", organizationId] });
      toast({ title: "أُضيف القالب" });
      setText("");
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر إنشاء القالب",
        description: errorMessage(error),
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>قالب رسالة جديد</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>الحدث</Label>
            <select
              className="rounded-md border bg-background px-3 py-2 text-sm"
              value={eventKey}
              onChange={(e) => setEventKey(e.target.value)}
            >
              {Object.entries(EVENT_KEY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>القناة</Label>
            <select
              className="rounded-md border bg-background px-3 py-2 text-sm"
              value={channel}
              onChange={(e) => setChannel(e.target.value as MessageChannel)}
            >
              {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {channel === "sms" && (
              <p className="text-xs text-amber-700">
                قناة الرسائل النصّية غير مفعّلة في النظام: القالب يُسجَّل ويُستعمل في توليد نصّ
                الرسالة، لكن الرسالة لا تصل جوّال المريض بعد.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>نصّ القالب *</Label>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} autoFocus />
          </div>
          {duplicate && (
            <p className="text-xs text-amber-700">
              يوجد قالب لهذا الحدث بهذه القناة — الإضافة ستُنشئ قالبًا ثانيًا له.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button disabled={!text.trim() || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? "جارٍ الحفظ..." : "حفظ القالب"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// النصوص الجاهزة
// ---------------------------------------------------------------------------
const LOCATION_LABELS: Record<string, string> = {
  dental_board: "لوحة الأسنان",
  medical_reports: "التقارير الطبية",
  referral_report: "تقرير التحويل",
  derma_clinic: "عيادة الجلدية",
  appointment_note: "ملاحظة الموعد",
  invoice_dosage_field: "حقل الجرعة في الفاتورة",
  invoice_usage_field: "حقل الاستخدام في الفاتورة",
};

function useCannedTexts(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["canned-texts", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("canned_texts")
        .select("id, location_key, text_ar, text_en, sort_order, is_disabled")
        .eq("organization_id", organizationId)
        .order("location_key")
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as CannedTextRow[];
    },
  });
}

function CannedTextsTab() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const texts = useCannedTexts(organization?.id);
  const [createOpen, setCreateOpen] = useState(false);

  const toggleDisabled = useMutation({
    mutationFn: async ({ id, is_disabled }: { id: string; is_disabled: boolean }) => {
      const { data: affectedRows, error } = await supabase.from("canned_texts").update({ is_disabled }).eq("id", id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["canned-texts", organization?.id] }),
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذّر تغيير حالة النصّ", description: errorMessage(error) }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>النصوص الجاهزة</CardTitle>
          <CardDescription>عبارات سريعة الإدراج حسب موقعها في الواجهة (لوحة الأسنان، التقارير، ملاحظات المواعيد...)</CardDescription>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          نص جديد
        </Button>
      </CardHeader>
      <CardContent>
        {texts.isLoading && <Skeleton className="h-40 w-full" />}
        {!texts.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الموقع</TableHead>
                <TableHead>النص</TableHead>
                <TableHead>الحالة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(texts.data ?? []).map((text) => (
                <TableRow key={text.id}>
                  <TableCell>{LOCATION_LABELS[text.location_key] ?? text.location_key}</TableCell>
                  <TableCell>
                    {text.text_ar}
                    {text.text_en && <p className="text-xs text-muted-foreground">{text.text_en}</p>}
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => toggleDisabled.mutate({ id: text.id, is_disabled: !text.is_disabled })}
                    >
                      <Badge variant={text.is_disabled ? "secondary" : "success"}>{text.is_disabled ? "معطّل" : "نشط"}</Badge>
                    </button>
                  </TableCell>
                </TableRow>
              ))}
              {(texts.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                    لا توجد نصوص جاهزة بعد.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <NewCannedTextDialog open={createOpen} onOpenChange={setCreateOpen} organizationId={organization?.id} />
    </Card>
  );
}

function NewCannedTextDialog({
  open,
  onOpenChange,
  organizationId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [locationKey, setLocationKey] = useState("appointment_note");
  const [textAr, setTextAr] = useState("");
  const [textEn, setTextEn] = useState("");

  const createText = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      const { error } = await supabase.from("canned_texts").insert({
        organization_id: organizationId,
        location_key: locationKey,
        text_ar: textAr.trim(),
        text_en: textEn.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["canned-texts", organizationId] });
      toast({ title: "تم حفظ النص" });
      setTextAr("");
      setTextEn("");
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: errorMessage(error),
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>نص جاهز جديد</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>الموقع</Label>
            <select
              className="rounded-md border bg-background px-3 py-2 text-sm"
              value={locationKey}
              onChange={(e) => setLocationKey(e.target.value)}
            >
              {Object.entries(LOCATION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>النص (عربي) *</Label>
            <Textarea value={textAr} onChange={(e) => setTextAr(e.target.value)} rows={2} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>النص (إنجليزي)</Label>
            <Textarea value={textEn} onChange={(e) => setTextEn(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!textAr.trim() || createText.isPending} onClick={() => createText.mutate()}>
            {createText.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// رصيد SMS وسجل حركاته
// ---------------------------------------------------------------------------
function useSmsBalance(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["sms-balance", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sms_credit_balance")
        .select("balance, low_balance_alert_threshold")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

function useSmsTransactions(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["sms-transactions", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sms_credit_transactions")
        .select("id, transaction_type, amount, note, created_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as SmsCreditTransactionRow[];
    },
  });
}

const SMS_TX_LABELS: Record<string, string> = { top_up: "تعبئة", consumption: "استهلاك", adjustment: "تسوية" };

function SmsLedgerTab() {
  const { organization } = useOrganizationAccess();
  const balance = useSmsBalance(organization?.id);
  const transactions = useSmsTransactions(organization?.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [amount, setAmount] = useState("100");
  const [threshold, setThreshold] = useState("");

  // لا صفّ رصيد للمنشأة قبل أول تعبئة: دالّة إنشاء المنشأة الحيّة لا تُدرجه،
  // ولا سياسة INSERT على الجدول — ينشئه `app_apply_sms_credit_transaction`
  // عند أول تعبئة. هذه الحقيقة يجب أن تُقال، لا أن تُترجَم إلى «لا صلاحية».
  const balanceRowMissing = !balance.isLoading && !balance.isError && balance.data == null;

  const saveThreshold = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لا توجد مؤسسة نشطة");
      if (balanceRowMissing)
        throw new Error(
          "لا يوجد سجل رصيد لهذه المنشأة بعد — يُنشأ بأول «تعبئة رصيد»، وبعدها يُحفظ حد التنبيه. المسألة ليست في صلاحيتك.",
        );
      // كما في القوالب: تحديث لا يطابق صفًا ليس خطأً، فبلا هذا الفحص كان
      // حد التنبيه يبقى على قيمته القديمة مع رسالة نجاح.
      const { data, error } = await supabase
        .from("sms_credit_balance")
        .update({ low_balance_alert_threshold: Number(threshold) || 0 })
        .eq("organization_id", organization.id)
        .select("organization_id");
      if (error) throw error;
      if (!data || data.length === 0)
        throw new Error(
          "لم يُحفظ الحد: لم يطابق التحديث أي سجل — إمّا لا سجل رصيد لهذه المنشأة (يُنشأ بأول تعبئة)، وإمّا أن تعديله مقيَّد بصفة مالك المنشأة أو مدير النظام",
        );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sms-balance", organization?.id] });
      toast({ title: "تم حفظ حد التنبيه" });
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذر الحفظ", description: errorMessage(error, "خطأ غير متوقع") }),
  });

  const topUp = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لا توجد مؤسسة نشطة");
      const { error } = await supabase.from("sms_credit_transactions").insert({
        organization_id: organization.id,
        transaction_type: "top_up",
        amount: Number(amount) || 0,
        note: "تعبئة رصيد يدوية",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sms-balance", organization?.id] });
      queryClient.invalidateQueries({ queryKey: ["sms-transactions", organization?.id] });
      toast({ title: "تمت تعبئة الرصيد" });
      setTopUpOpen(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذرت التعبئة — مقيَّدة بصفة مدير المؤسسة",
        description: errorMessage(error),
      }),
  });

  return (
    <div className="flex flex-col gap-4">
      {balanceRowMissing && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          لا يوجد سجل رصيد لهذه المنشأة بعد — يُنشأ تلقائيًّا بأول «تعبئة رصيد»، وقبل ذلك لا
          يمكن حفظ حد التنبيه.
        </div>
      )}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <span>الرصيد الحالي: <strong>{(balance.data?.balance ?? 0).toLocaleString("ar-SA-u-nu-latn")}</strong> رسالة</span>
          <div className="flex items-center gap-2">
            <Label className="whitespace-nowrap text-xs text-muted-foreground">حد التنبيه عند انخفاض الرصيد</Label>
            <Input
              className="h-8 w-24"
              type="number"
              min={0}
              placeholder={String(balance.data?.low_balance_alert_threshold ?? 0)}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!threshold || saveThreshold.isPending || balanceRowMissing}
              onClick={() => saveThreshold.mutate()}
            >
              حفظ
            </Button>
          </div>
          <Button size="sm" onClick={() => setTopUpOpen(true)}>
            <Plus className="h-4 w-4" />
            تعبئة رصيد
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>سجل حركات الرصيد</CardTitle>
          <CardDescription>سجل غير قابل للتعديل أو الحذف — كل استهلاك رسالة يُسجَّل تلقائيًا عند تغيّر حالتها إلى "أُرسلت"</CardDescription>
        </CardHeader>
        <CardContent>
          {transactions.isLoading && <Skeleton className="h-40 w-full" />}
          {!transactions.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>النوع</TableHead>
                  <TableHead>الكمية</TableHead>
                  <TableHead>ملاحظة</TableHead>
                  <TableHead>التاريخ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(transactions.data ?? []).map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell>{SMS_TX_LABELS[tx.transaction_type] ?? tx.transaction_type}</TableCell>
                    <TableCell className={Number(tx.amount) >= 0 ? "text-emerald-700" : "text-red-700"}>
                      {Number(tx.amount) >= 0 ? "+" : ""}
                      {tx.amount}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{tx.note ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(tx.created_at).toLocaleString("ar-SA-u-nu-latn")}</TableCell>
                  </TableRow>
                ))}
                {(transactions.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد حركات بعد.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={topUpOpen} onOpenChange={setTopUpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تعبئة رصيد SMS</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label>عدد الرسائل</Label>
            <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <DialogFooter>
            <Button disabled={!amount || topUp.isPending} onClick={() => topUp.mutate()}>
              {topUp.isPending ? "جارٍ التعبئة..." : "تأكيد التعبئة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// الدردشة الداخلية — المرحلة 7.2 (معالجة فجوة موثَّقة منذ المرحلة 5.3):
// محادثات/رسائل فعلية بين المستخدمين، مفصولة تمامًا عن سجل الإشعارات أعلاه
// ---------------------------------------------------------------------------
function useConversations(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["internal-conversations", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("internal_conversations")
        .select("*")
        .eq("organization_id", organizationId)
        .order("last_message_at", { ascending: false });
      if (error) throw error;
      return (data as InternalConversationRow[]) ?? [];
    },
  });
}

function useMembersDirectory(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["members-directory", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_organization_members_directory")
        .select("*")
        .eq("organization_id", organizationId)
        .order("display_name");
      if (error) throw error;
      return (data as OrganizationMemberDirectoryView[]) ?? [];
    },
  });
}

function useUnreadCounts(
  organizationId: string | undefined,
  userId: string | undefined,
  pollSeconds: number,
) {
  return useQuery({
    queryKey: ["internal-unread", organizationId, userId],
    enabled: Boolean(organizationId) && Boolean(userId),
    // مدة التحديث تأتي من إعداد المنشأة `poll_interval_seconds`: كانت مثبَّتة
    // على 15 و10 ثوانٍ، فتغييرها في الإعدادات لم يكن يغيّر شيئًا.
    refetchInterval: pollSeconds * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_internal_unread_counts")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("user_id", userId);
      if (error) throw error;
      return (data as InternalUnreadCountView[]) ?? [];
    },
  });
}

function useConversationMessages(conversationId: string, pollSeconds: number) {
  return useQuery({
    queryKey: ["internal-messages", conversationId],
    enabled: Boolean(conversationId),
    refetchInterval: pollSeconds * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("internal_messages")
        .select("id, sender_id, body, created_at, deleted_at")
        .eq("conversation_id", conversationId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

function InternalChatTab({ pollSeconds }: { pollSeconds: number }) {
  const { organization, session } = useOrganizationAccess();
  const currentUserId = session?.user.id;
  const conversations = useConversations(organization?.id);
  const members = useMembersDirectory(organization?.id);
  const unread = useUnreadCounts(organization?.id, currentUserId, pollSeconds);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [chatMode, setChatMode] = useState<"direct" | "group">("direct");
  const [groupName, setGroupName] = useState("");
  const [groupMemberIds, setGroupMemberIds] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messages = useConversationMessages(selectedConversationId ?? "", pollSeconds);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.data]);

  const startConversation = useMutation({
    mutationFn: async (otherUserId: string) => {
      if (!organization?.id || !currentUserId) throw new Error("لا توجد جلسة نشطة");
      const { data: existingId, error: findError } = await supabase.rpc("app_find_or_note_direct_conversation", {
        p_organization_id: organization.id,
        p_user_a: currentUserId,
        p_user_b: otherUserId,
      });
      if (findError) throw findError;
      if (existingId) return existingId as string;

      const { data: conv, error: convError } = await supabase
        .from("internal_conversations")
        .insert({ organization_id: organization.id, is_group: false, created_by: currentUserId })
        .select("id")
        .single();
      if (convError) throw convError;
      const { error: partError } = await supabase.from("internal_conversation_participants").insert([
        { conversation_id: conv.id, user_id: currentUserId },
        { conversation_id: conv.id, user_id: otherUserId },
      ]);
      if (partError) throw partError;
      return conv.id as string;
    },
    onSuccess: (conversationId) => {
      queryClient.invalidateQueries({ queryKey: ["internal-conversations", organization?.id] });
      setSelectedConversationId(conversationId);
      setNewChatOpen(false);
    },
    onError: (error: Error) => toast({ title: "خطأ", description: error.message, variant: "destructive" }),
  });

  const createGroup = useMutation({
    mutationFn: async () => {
      if (!organization?.id || !currentUserId) throw new Error("لا توجد جلسة نشطة");
      if (!groupName.trim()) throw new Error("اسم المجموعة مطلوب");
      if (groupMemberIds.length === 0) throw new Error("اختر عضوًا واحدًا على الأقل");
      const { data: conv, error: convError } = await supabase
        .from("internal_conversations")
        .insert({ organization_id: organization.id, is_group: true, name_ar: groupName.trim(), created_by: currentUserId })
        .select("id")
        .single();
      if (convError) throw convError;
      const participants = [currentUserId, ...groupMemberIds].map((userId) => ({ conversation_id: conv.id, user_id: userId }));
      const { error: partError } = await supabase.from("internal_conversation_participants").insert(participants);
      if (partError) throw partError;
      return conv.id as string;
    },
    onSuccess: (conversationId) => {
      queryClient.invalidateQueries({ queryKey: ["internal-conversations", organization?.id] });
      setSelectedConversationId(conversationId);
      setNewChatOpen(false);
      setGroupName("");
      setGroupMemberIds([]);
      setChatMode("direct");
    },
    onError: (error: Error) => toast({ title: "خطأ", description: error.message, variant: "destructive" }),
  });

  const sendMessage = useMutation({
    mutationFn: async () => {
      if (!organization?.id || !currentUserId || !selectedConversationId || !draft.trim()) return;
      const { error } = await supabase.from("internal_messages").insert({
        organization_id: organization.id,
        conversation_id: selectedConversationId,
        sender_id: currentUserId,
        body: draft.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["internal-messages", selectedConversationId] });
      queryClient.invalidateQueries({ queryKey: ["internal-conversations", organization?.id] });
    },
    onError: (error: Error) => toast({ title: "تعذّر إرسال الرسالة", description: error.message, variant: "destructive" }),
  });

  useEffect(() => {
    if (!selectedConversationId || !currentUserId) return;
    supabase
      .from("internal_conversation_participants")
      .update({ last_read_at: new Date().toISOString() })
      .eq("conversation_id", selectedConversationId)
      .eq("user_id", currentUserId)
      .select("conversation_id")
      .then(({ data, error }) => {
        // لا نُزعج المستخدم برسالة: تعليم المحادثة مقروءة ليس إجراءً طلبه.
        // لكن الفشل الصامت التام كان يُبقي شارة «غير مقروء» إلى الأبد بلا أي
        // أثر يُفسّرها، فيُسجَّل في الطرفية على الأقل.
        if (error || (data ?? []).length === 0) {
          console.warn("تعذّر تعليم المحادثة كمقروءة", error);
          return;
        }
        queryClient.invalidateQueries({ queryKey: ["internal-unread", organization?.id, currentUserId] });
      });
  }, [selectedConversationId, currentUserId, organization?.id, queryClient]);

  const nameFor = (userId: string) => members.data?.find((m) => m.user_id === userId)?.display_name ?? "مستخدم";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>الدردشة الداخلية</CardTitle>
          <CardDescription>محادثات فعلية بين فريق العمل — مفصولة تمامًا عن سجل الإشعارات الخارجية للمرضى</CardDescription>
        </div>
        <Dialog open={newChatOpen} onOpenChange={setNewChatOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4" />
              محادثة جديدة
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>محادثة جديدة</DialogTitle>
            </DialogHeader>
            <div className="flex rounded-lg border p-0.5">
              <Button size="sm" variant={chatMode === "direct" ? "default" : "ghost"} onClick={() => setChatMode("direct")}>
                فردية
              </Button>
              <Button size="sm" variant={chatMode === "group" ? "default" : "ghost"} onClick={() => setChatMode("group")}>
                جماعية
              </Button>
            </div>

            {chatMode === "direct" && (
              <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
                {(members.data ?? [])
                  .filter((m) => m.user_id !== currentUserId)
                  .map((m) => (
                    <button
                      key={m.user_id}
                      type="button"
                      onClick={() => startConversation.mutate(m.user_id)}
                      className="flex items-center gap-2 rounded-md px-3 py-2 text-start text-sm hover:bg-muted"
                    >
                      <Users className="h-4 w-4 text-muted-foreground" />
                      {m.display_name}
                    </button>
                  ))}
                {(members.data ?? []).filter((m) => m.user_id !== currentUserId).length === 0 && (
                  <p className="py-4 text-center text-sm text-muted-foreground">لا يوجد أعضاء آخرون في المؤسسة.</p>
                )}
              </div>
            )}

            {chatMode === "group" && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>اسم المجموعة</Label>
                  <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} />
                </div>
                <div className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-md border p-2">
                  {(members.data ?? [])
                    .filter((m) => m.user_id !== currentUserId)
                    .map((m) => (
                      <label key={m.user_id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                        <input
                          type="checkbox"
                          checked={groupMemberIds.includes(m.user_id)}
                          onChange={(e) =>
                            setGroupMemberIds((prev) =>
                              e.target.checked ? [...prev, m.user_id] : prev.filter((id) => id !== m.user_id),
                            )
                          }
                        />
                        {m.display_name}
                      </label>
                    ))}
                  {(members.data ?? []).filter((m) => m.user_id !== currentUserId).length === 0 && (
                    <p className="py-4 text-center text-sm text-muted-foreground">لا يوجد أعضاء آخرون في المؤسسة.</p>
                  )}
                </div>
                <Button disabled={createGroup.isPending || !groupName.trim() || groupMemberIds.length === 0} onClick={() => createGroup.mutate()}>
                  {createGroup.isPending ? "جارٍ الإنشاء..." : "إنشاء المجموعة"}
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
          <div className="flex flex-col gap-1 border-s-0 sm:border-s sm:ps-3">
            {(conversations.data ?? []).map((c) => {
              const unreadCount = unread.data?.find((u) => u.conversation_id === c.id)?.unread_count ?? 0;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedConversationId(c.id)}
                  className={`flex items-center justify-between rounded-md px-3 py-2 text-start text-sm ${
                    selectedConversationId === c.id ? "bg-muted font-medium" : "hover:bg-muted/50"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                    {c.name_ar ?? "محادثة"}
                  </span>
                  {unreadCount > 0 && (
                    <Badge variant="destructive" className="text-[10px]">
                      {unreadCount}
                    </Badge>
                  )}
                </button>
              );
            })}
            {(conversations.data ?? []).length === 0 && (
              <p className="py-6 text-center text-xs text-muted-foreground">لا توجد محادثات — ابدأ محادثة جديدة.</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            {!selectedConversationId && (
              <p className="flex h-64 items-center justify-center text-sm text-muted-foreground">اختر محادثة لعرضها.</p>
            )}
            {selectedConversationId && (
              <>
                <div className="flex h-64 flex-col gap-2 overflow-y-auto rounded-md border p-3">
                  {(messages.data ?? []).map((m: any) => (
                    <div
                      key={m.id}
                      className={`max-w-xs rounded-lg px-3 py-1.5 text-sm ${
                        m.sender_id === currentUserId ? "self-start bg-primary text-primary-foreground" : "self-end bg-muted"
                      }`}
                    >
                      <p className="text-[10px] opacity-70">{nameFor(m.sender_id)}</p>
                      <p>{m.body}</p>
                    </div>
                  ))}
                  {(messages.data ?? []).length === 0 && (
                    <p className="flex flex-1 items-center justify-center text-xs text-muted-foreground">لا توجد رسائل بعد.</p>
                  )}
                  <div ref={messagesEndRef} />
                </div>
                <div className="flex gap-2">
                  <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="اكتب رسالة..."
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && draft.trim()) sendMessage.mutate();
                    }}
                  />
                  <Button size="sm" disabled={!draft.trim() || sendMessage.isPending} onClick={() => sendMessage.mutate()}>
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// إعدادات الدردشة الداخلية (internal_messaging_settings)
// ---------------------------------------------------------------------------
function useChatSettings(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["internal-chat-settings", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("internal_messaging_settings")
        .select("*")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (error) throw error;
      return data as InternalMessagingSettingsRow | null;
    },
  });
}

const DEFAULT_CHAT_SETTINGS: Omit<InternalMessagingSettingsRow, "organization_id" | "updated_at"> = {
  internal_chat_enabled: true,
  poll_interval_seconds: 15,
  online_timeout_seconds: 60,
  view_permission_scope: "own",
  delete_permission_scope: "own",
  notifications_enabled: true,
  notify_by_role: true,
};

function ChatSettingsTab() {
  const { organization } = useOrganizationAccess();
  const settings = useChatSettings(organization?.id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState(DEFAULT_CHAT_SETTINGS);

  useEffect(() => {
    if (settings.data) {
      setForm({
        internal_chat_enabled: settings.data.internal_chat_enabled,
        poll_interval_seconds: settings.data.poll_interval_seconds,
        online_timeout_seconds: settings.data.online_timeout_seconds,
        view_permission_scope: settings.data.view_permission_scope,
        delete_permission_scope: settings.data.delete_permission_scope,
        notifications_enabled: settings.data.notifications_enabled,
        notify_by_role: settings.data.notify_by_role,
      });
    }
  }, [settings.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("لا توجد مؤسسة نشطة");
      const { error } = await supabase
        .from("internal_messaging_settings")
        .upsert({ organization_id: organization.id, ...form });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["internal-chat-settings", organization?.id] });
      toast({ title: "تم حفظ إعدادات الدردشة" });
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذر الحفظ", description: errorMessage(error, "خطأ غير متوقع") }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>إعدادات الدردشة الداخلية</CardTitle>
        <CardDescription>تتحكم في تفعيل الدردشة، سرعة التحديث، ونطاق صلاحيات الإدارة على محادثات فريق العمل</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {settings.isLoading && <Skeleton className="h-48 w-full" />}
        {!settings.isLoading && (
          <>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.internal_chat_enabled}
                onChange={(e) => setForm((prev) => ({ ...prev, internal_chat_enabled: e.target.checked }))}
              />
              <Label className="font-normal">تفعيل الدردشة الداخلية</Label>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">
              إلغاء التأشير يُخفي تبويب «الدردشة الداخلية» بعد الحفظ. إخفاءُ واجهة لا منعٌ في
              القاعدة: سياسات الرسائل الداخلية لا تفحص هذا المفتاح بعد.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>مدة التحديث (ثانية)</Label>
                <Input
                  type="number"
                  min={5}
                  value={form.poll_interval_seconds}
                  onChange={(e) => setForm((prev) => ({ ...prev, poll_interval_seconds: Number(e.target.value) || 15 }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>مهلة اعتبار المستخدم "متصلًا" (ثانية) — غير مُطبَّقة بعد</Label>
                <Input
                  type="number"
                  min={10}
                  value={form.online_timeout_seconds}
                  onChange={(e) => setForm((prev) => ({ ...prev, online_timeout_seconds: Number(e.target.value) || 60 }))}
                />
                {/* لا توجد في النظام حالة «متصل» أصلًا: لا جدول حضور ولا منظور
                    يقرأ هذه المهلة. تُحفظ القيمة ولا أثر لها. */}
                <p className="text-xs text-amber-700">
                  لا تُعرض حالة «متصل» في أي شاشة بعد، فهذه القيمة تُحفظ بلا أثر.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>نطاق عرض المحادثات للمدير</Label>
                <select
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                  value={form.view_permission_scope}
                  onChange={(e) => setForm((prev) => ({ ...prev, view_permission_scope: e.target.value as "all" | "own" }))}
                >
                  <option value="own">محادثاته الخاصة فقط</option>
                  <option value="all">كل محادثات المؤسسة</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>نطاق صلاحية الحذف للمدير</Label>
                <select
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                  value={form.delete_permission_scope}
                  onChange={(e) => setForm((prev) => ({ ...prev, delete_permission_scope: e.target.value as "all" | "own" }))}
                >
                  <option value="own">رسائله الخاصة فقط</option>
                  <option value="all">كل رسائل المؤسسة</option>
                </select>
              </div>
            </div>
            {/* إدراج رسالة داخلية لا يُنتج تنبيهًا في القاعدة (المُحفِّز الوحيد
                على الجدول يُحدِّث وقت آخر رسالة فقط)، فالمفتاحان بلا أثر حتى
                يُضاف مُحفِّز يستدعي `app_notify_event` بشرطهما. */}
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
              <p className="text-sm font-semibold">مفتاحان يُحفظان ولا يُطبَّقان بعد</p>
              <p className="mb-2 text-xs">
                لا يُنشئ النظام تنبيهًا عند وصول رسالة داخلية — عدّاد «غير المقروء» في التبويب
                هو ما ينبّه اليوم.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.notifications_enabled}
                  onChange={(e) => setForm((prev) => ({ ...prev, notifications_enabled: e.target.checked }))}
                />
                <Label className="font-normal">تفعيل تنبيهات الرسائل الجديدة</Label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.notify_by_role}
                  onChange={(e) => setForm((prev) => ({ ...prev, notify_by_role: e.target.checked }))}
                />
                <Label className="font-normal">تنبيه حسب الدور الوظيفي</Label>
              </div>
            </div>
            <div>
              <Button disabled={save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? "جارٍ الحفظ..." : "حفظ الإعدادات"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
