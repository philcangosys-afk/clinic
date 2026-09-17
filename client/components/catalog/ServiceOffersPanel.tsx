import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { usePermissions } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";
import { formatMoney } from "@/lib/locale";

const today = () => new Date().toISOString().slice(0, 10);

type OfferRow = {
  id: string;
  item_id: string;
  item_name: string | null;
  current_list_price: number | null;
  title: string;
  offer_price: number;
  list_price_at_creation: number | null;
  show_before_after: boolean;
  start_date: string | null;
  end_date: string | null;
  is_disabled: boolean;
  note: string | null;
  is_active_now: boolean;
  discount_percent_equivalent: number | null;
};

/**
 * عروض خدمةٍ واحدة.
 *
 * **العرض سعرٌ بعديّ لا نسبة خصم.** المنشأة تُعلن «بـ١٤٩» لا «بخصم ٢٥٫٥٪»،
 * وحسابُ النسبة من رقمٍ مُعلَن يُنتج كسورًا تُقرَّب فتخرج ١٤٩٫٠١ على الفاتورة.
 * فالمُدخَل هو السعر بعد العرض، والنسبةُ تُحسب للعرض على الشاشة فقط.
 *
 * **ولا يمسّ العرضُ سعر الخدمة الأصلي.** لو خُفِّض `items.price` نفسه لأجل
 * العرض لضاع السعر الأصلي، ولاحتاج انتهاء العرض إلى من يتذكّر رقمًا قديمًا.
 * وهنا ينتهي العرض بتاريخه فيعود السعر وحده.
 *
 * **والضريبة تتبع بالبناء:** العرض يُنزل الوعاء الخاضع، وقواعد الجنسية
 * (0147/0152/0156) تحسب على ما بقي — فلا شرط جديد هنا.
 */
