import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HeartPulse, Plus, Pencil, Trash2, Search, Info, Lock } from "lucide-react";
import { useOrganizationAccess } from "@/contexts/OrganizationAccessContext";
import { supabase } from "@/lib/supabase";
import { isOrganizationAdmin } from "@/lib/organization-access";
import type { OrganizationRole } from "@shared/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import DictionariesTab from "@/components/reference/DictionariesTab";

/**
 * البيانات المرجعية الطبية (لقطتا 16 و17).
 *
 * كان الجدولان يُقرآن فقط: قائمة الأمراض تظهر كخانات اختيار في ملف المريض،
 * وأكواد ICD10 تظهر في مُنتقي التشخيص — بلا أي شاشة لإدارتهما.
 *
 * فرق جوهري بين الجدولين يحكم ما تسمح به كل واجهة:
 *
 * • `health_conditions` يقبل صفوفًا خاصة بالمنشأة (organization_id) إلى جانب
 *   الصفوف النظامية العامة (null). فالإضافة والتعديل متاحان — لصفوف المنشأة
 *   وحدها. الصفوف العامة تُعرض للقراءة لأن سياسة RLS نفسها تمنع تعديلها،
 *   وهي مشتركة بين كل المنشآت.
 *
 * • `icd10_codes` مرجع عالمي موحّد بسياسة قراءة فقط من العميل (0006). لا
 *   يوجد فيه عمود organization_id أصلًا، فأي تعديل عليه يغيّر التصنيف لكل
 *   المنشآت في النظام. لذلك هذا التبويب استعراض وبحث فقط — وهو تحسين حقيقي
 *   لأن الأكواد لم تكن قابلة للتصفح إلا أثناء تسجيل تشخيص.
 */

// ═══════════════ الأمراض والحالات الصحية ═══════════════

type HealthConditionRow = {
  id: string;
  organization_id: string | null;
  name_ar: string;
  name_en: string;
  sort_order: number;
};

function useHealthConditions(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["health-conditions-admin", organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("health_conditions")
        .select("*")
        .or(`organization_id.eq.${organizationId},organization_id.is.null`)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as HealthConditionRow[];
    },
  });
}

function ConditionFormDialog({
  open,
  onOpenChange,
  organizationId,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | undefined;
  initial?: HealthConditionRow | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [nameAr, setNameAr] = useState(initial?.name_ar ?? "");
  const [nameEn, setNameEn] = useState(initial?.name_en ?? "");
  const [sortOrder, setSortOrder] = useState(String(initial?.sort_order ?? 0));

  const save = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("لا توجد مؤسسة نشطة");
      if (!nameAr.trim()) throw new Error("الاسم العربي مطلوب");
      // name_en غير قابل للفراغ في الجدول (not null) — نعيد استخدام العربي
      // عند تركه فارغًا بدل أن يفشل الحفظ برسالة قاعدة بيانات غامضة.
      const payload = {
        organization_id: organizationId,
        name_ar: nameAr.trim(),
        name_en: nameEn.trim() || nameAr.trim(),
        sort_order: Number(sortOrder) || 0,
      };
      if (initial) {
        const { data: affectedRows, error } = await supabase.from("health_conditions").update(payload).eq("id", initial.id)
          .select("id");
        if (error) throw error;
        // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
        // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
        if (!affectedRows || affectedRows.length === 0)
          throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
      } else {
        const { error } = await supabase.from("health_conditions").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["health-conditions-admin"] });
      queryClient.invalidateQueries({ queryKey: ["health-conditions"] });
      toast({ title: initial ? "تم تحديث الحالة" : "تمت إضافة الحالة" });
      onOpenChange(false);
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحفظ",
        description: error instanceof Error ? error.message : "حدث خطأ غير متوقع",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "تعديل الحالة الصحية" : "حالة صحية جديدة"}</DialogTitle>
          <DialogDescription>تظهر كخانة اختيار في تبويب "الحالة الصحية" بملف المريض</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>الاسم العربي *</Label>
            <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>الاسم الإنجليزي</Label>
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>ترتيب العرض</Label>
            <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </div>
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

