import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, ShieldCheck, Stethoscope } from "lucide-react";

import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/error-message";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { LookupTree, useCategorySubtree } from "@/components/shared/LookupTree";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GridFooterCount } from "@/components/shell/ScreenToolbar";

/**
 * منتقي الخدمات — شجرة التصنيفات على اليمين وشبكة الأصناف على اليسار.
 *
 * **ما كان قبله:** `ItemPicker` صندوق بحثٍ واحد يُرجع ثمانية صفوف. من يعرف
 * اسم الصنف يجده، ومن يريد أن **يتصفّح** خدمات عيادةٍ بعينها لا يملك سبيلًا:
 * لا شجرة تصنيفات، ولا بحث بالسعر، ولا عرض لحدَّي السعر، ولا علامة على
 * المُغطّى تأمينيًّا. والاستقبال يفوتر بخدمةٍ لا يحفظ اسمها كاملًا.
 *
 * **والبحث بالسعر ليس زينة:** الموظّف يسمع من المريض «الجلسة بثلاثمئة» ولا
 * يعرف اسمها؛ رقمٌ واحد يجدها. وكتابة رقمٍ في صندوق بحثٍ نصّيّ كانت تُرجع
 * صفرًا فيظنّ أنّ الخدمة غير موجودة.
 *
 * `ItemPicker` يبقى كما هو في عشر شاشات أخرى: هذه نافذةٌ إضافية للفوترة لا
 * بديلٌ عنه، فتغييره كان سيمسّ شاشاتٍ لا علاقة لها بالطلب.
 */

export type PickedService = {
  id: string;
  name_ar: string;
  price: number;
  is_vat_exempt: boolean;
  code: string | null;
  min_price: number | null;
  max_price: number | null;
  default_discount_percent: number | null;
};

type PickerRow = {
  item_id: string;
  code: string | null;
  legacy_code: string | null;
  barcode: string | null;
  name_ar: string;
  name_en: string | null;
  unit: string | null;
  price: number;
  min_price: number | null;
  max_price: number | null;
  is_vat_exempt: boolean;
  default_discount_percent: number | null;
  requires_preauthorization: boolean;
  category_value_id: string | null;
  category_name: string | null;
  default_clinic_name: string | null;
  is_insured: boolean;
};

const PAGE_LIMIT = 300;

