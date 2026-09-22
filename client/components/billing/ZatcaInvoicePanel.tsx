import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, ShieldAlert } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePermissions } from "@/lib/permissions";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime, useLocaleSettings } from "@/lib/locale";
import ZatcaQrCode from "@/components/ZatcaQrCode";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * حالة الفاتورة لدى ZATCA وإرسالها — داخل تفاصيل الفاتورة.
 *
 * الإرسال عبر الدالّة الطرفية `zatca-invoice` وحدها. «إرسال حقيقي» لا يمرّ
 * إلا بعبارة تأكيدٍ تُكتب لكل فاتورة، والخادم يشترط فوقها أن يكون الإنتاج
 * مفعّلًا على الجهاز — فلا تُرسل فاتورةٌ ملزمة بضغطةٍ خاطئة.
 */

const SUBMIT_PHRASE = "SUBMIT_REAL_ZATCA_INVOICE";

const STATUS_META: Record<string, { label: string; className: string }> = {
  pending: { label: "لم تُرسل", className: "bg-muted text-muted-foreground" },
  submitted: { label: "قيد الإرسال", className: "bg-sky-100 text-sky-800" },
  cleared: { label: "مصادَق عليها", className: "bg-emerald-100 text-emerald-800" },
  reported: { label: "مُبلَّغ عنها", className: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "مرفوضة", className: "bg-rose-100 text-rose-800" },
  failed: { label: "تعذّر الإرسال", className: "bg-amber-100 text-amber-900" },
  ambiguous: { label: "غير محسومة — مراجعة يدوية", className: "bg-rose-200 text-rose-900" },
};

type ZatcaRow = {
  issued_at: string | null;
  status: string;
  zatca_status: string;
  zatca_mode: string | null;
  zatca_uuid: string | null;
  zatca_icv: number | null;
  zatca_qr_data: string | null;
  zatca_response: any;
  zatca_submitted_at: string | null;
};

async function readInvokeError(error: unknown, data: any) {
  let payload = data;
  const context = (error as { context?: Response } | null)?.context;
  if (!payload?.error && context) {
    payload = await context.clone().json().catch(() => null);
  }
  const validation = payload?.details?.validationResults;
  const first = Array.isArray(validation?.errorMessages) ? validation.errorMessages[0] : null;
  return [payload?.error, first?.code ? `[${first.code}] ${first.message ?? ""}` : null]
    .filter(Boolean)
    .join(" — ") || (error instanceof Error ? error.message : "تعذّر الإرسال");
}

