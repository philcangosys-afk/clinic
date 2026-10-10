import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import ItemPicker from "@/components/shared/ItemPicker";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/error-message";

/**
 * ربط فحص مخبري أو فحص أشعة بصنف الفوترة.
 *
 * `lab_tests.billing_item_id` و`radiology_exams.billing_item_id` معرَّفان منذ
 * 0013/0014 ومُعلَّق عليهما «الربط بكتالوج الفوترة»، ولم تكن في الواجهة كلها
 * قراءة واحدة لهما ولا كتابة. أثر ذلك مباشر في المال: فحص يُطلب من الطبيب،
 * ويُنفَّذ في المختبر، ثم لا يجد المحاسب له سعرًا ولا صنفًا — فإمّا يبحث عنه
 * في كتالوج الأصناف بالاسم ويخمّن، وإمّا يسقط من الفاتورة أصلًا.
 *
 * الصنف هو أيضًا حامل الضريبة والإعفاء (`is_vat_exempt`)، فالربط ليس سعرًا
 * فحسب بل معاملة ضريبية صحيحة.
 */

export type BillingItemRef = { id: string; name_ar: string; price: number | null } | null;

export default function BillingItemLink({
  table,
  rowId,
  value,
  invalidateKey,
}: {
  table: "lab_tests" | "radiology_exams";
  rowId: string;
  value: BillingItemRef;
  invalidateKey: unknown[];
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const save = useMutation({
    mutationFn: async (itemId: string | null) => {
      // الحارس ضد الحذف/التحديث الصامت: PostgREST لا يُخطئ حين لا يطابق
      // التحديث أي صف (سياسة RLS مانعة مثلًا)، فبدون `select` كانت الواجهة
      // تُظهر «تم الربط» بلا ربط.
      const { data, error } = await supabase
        .from(table)
        .update({ billing_item_id: itemId })
        .eq("id", rowId)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("لم يُحدَّث أي صف — تحقّق من صلاحيتك");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: invalidateKey });
      setOpen(false);
      toast({ title: "تم تحديث ربط الفوترة" });
    },
    onError: (error: unknown) =>
      toast({
        variant: "destructive",
        title: "تعذر التحديث",
        description: errorMessage(error),
      }),
  });

  return (
    <>
      <div className="flex items-center gap-1.5">
        {value ? (
          <Badge variant="secondary" className="max-w-[14rem] truncate">
            {value.name_ar}
            {value.price !== null && ` — ${Number(value.price).toLocaleString("ar-SA-u-nu-latn")}`}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            غير مربوط
          </Badge>
        )}
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)} disabled={save.isPending}>
          <Link2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ربط بصنف الفوترة</DialogTitle>
            <DialogDescription>
              الصنف المربوط هو ما يظهر في الفاتورة بسعره ومعاملته الضريبية. بلا ربط لا يمكن
              فوترة هذا الفحص تلقائيًا من الزيارة.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <ItemPicker onSelect={(item) => save.mutate(item.id)} />
            {/*
              لا زرّ «إلغاء الربط»: عمود صنف الفوترة إلزاميّ في القاعدة منذ
              0083/0084، فكان الزرّ يمرّر فارغًا وتردّه القاعدة في كل مرّة —
              زرٌّ لا ينجح أبدًا. الربط يُغيَّر باختيار صنف آخر، ولا يُلغى.
            */}
            {value && (
              <p className="text-xs text-muted-foreground">
                المربوط الآن: {value.name_ar} — اختر صنفًا آخر لتغييره. لا يمكن ترك الفحص بلا
                صنف فوترة، فبدونه لا يدخل الفاتورة.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
