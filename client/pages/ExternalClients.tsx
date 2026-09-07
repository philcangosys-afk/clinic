import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Contact2, MessageSquareShare, Plus } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import type { ExternalClientRow } from "@/lib/database.types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";

/**
 * قائمة العملاء الخارجيين — من المواصفة الأصلية: جهات ليست مرضى (شركات/جهات
 * تواصل) بحقول تواصل بسيطة فقط (اسم، موبايلان، هاتفان، تاريخ تسجيل)، مع
 * إمكانية إرسال رسالة نصية جماعية. قائمة تواصل (Rolodex) بسيطة عمدًا — بلا أي
 * حقول فوترة أو ضريبة، تمييزًا عن الموردين (distributors) وشركات التأمين.
 */
function useExternalClients(organizationId: string | undefined, search: string) {
  return useQuery({
    queryKey: ["external-clients", organizationId, search],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      let query = supabase
        .from("external_clients")
        .select("*")
        .eq("organization_id", organizationId)
        .order("name");
      if (search.trim()) query = query.ilike("name", `%${search.trim()}%`);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as ExternalClientRow[];
    },
  });
}

function ClientFormDialog({
  open,
  onOpenChange,
  organizationId,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  initial?: ExternalClientRow | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState(initial?.name ?? "");
  const [mobile1, setMobile1] = useState(initial?.mobile_1 ?? "");
  const [mobile2, setMobile2] = useState(initial?.mobile_2 ?? "");
  const [phone1, setPhone1] = useState(initial?.phone_1 ?? "");
  const [phone2, setPhone2] = useState(initial?.phone_2 ?? "");
  const [note, setNote] = useState(initial?.note ?? "");

  const save = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      if (!name.trim()) throw new Error("الاسم مطلوب");
      const payload = {
        organization_id: organizationId,
        name: name.trim(),
        mobile_1: mobile1.trim() || null,
        mobile_2: mobile2.trim() || null,
        phone_1: phone1.trim() || null,
        phone_2: phone2.trim() || null,
        note: note.trim() || null,
      };
      if (initial) {
        const { data: affectedRows, error } = await supabase.from("external_clients").update(payload).eq("id", initial.id)
          .select("id");
        if (error) throw error;
        // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
        // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
        if (!affectedRows || affectedRows.length === 0)
          throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
      } else {
        const { error } = await supabase.from("external_clients").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["external-clients", organizationId] });
      toast({ title: initial ? "تم تحديث العميل" : "تم إضافة العميل" });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذر الحفظ", description: errorMessage(error, "خطأ غير متوقع") }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "تعديل عميل خارجي" : "عميل خارجي جديد"}</DialogTitle>
          <DialogDescription>جهة تواصل ليست مريضًا (شركة أو جهة تواصل) — بيانات اتصال بسيطة فقط</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>الاسم</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label>جوال 1</Label>
              <Input value={mobile1} onChange={(e) => setMobile1(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>جوال 2</Label>
              <Input value={mobile2} onChange={(e) => setMobile2(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>هاتف 1</Label>
              <Input value={phone1} onChange={(e) => setPhone1(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>هاتف 2</Label>
              <Input value={phone2} onChange={(e) => setPhone2(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>ملاحظة (اختياري)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkSmsDialog({
  open,
  onOpenChange,
  organizationId,
  recipients,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  recipients: ExternalClientRow[];
}) {
  const { session } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [message, setMessage] = useState("");

  /**
   * العميل المعطَّل يُستثنى من الإرسال.
   *
   * كان التعطيل لا يعني شيئًا عمليًّا سوى لون الصفّ: «تحديد الكل» يشمله فتُدرَج
   * له رسالة كغيره. والتعطيل في هذه الشاشة هو بديل الحذف (لا حذف نهائي
   * للبيانات)، فلا معنى له إن بقي يستقبل.
   */
  const eligible = recipients.filter((r) => !r.is_disabled);
  const withMobile = eligible.filter((r) => r.mobile_1);
  const disabledCount = recipients.length - eligible.length;
  const noMobileCount = eligible.length - withMobile.length;
  // المستثنون يُذكَر سببهم: عدد بلا سبب يجعل الفرق يبدو خطأً في النظام.
  const excludedReasons = [
    disabledCount > 0 ? `${disabledCount} معطَّل` : null,
    noMobileCount > 0 ? `${noMobileCount} بلا رقم جوال 1` : null,
  ].filter(Boolean);
  const excludedNote = excludedReasons.length > 0 ? ` (مستثنى: ${excludedReasons.join("، ")})` : "";

  const send = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      if (!message.trim()) throw new Error("اكتب نص الرسالة");
      if (withMobile.length === 0) throw new Error("لا يوجد عملاء محدَّدون نشطون برقم جوال");
      const { error } = await supabase.from("message_log").insert(
        withMobile.map((client) => ({
          organization_id: organizationId,
          channel: "sms" as const,
          external_recipient: client.mobile_1,
          message_text: message.trim(),
          status: "queued" as const,
          created_by: session?.user.id ?? null,
        })),
      );
      if (error) throw error;
    },
    onSuccess: () => {
      // سجل الرسائل كان لا يُحدَّث من هنا (بخلاف شاشة الإرسال للمرضى)، فلا تظهر
      // الرسائل الجديدة في «سجل الرسائل» في نفس الجلسة فيشكّ المستخدم في وقوع
      // الإرسال. والنصّ يقول الحقيقة: تُسجَّل ولا تُرسَل — لا مزوّد رسائل مُهيَّأ.
      queryClient.invalidateQueries({ queryKey: ["message-log"] });
      toast({
        title: `سُجّلت ${withMobile.length} رسالة في الطابور`,
        description: "لن تصل أجهزة العملاء حتى تُفعَّل قناة الرسائل النصّية.",
      });
      setMessage("");
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذر الإرسال", description: errorMessage(error, "خطأ غير متوقع") }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تسجيل رسالة نصية جماعية</DialogTitle>
          <DialogDescription>
            ستُسجَّل لـ {withMobile.length} من {recipients.length} عميلًا محدَّدًا
            {excludedNote}. قناة الرسائل النصّية غير مفعّلة في النظام، فما يُسجَّل هنا لا يصل
            أجهزة العملاء بعد.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label>نص الرسالة</Label>
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} />
        </div>

        <DialogFooter>
          <Button disabled={send.isPending || withMobile.length === 0} onClick={() => send.mutate()}>
            <MessageSquareShare className="h-4 w-4" />
            {send.isPending ? "جارٍ التسجيل..." : "تسجيل في الطابور"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ExternalClients() {
  const { organization } = useOrganizationAccess();
  const [search, setSearch] = useState("");
  const clients = useExternalClients(organization?.id, search);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ExternalClientRow | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkSmsOpen, setBulkSmsOpen] = useState(false);

  const toggleDisabled = useMutation({
    mutationFn: async (client: ExternalClientRow) => {
      const { data: affectedRows, error } = await supabase.from("external_clients").update({ is_disabled: !client.is_disabled }).eq("id", client.id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["external-clients", organization?.id] });
    },
    onError: (error: unknown) =>
      toast({ variant: "destructive", title: "تعذر التحديث", description: errorMessage(error, "خطأ غير متوقع") }),
  });

  // «تحديد الكل» يحدّد النشطين وحدهم: تحديد المعطَّلين كان يُدرِج لهم رسائل.
  const allIds = (clients.data ?? []).filter((c) => !c.is_disabled).map((c) => c.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.includes(id));
  const selectedClients = (clients.data ?? []).filter((c) => selectedIds.includes(c.id));

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? [] : allIds);
  };
  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Contact2 className="h-6 w-6" /> العملاء الخارجيون
          </h1>
          <p className="text-sm text-muted-foreground">جهات تواصل ليست مرضى (شركات أو جهات تواصل) — مع تسجيل رسالة نصية جماعية في الطابور (قناة الرسائل غير مفعّلة بعد)</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={selectedIds.length === 0}
            onClick={() => setBulkSmsOpen(true)}
          >
            <MessageSquareShare className="h-4 w-4" />
            رسالة جماعية ({selectedIds.length})
          </Button>
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            عميل جديد
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">القائمة</CardTitle>
          <CardDescription>
            <Input placeholder="بحث بالاسم..." value={search} onChange={(e) => setSearch(e.target.value)} className="mt-2 max-w-xs" />
          </CardDescription>
        </CardHeader>
        <CardContent>
          {clients.isLoading && <Skeleton className="h-40 w-full" />}
          {!clients.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
                  </TableHead>
                  <TableHead>الاسم</TableHead>
                  <TableHead>جوال 1</TableHead>
                  <TableHead>جوال 2</TableHead>
                  <TableHead>هاتف 1</TableHead>
                  <TableHead>هاتف 2</TableHead>
                  <TableHead>تاريخ التسجيل</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(clients.data ?? []).map((client) => (
                  <TableRow key={client.id} className={client.is_disabled ? "opacity-60" : undefined}>
                    <TableCell>
                      <input type="checkbox" checked={selectedIds.includes(client.id)} onChange={() => toggleSelectOne(client.id)} />
                    </TableCell>
                    <TableCell className="font-medium">{client.name}</TableCell>
                    <TableCell className="text-xs">{client.mobile_1 ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{client.mobile_2 ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{client.phone_1 ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{client.phone_2 ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(client.registered_at).toLocaleDateString("ar-SA")}
                    </TableCell>
                    <TableCell>
                      <Badge variant={client.is_disabled ? "secondary" : "success"}>{client.is_disabled ? "معطَّل" : "نشط"}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditing(client);
                            setFormOpen(true);
                          }}
                        >
                          تعديل
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => toggleDisabled.mutate(client)}>
                          {client.is_disabled ? "تفعيل" : "تعطيل"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {(clients.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                      لا يوجد عملاء خارجيون بعد.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ClientFormDialog open={formOpen} onOpenChange={setFormOpen} organizationId={organization?.id} initial={editing} />
      <BulkSmsDialog open={bulkSmsOpen} onOpenChange={setBulkSmsOpen} organizationId={organization?.id} recipients={selectedClients} />
    </div>
  );
}
