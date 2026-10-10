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
import { externalClientB2bGaps } from "@/lib/external-clients";

/**
 * قائمة العملاء الخارجيين — جهات ليست مرضى (شركات/جهات تواصل): الاسم وأرقام
 * التواصل، ومنذ 0202 **الهويّة الضريبية والعنوان الوطنيّ**: العميل الخارجيّ هو
 * مشتري «فاتورة الأعمال» (B2B)، وهي فاتورة ضريبية تعتمدها ZATCA مسبقًا ولا
 * تُقبل بلا رقمه الضريبيّ أو سجلّه التجاريّ وعنوانه الوطنيّ كاملًا.
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

/** قواعد القاعدة نفسها (0202) — تُفحص هنا ليظهر الخطأ بجانب حقله. */
const TAX_FIELD_RULES = {
  vat_number: { pattern: /^3\d{13}3$/, message: "الرقم الضريبيّ 15 رقمًا يبدأ وينتهي بـ3" },
  cr_number: { pattern: /^\d{10}$/, message: "السجلّ التجاريّ 10 أرقام" },
  building_number: { pattern: /^\d{4}$/, message: "رقم المبنى 4 أرقام" },
  postal_code: { pattern: /^\d{5}$/, message: "الرمز البريديّ 5 أرقام" },
  additional_number: { pattern: /^\d{4}$/, message: "الرقم الإضافيّ 4 أرقام" },
} as const;

type TaxFields = {
  vat_number: string;
  cr_number: string;
  building_number: string;
  street_name: string;
  district: string;
  city: string;
  postal_code: string;
  additional_number: string;
};

/** أرقامٌ عربية-هندية مكتوبة في الحقل تُحفظ لاتينية، والمسافات تُزال. */
const digitsOnly = (value: string) =>
  value
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\s+/g, "");

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
  const [tax, setTax] = useState<TaxFields>({
    vat_number: initial?.vat_number ?? "",
    cr_number: initial?.cr_number ?? "",
    building_number: initial?.building_number ?? "",
    street_name: initial?.street_name ?? "",
    district: initial?.district ?? "",
    city: initial?.city ?? "",
    postal_code: initial?.postal_code ?? "",
    additional_number: initial?.additional_number ?? "",
  });
  const setTaxField = (key: keyof TaxFields, value: string) => setTax((prev) => ({ ...prev, [key]: value }));
  const fieldError = (key: keyof typeof TAX_FIELD_RULES) => {
    const value = digitsOnly(tax[key]);
    return value && !TAX_FIELD_RULES[key].pattern.test(value) ? TAX_FIELD_RULES[key].message : null;
  };
  const taxErrors = (Object.keys(TAX_FIELD_RULES) as (keyof typeof TAX_FIELD_RULES)[])
    .map(fieldError)
    .filter(Boolean) as string[];

  const save = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      if (!name.trim()) throw new Error("الاسم مطلوب");
      if (taxErrors.length > 0) throw new Error(taxErrors.join("، "));
      const digits = (key: keyof TaxFields) => digitsOnly(tax[key]) || null;
      const textValue = (key: keyof TaxFields) => tax[key].trim() || null;
      const payload = {
        organization_id: organizationId,
        name: name.trim(),
        mobile_1: mobile1.trim() || null,
        mobile_2: mobile2.trim() || null,
        phone_1: phone1.trim() || null,
        phone_2: phone2.trim() || null,
        note: note.trim() || null,
        vat_number: digits("vat_number"),
        cr_number: digits("cr_number"),
        building_number: digits("building_number"),
        street_name: textValue("street_name"),
        district: textValue("district"),
        city: textValue("city"),
        postal_code: digits("postal_code"),
        additional_number: digits("additional_number"),
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
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "تعديل عميل خارجي" : "عميل خارجي جديد"}</DialogTitle>
          <DialogDescription>
            جهة ليست مريضًا (شركة أو جهة). البيانات الضريبية والعنوان الوطنيّ لازمة لفاتورة الأعمال (B2B) وحدها.
          </DialogDescription>
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
          <div className="flex flex-col gap-2 rounded-md border p-3">
            <p className="text-sm font-medium">البيانات الضريبية — لفاتورة الأعمال (B2B)</p>
            <div className="grid grid-cols-2 gap-2">
              <TaxInput label="الرقم الضريبيّ" value={tax.vat_number} error={fieldError("vat_number")}
                onChange={(v) => setTaxField("vat_number", v)} placeholder="3xxxxxxxxxxxxx3" />
              <TaxInput label="السجلّ التجاريّ" value={tax.cr_number} error={fieldError("cr_number")}
                onChange={(v) => setTaxField("cr_number", v)} />
              <TaxInput label="رقم المبنى" value={tax.building_number} error={fieldError("building_number")}
                onChange={(v) => setTaxField("building_number", v)} />
              <TaxInput label="الشارع" value={tax.street_name} onChange={(v) => setTaxField("street_name", v)} />
              <TaxInput label="الحيّ" value={tax.district} onChange={(v) => setTaxField("district", v)} />
              <TaxInput label="المدينة" value={tax.city} onChange={(v) => setTaxField("city", v)} />
              <TaxInput label="الرمز البريديّ" value={tax.postal_code} error={fieldError("postal_code")}
                onChange={(v) => setTaxField("postal_code", v)} />
              <TaxInput label="الرقم الإضافيّ (اختياري)" value={tax.additional_number}
                error={fieldError("additional_number")} onChange={(v) => setTaxField("additional_number", v)} />
            </div>
            <p className="text-xs text-muted-foreground">
              يكفي الرقم الضريبيّ أو السجلّ التجاريّ (لمنشأةٍ غير مسجّلة في الضريبة). والعنوان الوطنيّ كاملًا شرطٌ
              لفاتورة الأعمال.
            </p>
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

function TaxInput({
  label,
  value,
  onChange,
  error,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
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
          <p className="text-sm text-muted-foreground">
            جهات ليست مرضى (شركات أو جهات) — مشترو فاتورة الأعمال (B2B) بهويّتهم الضريبية، وجهات تواصل
          </p>
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
                  <TableHead>الرقم الضريبيّ / السجلّ</TableHead>
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
                    <TableCell className="text-xs">
                      <div className="font-mono">{client.vat_number ?? client.cr_number ?? "—"}</div>
                      {externalClientB2bGaps(client).length === 0 ? (
                        <Badge variant="success" className="mt-0.5">جاهز لفاتورة الأعمال</Badge>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">
                          ينقصه لفاتورة الأعمال: {externalClientB2bGaps(client).join("، ")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(client.registered_at).toLocaleDateString("ar-SA-u-nu-latn")}
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

      {/* المفتاح يُعيد تهيئة الحقول لكلّ عميل: الحالة تُقرأ من `initial` عند التركيب
          وحده، فكانت نافذة التعديل تفتح بحقول أوّل عميل فُتح (أو فارغة). */}
      <ClientFormDialog
        key={`${editing?.id ?? "new"}-${formOpen ? "open" : "closed"}`}
        open={formOpen}
        onOpenChange={setFormOpen}
        organizationId={organization?.id}
        initial={editing}
      />
      <BulkSmsDialog open={bulkSmsOpen} onOpenChange={setBulkSmsOpen} organizationId={organization?.id} recipients={selectedClients} />
    </div>
  );
}
