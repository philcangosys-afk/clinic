import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TicketPercent, Plus, Pencil, Trash2 } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import ItemPicker from "@/components/shared/ItemPicker";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";

/**
 * لائحة العروض والخصومات (لقطة 11).
 *
 * جدولا `offers` و `offer_items` موجودان منذ 0004 ودالة `app_resolve_discount`
 * تقرأ منهما فعليًا ضمن سلسلة أولوية الخصومات — لكن لم توجد أي شاشة لإنشاء
 * عرض. أي أن المرتبة الثالثة في سلسلة الأولوية كانت معطَّلة دائمًا لعدم
 * وجود بيانات فيها.
 *
 * نطاق العرض: `open_date` يعني ساريًا بلا حدود زمنية، و`date_range` يقيّده
 * بتاريخي بدء وانتهاء — وهو ما تفحصه الدالة عند احتساب الخصم.
 */
type OfferRow = {
  id: string;
  organization_id: string;
  offer_number: number;
  classification: string | null;
  title: string;
  description: string | null;
  offer_scope: "open_date" | "date_range";
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  discount_percent: number;
  applies_to_all_items: boolean;
  is_disabled: boolean;
  created_at: string;
};

type OfferItemRow = {
  id: string;
  offer_id: string;
  item_id: string | null;
  category_value_id: string | null;
  item: { name_ar: string } | null;
};

function useOffers(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["offers", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("offers")
        .select("*")
        .eq("organization_id", organizationId)
        .order("offer_number", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OfferRow[];
    },
  });
}

function useOfferItems(offerId: string | undefined) {
  return useQuery({
    queryKey: ["offer-items", offerId],
    enabled: Boolean(offerId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("offer_items")
        .select("id, offer_id, item_id, category_value_id, item:items(name_ar)")
        .eq("offer_id", offerId);
      if (error) throw error;
      return (data ?? []) as unknown as OfferItemRow[];
    },
  });
}

function isActiveNow(offer: OfferRow) {
  if (offer.is_disabled) return false;
  if (offer.offer_scope === "open_date") return true;
  const today = new Date().toISOString().slice(0, 10);
  if (offer.start_date && today < offer.start_date) return false;
  if (offer.end_date && today > offer.end_date) return false;
  return true;
}

/**
 * لماذا لا يدخل الوقت في حساب السريان هنا؟
 *
 * `app_resolve_discount` — الدالّة الوحيدة التي تقرأ `offers` عند الفوترة —
 * تفحص `offer_scope` و`start_date` و`end_date` فقط ولا تمسّ `start_time`
 * و`end_time`. فحقلا الوقت في النموذج كانا يَعِدان الموظّف بقيدٍ لا وجود له:
 * «عرض المساء ٣٠٪» كان يُخصم على فواتير الصباح أيضًا. وحُذف الحقلان من النموذج
 * بدل إظهار «خارج الفترة» على عرضٍ يُطبَّق فعلًا — فتناقض الشاشة مع الفاتورة
 * أسوأ من فقدان الميزة. والقيم القديمة المحفوظة تُعرض هنا صريحةً بأنها
 * غير مُطبَّقة حتى لا يُبنى عليها قرار. تفعيل العروض بالساعة يحتاج شرط الوقت
 * داخل `app_resolve_discount` (مع مراعاة تجاوز منتصف الليل).
 */
function legacyTimeWindow(offer: OfferRow) {
  if (!offer.start_time && !offer.end_time) return null;
  return `${offer.start_time?.slice(0, 5) ?? "—"} – ${offer.end_time?.slice(0, 5) ?? "—"}`;
}