function HealthConditionsTab({ readOnly }: { readOnly: boolean }) {
  const { organization } = useOrganizationAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const conditions = useHealthConditions(organization?.id);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<HealthConditionRow | null>(null);

  const removeCondition = useMutation({
    mutationFn: async (row: HealthConditionRow) => {
      if (row.organization_id === null) throw new Error("لا يمكن حذف حالة نظامية عامة");
      const { data: affectedRows, error } = await supabase.from("health_conditions").delete().eq("id", row.id)
        .select("id");
      if (error) throw error;
      // تحديث/حذف لا يطابق صفًا ليس خطأً في PostgREST: بلا هذا الفحص تظهر
      // رسالة نجاح كاذبة بينما لم يتغيّر شيء (رفض RLS، أو صف حذفه غيرك).
      if (!affectedRows || affectedRows.length === 0)
        throw new Error("لم تُنفَّذ العملية — راجع صلاحيتك أو حدِّث الصفحة");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["health-conditions-admin"] });
      toast({ title: "تم حذف الحالة" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر الحذف",
        description:
          error instanceof Error
            ? error.message.includes("foreign key") || error.message.includes("violates")
              ? "لا يمكن حذف حالة مرتبطة بملفات مرضى — أزل ارتباطها أولًا"
              : error.message
            : "حدث خطأ غير متوقع",
      }),
  });

  const list = conditions.data ?? [];
  const orgCount = list.filter((row) => row.organization_id !== null).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {list.length} حالة ({orgCount} منها خاصة بمنشأتك)
        </p>
        {!readOnly && (
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            حالة جديدة
          </Button>
        )}
      </div>

      <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span>
          الحالات النظامية مشتركة بين كل المنشآت ولا تُعدَّل — أضف حالة خاصة بمنشأتك إن احتجت تسمية
          مختلفة.
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HeartPulse className="h-4 w-4" />
            الأمراض والحالات الصحية
          </CardTitle>
          <CardDescription>القائمة التي تظهر في ملف كل مريض</CardDescription>
        </CardHeader>
        <CardContent>
          {conditions.isLoading && <Skeleton className="h-40 w-full" />}
          {!conditions.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الاسم</TableHead>
                  <TableHead>الاسم الإنجليزي</TableHead>
                  <TableHead>الترتيب</TableHead>
                  <TableHead>المصدر</TableHead>
                  {!readOnly && <TableHead className="w-24">إجراءات</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((row) => {
                  const isSystem = row.organization_id === null;
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.name_ar}</TableCell>
                      <TableCell className="text-sm text-muted-foreground" dir="ltr">
                        {row.name_en}
                      </TableCell>
                      <TableCell className="tabular-nums">{row.sort_order}</TableCell>
                      <TableCell>
                        <Badge variant={isSystem ? "secondary" : "success"}>
                          {isSystem ? "نظامية" : "خاصة بالمنشأة"}
                        </Badge>
                      </TableCell>
                      {!readOnly && (
                        <TableCell>
                          {isSystem ? (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Lock className="h-3 w-3" />
                              للقراءة
                            </span>
                          ) : (
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setEditing(row);
                                  setFormOpen(true);
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => removeCondition.mutate(row)}>
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
                {list.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={readOnly ? 4 : 5}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      لا توجد حالات صحية.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {formOpen && (
        <ConditionFormDialog
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

// ═══════════════ أكواد ICD-10 ═══════════════

type Icd10Row = {
  id: string;
  code: string;
  diagnosis_group: string | null;
  name_en: string;
  name_ar: string | null;
  is_disabled: boolean;
};

const ICD_PAGE_SIZE = 100;

function Icd10Tab() {
  const [search, setSearch] = useState("");

  const codes = useQuery({
    queryKey: ["icd10-browse", search],
    queryFn: async () => {
      let query = supabase
        .from("icd10_codes")
        .select("*")
        .eq("is_disabled", false)
        .order("code")
        .limit(ICD_PAGE_SIZE);
      const term = search.trim();
      if (term) {
        query = query.or(`code.ilike.%${term}%,name_en.ilike.%${term}%,name_ar.ilike.%${term}%`);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as Icd10Row[];
    },
  });

  const list = codes.data ?? [];
  const atCap = list.length >= ICD_PAGE_SIZE;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span>
          ICD-10 تصنيف عالمي موحّد مشترك بين كل المنشآت في النظام، ولذلك هو للاستعراض والبحث فقط —
          تعديله من منشأة واحدة كان سيغيّر التصنيف لدى الجميع. لتسجيل تشخيص، استخدم مُنتقي التشخيص في
          شاشة السجل الطبي.
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>أكواد ICD-10</CardTitle>
          <CardDescription>
            {atCap ? `يُعرض أول ${ICD_PAGE_SIZE} كود — ضيّق البحث` : `${list.length} كود`}
          </CardDescription>
          <div className="mt-2 flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-1.5">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث بالكود أو اسم التشخيص..."
              className="h-7 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
            />
          </div>
        </CardHeader>
        <CardContent>
          {codes.isLoading && <Skeleton className="h-40 w-full" />}
          {!codes.isLoading && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الكود</TableHead>
                  <TableHead>الاسم العربي</TableHead>
                  <TableHead>الاسم الإنجليزي</TableHead>
                  <TableHead>المجموعة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs" dir="ltr">
                      {row.code}
                    </TableCell>
                    <TableCell className="font-medium">{row.name_ar ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground" dir="ltr">
                      {row.name_en}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.diagnosis_group ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {list.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                      لا توجد أكواد مطابقة.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * أكواد الإجراءات — مرجع عالمي بلا `organization_id`، مثل ICD-10.
 *
 * يُقرأ ولا يُكتب من التطبيق: كتابةٌ من منشأةٍ على مرجعٍ عالمي تراه كل
 * المنشآت. التوسعة بالاستيراد من محرّر SQL.
 */
function ProcedureCodesTab() {
  const [search, setSearch] = useState("");

  const rows = useQuery({
    queryKey: ["procedure-codes", search],
    queryFn: async () => {
      let query = supabase
        .from("procedure_codes")
        .select("id, code_system, code, name_ar, name_en, category")
        .eq("is_disabled", false)
        .order("code")
        .limit(200);
      const term = search.trim();
      if (term) query = query.or(`code.ilike.%${term}%,name_ar.ilike.%${term}%,name_en.ilike.%${term}%`);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  return (
    <Card>
      <CardHeader>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="بحث بالكود أو الاسم..."
          className="max-w-sm"
        />
        <CardDescription>
          مرجع عالمي مشترك — يُقرأ ولا يُعدَّل من التطبيق. الربط بالخدمة يتم من محرّر الخدمة
          (تبويب «أكواد المطالبات»).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.isLoading && <Skeleton className="h-32 w-full" />}
        {!rows.isLoading && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>النظام</TableHead>
                <TableHead>الكود</TableHead>
                <TableHead>الاسم</TableHead>
                <TableHead>التصنيف</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rows.data ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Badge variant="outline">{String(row.code_system).toUpperCase()}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.code}</TableCell>
                  <TableCell>{row.name_ar ?? row.name_en}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{row.category ?? "—"}</TableCell>
                </TableRow>
              ))}
              {(rows.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    لا أكواد إجراءات محمَّلة بعد — تُستورَد إلى جدول `procedure_codes`.
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

export default function ReferenceData() {
  const { membership } = useOrganizationAccess();
  const isAdmin = isOrganizationAdmin(membership?.role_key as OrganizationRole | undefined);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">البيانات المرجعية الطبية</h1>
        <p className="text-sm text-muted-foreground">
          القواميس الطبية وأكواد التشخيص والإجراءات. القواميس النظامية مشتركة بين كل المنشآت
          وتُقرأ ولا تُعدَّل.
        </p>
      </div>

      <Tabs defaultValue="dictionaries" className="flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="dictionaries">القواميس</TabsTrigger>
          <TabsTrigger value="conditions">الأمراض والحالات</TabsTrigger>
          <TabsTrigger value="icd10">أكواد ICD-10</TabsTrigger>
          <TabsTrigger value="procedures">أكواد الإجراءات</TabsTrigger>
        </TabsList>
        <TabsContent value="dictionaries">
          <DictionariesTab readOnly={!isAdmin} />
        </TabsContent>
        <TabsContent value="conditions">
          <HealthConditionsTab readOnly={!isAdmin} />
        </TabsContent>
        <TabsContent value="icd10">
          <Icd10Tab />
        </TabsContent>
        <TabsContent value="procedures">
          <ProcedureCodesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