/** المصطلح رقمٌ صالح؟ — يُبحث به في السعر لا في النصّ. */
function asPrice(term: string): number | null {
  const cleaned = term.trim().replace(/,/g, "");
  if (!cleaned) return null;
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export default function ServiceBrowserDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (item: PickedService) => void;
}) {
  const { organization } = useOrganizationAccess();
  const [categoryId, setCategoryId] = useState("");
  const [term, setTerm] = useState("");
  const subtree = useCategorySubtree("item_categories");

  /**
   * الأصناف تُجلب مرّةً للمنشأة ويُرشَّح داخل المتصفّح.
   *
   * كتالوج عيادةٍ بضع مئات من الصفوف، وجلبه مرّةً يجعل البحث فوريًّا مع كل
   * حرف — وهو ما يطلبه المالك صراحةً («البحث يظهر فور بدء الكتابة»). ونداءٌ
   * للقاعدة مع كل حرف يُنتج تأخّرًا محسوسًا ونتائج تصل بترتيبٍ خاطئ.
   */
  const items = useQuery({
    queryKey: ["service-browser", organization?.id],
    enabled: Boolean(organization?.id) && open,
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_item_picker")
        .select("*")
        .eq("organization_id", organization!.id)
        .order("name_ar")
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as PickerRow[];
    },
  });

  const all = items.data ?? [];

  /** عدد الأصناف تحت كل تصنيف — يُعرض بجانب اسمه في الشجرة. */
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of all) {
      if (!row.category_value_id) continue;
      map[row.category_value_id] = (map[row.category_value_id] ?? 0) + 1;
    }
    return map;
  }, [all]);

  const filtered = useMemo(() => {
    const ids = categoryId ? new Set(subtree(categoryId)) : null;
    const needle = term.trim().toLowerCase();
    const price = asPrice(term);

    return all.filter((row) => {
      if (ids && !(row.category_value_id && ids.has(row.category_value_id))) return false;
      if (!needle) return true;
      // رقمٌ يُطابق السعر أو الكود أو الباركود — والنصّ يُطابق الأسماء
      if (price !== null && Number(row.price) === price) return true;
      return (
        row.name_ar.toLowerCase().includes(needle) ||
        (row.name_en ?? "").toLowerCase().includes(needle) ||
        (row.code ?? "").toLowerCase().includes(needle) ||
        (row.legacy_code ?? "").toLowerCase().includes(needle) ||
        (row.barcode ?? "").toLowerCase().includes(needle)
      );
    });
  }, [all, categoryId, term, subtree]);

  const shown = filtered.slice(0, PAGE_LIMIT);

  const pick = (row: PickerRow) => {
    onSelect({
      id: row.item_id,
      name_ar: row.name_ar,
      price: Number(row.price ?? 0),
      is_vat_exempt: Boolean(row.is_vat_exempt),
      code: row.code,
      min_price: row.min_price,
      max_price: row.max_price,
      default_discount_percent: row.default_discount_percent,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Stethoscope className="h-4 w-4" />
            الخدمات والأصناف
          </DialogTitle>
          <DialogDescription>
            اختر التصنيف من اليمين، أو ابحث بالاسم أو الكود أو الباركود أو
            <span className="font-semibold"> بالسعر</span> — اكتب الرقم مباشرةً.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground start-3" />
            <Input
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="انقر هنا من أجل البحث في الأعمال..."
              className="ps-9"
            />
          </div>

          {items.isError && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs">
              تعذّر تحميل الكتالوج: {errorMessage(items.error)}
            </p>
          )}

          <div className="flex flex-col gap-3 lg:flex-row-reverse lg:items-start">
            {/* الشجرة على اليمين في RTL — flex-row-reverse يضعها أوّلًا بصريًّا */}
            <div className="w-full shrink-0 lg:w-56">
              <LookupTree
                categoryKey="item_categories"
                value={categoryId}
                onChange={setCategoryId}
                allLabel="كل التصنيفات"
                counts={counts}
                totalCount={all.length}
              />
            </div>

            <div className="min-w-0 flex-1 rounded-lg border">
              {items.isLoading && <Skeleton className="h-80 w-full" />}
              {!items.isLoading && (
                <>
                  <div className="max-h-[26rem] overflow-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-background">
                        <TableRow>
                          <TableHead className="w-20 whitespace-nowrap">الكود</TableHead>
                          <TableHead className="w-24 whitespace-nowrap">باركود المصدر</TableHead>
                          <TableHead className="min-w-[14rem]">الخدمة / الصنف</TableHead>
                          <TableHead className="w-24 whitespace-nowrap text-center">السعر</TableHead>
                          <TableHead className="hidden w-24 whitespace-nowrap text-center sm:table-cell">
                            الحد الأدنى
                          </TableHead>
                          <TableHead className="hidden w-24 whitespace-nowrap text-center sm:table-cell">
                            الحد الأعلى
                          </TableHead>
                          <TableHead className="w-20 whitespace-nowrap text-center">مؤمَّنة</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {shown.map((row) => (
                          <TableRow
                            key={row.item_id}
                            tabIndex={0}
                            className="cursor-pointer focus:bg-accent"
                            onClick={() => pick(row)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                pick(row);
                              }
                            }}
                          >
                            <TableCell className="font-mono text-xs">{row.code ?? "—"}</TableCell>
                            <TableCell className="font-mono text-xs">{row.barcode ?? "—"}</TableCell>
                            <TableCell className="text-sm">
                              <div className="font-medium">{row.name_ar}</div>
                              <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                                {row.category_name && <span>{row.category_name}</span>}
                                {row.default_clinic_name && <span>· {row.default_clinic_name}</span>}
                                {row.is_vat_exempt && (
                                  <Badge variant="outline" className="px-1 py-0 text-[10px]">
                                    معفى من الضريبة
                                  </Badge>
                                )}
                                {row.requires_preauthorization && (
                                  <Badge variant="outline" className="px-1 py-0 text-[10px]">
                                    يحتاج موافقة مسبقة
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-center font-mono text-sm tabular-nums">
                              {Number(row.price ?? 0).toFixed(2)}
                            </TableCell>
                            <TableCell className="hidden text-center font-mono text-xs tabular-nums text-muted-foreground sm:table-cell">
                              {row.min_price === null ? "—" : Number(row.min_price).toFixed(2)}
                            </TableCell>
                            <TableCell className="hidden text-center font-mono text-xs tabular-nums text-muted-foreground sm:table-cell">
                              {row.max_price === null ? "—" : Number(row.max_price).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-center">
                              {row.is_insured ? (
                                <ShieldCheck className="mx-auto h-4 w-4 text-emerald-600" aria-label="مؤمَّنة" />
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                        {shown.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                              {all.length === 0
                                ? "لا أصناف في الكتالوج — تُضاف من شاشة «أصناف المركز والخدمات»."
                                : "لا نتائج مطابقة."}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  <GridFooterCount count={filtered.length} capped={filtered.length > PAGE_LIMIT} />
                </>
              )}
            </div>
          </div>

          {/**
           * «مؤمَّنة» تعني: للصنف قاعدة تغطية نشطة في عقدٍ أو وثيقة — لا أنّ
           * تأمين هذا المريض بعينه يغطّيه. التغطية تُحسم بالعقد وقت الفوترة،
           * والعلامة دليلٌ للموظّف لا حكم. قولها صراحةً يمنع وعدًا للمريض لا
           * يفي به النظام.
           */}
          <p className="text-[11px] text-muted-foreground">
            «مؤمَّنة» = للصنف تغطية في عقدٍ نشط بالمنشأة. تغطية <span className="font-medium">هذا</span>{" "}
            المريض تُحسم من عقد شركته عند الفوترة.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