export default function ZatcaInvoicePanel({ invoiceId }: { invoiceId: string }) {
  const { can } = usePermissions();
  const { toast } = useToast();
  const { calendarDisplay } = useLocaleSettings();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [phrase, setPhrase] = useState("");

  const row = useQuery({
    queryKey: ["invoice-zatca", invoiceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_invoices")
        .select("issued_at, status, zatca_status, zatca_mode, zatca_uuid, zatca_icv, zatca_qr_data, zatca_response, zatca_submitted_at")
        .eq("id", invoiceId)
        .maybeSingle();
      if (error) throw error;
      return data as ZatcaRow | null;
    },
    retry: false,
  });

  const submit = useMutation({
    mutationFn: async (mode: "simulation" | "production") => {
      const { data, error } = await supabase.functions.invoke("zatca-invoice", {
        body: {
          invoiceId,
          mode,
          ...(mode === "production" ? { productionConfirmation: phrase } : {}),
        },
      });
      if (error || data?.error) throw new Error(await readInvokeError(error, data));
      return data as { message?: string; status?: string; warnings?: Array<{ message?: string }> };
    },
    onSuccess: (data) => {
      setConfirmOpen(false);
      setPhrase("");
      queryClient.invalidateQueries({ queryKey: ["invoice-zatca", invoiceId] });
      toast({
        title: data.message ?? "أُرسلت الفاتورة",
        description: data.warnings?.length ? `تحذيرات ZATCA: ${data.warnings.map((w) => w.message).join(" — ")}` : undefined,
      });
    },
    onError: (error: unknown) => {
      queryClient.invalidateQueries({ queryKey: ["invoice-zatca", invoiceId] });
      toast({
        variant: "destructive",
        title: "لم تُقبل الفاتورة لدى ZATCA",
        description: error instanceof Error ? error.message : "تعذّر الإرسال",
      });
    },
  });

  if (row.isLoading) return null;
  if (row.isError) {
    return (
      <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        حالة ZATCA غير متاحة — نفّذ ترقيات الربط (0178–0180) أوّلًا.
      </p>
    );
  }
  const data = row.data;
  if (!data?.issued_at || data.status === "void") return null;

  const meta = STATUS_META[data.zatca_status] ?? STATUS_META.pending;
  const accepted = data.zatca_status === "cleared" || data.zatca_status === "reported";
  const acceptedInProduction = accepted && data.zatca_mode === "production";
  const blocked = data.zatca_status === "ambiguous";
  const canSubmit = can("billing.issue") && !blocked;
  const errors = data.zatca_response?.validationResults?.errorMessages;

  return (
    <div className="flex flex-wrap items-start gap-4 rounded-lg border p-3">
      <ZatcaQrCode value={data.zatca_qr_data} status={data.zatca_status} size={112} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">الفاتورة الإلكترونية — ZATCA</span>
          <Badge className={meta.className}>{meta.label}</Badge>
          {data.zatca_mode && (
            <Badge variant="outline">{data.zatca_mode === "production" ? "الإنتاج الحقيقي" : "المحاكاة"}</Badge>
          )}
        </div>
        {data.zatca_uuid && (
          <span className="text-xs text-muted-foreground" dir="ltr">
            UUID {data.zatca_uuid} · ICV {data.zatca_icv ?? "—"}
          </span>
        )}
        {data.zatca_submitted_at && (
          <span className="text-xs text-muted-foreground">
            آخر إرسال: {formatDateTime(data.zatca_submitted_at, calendarDisplay)}
          </span>
        )}
        {Array.isArray(errors) && errors.length > 0 && !accepted && (
          <ul className="list-disc ps-4 text-xs text-rose-700" dir="auto">
            {errors.slice(0, 4).map((e: any, i: number) => (
              <li key={i}>
                {e.code ? `[${e.code}] ` : ""}
                {e.message}
              </li>
            ))}
          </ul>
        )}
        {blocked && (
          <p className="flex items-center gap-1 text-xs text-rose-800">
            <ShieldAlert className="h-3.5 w-3.5" />
            نتيجة الإرسال غير محسومة، وأُوقف تسلسل الجهاز. لا تُعد الإرسال قبل مطابقتها مع بوابة فاتورة.
          </p>
        )}
        {canSubmit && !acceptedInProduction && (
          <div className="mt-1 flex flex-wrap gap-2">
            {data.zatca_mode !== "production" && !(accepted && data.zatca_mode === "simulation") && (
              <Button size="sm" variant="outline" disabled={submit.isPending} onClick={() => submit.mutate("simulation")}>
                {submit.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                إرسال إلى المحاكاة
              </Button>
            )}
            <Button
              size="sm"
              className="bg-rose-700 hover:bg-rose-800"
              disabled={submit.isPending}
              onClick={() => setConfirmOpen(true)}
            >
              <Send className="h-3.5 w-3.5" />
              إرسال حقيقي إلى ZATCA
            </Button>
          </div>
        )}
      </div>

      <Dialog open={confirmOpen} onOpenChange={(open) => !open && setConfirmOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إرسال فاتورة ملزمة قانونيًا</DialogTitle>
            <DialogDescription>
              تُرسل الفاتورة إلى منصة ZATCA الحقيقية ولا يمكن سحبها — التصحيح بعدها بإشعار دائن أو مدين. اكتب العبارة
              التالية حرفيًا للتأكيد:
            </DialogDescription>
          </DialogHeader>
          <code className="block text-xs font-bold" dir="ltr">
            {SUBMIT_PHRASE}
          </code>
          <Input value={phrase} onChange={(e) => setPhrase(e.target.value)} dir="ltr" autoComplete="off" className="font-mono" />
          <DialogFooter>
            <Button
              className="bg-rose-700 hover:bg-rose-800"
              disabled={phrase !== SUBMIT_PHRASE || submit.isPending}
              onClick={() => submit.mutate("production")}
            >
              {submit.isPending ? "جارٍ الإرسال…" : "تأكيد الإرسال الحقيقي"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