function OfferFormDialog({
  open,
  onOpenChange,
  organizationId,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  initial?: OfferRow | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { session } = useOrganizationAccess();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [classification, setClassification] = useState(initial?.classification ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [scope, setScope] = useState<"open_date" | "date_range">(initial?.offer_scope ?? "date_range");
  const [startDate, setStartDate] = useState(initial?.start_date ?? "");
  const [endDate, setEndDate] = useState(initial?.end_date ?? "");
  const [discountPercent, setDiscountPercent] = useState(String(initial?.discount_percent ?? "10"));
  const [appliesToAll, setAppliesToAll] = useState(initial?.applies_to_all_items ?? true);
  const existingItems = useOfferItems(initial?.id);
  const [newItems, setNewItems] = useState<{ id: string; name_ar: string }[]>([]);

  const save = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      if (!title.trim()) throw new Error("عنوان العرض مطلوب");
      const percent = Number(discountPercent);
      if (!Number.isFinite(percent) || percent <= 0 || percent > 100)
        throw new Error("نسبة الخصم يجب أن تكون بين 1 و 100");
      if (scope === "date_range") {
        if (!startDate || !endDate) throw new Error("حدّد تاريخي البدء والانتهاء");
        if (startDate > endDate) throw new Error("تاريخ البدء يجب أن يسبق تاريخ الانتهاء");
      }

      const payload = {
        organization_id: organizationId,
        title: title.trim(),
        classification: classification.trim() || null,
        description: description.trim() || null,
        offer_scope: scope,
        // نطاق مفتوح = بلا تواريخ، حتى لا تبقى تواريخ قديمة تشوّش القراءة
        start_date: scope === "date_range" ? startDate : null,
        end_date: scope === "date_range" ? endDate : null,
        // `start_time`/`end_time` لا يُكتبان من هنا: لا شيء في القاعدة يفحصهما،
        // فكتابتهما وعدٌ بقيد غير موجود. وما بقي منهما في صفوف قديمة يُترك كما هو
        // ويُعرض في الجدول موصوفًا بأنه غير مُطبَّق (انظر legacyTimeWindow).
        discount_percent: percent,
        applies_to_all_items: appliesToAll,
        created_by: session?.user.id ?? null,
      };

      let offerId = initial?.id;
      if (initial) {
        const { data: affectedRows, error } = await supabase.from("offers").update(payload).eq("id", initial.id)
          .select("id");
        if (error) throw error;
        // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
        // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
        if (!affectedRows || affectedRows.length === 0)
          throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
      } else {
        const { data, error } = await supabase.from("offers").insert(payload).select("id").single();
        if (error) throw error;
        offerId = data.id as string;
      }

      // الأصناف تُسجَّل فقط عندما لا يشمل العرض كل الأصناف
      if (!appliesToAll && offerId && newItems.length > 0) {
        const { error } = await supabase
          .from("offer_items")
          .insert(newItems.map((item) => ({ offer_id: offerId, item_id: item.id })));
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["offers"] });
      queryClient.invalidateQueries({ queryKey: ["offer-items"] });
      toast({ title: initial ? "تم تحديث العرض" : "تمت إضافة العرض" });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: errorMessage(error),
      }),
  });

  const removeItem = useMutation({
    mutationFn: async (id: string) => {
      const { data: affectedRows, error } = await supabase.from("offer_items").delete().eq("id", id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["offer-items"] }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "تعديل العرض" : "عرض جديد"}</DialogTitle>
          <DialogDescription>
            العروض تدخل تلقائيًا في احتساب الخصم عند إصدار الفاتورة حسب ترتيب الأولوية
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>عنوان العرض *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="عرض التبييض" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>التصنيف</Label>
            <Input
              value={classification}
              onChange={(e) => setClassification(e.target.value)}
              placeholder="عروض موسمية"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>نسبة الخصم % *</Label>
            <Input
              type="number"
              min={1}
              max={100}
              value={discountPercent}
              onChange={(e) => setDiscountPercent(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>نطاق السريان</Label>
            <Select value={scope} onValueChange={(value) => setScope(value as "open_date" | "date_range")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date_range">بين تاريخين</SelectItem>
                <SelectItem value="open_date">مفتوح (بلا تاريخ انتهاء)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {scope === "date_range" && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label>من تاريخ *</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>إلى تاريخ *</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </>
          )}
          {initial && legacyTimeWindow(initial) && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 sm:col-span-2">
              على هذا العرض ساعات محفوظة ({legacyTimeWindow(initial)}) لا تُطبَّق عند الفوترة —
              الخصم يسري كل اليوم داخل فترة التواريخ. للتحديد بالساعة يلزم تعديل احتساب الخصم في القاعدة.
            </p>
          )}
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>الوصف</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
        </div>

        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={appliesToAll}
              onChange={(e) => setAppliesToAll(e.target.checked)}
              className="h-4 w-4"
            />
            يشمل كل الأصناف والخدمات
          </label>

          {!appliesToAll && (
            <div className="flex flex-col gap-2">
              <Label>الأصناف المشمولة</Label>
              <ItemPicker onSelect={(item) => setNewItems((prev) => [...prev, { id: item.id, name_ar: item.name_ar }])} />

              <div className="flex flex-wrap gap-1.5">
                {(existingItems.data ?? []).map((row) => (
                  <Badge key={row.id} variant="secondary" className="gap-1">
                    {row.item?.name_ar ?? "صنف"}
                    <button type="button" onClick={() => removeItem.mutate(row.id)} aria-label="إزالة">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {newItems.map((item, index) => (
                  <Badge key={`${item.id}-${index}`} variant="default" className="gap-1">
                    {item.name_ar}
                    <button
                      type="button"
                      onClick={() => setNewItems((prev) => prev.filter((_, i) => i !== index))}
                      aria-label="إزالة"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {(existingItems.data ?? []).length === 0 && newItems.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    لم تُحدَّد أصناف — العرض لن يُطبَّق على شيء حتى تضيف صنفًا.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Offers() {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const offers = useOffers(organization?.id);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<OfferRow | null>(null);

  const toggleDisabled = useMutation({
    mutationFn: async (row: OfferRow) => {
      const { data: affectedRows, error } = await supabase
        .from("offers")
        .update({ is_disabled: !row.is_disabled })
        .eq("id", row.id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["offers"] });
      toast({ title: "تم تحديث حالة العرض" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التحديث",
        description: errorMessage(error),
      }),
  });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">العروض والخصومات</h1>
          <p className="text-sm text-muted-foreground">
            عروض ترويجية تُطبَّق تلقائيًا عند الفوترة ضمن ترتيب أولوية الخصومات
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          عرض جديد
        </Button>
      </div>

      <div className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
        ترتيب أولوية الخصم عند الفوترة: خصم المريض الخاص ← الخصم العام للمنشأة ← <strong>العروض</strong> ←
        خصم الصنف الافتراضي. يُطبَّق أول خصم يوجد في هذا الترتيب.
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TicketPercent className="h-4 w-4" />
            العروض
          </CardTitle>
          <CardDescription>العرض المعطَّل أو المنتهي لا يدخل في احتساب الخصم</CardDescription>
        </CardHeader>
        <CardContent>
          {offers.isLoading && <Skeleton className="h-40 w-full" />}
          {!offers.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>العنوان</TableHead>
                  <TableHead>التصنيف</TableHead>
                  <TableHead>الخصم</TableHead>
                  <TableHead>الفترة</TableHead>
                  <TableHead>النطاق</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead className="w-28">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(offers.data ?? []).map((row) => {
                  const active = isActiveNow(row);
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs">{row.offer_number}</TableCell>
                      <TableCell className="font-medium">{row.title}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.classification ?? "—"}
                      </TableCell>
                      <TableCell className="font-semibold tabular-nums">{row.discount_percent}%</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.offer_scope === "open_date"
                          ? "مفتوح"
                          : `${row.start_date ?? "—"} ← ${row.end_date ?? "—"}`}
                        {legacyTimeWindow(row) && (
                          <span className="block text-[10px] text-amber-700">
                            ساعات محفوظة {legacyTimeWindow(row)} — غير مُطبَّقة عند الفوترة
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {row.applies_to_all_items ? "كل الأصناف" : "أصناف محددة"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={active ? "success" : "secondary"}>
                          {row.is_disabled ? "معطّل" : active ? "ساري" : "خارج الفترة"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditing(row);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => toggleDisabled.mutate(row)}>
                            {row.is_disabled ? "تفعيل" : "تعطيل"}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {(offers.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد عروض — العروض المضافة هنا تُطبَّق تلقائيًا عند الفوترة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {formOpen && (
        <OfferFormDialog
          key={editing?.id ?? "new"}
          open={formOpen}
          onOpenChange={setFormOpen}
          organizationId={organization?.id}
          initial={editing}
        />
      )}
    </div>
  );
}
