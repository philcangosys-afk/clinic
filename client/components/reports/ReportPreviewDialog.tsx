import { useRef, useState, useSyncExternalStore } from "react";
import { Loader2, Printer, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { closeReportPreview, getReportPreview, subscribeReportPreview } from "@/lib/report-preview";
import { errorMessage } from "@/lib/error-message";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/**
 * نافذة معاينة التقرير داخل النظام (تُركَّب مرّةً في AppShell).
 * التقرير في إطارٍ مستقلّ بأنماطه، والطباعة تطبع الإطار وحده بقواعد @page
 * (A4، تذييل كل صفحة، رؤوس الجداول المتكرّرة). ومن نافذة الطباعة «حفظ PDF».
 *
 * «Printed Count» على الكرت واللصاقة يُسجَّل عند الضغط على «طباعة» لا عند
 * المعاينة: كلّ عنصرٍ يحمل data-print-log يُحدَّث بالعدد الجديد قبل الطباعة.
 */
export default function ReportPreviewDialog() {
  const preview = useSyncExternalStore(subscribeReportPreview, getReportPreview, getReportPreview);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [printing, setPrinting] = useState(false);

  const print = async () => {
    const frame = frameRef.current;
    const win = frame?.contentWindow;
    const doc = frame?.contentDocument;
    if (!win || !doc) return;
    setPrinting(true);
    try {
      const counters = doc.querySelectorAll<HTMLElement>("[data-print-log]");
      for (let i = 0; i < counters.length; i++) {
        const el = counters[i];
        const { data, error } = await supabase.rpc("app_log_patient_print", {
          p_patient_id: el.dataset.patient,
          p_report: el.dataset.printLog,
        });
        if (error) throw error;
        el.textContent = String(Number(data ?? 0) || 1);
      }
      win.focus();
      win.print();
    } catch (error) {
      toast({ variant: "destructive", title: "تعذّرت الطباعة", description: errorMessage(error) });
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Dialog open={preview.open} onOpenChange={(open) => !open && closeReportPreview()}>
      <DialogContent
        dir="rtl"
        className="flex h-[94vh] w-[min(98vw,1100px)] max-w-none flex-col gap-0 overflow-hidden p-0 [&>button.absolute]:hidden"
      >
        <div className="flex flex-wrap items-center gap-2 border-b bg-background px-4 py-3">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-base">{preview.title || "تقرير"}</DialogTitle>
            <DialogDescription className="text-xs">
              معاينة — اطبع أو احفظ PDF من زرّ «طباعة»، أو أغلق دون طباعة.
            </DialogDescription>
          </div>
          <Button size="sm" disabled={preview.loading || !preview.html || printing} onClick={() => void print()}>
            {printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
            طباعة / حفظ PDF
          </Button>
          <Button size="sm" variant="outline" onClick={closeReportPreview}>
            <X className="h-4 w-4" />
            إغلاق
          </Button>
        </div>
        <div className="relative flex-1 bg-muted">
          {preview.loading || !preview.html ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              جارٍ تجهيز التقرير…
            </div>
          ) : (
            <iframe
              ref={frameRef}
              title={preview.title}
              srcDoc={preview.html}
              sandbox="allow-same-origin allow-modals"
              className="h-full w-full border-0"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