export default function ServiceOffersPanel({
  itemId,
  listPrice,
  minPrice,
}: {
  itemId: string;
  listPrice: number;
  /** حدّ 0159 الأدنى — العرض تحته ترفضه القاعدة، فنُنبّه قبل الإرسال. */
  minPrice: number | null;
}) {
  const { organization } = useOrganizationAccess();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const organizationId = organization?.id;
  const canManage = can("catalog.manage");

  const [title, setTitle] = useState("");
  const [offerPrice, setOfferPrice] = useState("");
  const [showBeforeAfter, setShowBeforeAfter] = useState(true);
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState("");
  const [note, setNote] = useState("");

  const offers = useQuery({
    queryKey: ["item-offers", itemId],
    enabled: Boolean(itemId) && Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_item_offers")
        .select(
          "id, item_id, item_name, current_list_price, title, offer_price, list_price_at_creation, show_before_after, start_date, end_date, is_disabled, note, is_active_now, discount_percent_equivalent",
        )
        .eq("organization_id", organizationId)
        .eq("item_id", itemId)
        .order("start_date", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as OfferRow[];
    },
  });

  const activeOffer = useMemo(
    () => (offers.data ?? []).find((row) => row.is_active_now) ?? null,
    [offers.data],
  );

  const reset = () => {
    setTitle("");
    setOfferPrice("");
    setShowBeforeAfter(true);
    setStartDate(today());
    setEndDate("");
    setNote("");
  };

  const create = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد منشأة نشطة");
      const name = title.trim();
      if (!name) throw new Error("اسم العرض مطلوب");
      const price = Number(offerPrice);
      if (!Number.isFinite(price) || price < 0) throw new Error("سعر العرض غير صحيح");
      if (price >= listPrice && listPrice > 0) {
        throw new Error(
          `سعر العرض (${formatMoney(price)}) ليس أقلّ من سعر الخدمة (${formatMoney(listPrice)}) — العرض هكذا لا يُخفّض شيئًا`,
        );
      }
      if (minPrice !== null && price < minPrice) {
        throw new Error(
          `سعر العرض (${formatMoney(price)}) تحت الحدّ الأدنى للخدمة (${formatMoney(minPrice)}) — عدِّل الحدّ أو ارفع سعر العرض`,
        );
      }
      if (endDate && startDate && endDate < startDate) {
        throw new Error("تاريخ نهاية العرض قبل بدايته");
      }

      const { data, error } = await supabase
        .from("item_offers")
        .insert({
          organization_id: organizationId,
          item_id: itemId,
          title: name,
          offer_price: price,
          // السعر الأصلي يُثبَّت وقت الإنشاء: يُطبع «قبل/بعد» ويبقى حقيقةً
          // تاريخية ولو عُدِّل سعر الخدمة لاحقًا.
          list_price_at_creation: listPrice || null,
          show_before_after: showBeforeAfter,
          start_date: startDate || null,
          end_date: endDate || null,
          note: note.trim() || null,
        })
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("لم يُضف العرض — تحقّق من صلاحية إدارة الكتالوج");
      }
      return data[0].id as string;
    },
    onSuccess: () => {
      reset();
      queryClient.invalidateQueries({ queryKey: ["item-offers", itemId] });
      queryClient.invalidateQueries({ queryKey: ["items-catalog"] });
      toast({ title: "تم إضافة العرض" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر إضافة العرض",
        description: errorMessage(error, "حدث خطأ غير متوقع"),
      }),
  });

  /**
   * التعطيل لا الحذف.
   *
   * فاتورةٌ صدرت بسعر العرض تبقى مفسَّرةً بوجود العرض في السجلّ. وحذفُه يترك
   * فاتورةً بسعرٍ لا مصدر له — وهو السؤال الذي يُطرح في أوّل مراجعة.
   */
  const toggleDisabled = useMutation({
    mutationFn: async (row: OfferRow) => {
      const { data, error } = await supabase
        .from("item_offers")
        .update({ is_disabled: !row.is_disabled, updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("organization_id", organizationId)
        .select("id");
      if (error) throw error;
      // PostgREST لا يعتبر «صفر صفوف» خطأً: بلا هذا الفحص يظهر نجاحٌ كاذب
      if (!data || data.length === 0) {
        throw new Error("لم يتغيّر شيء — تحقّق من صلاحية إدارة الكتالوج");
      }
      return row.id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["item-offers", itemId] });
      queryClient.invalidateQueries({ queryKey: ["items-catalog"] });
      toast({ title: "تم تحديث العرض" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التحديث",
        description: errorMessage(error, "حدث خطأ غير متوقع"),
      }),
  });

  const previewPercent = useMemo(() => {
    const price = Number(offerPrice);
    if (!Number.isFinite(price) || listPrice <= 0 || price < 0) return null;
    return Math.round(((listPrice - price) * 1000) / listPrice) / 10;
  }, [offerPrice, listPrice]);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border bg-muted/40 p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">سعر الخدمة الحالي:</span>
          <span className="font-medium">{formatMoney(listPrice)}</span>
          {minPrice !== null && (
            <Badge variant="outline">الحد الأدنى {formatMoney(minPrice)}</Badge>
          )}
          {activeOffer ? (
            <Badge className="bg-emerald-600 hover:bg-emerald-600">
              عرض نشط: {activeOffer.title} — {formatMoney(activeOffer.offer_price)}
            </Badge>
          ) : (
            <Badge variant="secondary">لا عرض نشط اليوم</Badge>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          العرض النشط يُطبَّق تلقائيًا عند إضافة الخدمة لأي فاتورة، ولا يمسّ سعر الخدمة
          الأصلي — فينتهي بتاريخه فيعود السعر وحده. والضريبة تُحسب على السعر بعد العرض
          حسب جنسية المريض كما هي القاعدة.
        </p>
      </div>

      {canManage && (
        <div className="rounded-md border p-3">
          <div className="mb-3 text-sm font-medium">عمل عرض على الخدمة</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>اسم العرض</Label>
              <Input
                value={title}
                placeholder="اليوم الوطني السعودي"
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>السعر بعد العرض</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={offerPrice}
                placeholder="149"
                onChange={(e) => setOfferPrice(e.target.value)}
              />
              {previewPercent !== null && offerPrice !== "" && (
                <span className="text-xs text-muted-foreground">
                  ما يعادله خصمًا: {previewPercent}%
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>من تاريخ</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>إلى تاريخ</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              <span className="text-xs text-muted-foreground">الفراغ يعني بلا نهاية</span>
            </div>
          </div>

          <label className="mt-3 flex items-center gap-2 text-sm">
            <Switch checked={showBeforeAfter} onCheckedChange={setShowBeforeAfter} />
            إظهار «السعر قبل وبعد» في الفاتورة وشاشة الطلب
          </label>
          <p className="mt-1 text-xs text-muted-foreground">
            إن أُغلق يظهر سعر العرض وحده بلا ذكر السعر الأصلي.
          </p>

          <div className="mt-3 flex flex-col gap-1.5">
            <Label>ملاحظة (اختيارية)</Label>
            <Textarea
              rows={2}
              value={note}
              placeholder="شروط العرض أو مرجع القرار"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="mt-3 flex justify-end">
            <Button
              disabled={!title.trim() || offerPrice === "" || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? "جارٍ الإضافة..." : "إضافة العرض"}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            القاعدة ترفض عرضين متداخلين على الخدمة نفسها: عطِّل العرض القائم أو غيِّر
            التواريخ.
          </p>
        </div>
      )}

      <Separator />

      <div>
        <div className="mb-2 text-sm font-medium">العروض المسجّلة</div>
        {offers.isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : offers.isError ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            تعذّر قراءة العروض: {errorMessage(offers.error, "خطأ غير متوقع")}
            <br />
            إن كانت الرسالة عن جدول غير موجود فترقية 0167 لم تُنفَّذ بعد.
          </p>
        ) : (offers.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">لا عروض على هذه الخدمة.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">العرض</TableHead>
                <TableHead className="text-right">السعر بعد</TableHead>
                <TableHead className="text-right">يعادل</TableHead>
                <TableHead className="text-right">من</TableHead>
                <TableHead className="text-right">إلى</TableHead>
                <TableHead className="text-right">قبل/بعد</TableHead>
                <TableHead className="text-right">الحالة</TableHead>
                <TableHead className="text-right">إجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(offers.data ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    {row.title}
                    {row.note && (
                      <div className="text-xs text-muted-foreground">{row.note}</div>
                    )}
                  </TableCell>
                  <TableCell>{formatMoney(row.offer_price)}</TableCell>
                  <TableCell>{row.discount_percent_equivalent ?? 0}%</TableCell>
                  <TableCell>{row.start_date ?? "—"}</TableCell>
                  <TableCell>{row.end_date ?? "بلا نهاية"}</TableCell>
                  <TableCell>{row.show_before_after ? "يُظهر" : "لا"}</TableCell>
                  <TableCell>
                    {row.is_disabled ? (
                      <Badge variant="outline">معطَّل</Badge>
                    ) : row.is_active_now ? (
                      <Badge className="bg-emerald-600 hover:bg-emerald-600">نشط</Badge>
                    ) : (
                      <Badge variant="secondary">خارج التاريخ</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canManage || toggleDisabled.isPending}
                      onClick={() => toggleDisabled.mutate(row)}
                    >
                      {row.is_disabled ? "تفعيل" : "تعطيل"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          العرض يُعطَّل ولا يُحذف: فاتورةٌ صدرت بسعره تبقى مفسَّرةً بوجوده في السجل.
        </p>
      </div>
    </div>
  );
}
